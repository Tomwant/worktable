<script setup>
// AppDateRange：开始 / 结束日期范围，统一形态
import AppDate from './AppDate.vue'
defineProps({
  start: { type: String, default: '' },
  end: { type: String, default: '' }
})
defineEmits(['update:start', 'update:end'])
</script>

<template>
  <div class="app-date-range">
    <AppDate :model-value="start" pill @update:model-value="$emit('update:start', $event)" />
    <span class="sep">至</span>
    <AppDate :model-value="end" pill @update:model-value="$emit('update:end', $event)" />
  </div>
</template>
