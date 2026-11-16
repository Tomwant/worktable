<script setup>
// 网页测评：给一批 AI 网站反复出同一道题，记录结果、横向对比。
//
// 为什么主视图是矩阵而不是列表：
//   只看一行行的记录，回头想问「长文摘要这件事谁做得最好」就得自己翻；
//   矩阵把「任务 × 产品」铺开，横着一行看强弱、竖着一列看短板，一眼就能比。
//
// 三个视图：
//   matrix —— 行是任务、列是产品，格子是该组合最后一次的分数，点开就记
//   prod   —— 一个产品一行账：均分、测了几项、最突出的优点
//   feed   —— 测试流水，按时间倒序，点开看当时的提问和回答原文
//
// 记录永远新增、不覆盖：一格里可以测很多次，格子显示最新一条 + ×N 角标。
import { ref, reactive, computed, onMounted } from 'vue'
import { NModal, NInput } from 'naive-ui'
import AppPanel from '../components/AppPanel.vue'
import AppButton from '../components/AppButton.vue'
import AppSeg from '../components/AppSeg.vue'
import AppEmpty from '../components/AppEmpty.vue'
import AppIcon from '../components/AppIcon.vue'
import { notify, notifyError } from '../lib/toast.js'
import {
  evalState, loadEval, loadRuns, loadRun, lastRunOf, saveRun, removeRun,
  addProduct, addTask, removeProduct, removeTask,
  cellOf, productAvg, productById, taskById, gapCount, fillRate,
  SCORE_HINTS, GOOD_TAGS, BAD_TAGS
} from '../stores/eval.js'

const view = ref('matrix')
const viewOpts = [
  { value: 'matrix', label: '测评矩阵' },
  { value: 'prod', label: '产品档案' },
  { value: 'feed', label: '测试流水' }
]
const VIEW_META = {
  matrix: ['测评矩阵', '行是测试任务，列是产品；格子里是最新一次评分，点一下就能记录'],
  prod: ['产品档案', '一个产品一行账：均分、测了几项、最突出的优点'],
  feed: ['测试流水', '按时间倒序，每次测试都留底，点开能看当时的原文']
}
const viewTitle = computed(() => VIEW_META[view.value][0])
const viewDesc = computed(() => VIEW_META[view.value][1])

const products = computed(() => evalState.products)
const tasks = computed(() => evalState.tasks)
const runs = computed(() => evalState.runs)
const fmt = n => (Math.round(n * 10) / 10).toFixed(1)
const overviewDesc = computed(
  () => `${products.value.length} 个产品 · ${tasks.value.length} 条任务 · 已记录 ${evalState.stats.runs} 次评测`
)

onMounted(async () => {
  try {
    await loadEval()
    await loadRuns()
  } catch (err) {
    notifyError(err?.message || '测评数据读取失败，后端没起来？')
  }
})

/* ---------------- 视图切换时按需拉流水 ---------------- */
async function onViewChange(v) {
  if (v !== 'feed') return
  try { await loadRuns() } catch (err) { notifyError(err?.message || '流水读取失败') }
}

/* ================= 记录一次评测 ================= */
const recOpen = ref(false)
const recSaving = ref(false)
const rec = reactive({ pid: '', tid: '', score: 0, good: [], bad: [], seconds: null, prompt: '', answer: '', note: '' })
const recProduct = computed(() => productById(rec.pid))
const recTask = computed(() => taskById(rec.tid))
const recCount = computed(() => cellOf(rec.pid, rec.tid)?.n || 0)
const scoreHint = computed(() => SCORE_HINTS[rec.score] || '未评分')

async function openRecord(pid, tid) {
  const t = taskById(tid)
  Object.assign(rec, {
    pid, tid, score: 0, good: [], bad: [], seconds: '',
    prompt: t?.prompt || '', answer: '', note: ''
  })
  recOpen.value = true
  // 这一格测过的话，把上一次的分数、标签、原文带回来 —— 复测多半是「上次不行，这次再试一次」
  if (!cellOf(pid, tid)) return
  try {
    const full = await lastRunOf(pid, tid)
    if (!full) return
    Object.assign(rec, {
      score: full.score, good: [...full.good], bad: [...full.bad],
      seconds: full.seconds || '', prompt: full.prompt || rec.prompt,
      answer: full.answer || '', note: ''
    })
  } catch { /* 带不回来就从空白开始，不影响这次记录 */ }
}

