<script setup>
import { page } from '../stores/domain.js'
import { theme, toggleTheme, exportData, importData, clearData } from '../stores/ui.js'
import { APP_NAME, APP_INITIAL } from '../config.js'
const nav = [
  { id: 'home', label: '工作台', ic: '⌂' },
  { id: 'checkin', label: '计划打卡', ic: '✓' },
  { id: 'finance', label: '资金管理', ic: '¥' },
  { id: 'discover', label: '每日发现', ic: '✦' },
  { id: 'knowledge', label: '知识库', ic: '⌕' },
  { id: 'mindmap', label: '功能地图', ic: '❖' }
]
async function onClear() {
  const ok = await clearData()
  if (ok) location.reload()
}
</script>

<template>
  <aside class="side glass">
    <div class="logo"><span class="dot">{{ APP_INITIAL }}</span>{{ APP_NAME }}</div>
    <div class="grp">我的空间</div>
    <nav>
      <button v-for="n in nav" :key="n.id" :class="{active: page===n.id}" @click="page=n.id"><span class="ic">{{n.ic}}</span>{{n.label}}</button>
    </nav>
    <div class="foot">
      <button @click="toggleTheme"><span class="ic">{{ theme==='dark' ? '☀️' : '🌙' }}</span>{{ theme==='dark' ? '切到浅色' : '切到深色' }}</button>
      <button @click="exportData"><span class="ic">↥</span>导出数据</button>
      <button @click="onClear" class="danger"><span class="ic">⌫</span>清除数据</button>
    </div>
  </aside>
</template>