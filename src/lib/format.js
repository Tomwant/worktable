// 全站数字 / 金额 / 百分比格式化。全是纯函数，无副作用、不读全局状态，可直接单测。
//
// 搬家来源（原来各写各的，同名不同义最容易出事故）：
//   · CompanyView.vue  —— money / pctTxt / num / capTxt / sign / chgClass / priceTxt（财报口径，单位是「百万美元」）
//   · stores/index.js  —— fmt（人民币，带 ¥）
// 两者单位体系完全不同，所以保留两个名字：money() 给财报，fmtMoney() 给人民币，不合并。

/** 财报金额：入参单位是「百万美元」 */
export const money = m => {
  if (m == null || !Number.isFinite(m)) return '—'
  if (m === 0) return '0'
  const a = Math.abs(m)
  if (a >= 1e6) return (m / 1e6).toFixed(2) + '万亿'
  if (a >= 100) return (m / 100).toFixed(0) + '亿'
  return m.toFixed(0) + '百万'
}

/** 人民币金额，带 ¥ 与千分位（对外沿用旧名 fmt，资金管理页在用） */
export const fmt = n => '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
/** 同 fmt 的语义别名：报表里看到 money 容易和财报的 money() 混淆，写新代码建议用这个 */
export const fmtMoney = fmt

/** 市值：入参单位「亿」，超过一万亿换成万亿 */
export const capTxt = (v, unit = '亿') => {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 10000) return (v / 10000).toFixed(2) + '万亿'
  return v.toFixed(0) + unit
}

/** 百分比，带正负号 */
export const sign = v => (v == null || !Number.isFinite(v)) ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'

/** 百分比，不带符号 */
export const pctTxt = v => (v == null || !Number.isFinite(v)) ? '—' : v.toFixed(1) + '%'

/** 固定小数位，缺值给「—」 */
export const num = (v, d = 1) => (v == null || !Number.isFinite(v)) ? '—' : v.toFixed(d)

/** 涨跌色类：涨红跌绿（A 股／国内习惯） */
export const chgClass = v => v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat'

/** 美元单价 */
export const priceTxt = v => (v == null || !Number.isFinite(v)) ? '—' : '$' + v.toFixed(2)

/** 时间戳 → 「YYYY-MM-DD HH:mm」；非法值给「—」 */
export const fmtAt = ts => {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 「YYYY-MM-DD」→ 「10月27日 周二」 */
export const dateLabel = d => {
  if (!d) return '—'
  const t = new Date(`${d}T00:00:00`)
  if (Number.isNaN(t.getTime())) return String(d)
  return t.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
}

/** 相对时间：今天／昨天／N 天前 */
export const relDay = d => {
  if (!d) return '—'
  const t = new Date(`${d}T00:00:00`)
  if (Number.isNaN(t.getTime())) return String(d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today - t) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff > 1) return `${diff} 天前`
  return `${-diff} 天后`
}

/** 字节数 → KB/MB */
export const bytes = n => {
  if (!n || n < 1024) return (n || 0) + ' B'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1048576).toFixed(1) + ' MB'
}
