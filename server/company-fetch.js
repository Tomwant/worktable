// 好公司模块的数据抓取层
// 财报：SEC EDGAR 官方 XBRL（10-K / 20-F 原文），行情：东方财富美股接口
// 两个来源都是公开接口，不依赖任何付费 key

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.join(__dirname, 'cache')
const TICKER_CACHE = path.join(CACHE_DIR, 'sec-tickers.json')

// SEC 明确要求 UA 里带联系方式，否则直接 403
const SEC_UA = 'Research Workbench research@example.com'
// 东方财富要浏览器的 UA
const EM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const TICKER_TTL = 24 * 3600 * 1000    // 代码映射表一天刷一次
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function getJson(url, { ua = SEC_UA, timeout = 60000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': ua, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      signal: ctrl.signal
    })
    if (!r.ok) throw new Error(`HTTP ${r.status} ← ${url}`)
    const text = await r.text()
    try {
      return JSON.parse(text)
    } catch {
      // SEC 被限流时返回的是 HTML 页面，不是 JSON
      if (text.includes('Request Rate Threshold Exceeded')) throw new Error('SEC 接口限流，请稍等十几秒再试')
      throw new Error('返回的不是 JSON，可能被限流或接口变更')
    }
  } finally {
    clearTimeout(timer)
  }
}

// ---------- 代码 → SEC CIK ----------

let tickerMap = null

export async function loadTickerMap(force = false) {
  if (!force && tickerMap) return tickerMap
  if (!force && fs.existsSync(TICKER_CACHE)) {
    const age = Date.now() - fs.statSync(TICKER_CACHE).mtimeMs
    if (age < TICKER_TTL) {
      try {
        tickerMap = JSON.parse(fs.readFileSync(TICKER_CACHE, 'utf8'))
        return tickerMap
      } catch { /* 缓存坏了就重下 */ }
    }
  }
  const raw = await getJson('https://www.sec.gov/files/company_tickers.json')
  const map = {}
  for (const row of Object.values(raw)) {
    if (!row || !row.ticker) continue
    map[String(row.ticker).toUpperCase()] = { cik: String(row.cik_str).padStart(10, '0'), name: row.title }
  }
  tickerMap = map
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(TICKER_CACHE, JSON.stringify(map))
  } catch { /* 缓存写不进去不影响使用 */ }
  return map
}

// 用户会输 googl / brk.b / brk-b，都要能认
function normTicker(input) {
  return String(input || '').trim().toUpperCase().replace(/\./g, '-')
}

export async function resolveTicker(input) {
  const original = String(input || '').trim()
  const t = normTicker(original)
  if (!t) throw new Error('请填股票代码')
  // 报错要回显用户原本输的东西，不然 0700.HK 变成 0700-HK 会让人以为自己输错了
  if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(t)) throw new Error(`「${original}」不像美股代码。只支持美股，填字母代码即可，例如 AAPL、TSLA、BRK-B`)
  const map = await loadTickerMap()
  const hit = map[t] || map[t.replace(/-/g, '.')]
  if (!hit) throw new Error(`SEC 里找不到「${t}」。只支持美股上市的公司（输代码不用带 $），港股和 A 股不在这个源里`)
  return { ticker: t, cik: hit.cik, nameEn: hit.name }
}

// ---------- SEC 财报 ----------

const REVENUE_TAGS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'RevenuesNetOfInterestExpense'
]

