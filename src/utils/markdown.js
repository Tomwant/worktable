// 轻量 Markdown 渲染：只覆盖定时任务会产出的语法（标题/粗体/列表/表格/引用/代码/链接）
// 不引第三方依赖，输出始终先转义再拼标签，避免 HTML 注入

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
}

const isList = line => /^\s*([-*+]|\d+[.)])\s+/.test(line)
const isHeading = line => /^\s*#{1,6}\s+/.test(line)
const isQuote = line => /^\s*>\s?/.test(line)
const isFence = line => /^\s*```/.test(line)
const isTable = line => /^\s*\|/.test(line)
const isHr = line => /^\s*([-*_])\1{2,}\s*$/.test(line)

export function renderMarkdown(src = '') {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (isFence(line)) {
      i++
      const buf = []
      while (i < lines.length && !isFence(lines[i])) { buf.push(lines[i]); i++ }
      i++
      out.push(`<pre class="md-pre"><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }

    if (!line.trim()) { i++; continue }

    if (isHr(line)) { out.push('<hr class="md-hr">'); i++; continue }

    const head = line.match(/^\s*(#{1,6})\s+(.*)$/)
    if (head) {
      const lv = Math.min(head[1].length + 1, 6)
      out.push(`<h${lv} class="md-h">${inline(head[2])}</h${lv}>`)
      i++
      continue
    }

    if (isTable(line) && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1] || '')) {
      const head2 = splitRow(line)
      i += 2
      const rows = []
      while (i < lines.length && isTable(lines[i])) { rows.push(splitRow(lines[i])); i++ }
      out.push(
        `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head2.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      )
      continue
    }

    if (isQuote(line)) {
      const buf = []
      while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      out.push(`<blockquote class="md-quote">${renderMarkdown(buf.join('\n'))}</blockquote>`)
      continue
    }

    if (isList(line)) {
      const ordered = /^\s*\d/.test(line)
      const items = []
      while (i < lines.length && isList(lines[i])) {
        let text = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')
        i++
        // 列表项的续行（缩进的普通文本）
        while (i < lines.length && lines[i].trim() && !isList(lines[i]) && !isHeading(lines[i]) && !isQuote(lines[i]) && !isFence(lines[i]) && !isTable(lines[i])) {
          text += ' ' + lines[i].trim()
          i++
        }
        items.push(text)
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag} class="md-list">${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`)
      continue
    }

    // 段落：吃到空行或下一个块级标记
    const buf = []
    while (i < lines.length && lines[i].trim() && !isList(lines[i]) && !isHeading(lines[i]) && !isQuote(lines[i]) && !isFence(lines[i]) && !isHr(lines[i]) && !isTable(lines[i])) {
      buf.push(lines[i])
      i++
    }
    if (!buf.length) { buf.push(lines[i]); i++ }   // 兜底，保证前进
    out.push(`<p class="md-p">${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`)
  }

  return out.join('\n')
}

// 判断一段内容是不是完整 HTML 文档/片段（定时任务若直接产出 HTML 就用 iframe 渲染）
export function looksLikeHtml(src = '') {
  const s = String(src).trim()
  if (!s.startsWith('<')) return false
  return /<\/[a-z][a-z0-9]*>/i.test(s) && /<(html|body|div|section|article|table|style|h[1-6]|p|ul|ol|canvas|svg)\b/i.test(s)
}

// 卡片上的纯文本摘要：去掉 Markdown 记号，压成一行
export function plainSummary(src = '', max = 150) {
  const s = String(src)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')   // HTML 内容的样式/脚本不参与摘要
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}
