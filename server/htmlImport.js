// 知识库 HTML 报告导入解析模块
// 不依赖任何第三方 HTML 解析库，纯正则 + 字符串处理实现。
// 职责：抽取标题 / 抽取正文纯文本 / 把内嵌 base64 图片与「HTML + 图片文件夹」的外部相对图片
// 落盘到 server/uploads/knowledge/<id>/，并把 HTML 中的 src 改写为 /uploads 绝对路径。
import fs from 'node:fs/promises'
import path from 'node:path'

// mime 子类型 → 落盘扩展名
const EXT_BY_MIME = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp', 'svg+xml': 'svg' }
// 允许落盘的内嵌图片 data URL
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,([\s\S]+)$/i

// 安全 decodeURIComponent（畸形 URI 不抛错）
function safeDecode(value) {
  try { return decodeURIComponent(String(value)) } catch { return String(value) }
}

// 解码常用 HTML 实体（&amp; 放最后，避免二次解码）
export function decodeEntities(text) {
  if (!text) return ''
  return String(text)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
}

// 归一化标题文本（去标签 / 压空白 / 截断 255）
function cleanTitle(text) {
  return String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255)
}

// 抽取标题：优先 <title>，其次第一个 <h1>
export function extractTitle(html) {
  const source = String(html || '')
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (title && title[1].trim()) return cleanTitle(decodeEntities(title[1]))
  const h1 = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1 && h1[1].trim()) return cleanTitle(decodeEntities(h1[1]))
  return ''
}

// 抽取正文纯文本：剥 script/style，块级标签转换行，解码实体，压缩连续空行
export function htmlToText(html) {
  let text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<title[\s\S]*?<\/title>/gi, ' ')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  text = decodeEntities(text)
  text = text.split('\n').map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

// 读取标签属性值（src="..." 或 src='...'）
function getAttr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))
  return match ? match[2] : ''
}

// 改写标签属性值（存在则替换，缺失则插入）
function setAttr(tag, name, value) {
  const re = new RegExp(`(\\b${name}\\s*=\\s*)(["'])[\\s\\S]*?\\2`, 'i')
  if (re.test(tag)) return tag.replace(re, `$1$2${value}$2`)
  return tag.replace(/<img\b/i, `<img ${name}="${value}"`)
}

// 取路径文件名
function baseName(p) {
  return String(p || '').split(/[\\/]/).pop() || ''
}

// 解析 data URL → { mime, data }，非图片 data URL 返回 null
function parseDataUrl(value) {
  const match = DATA_URL_RE.exec(String(value || '').trim())
  if (!match) return null
  return { mime: match[1].toLowerCase(), data: match[2].replace(/\s+/g, '') }
}

// 判断一个 img 的 src 是否需要落盘；需要则返回其 dataURL，否则 null
// - data: 开头 → 自身即可落盘
// - http(s):// 或 // 开头 → 绝对 URL，保持不动
// - 相对路径 → 在传入的 images 里按文件名匹配「HTML + 图片文件夹」场景
function resolveDataUrl(src, images) {
  const value = String(src || '').trim()
  if (!value) return null
  if (/^data:/i.test(value)) return value
  if (/^(https?:)?\/\//i.test(value)) return null
  if (!Array.isArray(images) || !images.length) return null
  const decoded = safeDecode(value)
  const target = baseName(decoded)
  const hit = images.find(img => {
    const name = safeDecode(String(img && img.name ? img.name : ''))
    return name && img.dataUrl && (baseName(name) === target || name === decoded)
  })
  return hit ? String(hit.dataUrl) : null
}

// 把 HTML 中需要落盘的图片写出到 dir，并改写 src 为 `${urlBase}/${id}/${name}`；返回改写后的 HTML
export async function persistImages(html, { dir, id, urlBase, images }) {
  const source = String(html || '')
  const tags = []
  const re = /<img\b[^>]*>/gi
  let match
  while ((match = re.exec(source))) tags.push({ start: match.index, end: match.index + match[0].length, tag: match[0] })
  if (!tags.length) return source
  let counter = 0
  let dirReady = false
  const pieces = []
  let cursor = 0
  for (const item of tags) {
    const src = getAttr(item.tag, 'src')
    if (!src) continue
    const parsed = parseDataUrl(resolveDataUrl(src, images) || '')
    if (!parsed) continue
    counter += 1
    const ext = EXT_BY_MIME[parsed.mime] || 'png'
    const name = `img-${counter}.${ext}`
    if (!dirReady) { await fs.mkdir(dir, { recursive: true }); dirReady = true }
    await fs.writeFile(path.join(dir, name), Buffer.from(parsed.data, 'base64'))
    pieces.push(source.slice(cursor, item.start), setAttr(item.tag, 'src', `${urlBase}/${id}/${name}`))
    cursor = item.end
  }
  pieces.push(source.slice(cursor))
  return pieces.join('')
}

// 主入口：解析 HTML 报告，返回 { title, text, rewrittenHtml }
export async function importHtml({ html = '', id, images = [], uploadsRoot }) {
  const source = String(html || '')
  const title = extractTitle(source)
  const text = htmlToText(source)
  const dir = path.join(uploadsRoot, 'knowledge', id)
  const rewrittenHtml = await persistImages(source, { dir, id, urlBase: '/uploads/knowledge', images: Array.isArray(images) ? images : [] })
  return { title, text, rewrittenHtml }
}