function toggleTag(kind, tag) {
  const arr = rec[kind]
  const i = arr.indexOf(tag)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(tag)
}

async function submitRecord() {
  if (!rec.score) { notifyError('先给个分，1–5 随便给一个'); return }
  recSaving.value = true
  try {
    await saveRun({
      pid: rec.pid, tid: rec.tid, score: rec.score,
      good: rec.good, bad: rec.bad,
      seconds: Number(rec.seconds) || 0,
      prompt: rec.prompt, answer: rec.answer, note: rec.note
    })
    recOpen.value = false
    notify(`已记录：${recProduct.value?.name} · ${recTask.value?.name}`)
    if (view.value === 'feed') await loadRuns()
  } catch (err) {
    notifyError(err?.message || '没保存成功')
  } finally {
    recSaving.value = false
  }
}

/* ================= 看一条记录的原文 ================= */
const detailOpen = ref(false)
const detail = ref(null)
const detailLoading = ref(false)

async function openDetail(r) {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await loadRun(r.id)
  } catch (err) {
    notifyError(err?.message || '正文读取失败')
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

async function delRun(r) {
  if (!window.confirm('删掉这条评测记录？它在这格里是最后一次的话，格子会退回上一次的分数。')) return
  try {
    await removeRun(r.id)
    detailOpen.value = false
    notify('已删除一条记录')
    await loadRuns()
  } catch (err) { notifyError(err?.message || '删除失败') }
}

/* ================= 产品 / 任务的管理 ================= */
const prodFormOpen = ref(false)
const prodForm = reactive({ name: '', url: '', tag: '' })
const prodSaving = ref(false)

function openProductForm() {
  Object.assign(prodForm, { name: '', url: '', tag: '' })
  prodFormOpen.value = true
}
async function submitProduct() {
  if (!prodForm.name.trim()) { notifyError('产品名不能为空'); return }
  prodSaving.value = true
  try {
    await addProduct({ ...prodForm })
    prodFormOpen.value = false
    notify(`已添加「${prodForm.name.trim()}」，列已经加好了`)
  } catch (err) { notifyError(err?.message || '没添加成功') } finally { prodSaving.value = false }
}

const taskFormOpen = ref(false)
const taskForm = reactive({ name: '', brief: '', prompt: '' })
const taskSaving = ref(false)

function openTaskForm() {
  Object.assign(taskForm, { name: '', brief: '', prompt: '' })
  taskFormOpen.value = true
}
async function submitTask() {
  if (!taskForm.name.trim()) { notifyError('任务名不能为空'); return }
  taskSaving.value = true
  try {
    await addTask({ ...taskForm })
    taskFormOpen.value = false
    notify(`已添加任务「${taskForm.name.trim()}」`)
  } catch (err) { notifyError(err?.message || '没添加成功') } finally { taskSaving.value = false }
}

// 删产品 / 删任务都可能带着评测记录，后端先回 409 拦一次，二次确认后才连记录一起删
async function delProduct(p) {
  const n = evalState.cells.filter(c => c.pid === p.id).length
  if (!window.confirm(`把「${p.name}」从被测列表里删掉？\n\n${n ? `它已有 ${n} 项评测记录，会一起删除。` : '它还没有评测记录。'}`)) return
  try {
    await removeProduct(p.id, n > 0)
    notify(`已删除「${p.name}」${n ? `和 ${n} 项记录` : ''}`)
  } catch (err) { notifyError(err?.message || '删除失败') }
}

async function delTask(t) {
  const n = evalState.cells.filter(c => c.tid === t.id).length
  if (!window.confirm(`删掉任务「${t.name}」？\n\n${n ? `它已有 ${n} 个产品测过，记录会一起删除。` : '还没有产品测过它。'}`)) return
  try {
    await removeTask(t.id, n > 0)
    notify(`已删除任务「${t.name}」${n ? `和 ${n} 项记录` : ''}`)
  } catch (err) { notifyError(err?.message || '删除失败') }
}

/* ================= 渲染辅助 ================= */
function cellClass(pid, tid) {
  const c = cellOf(pid, tid)
  return c ? `s${c.score}` : 'empty'
}
function cellScore(pid, tid) {
  const c = cellOf(pid, tid)
  return c ? c.score : '＋'
}
function cellTimes(pid, tid) {
  const c = cellOf(pid, tid)
  return c && c.n > 1 ? `×${c.n}` : ''
}
/** 某个产品最突出的两个优点（按出现次数取前二），产品档案卡上用 */
function topGood(pid) {
  const cnt = new Map()
  for (const r of evalState.runs) {
    if (r.pid !== pid) continue
    for (const g of r.good) cnt.set(g, (cnt.get(g) || 0) + 1)
  }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0])
}
function productTested(pid) {
  return evalState.cells.filter(c => c.pid === pid).length
}
const pct = pid => Math.round(productAvg(pid) / 5 * 100)
const tagText = r => (r.good.length || r.bad.length ? [...r.good, ...r.bad].slice(0, 2).join(' / ') : '没打标签')
</script>

