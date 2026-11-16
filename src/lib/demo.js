// 演示版（GitHub Pages 静态部署）的数据适配层。
//
// 为什么需要它：正式版前端全靠 /api/* 跟 Express + MySQL 打交道，
// 而 GitHub Pages 只发静态文件，没有 Node、没有数据库。
//
// 做法：构建时把真库数据抓成 public/demo/bundle.json（见 scripts/export-demo.mjs），
// 这里在 api() 出口处拦下所有请求，用内存 + localStorage 顶替后端。
//
// 三个关键取舍：
//  1) 读：知识库的「按系列分期」排序依赖 MySQL 的 SUBSTRING_INDEX，前端复刻不了，
//     所以快照里已经是后端排好的顺序，series 模式直接沿用；
//     date_asc / date_desc 和关键词/来源/标签/日期筛选在内存里现算。
//  2) 写：绝大多数操作是「前端先改 reactive db，再发请求」，
//     所以写接口只要正常返回，界面自己就变了。列表型模块（想法/时间线/发现）额外补内存态。
//  3) 持久：主状态沿用正式版那套 localStorage（pushSync 已经先写盘再发请求），
//     其余模块存 swb-demo-side-v1，刷新后还在，清缓存即还原成快照。

export const DEMO = import.meta.env.VITE_DEMO === '1'

const SIDE_KEY = 'swb-demo-side-v1'
const BUNDLE_URL = `${import.meta.env.BASE_URL}demo/bundle.json`

let bundle = null
let loading = null
let side = null

const parse = raw => { try { return JSON.parse(raw) } catch { return null } }
const saveSide = () => { try { localStorage.setItem(SIDE_KEY, JSON.stringify(side)) } catch { /* 配额满/隐私模式忽略 */ } }
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** 统一错误：与 lib/api.js 的 ApiError 同形，调用方 catch 到的行为一致 */
const fail = (message, status = 400) => {
  const e = new Error(message)
  e.name = 'ApiError'
  e.status = status
  e.detail = null
  return e
}

async function loadBundle() {
  if (bundle) return bundle
  if (loading) return loading
  loading = fetch(BUNDLE_URL)
    .then(r => {
      if (!r.ok) throw fail(`演示数据读取失败（${r.status}）`, r.status)
      return r.json()
    })
    .then(j => {
      bundle = j
      const saved = parse(localStorage.getItem(SIDE_KEY))
      // 注意：ideas / aiEvents 接口返回的是 {items:[...]} 外壳，这里只取 items 本体，
      // 否则 loader 拿到的是「对象套对象」，Array.isArray 判定失败 → 列表恒为空
      side = saved || {
        ideas: (j.ideas && j.ideas.items) || [],
        aiEvents: (j.aiEvents && j.aiEvents.items) || [],
        discovers: j.discovers,
        transactions: j.transactions,
        evalRuns: j.evalRuns
      }
      return bundle
    })
  return loading
}

// ===== 知识库：在快照上做筛选 / 排序 / 分页 =====

const kbAll = () => (bundle.knowledge || [])

const matchKb = (it, p) => {
  if (p.keyword) {
    const kw = p.keyword.toLowerCase()
    const hay = `${it.title || ''} ${it.sourceLabel || ''} ${it.content || ''}`.toLowerCase()
    if (!hay.includes(kw)) return false
  }
  if (p.source && it.sourceLabel !== p.source) return false
  if (p.tag) {
    let tags = it.tags
    if (typeof tags === 'string') tags = parse(tags) || []
    if (!Array.isArray(tags) || !tags.includes(p.tag)) return false
  }
  const d = it.originDate || ''
  if (p.start && d && d < p.start) return false
  if (p.end && d && d > p.end) return false
  return true
}

const facetsOf = items => {
  const src = new Set()
  const tag = new Set()
  for (const it of items) {
    if (it.sourceLabel) src.add(it.sourceLabel)
    let tags = it.tags
    if (typeof tags === 'string') tags = parse(tags) || []
    if (Array.isArray(tags)) tags.forEach(t => t && tag.add(t))
  }
  return { sources: [...src].sort(), tags: [...tag].sort() }
}