// r.fy 是「这份年报属于哪年」，同一年报里带前两年对比数。
// 所以归年必须用 r.end 的年份，否则三年数据会覆盖成一年。
function collect(gaap, tags, unit, flow) {
  const byYear = new Map()
  for (const tag of tags) {
    const node = gaap[tag]
    if (!node || !node.units || !node.units[unit]) continue
    for (const r of node.units[unit]) {
      // 20-F 是外国公司（台积电、阿斯麦这类）的年报，不能只认 10-K
      if (r.form !== '10-K' && r.form !== '20-F') continue
      if (r.end == null) continue
      // 流量指标（营收、利润、现金流）有起止日；资产负债表是时点值，只有 end 没有 start
      if (flow) {
        if (r.start == null) continue
        const days = (new Date(r.end) - new Date(r.start)) / 86400000
        if (!(days > 330 && days < 400)) continue   // 只要整年，滤掉季度累计
      }
      const year = Number(String(r.end).slice(0, 4))
      if (!year || year < 1990) continue
      const cur = byYear.get(year)
      // 同一财年多份申报（原始 + 更正），取最近一次申报的
      if (!cur || String(r.filed || '') > String(cur.filed || '')) byYear.set(year, r)
    }
  }
  return byYear
}

const mergeMaps = (...maps) => {
  const out = {}
  for (const m of maps) for (const [k, r] of m) out[k] = r.val
  return out
}

