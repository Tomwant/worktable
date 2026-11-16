<script setup>
// 定时任务更新状态：既用于「当天第一次有产出入库」的自动弹出，也能从知识库右上角手动打开。
// 数据源 /api/knowledge/feeds-status —— 它查库算「上一次成功是哪天」，进程重启也不会丢；
// 原来的 sync-progress 只有内存快照，重启就空，根本看不出「这一路卡了几天」。
import { api } from '../stores/index.js'
import { NModal } from 'naive-ui'
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'

const emit = defineEmits(['updated', 'status'])
const POP_KEY = 'spring-workbench-sync-pop'
const show = ref(false)
const manual = ref(false)      // 手动打开：不自动关闭，也不受「今天弹过了」限制
const checking = ref(false)
const loading = ref(true)
const snap = reactive({ running: false, today: '', staleCount: 0, feeds: [] })
// 「上次检查」必须落成界面上看得到的时间：
// 本机扫描只要一百多毫秒，按钮转一下就复原，用户根本分不清「点了没反应」和「点了但没变化」。
// 所以两处都要有时间戳 —— 头部自动轮询的时间（证明后台在跑）+ 底部手动检查的结果。
const lastPoll = ref('')
const lastCheck = ref(null)

let timer = null
let autoCloseTimer = null

const ICONS = { 金融概念: '◈', 概率学概念: '◇', 实时新闻: '◉', 财务知识: '◎' }
const iconOf = series => ICONS[series] || '·'

// 每路只归结到一个状态，优先级：正在写 > 失败 > 滞后 > 今天已更新 > 等待今天
const stateOf = f => {
  if (f.syncing) return 'running'
  if (f.status === 'error') return 'error'
  if (f.pending) return 'pending'             // 任务刚启用，第一次还没跑，既不是卡住也不算已更新
  if (f.daysBehind === null) return 'idle'   // 知识库里一份都没有，和「卡了几天」是两回事
  if (f.stale) return 'stale'
  if (f.daysBehind === 0) return 'done'
  return 'wait'
}

const activeFeeds = computed(() => snap.feeds.filter(f => stateOf(f) !== 'pending'))
const total = computed(() => activeFeeds.value.length)
const doneCount = computed(() => activeFeeds.value.filter(f => stateOf(f) === 'done').length)
const errorCount = computed(() => activeFeeds.value.filter(f => ['error', 'stale', 'idle'].includes(stateOf(f))).length)
const pct = computed(() => (total.value ? Math.round(doneCount.value / total.value * 100) : 0))
const allDone = computed(() => total.value > 0 && activeFeeds.value.every(f => stateOf(f) === 'done'))

const dateLabel = computed(() => {
  const d = snap.today || ''
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : ''
})