const knowledgePage = params => {
  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = Math.max(1, Number(params.get('pageSize')) || 12)
  const sort = params.get('sort') || 'series'
  // 注意：后端只接受这三个值，非法值一律退回 series
  const safeSort = ['series', 'date_asc', 'date_desc'].includes(sort) ? sort : 'series'

  const q = {
    keyword: params.get('keyword') || '',
    source: params.get('source') || '',
    tag: params.get('tag') || '',
    start: params.get('start') || '',
    end: params.get('end') || ''
  }

  const all = kbAll()
  let list = all.filter(it => matchKb(it, q))

  // series 已在导出时由后端排好，这里不动；日期排序在内存里做
  if (safeSort === 'date_desc') list = [...list].sort((a, b) => String(b.originDate || '').localeCompare(String(a.originDate || '')))
  if (safeSort === 'date_asc') list = [...list].sort((a, b) => String(a.originDate || '').localeCompare(String(b.originDate || '')))

  const total = list.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(page, totalPages)
  const items = list.slice((p - 1) * pageSize, p * pageSize)

  return {
    items,
    total,
    totalAll: all.length,
    page: p,
    pageSize,
    totalPages,
    sort: safeSort,
    facets: facetsOf(all)
  }
}

// ===== 路由分发 =====

const readRoute = path => {
  const [p, qs] = path.split('?')
  const params = new URLSearchParams(qs || '')
  const seg = p.replace(/^\/api\/?/, '').replace(/\/$/, '').split('/')
  return { p, params, seg }
}

/** GET 处理 */
function handleGet(path) {
  const { p, params, seg } = readRoute(path)
  const [a, b] = seg

  if (p === '/api/state') return bundle.state
  if (a === 'transactions' && !b) return side.transactions
  if (a === 'finance') return bundle.finance
  if (a === 'discovers' && !b) return side.discovers
  if (a === 'discovers' && b) return side.discovers.find(x => String(x.id) === b) || null
  if (a === 'ideas' && !b) return { items: side.ideas }
  if (a === 'assets') return bundle.assets
  if (a === 'app-config') return bundle.appConfig
  if (a === 'ai-events') return { items: side.aiEvents, baseline: bundle.aiEvents.baseline || [] }

  if (a === 'eval') {
    if (b === 'overview') return bundle.evalOverview
    if (b === 'runs' && seg.length === 2) return side.evalRuns
    if (b === 'products' && seg.length === 2) return bundle.evalOverview.products || []
    if (b === 'tasks' && seg.length === 2) return bundle.evalOverview.tasks || []
  }

  if (a === 'companies') {
    if (!b) return { items: bundle.companies }
    const ticker = decodeURIComponent(b)
    const item = bundle.companyDetails[ticker]
    if (!item) throw fail(`演示数据里没有 ${ticker}`, 404)
    return { item }
  }

  if (a === 'knowledge') {
    if (!b) return knowledgePage(params)
    if (b === 'feeds-status') return bundle.feedsStatus
    if (b === 'sync-progress') return { running: false, done: true, total: 0, imported: 0,
      feeds: (bundle.feedsStatus && bundle.feedsStatus.feeds) || [] }
    const id = decodeURIComponent(b)
    const item = kbAll().find(x => String(x.id) === id)
    if (!item) throw fail('没有这条记录', 404)
    return item
  }

  // 未覆盖的读接口：给空对象，别让整页崩掉
  return {}
}

