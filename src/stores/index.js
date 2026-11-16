// 共享状态：db + 同步 + 工具函数 + 全部 computed
// 这是 App.vue 拆分出的 store，6 个 view 共用
import { computed, reactive, ref } from 'vue'
import { API_BASE, api } from '../lib/api.js'
import { DEMO, demoState } from '../lib/demo.js'
import { toast, notify } from '../lib/toast.js'
import { fmt, dateLabel } from '../lib/format.js'

// 请求封装、轻提示、格式化已搬到 lib/ 下供全站复用；这里 re-export 保持旧引用路径不变
export { API_BASE, api } from '../lib/api.js'
export { toast, notify } from '../lib/toast.js'
export { fmt, dateLabel } from '../lib/format.js'

const KEY = 'spring-workbench-v2'
// 本地日期键 YYYY-MM-DD。
// 原来用 toISOString() 取的是 UTC 日期：东八区 00:00–08:00 之间会算成「昨天」，
// 凌晨打的卡会记到前一天；streak 里 new Date('2026-10-23T00:00:00') 再 toISOString 更是永远差一天（连续天数恒少 1）。
export const dateKey = d => {
  const x = d || new Date()
  const p = n => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}
export const today = () => dateKey()
export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
const emptyState = () => ({
  categories: ['未分类', '学习', '工作', '健康', '运动', '阅读', '生活', '理财'],
  yearPlans: [], monthPlans: [], checkTasks: [], checkins: [], discovers: [], knowledge: [], transactions: [],
  finance: { openingBalance: 0, monthBudget: 0 }
})
const localBackup = load()
export const db = reactive(localBackup || emptyState())
if (!Array.isArray(db.categories) || !db.categories.length) db.categories = ['未分类', '学习', '工作', '健康', '运动', '阅读', '生活', '理财']
// 防御 localStorage 缺字段（部分清除 / 旧版本兼容 / 单页注入测试）：补齐所有表为 []/默认值
for (const a of ['yearPlans', 'monthPlans', 'checkTasks', 'checkins', 'discovers', 'knowledge', 'transactions']) {
  if (!Array.isArray(db[a])) db[a] = []
}
for (const p of db.yearPlans) if (!p.category) p.category = '未分类'
// 知识库正文不再进 localStorage / 全量同步：旧版本把 67 份报告全文（约 28 万字）塞在 db.knowledge，
// 每次 pushSync 都要整体 JSON.stringify 一遍，是翻页/滚动卡顿的来源之一。
// 列表改走 /api/knowledge 分页接口（见知识库页），这里永久清空，数据以 MySQL 为准。
db.knowledge = []
// 旧版本把 67 份报告全文（约 28 万字 / 300KB+）存在 localStorage，迁移后立刻回收这份磁盘副本；
// 不清的话每次读盘/解析都在主线程上白白跑一遍
try {
  const raw = localStorage.getItem(KEY) || ''
  if (raw.length > 120 * 1024) {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.knowledge) && parsed.knowledge.length) {
      parsed.knowledge = []
      localStorage.setItem(KEY, JSON.stringify(parsed))
    }
  }
} catch { /* 解析失败就交给后面的正常流程覆盖 */ }
for (const p of db.monthPlans) if (!p.category) p.category = '未分类'
for (const t of db.checkTasks) if (!t.category) t.category = '未分类'
if (!db.finance || typeof db.finance !== 'object') db.finance = { openingBalance: 0, monthBudget: 0 }
if (typeof db.finance.openingBalance !== 'number') db.finance.openingBalance = +db.finance.openingBalance || 0
if (typeof db.finance.monthBudget !== 'number') db.finance.monthBudget = +db.finance.monthBudget || 0

