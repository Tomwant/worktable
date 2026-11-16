<script setup>
// 奇思妙想：想法列表 → 点进去看台阶
// 一个 idea 的阶段与成果都在 steps 里，阶数可以几十个；界面上永远只摊开当前这一段 5 级，前后用「⋯」折叠
import { ref, computed, onMounted } from 'vue'
import { NModal } from 'naive-ui'
import AppInput from '../components/AppInput.vue'
import AppEmpty from '../components/AppEmpty.vue'
import AppFace from '../components/AppFace.vue'
import { ideasStore, loadIdeas, createIdea, updateIdea, deleteIdea, notify } from '../stores/index.js'
import { useDetailRoute } from '../lib/useDetailRoute.js'
import { useHotkeys } from '../lib/useHotkeys.js'

const WIDE = 5                     // 一屏最多摊开的阶数
const DEFAULT_STEPS = ['灵感', '验证', '雏形', '推进', '落地']

const openId = ref('')
const winFrom = ref(null)          // null = 窗口跟着当前阶走
const editIdx = ref(-1)            // 哪一级正在输入成果
const draft = ref('')
const nameEdit = ref(-1)           // 哪一级正在改名字
const nameDraft = ref('')
const resEdit = ref('')            // 哪一条成果正在改内容，格式 "阶:序号"
const resDraft = ref('')
const saving = ref(false)
let committing = false

// 进编辑态就把光标放进去
const vFocus = { mounted: el => { el.focus(); el.select?.() } }

const dialog = ref(false)
const form = ref({ mode: 'new', name: '', pitch: '' })   // mode: new | stage | rename

const items = computed(() => ideasStore.items)
const cur = computed(() => items.value.find(i => i.id === openId.value) || null)

const doneN = i => i.steps.filter(s => s.done).length
const flagsN = i => i.steps.reduce((n, s) => n + s.results.length, 0)
const stageOf = i => (doneN(i) >= i.steps.length ? '已落地' : (i.steps[doneN(i)]?.name || '灵感'))

const stats = computed(() => {
  const all = items.value
  return {
    total: all.length,
    going: all.filter(i => doneN(i) > 0 && doneN(i) < i.steps.length).length,
    landed: all.filter(i => i.steps.length && doneN(i) === i.steps.length).length,
    flags: all.reduce((n, i) => n + flagsN(i), 0)
  }
})

// 详情页的可见窗口：≤WIDE 全铺；更多只摊开当前这一段
const view = computed(() => {
  const i = cur.value
  if (!i) return null
  const total = i.steps.length
  const done = doneN(i)
  const allDone = total > 0 && done === total
  const curIdx = allDone ? total - 1 : done
  let from = 0
  let to = total - 1
  if (total > WIDE) {
    const w = winFrom.value === null ? Math.max(0, curIdx - 1) : winFrom.value
    from = Math.min(Math.max(0, w), total - WIDE)
    to = Math.min(total - 1, from + WIDE - 1)
  }
  const cells = []
  if (from > 0) cells.push({ fold: 'head', count: from })
  for (let k = from; k <= to; k++) {
    const s = i.steps[k]
    cells.push({ k, step: s, state: s.done ? 'done' : (k === curIdx ? 'now' : 'todo') })
  }
  if (to < total - 1) cells.push({ fold: 'tail', count: total - 1 - to })
  return {
    total, done, allDone, curIdx, from, to, cells,
    cols: cells.map(c => (c.fold ? '0.52fr' : 'minmax(0,1fr)')).join(' '),
    offWindow: total > WIDE && (curIdx < from || curIdx > to)
  }
})

onMounted(() => {
  if (!ideasStore.loaded) loadIdeas()
})

// Esc 退回列表；弹窗打开时不抢。输入框内的 Esc 由 useHotkeys 默认守卫挡掉
useHotkeys({
  escape: () => { if (openId.value && !dialog.value) leave() }
})

function open(i) {
  openId.value = i.id
  winFrom.value = null
  editIdx.value = -1
  nameEdit.value = -1
  resEdit.value = ''
  pushRoute(i.id)   // 压一条历史，浏览器后退键才能退回列表
}
function back() {
  leave()
}
// 清详情态：关详情和浏览器后退都走这里
function clearIdea() {
  openId.value = ''
  editIdx.value = -1
}
// 二级视图的压历史 / 后退逻辑由 lib/useDetailRoute 统一提供
const { push: pushRoute, back: backRoute } = useDetailRoute({
  key: 'ideasOpen',
  isOpen: () => !!openId.value,
  close: clearIdea
})
const leave = () => backRoute()
function shift(side) {
  const v = view.value
  if (!v) return
  winFrom.value = side === 'head' ? Math.max(0, v.from - 4) : v.from + 4
}
function backToNow() {
  winFrom.value = null
}

