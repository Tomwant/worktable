<script setup>
// 知识库：支持导入「定时任务产出的 HTML 报告」（图文混合），并以沙箱 iframe 预览原报告
import { API_BASE, importKnowledge, deleteKnowledge, loadKnowledgePage, knowledgePager, notify } from '../stores/index.js'
import { allSources, allTags, filters, readIds, toggleKnowledgeCheck } from '../stores/domain.js'
import AppCard from '../components/AppCard.vue'
import AppEmpty from '../components/AppEmpty.vue'
import AppSelect from '../components/AppSelect.vue'
import AppInput from '../components/AppInput.vue'
import AppTextarea from '../components/AppTextarea.vue'
import AppDate from '../components/AppDate.vue'
import SyncProgressModal from '../components/SyncProgressModal.vue'
import { NModal } from 'naive-ui'
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useHotkeys } from '../lib/useHotkeys.js'

// 筛选：直接复用 domain 里的 reactive filters（在视图内再建一份普通对象会导致筛选不响应）；
// 列表本身走服务端分页，筛选值变化后由下方 watch 重新请求第 1 页
// 日期筛选按 originDate；来源按 sourceLabel（用户填写）优先、否则 source
const searchEl = ref(null)

// 定时任务入口：滞后数由弹窗组件轮询后上报（它本来就在轮询），页头不再发一次同样的请求
const syncModal = ref(null)
const feedStale = ref(0)
const onSyncStatus = s => { feedStale.value = Number(s && s.staleCount ? s.staleCount : 0) }
const openSync = () => { if (syncModal.value) syncModal.value.open() }
// Ctrl/Cmd+K 聚焦搜索框。输入框里也要能触发，所以开 allowInInput
useHotkeys({
  'mod+k': e => { e.preventDefault(); nextTick(() => searchEl.value?.focus?.()) }
}, { allowInInput: true })

// 附件完整地址：普通网页模式走同源（Vite 代理），file: 桌面模式直连后端
const fileUrl = url => (url ? `${API_BASE}${url}` : '')

// ---------- 原报告预览（沙箱 iframe，sandbox="" 显式禁用脚本，杜绝导入 HTML 执行脚本） ----------
const previewShow = ref(false)
const preview = ref(null)
function openPreview(k) { preview.value = k; previewShow.value = true }

// ---------- 悬停浮层 + 全文大窗 ----------
// 正文平均 4000 字（最长 1.2 万），67 条全文若都塞进 DOM，滚动会被文本重排拖死：
// 列表只渲染截断摘要 + 分批加载，全文只在「悬停的那一条 / 大窗」里才生成 DOM。
const SUMMARY_MAX = 180
const summaryOf = text => {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > SUMMARY_MAX ? s.slice(0, SUMMARY_MAX) + '…' : s
}

// 服务端分页：每翻一页向后台要一次，只渲染这一页。前端不再持有全量正文。
const pageItems = computed(() => knowledgePager.items.map(k => ({
  ...k,
  summary: summaryOf(k.content)
})))

// 下拉清空：n-select 选中后原本只能换项、不能回「全部」。现在列表首项就是「全部来源/全部标签」，
// 选中它即把筛选值写回 ''；右侧 ✕ 也保留，两条路都能清空。
const ALL = '__all__'
const sourceOptions = computed(() => [{ label: '全部来源', value: ALL }, ...allSources.value.map(s => ({ label: s, value: s }))])
const tagOptions = computed(() => [{ label: '全部标签', value: ALL }, ...allTags.value.map(t => ({ label: t, value: t }))])
const sourceValue = computed({
  get: () => filters.source || ALL,
  set: v => { filters.source = !v || v === ALL ? '' : v }
})
const tagValue = computed({
  get: () => filters.tag || ALL,
  set: v => { filters.tag = !v || v === ALL ? '' : v }
})
const totalCount = computed(() => knowledgePager.total)
const totalPages = computed(() => knowledgePager.totalPages)
const currentPage = computed(() => knowledgePager.page)