const shortDate = d => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(5, 7))}-${d.slice(8, 10)}` : d || '—')

const headBadge = computed(() => {
  if (errorCount.value) return `${errorCount.value} 项需处理`
  if (allDone.value) return '今日已全部更新'
  if (snap.running) return '自动同步中'
  return '等待产出'
})

// 底部只留一句最有用的话：先说「哪一路卡住了」，再说怎么办
const footHint = computed(() => {
  const bad = activeFeeds.value.filter(f => ['stale', 'error', 'idle'].includes(stateOf(f)))
  if (bad.length) {
    const parts = bad.map(f => f.daysBehind === null || f.daysBehind === undefined
      ? `${f.series}从未同步`
      : `${f.series}已 ${f.daysBehind} 天无新产出`)
    return `${parts.join('、')}，检查任务与产出目录。`
  }
  const waiting = snap.feeds.filter(f => stateOf(f) === 'pending').map(f => f.series)
  if (allDone.value) {
    return waiting.length
      ? `${total.value} 路今日已更新，${waiting.join('、')} 等第一次产出。`
      : `${total.value} 路全部更新完成，可关窗阅读。`
  }
  if (doneCount.value) return '其余系列还没到点，后台每分钟自动补一次。'
  return '今天的产出还没到，后台每分钟自动检查一次。'
})

// 手动检查的结果行：说清「几点检查的、扫了几份、有没有新东西」。
// 只写「检查完成」没用 —— 用户真正的疑问是「那我这次点到底有没有作用」。
const checkText = computed(() => {
  const c = lastCheck.value
  if (!c) return ''
  if (c.fail) return `${c.at} 检查失败：${c.fail}`
  const parts = [`${c.at} 已检查`]
  if (c.inserted || c.updated) {
    parts.push(`新增 ${c.inserted} 篇${c.updated ? ` · 更新 ${c.updated} 篇` : ''}`)
  } else {
    // 「没有新产出」两种情况要分开说：本来就没该更新，和「有问题、扫了也没有」。
    // 后者必须点明还剩几路，否则用户点完检查以为已经好了。
    const left = activeFeeds.value.filter(f => ['stale', 'error', 'idle'].includes(stateOf(f))).length
    parts.push(left ? `扫描 ${c.total} 份，${left} 路仍无新产出` : `扫描 ${c.total} 份，没有新产出`)
  }
  if (c.errors.length) parts.push(`${c.errors.length} 个文件出错`)
  return parts.join(' · ')
})

const stateText = f => {
  const s = stateOf(f)
  if (s === 'done') return '已更新'
  if (s === 'running') return '写入中'
  if (s === 'error') return '同步失败'
  if (s === 'stale') return `滞后 ${f.daysBehind} 天`
  if (s === 'idle') return '从未同步'
  if (s === 'pending') return '等待首次产出'
  return '等待产出'
}

// 每行的副标题：把「最新一份是哪天」直接写出来，不用点开才知道
const subOf = f => {
  const s = stateOf(f)
  if (s === 'running') return '正在读取产出文件…'
  if (s === 'error') return f.note || '同步失败'
  if (s === 'stale') return f.title ? `${f.title} · 最新 ${shortDate(f.originDate)}` : '知识库里还没有这一路的报告'
  if (s === 'done') return `${f.title || '已入库'} · ${shortDate(f.originDate)} 今天`
  if (s === 'idle') return '知识库里还没有这一路的报告'
  if (s === 'pending') return '任务刚启用，等第一次产出（每天 9:00）'
  return f.title ? `${f.title} · 今天还没产出` : '今天还没产出'
}

async function poll() {
  try {
    const data = await api('/api/knowledge/feeds-status')
    if (!data) return
    snap.running = !!data.running
    snap.today = data.today || ''
    snap.staleCount = Number(data.staleCount || 0)
    snap.feeds = Array.isArray(data.feeds) ? data.feeds : []
    loading.value = false
    // 头部显示这个时间：它每隔几秒往前跳一次，就等于告诉用户「后台真的在检查」
    lastPoll.value = new Date().toTimeString().slice(0, 8)
    // 右上角入口按钮靠这个事件同步状态，不用重复请求
    emit('status', { staleCount: snap.staleCount, running: snap.running })
    maybePop()
    maybeAutoClose()
  } catch { /* 后端没起来时静默，下一轮再试 */ }
  finally { schedule(show.value ? 4000 : 12000) }
}

function markedToday() {
  try { return localStorage.getItem(POP_KEY) === snap.today } catch { return false }
}
function markToday() {
  try { localStorage.setItem(POP_KEY, snap.today) } catch { /* 隐私模式写不进去，忽略 */ }
}

// 当天第一次「有东西入库」或「某一路报错」就弹；什么都没发生就安静等着，不打扰
function maybePop() {
  if (show.value || manual.value || !snap.today || markedToday()) return
  if (!snap.feeds.some(f => f.imported || stateOf(f) === 'error')) return
  show.value = true
  markToday()
  if (snap.feeds.some(f => f.imported)) emit('updated')
}

// 自动弹窗在全部完成后停留 1.8 秒自动关；手动打开的窗口不自动关，等用户自己关
function maybeAutoClose() {
  if (!show.value || manual.value || autoCloseTimer || !allDone.value) return
  autoCloseTimer = setTimeout(() => { show.value = false }, 1800)
}

function schedule(ms) {
  clearTimeout(timer)
  timer = setTimeout(poll, ms)
}

// 手动「立即检查」：让后端马上重扫一遍产出目录，再读一次状态。
// 后端返回 { total, inserted, updated, errors }，直接拿来说结果，别只回一句「已检查」。
async function checkNow() {
  if (checking.value) return
  checking.value = true
  lastCheck.value = null
  const at = () => new Date().toTimeString().slice(0, 8)
  const t0 = Date.now()
  try {
    const data = await api('/api/knowledge/sync', { method: 'POST' })
    // 本机扫描通常一两百毫秒，按钮转一下就没，跟「没点上」长得一模一样。
    // 给一个最小可视时长，让动效走得完整。
    const rest = 620 - (Date.now() - t0)
    if (rest > 0) await new Promise(r => setTimeout(r, rest))
    lastCheck.value = {
      at: at(),
      total: Number(data.total || 0),
      inserted: Number(data.inserted || 0),
      updated: Number(data.updated || 0),
      errors: Array.isArray(data.errors) ? data.errors : []
    }
    await poll()
    if (lastCheck.value.inserted || lastCheck.value.updated) emit('updated')
  } catch (err) {
    lastCheck.value = { at: at(), total: 0, inserted: 0, updated: 0, errors: [], fail: err?.message || '请求失败' }
  } finally { checking.value = false }
}

function open() {
  manual.value = true
  show.value = true
  poll()
}
function close() { show.value = false }

defineExpose({ open, close })
onMounted(() => { poll() })
onBeforeUnmount(() => { clearTimeout(timer); clearTimeout(autoCloseTimer) })
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    class="app-modal glass sync-modal"
    :mask-closable="true"
    :close-on-esc="true"
    :bordered="false"
    style="width:min(560px,94vw)"
  >
    <template #header>
      <div class="sync-head">
        <div class="tt">
          <h3>定时任务更新状态</h3>
          <p>
            {{ dateLabel ? dateLabel + ' · ' : '' }}后台每分钟自动检查
            <em v-if="lastPoll" class="poll-at">· 上次 {{ lastPoll }}</em>
          </p>
        </div>
        <span class="badge-live" :class="{ off: allDone, warn: errorCount > 0 }"><i></i><span>{{ headBadge }}</span></span>
      </div>
    </template>

    <div class="progress-wrap">
      <div class="progress-top">
        <b>{{ pct }}</b><span>%</span>
        <span class="pcount">{{ doneCount }} / {{ total }} 今天已更新</span>
      </div>
      <div class="progress-bar"><div class="fill" :style="{ width: pct + '%' }"></div></div>
    </div>

    <div class="feed-list">
      <div v-for="f in snap.feeds" :key="f.series" class="feed" :class="stateOf(f)">
        <span class="ic">{{ iconOf(f.series) }}</span>
        <div class="body">
          <div class="name">{{ f.series }}</div>
          <div class="sub">
            {{ subOf(f) }}
          </div>
        </div>
        <div class="state" :class="stateOf(f)">
          <span v-if="stateOf(f) === 'done'" class="tick">✓</span>
          <span v-else-if="stateOf(f) === 'running'" class="spin"></span>
          <span v-else-if="stateOf(f) === 'error'" class="tick">!</span>
          {{ stateText(f) }}
        </div>
      </div>
      <p v-if="!snap.feeds.length && !loading" class="sync-empty">后端还没有跑过一次同步，稍后自动重试。</p>
    </div>

    <template #footer>
      <div class="sync-foot">
        <p v-if="lastCheck" class="check-res" :class="{ bad: lastCheck.fail || lastCheck.errors.length }">
          <span class="mk"><span>{{ lastCheck.fail || lastCheck.errors.length ? '!' : '✓' }}</span></span>{{ checkText }}
        </p>
        <span class="hint">{{ footHint }}</span>
        <span class="btns">
          <button class="ghost sm check-btn" :class="{ busy: checking }" :disabled="checking" @click="checkNow">
            <i v-if="checking" class="spin"></i>{{ checking ? '检查中…' : '立即检查' }}
          </button>
          <button class="ghost sm" @click="close">关闭</button>
        </span>
      </div>
    </template>
  </n-modal>
</template>
