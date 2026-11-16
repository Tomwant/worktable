<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { api } from '../stores/index.js'
import AppFace from '../components/AppFace.vue'

// ===== 元信息：五个模型的身份色 + 领域标签 =====
// 颜色走 CSS 变量（--m-*），深色主题下在 .ai-tl 上整体换一档，不在 JS 里判断主题
const MODELS = {
  openai:   { name: 'ChatGPT',  full: 'OpenAI · ChatGPT',      c: 'var(--m-openai)' },
  claude:   { name: 'Claude',   full: 'Anthropic · Claude',     c: 'var(--m-claude)' },
  deepseek: { name: 'DeepSeek', full: '深度求索 · DeepSeek',    c: 'var(--m-deepseek)' },
  kimi:     { name: 'Kimi',     full: '月之暗面 · Kimi',        c: 'var(--m-kimi)' },
  gemini:   { name: 'Gemini',   full: 'Google · Gemini',        c: 'var(--m-gemini)' }
}
const MODEL_KEYS = Object.keys(MODELS)
const DOMAINS = ['文本推理', '编程', '图像', '视频', '3D建模', '电商', '语音', '工作流', '成本', '合规', '生态', '工程']
const DOMAIN_LABEL = {
  文本推理: '文本推理', 编程: '编程 / Agent', 图像: '图像', 视频: '视频', '3D建模': '3D 建模',
  电商: '电商 / 商业', 语音: '语音', 工作流: '办公工作流', 成本: '成本', 合规: '合规 / 安全', 生态: '生态', 工程: '工程'
}

// ===== 日期工具 =====
// 用真实今天，不写死：写死日期会让「近一年」这个区间永远停在抓数据那天
const DAY = 86400000
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const TODAY = startOfToday()
const dayDiff = s => Math.round((TODAY - new Date(s + 'T00:00:00')) / DAY)
const rel = s => {
  const n = dayDiff(s)
  if (n === 0) return '今天'
  if (n === 1) return '昨天'
  if (n < 0) return Math.abs(n) + ' 天后'
  if (n < 7) return n + ' 天前'
  if (n < 30) return Math.floor(n / 7) + ' 周前'
  if (n < 365) return Math.floor(n / 30) + ' 个月前'
  return Math.floor(n / 365) + ' 年前'
}
const md = s => ({ y: s.slice(0, 4), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) })
const shortDate = s => (s ? s.slice(5).replace('-', '/') : '')

// ===== 数据 =====
const items = ref([])
const baseline = ref([])
const loading = ref(true)
const errText = ref('')
const rootEl = ref(null)

async function load() {
  loading.value = true
  errText.value = ''
  try {
    const data = await api('/api/ai-events')
    items.value = Array.isArray(data.items) ? data.items : []
    baseline.value = Array.isArray(data.baseline) ? data.baseline : []
    if (!seenDate.value && items.value.length) {
      seenDate.value = items.value[0].date
      writeSeen(seenDate.value)
    }
  } catch (error) {
    errText.value = `时间线没有加载出来：${error.message}。检查后端是否在 3001 端口运行。`
  } finally {
    loading.value = false
  }
}

// ===== 筛选状态 =====
const range = ref(365)            // 90 / 365 / 'all'
const fModel = ref('all')
const fDom = ref([])              // 领域多选
const onlyMajor = ref(false)
const baseOpen = ref(true)

// ===== 未读：上次看到哪天，之后新增的打绿点 =====
const SEEN_KEY = 'ai-timeline-seen'
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) || '' } catch { return '' } }
const writeSeen = v => { try { localStorage.setItem(SEEN_KEY, v) } catch { /* 隐私模式下不可写，忽略 */ } }
const seenDate = ref(readSeen())
const isNew = e => !!seenDate.value && e.date > seenDate.value
const newCount = computed(() => items.value.filter(isNew).length)
function markAllSeen() {
  if (!items.value.length) return
  seenDate.value = items.value[0].date
  writeSeen(seenDate.value)
}