// 排序：默认「按系列分期」—— 同一系列连成一块、块内期号从大到小，
// 这样第 1 期不会插在第 33 期上面，往回翻就是一条线。
// 另外两个保留给「只想按时间看」的场景。值存在 knowledgePager.sort 上，翻页时一起带上。
const sortOptions = [
  { label: '按系列分期', value: 'series' },
  { label: '最近在前', value: 'date_desc' },
  { label: '最早在前', value: 'date_asc' }
]
const SORT_KEYS = ['series', 'date_desc', 'date_asc']
const sortValue = computed({
  get: () => (SORT_KEYS.includes(knowledgePager.sort) ? knowledgePager.sort : 'series'),
  set: v => { knowledgePager.sort = SORT_KEYS.includes(v) ? v : 'series' }
})

function reload(target = knowledgePager.page) {
  return loadKnowledgePage({
    page: target,
    keyword: filters.keyword, source: filters.source, tag: filters.tag, start: filters.start, end: filters.end,
    sort: knowledgePager.sort
  })
}
function goPage(n) {
  const next = Math.min(Math.max(1, n), totalPages.value)
  if (next === currentPage.value) return
  reload(next).then(() => nextTick(() => document.querySelector('.k-list')?.scrollIntoView({ block: 'start' })))
}
// 筛选/排序变化 → 回到第 1 页重新请求；320ms 防抖，避免搜索框每敲一个字打一次接口
let filterTimer = null
watch(
  () => [filters.keyword, filters.source, filters.tag, filters.start, filters.end, knowledgePager.sort].join('\u0001'),
  () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => reload(1), 320) }
)
onMounted(() => { if (!knowledgePager.items.length) reload(1) })
onBeforeUnmount(() => clearTimeout(filterTimer))

// 正文是后端抽出的纯文本（无换行）。断段逻辑抽到 utils/text.js，首页「今日已读」的阅读窗共用同一份
import { splitBody } from '../utils/text.js'
// 鼠标滑过不做任何浮层（滑过就弹会被打断，页面上也乱），全文只在点「阅读全文」时打开大窗
const fullSegs = ref([])
const fullShow = ref(false)
const full = ref(null)
function openFull(k) {
  fullSegs.value = splitBody(k.content)   // 断段只在真的要显示时才做
  full.value = k
  fullShow.value = true
}
function fromFull() {
  const k = full.value
  fullShow.value = false
  if (k) setTimeout(() => openPreview(k), 140)
}

// ---------- 导入 HTML 报告 ----------
const importShow = ref(false)
const importForm = reactive({ title: '', source: '', tagsText: '', originDate: '' })
const htmlText = ref('')
const fileName = ref('')
const pasteOpen = ref(false)
const importing = ref(false)
const fileInput = ref(null)

function openImport() {
  importForm.title = ''; importForm.source = ''; importForm.tagsText = ''; importForm.originDate = ''
  htmlText.value = ''; fileName.value = ''; pasteOpen.value = false; importShow.value = true
}
function pickFile() { fileInput.value?.click() }
function readFile(file) {
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    htmlText.value = String(reader.result || '')
    fileName.value = file.name
    if (!importForm.title) importForm.title = file.name.replace(/\.html?$/i, '')
  }
  reader.readAsText(file)
}
function onFile(e) { const file = e.target.files && e.target.files[0]; e.target.value = ''; readFile(file) }
function onDrop(e) { readFile(e.dataTransfer?.files && e.dataTransfer.files[0]) }
// 组装导入 payload（force=true 用于「同名同日期」确认后强制放行）
function buildPayload(force = false) {
  return {
    html: htmlText.value,
    title: importForm.title.trim(),
    source: importForm.source.trim(),
    tags: importForm.tagsText.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    originDate: importForm.originDate || '',
    force
  }
}
async function submitImport() {
  if (!htmlText.value.trim()) return
  importing.value = true
  try {
    try {
      await importKnowledge(buildPayload())
      importShow.value = false
      reload(1)
    } catch (error) {
      // 仅「同名同日期」(409) 弹确认：确认后带 force:true 重发一次，取消则静默中止
      if (error.status !== 409) return
      const msg = (error.detail && error.detail.message) || '已存在同名同日的条目，是否仍要导入？'
      if (!confirm(msg)) return
      await importKnowledge(buildPayload(true))
      importShow.value = false
      reload(1)
    }
  } finally { importing.value = false }
}

// ---------- 知识打卡 ----------
// 点一下就把这条记进当天的每日打卡（工作台的「今日已读」），再点一下取消。
// 打卡状态来自 db.checkins（本地即时），不占分页接口的字段。
async function toggleRead(k) {
  const added = await toggleKnowledgeCheck(k)
  if (added === undefined) return   // 写库失败：toggle 内部已回滚并提示，别再覆盖成「已打卡」
  notify(added ? '已打卡，记入今天的每日打卡' : '已取消打卡')
}

