// 演示版（GitHub Pages 静态部署）的数据适配层。
//
// 为什么需要它：正式版前端全靠 /api/* 跟 Express + MySQL 打交道，
// 而 GitHub Pages 只发静态文件，没有 Node、没有数据库。
//
// 做法：构建时把真库数据抓成 demodata/demo/*.json（见 scripts/export-demo.mjs），
// 这里在 api() 出口处拦下所有请求，用内存 + localStorage 顶替后端。
//
// 为什么拆成 5 个文件按需加载：
//   从国内访问 github.io 实测约 30–50 KB/s。131 份报告的正文合计约 1.4MB，
//   合成一个 bundle 时首屏要等 40 秒以上，页面长时间空白。
//   现在首屏只读 core.json（约 25KB），知识库列表进页面才拉，
//   正文、AI 时间线、公司详情都是「用到才拉」。
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

// 各数据文件：名字 -> 相对路径。BASE_URL 在子路径部署时是 './'，拼出来才不会 404
const FILES = {
  core: 'demo/core.json',
  knowledge: 'demo/knowledge.json',
  ai: 'demo/ai-events.json',
  companies: 'demo/company-details.json'
}

// 完整正文按列表顺序分片，每片 30 条（见 scripts/export-demo.mjs）
const FULL_SHARD = 30

const cache = {}
const inflight = {}

let side = null
let kb = null

// 正文分片：片号 -> 是否已加载；id -> 全文
const shardLoaded = new Set()
const shardInflight = {}
const bodies = {}

const parse = raw => { try { return JSON.parse(raw) } catch { return null } }
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** 统一错误：与 lib/api.js 的 ApiError 同形，调用方 catch 到的行为一致 */
const fail = (message, status = 400) => {
  const e = new Error(message)
  e.name = 'ApiError'
  e.status = status
  e.detail = null
  return e
}

/** 按需读一个数据文件，同一文件并发只发一次请求 */
function mod(name) {
  if (cache[name]) return Promise.resolve(cache[name])
  if (inflight[name]) return inflight[name]
  const url = `${import.meta.env.BASE_URL}${FILES[name]}`
  inflight[name] = fetch(url)
    .then(r => {
      if (!r.ok) throw fail(`演示数据读取失败（${FILES[name]} ${r.status}）`, r.status)
      return r.json()
    })
    .then(j => {
      cache[name] = j
      delete inflight[name]
      return j
    })
    .catch(e => {
      delete inflight[name]
      throw e
    })
  return inflight[name]
}

/** 侧数据（想法/时间线/发现/交易/评测记录）：本地改过就用本地的 */
function initSide(core) {
  if (side) return side
  const saved = parse(localStorage.getItem(SIDE_KEY))
  side = saved || {
    ideas: (core.ideas && core.ideas.items) || [],
    // 时间线单独一个文件，第一次访问才读；null 表示还没读过
    aiEvents: null,
    discovers: core.discovers || [],
    transactions: core.transactions || [],
    evalRuns: core.evalRuns || []
  }
  return side
}

const saveSide = () => { try { localStorage.setItem(SIDE_KEY, JSON.stringify(side)) } catch { /* 配额满/隐私模式忽略 */ } }

/** AI 时间线懒加载：63 条约 39KB，首页用不到，不值得放首屏 */
async function ensureAi() {
  if (Array.isArray(side.aiEvents)) return
  const j = await mod('ai')
  side.aiEvents = j.items || []
}

// ===== 知识库：列表 + 完整正文 =====

/** 列表（每条只带 200 字摘要），顺手在后台预取正文第 0 片 */
async function ensureKb() {
  if (kb) return kb
  const j = await mod('knowledge')
  kb = j.items || []
  loadShard(0).catch(() => { /* 预取失败不影响列表，点开时会再试 */ })
  return kb
}

/**
 * 读一片正文。
 * 分片而不是整包：全文 1.2MB，国内拉 github.io 要 10 秒；每片约 240KB，两三秒就够。
 */
function loadShard(i) {
  if (shardLoaded.has(i)) return Promise.resolve()
  if (shardInflight[i]) return shardInflight[i]
  const url = `${import.meta.env.BASE_URL}demo/knowledge-full-${i}.json`
  shardInflight[i] = fetch(url)
    .then(r => {
      if (!r.ok) throw fail(`正文读取失败（第 ${i} 片 ${r.status}）`, r.status)
      return r.json()
    })
    .then(j => {
      Object.assign(bodies, j.bodies || {})
      shardLoaded.add(i)
      delete shardInflight[i]
      // 补回列表项：按关键词搜正文、以及已经渲染出来的摘要都能用到
      for (const it of kb || []) {
        const c = bodies[String(it.id)]
        if (c) {
          it.content = c
          it.truncated = false
        }
      }
    })
    .catch(e => {
      delete shardInflight[i]
      throw e
    })
  return shardInflight[i]
}

/** 这条记录落在哪一片 */
function shardOf(id) {
  const i = (kb || []).findIndex(x => String(x.id) === String(id))
  return i < 0 ? 0 : Math.floor(i / FULL_SHARD)
}

/**
 * 翻页后延迟预取。
 * 为什么要防抖 + 串行：一次性预取会在用户连点 11 页时把所有分片都拉下来（1.2MB），
 * 等于退回整包加载。这里只在页面停住 700ms 后才拉，且拉的时候发现又翻页就停手。
 */
let prefetchTimer = null
let prefetchToken = 0
let pendingShards = []