<template>
<div class="ev">
  <!-- ① 概览 -->
  <AppPanel title="测评概览" :desc="overviewDesc" face="eval-overview">
    <template #actions>
      <AppButton variant="ghost" size="sm" @click="openTaskForm">＋ 新增任务</AppButton>
      <AppButton variant="primary" size="sm" @click="openProductForm">＋ 添加产品</AppButton>
    </template>
    <div class="ev-stats">
      <div class="ev-stat">
        <b>{{ products.length }}</b><span>被测产品</span>
      </div>
      <div class="ev-stat">
        <b>{{ tasks.length }}</b><span>测试任务</span>
      </div>
      <div class="ev-stat">
        <b>{{ evalState.stats.runs }}<i>次</i></b><span>累计评测记录</span>
      </div>
      <div class="ev-stat" :class="{ warn: gapCount > 0 }">
        <b>{{ gapCount }}<i>格</i></b><span>还没测的组合</span>
        <em class="ev-bar"><i :style="{ width: Math.round(fillRate * 100) + '%' }"></i></em>
      </div>
    </div>
  </AppPanel>

  <!-- ② 三个视图 -->
  <AppPanel :title="viewTitle" :desc="viewDesc" face="eval-matrix">
    <template #actions>
      <AppSeg v-model="view" :options="viewOpts" @change="onViewChange" />
    </template>

    <!-- 矩阵 -->
    <div v-if="view === 'matrix'">
      <!-- 缺哪一样就说哪一样：产品被删空、任务还在时，别再说「先加一条测试任务」 -->
      <AppEmpty v-if="!products.length || !tasks.length" plain>
        {{ !products.length && !tasks.length
          ? '先加一个被测产品和一条测试任务，矩阵才有格子。'
          : (!products.length
            ? '还差一个被测产品：点右上角「添加产品」，矩阵就有列了。'
            : '还差一条测试任务：点右上角「新增任务」，矩阵才有行。') }}
      </AppEmpty>
      <div v-else class="ev-grid-wrap">
        <table class="ev-matrix">
          <thead>
            <tr>
              <th class="ev-th-task">测试任务</th>
              <th v-for="p in products" :key="p.id" class="ev-th-prod">
                <span class="pn">{{ p.name }}</span>
                <span class="pa">均分 <b>{{ fmt(productAvg(p.id)) }}</b></span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in tasks" :key="t.id">
              <th class="ev-td-task">
                <span class="tn">{{ t.name }}</span>
                <small v-if="t.brief">{{ t.brief }}</small>
                <button class="ev-row-del" title="删掉这条任务" @click="delTask(t)">
                  <AppIcon name="close" :size="10" />
                </button>
              </th>
              <td v-for="p in products" :key="p.id">
                <button
                  class="ev-cell" :class="cellClass(p.id, t.id)"
                  :title="cellScore(p.id, t.id) === '＋' ? '还没测，点一下记录' : `${p.name} · ${t.name}`"
                  @click="openRecord(p.id, t.id)"
                >
                  {{ cellScore(p.id, t.id) }}
                  <span v-if="cellTimes(p.id, t.id)" class="n">{{ cellTimes(p.id, t.id) }}</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 产品档案 -->
    <div v-else-if="view === 'prod'">
      <AppEmpty v-if="!products.length" plain>还没有被测产品，先点右上角「添加产品」。</AppEmpty>
      <div v-else class="ev-cards">
        <div v-for="p in products" :key="p.id" class="ev-pcard">
          <div class="hd">
            <span class="ico" :style="p.color ? { background: p.color } : null">{{ p.name.slice(0, 2) }}</span>
            <div class="hdc">
              <b :title="p.name">{{ p.name }}</b>
              <span :title="p.url">{{ p.url || '没填网址' }}</span>
            </div>
            <span class="score">{{ fmt(productAvg(p.id)) }}</span>
          </div>
          <div class="bar"><i :style="{ width: pct(p.id) + '%' }"></i></div>
          <div class="ft">
            <span>已测 {{ productTested(p.id) }} 项 / 共 {{ tasks.length }} 项</span>
            <span v-for="g in topGood(p.id)" :key="g" class="tg">{{ g }}</span>
            <button class="ev-card-del" title="删除这个产品" @click="delProduct(p)">
              <AppIcon name="trash" :size="11" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 测试流水 -->
    <div v-else>
      <AppEmpty v-if="!runs.length" plain>还没有记录，去矩阵里点一个格子记第一次。</AppEmpty>
      <div v-else class="ev-feed">
        <button v-for="r in runs" :key="r.id" class="ev-fitem" @click="openDetail(r)">
          <span class="d">{{ (r.date || '').slice(5) }}</span>
          <span class="w">{{ productById(r.pid)?.name || '（产品已删）' }}</span>
          <span class="t">{{ taskById(r.tid)?.name || '（任务已删）' }} <em>· {{ tagText(r) }}</em></span>
          <span class="sc" :class="'s' + r.score">{{ r.score }} 分</span>
        </button>
      </div>
    </div>
  </AppPanel>

  <!-- 记录弹窗 -->
  <NModal v-model:show="recOpen" preset="card" class="ev-modal" style="width:760px;max-width:94vw"
          :title="`${recProduct?.name || ''} · ${recTask?.name || ''}`"
          :bordered="false" :segmented="{ content: true }">
    <p class="ev-sub">{{ recCount ? `已测过 ${recCount} 次，这次会追加一条记录` : '第一次测这一格' }}</p>

    <div class="fld">
      <label>综合评分 <em>1–5，凭手感给，不用算</em></label>
      <div class="ev-dots">
        <button v-for="s in 5" :key="s" class="dot" :class="{ on: rec.score === s }" @click="rec.score = s">{{ s }}</button>
        <span class="hint">{{ scoreHint }}</span>
      </div>
    </div>

    <div class="fld">
      <label>好在哪 / 差在哪 <em>可多选，事后能筛「谁最会做长文档」</em></label>
      <div class="ev-chips">
        <button v-for="g in GOOD_TAGS" :key="g" class="chip" :class="{ on: rec.good.includes(g) }" @click="toggleTag('good', g)">{{ g }}</button>
        <button v-for="b in BAD_TAGS" :key="b" class="chip bad" :class="{ on: rec.bad.includes(b) }" @click="toggleTag('bad', b)">{{ b }}</button>
      </div>
    </div>

    <div class="ev-row2">
      <div class="fld">
        <label>本次提问 <em>默认用任务的提示词，可以这次临时改</em></label>
        <NInput v-model:value="rec.prompt" type="textarea" :rows="2" placeholder="这次实际问它的是什么" />
      </div>
      <div class="fld">
        <label>用时（秒）</label>
        <NInput v-model:value="rec.seconds" placeholder="秒" />
      </div>
    </div>

    <div class="fld">
      <label>它的回答 <em>粘贴原文，以后才比得出同一道题的输出差异</em></label>
      <NInput v-model:value="rec.answer" type="textarea" :rows="6" placeholder="把回答原文贴进来…" />
    </div>

    <div class="fld">
      <label>备注</label>
      <NInput v-model:value="rec.note" placeholder="比如：第 3 轮开始忘记设定的人物语气" />
    </div>

    <div class="ev-ft">
      <span class="tip">保存后这一格显示最新评分，历史记录不会丢，仍可在「测试流水」里翻。</span>
      <AppButton @click="recOpen = false">取消</AppButton>
      <AppButton variant="primary" :loading="recSaving" @click="submitRecord">保存记录</AppButton>
    </div>
  </NModal>

  <!-- 记录详情 -->
  <NModal v-model:show="detailOpen" preset="card" class="ev-modal ev-detail"
          style="width:720px;max-width:94vw"
          :title="detail ? `${productById(detail.pid)?.name || ''} · ${taskById(detail.tid)?.name || ''}` : '记录详情'"
          :bordered="false" :segmented="{ content: true }">
    <div v-if="detailLoading" class="ev-sub">正在读取原文…</div>
    <template v-else-if="detail">
      <div class="ev-drow">
        <span class="badge" :class="'s' + detail.score">{{ detail.score }} 分</span>
        <span class="meta">{{ detail.date }}{{ detail.seconds ? ` · 用了 ${detail.seconds} 秒` : '' }}</span>
        <span v-for="g in detail.good" :key="g" class="tg good">{{ g }}</span>
        <span v-for="b in detail.bad" :key="b" class="tg bad">{{ b }}</span>
      </div>
      <div class="fld">
        <label>当时的提问</label>
        <pre class="ev-pre">{{ detail.prompt || '（没留提问）' }}</pre>
      </div>
      <div class="fld">
        <label>它的回答原文</label>
        <pre class="ev-pre ans">{{ detail.answer || '（没粘回答）' }}</pre>
      </div>
      <div v-if="detail.note" class="fld">
        <label>备注</label>
        <pre class="ev-pre">{{ detail.note }}</pre>
      </div>
    </template>
    <div class="ev-ft">
      <AppButton variant="danger" size="sm" @click="detail && delRun(detail)">删掉这条</AppButton>
      <AppButton variant="primary" @click="detailOpen = false">关闭</AppButton>
    </div>
  </NModal>

  <!-- 添加产品 -->
  <NModal v-model:show="prodFormOpen" preset="card" class="ev-modal" style="width:440px;max-width:94vw"
          title="添加被测产品" :bordered="false" :segmented="{ content: true }">
    <div class="fld">
      <label>产品名 <em>必填</em></label>
      <NInput v-model:value="prodForm.name" placeholder="比如：文心一言" />
    </div>
    <div class="fld">
      <label>网址</label>
      <NInput v-model:value="prodForm.url" placeholder="比如：yiyan.baidu.com" />
    </div>
    <div class="fld">
      <label>分组 <em>用来区分国内 / 海外，可留空</em></label>
      <NInput v-model:value="prodForm.tag" placeholder="国内 / 海外 / 开源" />
    </div>
    <div class="ev-ft">
      <AppButton @click="prodFormOpen = false">取消</AppButton>
      <AppButton variant="primary" :loading="prodSaving" @click="submitProduct">添加</AppButton>
    </div>
  </NModal>

  <!-- 新增任务 -->
  <NModal v-model:show="taskFormOpen" preset="card" class="ev-modal" style="width:600px;max-width:94vw"
          title="新增测试任务" :bordered="false" :segmented="{ content: true }">
    <p class="ev-sub">任务就是「同一道题」，所有产品都拿它测，才能横着比。</p>
    <div class="fld">
      <label>任务名 <em>必填，会显示在矩阵第一列</em></label>
      <NInput v-model:value="taskForm.name" placeholder="比如：合同条款抽取" />
    </div>
    <div class="fld">
      <label>一句话说明 <em>写清这道题要它做到什么</em></label>
      <NInput v-model:value="taskForm.brief" placeholder="比如：从 5 页合同里抽出付款节点，按表格给" />
    </div>
    <div class="fld">
      <label>默认提示词 <em>记录时自动带出来，每次可以临时改</em></label>
      <NInput v-model:value="taskForm.prompt" type="textarea" :rows="5" placeholder="把要发给它的原话写在这里" />
    </div>
    <div class="ev-ft">
      <AppButton @click="taskFormOpen = false">取消</AppButton>
      <AppButton variant="primary" :loading="taskSaving" @click="submitTask">添加</AppButton>
    </div>
  </NModal>
