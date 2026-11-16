// 正文断段：知识库正文是后端抽出的纯文本（无换行），直接一大坨渲染读起来很累。
// 按「章节 emoji / 句末标点 + 长度阈值」断段，纯展示，一个字都不改。
// 知识库页的全文大窗和首页「今日已读」的阅读窗共用这一份，避免两处逻辑跑偏。
const FENCE = '。！？!?'
const isEmoji = ch => { const c = ch.codePointAt(0); return (c >= 0x1F300 && c <= 0x1FAFF) || (c >= 0x2600 && c <= 0x27BF) }

export function splitBody(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!s) return []
  const out = []
  let buf = ''
  for (const ch of s) {
    if (isEmoji(ch) && buf.trim().length >= 30) { out.push(buf.trim()); buf = '' }
    buf += ch
    if (FENCE.includes(ch) && buf.length >= 200) { out.push(buf.trim()); buf = '' }
    else if (buf.length >= 420) { out.push(buf.trim()); buf = '' }
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}
