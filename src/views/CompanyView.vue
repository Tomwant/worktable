<script setup>
// 好公司：研究档案，不是评分器。
// 财报来自 SEC 官方 XBRL，行情来自东方财富；系统只负责把事实摆齐，判断留给人。
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { api } from '../lib/api.js'
import { notify, notifyError, toast, toastError } from '../lib/toast.js'
import { money, pctTxt, num, capTxt, sign, chgClass, priceTxt } from '../lib/format.js'
import { useDetailRoute } from '../lib/useDetailRoute.js'
import AppEmpty from '../components/AppEmpty.vue'
import AppSeg from '../components/AppSeg.vue'
import AppButton from '../components/AppButton.vue'
import AppFace from '../components/AppFace.vue'

const list = ref([])
const detail = ref(null)
const loading = ref(true)
const adding = ref(false)
const refreshing = ref(false)
const reloading = ref(false)
const addCode = ref('')
const kw = ref('')
// toast / toastError 由全局 lib/toast.js 提供，这里不再自建一份
const range = ref(1)
const finKey = ref('revenue')
const editing = ref(false)
const draft = ref(null)
const memoDraft = ref('')
const memoBusy = ref(false)
// 我的判断：这一块自己管编辑态，不再借用整页的 editing，避免牵动业务/历史/链接
const noteKey = ref('')      // 当前正在写的格子（空 = 全部只读）
const noteVal = ref('')      // 当前格子的临时值
const noteFlash = ref('')    // 刚存成功的格子，闪一下「已保存」
let noteTimer = null

const CHECK_ITEMS = [
  { k: 'moat', t: '护城河', q: '客户为什么换不掉它？换个供应商的代价有多大？' },
  { k: 'mgmt', t: '管理层', q: '过去 5 年说过的话兑现了多少？有没有乱花钱（高价并购、乱扩产）？' },
  { k: 'space', t: '行业空间', q: '这个生意的天花板在哪里？它是分蛋糕的还是在做新的蛋糕？' },
  { k: 'quality', t: '钱的质量', q: '净利润有多少真的变成了现金？会不会是应收账款堆出来的利润？' },
  { k: 'risk', t: '最大风险', q: '什么情况下这笔投资会永久性亏钱？' },
  { k: 'price', t: '买入价与理由', q: '什么价位你会买？买了之后什么情况会让你改变主意？' }
]
const VERDICTS = ['待研究', '好公司', '观察中', '已否决']

// 兼容层：本文件有 20 多处 say(...) 调用，底层统一走全局 notify / notifyError
const say = (text, bad = false) => bad ? notifyError(text) : notify(text)

// ---------- 数字格式 ----------
// money / pctTxt / num / capTxt / sign / chgClass / priceTxt 全部来自 lib/format.js，这里不再重复定义

const verdictClass = v => v === '好公司' ? 'tag-core' : v === '观察中' ? 'tag-watch' : v === '已否决' ? 'tag-no' : 'tag-no'

const filtered = computed(() => {
  const q = kw.value.trim().toUpperCase()
  if (!q) return list.value
  return list.value.filter(c =>
    c.ticker.includes(q) ||
    (c.nameCn || '').toUpperCase().includes(q) ||
    (c.nameEn || '').toUpperCase().includes(q) ||
    (c.sector || '').toUpperCase().includes(q)
  )
})

// ---------- 列表 ----------

async function loadList() {
  loading.value = true
  try {
    const data = await api('/api/companies')
    list.value = data.items || []
  } catch (e) {
    say('加载失败：' + e.message, true)
  } finally {
    loading.value = false
  }
}

async function addCompany() {
  const code = addCode.value.trim()
  if (!code || adding.value) return
  adding.value = true
  say(`正在抓 ${code.toUpperCase()} 的财报和行情，一般 3～8 秒…`)
  try {
    const data = await api('/api/companies', { method: 'POST', body: JSON.stringify({ ticker: code }) })
    addCode.value = ''
    await loadList()
    if (data.item) {
      openCompany(data.item.ticker)
      say(data.existed ? `${data.item.nameCn || data.item.ticker} 已更新为最新数据` : `${data.item.nameCn || data.item.ticker} 已加入`)
    }
  } catch (e) {
    say(e.message, true)
  } finally {
    adding.value = false
  }
}

async function removeCompany(c) {
  if (!confirm(`确定把「${c.nameCn || c.ticker}」从档案里删掉？\n\n财报和行情会一起删，你写的业务、历史和判断也会没。`)) return
  try {
    await api(`/api/companies/${c.ticker}`, { method: 'DELETE' })
    list.value = list.value.filter(x => x.ticker !== c.ticker)
    if (detail.value && detail.value.ticker === c.ticker) closeDetail()
    say('已删除')
  } catch (e) {
    say(e.message, true)
  }
}

// ---------- 详情 ----------

async function openCompany(ticker) {
  loading.value = true
  try {
    const data = await api(`/api/companies/${ticker}`)
    detail.value = data.item
    range.value = 1
    finKey.value = 'revenue'
    editing.value = false
    noteKey.value = ''
    noteVal.value = ''
    pushRoute(ticker)
    window.scrollTo(0, 0)
  } catch (e) {
    say(e.message, true)
  } finally {
    loading.value = false
  }
}

// 清详情态（关详情 / 浏览器后退都要走到这里）
function clearDetail() {
  detail.value = null
  editing.value = false
  noteKey.value = ''
  noteVal.value = ''
}
// 二级视图的压历史 / 后退逻辑由 lib/useDetailRoute 统一提供
const { push: pushRoute, back: backRoute } = useDetailRoute({
  key: 'co',
  isOpen: () => !!detail.value,
  close: clearDetail
})
const closeDetail = () => backRoute()

async function refreshQuote() {
  if (!detail.value || refreshing.value) return
  refreshing.value = true
  try {
    const data = await api(`/api/companies/${detail.value.ticker}/refresh`, { method: 'POST' })
    detail.value.quote = { ...detail.value.quote, ...data.quote }
    say('行情已刷新：' + detail.value.ticker)
    loadList()
  } catch (e) {
    say(e.message, true)
  } finally {
    refreshing.value = false
  }
}

// 全量更新：财报 + 行情 + 公司档案一起重抓。
// 人工写的（业务/历史/判断/备忘/官网/自定义链接）后端会保住，所以可以放心点。
async function reloadAll() {
  const d = detail.value
  if (!d || reloading.value) return
  const label = d.exchange ? `${d.exchange}: ${d.ticker}` : d.ticker
  reloading.value = true
  const t0 = Date.now()
  say(`正在重抓 ${label} 的财报与行情，通常 3～10 秒…`)
  try {
    const data = await api(`/api/companies/${d.ticker}/reload`, { method: 'POST' })
    if (data.item) detail.value = data.item
    const n = data.item && data.item.fin ? data.item.fin.length : 0
    say(`${label} 已更新：${n} 个财年 · ${((Date.now() - t0) / 1000).toFixed(1)} 秒`)
    loadList()
  } catch (e) {
    say(label + ' 更新失败：' + e.message, true)
  } finally {
    reloading.value = false
  }
}

async function copyTicker() {
  const t = detail.value && detail.value.ticker
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
    say('已复制代码 ' + t)
  } catch {
    say('复制失败，手动选中代码吧', true)
  }
}

// ---------- 手写字段 ----------

function startEdit() {
  const d = detail.value
  draft.value = {
    biz: d.biz || '',
    segments: (d.segments || []).map(s => [s[0], s[1]]),
    history: (d.history || []).map(h => [h[0], h[1]]),
    website: (d.info && d.info.website) || '',
    links: ((d.info && d.info.links) || []).map(l => ({ label: l.label || '', url: l.url || '' }))
  }
  editing.value = true
}

function addSeg() { draft.value.segments.push(['', 0]) }
function delSeg(i) { draft.value.segments.splice(i, 1) }
function addHist() { draft.value.history.push(['', '']) }
function delHist(i) { draft.value.history.splice(i, 1) }
function addLink() { draft.value.links.push({ label: '', url: '' }) }
function delLink(i) { draft.value.links.splice(i, 1) }

async function saveEdit() {
  const d = detail.value
  const payload = {
    biz: draft.value.biz,
    segments: draft.value.segments.filter(s => String(s[0] || '').trim()),
    history: draft.value.history.filter(h => String(h[0] || '').trim() || String(h[1] || '').trim()),
    info: {
      website: String(draft.value.website || '').trim(),
      links: draft.value.links.filter(l => String(l.url || '').trim())
    }
  }
  try {
    const data = await api(`/api/companies/${d.ticker}`, { method: 'PATCH', body: JSON.stringify(payload) })
    detail.value = { ...detail.value, ...payload, info: data.item ? data.item.info : payload.info }
    editing.value = false
    say('已保存')
    loadList()
  } catch (e) {
    say(e.message, true)
  }
}

