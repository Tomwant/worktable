// 领域 computed 与业务方法（按页面归类导出）
import { computed, reactive, ref } from 'vue'
import { db, today, dateKey, uid, pushSync, notify, catColor, ensureCat, addTransaction, updateFinance, fetchDiscover, saveDiscoverItem, knowledgePager, saveKnowledgeCheck } from './index.js'
import { APP_NAME } from '../config.js'

// ---------- 全局 UI ----------
export const page = ref('home')
export const checkDate = ref(today())
export const selectedYear = ref(new Date().getFullYear())
export const selectedMonth = ref(new Date().getMonth() + 1)

// ---------- 表单/弹窗状态 ----------
export const yearForm = reactive({ name: '', category: '', desc: '', target: '' })
export const monthForm = reactive({ name: '', category: '', yearPlanId: '', desc: '' })
export const taskForms = reactive({})
export const taskCats = reactive({})
export const catInput = ref('')
export const txForm = reactive({ type: 'expense', amount: '', date: today(), category: '餐饮', note: '' })
export const finForm = reactive({ openingBalance: '', monthBudget: '' })
export const txFilter = reactive({ month: today().slice(0, 7) })
export const financeEdit = ref(false)
export const discoverOpen = ref(false)
export const editingDiscover = ref(null)
export const knowledgeOpen = ref(false)
export const editingKnowledge = ref(null)
export const discoverForm = reactive({ recordDate: today(), title: '', source: '', link: '', content: '', tagsText: '' })
export const filters = reactive({ source: '', keyword: '', tag: '', start: '', end: '' })

// ---------- 计划/打卡领域 ----------
export function yearPlans() { return db.yearPlans.filter(x => x.year === +selectedYear.value) }
export function monthPlans() { return db.monthPlans.filter(x => x.year === +selectedYear.value && x.month === +selectedMonth.value) }
export function monthPlansOf(year, month) { return db.monthPlans.filter(x => x.year === +year && x.month === +month) }
export function tasksOfPlan(planId) { return db.checkTasks.filter(t => t.monthPlanId === planId) }

export function addCategory() { const name = (catInput.value || '').trim(); if (!name) return notify('请填写分类名称'); if (db.categories.includes(name)) return notify('该分类已存在'); db.categories.push(name); catInput.value = ''; notify('分类已添加') }
export function removeCategory(name) { if (name === '未分类') return notify('「未分类」为默认分类，不可删除'); if (!confirm(`删除分类「${name}」？现有计划/打卡项的分类会保留但不再出现在列表。`)) return; db.categories.splice(db.categories.indexOf(name), 1) }
export function saveYear() { if (!yearForm.name.trim()) return notify('请填写计划名称'); const t = Math.floor(+yearForm.target); db.yearPlans.unshift({ id: uid(), year: +selectedYear.value, name: yearForm.name.trim(), category: ensureCat(yearForm.category, '未分类'), desc: yearForm.desc.trim(), target: t > 0 ? t : null, createTime: Date.now() }); yearForm.name = yearForm.category = yearForm.desc = yearForm.target = ''; notify('年计划已添加') }
export function saveMonth() { if (!monthForm.name.trim()) return notify('请填写计划名称'); db.monthPlans.unshift({ id: uid(), year: +selectedYear.value, month: +selectedMonth.value, yearPlanId: monthForm.yearPlanId || null, name: monthForm.name.trim(), category: ensureCat(monthForm.category, '未分类'), desc: monthForm.desc.trim(), createTime: Date.now() }); monthForm.name = monthForm.category = monthForm.desc = monthForm.yearPlanId = ''; notify('月计划已添加') }
// 打卡项增删后，若当天日期落在该月计划所在年月，则把当天 items 补上/清理
function refreshDayAfterChange(plan) {
  if (!plan) return
  const d = checkDate.value
  const [y, m] = d.split('-').map(Number)
  if (plan.year === y && plan.month === m) syncDayItems(d)
}
export function addTask(planId) { const name = (taskForms[planId] || '').trim(); if (!name) return notify('请填写打卡项名称'); const parent = db.monthPlans.find(p => p.id === planId); db.checkTasks.push({ id: uid(), monthPlanId: planId, name, category: ensureCat(taskCats[planId], parent?.category || '未分类'), createTime: Date.now() }); taskForms[planId] = ''; taskCats[planId] = ''; refreshDayAfterChange(parent); notify('打卡项已添加') }
export function remove(arr, id, text = '删除后无法恢复，确定继续吗？') { if (!confirm(text)) return; const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1); notify('已删除') }
export function editPlan(item) {
  const isYear = item && !('month' in item) && ('year' in item)
  const name = prompt('计划名称', item.name); if (name !== null && name.trim()) item.name = name.trim()
  const desc = prompt('计划描述', item.desc || ''); if (desc !== null) item.desc = desc
  if (isYear) { const t = prompt('年度目标次数（留空或填 0 = 不设目标，只显示累计）', item.target || ''); if (t !== null) { const n = Math.floor(+t); item.target = n > 0 ? n : null } }
}
export function renameTask(t) { const name = prompt('打卡项名称', t.name); if (name !== null && name.trim()) t.name = name.trim() }