export function parseFinancials(raw, years = 11) {
  const gaap = (raw && raw.facts && raw.facts['us-gaap']) || {}
  const g = (tags, unit = 'USD', flow = true) => mergeMaps(collect(gaap, tags, unit, flow))

  const revenue = mergeMaps(...REVENUE_TAGS.map(t => collect(gaap, [t], 'USD', true)))
  if (!Object.keys(revenue).length) return []

  const gross = g(['GrossProfit'])
  // 谷歌、伯克希尔这类不在 XBRL 里单独披露 GrossProfit，
  // 有营业成本的就用「营收 − 营业成本」反推，两个都没有就让毛利率留空（数据本身没有，不编）
  const costRevenue = g(['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'])
  const opIncome = g(['OperatingIncomeLoss'])
  const netIncome = g(['NetIncomeLoss'])
  const ocf = g(['NetCashProvidedByUsedInOperatingActivities',
                 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'])
  const capex = g(['PaymentsToAcquirePropertyPlantAndEquipment',
                   'PaymentsToAcquireProductiveAssets',
                   'PaymentsToAcquireOtherPropertyPlantAndEquipment'])
  const eps = g(['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'], 'USD/shares')
  const assets = g(['Assets'], 'USD', false)
  const liabilities = g(['Liabilities'], 'USD', false)
  const equity = g(['StockholdersEquity',
                    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], 'USD', false)
  const cash = g(['CashAndCashEquivalentsAtCarryingValue',
                  'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'], 'USD', false)
  const debt = mergeMaps(
    collect(gaap, ['LongTermDebtNoncurrent', 'LongTermDebt'], 'USD', false),
    collect(gaap, ['LongTermDebtCurrent'], 'USD', false)
  )
  const inventory = g(['InventoryNet'], 'USD', false)
  const receivable = g(['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'], 'USD', false)
  const shares = g(['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'], 'shares', false)

  const M = n => (n == null || !Number.isFinite(n)) ? null : Math.round(n / 1e6)
  const pct = (a, b) => (a != null && b) ? +(a / b * 100).toFixed(1) : null

  const fys = Object.keys(revenue).map(Number).sort((a, b) => a - b).slice(-years)
  return fys.map(fy => {
    const rev = revenue[fy]
    const ni = netIncome[fy]
    const gp = gross[fy] != null
      ? gross[fy]
      : (costRevenue[fy] != null && rev != null ? rev - costRevenue[fy] : null)
    const eq = equity[fy]
    const ta = assets[fy]
    const tl = liabilities[fy]
    const cf = ocf[fy]
    const cx = capex[fy]
    return {
      fy,
      revenue: M(rev),
      gross: M(gp),
      opIncome: M(opIncome[fy]),
      netIncome: M(ni),
      ocf: M(cf),
      capex: M(cx),
      fcf: (cf != null && cx != null) ? M(cf - cx) : null,
      eps: eps[fy] != null ? +Number(eps[fy]).toFixed(2) : null,
      assets: M(ta),
      liabilities: M(tl),
      equity: M(eq),
      cash: M(cash[fy]),
      debt: M(debt[fy]),
      inventory: M(inventory[fy]),
      receivable: M(receivable[fy]),
      shares: shares[fy] != null ? Math.round(shares[fy] / 1e6) : null,
      grossMargin: pct(gp, rev),
      netMargin: pct(ni, rev),
      roe: pct(ni, eq),
      debtRatio: pct(tl, ta)
    }
  })
}

// ---------- 东方财富行情 ----------

// 美股三个市场的前缀，挨个试，哪个有名字就是哪个
const EXCHANGE_PREFIX = ['105', '106', '107']
const EXCHANGE_NAME = { '105': 'NASDAQ', '106': 'NYSE', '107': 'AMEX' }

// 东方财富的 secid 用代码本身，不认 BRK-B 这种带横杠的写法（要写成 BRK_B 或 BRK-B 试）
function secidCandidates(ticker) {
  const forms = [ticker, ticker.replace(/-/g, '_'), ticker.replace(/-/g, '.')]
  const out = []
  for (const pre of EXCHANGE_PREFIX) for (const f of [...new Set(forms)]) out.push(`${pre}.${f}`)
  return out
}

export async function fetchQuote(ticker) {
  for (const secid of secidCandidates(ticker)) {
    let j
    try {
      j = await getJson(
        `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}` +
        '&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f162,f167,f168,f169,f170,f171',
        { ua: EM_UA, timeout: 15000 }
      )
    } catch {
      continue
    }
    const d = j && j.data
    if (!d || !d.f58) continue      // 没名字就是没这家，换下一个前缀
    const div = (v, k) => (v == null || v === '-' ? null : +(v / k).toFixed(2))
    // 东财对美股经常把 PE 给成 0 或负数，这种当没有，交给调用方用「市值/净利」兜底
    const posNum = (v, k) => {
      if (v == null || v === '-' || v === '') return null
      const n = +(v / k).toFixed(2)
      return n > 0 ? n : null
    }
    return {
      secid,
      exchange: EXCHANGE_NAME[secid.split('.')[0]] || '',
      nameCn: d.f58,
      price: div(d.f43, 1000),
      chgPct: div(d.f170, 100),
      high: div(d.f44, 1000),
      low: div(d.f45, 1000),
      open: div(d.f46, 1000),
      prevClose: div(d.f60, 1000),
      capYi: div(d.f116, 1e8),        // 市值（亿）
      pe: posNum(d.f162, 100),
      pb: posNum(d.f167, 100),
      turnover: div(d.f168, 100),
      quoteTime: Date.now()
    }
  }
  throw new Error(`东方财富查不到「${ticker}」的行情，代码可能不在美股三个市场里`)
}

export async function fetchMonthlyKline(secid, years = 5) {
  const beg = `${new Date().getFullYear() - years}0101`
  const j = await getJson(
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1` +
    `&beg=${beg}&end=20500101&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56,f57`,
    { ua: EM_UA, timeout: 20000 }
  )
  const lines = (j && j.data && j.data.klines) || []
  const byMonth = new Map()
  for (const line of lines) {
    const [d, , close] = String(line).split(',')
    // 同一个月后来的覆盖前面的 → 最后一条就是月末收盘
    byMonth.set(d.slice(0, 7), { d, close: +close })
  }
  return [...byMonth.values()]
}

// ---------- 公司档案（来自 SEC submissions） ----------
// companyfacts 里只有数字，没有「这家公司是干什么的、注册在哪、年报原文在哪」。
// submissions 接口补这一块：SIC 行业、注册地、财年截止、公司规模档位、地址电话、最近一份年报原文直链。
// 注意：SEC 的 website 字段绝大多数是空的（特斯拉也是空），官网只能人工填一次。

function fmtFiscalEnd(mmdd) {
  const s = String(mmdd || '')
  if (!/^\d{4}$/.test(s)) return ''
  return `${s.slice(0, 2)}-${s.slice(2, 4)}`
}

export async function fetchCompanyProfile(cik, ticker) {
  const sub = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`)
  const recent = (sub.filings && sub.filings.recent) || { form: [], filingDate: [], accessionNumber: [], primaryDocument: [] }
  const cikNum = Number(String(cik).replace(/^0+/, '')) || String(cik)

  // 年报：美国公司 10-K，外国公司 20-F。取最近一份。
  let annual = null
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i]
    if (form !== '10-K' && form !== '20-F') continue
    const acc = String(recent.accessionNumber[i] || '').replace(/-/g, '')
    if (!acc) continue
    const doc = recent.primaryDocument[i]
    annual = {
      form,
      date: recent.filingDate[i] || '',
      url: doc
        ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${doc}`
        : `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/`
    }
    break
  }

  const addr = (sub.addresses && sub.addresses.business) || (sub.addresses && sub.addresses.mailing) || {}
  const city = [addr.city, addr.stateOrCountry].filter(Boolean).join(', ')

  return {
    sic: sub.sic || '',
    sicDesc: sub.sicDescription || '',
    stateOfIncorporation: sub.stateOfIncorporation || '',
    fiscalYearEnd: fmtFiscalEnd(sub.fiscalYearEnd),
    category: sub.category || '',
    entityType: sub.entityType || '',
    phone: sub.phone || '',
    address: [addr.street1, city, addr.zipCode].filter(Boolean).join(' · '),
    website: '',                       // SEC 不给，由人工填一次，之后一直保留
    filingsUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`,
    annualUrl: annual ? annual.url : '',
    annualForm: annual ? annual.form : '',
    annualDate: annual ? annual.date : '',
    emUrl: `https://quote.eastmoney.com/us/${String(ticker || '').replace(/-/g, '.')}.html`,
    links: []                          // 用户自己加的链接：[{label, url}]
  }
}

// ---------- 组装一家完整公司 ----------

export async function buildCompany(input) {
  const { ticker, cik, nameEn } = await resolveTicker(input)

  const [facts, quote] = await Promise.all([
    getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`),
    fetchQuote(ticker)
  ])

  // 公司档案拉不到不影响主流程（财报才是主角）
  await sleep(120)
  const info = await fetchCompanyProfile(cik, ticker).catch(() => null)

  // SEC 建议每秒不超过 10 个请求，这里串行再拉一次日线
  await sleep(200)
  const kline = await fetchMonthlyKline(quote.secid).catch(() => [])

  const fin = parseFinancials(facts)
  const last = fin[fin.length - 1] || null

  // 东财不给美股 PE/PB 时自己算：市值单位是「亿」，净利/权益单位是「百万」
  // 亿 × 100 ÷ 百万 = 倍数
  const peFallback = (last && last.netIncome > 0 && quote.capYi > 0)
    ? +(quote.capYi * 100 / last.netIncome).toFixed(1) : null
  const pbFallback = (last && last.equity > 0 && quote.capYi > 0)
    ? +(quote.capYi * 100 / last.equity).toFixed(1) : null

  return {
    ticker,
    nameCn: quote.nameCn || '',
    nameEn: nameEn || (facts.entityName || ''),
    cik,
    secid: quote.secid,
    exchange: quote.exchange,
    sector: (info && info.sicDesc) || '',
    biz: '',
    segments: [],
    history: [],
    notes: { moat: '', mgmt: '', space: '', quality: '', risk: '', price: '', verdict: '待研究' },
    info: info || null,
    memo: [],
    quote: {
      price: quote.price,
      chgPct: quote.chgPct,
      high: quote.high,
      low: quote.low,
      capYi: quote.capYi,
      pe: quote.pe != null ? quote.pe : peFallback,
      pb: quote.pb != null ? quote.pb : pbFallback,
      quoteTime: quote.quoteTime
    },
    fin,
    kline,
    latestFy: last ? last.fy : null,
    fetchedAt: Date.now()
  }
}
export async function refreshQuoteOnly(ticker, secid) {
  const quote = await fetchQuote(ticker)
  let kline = null
  try {
    kline = await fetchMonthlyKline(quote.secid)
  } catch { /* 日线拉不到不影响今天的价 */ }
  return { quote, kline, secid: quote.secid || secid }
}

export { normTicker }
