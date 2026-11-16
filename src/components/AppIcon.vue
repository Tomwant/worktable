<script setup>
// 全站统一的 SVG 图标。替代散落各处的字符图标（⌕ ⌫ ◈ ✦ ✧ …）——
// 那些符号在 Windows 字体 13px 时笔画会糊掉，且依赖本机字体。
// 用法：<AppIcon name="search" /> / <AppIcon name="check" :size="14" />
import { computed } from 'vue'
import { ICONS, FILLED } from '../lib/icons.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 14 },
  strokeWidth: { type: [Number, String], default: 1.7 },
  title: { type: String, default: '' }
})

const path = computed(() => ICONS[props.name] || '')
const filled = computed(() => FILLED.has(props.name))
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    :stroke="filled ? 'none' : 'currentColor'"
    :stroke-width="filled ? 0 : strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    role="img"
    :aria-label="title || name"
  >
    <title v-if="title">{{ title }}</title>
    <path v-if="path" :d="path" />
  </svg>
</template>

<style scoped>
.app-icon{display:inline-block;flex:0 0 auto;vertical-align:-0.14em}
</style>