// ---------- 删除 ----------
async function removeItem(k) {
  if (!confirm(`删除「${k.title}」？原报告附件也会一并删除。`)) return
  await deleteKnowledge(k.id)
  // 删掉本页最后一条时回退一页，避免停在空白页
  const left = knowledgePager.total - 1
  const lastPage = Math.max(1, Math.ceil(left / knowledgePager.pageSize))
  reload(Math.min(currentPage.value, lastPage))
}
</script>

<template>
  <section class="page active" key="knowledge">
    <div class="page-head">
      <div>
        <p class="eyebrow">知识库</p>
        <h1>个人知识库</h1>
        <p>每一次思考，都不会白白飘过。</p>
      </div>
      <div class="selectors">
        <small class="count">{{ totalCount }} 条内容</small>
        <!-- 定时任务入口：原来那个弹窗只在「有产出入库」那一刻出现，任务卡住了反而看不见，
             所以把状态常驻在页头 —— 有滞后就变金色并写出数量。 -->
        <button class="task-entry" :class="{ stale: feedStale > 0 }" @click="openSync">
          <span class="dot"></span>定时任务<b v-if="feedStale > 0">· {{ feedStale }} 项滞后</b>
        </button>
        <button class="primary" @click="openImport">+ 导入 HTML</button>
      </div>
    </div>

    <AppCard variant="card" class="spot filter-bar">
      <AppInput ref="searchEl" v-model="filters.keyword" placeholder="搜索标题或正文内容… （Ctrl+K 快速聚焦）" block />
      <AppSelect v-model="sourceValue" :options="sourceOptions" placeholder="全部来源" clearable />
      <AppSelect v-model="tagValue" :options="tagOptions" placeholder="全部标签" clearable />
      <AppDate v-model="filters.start" pill title="开始日期" />
      <span class="date-sep">至</span>
      <AppDate v-model="filters.end" pill title="结束日期" />
      <AppSelect v-model="sortValue" :options="sortOptions" class="sort-sel" title="按日期排序" />
    </AppCard>

    <div v-if="pageItems.length" class="k-list" :class="{ 'is-loading': knowledgePager.loading }">
      <AppCard v-for="k in pageItems" :key="k.id" variant="card" class="spot k-card" :class="{ cked: readIds.has(k.id) }">
        <div class="k-head">
          <h3>{{ k.title }}</h3>
          <div class="k-actions">
            <small class="date">{{ k.originDate }}</small>
            <button class="ck" :class="{ on: readIds.has(k.id) }" @click.stop="toggleRead(k)">{{ readIds.has(k.id) ? '✓ 已打卡' : '＋ 打卡' }}</button>
            <button class="ghost sm" @click.stop="openFull(k)">阅读全文</button>
            <button v-if="k.attachmentUrl" class="ghost sm" @click.stop="openPreview(k)">查看原报告</button>
            <button class="ghost sm danger" @click.stop="removeItem(k)">删除</button>
          </div>
        </div>
        <p class="content">{{ k.summary }}</p>
        <div v-if="k.tags?.length || k.sourceLabel || k.source" class="meta-row">
          <span v-if="k.sourceLabel || k.source">来源：{{ k.sourceLabel || k.source }}</span>
          <span v-if="k.tags?.length" class="tags"><span v-for="t in k.tags" :key="t" class="chip">#{{ t }}</span></span>
        </div>
      </AppCard>

      <!-- 分页：每翻一页向后台请求一次，只渲染这一页 -->
      <div v-if="totalPages > 1" class="k-pager">
        <button class="ghost sm" :disabled="currentPage <= 1" @click="goPage(currentPage - 1)">上一页</button>
        <button
          v-for="p in totalPages"
          :key="p"
          class="pg"
          :class="{ on: p === currentPage }"
          @click="goPage(p)"
        >{{ p }}</button>
        <button class="ghost sm" :disabled="currentPage >= totalPages" @click="goPage(currentPage + 1)">下一页</button>
        <span class="pg-info">共 {{ totalCount }} 条 · 第 {{ currentPage }}/{{ totalPages }} 页</span>
      </div>
    </div>
    <AppCard v-else variant="card" class="spot empty-card">
      <AppEmpty
        title="没有找到匹配的知识条目"
        desc="可以清空筛选条件再看，或点右上角「导入 HTML」把定时任务报告沉淀进来。"
      />
    </AppCard>

    <!-- 原报告预览：沙箱 iframe，sandbox=""（绝不加 allow-scripts，导入 HTML 可能含脚本） -->
    <n-modal
      v-model:show="previewShow"
      preset="card"
      :title="preview?.title || '原报告预览'"
      class="app-modal glass k-preview-modal"
      :mask-closable="true"
      :close-on-esc="true"
      style="width:min(1560px,97vw)"
    >
      <div v-if="preview" class="k-preview">
        <div class="k-preview-frame">
          <iframe :src="fileUrl(preview.attachmentUrl)" sandbox="" referrerpolicy="no-referrer"></iframe>
        </div>
        <div class="modal-actions">
          <a class="k-open-link" :href="fileUrl(preview.attachmentUrl)" target="_blank" rel="noopener noreferrer">在新窗口打开</a>
          <button class="ghost" @click="previewShow = false">关闭</button>
        </div>
      </div>
    </n-modal>

    <!-- 全文大窗：正文按章节断段，安静读完；底部可跳原报告 -->
    <n-modal
      v-model:show="fullShow"
      preset="card"
      class="app-modal glass k-full-modal"
      :mask-closable="true"
      :close-on-esc="true"
      style="width:min(760px,94vw)"
    >
      <template #header>
        <div class="k-full-head">
          <h3>{{ full?.title }}</h3>
          <small>{{ full?.originDate }}{{ full?.sourceLabel ? ' · ' + full.sourceLabel : '' }}</small>
        </div>
      </template>
      <div class="k-full-body">
        <p v-for="(seg, i) in fullSegs" :key="i">{{ seg }}</p>
      </div>
      <template #footer>
        <div class="modal-actions">
          <button v-if="full?.attachmentUrl" class="ghost sm" @click="fromFull">查看原报告</button>
          <button class="ghost sm" @click="fullShow = false">关闭</button>
        </div>
      </template>
    </n-modal>

    <!-- 导入 HTML 报告 -->
    <n-modal
      v-model:show="importShow"
      preset="card"
      title="导入 HTML 报告"
      class="app-modal glass k-import-modal"
      :mask-closable="false"
      :close-on-esc="true"
      style="width:min(620px,94vw)"
    >
      <div class="modal-form">
        <div class="k-drop" @click="pickFile" @dragover.prevent @drop.prevent="onDrop">
          <input ref="fileInput" class="k-file-input" type="file" accept=".html,.htm" @change="onFile" />
          <p class="k-drop-main">{{ fileName || '点击选择 / 拖拽 .html 文件到此处' }}</p>
          <p class="k-drop-sub">定时任务导出的 HTML 报告（支持图表 / 内嵌图片）</p>
        </div>

        <label>标题（留空自动从 &lt;title&gt; / &lt;h1&gt; 抽取）
          <AppInput v-model="importForm.title" placeholder="报告标题" block />
        </label>
        <label>来源（可选）
          <AppInput v-model="importForm.source" placeholder="如：每日复盘任务" block />
        </label>
        <div class="split">
          <label>日期
            <AppDate v-model="importForm.originDate" />
          </label>
          <label>标签（逗号分隔）
            <AppInput v-model="importForm.tagsText" placeholder="复盘,自动生成" block />
          </label>
        </div>

        <button class="ghost sm k-paste-toggle" @click="pasteOpen = !pasteOpen">{{ pasteOpen ? '收起直接粘贴' : '或直接粘贴 HTML 内容' }}</button>
        <label v-if="pasteOpen">HTML 源码
          <AppTextarea v-model="htmlText" :rows="8" placeholder="<html>…</html>" block />
        </label>

        <div class="modal-actions">
          <button class="ghost" @click="importShow = false">取消</button>
          <button class="primary" :disabled="importing || !htmlText.trim()" @click="submitImport">{{ importing ? '导入中…' : '导入' }}</button>
        </div>
      </div>
    </n-modal>

    <!-- 定时任务状态：当天第一次有产出入库会自动弹；也可以从页头按钮随时手动打开 -->
    <SyncProgressModal ref="syncModal" @updated="reload(1)" @status="onSyncStatus" />
  </section>
</template>