async function persist(idea) {
  try {
    await updateIdea(idea.id, {
      name: idea.name,
      pitch: idea.pitch,
      // 拆掉 Vue 的响应式代理再提交，避免把 Proxy 塞进 JSON
      steps: JSON.parse(JSON.stringify(idea.steps))
    })
    return true
  } catch {
    notify('没保存成功，正在重新拉取')
    await loadIdeas()
    return false
  }
}

function startResult(k) {
  editIdx.value = k
  draft.value = ''
}
function cancelResult() {
  editIdx.value = -1
  draft.value = ''
}
async function commitResult(k) {
  if (committing) return
  const text = draft.value.trim()
  if (!text) { cancelResult(); return }
  committing = true
  const i = cur.value
  const step = i.steps[k]
  const len = step.results.length
  step.results.push({ text })
  editIdx.value = -1
  draft.value = ''
  if (!(await persist(i))) step.results.splice(len, 1)
  committing = false
}

async function pushStage() {
  const i = cur.value
  const k = i.steps.findIndex(s => !s.done)
  if (k < 0) return
  i.steps[k].done = true
  winFrom.value = null
  if (await persist(i)) notify(`已推进到「${i.steps[k].name}」`)
}

// 退回上一阶：把最近完成的那一阶重新点亮成「当前」，成果一条都不删，重做完再推进即可
async function popStage() {
  const i = cur.value
  const k = i.steps.map(s => s.done).lastIndexOf(true)
  if (k < 0) return
  i.steps[k].done = false
  winFrom.value = null
  if (await persist(i)) notify(`退回到「${i.steps[k].name}」，之前记的成果都留着`)
}

// 中文输入法按回车是在选词，不是提交 —— 不挡住这句会把刚打的字吞掉
const isIme = e => e.isComposing || e.keyCode === 229
function onEnterName(e, k) { if (isIme(e)) return; e.preventDefault(); commitName(k) }
function onEnterRes(e, k, ri) { if (isIme(e)) return; e.preventDefault(); commitResEdit(k, ri) }
function onEnterAdd(e, k) { if (isIme(e)) return; e.preventDefault(); commitResult(k) }

// —— 改阶名 ——
function startName(k) {
  nameEdit.value = k
  nameDraft.value = cur.value.steps[k].name
}
function cancelName() { nameEdit.value = -1 }
async function commitName(k) {
  const i = cur.value
  if (!i || nameEdit.value !== k) return
  const step = i.steps[k]
  const txt = nameDraft.value.trim()
  const old = step.name
  nameEdit.value = -1
  if (!txt || txt === old) return
  step.name = txt
  if (!(await persist(i))) step.name = old
}

// —— 改 / 删一条成果 ——
function startResEdit(k, ri) {
  resEdit.value = `${k}:${ri}`
  resDraft.value = cur.value.steps[k].results[ri].text
}
function cancelResEdit() { resEdit.value = '' }
async function commitResEdit(k, ri) {
  const i = cur.value
  if (!i || resEdit.value !== `${k}:${ri}`) return
  const r = i.steps[k].results[ri]
  if (!r) { resEdit.value = ''; return }
  const txt = resDraft.value.trim()
  const old = r.text
  resEdit.value = ''
  if (!txt || txt === old) return
  r.text = txt
  if (!(await persist(i))) r.text = old
}
async function removeRes(k, ri) {
  const i = cur.value
  const step = i.steps[k]
  const gone = step.results.splice(ri, 1)[0]
  if (!(await persist(i))) step.results.splice(ri, 0, gone)
  else notify('这条成果删了')
}

// —— 删一整阶（连它的成果）——
async function removeStep(k) {
  const i = cur.value
  if (i.steps.length <= 1) { notify('至少要留一阶'); return }
  const s = i.steps[k]
  const msg = s.results.length
    ? `删掉第 ${k + 1} 阶「${s.name}」？这一阶的 ${s.results.length} 条成果也会一起消失。`
    : `删掉第 ${k + 1} 阶「${s.name}」？`
  if (!confirm(msg)) return
  const gone = i.steps.splice(k, 1)[0]
  if (!(await persist(i))) i.steps.splice(k, 0, gone)
  else notify(`已删掉「${gone.name}」`)
}

function openNew() {
  form.value = { mode: 'new', name: '', pitch: '' }
  dialog.value = true
}
function openStage() {
  form.value = { mode: 'stage', name: '', pitch: '' }
  dialog.value = true
}
function openRename() {
  form.value = { mode: 'rename', name: cur.value.name, pitch: cur.value.pitch || '' }
  dialog.value = true
}

