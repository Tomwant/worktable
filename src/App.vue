<script setup>
import { onMounted, watch, nextTick, computed } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, zhCN, dateZhCN } from 'naive-ui'
import { darkTheme, lightThemeOverrides, darkThemeOverrides } from './theme.js'
import { APP_NAME, APP_NAME_EN, APP_INITIAL } from './config.js'
import { db, initApi, onDbChange } from './stores/index.js'
import { page, ensureToday } from './stores/domain.js'
import { theme, toggleTheme, exportData, importData, clearData } from './stores/ui.js'
import { wallpapers } from './stores/assets.js'
import { useHotkeys } from './lib/useHotkeys.js'
import AppIcon from './components/AppIcon.vue'
import HomeView from './views/HomeView.vue'
import CheckinView from './views/CheckinView.vue'
import FinanceView from './views/FinanceView.vue'
import DiscoverView from './views/DiscoverView.vue'
import AiTimelineView from './views/AiTimelineView.vue'
import KnowledgeView from './views/KnowledgeView.vue'
import IdeasView from './views/IdeasView.vue'
import CompanyView from './views/CompanyView.vue'
import EvalView from './views/EvalView.vue'
import AssetsView from './views/AssetsView.vue'
import MindmapView from './views/MindmapView.vue'
import AppModal from './components/AppModal.vue'
import AppToast from './components/AppToast.vue'

// 注意：不用 flush:'sync' —— 同步深度 watcher 会让每次勾选/输入都在渲染 tick 里全量序列化 db，数据多时直接卡死闪退。
// 走默认异步 watcher + pushSync 内部 400ms 防抖合并，彻底避免高频全量写入。
watch(db, onDbChange, { deep: true })
onMounted(async () => { await initApi(); ensureToday() })

// ic 是 lib/icons.js 里的图标名，不再用字符——字符在 Windows 字体 13px 时会糊掉（⌕ 塌成小圆点）
const nav = [
  { id: 'home', label: '工作台', ic: 'home' },
  { id: 'checkin', label: '计划打卡', ic: 'check' },
  { id: 'finance', label: '资金管理', ic: 'yuan' },
  { id: 'discover', label: '每日发现', ic: 'sparkle' },
  { id: 'ai', label: 'AI 大事', ic: 'diamond' },
  { id: 'knowledge', label: '知识库', ic: 'search' },
  { id: 'ideas', label: '奇思妙想', ic: 'sparkleOutline' },
  { id: 'company', label: '好公司', ic: 'diamondSolid' },
  { id: 'eval', label: '网页测评', ic: 'external' },
  { id: 'assets', label: '素材库', ic: 'info' }
  // 功能地图（mindmap）已按用户要求隐藏：组件与路由都还在，把这行放开就能恢复入口
  // { id: 'mindmap', label: '功能地图', ic: 'search' }
]

// 数字键 1~8 直接切页。快捷键不跟着导航位置走：7 给好公司（功能地图隐藏后空出来的位置），8 仍是 AI 大事
// 焦点在 input/textarea/select/button 上时不触发，避免打字误跳页 —— 该守卫由 lib/useHotkeys 统一提供
const PAGE_KEYS = { '1': 'home', '2': 'checkin', '3': 'finance', '4': 'discover', '5': 'knowledge', '6': 'ideas', '7': 'company', '8': 'ai', '9': 'assets', '0': 'eval' }
useHotkeys(Object.fromEntries(Object.entries(PAGE_KEYS).map(([k, v]) => [k, () => { page.value = v }])))

// 页面壁纸：每页一张，存在 localStorage（stores/assets.js），图片本体在后端 uploads/assets。
// 只给滚动容器 .pages 铺底 + 压一层 veil 保可读性，不碰页内卡片 —— 卡片是玻璃底，叠上去刚好有层次。
const curWall = computed(() => wallpapers.value[page.value] || '')

// 窄屏下 nav 是横向滚动的：切页后把当前项滚进可视区，否则点完看不见自己选了哪个
watch(page, async () => {
  await nextTick()
  const el = document.querySelector('.nav-pills button.on')
  if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
})

async function onClear() {
  const ok = await clearData()
  if (ok) location.reload()
}
</script>

<template>
  <n-config-provider
    :theme="theme === 'dark' ? darkTheme : null"
    :theme-overrides="theme === 'dark' ? darkThemeOverrides : lightThemeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-message-provider>
      <n-dialog-provider>
        <div class="app-bg">
          <div class="blob b1"></div><div class="blob b2"></div>
          <div class="blob b3"></div><div class="blob b4"></div>
        </div>
        <main class="app-shell">
          <!-- 顶栏：参考 input-prototype.html 的 .topbar -->
          <header class="topbar">
            <div class="brand">
              <span class="dot">{{ APP_INITIAL }}</span>
              <div class="name">{{ APP_NAME }} <small>{{ APP_NAME_EN }}</small></div>
            </div>
            <nav class="nav-pills">
              <button v-for="n in nav" :key="n.id" :class="{on: page===n.id}" @click="page=n.id">
                <AppIcon :name="n.ic" :size="13" class="ic" />{{n.label}}
              </button>
            </nav>
            <div class="actions">
              <button class="icon-btn" :title="theme==='dark' ? '切到浅色' : '切到深色'" @click="toggleTheme">
                <AppIcon :name="theme==='dark' ? 'sun' : 'moon'" :size="15" />
              </button>
              <button class="icon-btn" title="导出数据" @click="exportData"><AppIcon name="upload" :size="15" /></button>
              <button class="icon-btn" title="导入数据" @click="importData"><AppIcon name="download" :size="15" /></button>
              <button class="icon-btn danger" title="清除数据" @click="onClear"><AppIcon name="trash" :size="15" /></button>
            </div>
          </header>

          <div class="main">
            <div class="pages" :class="{ 'has-wall': !!curWall }" :style="curWall ? { '--wall': `url(${curWall})` } : null">
              <transition name="page" mode="out-in">
                <HomeView v-if="page==='home'" key="home" />
                <CheckinView v-else-if="page==='checkin'" key="checkin" />
                <FinanceView v-else-if="page==='finance'" key="finance" />
                <DiscoverView v-else-if="page==='discover'" key="discover" />
                <AiTimelineView v-else-if="page==='ai'" key="ai" />
                <KnowledgeView v-else-if="page==='knowledge'" key="knowledge" />
                <IdeasView v-else-if="page==='ideas'" key="ideas" />
                <CompanyView v-else-if="page==='company'" key="company" />
                <EvalView v-else-if="page==='eval'" key="eval" />
                <AssetsView v-else-if="page==='assets'" key="assets" />
                <MindmapView v-else-if="page==='mindmap'" key="mindmap" />
              </transition>
            </div>
          </div>

          <AppToast />
          <AppModal />
        </main>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
