<script setup>
import { page } from '../stores/domain.js'
import { todayProgress, todayHint } from '../stores/ui.js'
import { openDiscover } from '../stores/domain.js'

const buttons = [
  { id: 'checkin', label: '打卡', ic: '✓' },
  { id: 'finance', label: '资金', ic: '¥' },
  { id: 'discover', label: '灵感', ic: '✦', action: 'openDiscover' },
  { id: 'knowledge', label: '检索', ic: '⌕' },
  { id: 'mindmap', label: '地图', ic: '❖' }
]
const RING = 107
</script>

<template>
  <aside class="desktop-dock" aria-label="快捷操作">
    <button class="dock-progress" @click="page='checkin'" :title="todayHint">
      <svg viewBox="0 0 42 42"><circle class="track" cx="21" cy="21" r="17"/><circle class="value" cx="21" cy="21" r="17" :style="{ strokeDashoffset: RING - todayProgress * 1.07 }"/></svg>
      <b>{{ todayProgress }}%</b>
    </button>
    <span>{{ todayHint }}</span>
    <div class="dock-actions">
      <button v-for="b in buttons" :key="b.id" @click="b.action==='openDiscover' ? openDiscover() : (page=b.id)">{{ b.ic }} <i>{{ b.label }}</i></button>
    </div>
  </aside>
</template>