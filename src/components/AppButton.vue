<script setup>
// 全站统一的按钮。样式全部来自 style.css 的 .btn 族，组件只管组合类名。
//
// 已经收编掉的重复实现：
//   .mini-btn / .mini-btn.primary（好公司 scoped，9 处使用 + 3 条 scoped 定义 → 已删）
//   .primary / .ghost / .ghost.sm（style.css 旧类，与 .btn--primary/.btn--ghost 完全同值，保留为别名）
//
// 保留未迁：.ck（知识库打卡开关）、.ix-del / .ix-add（奇思妙想台阶内微件）——
// 它们是单点专用样式，只在 style.css 有一份，不构成重复。
//
// 用法：
//   <AppButton variant="primary" @click="save">保存</AppButton>
//   <AppButton variant="ghost" size="sm">查看</AppButton>
//   <AppButton variant="quiet" title="删除"><AppIcon name="close" :size="12" /></AppButton>
import { computed } from 'vue'

const props = defineProps({
  /** primary | ghost | outline | quiet | danger */
  variant: { type: String, default: 'ghost' },
  /** '' 用变体自带尺寸；sm / xs 覆盖 */
  size: { type: String, default: '' },
  block: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  /** 加载中：禁用点击 + 显示转圈 */
  loading: { type: Boolean, default: false },
  type: { type: String, default: 'button' }
})

const cls = computed(() => [
  'btn',
  `btn--${props.variant}`,
  props.size ? `btn--${props.size}` : '',
  props.block ? 'btn--block' : ''
])

const isOff = computed(() => props.disabled || props.loading)
</script>

<template>
  <button :type="type" :class="cls" :disabled="isOff">
    <i v-if="loading" class="btn-spin" aria-hidden="true"></i>
    <slot />
  </button>
</template>

<style scoped>
.btn-spin{
  width:11px;height:11px;border-radius:50%;flex:0 0 auto;
  border:1.5px solid currentColor;border-top-color:transparent;
  animation:btn-spin .7s linear infinite;
}
@keyframes btn-spin{to{transform:rotate(360deg)}}
</style>