</div>
</template>

<style scoped>
/* 分数色：绿=好、金=凑合、橙=勉强、红=不可用。只有这几处用彩色，别的地方一律走主题令牌。
   深色下绿系的底和描边会沉进背景，所以单给一套更亮的。 */
.ev{
  --ok:#2f7a5b; --ok-soft:rgba(47,122,91,.13); --ok-line:rgba(47,122,91,.28);
  --amber:#b0632f; --amber-soft:rgba(201,120,60,.14); --amber-line:rgba(201,120,60,.28);
}
[data-theme="dark"] .ev{
  --ok:#7dd3a8; --ok-soft:rgba(125,211,168,.20); --ok-line:rgba(125,211,168,.40);
  --amber:#e8a877; --amber-soft:rgba(232,168,119,.14); --amber-line:rgba(232,168,119,.30);
}

/* ---------- 概览数字 ---------- */
.ev-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.ev-stat{
  position:relative;padding:11px 13px;border-radius:16px;
  background:var(--surface-2);border:1px solid var(--line-2);
}
.ev-stat b{display:block;font-size:21px;font-weight:750;letter-spacing:-.6px;line-height:1.25}
.ev-stat b i{font-style:normal;font-size:11px;font-weight:600;color:var(--text-3);margin-left:3px}
.ev-stat span{font-size:11px;color:var(--text-3)}
.ev-stat.warn{background:var(--warm-soft);border-color:rgba(201,169,97,.32)}
.ev-stat.warn b{color:var(--warm)}
.ev-bar{position:absolute;left:13px;right:13px;bottom:8px;height:3px;border-radius:3px;
  background:var(--line-2);overflow:hidden;display:block}