// 关联 watch：年计划→月计划分类
import { watch } from 'vue'
watch(() => monthForm.yearPlanId, id => {
  if (id && !monthForm.category) {
    const y = db.yearPlans.find(y => y.id === id)
    if (y) monthForm.category = y.category
  }
})

// 拖拽
export const dragKey = ref('')
export function dropPlan(plan) { if (!dragKey.value) return; const from = db.monthPlans.findIndex(x => x.id === dragKey.value); const to = db.monthPlans.findIndex(x => x.id === plan.id); if (from < 0 || to < 0) return; const [moved] = db.monthPlans.splice(from, 1); db.monthPlans.splice(to, 0, moved); dragKey.value = '' }

// 打卡域：当日记录由 watch 预补全（无副作用 computed），列表纯读取 db —— 任务增删即时可见
export function ensureCheckin(d) { let rec = db.checkins.find(x => x.checkDate === d); if (!rec) { rec = { id: uid(), checkDate: d, items: [], createTime: Date.now(), updateTime: Date.now() }; db.checkins.unshift(rec) } return rec }
export function tasksForDate(d) { const [y, m] = d.split('-').map(Number); const pids = new Set(monthPlansOf(y, m).map(p => p.id)); return db.checkTasks.filter(t => pids.has(t.monthPlanId)) }
// 补齐某天 items（若缺当月打卡项则补入；勾选状态保留）——纯函数，由 watch / 增删动作显式触发
export function syncDayItems(d) {
  const rec = ensureCheckin(d)
  const ids = new Set(rec.items.map(i => i.taskId))
  let dirty = false
  for (const t of tasksForDate(d)) if (!ids.has(t.id)) { rec.items.push({ taskId: t.id, isFinish: false, note: '' }); dirty = true }
  if (dirty) rec.updateTime = Date.now()
  return rec
}
// 纯读取：当天打卡记录（watch 已保证存在）
export const currentRecord = computed(() => db.checkins.find(x => x.checkDate === checkDate.value) || null)
export const dailyList = computed(() => {
  const rec = currentRecord.value
  if (!rec) return []
  return rec.items.map(it => ({ it, task: db.checkTasks.find(t => t.id === it.taskId), plan: db.monthPlans.find(p => p.id === db.checkTasks.find(t => t.id === it.taskId)?.monthPlanId) })).filter(x => x.task && x.plan)
})
// 日期切换 / 数据回填完成后，确保当天 items 已生成（杜绝"添加后不出现"）
export function ensureToday() { if (checkDate.value) syncDayItems(checkDate.value) }
watch(checkDate, d => { if (d) syncDayItems(d) }, { immediate: true })
export function taskOf(id) { return db.checkTasks.find(t => t.id === id) }
export function planOf(taskId) { const t = taskOf(taskId); if (!t) return null; return db.monthPlans.find(p => p.id === t.monthPlanId) }

// ---------- 累计统计 ----------
export function taskStats(taskId) { return db.checkins.reduce((acc, c) => { const it = c.items?.find(i => i.taskId === taskId); if (it?.isFinish) acc++; return acc }, 0) }
export function monthAccum(planId) { const ids = new Set(db.checkTasks.filter(t => t.monthPlanId === planId).map(t => t.id)); if (!ids.size) return 0; let n = 0; for (const c of db.checkins) for (const it of c.items || []) if (ids.has(it.taskId) && it.isFinish) n++; return n }
export function yearAccum(yearPlanId) { const monthIds = new Set(db.monthPlans.filter(p => p.yearPlanId === yearPlanId).map(p => p.id)); const taskIds = new Set(db.checkTasks.filter(t => monthIds.has(t.monthPlanId)).map(t => t.id)); let n = 0; for (const c of db.checkins) for (const it of c.items || []) if (taskIds.has(it.taskId) && it.isFinish) n++; return n }

