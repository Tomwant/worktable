<script setup>
// AppTextarea：统一多行输入，底层换成 Naive n-input(textarea)
// 对外接口不变：v-model / placeholder / rows / block
import { NInput } from 'naive-ui'
defineProps({
  modelValue: { required: false },
  placeholder: { type: String, default: '' },
  rows: { type: Number, default: 3 },
  block: { type: Boolean, default: false }
})
defineEmits(['update:modelValue'])
</script>

<template>
  <n-input
    class="app-textarea"
    :class="{ block }"
    type="textarea"
    :rows="rows"
    :placeholder="placeholder"
    :value="modelValue"
    :clearable="false"
    @update:value="$emit('update:modelValue', $event)"
  />
</template>