.ev-bar i{display:block;height:100%;border-radius:3px;background:var(--accent);transition:width .3s var(--ease)}

/* ---------- 矩阵 ---------- */
.ev-grid-wrap{
  overflow-x:auto;border-radius:14px;border:1px solid var(--line-2);background:var(--surface-solid);
}
.ev-matrix{border-collapse:separate;border-spacing:0;width:100%;font-variant-numeric:tabular-nums}
.ev-matrix th,.ev-matrix td{padding:0}
.ev-matrix thead th{
  padding:9px 6px;border-bottom:1px solid var(--line-2);vertical-align:bottom;
  position:sticky;top:0;z-index:2;background:var(--surface-solid);
}
.ev-th-task{width:206px;min-width:206px;text-align:left;padding-left:12px!important;
  font-size:11px;font-weight:650;color:var(--text-3)}
.ev-th-prod{width:110px;min-width:110px;text-align:center}
.ev-th-prod .pn{display:block;font-size:11.5px;font-weight:650;color:var(--text);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-th-prod .pa{display:block;font-size:10px;color:var(--text-3);margin-top:1px}
.ev-th-prod .pa b{color:var(--accent-deep);font-weight:700}
[data-theme="dark"] .ev-th-prod .pa b{color:var(--accent)}

.ev-matrix tbody td{border-bottom:1px solid var(--line-2);padding:5px 4px}
.ev-matrix tbody tr:last-child td{border-bottom:0}
.ev-matrix tbody tr:hover td{background:var(--surface-2)}
.ev-td-task{
  position:sticky;left:0;z-index:1;text-align:left;
  padding:9px 10px 9px 12px!important;background:var(--surface-solid);
  border-right:1px solid var(--line-2);border-bottom:1px solid var(--line-2);
}
.ev-td-task .tn{display:block;font-size:11.5px;font-weight:650;color:var(--text);line-height:1.4}
.ev-td-task small{display:block;font-weight:400;font-size:10px;color:var(--text-3);margin-top:1px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:172px}
.ev-row-del{
  position:absolute;right:6px;top:50%;transform:translateY(-50%);
  width:18px;height:18px;border-radius:6px;border:0;background:transparent;
  color:var(--text-3);cursor:pointer;display:grid;place-items:center;
  opacity:0;transition:.15s var(--ease);
}
.ev-td-task{position:sticky}
.ev-td-task:hover .ev-row-del{opacity:1}
.ev-row-del:hover{background:var(--danger-soft);color:var(--danger)}

.ev-cell{
  position:relative;width:100%;height:34px;border-radius:10px;display:grid;place-items:center;
  cursor:pointer;font:inherit;font-size:13px;font-weight:750;
  border:1px solid transparent;transition:.14s var(--ease);
}
.ev-cell:hover{transform:translateY(-1px);box-shadow:0 4px 12px -6px rgba(72,50,110,.5)}
.ev-cell.s5{background:var(--ok-soft);color:var(--ok);border-color:var(--ok-line)}
.ev-cell.s4{background:rgba(47,122,91,.07);color:var(--ok);border-color:rgba(47,122,91,.16)}
[data-theme="dark"] .ev-cell.s4{background:rgba(125,211,168,.10);border-color:rgba(125,211,168,.22)}
.ev-cell.s3{background:var(--warm-soft);color:#a8843c;border-color:rgba(201,169,97,.34)}
[data-theme="dark"] .ev-cell.s3{color:var(--warm)}
.ev-cell.s2{background:var(--amber-soft);color:var(--amber);border-color:var(--amber-line)}
.ev-cell.s1{background:var(--danger-soft);color:var(--danger);border-color:rgba(184,67,79,.26)}
.ev-cell.empty{background:transparent;border:1px dashed var(--line-3);color:var(--text-3);font-weight:400;font-size:14px}
.ev-cell.empty:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.ev-cell .n{
  position:absolute;top:-3px;right:-3px;font-size:8.5px;font-weight:700;line-height:1;
  padding:2px 3px;border-radius:6px;background:var(--surface-solid);
  color:var(--text-3);border:1px solid var(--line-2);
}

/* ---------- 产品档案 ---------- */
.ev-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(226px,1fr));grid-auto-rows:1fr;gap:10px}
.ev-pcard{
  position:relative;border:1px solid var(--line-2);border-radius:16px;padding:12px 13px;
  background:var(--surface-solid);display:flex;flex-direction:column;gap:8px;transition:.16s var(--ease);
}
.ev-pcard:hover{border-color:var(--line-3);transform:translateY(-2px);box-shadow:0 10px 24px -16px rgba(72,50,110,.6)}
.ev-pcard .hd{display:flex;align-items:center;gap:9px}
.ev-pcard .ico{
  width:30px;height:30px;border-radius:10px;flex:0 0 auto;display:grid;place-items:center;
  font-size:10.5px;font-weight:750;color:#fff;letter-spacing:-.5px;
  background:linear-gradient(140deg,var(--accent),var(--accent-deep));
}
.ev-pcard .hdc{flex:1;min-width:0}
.ev-pcard .hdc b{display:block;font-size:12.5px;font-weight:700;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-pcard .hdc span{display:block;font-size:10px;color:var(--text-3);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-pcard .score{font-size:17px;font-weight:750;letter-spacing:-.5px;color:var(--accent-deep);flex:0 0 auto}
[data-theme="dark"] .ev-pcard .score{color:var(--accent)}
.ev-pcard .bar{height:4px;border-radius:3px;background:var(--accent-soft);overflow:hidden}
.ev-pcard .bar i{display:block;height:100%;border-radius:3px;
  background:linear-gradient(90deg,var(--accent),var(--accent-deep));transition:width .3s var(--ease)}
.ev-pcard .ft{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--text-3);
  min-width:0;flex-wrap:wrap}
.ev-card-del{
  position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:7px;
  border:0;background:transparent;color:var(--text-3);cursor:pointer;
  display:grid;place-items:center;opacity:0;transition:.15s var(--ease);
}
.ev-pcard:hover .ev-card-del{opacity:1}
.ev-card-del:hover{background:var(--danger-soft);color:var(--danger)}

.tg{font-size:10px;padding:1px 6px;border-radius:7px;background:var(--surface-2);
  border:1px solid var(--line-2);color:var(--text-2);white-space:nowrap}
.tg.good{background:var(--ok-soft);border-color:transparent;color:var(--ok)}
.tg.bad{background:var(--danger-soft);border-color:transparent;color:var(--danger)}

/* ---------- 流水 ---------- */
.ev-feed{display:flex;flex-direction:column}
.ev-fitem{
  display:grid;grid-template-columns:54px 100px 1fr auto;gap:10px;align-items:center;
  padding:9px 4px;border-bottom:1px solid var(--line-2);background:transparent;
  border-left:0;border-right:0;border-top:0;width:100%;text-align:left;
  font:inherit;cursor:pointer;transition:.15s var(--ease);
}
.ev-fitem:last-child{border-bottom:0}
.ev-fitem:hover{background:var(--surface-2)}
.ev-fitem .d{font-size:10.5px;color:var(--text-3);font-variant-numeric:tabular-nums}
.ev-fitem .w{font-size:11.5px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-fitem .t{font-size:11.5px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev-fitem .t em{font-style:normal;color:var(--text-3)}
.ev-fitem .sc{font-size:11px;font-weight:750;padding:2px 8px;border-radius:8px;white-space:nowrap}
.sc.s5,.sc.s4{background:var(--ok-soft);color:var(--ok)}
.sc.s3{background:var(--warm-soft);color:#a8843c}
.sc.s2{background:var(--amber-soft);color:var(--amber)}
.sc.s1{background:var(--danger-soft);color:var(--danger)}

/* ---------- 弹窗内部 ---------- */
.ev-sub{margin:-4px 0 14px;font-size:11.5px;color:var(--text-3)}
.fld{margin-bottom:13px}
.fld>label{display:block;font-size:11px;font-weight:650;color:var(--text-2);margin-bottom:6px}
.fld>label em{font-style:normal;font-weight:400;color:var(--text-3);margin-left:4px}
.ev-row2{display:grid;grid-template-columns:1fr 130px;gap:10px}

.ev-dots{display:flex;align-items:center;gap:7px}
.dot{
  width:34px;height:34px;border-radius:11px;display:grid;place-items:center;
  border:1px solid var(--line-2);background:var(--surface-2);color:var(--text-3);
  font:inherit;font-size:12.5px;font-weight:750;cursor:pointer;transition:.14s var(--ease);
}
.dot:hover{border-color:var(--line-3);color:var(--text);transform:translateY(-1px)}
.dot.on{color:#fff;border-color:transparent;
  background:linear-gradient(140deg,var(--accent),var(--accent-deep));
  box-shadow:0 6px 14px -8px rgba(125,91,166,.8)}
[data-theme="dark"] .dot.on{color:#221a33}
.ev-dots .hint{font-size:11px;color:var(--text-3);margin-left:4px}

.ev-chips{display:flex;flex-wrap:wrap;gap:6px}
.ev-chips .chip{
  font:inherit;font-size:11px;padding:3px 9px;border-radius:9px;cursor:pointer;
  border:1px solid var(--line-2);background:transparent;color:var(--text-2);
  transition:.14s var(--ease);
}
.ev-chips .chip:hover{border-color:var(--line-3);color:var(--text)}
.ev-chips .chip.on{background:var(--accent-soft);border-color:transparent;color:var(--accent-deep);font-weight:650}
.ev-chips .chip.on.bad{background:var(--danger-soft);color:var(--danger)}
[data-theme="dark"] .ev-chips .chip.on{color:var(--accent)}

.ev-ft{display:flex;align-items:center;gap:8px;margin-top:16px;padding-top:14px;
  border-top:1px solid var(--line-2)}
.ev-ft .tip{font-size:10.5px;color:var(--text-3);margin-right:auto;line-height:1.5}

.ev-drow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.ev-drow .badge{font-size:12px;font-weight:750;padding:3px 10px;border-radius:9px}
.ev-drow .badge.s5,.ev-drow .badge.s4{background:var(--ok-soft);color:var(--ok)}
.ev-drow .badge.s3{background:var(--warm-soft);color:#a8843c}
.ev-drow .badge.s2{background:var(--amber-soft);color:var(--amber)}
.ev-drow .badge.s1{background:var(--danger-soft);color:var(--danger)}
.ev-drow .meta{font-size:11px;color:var(--text-3)}
.ev-pre{
  margin:0;padding:10px 12px;border-radius:12px;background:var(--surface-2);
  border:1px solid var(--line-2);font:12px/1.75 "Microsoft YaHei",system-ui,sans-serif;
  color:var(--text-2);white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;
}
.ev-pre.ans{max-height:340px;color:var(--text)}

/* ---------- 窄屏 ---------- */
@media (max-width:820px){
  .ev-stats{grid-template-columns:repeat(2,1fr)}
  .ev-row2{grid-template-columns:1fr}
  .ev-fitem{grid-template-columns:50px 1fr auto}
  .ev-fitem .t{display:none}
  .ev-ft{flex-wrap:wrap}
  .ev-ft .tip{width:100%;margin-right:0;order:-1;margin-bottom:4px}
}
</style>