// ---------- 年计划 ↔ 月计划绑定（2026-09-09） ----------
export function boundPlans(yearPlanId) { return db.monthPlans.filter(p => p.yearPlanId === yearPlanId) }
export function yearPlanOfMonth(mp) { return mp?.yearPlanId ? db.yearPlans.find(y => y.id === mp.yearPlanId) || null : null }
export function rebindMonth(mpId, yearPlanId) {
  const p = db.monthPlans.find(x => x.id === mpId); if (!p) return
  p.yearPlanId = yearPlanId || null
  const y = yearPlanId ? db.yearPlans.find(yy => yy.id === yearPlanId) : null
  notify(y ? `「${p.name}」已绑定到「${y.name}」，其打卡计入年度累计` : `「${p.name}」已改为独立月计划（不计入年度累计）`)
}

// ---------- 分类统计 ----------
export const catScope = ref('month')
export function catStatsOf(category, year, month) { let n = 0; for (const c of db.checkins) for (const it of c.items || []) { const t = taskOf(it.taskId); if (!t || t.category !== category || !it.isFinish) continue; const cd = c.checkDate; if (year && +cd.slice(0, 4) !== +year) continue; if (month && +cd.slice(5, 7) !== +month) continue; n++ } return n }
export function catCount(category) { let n = 0; for (const c of db.checkins) for (const it of c.items || []) { const t = taskOf(it.taskId); if (t?.category === category && it.isFinish) n++ } return n }
export const catRows = computed(() => db.categories.map(c => ({ name: c, color: catColor(c), count: catCount(c), tasks: db.checkTasks.filter(t => t.category === c).length })).filter(r => r.tasks > 0 || r.count > 0).sort((a, b) => b.count - a.count))

// ---------- 趋势 / 连续打卡 ----------
// 近 7 天 / 连续打卡：日期键一律走 dateKey（本地日期）。用 toISOString() 会在东八区差一天，
// 表现为「今天明明打卡了，连续天数还是 0」。
export const last7days = computed(() => { const arr = []; const now = new Date(); for (let i = 6; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); const key = dateKey(d); const c = db.checkins.find(x => x.checkDate === key); const total = c?.items?.filter(i => i.isFinish).length || 0; arr.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, count: total }) } return arr })
export const weekRate = computed(() => { const arr = last7days.value; const doneDays = arr.filter(d => d.count > 0).length; return Math.round(doneDays / 7 * 100) })
export const streak = computed(() => {
  const doneDates = new Set(db.checkins.filter(c => c.items?.some(i => i.isFinish)).map(c => c.checkDate))
  if (!doneDates.size) return 0
  let n = 0
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (!doneDates.has(dateKey(d))) d.setDate(d.getDate() - 1)
  while (doneDates.has(dateKey(d))) { n++; d.setDate(d.getDate() - 1) }
  return n
})
export const focusTodos = computed(() => {
  const rec = currentRecord.value
  if (!rec) return []
  return rec.items.map(it => { const t = taskOf(it.taskId); if (!t) return null; const p = planOf(it.taskId); return { it, task: t, plan: p, color: catColor(t.category) } }).filter(Boolean)
})
export function toggleFocus(row) {
  const it = row.it
  it.isFinish = !it.isFinish
  it.updateTime = Date.now()
  pushSync()
}