// ===== 过滤与计数 =====
const inRange = e => range.value === 'all' || dayDiff(e.date) <= Number(range.value)
const inScope = e => inRange(e) && e.date <= new Date(TODAY.getTime() + DAY).toISOString().slice(0, 10)
const visible = computed(() => items.value.filter(e =>
  inRange(e)
  && (fModel.value === 'all' || e.model === fModel.value)
  && (!fDom.value.length || e.tags.some(t => fDom.value.includes(t)))
  && (!onlyMajor.value || e.weight === 'major')
))
const countBy = pred => items.value.filter(e => inRange(e) && pred(e)).length
const total = computed(() => countBy(() => true))
const majorCount = computed(() => countBy(e => e.weight === 'major'))
// 官方一手占比：能点开就是厂商官网原文的那几条，是这份数据可信度最直接的指标
const offCount = computed(() => countBy(e => e.srcType === 'off'))
const busiest = computed(() => {
  const tally = {}
  items.value.filter(inRange).forEach(e => { tally[e.model] = (tally[e.model] || 0) + 1 })
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
  return top ? MODELS[top[0]].name : '—'
})
const rangeLabel = computed(() => range.value === 'all' ? '全部' : (Number(range.value) === 90 ? '近 90 天' : '近一年'))

// 领域胶囊：只显示当前区间里真的有内容的领域，避免一排 0
const domChips = computed(() => DOMAINS
  .map(d => ({ key: d, label: DOMAIN_LABEL[d], n: countBy(e => e.tags.includes(d)) }))
  .filter(d => d.n > 0))

// ===== 按月份分组（数据已是日期降序，一次遍历即可）=====
const groups = computed(() => {
  const out = []
  let lastKey = ''
  for (const e of visible.value) {
    const { y, m } = md(e.date)
    const key = `${y}-${m}`
    if (key !== lastKey) {
      lastKey = key
      out.push({ key, y, m, count: 0, events: [] })
    }
    const g = out[out.length - 1]
    g.events.push(e)
    g.count++
  }
  return out
})

// ===== 热力条：52 周 × 5 模型 =====
// 左→右是「早→近」；一格 = 一周，有 1/2/3+ 条分三档深浅
const heat = computed(() => {
  const weeks = 52
  return MODEL_KEYS.map(key => {
    const cells = []
    for (let wk = weeks - 1; wk >= 0; wk--) {
      const from = wk * 7
      const to = from + 6
      const hit = items.value.filter(e => e.model === key && dayDiff(e.date) >= from && dayDiff(e.date) <= to)
      cells.push({
        key: `${key}-${wk}`,
        lv: Math.min(3, hit.length),
        date: hit.length ? hit[0].date : '',
        title: hit.length ? `${MODELS[key].name} · ${hit.length} 条 · ${hit.map(x => x.version).join('、')}` : '这周没有更新'
      })
    }
    return { key, name: MODELS[key].name, color: MODELS[key].c, cells }
  })
})
const heatAxis = computed(() => {
  const out = []
  for (let wk = 51; wk >= 0; wk--) {
    const idx = 51 - wk
    const d = new Date(TODAY - (wk * 7 + 6) * DAY)
    out.push(idx % 4 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '')
  }
  return out
})

