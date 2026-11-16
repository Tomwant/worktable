<script setup>
// 分类选择 chip：直接复用 AppSelect（紧凑模式），分类列表实时来自 db.categories
// 保持 v-model / compact / placeholder 接口完全一致，老代码无须改动
import { computed } from 'vue'
import { db, catColor } from '../stores/index.js'
import AppSelect from './AppSelect.vue'
const props = defineProps({
  modelValue: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  placeholder: { type: String, default: '选择分类' }
})
const emit = defineEmits(['update:modelValue'])
const options = computed(() => db.categories.map(c => ({ value: c, label: c })))
const value = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})
</script>

<template>
  <span class="cat-chip-wrap" :style="modelValue ? { '--cat-color': catColor(modelValue) } : null">
    <AppSelect v-model="value" :options="options" :placeholder="placeholder" :compact="compact" />
  </span>
</template>
