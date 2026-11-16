// 网页测评：测谁（产品）/ 测什么（任务）/ 测的结果（记录）。
//
// 为什么不是一个"评测表"：
//   只存一行行文字时，回头想问「长文摘要这件事谁做得最好」就得自己翻几十条。
//   所以这里以「矩阵」为主视图：行是任务、列是产品、格子是该组合最后一次的分数。
//   矩阵和所有统计都从 runs 现算 —— 库里不存"格子分数"这种冗余字段，
//   否则复测时要么覆盖历史，要么两边对不上。

import { reactive, computed } from 'vue'
import { api } from '../lib/api.js'

/** 评分 1–5 的口径，写一处，弹窗和格子颜色都读它 */
export const SCORE_HINTS = ['未评分', '不可用', '勉强能用', '凑合', '挺好', '可以直接用']

/** 标签预设：分好坏两组，事后能筛「谁最会做长文档」这类问题 */
export const GOOD_TAGS = ['响应快', '格式规整', '理解准确', '给了来源', '中文自然', '敢于拒绝']
export const BAD_TAGS = ['事实出错', '漏掉要求', '格式乱', '太啰嗦', '超时', '含糊其辞']

export const evalState = reactive({
  products: [],
  tasks: [],
  /** [{ pid, tid, score, n, date }] 每格最后一次的结果 + 测过几次 */
  cells: [],
  stats: { runs: 0, filled: 0 },
  /** 测试流水（按时间倒序的摘要，正文另取） */
  runs: [],
  loading: false,
  loaded: false
})

/** 格子的 key：一个产品 × 一个任务 */
export const cellKey = (pid, tid) => `${pid}|${tid}`

const cellIndex = computed(() => {
  const m = new Map()
  for (const c of evalState.cells) m.set(cellKey(c.pid, c.tid), c)
  return m
})

export const cellOf = (pid, tid) => cellIndex.value.get(cellKey(pid, tid)) || null

/** 产品均分 = 它每个"已测格子"的最新分取平均（不是所有历史记录平均，否则复测次数会影响排名） */
export function productAvg(pid) {
  const scores = evalState.cells.filter(c => c.pid === pid).map(c => c.score)
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
}

export const productById = id => evalState.products.find(p => p.id === id) || null
export const taskById = id => evalState.tasks.find(t => t.id === id) || null

/** 还没测的组合数 */
export const gapCount = computed(
  () => evalState.products.length * evalState.tasks.length - evalState.cells.length
)

/** 覆盖率：已测格子 / 总格子，用于概览进度条 */
export const fillRate = computed(() => {
  const total = evalState.products.length * evalState.tasks.length
  return total ? evalState.cells.length / total : 0
})

function apply(data) {
  if (!data || !Array.isArray(data.products)) return
  evalState.products = data.products
  evalState.tasks = data.tasks || []
  evalState.cells = data.cells || []
  evalState.stats = data.stats || { runs: 0, filled: 0 }
}

/** 首次进入页面拉一次；后续所有写操作都会带新的 overview 回来，不用再单独刷新 */
export async function loadEval({ force = false } = {}) {
  if (evalState.loaded && !force) return
  evalState.loading = true
  try {
    apply(await api('/api/eval/overview'))
    evalState.loaded = true
  } finally {
    evalState.loading = false
  }
}

/** 测试流水（摘要），limit 默认 40 条 */
export async function loadRuns(limit = 40) {
  const r = await api(`/api/eval/runs?limit=${limit}`)
  evalState.runs = Array.isArray(r?.items) ? r.items : []
  return evalState.runs
}

/** 单条详情（含完整回答原文），点流水里的一条才拉 */
export async function loadRun(id) {
  const r = await api(`/api/eval/runs/${encodeURIComponent(id)}`)
  return r?.item || null
}

/** 某一格最近一次记录的完整内容：复测时用来带出上次的分数、标签和原文 */
export async function lastRunOf(pid, tid) {
  const r = await api(`/api/eval/runs?pid=${encodeURIComponent(pid)}&tid=${encodeURIComponent(tid)}&limit=1`)
  const first = (r?.items || [])[0]
  return first ? loadRun(first.id) : null
}

/** 记一次评测：每次都是新增，历史不覆盖 */
export async function saveRun(payload) {
  const r = await api('/api/eval/runs', { method: 'POST', body: payload })
  apply(r)
  return r
}

export async function removeRun(id) {
  const r = await api(`/api/eval/runs/${encodeURIComponent(id)}`, { method: 'DELETE' })
  apply(r)
  return r
}

export async function addProduct(payload) {
  const r = await api('/api/eval/products', { method: 'POST', body: payload })
  apply(r)
  return r
}

export async function patchProduct(id, payload) {
  const r = await api(`/api/eval/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
  apply(r)
  return r
}

/** 删产品：带 withRuns 才会连带删掉它的评测记录（后端第一次会回 409 拦一下） */
export async function removeProduct(id, withRuns = false) {
  const r = await api(`/api/eval/products/${encodeURIComponent(id)}${withRuns ? '?withRuns=1' : ''}`, { method: 'DELETE' })
  apply(r)
  return r
}

export async function addTask(payload) {
  const r = await api('/api/eval/tasks', { method: 'POST', body: payload })
  apply(r)
  return r
}

export async function patchTask(id, payload) {
  const r = await api(`/api/eval/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
  apply(r)
  return r
}

export async function removeTask(id, withRuns = false) {
  const r = await api(`/api/eval/tasks/${encodeURIComponent(id)}${withRuns ? '?withRuns=1' : ''}`, { method: 'DELETE' })
  apply(r)
  return r
}
