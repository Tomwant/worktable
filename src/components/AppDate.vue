<script setup>
// AppDate：统一日期/月份选择，底层换成 Naive n-date-picker
// 对外接口不变：v-model / mode(date|month) / pill
import { computed } from 'vue'
import { NDatePicker } from 'naive-ui'
const props = defineProps({
  modelValue: { required: false },
  mode: { type: String, default: 'date' }, // date | month
  pill: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])
const pickerType = computed(() => props.mode === 'month' ? 'month' : 'date')
const fmt = computed(() => props.mode === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd')
</script>

<template>
  <n-date-picker
    class="app-date"
    :class="{ pill }"
    :type="pickerType"
    :format="fmt"
    :value-format="fmt"
    :formatted-value="modelValue || null"
    :clearable="false"
    :size="pill ? 'small' : 'medium'"
    @update:formatted-value="v => emit('update:modelValue', v || '')"
  />
</template>