/** 写处理：只维护列表型模块的内存态，其余一律当成功 */
function handleWrite(path, method, body) {
  const { seg } = readRoute(path)
  const [a, b, c] = seg
  const payload = (body && typeof body === 'object') ? body : {}

  if (method === 'DELETE' && a === 'state') {
    // 重置演示数据：主状态由调用方清 localStorage，这边把侧数据一起还原
    try { localStorage.removeItem(SIDE_KEY) } catch { /* 忽略 */ }
    side = {
      ideas: (bundle.ideas && bundle.ideas.items) || [],
      aiEvents: (bundle.aiEvents && bundle.aiEvents.items) || [],
      discovers: bundle.discovers,
      transactions: bundle.transactions,
      evalRuns: bundle.evalRuns
    }
    return { ok: true }
  }

  if (a === 'ideas') {
    if (method === 'POST') {
      const item = { ...payload, id: payload.id || uid() }
      side.ideas.unshift(item)
      saveSide()
      return { item }
    }
    if (method === 'PUT' && b) {
      const i = side.ideas.findIndex(x => String(x.id) === b)
      if (i >= 0) side.ideas[i] = { ...side.ideas[i], ...payload }
      saveSide()
      return { item: side.ideas[i] }
    }
    if (method === 'DELETE' && b) {
      const i = side.ideas.findIndex(x => String(x.id) === b)
      if (i >= 0) side.ideas.splice(i, 1)
      saveSide()
      return { ok: true }
    }
  }

  if (a === 'ai-events') {
    if (method === 'POST') {
      const item = { ...payload, id: payload.id || uid() }
      side.aiEvents.unshift(item)
      saveSide()
      return { item }
    }
    if (method === 'PUT' && b) {
      const i = side.aiEvents.findIndex(x => String(x.id) === b)
      if (i >= 0) side.aiEvents[i] = { ...side.aiEvents[i], ...payload }
      saveSide()
      return { item: side.aiEvents[i] }
    }
    if (method === 'DELETE' && b) {
      const i = side.aiEvents.findIndex(x => String(x.id) === b)
      if (i >= 0) side.aiEvents.splice(i, 1)
      saveSide()
      return { ok: true }
    }
  }

  if (a === 'discovers') {
    if (method === 'POST') {
      const item = { ...payload, id: payload.id || uid() }
      side.discovers.unshift(item)
      saveSide()
      return { item }
    }
    if (method === 'DELETE' && b) {
      const i = side.discovers.findIndex(x => String(x.id) === b)
      if (i >= 0) side.discovers.splice(i, 1)
      saveSide()
      return { ok: true }
    }
  }

  if (a === 'transactions') {
    if (method === 'POST') {
      const item = { ...payload, id: payload.id || uid() }
      side.transactions.unshift(item)
      saveSide()
      return { item }
    }
    if (method === 'DELETE' && b) {
      const i = side.transactions.findIndex(x => String(x.id) === b)
      if (i >= 0) side.transactions.splice(i, 1)
      saveSide()
      return { ok: true }
    }
  }

  if (a === 'eval' && b === 'runs') {
    if (method === 'POST') {
      const item = { ...payload, id: payload.id || uid() }
      side.evalRuns.items = [item, ...(side.evalRuns.items || [])]
      saveSide()
      return { item }
    }
  }

  // 知识库导入要读本地文件、后端落盘，静态站做不到 —— 明确拒绝，别让用户以为成功了
  if (a === 'knowledge' && b === 'import') {
    throw fail('演示版不支持导入报告，这份功能要在本地版使用', 501)
  }

  // 知识库同步：本地扫盘 + 入库，演示版没有可扫的目录，返回「无可同步」而不是报错
  if (a === 'knowledge' && b === 'sync') {
    return { ok: true, started: false, running: false, imported: 0, feeds: [] }
  }

  // 知识打卡：正式版返回当天完整 items 覆盖本地，演示版原样回传即可
  if (a === 'checkins' && b === 'knowledge') {
    return { ok: true, items: Array.isArray(payload.items) ? payload.items : [] }
  }

  // 其余写操作（全量 state、资金、配置、素材、公司刷新、评测增删改等）：
  // 前端已经自行更新了界面，这里只需给出成功响应
  return { ok: true, item: { ...payload, id: payload.id || uid() } }
}

/**
 * 演示版请求出口，签名与 lib/api.js 的 api() 完全一致
 * @returns {Promise<any>}
 */
export async function demoApi(path, { method = 'GET', body } = {}) {
  await loadBundle()

  let payload = body
  if (typeof payload === 'string') payload = parse(payload) || {}

  // 模拟极短网络延迟，避免界面出现「瞬间跳变」的突兀感
  await new Promise(r => setTimeout(r, 30))

  if (method === 'GET') return handleGet(path)
  return handleWrite(path, method, payload)
}

/** 供 initApi 用：演示版的初始 state（本地有改动就用本地的） */
export async function demoState() {
  await loadBundle()
  return bundle.state
}

/** 供文件地址用：演示版一律相对路径，子路径部署才不会 404 */
export const demoFileUrl = url => (!url ? '' : /^https?:/i.test(url) ? url : url.replace(/^\//, ''))