// ===== 卡片展开 + 跳转 =====
const openIds = ref(new Set())
function toggleCard(id, ev) {
  if (ev && ev.target && ev.target.closest('a')) return   // 点来源链接不应该收起卡片
  const next = new Set(openIds.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  openIds.value = next
}
async function jumpTo(date, model) {
  fModel.value = model
  fDom.value = []
  onlyMajor.value = false
  await nextTick()
  const el = rootEl.value?.querySelector(`[data-date="${date}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function pickModel(k) { fModel.value = k; onlyMajor.value = false }
function toggleDom(k) {
  const next = fDom.value.includes(k) ? fDom.value.filter(x => x !== k) : [...fDom.value, k]
  fDom.value = next
}

// 上下键在卡片间移动（焦点在卡片上才接管，不抢页面滚动）
function onKey(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  if (!rootEl.value) return
  const cards = [...rootEl.value.querySelectorAll('.ai-card')]
  const cur = cards.indexOf(document.activeElement)
  if (cur === -1) return
  e.preventDefault()
  const next = e.key === 'ArrowDown' ? Math.min(cards.length - 1, cur + 1) : Math.max(0, cur - 1)
  cards[next].focus()
  cards[next].scrollIntoView({ block: 'center', behavior: 'smooth' })
}

onMounted(() => { load(); window.addEventListener('keydown', onKey) })
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <section class="page active ai-tl" ref="rootEl">
    <div class="page-head">
      <div>
        <p class="eyebrow">AI 今日大事</p>
        <h1>五个模型，一条时间线</h1>
        <p>从今天往前倒着读。每条只回答三件事：这天更新了什么、具体能做到什么、从哪个官网查到的。</p>
      </div>
      <div class="ai-range">
        <button :class="{ on: range === 90 }" @click="range = 90">近 90 天</button>
        <button :class="{ on: range === 365 }" @click="range = 365">近一年</button>
        <button :class="{ on: range === 'all' }" @click="range = 'all'">全部</button>
      </div>
    </div>

    <!-- 五个数字：只放能直接判断「值不值得往下读」的指标 -->
    <div class="ai-stats">
      <div class="stat accent"><b>{{ total }}</b><span>{{ rangeLabel }}更新</span></div>
      <div class="stat"><b>5</b><span>覆盖模型</span></div>
      <div class="stat warm"><b>{{ majorCount }}</b><span>重磅版本</span></div>
      <div class="stat"><b>{{ busiest }}</b><span>最活跃</span></div>
      <div class="stat"><b>{{ offCount }} / {{ total }}</b><span>官方一手来源</span></div>
    </div>

    <div v-if="newCount" class="ai-fresh">
      自上次查看（{{ shortDate(seenDate) }}）后新增 <b>{{ newCount }}</b> 条
      <button @click="markAllSeen">全部标为已读</button>
    </div>

    <!-- 能力基线：不是新闻，是「现在到底能做到什么」。点一行跳到改写它的那次更新 -->
    <section class="ai-base" v-if="baseline.length">
      <div class="base-head">
        <h2 class="with-face"><AppFace slot="ai-base" />当前能力基线</h2>
        <span>现在到底能做到什么 · 点一行跳到改写它的那次更新</span>
        <button class="base-btn" @click="baseOpen = !baseOpen">{{ baseOpen ? '收起' : '展开' }}</button>
      </div>
      <div class="base-list" v-show="baseOpen">
        <div class="base-th"><span>能力域</span><span>现在能做到什么</span><span>改写于</span><span>最近改写来自</span></div>
        <div
          v-for="b in baseline" :key="b.k" class="base-row" :class="{ 'empty-row': b.gap }"
          :style="{ '--c': MODELS[b.model]?.c }" tabindex="0"
          :title="`跳到 ${b.lastDate} 那次更新`"
          @click="jumpTo(b.lastDate, b.model)" @keydown.enter="jumpTo(b.lastDate, b.model)"
        >
          <div class="k"><i></i>{{ b.k }}</div>
          <div class="v" v-html="b.vhtml"></div>
          <div class="when">{{ shortDate(b.lastDate) }}</div>
          <div class="who">{{ b.who }}</div>
        </div>
      </div>
    </section>

    <!-- 筛选：模型单选 + 领域多选 + 只看重磅 -->
    <section class="ai-filters">
      <div class="chips">
        <button class="chip" :class="{ on: fModel === 'all' }" @click="pickModel('all')">
          全部模型<span class="n">{{ total }}</span>
        </button>
        <button
          v-for="k in MODEL_KEYS" :key="k" class="chip" :class="{ on: fModel === k }"
          :style="{ '--c': MODELS[k].c }" @click="pickModel(k)"
        >
          <i :style="{ background: MODELS[k].c }"></i>{{ MODELS[k].name }}<span class="n">{{ countBy(e => e.model === k) }}</span>
        </button>
        <button class="chip major-toggle" :class="{ on: onlyMajor }" @click="onlyMajor = !onlyMajor">只看重磅</button>
      </div>
      <div class="chips">
        <button class="chip dom" :class="{ on: !fDom.length }" @click="fDom = []">
          {{ fDom.length > 1 ? `清除（${fDom.length}）` : '所有领域' }}
        </button>
        <button
          v-for="d in domChips" :key="d.key" class="chip dom" :class="{ on: fDom.includes(d.key) }"
          @click="toggleDom(d.key)"
        >{{ d.label }}<span class="n"> {{ d.n }}</span></button>
      </div>
    </section>

    <!-- 热力条：谁在什么时候发东西，点格子直达那天 -->
    <section class="ai-heat">
      <div class="heat-head">
        <h2 class="with-face"><AppFace slot="ai-rhythm" />近 52 周，谁在什么时候发东西</h2>
        <span>点任意格子跳到那天</span>
      </div>
      <div class="heat-scroll">
        <div class="heat-grid">
          <template v-for="row in heat" :key="row.key">
            <div class="heat-lab"><i :style="{ background: row.color }"></i>{{ row.name }}</div>
            <div
              v-for="c in row.cells" :key="c.key" class="heat-cell" :class="c.lv ? 'l' + c.lv : 'off'"
              :title="c.title" @click="c.date && jumpTo(c.date, row.key)"
            ></div>
          </template>
        </div>
        <div class="heat-axis">
          <span></span><span v-for="(a, i) in heatAxis" :key="i">{{ a }}</span>
        </div>
      </div>
    </section>

    <div v-if="loading" class="ai-empty">正在从数据库读时间线…</div>
    <div v-else-if="errText" class="ai-empty err">{{ errText }}<button class="retry" @click="load">重试</button></div>
    <div v-else-if="!visible.length" class="ai-empty">这个组合下没有记录。换个模型或领域试试。</div>

    <main class="ai-timeline" v-else>
      <template v-for="(g, gi) in groups" :key="g.key">
        <div class="month"><b>{{ g.y }} 年 {{ g.m }} 月</b><span>{{ g.count }} 条</span></div>
        <div class="now" v-if="gi === 0">
          <div class="date">今天</div>
          <div class="rail"><span class="pulse"></span></div>
          <div class="txt">时间线从这里往下读 · 当前区间共 <b>{{ total }}</b> 条</div>
        </div>
        <article
          v-for="e in g.events" :key="e.id" class="ev" :class="{ major: e.weight === 'major' }"
          :style="{ '--c': MODELS[e.model]?.c }" :data-date="e.date"
        >
          <div class="date"><b>{{ String(md(e.date).d).padStart(2, '0') }}</b><i>{{ g.m }} 月 · {{ rel(e.date) }}</i></div>
          <div class="rail"><span class="dot"></span></div>
          <div
            class="card" :class="{ open: openIds.has(e.id), brief: !e.what }" tabindex="0"
            @click="toggleCard(e.id, $event)" @keydown.enter.prevent="toggleCard(e.id)" @keydown.space.prevent="toggleCard(e.id)"
          >
            <div class="row1">
              <span class="pill">{{ MODELS[e.model]?.name }}</span>
              <span class="ver">{{ e.version }}</span>
              <span class="badge-major" v-if="e.weight === 'major'">重磅</span>
              <span class="newdot" v-if="isNew(e)" title="你上次查看后新增"></span>
            </div>
            <h3>{{ e.title }}</h3>

            <template v-if="e.what">
              <p class="what">{{ e.what }}</p>
              <div class="caps" v-if="e.caps && e.caps.length">
                <b>能做到</b>
                <ul><li v-for="(c, i) in e.caps" :key="i">{{ c }}</li></ul>
              </div>
              <div class="why" v-if="e.why"><b>为什么值得记</b>{{ e.why }}</div>
            </template>

            <div class="meta">
              <span class="tag" v-for="t in e.tags" :key="t">#{{ DOMAIN_LABEL[t] || t }}</span>
            </div>
            <div class="more" v-if="e.more">{{ e.more }}</div>
            <div class="srcrow" v-if="e.what">
              <span class="st" :class="e.srcType">{{ e.srcType === 'off' ? '官方一手' : '媒体报道' }}</span>
              <a v-if="e.srcUrl" :href="e.srcUrl" target="_blank" rel="noopener noreferrer" :title="e.srcUrl">{{ e.srcName }} ↗</a>
              <span v-else class="seen-plain">{{ e.srcName || '来源待补' }}</span>
              <span class="seen" v-if="e.checkedAt">查于 {{ e.checkedAt }}</span>
            </div>
          </div>
        </article>
      </template>
    </main>

    <footer class="ai-foot">
      <b>来源怎么标</b>：绿标「官方一手」= 直接来自厂商博客、changelog、System Cards 或 API 公告，点开就是官网原文；灰标「媒体报道」= 官方没给可独立引用的页面，取自可靠媒体或第三方版本总表，同样附原始链接。<br />
      <b>日期口径</b>：同一版本在不同媒体上可能差 1 天（时区或分批推送），统一按官方首发日记；官方只到月份的，用第三方版本总表补齐并标灰。<br />
      <b>数据怎么进来</b>：初始快照为 2026-10-26 逐条核过的真实记录，之后由每日任务往 <code>/api/ai-events</code> 投递，同一条重复投递不会生成重复卡片。
    </footer>
  </section>
</template>

<style scoped>
.ai-tl{
  --c-line: var(--line-2);
  --c-line-2: var(--line-3);
  --c-surface: var(--surface-solid);
  --c-accent: var(--accent);
  --c-warm: var(--warm);
  --m-openai:#0f9d76; --m-claude:#c96a4a; --m-deepseek:#4d6bfe; --m-kimi:#7c5cff; --m-gemini:#3f7ef0;
  --r-ev:16px;
}
:global([data-theme="dark"]) .ai-tl{
  --m-openai:#3ec9a0; --m-claude:#e08f6f; --m-deepseek:#7d94ff; --m-kimi:#a48cff; --m-gemini:#79a6ff;
}

/* ===== 顶部区间切换 ===== */
.ai-range{
  display:inline-flex;padding:3px;border:1px solid var(--c-line);border-radius:999px;
  background:var(--surface);align-self:flex-end;
}
.ai-range button{
  border:0;background:none;font:inherit;font-size:12.5px;color:var(--text-2);
  padding:5px 13px;border-radius:999px;cursor:pointer;transition:.16s;white-space:nowrap;
}
.ai-range button.on{background:var(--accent);color:#fff;font-weight:600;box-shadow:0 2px 8px -2px var(--accent-soft)}
.ai-range button:not(.on):hover{color:var(--text)}

/* ===== 五个数字 ===== */
.ai-stats{display:flex;gap:10px;flex-wrap:wrap}
.ai-stats .stat{
  flex:1 1 140px;min-width:132px;padding:12px 15px;border:1px solid var(--c-line);
  border-radius:14px;background:var(--c-surface);box-shadow:var(--shadow);
}
.ai-stats .stat b{display:block;font-size:22px;font-weight:750;letter-spacing:-.5px;font-variant-numeric:tabular-nums;line-height:1.25}
.ai-stats .stat span{font-size:11.5px;color:var(--text-3)}
.ai-stats .stat.accent b{color:var(--c-accent)}
.ai-stats .stat.warm b{color:var(--c-warm)}

/* ===== 未读提示 ===== */
.ai-fresh{
  display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:11px;font-size:12px;color:var(--text-2);
  background:var(--accent-soft);border:1px solid rgba(125,91,166,.24);
}
.ai-fresh b{color:var(--c-accent);font-variant-numeric:tabular-nums}
.ai-fresh button{
  margin-left:auto;font-size:11.5px;color:var(--c-accent);background:none;
  border:1px solid rgba(125,91,166,.42);border-radius:999px;padding:2px 9px;cursor:pointer;transition:background .15s;
}
.ai-fresh button:hover{background:var(--accent-soft)}
.newdot{width:6px;height:6px;border-radius:50%;background:var(--c-accent);box-shadow:0 0 0 3px rgba(125,91,166,.16);flex:0 0 auto;margin-left:2px}

/* ===== 能力基线 ===== */
.ai-base{margin:0}
.base-head{display:flex;align-items:baseline;gap:12px;margin-bottom:9px;flex-wrap:wrap}
.base-head h2{font-size:14.5px;font-weight:700;letter-spacing:-.2px;margin:0}
.base-head span{font-size:11.5px;color:var(--text-3)}
.base-btn{margin-left:auto;font-size:11.5px;color:var(--text-3);background:none;border:1px solid var(--c-line);border-radius:999px;padding:3px 10px;cursor:pointer;transition:color .15s,border-color .15s}
.base-btn:hover{color:var(--text);border-color:var(--c-line-2)}
.base-list{border:1px solid var(--c-line);border-radius:14px;background:var(--c-surface);overflow:hidden;box-shadow:var(--shadow)}
.base-th{
  display:grid;grid-template-columns:76px minmax(0,1fr) 74px 106px;gap:14px;
  padding:7px 14px;border-bottom:1px solid var(--c-line);font-size:10.5px;color:var(--text-3);letter-spacing:.4px;
}
.base-row{
  display:grid;grid-template-columns:76px minmax(0,1fr) 74px 106px;
  gap:14px;align-items:center;padding:10px 14px;border-top:1px solid var(--c-line);
  font-size:12.5px;cursor:pointer;transition:background .15s;
}
.base-row:first-child{border-top:none}
.base-row:hover{background:var(--accent-soft)}
.base-row .k{display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px;color:var(--text);white-space:nowrap}
.base-row .k i{width:6px;height:6px;border-radius:50%;background:var(--c);flex:0 0 auto}
.base-row .v{color:var(--text-2);line-height:1.55;min-width:0}
.base-row .v :deep(em){font-style:normal;color:var(--text);font-weight:650}
.base-row .v :deep(.neg){color:var(--c-warm);font-weight:650}
.base-row .when{font-size:11.5px;color:var(--text-3);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.base-row .who{font-size:11.5px;color:var(--text-3);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.base-row.empty-row{background:rgba(201,169,97,.045)}

/* ===== 筛选：粘在滚动容器顶部，长列表里换模型不用滚回去 ===== */
.ai-filters{
  /* top 必须是负的：.pages 有 padding-top:22px，sticky 只会粘在内容盒上沿，
     于是条子上方会漏出一条 22px 的缝，滚过去的热力图从缝里露出来（2026-10-27 反馈）。
     -22px 把条子顶到 padding 区里，padding-top 26 再把胶囊的位置补回来，视觉位置不变。 */
  position:sticky;top:-22px;z-index:20;
  padding:26px 8px 12px;margin:-22px 0 -4px;
  /* 必须是实底。原来用 62% 半透明 + backdrop-filter:blur(12px)，
     滚动时下面的标题会透上来，字叠字像重影；模糊只能柔化，去不掉 38% 的透光。 */
  background:var(--surface-solid);
  border-bottom:1px solid var(--c-line);border-radius:0 0 14px 14px;
  /* 用一条极淡的下投影交代「它浮在内容上面」，比半透明干净 */
  box-shadow:0 12px 20px -18px rgba(70,48,110,.5);
}
:global([data-theme="dark"]) .ai-filters{box-shadow:0 12px 20px -18px rgba(0,0,0,.85)}
.chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.chips + .chips{margin-top:9px}
.chip{
  display:inline-flex;align-items:center;gap:7px;
  border:1px solid var(--c-line);background:var(--c-surface);color:var(--text-2);
  font-size:12.5px;font-weight:600;padding:6px 13px;border-radius:999px;cursor:pointer;transition:.15s;white-space:nowrap;
}
.chip i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 auto}
.chip .n{font-size:10.5px;font-weight:700;color:var(--text-3);font-variant-numeric:tabular-nums}
.chip:hover{border-color:var(--c-line-2);color:var(--text);transform:translateY(-1px)}
.chip.on{background:var(--text);color:var(--surface-solid);border-color:transparent}
.chip.on .n{color:color-mix(in srgb, var(--surface-solid) 72%, transparent)}
.chip.dom{font-weight:500;color:var(--text-3);padding:4px 9px;font-size:11.5px;gap:5px}
.chip.dom.on{background:var(--accent-soft);color:var(--c-accent);border-color:rgba(125,91,166,.3)}
.chip.major-toggle{margin-left:auto;font-weight:500;color:var(--text-3);font-size:12px}
.chip.major-toggle.on{background:var(--warm-soft);color:#a9662a;border-color:rgba(208,136,72,.32)}
:global([data-theme="dark"]) .chip.major-toggle.on{color:var(--c-warm)}

/* ===== 热力条 ===== */
.ai-heat{
  border:1px solid var(--c-line);border-radius:var(--r-ev);background:var(--c-surface);
  padding:15px 17px 13px;box-shadow:var(--shadow);
}
.heat-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.heat-head h2{margin:0;font-size:13px;font-weight:700;letter-spacing:.2px}
.heat-head span{font-size:11.5px;color:var(--text-3)}
.heat-grid{display:grid;grid-template-columns:76px repeat(52,minmax(0,1fr));gap:3px;align-items:center}
.heat-lab{font-size:11px;color:var(--text-3);display:flex;align-items:center;gap:6px;white-space:nowrap}
.heat-lab i{width:6px;height:6px;border-radius:50%}
.heat-cell{height:16px;border-radius:5px;border:1px solid transparent;background:rgba(72,50,110,.05);cursor:pointer;transition:.14s;position:relative}
:global([data-theme="dark"]) .heat-cell{background:rgba(255,255,255,.05)}
.heat-cell:hover{outline:2px solid var(--text-3);outline-offset:1px}
.heat-cell.l1{background:rgba(125,91,166,.22)}
.heat-cell.l2{background:rgba(125,91,166,.45)}
.heat-cell.l3{background:rgba(125,91,166,.72)}
.heat-cell.off{opacity:.22;cursor:default}
.heat-axis{display:grid;grid-template-columns:76px repeat(52,minmax(0,1fr));gap:3px;margin-top:6px}
.heat-axis span{font-size:10px;color:var(--text-3);text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}
.heat-scroll{overflow-x:auto;overflow-y:hidden}

/* ===== 时间线 ===== */
.ai-timeline{position:relative}
.month{display:flex;align-items:center;gap:10px;margin:26px 0 4px;padding-left:2px}
.month b{
  font-size:12px;font-weight:700;letter-spacing:1.4px;color:var(--text-2);
  padding:4px 11px;border-radius:999px;background:var(--c-surface);border:1px solid var(--c-line);
}
.month span{font-size:11.5px;color:var(--text-3)}
.month::after{content:"";flex:1;height:1px;background:var(--c-line)}

.ev{display:grid;grid-template-columns:84px 46px minmax(0,1fr);gap:0;padding:9px 0;position:relative}
.ev .date{text-align:right;padding-right:6px;padding-top:12px;display:flex;flex-direction:column;align-items:flex-end;gap:1px}
.ev .date b{font-size:20px;font-weight:750;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.ev .date i{font-style:normal;font-size:10.5px;color:var(--text-3);font-variant-numeric:tabular-nums}
.ev .rail{position:relative;display:flex;justify-content:center}
.ev .rail::before{content:"";position:absolute;top:0;bottom:-18px;width:1.5px;background:linear-gradient(180deg,var(--c-line-2),var(--c-line))}
.ev:first-of-type .rail::before{top:18px}
.ev .dot{
  position:relative;z-index:2;width:11px;height:11px;border-radius:50%;margin-top:17px;
  background:var(--c);box-shadow:0 0 0 4px color-mix(in srgb, var(--c) 16%, transparent);
}
.ev.major .dot{width:14px;height:14px;margin-top:15px;box-shadow:0 0 0 5px color-mix(in srgb, var(--c) 20%, transparent)}

.card{
  border:1px solid var(--c-line);border-radius:var(--r-ev);background:var(--c-surface);
  padding:14px 17px 13px;box-shadow:var(--shadow);cursor:pointer;
  transition:transform .18s,border-color .18s,box-shadow .18s;
  border-left:3px solid color-mix(in srgb, var(--c) 55%, transparent);outline:none;
}
.card:hover{transform:translateY(-2px);border-color:color-mix(in srgb, var(--c) 40%, var(--c-line))}
.card:focus-visible{box-shadow:var(--shadow),var(--ring)}
.ev.major .card{background:linear-gradient(180deg,color-mix(in srgb, var(--c) 6%, var(--c-surface)),var(--c-surface))}
.card .row1{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:7px}
.pill{
  display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;letter-spacing:.2px;
  padding:2.5px 9px;border-radius:999px;background:color-mix(in srgb, var(--c) 13%, transparent);
  color:var(--c);border:1px solid color-mix(in srgb, var(--c) 26%, transparent);
}
.ver{font-size:11.5px;color:var(--text-3);font-weight:600}
.badge-major{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:6px;background:var(--warm-soft);color:#a9662a;border:1px solid rgba(208,136,72,.28)}
:global([data-theme="dark"]) .badge-major{color:var(--c-warm)}
.card h3{margin:0 0 6px;font-size:15.5px;line-height:1.45;letter-spacing:-.2px;font-weight:700}
.card.brief h3{margin-bottom:0}
.card .what{margin:0;font-size:12.8px;line-height:1.72;color:var(--text-2)}
.card .why{
  margin:10px 0 0;padding:8px 11px;border-radius:10px;
  background:color-mix(in srgb, var(--c) 6%, transparent);
  border-left:2px solid color-mix(in srgb, var(--c) 45%, transparent);
  font-size:12.3px;line-height:1.7;color:var(--text-2);
}
.card .why b{color:var(--c);font-weight:700;margin-right:5px;font-size:11px;letter-spacing:.4px}
.caps{margin-top:9px}
.caps > b{display:block;font-size:11px;font-weight:700;letter-spacing:.4px;color:var(--c);margin-bottom:4px}
.caps ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}
.caps li{position:relative;padding-left:15px;font-size:12.2px;line-height:1.62;color:var(--text-2)}
.caps li::before{content:"✓";position:absolute;left:0;top:0;font-size:10.5px;font-weight:700;color:color-mix(in srgb, var(--c) 70%, transparent)}
.srcrow{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:9px;padding-top:9px;border-top:1px dashed var(--c-line)}
.srcrow .st{font-size:10px;font-weight:700;padding:1.5px 6px;border-radius:5px;flex:0 0 auto}
.srcrow .st.off{background:var(--accent-soft);color:var(--c-accent);border:1px solid rgba(125,91,166,.26)}
.srcrow .st.media{background:color-mix(in srgb, var(--text) 6%, transparent);color:var(--text-3);border:1px solid var(--c-line)}
.srcrow a{
  font-size:11.5px;color:var(--text-2);text-decoration:none;border-bottom:1px dotted var(--c-line-2);
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.srcrow a:hover{color:var(--c-accent);border-bottom-color:currentColor}
.srcrow .seen-plain{font-size:11.5px;color:var(--text-3)}
.srcrow .seen{margin-left:auto;font-size:10.5px;color:var(--text-3);flex:0 0 auto}
.card .meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:10px}
.tag{
  font-size:10.5px;color:var(--text-3);padding:2px 8px;border-radius:999px;
  background:color-mix(in srgb, var(--text) 4%, transparent);border:1px solid var(--c-line);
}
/* 详情默认折叠：列表只留标题+一句说明，想看细节点开这张卡 */
.card .more{max-height:0;overflow:hidden;transition:max-height .32s ease;font-size:12.3px;color:var(--text-2);line-height:1.75}
.card.open .more{max-height:400px;margin-top:9px;padding-top:9px;border-top:1px dashed var(--c-line)}

.now{display:grid;grid-template-columns:84px 46px minmax(0,1fr);align-items:center;margin-bottom:6px}
.now .date{text-align:right;padding-right:6px;font-size:11px;color:var(--text-3)}
.now .rail{display:flex;justify-content:center;position:relative}
.now .rail .pulse{width:9px;height:9px;border-radius:50%;background:var(--c-accent);box-shadow:0 0 0 4px rgba(125,91,166,.16)}
.now .txt{font-size:12px;color:var(--text-3)}
.now .txt b{color:var(--text-2);font-weight:600}

.ai-empty{
  padding:50px 24px;text-align:center;border:1px dashed var(--c-line-2);border-radius:var(--r-ev);
  color:var(--text-3);font-size:13px;background:color-mix(in srgb, var(--c-surface) 55%, transparent);
}
.ai-empty.err{color:#b4534a}
.ai-empty .retry{margin-left:10px;font-size:12px;color:var(--c-accent);border:1px solid rgba(125,91,166,.42);border-radius:999px;padding:3px 11px}
.ai-foot{font-size:11.5px;color:var(--text-3);line-height:1.9}
.ai-foot b{color:var(--text-2);font-weight:600}
.ai-foot code{font-size:11px;background:color-mix(in srgb, var(--text) 6%, transparent);padding:1px 5px;border-radius:5px}

@media (max-width:820px){
  .ai-stats .stat{flex:1 1 calc(50% - 6px);min-width:0}
  .ai-range{align-self:flex-start}
  .ai-filters{position:static;background:none;backdrop-filter:none;border-bottom:none;padding:0;margin:0}
  .ev{grid-template-columns:56px 26px minmax(0,1fr)}
  .ev .date b{font-size:16px}
  .now{grid-template-columns:56px 26px minmax(0,1fr)}
  .card{padding:12px 13px}
  .heat-grid,.heat-axis{grid-template-columns:64px repeat(52,12px);gap:3px}
  .heat-lab{font-size:10px}
  .chip.major-toggle{margin-left:0}
  .base-head span{display:none}
  .base-row{grid-template-columns:60px minmax(0,1fr) 54px;gap:8px;padding:9px 11px;font-size:12px}
  .base-row .who{display:none}
  .base-th{grid-template-columns:60px minmax(0,1fr) 54px;gap:8px;padding:7px 11px}
  .base-th span:nth-child(4){display:none}
  .base-row .k{font-size:11.5px}
  .ai-fresh{flex-wrap:wrap;gap:6px}
  .ai-fresh button{margin-left:0}
}
</style>
