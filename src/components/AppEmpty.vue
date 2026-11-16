<script setup>
// 全站统一空态。
// 替换掉的重复实现：
//   <p class="empty">…</p>（style.css）
//   .empty-inline（好公司 scoped）
//   .rd-empty（首页 scoped）
//   .k-empty（知识库 scoped）
//
// 两种形态：
//   plain    —— 一行灰字，用于卡片内/表格内的小提示（视觉与旧 .empty 完全一致）
//   默认     —— Q 版小人 + 主文案 + 副文案 + 可选操作按钮
//
// 用法：
//   <AppEmpty plain>本月暂无支出</AppEmpty>
//   <AppEmpty face="baoxiong" title="还没有发现" desc="刷到让你眼睛一亮的内容，就记录下来吧">
//     <template #action><AppButton variant="primary" @click="open">＋ 记一条</AppButton></template>
//   </AppEmpty>
import { computed } from 'vue'
import { faceOf, faceStyle } from '../assets/yunxiao/index.js'

const props = defineProps({
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
  /** 用哪张官方 Q 版：tuozai / heart / window / window2 / cloud / baoxiong；传 '' 不显示 */
  face: { type: String, default: 'tuozai' },
  /** sm 用在卡片内部，md 用在整页/整块 */
  size: { type: String, default: 'md' },
  /** 纯文字模式，不画插画（等价旧的 .empty） */
  plain: { type: Boolean, default: false }
})

// 位置与倍数都从素材登记表取，组件里不再写死任何坐标
const conf = computed(() => (props.face ? faceOf(props.face) : null))
const imgStyle = computed(() => (conf.value ? faceStyle(conf.value) : {}))
</script>

<template>
  <div class="ae" :class="[`ae--${size}`, { 'ae--plain': plain }]">
    <template v-if="!plain">
      <div v-if="conf" class="ae-face" aria-hidden="true">
        <img :src="conf.src" :style="imgStyle" alt="" loading="lazy" />
      </div>
    </template>
    <p class="ae-title"><slot>{{ title }}</slot></p>
    <p v-if="desc" class="ae-desc">{{ desc }}</p>
    <div v-if="$slots.action" class="ae-action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.ae{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:8px;text-align:center;padding:34px 18px;grid-column:1/-1;
}
.ae--sm{padding:20px 14px;gap:6px}

/* 纯文字：与旧 .empty 完全一致，保证替换后零视觉变化 */
.ae--plain{display:block;padding:28px 0;text-align:center}
.ae--plain .ae-title{font-size:13px;color:var(--text-3);font-weight:400;line-height:1.7;margin:0}
.ae--sm.ae--plain{padding:16px 0}
.ae--sm.ae--plain .ae-title{font-size:12px}

.ae-face{
  width:96px;height:96px;border-radius:50%;overflow:hidden;flex:0 0 auto;
  margin-bottom:6px;
  border:2px solid rgba(255,255,255,.92);
  /* 双层：内部柔影 + 外圈一圈极淡紫，做出「仙气光环」但不抢内容 */
  box-shadow:
    0 12px 28px -14px rgba(86,58,140,.55),
    0 0 0 1px rgba(120,96,170,.14),
    0 0 0 7px rgba(125,91,166,.055);
  transition:transform .4s var(--ease), box-shadow .4s var(--ease);
}
.ae--sm .ae-face{width:62px;height:62px;box-shadow:0 8px 20px -12px rgba(86,58,140,.5), 0 0 0 1px rgba(120,96,170,.12)}
/* 位置与放大倍数由 index.js 的 faceStyle() 行内给出（每张图不同），这里只管盒子 */
.ae-face img{width:100%;height:100%;object-fit:cover;display:block}
.ae:hover .ae-face{transform:translateY(-2px) scale(1.03);box-shadow:0 16px 34px -14px rgba(86,58,140,.6), 0 0 0 1px rgba(120,96,170,.2), 0 0 0 9px rgba(125,91,166,.07)}
[data-theme="dark"] .ae-face{
  border-color:rgba(255,255,255,.14);
  box-shadow:0 12px 28px -14px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.08), 0 0 0 7px rgba(140,110,180,.06);
}

.ae-title{margin:0;font-size:13.5px;font-weight:600;color:var(--text-2);line-height:1.7}
.ae--sm .ae-title{font-size:12.5px;font-weight:500}
.ae-desc{margin:0;font-size:12px;color:var(--text-3);line-height:1.75;max-width:34em}
.ae-action{margin-top:6px}
</style>