let apiReady = false
// bootstrap 门闩：initApi 完成（成功或失败）前，绝不把本地状态推给服务端
// 根因：模块加载时 domain 的 immediate watch 会往空 db.checkins 塞一条当日空记录并触发 pushSync，
// 若此时已允许网络 PUT，就会把空状态盖掉服务端数据（P0 数据丢失）。
let bootstrapDone = false
let syncTimer
let syncChain = Promise.resolve()
let syncInFlight = false
// 「真实数据」判定：排除自动生成的空 checkin（items 全空且无备注），并排除恒有种子值的 categories。
// 不再用 Object.values(...).some(...) 兜底扫描 —— 它会把上面那条自动空 checkin 误判为「有数据」。
const realCheckins = state => (state?.checkins || []).filter(c => (c.items || []).some(i => i.isFinish || String(i.note || '').trim()))
const hasData = state => !!state && (
  realCheckins(state).length > 0 ||
  !!(state.yearPlans?.length || state.monthPlans?.length || state.checkTasks?.length || state.discovers?.length || state.knowledge?.length || state.transactions?.length)
)
export const pushSync = () => {
  // 合并防抖：localStorage 写入与网络同步同批 400ms 内完成，避免逐次按键/勾选全量序列化写盘（卡顿闪退根源）
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* 存储满/不可用时忽略 */ }
    // 演示版没有后端：本地已落盘，到此为止，不发网络 PUT
    if (DEMO) return
    // bootstrap 完成前只落本地、跳过网络 PUT（本地编辑不丢），根治冷启动清库
    if (!apiReady || !bootstrapDone) return
    syncChain = syncChain.then(async () => {
      if (syncInFlight) return
      syncInFlight = true
      try { await fetch(`${API_BASE}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-client-ready': bootstrapDone ? '1' : '0' }, body: JSON.stringify(db) }) }
      catch { notify('本地保存成功，暂未同步到数据库') }
      finally { syncInFlight = false }
    })
  }, 400)
}
// ===== 按条提交基础设施：api 封装见 lib/api.js，资金模块 action 在下方 =====
// skipSync：资金表已拆独立接口，资金操作改 db 时跳过全量 pushSync（配合 App.vue 的 flush:'sync' watch）
let skipSync = false
export const onDbChange = () => { if (skipSync) return; pushSync() }
function localOnly(fn) { skipSync = true; try { fn() } finally { skipSync = false } }

export function addTransaction(tx) {
  localOnly(() => { db.transactions.unshift(tx) })
  api('/api/transactions', { method: 'POST', body: tx }).catch(() => notify('本地已保存，暂未同步'))
}
export function deleteTransaction(id) {
  localOnly(() => { const i = db.transactions.findIndex(t => t.id === id); if (i >= 0) db.transactions.splice(i, 1) })
  api(`/api/transactions/${id}`, { method: 'DELETE' }).catch(() => notify('本地已删除，暂未同步'))
}
export function updateFinance(openingBalance, monthBudget) {
  localOnly(() => {
    if (openingBalance >= 0) db.finance.openingBalance = openingBalance
    if (monthBudget >= 0) db.finance.monthBudget = monthBudget
  })
  api('/api/finance', { method: 'PUT', body: { openingBalance: db.finance.openingBalance, monthBudget: db.finance.monthBudget } }).catch(() => notify('本地已保存，暂未同步'))
}

// ===== 知识库分页接口（knowledge_entries，导入 HTML 报告） =====
// 每翻一页只向后台要这一页的正文：67 份报告合计约 28 万字，一次性下发会让列表滚动卡死。
// 全量 PUT /api/state 不触碰 knowledge_entries，所以 db.knowledge 只缓存当前页是安全的。
// 后端没起/断线时列表会停在旧数据上，看起来像「筛选失效」——提示一次并节流，不要静默
let kbErrorAt = 0
export const knowledgePager = reactive({
  items: [], total: 0, totalAll: 0, page: 1, pageSize: 12, totalPages: 1,
  // 排序跟着分页对象走：series = 按系列分期（默认），date_desc = 今天往前，date_asc = 最早在前
  sort: 'series',
  sources: [], tags: [], loading: false
})
export function loadKnowledgePage(params = {}) {
  const p = {    page: Number(params.page) || 1,
    pageSize: Number(params.pageSize) || knowledgePager.pageSize || 12,
    keyword: params.keyword || '',
    source: params.source || '',
    tag: params.tag || '',
    start: params.start || '',
    end: params.end || '',
    // 三值白名单，别把用户/旧缓存里的值原样带给后端
    sort: ['series', 'date_asc', 'date_desc'].includes(params.sort) ? params.sort : 'series'
  }
  const q = new URLSearchParams({ page: p.page, pageSize: p.pageSize, sort: p.sort })
  for (const k of ['keyword', 'source', 'tag', 'start', 'end']) if (p[k]) q.set(k, p[k])
  knowledgePager.loading = true
  return api(`/api/knowledge?${q.toString()}`)
    .then(res => {
      if (!res || !Array.isArray(res.items)) return
      localOnly(() => {
        knowledgePager.items = res.items
        knowledgePager.total = res.total
        // totalAll 是全库条数，不受筛选影响；旧后端没这个字段时退回 total
        knowledgePager.totalAll = Number.isFinite(res.totalAll) ? res.totalAll : res.total
        knowledgePager.page = res.page
        knowledgePager.pageSize = res.pageSize
        knowledgePager.totalPages = res.totalPages
        knowledgePager.sources = (res.facets && res.facets.sources) || []
        knowledgePager.tags = (res.facets && res.facets.tags) || []
      })
    })
    .catch(() => {
      if (Date.now() - kbErrorAt > 30000) {
        kbErrorAt = Date.now()
        notify('知识库没连上后端，列表还是旧数据')
      }
    })
    .finally(() => { knowledgePager.loading = false })
}
export function fetchKnowledgeOne(id) {
  return api(`/api/knowledge/${encodeURIComponent(id)}`)
}
// 知识打卡独立落库：返回当天完整 items，前端拿它覆盖本地，避免「本地有、库里没有」
export function saveKnowledgeCheck(payload) {
  return api('/api/checkins/knowledge', { method: 'POST', body: payload })
}

// ===== 奇思妙想：idea 与它的阶段台阶（走独立接口，不进全量 state）=====
export const ideasStore = reactive({ items: [], loading: false, loaded: false })
export function loadIdeas() {
  ideasStore.loading = true
  return api('/api/ideas')
    .then(res => {
      if (!res || !Array.isArray(res.items)) return
      ideasStore.items = res.items
      ideasStore.loaded = true
    })
    .catch(() => {
      if (Date.now() - kbErrorAt > 30000) {
        kbErrorAt = Date.now()
        notify('奇思妙想没连上后端，看到的可能不是最新的')
      }
    })
    .finally(() => { ideasStore.loading = false })
}
export function createIdea(payload) {
  return api('/api/ideas', { method: 'POST', body: payload }).then(res => {
    const item = res && res.item
    if (item) ideasStore.items.unshift(item)
    return item
  })
}
export function updateIdea(id, payload) {
  return api(`/api/ideas/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }).then(res => res && res.item)
}
export function deleteIdea(id) {
  return api(`/api/ideas/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => {
    const i = ideasStore.items.findIndex(x => x.id === id)
    if (i >= 0) ideasStore.items.splice(i, 1)
  })
}
export function importKnowledge(payload) {
  return api('/api/knowledge/import', { method: 'POST', body: payload })
    .then(res => { notify('已导入'); return res })
    .catch(error => {
      // 409 交由调用方弹确认框（同名同日期），不误报为「后端未启动」
      if (error.status !== 409) notify('导入失败，请确认后端服务已启动')
      throw error
    })
}
export function deleteKnowledge(id) {
  return api(`/api/knowledge/${id}`, { method: 'DELETE' })
    .catch(() => notify('本地已删除，暂未同步'))
}

// ===== 每日发现独立接口（daily_discovers）=====
// 正文单条最大 23KB，列表接口只回摘要；点开阅读时按 id 单独取全文
export function loadDiscovers() {
  return api('/api/discovers')
    .then(list => { if (Array.isArray(list)) localOnly(() => { db.discovers = list }) })
    .catch(() => {})
}
export function fetchDiscover(id) { return api(`/api/discovers/${id}`) }
export function saveDiscoverItem(data) {
  return api('/api/discovers', { method: 'POST', body: data })
    .then(res => { notify('已保存'); return res })
    .catch(error => { notify('保存失败，请确认后端服务已启动'); throw error })
}
export function deleteDiscover(id) {
  localOnly(() => { const i = db.discovers.findIndex(d => d.id === id); if (i >= 0) db.discovers.splice(i, 1) })
  api(`/api/discovers/${id}`, { method: 'DELETE' }).catch(() => notify('本地已删除，暂未同步'))
}

export const CAT_PALETTE = ['#4a9e66', '#e07a5f', '#e9a23b', '#6a7ff5', '#e0567c', '#26a69a', '#9b7fd4', '#d4862c', '#5f8fd8', '#7a9b46', '#b05cb8', '#576574']
export const catIndex = name => { const s = String(name || ''); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % CAT_PALETTE.length }
export const catColor = name => CAT_PALETTE[catIndex(name)]
// fmt / dateLabel 已移到 lib/format.js，本文件顶部 re-export
export function ensureCat(v, fallback) { const c = (v || '').trim(); return db.categories.includes(c) ? c : (fallback || '未分类') }

// 同步初始化（onMounted 由 App.vue 调用）
// 原则：本地优先 —— 远端只是备份。绝不用"空/演示"远端覆盖本地真实数据（那是数据消失的根源）。
export async function initApi() {
  // 演示版：没有 /api/state，初始状态来自构建时导出的快照。
  // 本地已有改动（localStorage）就保留本地，朋友下次打开还是他上次看到的样子。
  if (DEMO) {
    try {
      const remote = await demoState()
      if (!hasData(db) && hasData(remote)) Object.assign(db, remote)
      await loadKnowledgePage({ page: 1 })
      await loadDiscovers()
    } catch { notify('演示数据加载失败，页面可能不完整，刷新试试') }
    bootstrapDone = true
    return
  }
  try {
    const response = await fetch(`${API_BASE}/api/state`)
    if (!response.ok) throw new Error('API unavailable')
    const remote = await response.json()
    const localHasData = hasData(db)
    const remoteHasData = hasData(remote)
    if (!localHasData && remoteHasData) {
      // 本地空白 → 首次使用，取远端数据
      Object.assign(db, remote)
    } else if (localHasData) {
      // 本地有数据 → 以本地为准，并把它推到远端做备份（空远端会被本地填上，不会反向覆盖）
      if (!remoteHasData) pushSync()
    }
    apiReady = true
    if (!hasData(db) && hasData(localBackup)) pushSync()
    // 知识库与每日发现都走独立接口，单独拉取（知识库只拉第 1 页，翻页再取）
    await loadKnowledgePage({ page: 1 })
    await loadDiscovers()
  } catch { notify('当前使用本地缓存；启动后端可同步到数据库') }
  // 无论成功/失败都放行：此后 pushSync 才允许网络 PUT；服务端还有 x-client-ready 兜底
  finally { bootstrapDone = true }
}
