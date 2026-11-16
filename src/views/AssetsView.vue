<script setup>
// 素材库：Q 版形象的登记表 + 每处形象位的切换器 + 每页壁纸。
//
// 三块内容全部用 AppPanel 装，不再自己拼卡片骨架（这一点是 2026-10-27 用户明确要求的：
// 新模块一律走标准面板，别再各写一套间距和字号）。
//   ① 形象位 —— 20 处位置，点右侧任意一张小图立刻换，存 localStorage
//   ② 素材   —— 内置 6 张官方原片 + 我上传的图，上传 / 改构图 / 删除
//   ③ 壁纸   —— 9 个页面各一张背景图
//
// 上传的图走后端（server/uploads/assets + asset_images 表），
// 不塞 localStorage：base64 一张几十万字符，几张就把 5MB 配额撑爆。
import { ref, computed, onMounted, nextTick } from 'vue'
import { NModal } from 'naive-ui'
import { YUNXIAO_FACES, faceStyle } from '../assets/yunxiao/index.js'
import { SLOTS, slotMap, setSlot, slotsUsing, resetSlots } from '../stores/yunxiao.js'
import {
  PAGES, uploaded, allFaces, loadAssets, uploadAsset, patchAsset, removeAsset,
  uploadToFace, wallpapers, setWallpaper, clearWallpaper,
  assetMaxMb, loadAssetConfig, saveAssetMaxMb
} from '../stores/assets.js'
import { notify, notifyError } from '../lib/toast.js'
import AppFace from '../components/AppFace.vue'
import AppPanel from '../components/AppPanel.vue'
import AppButton from '../components/AppButton.vue'
import AppInput from '../components/AppInput.vue'

const cur = (id) => slotMap.value[id]
const face = (key) => allFaces.value.find(f => f.key === key) || YUNXIAO_FACES[0]
const usingCount = (key) => slotsUsing(key).length

// 按页面分组：20 处平铺成一长条时，右侧会空出一大片，
// 而且每行候选图数量不同、右对齐后左边界参差。分组 + 网格格子后宽度被填满，视觉也成块。
const groups = computed(() => {
  const order = []
  const map = new Map()
  for (const s of SLOTS) {
    const g = s.group || '其他'
    if (!map.has(g)) { map.set(g, []); order.push(g) }
    map.get(g).push(s)
  }
  return order.map(name => ({ name, slots: map.get(name) }))
})

function pick(id, key) {
  const s = SLOTS.find(x => x.id === id)
  const f = face(key)
  if (setSlot(id, key)) notify(`${s ? s.name : id} 已换成「${f.label}」`)
}

// ===== ② 素材：上传 / 构图 / 删除 =====
const fileInput = ref(null)
const busy = ref(false)

/** 上限跟着 app_config 走，卡片文案和选图拦截都用这个值 */
const maxBytes = computed(() => assetMaxMb.value * 1024 * 1024)

// 就地改上限：卡片里那行小字点一下变输入框，回车 / 失焦保存，Esc 放弃。
// 卡片本身是「点哪都能选图」的按钮，所以数字要单独 stop 掉冒泡，否则一改就弹选图窗。
const editLimit = ref(false)
const draftLimit = ref(50)
const limitBad = ref('')
const limitSaved = ref(false)
const limitInput = ref(null)

async function openLimit() {
  draftLimit.value = assetMaxMb.value
  limitBad.value = ''
  limitSaved.value = false
  editLimit.value = true
  await nextTick()
  limitInput.value?.focus()
  limitInput.value?.select()
}

function cancelLimit() {
  editLimit.value = false
  limitBad.value = ''
}

async function commitLimit() {
  const v = Math.round(Number(draftLimit.value))
  if (!Number.isFinite(v) || v < 1 || v > 200) {
    limitBad.value = '1–200'
    await nextTick()
    limitInput.value?.focus()
    return
  }
  editLimit.value = false
  limitBad.value = ''
  if (v === assetMaxMb.value) return
  try {
    await saveAssetMaxMb(v)
    limitSaved.value = true
    notify(`单张上限已改为 ${assetMaxMb.value}MB`)
    setTimeout(() => (limitSaved.value = false), 1800)
  } catch (err) {
    notifyError(err?.message || '上限没保存成功')
  }
}