function schedulePrefetch(shards) {
  pendingShards = [...new Set(shards)].filter(i => !shardLoaded.has(i))
  const my = ++prefetchToken
  clearTimeout(prefetchTimer)
  if (!pendingShards.length) return
  prefetchTimer = setTimeout(async () => {
    if (my !== prefetchToken) return
    for (const i of pendingShards) {
      if (my !== prefetchToken) return   // 又翻页了，别把旧页的分片继续拉下去
      try { await loadShard(i) } catch { return }   // 预取失败不打扰用户，点开时会再试
    }
  }, 700)
}

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

  const all = kb || []
  let list = all.filter(it => matchKb(it, q))

  // series 已在导出时由后端排好，这里不动；日期排序在内存里做
  if (safeSort === 'date_desc') list = [...list].sort((a, b) => String(b.originDate || '').localeCompare(String(a.originDate || '')))
  if (safeSort === 'date_asc') list = [...list].sort((a, b) => String(a.originDate || '').localeCompare(String(b.originDate || '')))

  const total = list.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(page, totalPages)
  const items = list.slice((p - 1) * pageSize, p * pageSize)

  // 翻页时后台预取这一页涉及的分片：线上拉一片要 1~3 秒，
  // 等用户点开再拉就得干等，预取掉就能做到点开即全文
  schedulePrefetch(items.map(it => shardOf(it.id)))

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
async function handleGet(path) {
  const { p, params, seg } = readRoute(path)
  const [a, b] = seg
  const core = await mod('core')
  initSide(core)

  if (p === '/api/state') return core.state
  if (a === 'transactions' && !b) return side.transactions
  if (a === 'finance') return core.finance
  if (a === 'discovers' && !b) return side.discovers
  if (a === 'discovers' && b) return side.discovers.find(x => String(x.id) === b) || null
  if (a === 'ideas' && !b) return { items: side.ideas }
  if (a === 'assets') return core.assets
  if (a === 'app-config') return core.appConfig

  if (a === 'ai-events') {
    await ensureAi()
    const ai = cache.ai || {}
    return { items: side.aiEvents, baseline: ai.baseline || [] }
  }

  if (a === 'eval') {
    if (b === 'overview') return core.evalOverview
    if (b === 'runs' && seg.length === 2) return side.evalRuns
    if (b === 'products' && seg.length === 2) return core.evalOverview.products || []
    if (b === 'tasks' && seg.length === 2) return core.evalOverview.tasks || []
  }

  if (a === 'companies') {
    if (!b) return { items: core.companies || [] }
    const ticker = decodeURIComponent(b)
    const j = await mod('companies')
    const item = (j.items || {})[ticker]
    if (!item) throw fail(`演示数据里没有 ${ticker}`, 404)
    return { item }
  }

  if (a === 'knowledge') {
    if (b === 'feeds-status') return core.feedsStatus
    if (b === 'sync-progress') {
      return { running: false, done: true, total: 0, imported: 0,
        feeds: (core.feedsStatus && core.feedsStatus.feeds) || [] }
    }
    if (!b) {
      await ensureKb()
      return knowledgePage(params)
    }
    // 单条详情：把这条所在的正文片读回来，保证返回的是完整正文
    const id = decodeURIComponent(b)
    await ensureKb()
    const item = (kb || []).find(x => String(x.id) === id)
    if (!item) throw fail('没有这条记录', 404)
    if (!bodies[id]) await loadShard(shardOf(id))
    const body = bodies[id]
    if (body) {
      item.content = body
      item.truncated = false
    }
    return item
  }

  // 未覆盖的读接口：给空对象，别让整页崩掉
  return {}
}

/** 写处理：只维护列表型模块的内存态，其余一律当成功 */
async function handleWrite(path, method, body) {
  const { seg } = readRoute(path)
  const [a, b] = seg
  const payload = (body && typeof body === 'object') ? body : {}
  const core = await mod('core')

  if (method === 'DELETE' && a === 'state') {
    // 重置演示数据：主状态由调用方清 localStorage，这边把侧数据一起还原
    try { localStorage.removeItem(SIDE_KEY) } catch { /* 忽略 */ }
    side = null
    initSide(core)
    return { ok: true }
  }

  initSide(core)

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
    await ensureAi()
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
  initSide(await mod('core'))

  let payload = body
  if (typeof payload === 'string') payload = parse(payload) || {}

  // 模拟极短网络延迟，避免界面出现「瞬间跳变」的突兀感
  await new Promise(r => setTimeout(r, 30))

  if (method === 'GET') return handleGet(path)
  return handleWrite(path, method, payload)
}

/** 供 initApi 用：演示版的初始 state（本地有改动就用本地的） */
export async function demoState() {
  const core = await mod('core')
  initSide(core)
  return core.state
}

/**
 * 供 initApi 用：首屏要显示的统计数字。
 * 知识库列表和正文都不在这一步拉，但「知识沉淀 N 条」必须立刻有值。
 */
export async function demoCounts() {
  const core = await mod('core')
  return {
    knowledge: core.knowledgeCount || 0,
    aiEvents: core.aiEventsCount || 0
  }
}

/** 供文件地址用：演示版一律相对路径，子路径部署才不会 404 */
export const demoFileUrl = url => (!url ? '' : /^https?:/i.test(url) ? url : url.replace(/^\//, ''))

/**
 * 供「阅读全文」用：列表项只带摘要时，把这条所在的正文片读回来后写回这个对象。
 * 注意：页面渲染用的是 knowledgePager.items 的浅拷贝（KnowledgeView 里 map 出来的），
 * 所以不能指望改列表原对象就能影响已渲染的卡片 —— 必须写回调用方手里这一个。
 */
export async function ensureFullBody(item) {
  if (!item || !item.truncated) return item
  await ensureKb()
  const id = String(item.id)
  if (!bodies[id]) await loadShard(shardOf(id))
  const body = bodies[id]
  if (body) {
    item.content = body
    item.truncated = false
  }
  return item
}
