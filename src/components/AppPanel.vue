<script setup>
// 模块化面板：新页面的每个区块都用它，不再各自手写「卡片 + 标题 + 说明 + 右侧按钮」。
//
// 为什么要有这个组件：
//   之前每加一个模块都在视图里现拼 .card + .section-title + 自定义类名，
//   内边距、标题字号、说明色、右侧按钮位置各写一套 → 每次都要重调一次样式。
//   这里把「区块的外框和头」定死，视图只负责往里塞内容。
//
// 用法：
//   <AppPanel title="形象位" :desc="`共 ${n} 处`" face="page-company">
//     <template #actions><AppButton variant="primary">＋ 新增</AppButton></template>
//     ...列表...
//   </AppPanel>
//
// face 传形象位 id（见 stores/yunxiao.js），标题左侧会出现 36px 小头像；
// 不传就只有标题，跟旧的 .section-title 视觉一致。
import AppFace from './AppFace.vue'

defineProps({
  title: { type: String, required: true },
  desc: { type: String, default: '' },
  /** 形象位 id，可选 */
  face: { type: String, default: '' }
})
</script>

<template>
  <section class="panel card glass spot">
    <header class="panel-hd">
      <AppFace v-if="face" :slot="face" :size="36" />
      <div class="panel-tt">
        <h2>{{ title }}</h2>
        <p v-if="desc">{{ desc }}</p>
      </div>
      <div v-if="$slots.actions" class="panel-act"><slot name="actions" /></div>
    </header>
    <div class="panel-bd"><slot /></div>
  </section>
</template>

<style scoped>
.panel{padding:18px 20px 20px}
.panel-hd{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
.panel-hd .yx-face{margin-top:-2px}
.panel-tt{flex:1;min-width:0}
.panel-tt h2{margin:0;font-size:15px;font-weight:750;letter-spacing:-.2px;color:var(--text);line-height:1.35}
.panel-tt p{margin:3px 0 0;font-size:11.5px;color:var(--text-3);line-height:1.6}
.panel-act{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.panel-bd{min-width:0}

@media (max-width:640px){
  .panel{padding:14px 14px 16px}
  .panel-hd{flex-wrap:wrap}
  .panel-act{margin-left:auto}
}
</style>