// ---------- 知识打卡（2026-10-23）----------
// 知识库任意一条可以「打卡」，记进当天的每日打卡记录（daily_checkins.items）。
// 用 kind:'knowledge' 与计划打卡项区分开：focusTodos / dailyList 靠 taskId 找任务，找不到自动忽略，
// 所以「今日完成 %」的分母不会被阅读篇数稀释。
// 但 streak 判的是 items.some(isFinish)，当天读过一篇就算今天打过卡 —— 这是有意的。
// 一律记「今天」，不受打卡页日期选择器影响（知识库本身没有日期概念）。
export const readItems = computed(() => {
  const rec = db.checkins.find(c => c.checkDate === today())
  return rec ? (rec.items || []).filter(it => it.kind === 'knowledge' && it.isFinish) : []
})
export const readToday = computed(() => readItems.value.length)
export const readIds = computed(() => new Set(readItems.value.map(it => it.kbId)))
export async function toggleKnowledgeCheck(kb) {
  if (!kb || !kb.id) return undefined
  const rec = syncDayItems(today())   // 当天记录不存在就建一条
  const snapshot = rec.items.map(it => ({ ...it }))
  const i = rec.items.findIndex(it => it.kind === 'knowledge' && it.kbId === kb.id)
  const added = i < 0
  if (i >= 0) {
    rec.items.splice(i, 1)
  } else {
    // 存一份标题快照：知识库条目以后被删掉，打卡记录里仍然读得懂今天读了什么
    rec.items.push({
      kind: 'knowledge', kbId: kb.id, title: kb.title || '', originDate: kb.originDate || today(),
      isFinish: true, note: '', createTime: Date.now()
    })
  }
  rec.updateTime = Date.now()
  try {
    // 直接写库（不走全量 PUT）；成功就用服务端回传的当天 items 覆盖本地，两边永远一致
    const res = await saveKnowledgeCheck({
      kbId: kb.id, title: kb.title || '', originDate: kb.originDate || today(), remove: !added
    })
    if (res && Array.isArray(res.items)) {
      rec.items = res.items
      rec.updateTime = Date.now()
    }
    return added
  } catch {
    // 写库失败就撤回本地状态：宁可显示没打上，也不能让人以为存进数据库了
    rec.items = snapshot
    rec.updateTime = Date.now()
    notify('打卡没存进数据库，已撤回')
    return undefined
  }
}
export async function removeKnowledgeCheck(kbId) {
  const rec = db.checkins.find(c => c.checkDate === today())
  if (!rec) return
  const i = rec.items.findIndex(it => it.kind === 'knowledge' && it.kbId === kbId)
  if (i < 0) return
  const snapshot = rec.items.map(it => ({ ...it }))
  rec.items.splice(i, 1)
  rec.updateTime = Date.now()
  try {
    await saveKnowledgeCheck({ kbId, remove: true })
  } catch {
    rec.items = snapshot
    rec.updateTime = Date.now()
    notify('取消打卡没同步到数据库')
  }
}

// ---------- 资金领域 ----------
export const allIncome = computed(() => db.transactions.filter(t => t.type === 'income').reduce((s, t) => s + +t.amount, 0))
export const allExpense = computed(() => db.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + +t.amount, 0))
export const totalBalance = computed(() => +db.finance.openingBalance + allIncome.value - allExpense.value)
export const monthIncome = computed(() => db.transactions.filter(t => t.type === 'income' && (t.date || '').startsWith(txFilter.month)).reduce((s, t) => s + +t.amount, 0))
export const monthExpense = computed(() => db.transactions.filter(t => t.type === 'expense' && (t.date || '').startsWith(txFilter.month)).reduce((s, t) => s + +t.amount, 0))
export const budgetLeft = computed(() => +db.finance.monthBudget - monthExpense.value)
export const expenseByCat = computed(() => { const out = {}; for (const t of db.transactions) if (t.type === 'expense' && (t.date || '').startsWith(txFilter.month)) out[t.category] = (out[t.category] || 0) + +t.amount; return out })
export const expenseCatTotal = computed(() => Object.values(expenseByCat.value).reduce((s, v) => s + v, 0))
export const monthStats = computed(() => { const out = []; const now = new Date(); for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const inc = db.transactions.filter(t => t.type === 'income' && (t.date || '').startsWith(key)).reduce((s, t) => s + +t.amount, 0); const exp = db.transactions.filter(t => t.type === 'expense' && (t.date || '').startsWith(key)).reduce((s, t) => s + +t.amount, 0); out.push({ key, label: `${d.getMonth() + 1}月`, income: inc, expense: exp }) } return out })
export const shownTx = computed(() => { const list = db.transactions.filter(t => (t.date || '').startsWith(txFilter.month)); return list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id)) })
export function addTx() { const amt = +txForm.amount; if (!amt || amt <= 0) return notify('请输入有效金额'); addTransaction({ id: uid(), type: txForm.type, amount: amt, date: txForm.date, category: txForm.category, note: txForm.note.trim(), createTime: Date.now() }); txForm.amount = ''; txForm.note = ''; notify('已记一笔') }
export function applyFinance() { const a = +finForm.openingBalance; const b = +finForm.monthBudget; updateFinance(a, b); financeEdit.value = false; notify('账户设置已保存') }