function cancelEdit() {
  editing.value = false
  draft.value = null
}

// 我的判断：只发 notes，业务/历史/链接完全不受影响
async function patchNotes(next, okText) {
  const d = detail.value
  if (!d) return false
  try {
    const data = await api(`/api/companies/${d.ticker}`, { method: 'PATCH', body: JSON.stringify({ notes: next }) })
    d.notes = data.item ? data.item.notes : next
    const row = list.value.find(x => x.ticker === d.ticker)
    if (row) row.notes = d.notes
    if (okText) say(okText)
    return true
  } catch (e) {
    say(e.message, true)
    return false
  }
}

function openNote(k) {
  const d = detail.value
  if (!d || noteKey.value === k) return
  if (noteKey.value) commitNote()
  noteVal.value = (d.notes && d.notes[k]) || ''
  noteKey.value = k
  nextTick(() => {
    const ta = document.querySelector('.check textarea')
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) }
  })
}

// 失焦即存：没改动不发请求，失败则退回编辑态别让写的东西丢掉
async function commitNote() {
  const k = noteKey.value
  if (!k) return
  const d = detail.value
  const val = String(noteVal.value || '').trim()
  const old = (d.notes && d.notes[k]) || ''
  noteKey.value = ''
  noteVal.value = ''
  if (val === old) return
  const next = { ...(d.notes || {}), [k]: val }
  const ok = await patchNotes(next)
  if (!ok) {
    if (!noteKey.value) { noteKey.value = k; noteVal.value = val }
    return
  }
  clearTimeout(noteTimer)
  noteFlash.value = k
  noteTimer = setTimeout(() => { noteFlash.value = '' }, 2200)
}

function cancelNote() {
  noteKey.value = ''
  noteVal.value = ''
}

// 结论按钮：不用进任何编辑态，点了立刻存
async function setVerdict(v) {
  const d = detail.value
  if (!d) return
  const next = { ...(d.notes || {}), verdict: v }
  if (await patchNotes(next, '结论已记下：' + v)) {
    if (noteKey.value) { noteKey.value = ''; noteVal.value = '' }
  }
}

// ---------- 研究笔记（随时记，不用进编辑模式） ----------

const memoSorted = computed(() => {
  const arr = (detail.value && detail.value.memo) || []
  // 按时间倒序显示，但要记住原始下标，否则删错条
  return arr.map((m, i) => ({ ...m, idx: i })).sort((a, b) => (b.at || 0) - (a.at || 0))
})

function fmtAt(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function saveMemo(list, okText) {
  const d = detail.value
  if (!d || memoBusy.value) return false
  memoBusy.value = true
  try {
    const data = await api(`/api/companies/${d.ticker}`, { method: 'PATCH', body: JSON.stringify({ memo: list }) })
    detail.value.memo = data.item ? data.item.memo : list
    say(okText)
    loadList()
    return true
  } catch (e) {
    say(e.message, true)
    return false
  } finally {
    memoBusy.value = false
  }
}

async function addMemo() {
  const text = memoDraft.value.trim()
  if (!text || memoBusy.value || !detail.value) return
  const next = [...((detail.value.memo) || []), { at: Date.now(), text }]
  // 存成功才清输入框，失败时内容留着，免得多年前的灵感白打一遍
  if (await saveMemo(next, '已记下')) memoDraft.value = ''
}

async function delMemo(idx) {
  if (!detail.value) return
  if (!confirm('删掉这条笔记？删了找不回来。')) return
  const next = (detail.value.memo || []).filter((_, i) => i !== idx)
  await saveMemo(next, '已删除')
}

// ---------- 详情派生字段 ----------

const info = computed(() => (detail.value && detail.value.info) || {})

// SEC 的申报人档位，原文是英文，直接摆上去看不懂
const FILER_TXT = {
  'Large accelerated filer': '大型加速申报人',
  'Accelerated filer': '加速申报人',
  'Non-accelerated filer': '非加速申报人',
  'Smaller reporting company': '小型报告公司',
  'Emerging growth company': '新兴成长公司'
}
const filerTxt = computed(() => FILER_TXT[info.value.category] || info.value.category || '—')

// 财报和行情分开显示：行情天天变，财报一年也就几次，「一个时间」会骗人
const syncTxt = computed(() => {
  const d = detail.value
  if (!d) return ''
  const fin = d.finSyncAt ? fmtAt(d.finSyncAt).slice(5) : '还没记'
  const q = d.quote && d.quote.quoteTime ? fmtAt(d.quote.quoteTime).slice(5) : '—'
  return `财报 ${fin} · 行情 ${q}`
})

// ---------- 图表 ----------

// 刻度：把 min~max 扩成「整数好读」的档位（1 / 2 / 5 × 10^n）。
// 直接四等分会得到 372.61 这种坐标轴，没人看得下去
function niceTicks(values, count = 4) {
  const vs = values.filter(v => v != null && Number.isFinite(v))
  if (!vs.length) return null
  let lo = Math.min(...vs)
  let hi = Math.max(...vs)
  if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d }
  const raw = (hi - lo) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  // 阈值用 1.5 / 3 / 7：2.3 这种值若按 <=5 取整会跳到 5，刻度一下变得很稀
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const min = Math.floor(lo / step) * step
  const max = Math.ceil(hi / step) * step
  const ticks = []
  for (let v = min; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(6))
  return { min, max, ticks, step }
}

// 刻度值 → 「距顶部百分之几」。轴不能画进折线 svg：
// 那个 svg 用了 preserveAspectRatio="none"，宽度一拉伸，里面的文字会横向变形，
// 所以横线和刻度文字单独用一层 HTML 绝对定位。
function axisRows(axis, vbH, pad) {
  if (!axis) return []
  const inner = vbH - pad * 2
  return axis.ticks.map(v => ({
    v,
    pct: (pad + inner * (1 - (v - axis.min) / (axis.max - axis.min || 1))) / vbH * 100
  }))
}

// 折线：把数值映射到 viewBox 内，返回 path 与面积。
// domain 传刻度区间，曲线才和坐标轴对得上（不传则退回数据自身的 min/max）
function linePath(values, w, h, domain = null, pad = 8) {
  const pts = values.map((v, i) => [i, v])
  const vs = values.filter(v => v != null && Number.isFinite(v))
  if (vs.length < 2) return null
  const min = Math.min(...vs)
  const max = Math.max(...vs)
  const lo = domain ? domain.min : min
  const hi = domain ? domain.max : max
  const span = (hi - lo) || 1
  const stepX = (w - pad * 2) / Math.max(1, pts.length - 1)
  const y = v => pad + (h - pad * 2) * (1 - (v - lo) / span)
  let d = ''
  let started = false
  pts.forEach(([i, v]) => {
    if (v == null || !Number.isFinite(v)) { started = false; return }
    const x = pad + stepX * i
    d += (started ? 'L' : 'M') + x.toFixed(1) + ' ' + y(v).toFixed(1) + ' '
    started = true
  })
  const ids = pts.map(([i, v]) => ({ i, v })).filter(p => p.v != null && Number.isFinite(p.v))
  const first = ids[0], last = ids[ids.length - 1]
  const area = d + `L${(pad + stepX * last.i).toFixed(1)} ${h - pad} L${(pad + stepX * first.i).toFixed(1)} ${h - pad} Z`
  return { d, area, min, max, y }
}

const priceTicks = v => {
  const a = Math.abs(v)
  if (a >= 1000) return '$' + Math.round(v).toLocaleString('en-US')
  return '$' + (a >= 100 ? v.toFixed(0) : v.toFixed(2))
}

const priceChart = computed(() => {
  const d = detail.value
  if (!d || !d.kline || d.kline.length < 2) return null
  const years = range.value
  const cut = new Date()
  cut.setFullYear(cut.getFullYear() - years)
  const limit = cut.toISOString().slice(0, 10)
  const rows = d.kline.filter(k => k.d >= limit)
  const use = rows.length >= 2 ? rows : d.kline
  const values = use.map(k => k.close)
  const axis = niceTicks(values, 4)
  const geo = linePath(values, 900, 190, axis)
  if (!geo) return null
  const lastIdx = values.length - 1
  return {
    ...geo,
    rows: use,
    first: values[0],
    last: values[lastIdx],
    axis: axisRows(axis, 190, 8),
    // 末点纵向位置（百分比）：用来在图上标「当前价」
    dotPct: geo.y(values[lastIdx]) / 190 * 100
  }
})

const FIN_SERIES = {
  revenue: { label: '营收', fmt: money },
  netIncome: { label: '净利润', fmt: money },
  fcf: { label: '自由现金流', fmt: money },
  roe: { label: 'ROE', fmt: pctTxt }
}

