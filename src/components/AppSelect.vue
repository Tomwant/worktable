<script setup>
// AppSelect：玻璃风下拉，底层换成 Naive n-select（自动定位/翻转/浮层 z-index，根治错位）
// 对外接口不变：v-model / options / placeholder / labelFn / compact / disabled
import { computed } from 'vue'
import { NSelect } from 'naive-ui'
const props = defineProps({
  modelValue: { required: true },
  options: { type: Array, required: true }, // [{value,label}] 或 [string]
  placeholder: { type: String, default: '' },
  labelFn: { type: String, default: '' }, // 简单值数组时附加后缀
  compact: { type: Boolean, default: false }, // 紧凑胶囊形态
  disabled: { type: Boolean, default: false },
  clearable: { type: Boolean, default: false } // 允许清空（悬停出现 ✕，清空后回 placeholder）。默认关闭，避免表单下拉被误清
})
const emit = defineEmits(['update:modelValue'])
const opts = computed(() => props.options.map(o => typeof o === 'object'
  ? { label: o.label, value: o.value }
  : { label: String(o) + props.labelFn, value: o }))
const value = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})
// Naive 的 n-select 把空字符串 '' 视为「已选中」，若选项里没有 value:'' 就会渲染成空白框、吞掉 placeholder。
// 统一把 '' 归一成 null，保证未选择时正常显示 placeholder。
const shownValue = computed(() => (props.modelValue === '' ? null : props.modelValue))
</script>

<template>
  <n-select
    class="app-sel"
    :class="[{ compact, placeholder: !modelValue }]"
    :options="opts"
    :value="shownValue"
    :placeholder="placeholder"
    :clearable="clearable"
    :disabled="disabled"
    :size="compact ? 'small' : 'medium'"
    :consistent-menu-width="false"
    :max-tag-count="1"
    :show-arrow="true"
    @update:value="value = $event"
  />
</template>