// ---------- 每日发现 / 知识库 ----------
export async function openDiscover(item = null) { editingDiscover.value = item; discoverForm.recordDate = item?.recordDate || today(); discoverForm.title = item?.title || ''; discoverForm.source = item?.source || ''; discoverForm.link = item?.link || ''; discoverForm.content = item?.content || ''; discoverForm.tagsText = (item?.tags || []).join(','); discoverOpen.value = true; if (item?.id && !item.content) { try { const full = await fetchDiscover(item.id); if (editingDiscover.value?.id === item.id) { discoverForm.content = full.content || ''; if (!discoverForm.link) discoverForm.link = full.link || '' } } catch { /* 取不到全文就留空，避免把已有正文覆盖成空 */ discoverForm.content = '__LOAD_FAILED__' } } }
export async function saveDiscover() { if (!discoverForm.title.trim()) return notify('请填写标题'); const tags = discoverForm.tagsText.split(/[,，]/).map(s => s.trim()).filter(Boolean); const data = { recordDate: discoverForm.recordDate, title: discoverForm.title.trim(), source: discoverForm.source.trim(), link: discoverForm.link.trim(), content: discoverForm.content.trim() === '__LOAD_FAILED__' ? '' : discoverForm.content.trim(), tags }; try { const res = await saveDiscoverItem(data); const saved = res?.item; if (saved?.id) { const row = { ...data, id: saved.id, series: saved.series || '', period: saved.period || null, excerpt: data.content.slice(0, 180), createTime: saved.createTime || Date.now(), updateTime: Date.now() }; const i = db.discovers.findIndex(d => d.id === saved.id); if (i >= 0) db.discovers.splice(i, 1, row); else db.discovers.unshift(row) } discoverOpen.value = false } catch { /* saveDiscoverItem 已提示失败 */ } }
// 知识库来源以用户填写的 sourceLabel 为准（source 恒为 'import'，仅表 provenance）
// 筛选下拉的可选项：知识库来源/标签由分页接口的 facets 提供（按全库算），每日发现仍从本地取
export const allSources = computed(() => Array.from(new Set([...db.discovers.map(d => d.source), ...knowledgePager.sources].filter(Boolean))))
export const allTags = computed(() => Array.from(new Set([...db.discovers.flatMap(d => d.tags || []), ...knowledgePager.tags].filter(Boolean))))

export function openKnowledge(item = null) { editingKnowledge.value = item; filters.keyword = ''; filters.source = ''; filters.tag = ''; filters.start = ''; filters.end = ''; knowledgeOpen.value = true }
// 知识库列表改为服务端分页（见 loadKnowledgePage），不再在前端对全量做过滤

