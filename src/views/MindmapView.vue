<script setup>
import {
  MM_WIDTH, MM_HEIGHT, mmExpanded, mmHovered, mmPan, mmZoom, mmDragging,
  mmBranches, mmLayout, mmCurve, mmGo, mmReset, mmOnWheel, mmOnDown, mmOnMove, mmOnUp
} from '../stores/domain.js'
import AppCard from '../components/AppCard.vue'
import { APP_NAME } from '../config.js'
import { computed, onMounted, onUnmounted } from 'vue'

const layout = computed(() => mmLayout())
const MM_BRANCHES = mmBranches
function nodeById(id) { return layout.value.nodes.find(n => n.id === id) }
function isLinkHit(from, to) {
  const a = nodeById(from), b = nodeById(to)
  if (!a || !b) return { hit: false }
  return { hit: true, d: mmCurve(a.x, a.y, b.x, b.y) }
}

function nodeClick(n) {
  if (n.kind === 'branch') mmExpanded[n.id] = !mmExpanded[n.id]
  else if (n.kind === 'child') mmGo(n)
}

onMounted(() => {
  window.addEventListener('mouseup', mmOnUp)
  window.addEventListener('mousemove', mmOnMove)
})
onUnmounted(() => {
  window.removeEventListener('mouseup', mmOnUp)
  window.removeEventListener('mousemove', mmOnMove)
})
</script>

<template>
  <section class="page active" key="mindmap">
    <div class="page-head">
      <div>
        <p class="eyebrow">功能地图</p>
        <h1>功能分布图</h1>
        <p>一眼看清「{{ APP_NAME }}」全貌。中心向外辐射 5 大模块、共 {{ MM_BRANCHES.reduce((s,b)=>s+b.children.length,0) + MM_BRANCHES.length }} 个功能点。</p>
      </div>
      <div class="selectors">
        <small class="hint">滚轮缩放 · 拖动背景平移 · 点击节点跳转</small>
        <button class="ghost" @click="mmReset">↻ 重置视图</button>
      </div>
    </div>

    <div class="mm-canvas-wrap">
      <svg :viewBox="`${-mmPan.x/mmZoom} ${-mmPan.y/mmZoom} ${MM_WIDTH/mmZoom} ${MM_HEIGHT/mmZoom}`"
           class="mm-svg"
           @wheel.prevent="mmOnWheel"
           @mousedown="mmOnDown"
           preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="rootGrad" cx="50%" cy="40%"><stop offset="0%" stop-color="#b9a3dd"/><stop offset="100%" stop-color="#63478a"/></radialGradient>
          <filter id="rootGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
        </defs>

        <g class="mm-content" :style="{transform:`scale(${mmZoom})`}">
          <!-- 连接线 -->
          <path v-for="(l,i) in layout.links" :key="'l'+i" :d="isLinkHit(l.from,l.to).d" class="mm-link" />

          <!-- 根 -->
          <g class="mm-root">
            <circle :cx="layout.nodes[0].x" :cy="layout.nodes[0].y" r="56" fill="url(#rootGrad)" opacity="0.35" filter="url(#rootGlow)" />
            <g class="mm-root-pulse">
              <circle :cx="layout.nodes[0].x" :cy="layout.nodes[0].y" r="48" fill="url(#rootGrad)" />
              <text :x="layout.nodes[0].x" :y="layout.nodes[0].y+5" text-anchor="middle" class="mm-root-text">{{ layout.nodes[0].label }}</text>
            </g>
          </g>

          <!-- 分支 + 子节点 -->
          <template v-for="n in layout.nodes" :key="n.id">
            <g v-if="n.kind==='branch'" class="mm-branch" :class="{open:mmExpanded[n.id]}" @click="nodeClick(n)">
              <ellipse :cx="n.x" :cy="n.y" rx="58" ry="32" :fill="n.color" :stroke="mmHovered===n.id?'#fff':'transparent'" stroke-width="2.5" />
              <text :x="n.x" :y="n.y+5" text-anchor="middle" class="mm-branch-text">{{ n.label }}</text>
              <text :x="n.x" :y="n.y+46" text-anchor="middle" class="mm-branch-sub">{{ n.count }} 个功能 · 点击展开</text>
            </g>
            <g v-else-if="n.kind==='child'" class="mm-child" @click="nodeClick(n)">
              <rect :x="n.x-58" :y="n.y-15" width="116" height="30" rx="15" :fill="mmHovered===n.id?n.color:'var(--surface)'" :stroke="n.color" stroke-width="1.5" />
              <text :x="n.x" :y="n.y+5" text-anchor="middle" class="mm-child-text" :fill="mmHovered===n.id?'#fff':n.color">{{ n.label }}</text>
              <title>{{ n.desc }}</title>
            </g>
          </template>
        </g>
      </svg>

      <AppCard variant="card" class="mm-legend glass">
        <p class="eyebrow">模块分布</p>
        <ul>
          <li v-for="b in MM_BRANCHES" :key="b.id">
            <i :style="{background:b.color}"></i>{{ b.label }}<em>{{ b.children.length }} 项</em>
          </li>
        </ul>
      </AppCard>
    </div>
  </section>
</template>