const finChart = computed(() => {
  const d = detail.value
  if (!d || !d.fin || d.fin.length < 2) return null
  const key = finKey.value
  const values = d.fin.map(f => f[key])
  const axis = niceTicks(values, 4)
  const geo = linePath(values, 900, 170, axis)
  if (!geo) return null
  return {
    ...geo,
    values,
    fys: d.fin.map(f => f.fy),
    axis: axisRows(axis, 170, 8).map(r => ({ ...r, label: FIN_SERIES[key].fmt(r.v) }))
  }
})

// ---------- 详情派生 ----------

const lastFin = computed(() => {
  const f = detail.value && detail.value.fin
  return f && f.length ? f[f.length - 1] : null
})
const prevFin = computed(() => {
  const f = detail.value && detail.value.fin
  return f && f.length > 1 ? f[f.length - 2] : null
})
const yoy = (a, b) => (a == null || b == null || !b) ? null : +((a - b) / Math.abs(b) * 100).toFixed(1)

const bsBar = computed(() => {
  const f = lastFin.value
  if (!f || !f.assets) return null
  const liab = f.liabilities || 0
  const eq = f.equity || 0
  const minor = Math.max(0, f.assets - liab - eq)
  const toPct = v => +(v / f.assets * 100).toFixed(1)
  return {
    assets: f.assets, liab, eq, minor,
    lp: toPct(liab), ep: toPct(eq), mp: toPct(minor)
  }
})

// 财务表要展示的行（左边一列指标名）
const FIN_ROWS = [
  { k: 'revenue', t: '营业收入', fmt: money, bold: true },
  { k: 'gross', t: '毛利', fmt: money },
  { k: 'grossMargin', t: '毛利率', fmt: pctTxt, dim: true },
  { k: 'opIncome', t: '营业利润', fmt: money },
  { k: 'netIncome', t: '净利润', fmt: money, bold: true },
  { k: 'netMargin', t: '净利率', fmt: pctTxt, dim: true },
  { k: 'eps', t: '每股收益', fmt: v => v == null ? '—' : v.toFixed(2) },
  { k: 'ocf', t: '经营现金流', fmt: money },
  { k: 'capex', t: '资本开支', fmt: money },
  { k: 'fcf', t: '自由现金流', fmt: money, bold: true },
  { k: 'assets', t: '总资产', fmt: money, gap: true },
  { k: 'liabilities', t: '总负债', fmt: money },
  { k: 'equity', t: '股东权益', fmt: money },
  { k: 'cash', t: '现金', fmt: money },
  { k: 'debt', t: '长期负债', fmt: money },
  { k: 'roe', t: 'ROE', fmt: pctTxt, dim: true },
  { k: 'debtRatio', t: '资产负债率', fmt: pctTxt, dim: true }
]

const BS_ROWS = [
  { k: 'assets', t: '总资产', fmt: money, bold: true },
  { k: 'liabilities', t: '总负债', fmt: money },
  { k: 'equity', t: '股东权益', fmt: money },
  { k: 'cash', t: '现金及等价物', fmt: money },
  { k: 'debt', t: '长期负债', fmt: money, gap: true },
  { k: 'inventory', t: '存货', fmt: money },
  { k: 'receivable', t: '应收账款', fmt: money },
  { k: 'debtRatio', t: '资产负债率', fmt: pctTxt, dim: true }
]

