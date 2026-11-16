<script setup>
// 页面内的小形象位（默认 36px 圆形）。
// 尺寸选定依据：docs/proto-yunxiao-where.html 实测 18/22/28/44/96 像素对照，
// 18px 五官糊成一团、22px 勉强、28px 认得出、36px 起表情和发冠都清楚 —— 所以默认 36。
//
// 用哪个图不写死在这里，全部走 stores/yunxiao.js 的形象位映射，
// 在「素材库」页点一下就能换，改完立刻生效（含已打开的其它页面）。
//
// 用法：
//   <AppFace slot="page-checkin" />                    28px 小头像
//   <AppFace slot="home-focus" :size="132" />          大形象位
//   <AppFace slot="page-finance" :size="44" plain />   无光环
import { computed } from 'vue'
import { slotFace, slotMap } from '../stores/yunxiao.js'
import { faceStyle } from '../assets/yunxiao/index.js'

const props = defineProps({
  /** 形象位 id，见 stores/yunxiao.js 的 SLOTS */
  slot: { type: String, required: true },
  /** 显示尺寸（px）。不要传小于 24 的值，五官会糊 */
  size: { type: Number, default: 36 },
  /** 去掉外圈光环，只留圆形裁切 */
  plain: { type: Boolean, default: false }
})

const conf = computed(() => slotFace(props.slot))
const imgStyle = computed(() => faceStyle(conf.value))
// 大形象位描边随尺寸走：28px 用 1.5px 会显得太粗
const border = computed(() => (props.size >= 60 ? 2 : 1.5))
</script>

<template>
  <span
    class="yx-face"
    :class="{ 'yx-face--plain': plain }"
    :style="{ width: size + 'px', height: size + 'px', borderWidth: border + 'px' }"
    :title="conf.label + ' · ' + slotMap[slot]"
    aria-hidden="true"
  >
    <img :src="conf.src" :style="imgStyle" alt="" loading="lazy" />
  </span>
</template>

<style scoped>
.yx-face{
  display:inline-block;flex:0 0 auto;vertical-align:middle;
  border-radius:50%;overflow:hidden;
  border-style:solid;border-color:rgba(255,255,255,.92);
  background:var(--surface-2);
  box-shadow:0 3px 8px -4px rgba(86,58,140,.5), 0 0 0 1px rgba(120,96,170,.12);
  transition:transform .25s var(--ease), box-shadow .25s var(--ease);
}
/* 尺寸越小，阴影越要收 —— 否则小圆点会看着发灰 */
.yx-face:hover{
  transform:translateY(-1px) scale(1.06);
  box-shadow:0 6px 14px -6px rgba(86,58,140,.6), 0 0 0 1px rgba(120,96,170,.22);
}
.yx-face--plain{box-shadow:none;border-color:transparent}
.yx-face img{width:100%;height:100%;object-fit:cover;display:block}
[data-theme="dark"] .yx-face{border-color:rgba(255,255,255,.14);box-shadow:0 3px 8px -4px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.07)}
[data-theme="dark"] .yx-face--plain{border-color:transparent}
</style>
