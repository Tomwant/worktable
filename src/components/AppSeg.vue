<script setup>
// 全站统一的分段切换器（几选一的小按钮组）。
// 替换掉的重复实现：
//   <div class="seg"><button :class="{on: range===x}">…（好公司股价区间，scoped 里还重写了一份 .seg）
//   .ai-range > button（AI 时间线区间，另一套样式）
//
// 两种外观：
//   默认      —— 主色填充的方块组（style.css .seg，财务/AI 时间线在用）
//   pill      —— 深色药丸组（好公司股价区间原来那套），用 pill 保留原视觉
//
// 用法：
//   <AppSeg v-model="range" :options="[{value:1,label:'1 年'},{value:3,label:'3 年'}]" />
//   <AppSeg v-model="range" pill :options="opts" />
const props = defineProps({
  modelValue: { type: [String, Number, Boolean], default: '' },
  /** [{ value, label, title? }] */
  options: { type: Array, default: () => [] },
  /** '' 默认主色填充 | pill 深色药丸 */
  variant: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'change'])
function pick(v) {
  if (v === props.modelValue) return
  emit('update:modelValue', v)
  emit('change', v)
}
</script>

<template>
  <div class="seg" :class="variant ? `seg--${variant}` : ''">
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      :class="{ on: modelValue === o.value }"
      :title="o.title || ''"
      :disabled="!!o.disabled"
      @click="pick(o.value)"
    >{{ o.label }}</button>
  </div>
</template>