async function submitForm() {
  const name = form.value.name.trim()
  if (!name) { notify('先起个名字'); return }
  saving.value = true
  try {
    if (form.value.mode === 'new') {
      const steps = DEFAULT_STEPS.map((n, idx) => ({
        name: n,
        done: idx === 0,
        // 新建就把「写下来」这件事本身记在第一级上，第一阶不会是空的
        results: idx === 0 ? [{ text: '把它写下来了，先占住这一级' }] : []
      }))
      const item = await createIdea({ name, pitch: form.value.pitch.trim(), steps })
      if (item) open(item)
      notify('想法已放上第一阶')
    } else if (form.value.mode === 'stage') {
      const i = cur.value
      i.steps.push({ name, done: false, results: [] })
      await persist(i)
      notify(`加了第 ${i.steps.length} 阶「${name}」`)
    } else {
      const i = cur.value
      i.name = name
      i.pitch = form.value.pitch.trim()
      await persist(i)
      notify('已更新')
    }
    dialog.value = false
  } catch {
    notify('保存失败，检查后端是否在运行')
  } finally {
    saving.value = false
  }
}

async function removeIdea(i) {
  if (!confirm(`删除「${i.name}」？阶段和成果会一起删掉。`)) return
  try {
    await deleteIdea(i.id)
    if (openId.value === i.id) openId.value = ''
    notify('已删除')
  } catch {
    notify('删除失败，检查后端是否在运行')
  }
}
</script>

