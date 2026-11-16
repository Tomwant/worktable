<script setup>
// AppInput：统一文本/数字输入，底层换成 Naive n-input
// 对外接口不变：v-model / type / placeholder / size / block / min / max / step / disabled / align
// 额外暴露 focus()：供外部快捷聚焦（如知识库 Ctrl+K）调用
import { computed, ref } from 'vue'
import { NInput } from 'naive-ui'
const props = defineProps({
  modelValue: { required: false },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  size: { type: String, default: 'md' }, // sm | md
  block: { type: Boolean, default: false },
  min: { type: [String, Number], default: undefined },
  max: { type: [String, Number], default: undefined },
  step: { type: [String, Number], default: undefined },
  disabled: { type: Boolean, default: false },
  align: { type: String, default: 'left' } // left | center | right
})
const emit = defineEmits(['update:modelValue'])
const isTextarea = computed(() => props.type === 'textarea')
const numProps = computed(() => props.type === 'number'
  ? { inputmode: 'decimal', min: props.min, max: props.max, step: props.step }
  : undefined)
const inputRef = ref(null)
function focus() { inputRef.value?.focus?.() }
defineExpose({ focus })
</script>

<template>
  <n-input
    ref="inputRef"
    class="app-input"
    :class="[`size-${size}`, { block, disabled }]"
    :style="{ textAlign: align }"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :clearable="false"
    :type="isTextarea ? 'textarea' : 'text'"
    :rows="isTextarea ? 3 : undefined"
    :input-props="numProps"
    @update:value="emit('update:modelValue', $event)"
  />
</template>