async function onFiles(e) {
  const files = [...(e.target.files || [])]
  if (!files.length) return
  busy.value = true
  let ok = 0
  const tooBig = []
  try {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      if (f.size > maxBytes.value) { tooBig.push(f.name); continue }
      await uploadAsset(f)
      ok++
    }
    if (ok) notify(`已添加 ${ok} 张素材`)
    if (tooBig.length) notifyError(`${tooBig.length} 张超过 ${assetMaxMb.value}MB 已跳过：${tooBig[0]}${tooBig.length > 1 ? ' 等' : ''}`)
    else if (!ok) notifyError('这些文件不是图片')
  } catch (err) {
    notifyError(err?.message || '上传失败')
  } finally {
    busy.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const dropping = ref(false)
async function onDrop(e) {
  dropping.value = false
  const files = [...(e.dataTransfer?.files || [])]
  if (!files.length) return
  await onFiles({ target: { files, value: '' } })
}

const editRow = ref(null)
const editForm = ref({ name: '', posY: 50, zoom: 1.2 })
const editPreview = computed(() => (editRow.value ? uploadToFace({ ...editRow.value, posY: editForm.value.posY, zoom: editForm.value.zoom }) : null))

function openEdit(u) {
  if (!u) return
  editRow.value = u
  editForm.value = { name: u.name, posY: u.posY, zoom: u.zoom }
}
async function saveEdit() {
  try {
    await patchAsset(editRow.value.id, { ...editForm.value })
    editRow.value = null
    notify('构图已更新')
  } catch (err) { notifyError(err?.message || '保存失败') }
}
/** 构图回到出厂值（50% / 1.2×），只改表单不落库，仍需点保存 */
function resetEdit() {
  editForm.value.posY = 50
  editForm.value.zoom = 1.2
}
async function delAsset(u) {
  if (!u) return
  if (!window.confirm(`删除素材「${u.name}」？用到它的形象位会回落到默认图。`)) return
  try {
    await removeAsset(u.id)
    notify('已删除')
  } catch (err) { notifyError(err?.message || '删除失败') }
}

// ===== ③ 壁纸 =====
const wallPage = ref('')   // 正在选壁纸的页面 id，空 = 关闭
const wallPageName = computed(() => PAGES.find(p => p.id === wallPage.value)?.name || '')
function applyWall(f) {
  setWallpaper(wallPage.value, f.src)
  notify(`${wallPageName.value} 的壁纸已换成「${f.label}」`)
  wallPage.value = ''
}

function onReset() {
  resetSlots()
  notify('已恢复出厂分配')
}

onMounted(() => {
  loadAssets().catch(() => notifyError('素材列表读取失败，后端没起来？'))
  loadAssetConfig()
})
</script>

<template>
  <section class="page active" key="assets">
    <div class="page-head">
      <div>
        <p class="eyebrow">素材库</p>
        <h1>素材库</h1>
        <p>页面里每处小形象位都能随时换，也能给每一页配一张壁纸。</p>
      </div>
      <div class="selectors">
        <AppButton variant="ghost" @click="onReset">恢复默认</AppButton>
        <AppButton variant="primary" :loading="busy" @click="fileInput.click()">＋ 新增素材</AppButton>
      </div>
    </div>
    <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFiles" />

    <!-- ① 形象位 -->
    <AppPanel title="形象位" :desc="`${SLOTS.length} 处 · 点下面的小图直接换，立刻生效`" face="page-company">
      <div class="groups">
        <section v-for="g in groups" :key="g.name" class="grp">
          <h3 class="grp-hd">{{ g.name }}<small>{{ g.slots.length }} 处</small></h3>
          <div class="grp-grid">
            <div v-for="s in g.slots" :key="s.id" class="cell">
              <div class="cell-hd">
                <AppFace :slot="s.id" :size="s.px >= 60 ? 40 : 36" />
                <div class="s-name">
                  <b>{{ s.name }}</b>
                  <small>{{ s.where }}</small>
                </div>
              </div>
              <div class="picks">
                <button
                  v-for="f in allFaces"
                  :key="f.key"
                  class="pick"
                  :class="{ on: cur(s.id) === f.key }"
                  :title="f.label"
                  @click="pick(s.id, f.key)"
                >
                  <img :src="f.src" :style="faceStyle(f)" alt="" loading="lazy" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </AppPanel>

    <!-- ② 素材 -->
    <AppPanel
      title="素材"
      :desc="`${allFaces.length} 张 · 内置 ${YUNXIAO_FACES.length} 张官方原片，其余是我上传的`"
      face="page-knowledge"
      class="dropzone"
      :class="{ dropping }"
      @dragover.prevent="dropping = true"
      @dragleave="dropping = false"
      @drop.prevent="onDrop"
    >
      <template #actions>
        <span class="hint">也可以把图片直接拖进来</span>
      </template>
      <div class="asset-grid">
        <article v-for="f in allFaces" :key="f.key" class="asset">
          <div class="thumb"><img :src="f.src" :style="faceStyle(f)" alt="" loading="lazy" /></div>
          <div class="txt">
            <b :title="f.label">{{ f.label }}</b>
            <small>{{ f.size }}<template v-if="usingCount(f.key)"> · 用在 {{ usingCount(f.key) }} 处</template><template v-else> · 未使用</template></small>
          </div>
          <div v-if="f.uploadId" class="tools">
            <button class="tool" title="调整圆形裁切" @click="openEdit(uploaded.find(u => u.id === f.uploadId))">调</button>
            <button class="tool danger" title="删除" @click="delAsset(uploaded.find(u => u.id === f.uploadId))">删</button>
          </div>
        </article>

        <div class="asset asset--add">
          <button class="add-btn" :disabled="busy" @click="fileInput.click()">
            <span class="plus">＋</span>
            <span>{{ busy ? '正在添加…' : '新增素材' }}</span>
          </button>
          <span class="lim">
            <span>png/jpg/webp ≤</span>
            <input
              v-if="editLimit"
              ref="limitInput"
              v-model="draftLimit"
              class="lim-input"
              :class="{ bad: limitBad }"
              type="number"
              min="1"
              max="200"
              :title="limitBad ? '只能填 1–200' : '回车保存、Esc 放弃'"
              @keydown.enter.prevent="commitLimit"
              @keydown.esc.prevent="cancelLimit"
              @blur="commitLimit"
            />
            <button v-else type="button" class="lim-num" title="点击修改上限" @click.stop="openLimit">{{ assetMaxMb }}</button>
            <span>MB</span>
            <span v-if="limitBad" class="lim-bad">{{ limitBad }}</span>
            <span v-else-if="limitSaved" class="lim-tick">✓ 已保存</span>
          </span>
        </div>
      </div>
    </AppPanel>

    <!-- ③ 页面壁纸 -->
    <AppPanel title="页面壁纸" desc="每一页单独一张，选完立刻生效；会自动压一层底色保证文字看得清" face="page-home">
      <div class="walls">
        <div v-for="p in PAGES" :key="p.id" class="wall">
          <b>{{ p.name }}</b>
          <div class="bar" :class="{ on: !!wallpapers[p.id] }" :style="wallpapers[p.id] ? { backgroundImage: `url(${wallpapers[p.id]})` } : {}">
            <span v-if="!wallpapers[p.id]">默认背景</span>
          </div>
          <div class="wall-act">
            <AppButton size="sm" variant="ghost" @click="wallPage = p.id">选图</AppButton>
            <AppButton v-if="wallpapers[p.id]" size="sm" variant="quiet" @click="clearWallpaper(p.id)">清除</AppButton>
          </div>
        </div>
      </div>
    </AppPanel>

    <!-- 选壁纸 -->
    <n-modal
      :show="!!wallPage"
      preset="card"
      class="app-modal glass"
      style="width:min(720px,94vw)"
      :title="`给「${wallPageName}」选壁纸`"
      @update:show="v => { if (!v) wallPage = '' }"
    >
      <div class="wall-pick">
        <button v-for="f in allFaces" :key="f.key" class="wp" :title="f.label" @click="applyWall(f)">
          <img :src="f.src" alt="" loading="lazy" />
          <span>{{ f.label }}</span>
        </button>
      </div>
    </n-modal>

    <!-- 调整构图 -->
    <n-modal
      :show="!!editRow"
      preset="card"
      class="app-modal glass"
      style="width:min(560px,94vw)"
      :title="`调整「${editRow?.name || ''}」的圆形裁切`"
      @update:show="v => { if (!v) editRow = null }"
    >
      <div class="edit">
        <div class="big"><img v-if="editPreview" :src="editPreview.src" :style="faceStyle(editPreview)" alt="" /></div>
        <div class="ctl">
          <label class="fld">
            <span class="hd"><span class="k">名称</span></span>
            <AppInput v-model="editForm.name" block />
          </label>
          <label class="fld">
            <span class="hd"><span class="k">纵向位置</span><b>{{ editForm.posY }}%</b></span>
            <input
              v-model.number="editForm.posY" type="range" min="0" max="100" step="1"
              :style="{ '--fill': editForm.posY + '%' }"
            />
          </label>
          <label class="fld">
            <span class="hd"><span class="k">放大</span><b>{{ Number(editForm.zoom).toFixed(2) }}×</b></span>
            <input
              v-model.number="editForm.zoom" type="range" min="1" max="3" step="0.02"
              :style="{ '--fill': Math.round((editForm.zoom - 1) / 2 * 100) + '%' }"
            />
          </label>
          <p class="tips">脸偏上把数字调小，偏下就调大；脸占满圆的一半最合适。</p>
        </div>
      </div>

      <!-- 真实尺寸对照：只在 160px 的大圆里调，落地到页面上是 36px，会突然看不清。
           所以把三个实际尺寸单独摆一条横带，调的时候直接按落地大小判断。 -->
      <div class="mins">
        <span class="mins-note">页面实际大小</span>
        <div class="mini">
          <span class="c" style="width:36px;height:36px">
            <img v-if="editPreview" :src="editPreview.src" :style="faceStyle(editPreview)" alt="" />
          </span>
          <small>36px</small>
        </div>
        <div class="mini">
          <span class="c" style="width:96px;height:96px">
            <img v-if="editPreview" :src="editPreview.src" :style="faceStyle(editPreview)" alt="" />
          </span>
          <small>96px</small>
        </div>
        <div class="mini">
          <span class="c" style="width:132px;height:132px">
            <img v-if="editPreview" :src="editPreview.src" :style="faceStyle(editPreview)" alt="" />
          </span>
          <small>132px</small>
        </div>
      </div>
      <template #footer>
        <div class="modal-actions split">
          <AppButton variant="ghost" size="sm" @click="resetEdit">恢复默认构图</AppButton>
          <div class="acts">
            <AppButton variant="ghost" @click="editRow = null">取消</AppButton>
            <AppButton variant="primary" @click="saveEdit">保存</AppButton>
          </div>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.hint{font-size:11.5px;color:var(--text-3)}

/* ① 形象位：按页面分组，格子里「头像+名称」在上、候选图在下 —— 宽度被填满，不再是长条 */
.groups{display:flex;flex-direction:column;gap:11px}
.grp-hd{margin:0 0 6px;font-size:12px;font-weight:700;color:var(--text-2);display:flex;align-items:center;gap:7px}
.grp-hd::before{content:'';width:3px;height:11px;border-radius:2px;background:var(--accent)}
.grp-hd small{font-size:11px;color:var(--text-3);font-weight:500}
.grp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(324px,1fr));gap:10px}
.cell{
  padding:9px 11px 10px;border-radius:14px;
  background:var(--surface-2);border:1px solid var(--line);
  transition:border-color .18s, box-shadow .18s;
}
.cell:hover{border-color:var(--accent-soft);box-shadow:0 6px 16px -12px rgba(86,58,140,.5)}
.cell-hd{display:flex;align-items:center;gap:9px;margin-bottom:7px;min-width:0}
.s-name{display:flex;flex-direction:column;gap:1px;min-width:0}
.s-name b{font-size:12.5px;font-weight:650;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s-name small{font-size:11px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.picks{display:flex;gap:7px;flex-wrap:wrap}
.pick{
  width:36px;height:36px;border-radius:50%;padding:0;overflow:hidden;flex:0 0 auto;
  border:1.5px solid transparent;background:var(--surface-2);
  opacity:.62;transition:opacity .16s, transform .16s, box-shadow .16s;cursor:pointer;
}
.pick img{width:100%;height:100%;object-fit:cover;display:block}
.pick:hover{opacity:1;transform:translateY(-1px)}
.pick.on{opacity:1;border-color:var(--accent);box-shadow:0 0 0 3px rgba(125,91,166,.15)}

/* ② 素材：等高卡片，文字单行省略 */
.dropzone{transition:box-shadow .2s, border-color .2s}
.dropzone.dropping{border-color:var(--accent);box-shadow:0 0 0 3px rgba(125,91,166,.18)}
.asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:10px}
.asset{
  display:flex;align-items:center;gap:10px;position:relative;min-height:68px;
  padding:9px 10px;border-radius:14px;text-align:left;
  background:var(--surface-2);border:1px solid var(--line);
}
.asset .thumb{
  width:48px;height:48px;border-radius:50%;overflow:hidden;flex:0 0 auto;
  border:2px solid rgba(255,255,255,.9);
  box-shadow:0 5px 14px -10px rgba(86,58,140,.7), 0 0 0 1px rgba(120,96,170,.12);
}
.asset .thumb img{width:100%;height:100%;object-fit:cover;display:block}
.asset .txt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.asset .txt b{font-size:12.5px;font-weight:650;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:26px}
.asset .txt small{font-size:11px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.asset .tools{position:absolute;right:8px;top:8px;display:flex;gap:4px}
.tool{
  width:20px;height:20px;border-radius:6px;font-size:10.5px;line-height:1;
  background:var(--surface-solid);border:1px solid var(--line);color:var(--text-2);cursor:pointer;
}
.tool:hover{color:var(--accent);border-color:var(--accent-soft);background:var(--accent-soft)}
.tool.danger:hover{color:var(--danger);border-color:var(--danger-soft);background:var(--danger-soft)}

/* 新增素材卡：拆成「上传区 + 上限区」两段。
   原来整张卡是一个 button，点哪都弹选图窗，上限数字没法单独点，所以必须拆。
   .lim-tick 用绝对定位贴在右上角，避免它出现时把 nowrap 那行撑出去。 */
.asset--add{
  flex-direction:column;justify-content:center;gap:3px;
  border-style:dashed;border-color:var(--line-3);background:transparent;padding:8px 10px;
}
.asset--add:hover{border-color:var(--accent);background:var(--accent-soft)}
.add-btn{
  display:flex;flex-direction:column;align-items:center;gap:2px;width:100%;
  padding:2px 0 1px;border:0;border-radius:10px;background:transparent;
  font:600 12px/1.4 inherit;color:var(--text-2);cursor:pointer;
}
.add-btn:hover{color:var(--accent)}
.add-btn:disabled{cursor:progress;opacity:.7}
.add-btn .plus{font-size:16px;font-weight:400;line-height:1}
.lim{
  display:flex;align-items:center;gap:2px;font-size:10px;line-height:1;
  color:var(--text-3);white-space:nowrap;
}
.lim-num{
  padding:1px 3px;border:0;border-bottom:1px dashed var(--line-3);border-radius:5px;
  background:transparent;color:var(--text-2);font:650 10px/1.2 inherit;
  font-variant-numeric:tabular-nums;cursor:pointer;transition:.15s;
}
.lim-num:hover{color:var(--accent);border-bottom-color:var(--accent);background:var(--accent-soft)}
.lim-input{
  width:38px;padding:0 1px;border:1px solid var(--accent);border-radius:5px;
  background:var(--surface-solid);color:var(--text);text-align:center;
  font:650 10px/1.5 inherit;font-variant-numeric:tabular-nums;
  outline:none;box-shadow:0 0 0 3px var(--accent-soft);
}
.lim-input::-webkit-outer-spin-button,
.lim-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
/* 进编辑态会全选原值，默认选区色在浅/深两套主题下都会把数字糊掉。
   字色跟着 surface-solid 走：浅色主题是白（压在深紫上），深色主题是深底（压在浅紫上），
   一条规则两套主题都够对比，不用再写死颜色。 */
.lim-input::selection{background:var(--accent);color:var(--surface-solid)}
.lim-input.bad{border-color:var(--danger);box-shadow:0 0 0 3px var(--danger-soft)}
.lim-tick{position:absolute;right:7px;top:5px;color:var(--accent);font-size:9.5px}
.lim-bad{color:var(--danger);font-size:9.5px}

/* ③ 壁纸：一行一页，中间是预览条 */
.walls{display:flex;flex-direction:column;gap:2px}
.wall{
  display:grid;grid-template-columns:96px 1fr auto;align-items:center;gap:12px;
  padding:7px 8px;border-radius:12px;
}
.wall + .wall{border-top:1px solid var(--line-2)}
.wall:hover{background:var(--surface-2)}
.wall b{font-size:12.5px;font-weight:650;color:var(--text)}
.wall .bar{
  height:36px;border-radius:10px;border:1px dashed var(--line-2);
  background-size:cover;background-position:center;
  display:flex;align-items:center;justify-content:center;
  font-size:11px;color:var(--text-3);
}
.wall .bar.on{border-style:solid}
.wall-act{display:flex;gap:6px}

.wall-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:60vh;overflow-y:auto}
.wp{
  display:flex;flex-direction:column;padding:0;overflow:hidden;border-radius:12px;
  border:1px solid var(--line);background:var(--surface-2);cursor:pointer;
}
.wp img{width:100%;height:76px;object-fit:cover;display:block}
.wp span{font-size:11px;color:var(--text-2);padding:5px 6px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wp:hover{border-color:var(--accent);box-shadow:0 0 0 3px rgba(125,91,166,.14)}

/* 调整构图弹窗：上「大圆 + 控件」两栏，下「真实尺寸对照」一条横带，再下按钮栏。
   滑块不用浏览器原生样式 —— 原生在玻璃底上一根灰细线，和全站的紫胶囊不是同一挂。
   填充比例走 CSS 变量 --fill，由 template 按当前值算，避免每个滑块各写一套渐变。 */
.edit{display:flex;gap:22px;align-items:flex-start}
.edit .big{
  width:160px;height:160px;border-radius:50%;overflow:hidden;flex:0 0 auto;
  border:2px solid var(--surface-solid);
  box-shadow:0 14px 30px -16px rgba(86,58,140,.55), 0 0 0 1px rgba(120,96,170,.14);
}
.edit .big img{width:100%;height:100%;object-fit:cover;display:block}

/* 真实尺寸对照：三个落地尺寸并排，左说明右尺寸，用 grid 均分把整行撑满 */
.mins{
  display:grid;grid-template-columns:auto repeat(3,1fr);
  align-items:end;gap:10px;
  margin-top:16px;padding-top:13px;
  border-top:1px dashed var(--line-2);
}
.mins-note{font-size:10.5px;color:var(--text-3);align-self:end;padding-bottom:2px}
.mini{display:flex;flex-direction:column;align-items:center;gap:5px;justify-self:center}
.mini .c{border-radius:50%;overflow:hidden;flex:0 0 auto;border:1.5px solid var(--surface-solid);box-shadow:0 5px 12px -7px rgba(86,58,140,.6)}
.mini .c img{width:100%;height:100%;object-fit:cover;display:block}
.mini small{font-size:10px;color:var(--text-3);line-height:1}

.edit .ctl{flex:1;min-width:0;display:flex;flex-direction:column;gap:13px}
.fld{display:flex;flex-direction:column;gap:7px}
.fld .hd{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.fld .hd .k{font-size:11.5px;color:var(--text-3)}
.fld .hd b{font-size:11.5px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}

.fld input[type=range]{
  -webkit-appearance:none;appearance:none;
  display:block;width:100%;height:6px;min-height:0;padding:0;border:0;
  border-radius:99px;cursor:pointer;outline:none;
  /* 未填充段用 --line-2，不能用 --line：后者是 rgba(255,255,255,.62) 白线，
     铺在浅色玻璃底上等于看不见，滑块会像一根紫条凭空截断。 */
  background:linear-gradient(to right,
    var(--accent) 0, var(--accent) var(--fill,50%),
    var(--line-2) var(--fill,50%), var(--line-2) 100%);
}
.fld input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none;appearance:none;
  width:18px;height:18px;border-radius:50%;
  background:var(--surface-solid);border:3px solid var(--accent);
  box-shadow:0 3px 8px -2px rgba(70,45,120,.5);
  transition:transform .14s ease, box-shadow .14s ease;
}
.fld input[type=range]:hover::-webkit-slider-thumb{transform:scale(1.1)}
.fld input[type=range]:active::-webkit-slider-thumb{transform:scale(1.18);box-shadow:0 0 0 7px rgba(125,91,166,.16)}
.fld input[type=range]:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 6px rgba(125,91,166,.22)}

.tips{margin:0;font-size:11px;color:var(--text-3);line-height:1.6;text-wrap:pretty}
.acts{display:flex;gap:8px}

@media (max-width:820px){
  .grp-grid{grid-template-columns:1fr}
  .wall{grid-template-columns:72px 1fr auto}
  .edit{flex-direction:column;align-items:center;gap:16px}
  .edit .big{width:140px;height:140px}
  .edit .ctl{width:100%}
  .mins{width:100%;flex-wrap:wrap;justify-content:center;gap:12px 16px}
  .mins-note{width:100%;text-align:center;margin:0}
}
</style>