<template>
  <section class="ix-view">
    <!-- ============ 列表 ============ -->
    <template v-if="!cur">
      <div class="ix-head">
        <div>
          <h2 class="with-face"><AppFace slot="page-ideas" />奇思妙想</h2>
          <p class="sub">每个想法都值得一级台阶</p>
        </div>
        <button class="primary" @click="openNew">＋ 新想法</button>
      </div>

      <div class="ix-stats">
        <div class="ix-stat"><b>{{ stats.total }}</b><span>想法总数</span></div>
        <div class="ix-stat"><b>{{ stats.going }}</b><span>正在推进</span></div>
        <div class="ix-stat"><b>{{ stats.landed }}</b><span>已经落地</span></div>
        <div class="ix-stat"><b>{{ stats.flags }}</b><span>留下的成果</span></div>
      </div>

      <div class="ix-grid">
        <button v-for="i in items" :key="i.id" class="ix-card spot" @click="open(i)">
          <div class="row">
            <div>
              <h3>{{ i.name }}</h3>
              <p class="pitch">{{ i.pitch }}</p>
            </div>
            <span class="badge" :class="{ warm: doneN(i) < i.steps.length }">{{ stageOf(i) }}</span>
          </div>

          <div v-if="i.steps.length > 12" class="ix-minibar">
            <i :style="{ width: Math.round(doneN(i) / i.steps.length * 100) + '%' }"></i>
          </div>
          <div v-else class="ix-mini">
            <i v-for="(s, k) in i.steps" :key="k"
               :class="{ on: s.done, now: !s.done && k === doneN(i) }"
               :style="{ height: (10 + k * 7) + 'px' }"></i>
          </div>

          <div class="foot">
            <span>第 {{ doneN(i) }} / {{ i.steps.length }} 阶</span>
            <span>{{ flagsN(i) }} 条成果</span>
          </div>
        </button>
      </div>

      <AppEmpty
        v-if="!items.length && !ideasStore.loading"
        title="还没有想法"
        desc="点右上角「＋ 新想法」，把第一个放上台阶。"
      />
    </template>

    <!-- ============ 详情 ============ -->
    <template v-else>
      <button class="ix-back" @click="back">← 全部想法</button>

      <div class="ix-dhead">
        <div>
          <h2>{{ cur.name }}</h2>
          <p class="sub">{{ cur.pitch }}</p>
        </div>
        <div class="actions">
          <button class="ghost sm" @click="openStage">＋ 加一级</button>
          <button class="ghost sm" @click="openRename">重写这页</button>
          <button class="ghost sm danger" @click="removeIdea(cur)">删除</button>
          <button class="ghost sm" :disabled="view.done === 0" @click="popStage">← 退回上一阶</button>
          <button v-if="!view.allDone" class="primary" @click="pushStage">推进到下一阶 ↑</button>
        </div>
      </div>

      <div class="ix-track">
        <span class="badge" :class="{ warm: !view.allDone }">{{ view.allDone ? '已经落地' : '当前 · ' + cur.steps[view.curIdx].name }}</span>
        <div class="bar"><i :style="{ width: (view.done / view.total * 100) + '%' }"></i></div>
        <small v-if="view.offWindow" class="ix-backnow" @click="backToNow">↩ 回到第 {{ view.curIdx + 1 }} 阶</small>
        <small v-else>{{ view.done }} / {{ view.total }} 阶 · {{ flagsN(cur) }} 条成果</small>
      </div>

      <div class="ix-stairs" :style="{ gridTemplateColumns: view.cols }">
        <div v-for="(c, vi) in view.cells" :key="vi"
             class="ix-stair" :class="[c.fold ? 'fold' : c.state]" :style="{ '--i': vi }">
          <div class="face"></div>

          <button v-if="c.fold" class="ix-foldbox" @click="shift(c.fold)">
            <b>⋯</b>
            <span v-if="c.fold === 'head'">前 {{ c.count }} 阶<br>已走过</span>
            <span v-else>还有<br>{{ c.count }} 阶</span>
          </button>

          <div v-else class="ix-step">
            <div class="no">
              <span>{{ String(c.k + 1).padStart(2, '0') }}</span>
              <span class="no-act">
                <i v-if="c.step.done" class="ck">✓</i>
                <button class="ix-del" title="删掉这一阶" @click.stop="removeStep(c.k)">✕</button>
              </span>
            </div>

            <h4>
              <span class="dot"></span>
              <input v-if="nameEdit === c.k" v-model="nameDraft" class="ix-name-input" v-focus
                     placeholder="这一阶叫什么"
                     @click.stop
                     @keydown.enter="onEnterName($event, c.k)"
                     @keydown.esc.stop="cancelName"
                     @blur="commitName(c.k)" />
              <button v-else class="ix-title" title="点一下改名字" @mousedown.prevent @click="startName(c.k)">{{ c.step.name || '未命名这一阶' }}<i class="pen">✎</i></button>
            </h4>

            <ul class="ix-flags">
              <li v-for="(r, ri) in c.step.results" :key="ri" class="ix-flag">
                <input v-if="resEdit === c.k + ':' + ri" v-model="resDraft" class="ix-flag-input ix-flag-edit" v-focus
                       placeholder="这条成果是什么"
                       @keydown.enter="onEnterRes($event, c.k, ri)"
                       @keydown.esc.stop="cancelResEdit"
                       @blur="commitResEdit(c.k, ri)" />
                <template v-else>
                  <span class="txt" title="点一下改这条" @mousedown.prevent @click="startResEdit(c.k, ri)">{{ r.text || '（空）' }}</span><span v-if="r.tag" class="tag">{{ r.tag }}</span>
                  <button class="ix-del res-del" title="删掉这条成果" @click.stop="removeRes(c.k, ri)">✕</button>
                </template>
              </li>
            </ul>

            <template v-if="c.step.done || c.k === view.curIdx">
              <input v-if="editIdx === c.k" v-model="draft" class="ix-flag-input"
                     placeholder="这一步做成了什么？回车记下" v-focus
                     @keydown.enter="onEnterAdd($event, c.k)"
                     @keydown.esc="cancelResult"
                     @blur="commitResult(c.k)" />
              <button v-else class="ix-add" @mousedown.prevent @click="startResult(c.k)">＋ 记一条成果</button>
            </template>
            <div v-else class="ix-add is-locked">还没到这一阶</div>
          </div>
        </div>
      </div>

      <div class="ix-hint">
        <span>点阶名 / 成果可以改字，悬停出现 ✕ 可删</span>
        <span class="right">没到的台阶是虚的 —— 走上去再记</span>
      </div>
    </template>

    <!-- 新建 / 加一级 / 重写 -->
    <n-modal v-model:show="dialog" preset="card" class="app-modal glass"
             :title="form.mode === 'new' ? '新建想法' : (form.mode === 'stage' ? '加一级台阶' : '重写这一页')"
             :mask-closable="true" :close-on-esc="true" style="width:520px;max-width:92vw">
      <div class="ix-form">
        <label>{{ form.mode === 'stage' ? '这一级叫什么' : '想法的名称' }}
          <AppInput v-model="form.name" :placeholder="form.mode === 'stage' ? '如：出片 / 复盘 / 第二季' : '如：人生长视频动画'" />
        </label>
        <label v-if="form.mode !== 'stage'">一句话
          <AppInput v-model="form.pitch" placeholder="将来回看时，这句话能立刻叫醒你" />
        </label>
        <div class="modal-actions">
          <button class="ghost" @click="dialog = false">取消</button>
          <button class="primary" :disabled="saving" @click="submitForm">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </n-modal>
  </section>
</template>