const updatedTxt = computed(() => {
  const q = detail.value && detail.value.quote
  if (!q || !q.quoteTime) return '—'
  const d = new Date(q.quoteTime)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

onMounted(() => {
  loadList()
})
onUnmounted(() => {
  clearTimeout(noteTimer)
})
</script>

<template>
  <div class="gc">
    <!-- ================= 列表 ================= -->
    <section v-if="!detail" class="gc-list">
      <div class="hero">
        <div class="eyebrow">Good Business</div>
        <h1>先把事实摆齐，<em>判断是你的事</em></h1>
        <p>输一个美股代码，财报从 SEC 官方 10-K 抓、价格从交易所抓，十来年的数字自动铺开。业务、历史、结论由你自己写。</p>
      </div>

      <div class="toolbar">
        <div class="omnibar">
          <label class="omni-search">
            <svg class="ico" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="7" cy="7" r="4.4" /><path d="M10.4 10.4L14 14" />
            </svg>
            <input v-model="kw" placeholder="在已加入的公司里搜…" />
          </label>
          <i class="omni-div"></i>
          <label class="omni-add">
            <input
              v-model="addCode"
              placeholder="输入代码添加，如 AAPL / TSLA / BRK-B"
              :disabled="adding"
              @keydown.enter="addCompany"
            />
          </label>
          <button class="add-btn" :disabled="adding || !addCode.trim()" @click="addCompany">
            {{ adding ? '抓取中…' : '+ 添加公司' }}
          </button>
        </div>
      </div>

      <div class="hint">
        <i>◈</i>
        <div>
          这里不会给你「好 / 不好」的分数。<b>财报取自 SEC 官方 XBRL</b>（10-K 年报原文，按财年归集，净资产类指标用财年末时点值），
          <b>价格取自东方财富</b>。同一只股票再添加一次是刷新数据，不会多出一条，你写的业务和历史也不会被冲掉。
        </div>
      </div>

      <AppEmpty
        v-if="loading && !list.length"
        face="cloud"
        title="正在读取档案…"
        desc="财报从 SEC 拉原始 XBRL、行情从东方财富拉月线，第一次会慢一点。"
      />
      <AppEmpty
        v-else-if="!list.length"
        title="还没有公司"
        desc="在上面输入一个美股代码试试，比如 AAPL。"
      />
      <div v-else-if="!filtered.length" class="empty">没有匹配的公司。</div>

      <div v-else class="cards">
        <article
          v-for="c in filtered"
          :key="c.ticker"
          class="co"
          @click="openCompany(c.ticker)"
        >
          <div class="r1">
            <span class="tk">{{ c.ticker }}</span>
            <span class="nm">{{ c.nameCn || c.nameEn || c.ticker }}</span>
            <div class="px">
              <b>{{ priceTxt(c.quote && c.quote.price) }}</b>
              <i :class="chgClass(c.quote && c.quote.chgPct)">
                {{ c.quote && c.quote.chgPct != null ? sign(c.quote.chgPct) : '—' }}
              </i>
            </div>
          </div>
          <div class="sec">{{ c.sector || c.nameEn || '—' }}</div>

          <div class="kv">
            <div>
              <b>{{ c.quote ? capTxt(c.quote.capYi) : '—' }}</b>
              <span>市值</span>
            </div>
            <div>
              <b>{{ c.quote && c.quote.pe != null ? num(c.quote.pe) : '—' }}</b>
              <span>市盈率</span>
            </div>
            <div>
              <b>{{ c.latest ? money(c.latest.revenue) : '—' }}</b>
              <span>{{ c.latest ? 'FY' + c.latest.fy + ' 营收' : '营收' }}</span>
            </div>
            <div>
              <b>{{ c.latest ? pctTxt(c.latest.roe) : '—' }}</b>
              <span>ROE</span>
            </div>
          </div>

          <div class="r4">
            <span class="tagi" :class="verdictClass(c.notes && c.notes.verdict)">{{ (c.notes && c.notes.verdict) || '待研究' }}</span>
            <span v-if="c.latest && c.latest.netIncome < 0" class="tagi tag-warn">最新财年亏损</span>
            <button class="del-btn" title="从档案删除" @click.stop="removeCompany(c)">✕</button>
            <span class="up-time">{{ c.fyCount }} 年财报</span>
          </div>
        </article>
      </div>
    </section>

    <!-- ================= 详情 ================= -->
    <section v-else class="gc-detail">
      <div class="detail-head">
        <button class="back" @click="closeDetail">← 全部公司</button>

        <div class="dh">
          <div class="left">
            <h1>
              <span>{{ detail.nameCn || detail.nameEn || detail.ticker }}</span>
              <button class="tk" :title="'点击复制代码 ' + detail.ticker" @click="copyTicker">
                {{ detail.exchange ? detail.exchange + ' : ' : '' }}{{ detail.ticker }}
              </button>
            </h1>
            <div class="sub">
              <span v-if="detail.sector">{{ detail.sector }}</span>
              <i v-if="detail.sector"></i>
              <span>{{ detail.nameEn }}</span>
              <i></i>
              <span>{{ syncTxt }}</span>
            </div>
          </div>
          <div class="price-box">
            <div class="p">{{ priceTxt(detail.quote && detail.quote.price) }}</div>
            <div class="c" :class="chgClass(detail.quote && detail.quote.chgPct)">
              {{ detail.quote && detail.quote.chgPct != null ? sign(detail.quote.chgPct) : '—' }}
            </div>
            <div class="m">市值 {{ detail.quote ? capTxt(detail.quote.capYi) : '—' }}</div>
          </div>
          <div class="dh-ops">
            <AppButton variant="primary" size="sm" :disabled="reloading" @click="reloadAll">
              {{ reloading ? '重抓中…' : '↻ 更新数据' }}
            </AppButton>
            <AppButton variant="outline" size="sm" :disabled="refreshing || reloading" @click="refreshQuote">
              {{ refreshing ? '刷新中…' : '只刷行情' }}
            </AppButton>
            <AppButton v-if="!editing" variant="outline" size="sm" @click="startEdit">编辑档案</AppButton>
            <template v-else>
              <AppButton variant="outline" size="sm" @click="cancelEdit">取消</AppButton>
              <AppButton variant="primary" size="sm" @click="saveEdit">保存</AppButton>
            </template>
          </div>
        </div>

        <div class="qstats">
          <div class="qstat">
            <b>{{ lastFin ? money(lastFin.revenue) : '—' }}</b>
            <span>{{ lastFin ? 'FY' + lastFin.fy + ' 营收' : '营收' }}</span>
            <span v-if="lastFin && prevFin" class="note">
              同比 {{ sign(yoy(lastFin.revenue, prevFin.revenue)) }}
            </span>
          </div>
          <div class="qstat">
            <b>{{ lastFin ? money(lastFin.netIncome) : '—' }}</b>
            <span>净利润</span>
            <span v-if="lastFin && prevFin" class="note">
              同比 {{ sign(yoy(lastFin.netIncome, prevFin.netIncome)) }}
            </span>
          </div>
          <div class="qstat">
            <b>{{ lastFin ? pctTxt(lastFin.grossMargin) : '—' }}</b>
            <span>毛利率</span>
          </div>
          <div class="qstat">
            <b>{{ lastFin ? pctTxt(lastFin.netMargin) : '—' }}</b>
            <span>净利率</span>
          </div>
          <div class="qstat">
            <b>{{ lastFin ? pctTxt(lastFin.roe) : '—' }}</b>
            <span>ROE</span>
          </div>
          <div class="qstat">
            <b>{{ lastFin ? pctTxt(lastFin.debtRatio) : '—' }}</b>
            <span>资产负债率</span>
          </div>
        </div>
      </div>

      <!-- 股价 -->
      <div class="block">
        <div class="block-head">
          <h2 class="with-face"><AppFace slot="page-company" />股价</h2>
          <span>前复权 · 月线收盘</span>
          <div class="right">
            <AppSeg
              v-model="range"
              variant="pill"
              :options="[{ value: 1, label: '1 年' }, { value: 3, label: '3 年' }, { value: 5, label: '5 年' }]"
            />
          </div>
        </div>
        <div class="panel">
          <div v-if="priceChart" class="chart-wrap">
            <!-- 轴单独一层 HTML：折线 svg 宽高比被拉伸，文字放进去会变形 -->
            <div class="axis">
              <div v-for="(t, i) in priceChart.axis" :key="'py' + i" class="axis-row" :style="{ top: t.pct + '%' }">
                <span class="tick">{{ priceTicks(t.v) }}</span>
                <i class="gline"></i>
              </div>
            </div>
            <div class="plot">
              <svg viewBox="0 0 900 190" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--accent)" stop-opacity=".22" />
                    <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path :d="priceChart.area" fill="url(#pg)" />
                <path :d="priceChart.d" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" />
              </svg>
              <div class="dot" :style="{ top: priceChart.dotPct + '%' }">
                <span>{{ priceTxt(priceChart.last) }}</span>
              </div>
            </div>
            <div class="chart-foot">
              <span>{{ priceChart.rows[0].d }}</span>
              <span class="mid">
                {{ range }} 年：{{ priceTxt(priceChart.first) }} → {{ priceTxt(priceChart.last) }}
                <b :class="chgClass(priceChart.last - priceChart.first)">
                  {{ priceChart.first ? sign((priceChart.last - priceChart.first) / priceChart.first * 100) : '' }}
                </b>
              </span>
              <span>{{ priceChart.rows[priceChart.rows.length - 1].d }}</span>
            </div>
          </div>
          <div v-else class="empty small">这只股票没有拉到月线数据。</div>
        </div>
      </div>

      <!-- 公司信息 -->
      <div class="block">
        <div class="block-head">
          <h2 class="with-face"><AppFace slot="page-company" />公司信息</h2>
          <span>SEC 官方档案 · 代码 {{ detail.ticker }}</span>
        </div>
        <div class="panel">
          <div class="info-grid">
            <div class="cell">
              <span>股票代码</span>
              <b class="mono">{{ detail.ticker }}</b>
              <i>{{ detail.exchange || '—' }}</i>
            </div>
            <div class="cell">
              <span>SEC CIK</span>
              <b class="mono">{{ detail.cik || '—' }}</b>
            </div>
            <div class="cell">
              <span>行业分类</span>
              <b>{{ detail.sector || info.sicDesc || '—' }}</b>
            </div>
            <div class="cell">
              <span>注册地</span>
              <b>{{ info.stateOfIncorporation || '—' }}</b>
            </div>
            <div class="cell">
              <span>财年截止</span>
              <b class="mono">{{ info.fiscalYearEnd || '—' }}</b>
            </div>
            <div class="cell">
              <span>申报人档位</span>
              <b>{{ filerTxt }}</b>
            </div>
            <div class="cell wide">
              <span>总部</span>
              <b>{{ info.address || '—' }}</b>
              <i v-if="info.phone">{{ info.phone }}</i>
            </div>
          </div>

          <div class="links">
            <a v-if="info.website" :href="info.website" target="_blank" rel="noopener noreferrer" class="lk on">官网 ↗</a>
            <span v-else class="lk">官网未填</span>
            <a v-if="info.annualUrl" :href="info.annualUrl" target="_blank" rel="noopener noreferrer" class="lk on">
              最近年报 {{ info.annualForm }}<template v-if="info.annualDate"> · {{ info.annualDate }}</template> ↗
            </a>
            <a v-if="info.filingsUrl" :href="info.filingsUrl" target="_blank" rel="noopener noreferrer" class="lk on">SEC 全部申报 ↗</a>
            <a v-if="info.emUrl" :href="info.emUrl" target="_blank" rel="noopener noreferrer" class="lk on">东方财富行情 ↗</a>
            <a
              v-for="(l, i) in (info.links || [])"
              :key="'lk' + i"
              :href="l.url"
              target="_blank"
              rel="noopener noreferrer"
              class="lk on"
            >{{ l.label || l.url }} ↗</a>
          </div>

          <div v-if="editing" class="info-edit">
            <label class="fl">官网</label>
            <input v-model="draft.website" placeholder="https://www.example.com" />
            <label class="fl">自定义链接（研报、雪球、电话会纪要…）</label>
            <div class="rows">
              <div v-for="(l, i) in draft.links" :key="'el' + i" class="row">
                <input v-model="l.label" placeholder="名称" class="yr" />
                <input v-model="l.url" placeholder="https://…" />
                <button class="rm" @click="delLink(i)">✕</button>
              </div>
              <button class="add-line" @click="addLink">+ 加链接</button>
            </div>
          </div>

          <div class="info-note">
            行业、注册地、财年截止、申报人档位、年报直链由 SEC 自动维护，点「更新数据」会跟着刷新；
            <b>官网和自定义链接只属于你</b>，重抓不会覆盖。
          </div>
        </div>
      </div>

      <!-- 业务 -->
      <div class="block">
        <div class="block-head">
          <h2 class="with-face"><AppFace slot="page-company" />业务</h2>
          <span>{{ editing ? '改完点右上角保存' : '这家公司靠什么赚钱' }}</span>
          <div class="right">
            <AppButton v-if="!editing" variant="outline" size="sm" @click="startEdit">编辑</AppButton>
            <template v-else>
              <AppButton variant="outline" size="sm" @click="cancelEdit">取消</AppButton>
              <AppButton variant="primary" size="sm" @click="saveEdit">保存</AppButton>
            </template>
          </div>
        </div>
        <div class="panel">
          <div v-if="!editing" class="biz-grid">
            <div v-if="detail.biz" class="biz-text">{{ detail.biz }}</div>
            <div v-else class="biz-text empty-inline">
              还没写。点右上角「编辑」，用两三句话说清它靠什么赚钱、钱从哪一块来。
            </div>
            <div v-if="detail.segments && detail.segments.length" class="seg-bars">
              <div v-for="(s, i) in detail.segments" :key="i" class="seg-row">
                <span class="nm" :title="s[0]">{{ s[0] }}</span>
                <span class="bar"><i :style="{ width: Math.max(2, Math.min(100, s[1])) + '%' }"></i></span>
                <span class="pc">{{ s[1] }}%</span>
              </div>
            </div>
          </div>
          <div v-else class="edit-grid">
            <label class="fl">业务描述</label>
            <textarea v-model="draft.biz" rows="4" placeholder="用两三句话说清它靠什么赚钱"></textarea>

            <label class="fl">收入结构（%）</label>
            <div class="rows">
              <div v-for="(s, i) in draft.segments" :key="'s' + i" class="row">
                <input v-model="s[0]" placeholder="业务板块" />
                <input v-model.number="s[1]" type="number" min="0" max="100" class="narrow" />
                <span class="unit">%</span>
                <button class="rm" @click="delSeg(i)">✕</button>
              </div>
              <button class="add-line" @click="addSeg">+ 加一块</button>
            </div>

            <label class="fl">历史沿革（年 / 发生了什么）</label>
            <div class="rows">
              <div v-for="(h, i) in draft.history" :key="'h' + i" class="row">
                <input v-model="h[0]" placeholder="2003" class="yr" />
                <input v-model="h[1]" placeholder="发生了什么" />
                <button class="rm" @click="delHist(i)">✕</button>
              </div>
              <button class="add-line" @click="addHist">+ 加一条</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 历史 -->
      <div v-if="!editing" class="block">
        <div class="block-head"><h2 class="with-face"><AppFace slot="page-company" />历史</h2><span>关键节点 · 看得懂它怎么走到今天</span></div>
        <div class="panel">
          <div v-if="detail.history && detail.history.length" class="hist">
            <div v-for="(h, i) in detail.history" :key="i" class="hist-row">
              <span class="yr">{{ h[0] }}</span>
              <span class="rail"><i class="dot"></i></span>
              <span class="tx">{{ h[1] }}</span>
            </div>
          </div>
          <div v-else class="empty-inline">还没有历史记录。抓取只能拿到财报数字，公司怎么走到今天是需要你补的。</div>
        </div>
      </div>

      <!-- 年度财务 -->
      <div class="block">
        <div class="block-head">
          <h2 class="with-face"><AppFace slot="page-company" />年度财务</h2>
          <span>SEC 10-K 原文 · 单位自动换算</span>
          <div class="right">
            <div class="seg">
              <button
                v-for="(s, k) in FIN_SERIES"
                :key="k"
                :class="{ on: finKey === k }"
                @click="finKey = k"
              >{{ s.label }}</button>
            </div>
          </div>
        </div>
        <div class="panel">
          <div v-if="finChart" class="chart-wrap tight">
            <div class="axis">
              <div v-for="(t, i) in finChart.axis" :key="'fy' + i" class="axis-row" :style="{ top: t.pct + '%' }">
                <span class="tick">{{ t.label }}</span>
                <i class="gline"></i>
              </div>
            </div>
            <div class="plot">
              <svg viewBox="0 0 900 170" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--accent)" stop-opacity=".18" />
                    <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path :d="finChart.area" fill="url(#fg)" />
                <path :d="finChart.d" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" />
              </svg>
            </div>
            <div class="chart-foot">
              <span>{{ finChart.fys[0] }}</span>
              <span class="mid">{{ FIN_SERIES[finKey].label }} · 单位随数值自动换算</span>
              <span>{{ finChart.fys[finChart.fys.length - 1] }}</span>
            </div>
          </div>

          <div class="tbl-scroll">
            <table class="fin">
              <thead>
                <tr>
                  <th>财年</th>
                  <th
                    v-for="(f, i) in detail.fin"
                    :key="f.fy"
                    :class="{ cur: i === detail.fin.length - 1 }"
                  >{{ f.fy }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in FIN_ROWS" :key="row.k" :class="{ gap: row.gap }">
                  <td :style="row.bold ? 'font-weight:700' : (row.dim ? 'color:var(--text-3)' : '')">{{ row.t }}</td>
                  <td
                    v-for="f in detail.fin"
                    :key="f.fy + row.k"
                    :class="{
                      dim: row.dim,
                      neg: !row.dim && f[row.k] != null && f[row.k] < 0,
                      pos: row.dim && f[row.k] != null && f[row.k] < 0
                    }"
                  >{{ f[row.k] == null ? '—' : row.fmt(f[row.k]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="fin-note">
            <b>口径</b>：营收、利润、现金流是全年流量；总资产、总负债、股东权益是财年末时点值。
            ROE = 当年净利润 ÷ 期末股东权益；资产负债率 = 总负债 ÷ 总资产。
            苹果这类长期大额回购的公司，股东权益被压得很低，ROE 会高得离谱——不是算错，要结合负债一起看。
          </div>
        </div>
      </div>

      <!-- 资产负债 -->
      <div class="block">
        <div class="block-head"><h2 class="with-face"><AppFace slot="page-company" />资产负债</h2><span>最近一个财年末 · 钱的来源</span></div>
        <div class="panel">
          <template v-if="bsBar">
            <div class="bs-bar">
              <div v-if="bsBar.lp > 4" :style="{ flex: bsBar.lp, background: 'linear-gradient(135deg,var(--warm),#b06e2f)' }">负债 {{ bsBar.lp }}%</div>
              <div v-else-if="bsBar.lp > 0" :style="{ flex: bsBar.lp, background: 'var(--warm)' }" :title="'负债 ' + bsBar.lp + '%'"></div>
              <div v-if="bsBar.ep > 4" :style="{ flex: bsBar.ep, background: 'linear-gradient(135deg,var(--accent),var(--accent-deep))' }">股东权益 {{ bsBar.ep }}%</div>
              <div v-else-if="bsBar.ep > 0" :style="{ flex: bsBar.ep, background: 'var(--accent)' }" :title="'股东权益 ' + bsBar.ep + '%'"></div>
              <div v-if="bsBar.mp > 0.3" :style="{ flex: bsBar.mp, background: 'var(--text-3)' }" :title="'少数股东权益 ' + bsBar.mp + '%'"></div>
            </div>
            <div class="bs-legend">
              <span><i style="background:var(--warm)"></i>总负债 {{ money(bsBar.liab) }}</span>
              <span><i style="background:var(--accent)"></i>股东权益 {{ money(bsBar.eq) }}</span>
              <span v-if="bsBar.minor > 0"><i style="background:var(--text-3)"></i>少数股东权益 {{ money(bsBar.minor) }}</span>
              <span class="muted">总资产 {{ money(bsBar.assets) }}</span>
            </div>
          </template>
          <div v-else class="empty-inline">这家公司的资产负债表数据不全。</div>

          <div class="tbl-scroll mt">
            <table class="fin">
              <thead>
                <tr>
                  <th>项目</th>
                  <th v-for="f in (detail.fin || []).slice(-6)" :key="'b' + f.fy">{{ f.fy }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in BS_ROWS" :key="'b' + row.k" :class="{ gap: row.gap }">
                  <td :style="row.bold ? 'font-weight:700' : (row.dim ? 'color:var(--text-3)' : '')">{{ row.t }}</td>
                  <td
                    v-for="f in (detail.fin || []).slice(-6)"
                    :key="'b' + f.fy + row.k"
                    :class="{ dim: row.dim, neg: !row.dim && f[row.k] != null && f[row.k] < 0 }"
                  >{{ f[row.k] == null ? '—' : row.fmt(f[row.k]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 我的判断：点格子直接写，点别处自动存；不受整页「编辑档案」影响 -->
      <div class="block">
        <div class="block-head"><h2 class="with-face"><AppFace slot="page-company" />我的判断</h2><span>点格子直接写 · 点别处自动存</span></div>
        <div class="panel">
          <div class="checks">
            <div
              v-for="it in CHECK_ITEMS"
              :key="it.k"
              class="check"
              :class="{ editing: noteKey === it.k }"
              @click="openNote(it.k)"
            >
              <label>{{ it.t }}</label>
              <div class="q">{{ it.q }}</div>
              <textarea
                v-if="noteKey === it.k"
                v-model="noteVal"
                rows="3"
                placeholder="写你自己的判断…"
                @click.stop
                @blur="commitNote"
                @keydown.ctrl.enter.prevent="commitNote"
                @keydown.meta.enter.prevent="commitNote"
                @keydown.esc.prevent="cancelNote"
              ></textarea>
              <div v-else class="saved" :class="{ blank: !(detail.notes && detail.notes[it.k]) }">
                {{ (detail.notes && detail.notes[it.k]) || '还没写' }}
              </div>
              <span class="save-flag" :class="{ show: noteFlash === it.k }">已保存</span>
            </div>
          </div>
          <div class="verdict">
            <span class="lb">我的结论</span>
            <div class="opts">
              <button
                v-for="v in VERDICTS"
                :key="v"
                :class="{ on: (detail.notes && detail.notes.verdict) === v }"
                @click="setVerdict(v)"
              >{{ v }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 研究笔记：不依赖编辑模式，随时记 -->
      <div class="block">
        <div class="block-head">
          <h2 class="with-face"><AppFace slot="page-company" />研究笔记</h2>
          <span>随手记 · 不用进编辑模式</span>
        </div>
        <div class="panel">
          <div class="memo-new">
            <textarea
              v-model="memoDraft"
              rows="3"
              placeholder="想到什么写什么：财报里的疑点、电话会听到的、估值锚点、下次要查的事…（Ctrl + Enter 记下）"
              @keydown.ctrl.enter.prevent="addMemo"
              @keydown.meta.enter.prevent="addMemo"
            ></textarea>
            <div class="memo-ops">
              <span>已有 {{ (detail.memo || []).length }} 条</span>
              <AppButton variant="primary" size="sm" :disabled="!memoDraft.trim() || memoBusy" @click="addMemo">
                {{ memoBusy ? '保存中…' : '记下' }}
              </AppButton>
            </div>
          </div>

          <div v-if="memoSorted.length" class="memo-list">
            <div v-for="m in memoSorted" :key="m.at + '-' + m.idx" class="memo">
              <div class="memo-time">{{ fmtAt(m.at) }}</div>
              <div class="memo-text">{{ m.text }}</div>
              <button class="rm" title="删掉这条" @click="delMemo(m.idx)">✕</button>
            </div>
          </div>
          <div v-else class="empty-inline">还没有笔记。第一次写点什么，比如你对它最大的疑问是什么。</div>
        </div>
      </div>

      <div class="src-foot">
        <b>数据来源</b>：财务报表取自 SEC EDGAR 官方 XBRL（<code>data.sec.gov/api/xbrl/companyfacts</code>，10-K / 20-F 年报原文）；
        价格、市值、市盈率取自东方财富行情接口。两者都是公开接口，不依赖任何付费数据源。<br />
        <b>口径说明</b>：同一份年报会同时带前两年的对比数，这里是按「数据本身的结束年份」归年的，不是按申报年份，所以看到的每个财年都是它自己的数。<br />
        <b>能抓的和不能抓的</b>：财报、股价、公司中英文名、交易所是自动的；业务描述、收入结构、历史沿革、以及最后的判断，抓不到——这些必须由你自己写。
      </div>
    </section>

    <div v-if="toast" class="toast" :class="{ bad: toastError }">{{ toast }}</div>
  </div>
</template>

<style scoped>
.gc{
  --up:#c9503c;      /* 涨：红（中国习惯） */
  --down:#3f8f5e;    /* 跌：绿 */
  max-width:1060px;margin:0 auto;
  /* 它是 flex 子项，默认 min-width:auto 会被内部 11 列财务表的固有宽度撑开，
     窄屏下整个页面会被顶到 756px，统计卡第二列直接跑到屏幕外 */
  min-width:0;width:100%;
}
:global([data-theme="dark"]) .gc{ --up:#e3705c; --down:#5fbd85; }

/* ===== 列表 ===== */
.hero{padding:6px 0 18px}
.eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11px;letter-spacing:1.6px;color:var(--accent);font-weight:700;text-transform:uppercase}
.eyebrow::before{content:"";width:16px;height:1.5px;background:var(--accent);border-radius:2px}
.hero h1{margin:12px 0 8px;font-size:30px;line-height:1.22;letter-spacing:-.7px;font-weight:750;color:var(--text)}
.hero h1 em{font-style:normal;color:var(--accent)}
.hero p{margin:0;color:var(--text-2);font-size:13px;line-height:1.75;max-width:640px}

.toolbar{display:flex;gap:10px;align-items:center;margin:20px 0 14px}
/* 一条 omnibar：左搜索 / 竖线 / 右加代码 + 内嵌按钮。两段左内距都是 13px，文字起点齐平 */
.omnibar{
  flex:1;min-width:0;display:flex;align-items:center;height:38px;padding:0 4px 0 0;
  border:1px solid var(--line-2);border-radius:var(--r-input);background:var(--surface-solid);
}
.omnibar:focus-within{border-color:var(--accent);box-shadow:var(--ring)}
.omni-search{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:100%;padding:0 13px;cursor:text}
.omni-search .ico{flex:0 0 13px;color:var(--text-3)}
.omni-div{flex:0 0 1px;width:1px;height:18px;background:var(--line-2)}
.omni-add{display:flex;align-items:center;flex:1.15;min-width:0;height:100%;padding:0 6px 0 13px;cursor:text}
/* 全局 style.css 的裸输入框规则 input:not(...):not(...) 特异性 (0,2,1)，与 scoped 的 .omni-search input 打平，
   实测被它压住 → 两个 input 自己长出白底 + 1px 边 + 14px 圆角 + 10px 内距，高 43.6px，比 38px 的 omnibar
   上下各溢出 2.8px，看起来就是「内框比外框高」。这里把特异性提到 (0,3,1) 并显式盖掉 hover 变色。 */
.omnibar .omni-search input,
.omnibar .omni-add input{
  flex:1;min-width:0;width:auto;height:100%;padding:0;margin:0;
  border:0;border-radius:0;background:none;box-shadow:none;outline:none;
  font-size:13px;color:var(--text);
}
.omnibar .omni-search input:hover,
.omnibar .omni-add input:hover{background:none;border-color:transparent}
.omnibar input::placeholder{color:var(--text-3)}
.add-btn{
  flex:0 0 auto;height:30px;padding:0 14px;border-radius:10px;font-size:12.5px;font-weight:650;color:#fff;
  background:linear-gradient(140deg,#7d5ba6,#b9a3dd);box-shadow:0 8px 18px -12px rgba(125,91,166,.9);
  transition:.18s;white-space:nowrap;border:0;cursor:pointer;
}
.add-btn:hover:not(:disabled){transform:translateY(-1px)}
.add-btn:disabled{opacity:.55;cursor:not-allowed}

.hint{
  display:flex;gap:9px;align-items:flex-start;padding:10px 13px;border-radius:12px;margin-bottom:18px;
  background:var(--accent-soft);border:1px solid rgba(125,91,166,.24);font-size:12px;line-height:1.7;color:var(--text-2);
}
.hint b{color:var(--accent);font-weight:650}
.hint i{font-style:normal;color:var(--accent);font-size:13px;line-height:1.4}

.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:13px}
.co{
  border:1px solid var(--line-2);border-left:3px solid var(--accent);border-radius:var(--r-card);
  background:var(--surface-solid);box-shadow:var(--shadow);
  padding:15px 17px 12px;cursor:pointer;transition:transform .18s,border-color .18s,box-shadow .18s;
}
.co:hover{transform:translateY(-2px);box-shadow:0 20px 40px -26px rgba(72,50,110,.55)}
.co .r1{display:flex;align-items:flex-start;gap:9px;margin-bottom:3px}
.co .tk{font-size:11px;font-weight:800;letter-spacing:.6px;color:var(--accent);background:var(--accent-soft);padding:2px 7px;border-radius:6px;white-space:nowrap}
.co .nm{font-size:16px;font-weight:750;letter-spacing:-.2px;color:var(--text);line-height:1.35}
.co .sec{font-size:11.5px;color:var(--text-3);margin-bottom:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.co .px{margin-left:auto;text-align:right;line-height:1.25;flex-shrink:0}
.co .px b{font-size:18px;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.4px;color:var(--text)}
.co .px i{display:block;font-style:normal;font-size:11.5px;font-weight:650;font-variant-numeric:tabular-nums}
.kv{display:grid;grid-template-columns:repeat(4,1fr);padding:10px 0 9px;border-top:1px solid var(--line-2);border-bottom:1px solid var(--line-2)}
.kv div{padding:0 8px;border-left:1px solid var(--line-2);min-width:0}
.kv div:first-child{border-left:0;padding-left:0}
.kv b{display:block;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.2px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kv span{font-size:10.5px;color:var(--text-3);white-space:nowrap}
.co .r4{display:flex;align-items:center;gap:8px;margin-top:9px}
.tagi{font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:999px;border:1px solid var(--line-2);color:var(--text-3);white-space:nowrap}
.tag-watch{color:var(--warm);background:rgba(201,131,66,.1);border-color:rgba(201,131,66,.3)}
.tag-core{color:var(--accent);background:var(--accent-soft);border-color:rgba(125,91,166,.32)}
.tag-warn{color:var(--danger);background:var(--danger-soft);border-color:rgba(207,106,87,.3)}
.del-btn{margin-left:auto;width:22px;height:22px;border-radius:6px;border:1px solid transparent;background:none;color:var(--text-3);font-size:11px;line-height:1;opacity:0;transition:.15s;cursor:pointer}
.co:hover .del-btn{opacity:1}
.del-btn:hover{color:var(--danger);border-color:var(--danger-soft);background:var(--danger-soft)}
.up-time{font-size:10.5px;color:var(--text-3)}

/* ===== 详情 ===== */
.detail-head{padding:4px 0 0}
.back{
  display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2);
  padding:5px 13px;border:1px solid var(--line-2);border-radius:999px;background:var(--surface-solid);transition:.16s;margin-bottom:16px;cursor:pointer;
}
.back:hover{color:var(--text);transform:translateX(-2px)}

.dh{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
.dh .left{flex:1;min-width:240px}
.dh h1{margin:0 0 4px;font-size:26px;letter-spacing:-.6px;font-weight:780;display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--text)}
.dh h1 .tk{font-size:12.5px;font-weight:800;color:var(--accent);background:var(--accent-soft);padding:3px 9px;border-radius:7px;letter-spacing:.5px;border:1px solid transparent;font-family:inherit;cursor:pointer;transition:.15s}
.dh h1 .tk:hover{border-color:var(--accent);background:var(--accent-soft)}
/* 更新数据 / 只刷行情 / 编辑档案：三个动作竖着排，按钮里带股票代码的是「更新数据」 */
.dh-ops{display:flex;flex-direction:column;gap:6px;min-width:124px}
.dh .sub{font-size:12.5px;color:var(--text-3);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dh .sub i{font-style:normal;width:3px;height:3px;border-radius:50%;background:var(--text-3);display:inline-block}
.price-box{text-align:right;min-width:180px}
.price-box .p{font-size:30px;font-weight:780;letter-spacing:-1px;font-variant-numeric:tabular-nums;line-height:1.1;color:var(--text)}
.price-box .c{font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;margin-top:1px}
.price-box .m{font-size:11px;color:var(--text-3);margin-top:3px}
/* .mini-btn（描边小按钮）已并入 AppButton + .btn--outline，此处不再重复定义 */

.qstats{display:flex;gap:9px;flex-wrap:wrap;margin:16px 0 22px}
.qstat{flex:1 1 120px;padding:10px 13px;border:1px solid var(--line-2);border-radius:13px;background:var(--surface-solid);box-shadow:var(--shadow)}
.qstat b{display:block;font-size:16.5px;font-weight:750;letter-spacing:-.3px;font-variant-numeric:tabular-nums;line-height:1.3;color:var(--text)}
.qstat span{font-size:10.5px;color:var(--text-3)}
.qstat .note{display:block;font-size:10px;margin-top:2px;font-variant-numeric:tabular-nums}

.up{color:var(--up)} .down{color:var(--down)} .flat{color:var(--text-3)}

.block{margin:0 0 24px}
/* .block-head 已搬到 style.css（区块标题的唯一定义处） */
.panel{border:1px solid var(--line-2);border-radius:var(--r-card);background:var(--surface-solid);box-shadow:var(--shadow);padding:16px 18px}

/* 图：折线 svg 负责画线，纵轴另用一层 HTML —— svg 的宽高比被拉伸，
   把 <text> 放进去会被横向压扁，刻度数字会变形 */
.chart-wrap{position:relative;--plot-h:190px;--tick-w:54px}
.chart-wrap.tight{--plot-h:150px;--tick-w:66px}
.chart-wrap svg{display:block;width:100%;height:190px;overflow:visible}
.chart-wrap.tight svg{height:150px}
.plot{position:relative;margin-left:calc(var(--tick-w) + 6px)}
.axis{position:absolute;left:0;right:0;top:0;height:var(--plot-h);pointer-events:none}
.axis-row{position:absolute;left:0;right:0;transform:translateY(-50%);display:flex;align-items:center;gap:6px}
.axis-row .tick{flex:0 0 var(--tick-w);text-align:right;font-size:10px;line-height:1;color:var(--text-3);font-variant-numeric:tabular-nums;white-space:nowrap}
.axis-row .gline{flex:1;height:1px;background:var(--line-2);opacity:.7}
/* 末点：圆点 + 当前值，标在线的右端，一眼看到「现在多少钱」 */
.dot{position:absolute;right:0;transform:translateY(-50%);display:flex;flex-direction:row-reverse;align-items:center;gap:6px;pointer-events:none}
.dot::after{content:"";flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 20%,transparent)}
.dot span{font-size:10.5px;font-weight:700;color:var(--accent);background:var(--surface-solid);border:1px solid var(--line-2);padding:1px 6px;border-radius:6px;font-variant-numeric:tabular-nums;white-space:nowrap}
.chart-foot{display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:var(--text-3);margin-top:6px;font-variant-numeric:tabular-nums}
.chart-wrap .chart-foot{padding-left:calc(var(--tick-w) + 6px)}
.chart-foot .mid{color:var(--text-2)}
.chart-foot .mid b{font-weight:700}

/* 公司信息 */
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 20px}
.info-grid .cell{display:flex;align-items:baseline;gap:8px;min-width:0;padding-bottom:7px;border-bottom:1px dashed var(--line-2)}
.info-grid .cell.wide{grid-column:1 / -1}
.info-grid .cell span{flex:0 0 66px;font-size:11px;color:var(--text-3)}
.info-grid .cell b{font-size:12.5px;font-weight:650;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.info-grid .cell b.mono{font-variant-numeric:tabular-nums;letter-spacing:.3px}
/* 小字（交易所、电话）必须紧跟自己的值，不能推到自己那一格的右边缘 ——
   两列并排时，推到右边缘会看起来像右边那一列的字段 */
.info-grid .cell i{font-style:normal;font-size:10.5px;color:var(--text-3);margin-left:7px;white-space:nowrap}
.info-grid .cell.wide i{margin-left:auto}
.links{display:flex;flex-wrap:wrap;gap:7px;margin-top:13px}
.lk{font-size:11.5px;padding:4px 11px;border-radius:999px;border:1px dashed var(--line-3);color:var(--text-3);text-decoration:none;transition:.15s}
.lk.on{border-style:solid;color:var(--text-2);border-color:var(--line-2);background:var(--surface-2)}
.lk.on:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
.info-edit{margin-top:14px;padding-top:13px;border-top:1px solid var(--line-2);display:grid;gap:8px}
.info-edit .fl{font-size:11.5px;font-weight:700;color:var(--text-2)}
.info-edit input{padding:7px 10px;font-size:12px;border-radius:9px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--text);font-family:inherit;outline:none}
.info-edit input:focus{border-color:var(--accent);box-shadow:var(--ring);background:var(--surface-solid)}
.info-edit .rows .row input.yr{flex:0 0 96px}
.info-note{margin-top:13px;padding-top:11px;border-top:1px dashed var(--line-2);font-size:11px;line-height:1.7;color:var(--text-3)}
.info-note b{color:var(--text-2)}

/* 研究笔记 */
.memo-new{display:flex;flex-direction:column;gap:8px}
.memo-new textarea{width:100%;padding:9px 11px;font-size:12.5px;line-height:1.7;border-radius:11px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--text);font-family:inherit;resize:vertical;outline:none;box-sizing:border-box}
.memo-new textarea:focus{border-color:var(--accent);box-shadow:var(--ring);background:var(--surface-solid)}
.memo-ops{display:flex;align-items:center;gap:10px}
.memo-ops span{font-size:11px;color:var(--text-3)}
.memo-ops :deep(.btn){margin-left:auto}
.memo-list{display:flex;flex-direction:column;gap:8px;margin-top:13px}
.memo{position:relative;padding:10px 34px 10px 13px;border-radius:11px;background:var(--surface-2);border:1px solid var(--line-2)}
.memo-time{font-size:10.5px;color:var(--text-3);font-variant-numeric:tabular-nums;margin-bottom:3px}
.memo-text{font-size:12.5px;line-height:1.75;color:var(--text);white-space:pre-wrap;word-break:break-word}
.memo .rm{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:7px;border:1px solid transparent;background:none;color:var(--text-3);font-size:11px;cursor:pointer;line-height:1}
.memo .rm:hover{color:var(--danger);background:var(--danger-soft);border-color:var(--danger-soft)}

/* .seg / .seg--pill 已收编到 style.css，此处不再重复定义 */

.biz-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:20px}
.biz-text{font-size:13px;line-height:1.85;color:var(--text-2);white-space:pre-wrap}
.seg-bars{display:flex;flex-direction:column;gap:8px;justify-content:center}
.seg-row{display:grid;grid-template-columns:104px 1fr 40px;gap:9px;align-items:center;font-size:11.5px}
.seg-row .nm{color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.seg-row .bar{height:7px;border-radius:4px;background:rgba(72,50,110,.08);overflow:hidden}
.seg-row .bar i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--accent),var(--accent-deep))}
.seg-row .pc{text-align:right;color:var(--text-3);font-variant-numeric:tabular-nums}

.hist{position:relative}
.hist-row{display:grid;grid-template-columns:56px 18px 1fr;padding:3px 0}
.hist-row .yr{text-align:right;padding-right:8px;font-size:12px;font-weight:750;color:var(--text-2);font-variant-numeric:tabular-nums;padding-top:1px}
.hist-row .rail{position:relative;display:flex;justify-content:center}
.hist-row .rail::before{content:"";position:absolute;top:0;bottom:-7px;width:1.5px;background:var(--line-2)}
.hist-row:first-child .rail::before{top:9px}
.hist-row:last-child .rail::before{bottom:auto;height:9px}
.hist-row .dot{position:relative;z-index:2;width:7px;height:7px;border-radius:50%;background:var(--accent);margin-top:6px;box-shadow:0 0 0 3px var(--accent-soft)}
.hist-row .tx{font-size:12.5px;color:var(--text-2);line-height:1.6;padding-bottom:4px}

.tbl-scroll{overflow-x:auto;overflow-y:hidden}
.tbl-scroll.mt{margin-top:14px}
table.fin{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
table.fin th,table.fin td{padding:7px 9px;text-align:right;border-bottom:1px solid var(--line-2)}
table.fin th:first-child,table.fin td:first-child{
  text-align:left;position:sticky;left:0;background:var(--surface-solid);z-index:2;font-weight:600;min-width:112px;
}
table.fin thead th{font-size:10.5px;font-weight:600;color:var(--text-3);letter-spacing:.3px;border-bottom:1px solid var(--line-3)}
table.fin thead th.cur{color:var(--accent);font-weight:750}
table.fin tbody tr:hover td{background:var(--accent-soft)}
table.fin td.dim{color:var(--text-3)}
table.fin td.neg{color:var(--up)}
table.fin td.pos{color:var(--up)}
table.fin tr.gap td{border-bottom:1px dashed var(--line-3)}
.fin-note{font-size:11px;color:var(--text-3);margin-top:9px;line-height:1.75}
.fin-note b{color:var(--text-2)}

.bs-bar{display:flex;height:26px;border-radius:8px;overflow:hidden;margin:2px 0 11px;font-size:10.5px;font-weight:700;color:#fff}
.bs-bar div{display:flex;align-items:center;justify-content:center;white-space:nowrap;transition:flex .3s}
.bs-legend{display:flex;gap:15px;flex-wrap:wrap;font-size:11.5px;color:var(--text-2)}
.bs-legend i{width:8px;height:8px;border-radius:3px;display:inline-block;margin-right:5px}
.bs-legend .muted{color:var(--text-3)}

.checks{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.check{position:relative;border:1px solid var(--line-2);border-radius:13px;background:var(--surface-2);padding:11px 13px;cursor:text}
.check label{display:block;font-size:11.5px;font-weight:700;color:var(--text-2);margin-bottom:3px}
.check .q{font-size:10.5px;color:var(--text-3);margin-bottom:7px;line-height:1.55}
.check textarea{
  width:100%;border:1px solid var(--line-2);border-radius:9px;background:var(--surface-solid);
  padding:8px 10px;font-size:12px;line-height:1.65;resize:vertical;outline:none;transition:.15s;color:var(--text);
}
.check textarea:focus{border-color:var(--accent);box-shadow:var(--ring)}
.check .saved{font-size:12px;line-height:1.7;color:var(--text-2);white-space:pre-wrap;min-height:20px}
.check .saved.blank{color:var(--text-3)}
/* 只留「已保存」这一个轻反馈；不做 hover 提示和高亮，鼠标划过时不再逐格闪 */
.check .save-flag{position:absolute;top:9px;right:10px;font-size:10px;font-weight:650;color:var(--accent);opacity:0;transition:opacity .2s;pointer-events:none}
.check .save-flag.show{opacity:1}

.verdict{display:flex;align-items:center;gap:9px;padding:12px 14px;border-radius:13px;background:var(--surface-2);border:1px solid var(--line-2);margin-top:12px;flex-wrap:wrap}
.verdict .lb{font-size:11.5px;font-weight:700;color:var(--text-2)}
.verdict .opts{display:flex;gap:6px;flex-wrap:wrap}
.verdict .opts button{font-size:11.5px;padding:4px 12px;border-radius:999px;border:1px solid var(--line-2);color:var(--text-2);transition:.15s;background:var(--surface-solid);cursor:pointer}
.verdict .opts button:hover{color:var(--text);border-color:var(--line-3)}
.verdict .opts button.on{background:var(--text);color:var(--surface-solid);border-color:transparent;font-weight:650}

.edit-grid{display:grid;gap:8px}
.edit-grid .fl{font-size:11.5px;font-weight:700;color:var(--text-2);margin-top:4px}
.edit-grid textarea,.edit-grid input{
  width:100%;border:1px solid var(--line-2);border-radius:10px;background:var(--surface-2);
  padding:8px 11px;font-size:12.5px;line-height:1.7;outline:none;color:var(--text);transition:.15s;
}
.edit-grid textarea:focus,.edit-grid input:focus{border-color:var(--accent);box-shadow:var(--ring);background:var(--surface-solid)}
.rows{display:flex;flex-direction:column;gap:6px}
.rows .row{display:flex;gap:6px;align-items:center}
.rows .row input{flex:1;min-width:0}
.rows .row input.narrow{flex:0 0 74px}
.rows .row input.yr{flex:0 0 74px}
.rows .unit{font-size:11.5px;color:var(--text-3)}
.rows .rm{
  width:24px;height:24px;flex-shrink:0;border-radius:6px;border:1px solid var(--line-2);background:var(--surface-solid);
  color:var(--text-3);font-size:10px;cursor:pointer;
}
.rows .rm:hover{color:var(--danger);border-color:var(--danger-soft);background:var(--danger-soft)}
.add-line{align-self:flex-start;font-size:11.5px;padding:4px 11px;border-radius:8px;border:1px dashed var(--line-3);background:none;color:var(--text-2);cursor:pointer}
.add-line:hover{color:var(--accent);border-color:var(--accent)}

.src-foot{font-size:11px;color:var(--text-3);line-height:1.85;border-top:1px solid var(--line-2);padding-top:13px;margin-top:22px}
.src-foot b{color:var(--text-2);font-weight:600}
.src-foot code{background:rgba(72,50,110,.06);padding:1px 5px;border-radius:4px;font-size:10.5px}

.empty{padding:52px 24px;text-align:center;border:1px dashed var(--line-3);border-radius:var(--r-card);color:var(--text-3);font-size:13px}
.empty.small{padding:30px 20px;border:0}
.empty code{background:rgba(72,50,110,.07);padding:1px 6px;border-radius:4px}
.empty-inline{font-size:12.5px;line-height:1.8;color:var(--text-3);padding:6px 0}

.toast{
  position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;
  padding:9px 18px;border-radius:999px;font-size:12.5px;font-weight:600;
  background:var(--text);color:var(--surface-solid);box-shadow:0 14px 34px -14px rgba(0,0,0,.5);
  max-width:min(90vw,520px);text-align:center;line-height:1.5;
}
.toast.bad{background:var(--danger);color:#fff}

@media (max-width:820px){
  .hero h1{font-size:24px}
  .biz-grid{grid-template-columns:1fr}
  .checks{grid-template-columns:1fr}
  .kv{grid-template-columns:repeat(2,1fr);gap:8px 0}
  .kv div:nth-child(3){border-left:0;padding-left:0}
  .kv div:nth-child(3),.kv div:nth-child(4){border-top:1px solid var(--line-2);padding-top:8px;margin-top:8px}
  .dh h1{font-size:22px}
  .price-box{text-align:left;min-width:0}
  .dh-ops{flex-direction:row;flex-wrap:wrap;min-width:0;width:100%}
  .info-grid{grid-template-columns:1fr}
  .info-grid .cell span{flex:0 0 60px}
  .chart-wrap{--tick-w:48px}
  .chart-wrap.tight{--tick-w:58px}
  .qstat{flex:1 1 calc(50% - 5px)}
  /* 窄屏：omnibar 竖过来，竖线变横线，按钮独占一行铺满 */
  .omnibar{flex-direction:column;align-items:stretch;height:auto;padding:5px}
  .omni-search,.omni-add{height:32px;flex:none;padding:0 8px}
  .omni-div{width:auto;height:1px;margin:3px 8px}
  .add-btn{height:32px;margin-top:5px;width:100%}
  .panel{padding:13px 13px}
}
</style>