// ---------- 思维导图 ----------
export const MM_WIDTH = 1200, MM_HEIGHT = 720
export const mmExpanded = reactive({})
export const mmHovered = ref(null)
export const mmPan = reactive({ x: 0, y: 0 })
export const mmZoom = ref(1)
export const mmDragging = ref(false)
let mmStart = null
export const mmBranches = [
  { id: 'home', label: '工作台', color: '#4a9e66', page: 'home', children: [
    { id: 'home-greet', label: '问候卡', desc: '今日日期 / 问候语 / 已完成进度' },
    { id: 'home-ring', label: '进度环', desc: '今日完成度圆环 + 数字滚动' },
    { id: 'home-trend', label: '近7天趋势', desc: '柱状图每日完成打卡数' },
    { id: 'home-streak', label: '连续打卡', desc: '当前连续天数统计' },
    { id: 'home-knowledge', label: '知识沉淀', desc: '已记录的笔记条数' }
  ] },
  { id: 'check', label: '计划打卡', color: '#6a7ff5', page: 'checkin', children: [
    { id: 'check-year', label: '年计划', desc: '绑定年份 + 分类 + 累计完成' },
    { id: 'check-month', label: '月计划', desc: '绑定年月 + 关联年计划' },
    { id: 'check-task', label: '打卡项', desc: '最小打卡单元 + 分类标签' },
    { id: 'check-daily', label: '每日打卡', desc: '今日勾选 + 备注 + 自动保存' },
    { id: 'check-cat', label: '分类统计', desc: '按分类精确完成次数' }
  ] },
  { id: 'finance', label: '资金管理', color: '#e9a23b', page: 'finance', children: [
    { id: 'fin-config', label: '账户设置', desc: '期初本金 + 每月预算' },
    { id: 'fin-stats', label: '4 个统计卡', desc: '总存款 / 月入 / 月出 / 预算剩余' },
    { id: 'fin-month6', label: '近6月收支', desc: '柱状对比 6 个月' },
    { id: 'fin-pie', label: '本月支出分布', desc: '按类目占比' },
    { id: 'fin-tx', label: '流水明细', desc: '所有收支记录' }
  ] },
  { id: 'discover', label: '每日发现', color: '#e0567c', page: 'discover', children: [
    { id: 'disc-list', label: '发现列表', desc: '时间线展示所有发现' },
    { id: 'disc-add', label: '记录新发现', desc: '模态弹窗记录一条' },
    { id: 'disc-search', label: '搜索 / 筛选', desc: '按标题 / 来源 / 标签筛' }
  ] },
  { id: 'knowledge', label: '知识库', color: '#9b7fd4', page: 'knowledge', children: [
    { id: 'k-list', label: '笔记列表', desc: '全文搜索 + 标签筛选' },
    { id: 'k-add', label: '新建笔记', desc: '模态弹窗写一条' },
    { id: 'k-shortcut', label: '快捷键 Ctrl+K', desc: '聚焦搜索框' }
  ] }
]
export function mmLayout() {
  const cx = MM_WIDTH / 2, cy = MM_HEIGHT / 2 + 30
  const branchR = 230, childR = 130
  const n = mmBranches.length
  const baseAngle = -Math.PI / 2 + Math.PI / n
  const nodes = []
  const links = []
  nodes.push({ id: 'root', x: cx, y: cy, label: APP_NAME, kind: 'root' })
  mmBranches.forEach((b, i) => {
    const a = baseAngle + (i * 2 * Math.PI) / n
    const bx = cx + branchR * Math.cos(a)
    const by = cy + branchR * Math.sin(a)
    nodes.push({ id: b.id, x: bx, y: by, label: b.label, color: b.color, kind: 'branch', page: b.page, count: b.children.length })
    links.push({ from: 'root', to: b.id })
    if (mmExpanded[b.id]) {
      const m = b.children.length
      const spread = Math.min(Math.PI * 0.85, m * 0.32)
      b.children.forEach((c, j) => {
        const ca = a + (j - (m - 1) / 2) * (spread / Math.max(1, m - 1))
        const nx = bx + childR * Math.cos(ca)
        const ny = by + childR * Math.sin(ca)
        nodes.push({ id: c.id, parent: b.id, x: nx, y: ny, label: c.label, desc: c.desc, color: b.color, kind: 'child' })
        links.push({ from: b.id, to: c.id })
      })
    }
  })
  return { nodes, links }
}
export function mmCurve(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  const off = Math.min(40, len * 0.18)
  return `M ${x1} ${y1} Q ${mx + nx * off} ${my + ny * off} ${x2} ${y2}`
}
export function mmGo(node) {
  const branch = mmBranches.find(b => b.children.includes(node) || b.id === node.id)
  if (branch) page.value = branch.page
}
export function mmReset() { mmZoom.value = 1; mmPan.x = 0; mmPan.y = 0 }
export function mmOnWheel(e) { e.preventDefault(); mmZoom.value = Math.max(0.45, Math.min(2.4, mmZoom.value + (e.deltaY > 0 ? -0.08 : 0.08))) }
export function mmOnDown(e) { mmDragging.value = true; mmStart = { x: e.clientX - mmPan.x, y: e.clientY - mmPan.y } }
export function mmOnMove(e) { if (!mmDragging.value || !mmStart) return; mmPan.x = e.clientX - mmStart.x; mmPan.y = e.clientY - mmStart.y }
export function mmOnUp() { mmDragging.value = false; mmStart = null }