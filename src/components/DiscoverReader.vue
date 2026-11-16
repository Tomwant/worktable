<script setup>
// 发现阅读器：卡片点开后看完整正文。Markdown 渲染成排版，HTML 内容用 iframe 隔离渲染
import { computed, ref, watch } from 'vue'
import { NModal, NButton } from 'naive-ui'
import { renderMarkdown, looksLikeHtml } from '../utils/markdown.js'

const props = defineProps({
  show: { type: Boolean, default: false },
  item: { type: Object, default: null },
  loading: { type: Boolean, default: false }
})
const emit = defineEmits(['update:show', 'edit'])

const frameH = ref(480)
const isHtml = computed(() => looksLikeHtml(props.item?.content || ''))
const bodyHtml = computed(() => renderMarkdown(props.item?.content || ''))

// HTML 用 iframe 隔离：任务生成的样式不会漏进工作台
function fitFrame(e) {
  try {
    const doc = e.target.contentDocument
    const h = doc.body?.getBoundingClientRect().height || doc.documentElement.scrollHeight || 0
    frameH.value = Math.min(Math.max(Math.ceil(h) + 12, 240), 3600)
  } catch {
    frameH.value = 900
  }
}

watch(() => props.item?.id, () => { frameH.value = 480 })
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="reader-modal glass"
    :bordered="false"
    :mask-closable="true"
    :close-on-esc="true"
    style="width:820px;max-width:94vw"
    @update:show="v => emit('update:show', v)"
  >
    <template #header>
      <div class="reader-head">
        <div class="reader-badges">
          <span v-if="item?.period" class="badge-day">{{ item.series ? item.series + ' · ' : '' }}第 {{ item.period }} 期</span>
          <span v-if="item?.source" class="badge-src">{{ item.source }}</span>
        </div>
        <h2 class="reader-title">{{ item?.title || '（无标题）' }}</h2>
        <div class="reader-meta">
          <small class="date">{{ item?.recordDate }}</small>
          <a v-if="item?.link" :href="item.link" target="_blank" rel="noopener">{{ item.link }}</a>
          <span v-for="t in item?.tags || []" :key="t" class="chip">#{{ t }}</span>
        </div>
      </div>
    </template>

    <div class="reader-body">
      <div v-if="loading" class="reader-empty">正在加载全文…</div>
      <div v-else-if="!item?.content" class="reader-empty">这条发现还没有正文。</div>
      <iframe
        v-else-if="isHtml"
        class="reader-frame"
        :srcdoc="item.content"
        :style="{ height: frameH + 'px' }"
        sandbox="allow-same-origin allow-scripts allow-popups"
        @load="fitFrame"
      />
      <div v-else class="md-body" v-html="bodyHtml" />
    </div>

    <template #footer>
      <div class="reader-foot">
        <span class="reader-tip">{{ loading ? '正在取全文…' : (isHtml ? 'HTML 内容 · 已隔离渲染' : 'Markdown 内容 · 已排版') }}</span>
        <div class="reader-actions">
          <n-button quaternary @click="emit('update:show', false)">关闭</n-button>
          <n-button type="primary" @click="emit('edit', item)">编辑这条</n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>
