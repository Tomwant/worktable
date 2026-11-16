<script setup>
import { ref } from 'vue'
import { db, deleteDiscover, fetchDiscover } from '../stores/index.js'
import { openDiscover } from '../stores/domain.js'
import AppCard from '../components/AppCard.vue'
import AppEmpty from '../components/AppEmpty.vue'
import DiscoverReader from '../components/DiscoverReader.vue'

// 定时任务投递的记录带此标记（source 以「定时任务」开头），用于显示「自动收录」徽标
const isAuto = item => String(item?.source || '').startsWith('定时任务')

const reading = ref(null)
const readerOpen = ref(false)
const readerLoading = ref(false)

// 列表接口只回摘要，正文按 id 单独取（单条最大 23KB，不跟着列表走）
async function read(item) {
  reading.value = { ...item, content: '' }
  readerOpen.value = true
  if (!item?.id) return
  readerLoading.value = true
  try {
    const full = await fetchDiscover(item.id)
    if (reading.value?.id === item.id) reading.value = { ...item, ...full }
  } catch { /* 取不到全文时保留摘要，阅读器会提示 */ }
  finally { readerLoading.value = false }
}
function editFromReader(item) { readerOpen.value = false; openDiscover(item) }
function askDelete(item) {
  if (!confirm(`删除「${item.title}」？删除后正文不可恢复。`)) return
  deleteDiscover(item.id)
}
</script>

<template>
  <section class="page active" key="discover">
    <div class="page-head">
      <div>
        <p class="eyebrow">每日发现</p>
        <h1>每日发现</h1>
        <p>那些偶然看见、值得被留下的商业灵感。</p>
      </div>
      <div class="selectors"><button class="primary" @click="openDiscover()">+ 记录新发现</button></div>
    </div>

    <div v-if="db.discovers.length" class="disc-list">
      <AppCard
        v-for="d in db.discovers"
        :key="d.id"
        variant="card"
        class="spot disc-card clickable"
        @click="read(d)"
      >
        <div class="disc-head">
          <h3>
            <span v-if="d.period" class="badge-day">{{ d.series || '第 N 期' }} · 第 {{ d.period }} 期</span>
            <span class="disc-title">{{ d.title }}</span>
          </h3>
          <div class="disc-actions" @click.stop>
            <span v-if="isAuto(d)" class="badge-auto">⟳ 自动收录</span>
            <small class="date">{{ d.recordDate }}</small>
            <button class="ghost sm" @click="openDiscover(d)">编辑</button>
            <button class="ghost sm danger" @click="askDelete(d)">删除</button>
          </div>
        </div>
        <div v-if="d.source || d.link" class="meta-row" @click.stop>
          <span v-if="d.source">来源：{{ d.source }}</span>
          <a v-if="d.link" :href="d.link" target="_blank" rel="noopener">{{ d.link }}</a>
        </div>
        <p class="content clamp2">{{ d.excerpt || '' }}</p>
        <div class="disc-foot">
          <div v-if="d.tags?.length" class="tags" @click.stop>
            <span v-for="t in d.tags" :key="t" class="chip">#{{ t }}</span>
          </div>
          <span v-else />
          <button class="read-more" @click.stop="read(d)">阅读全文 →</button>
        </div>
      </AppCard>
    </div>
    <AppCard v-else variant="card" class="spot empty-card">
      <AppEmpty title="还没有发现" desc="刷到让你眼睛一亮的内容，就记录下来吧。" />
    </AppCard>

    <DiscoverReader
      v-model:show="readerOpen"
      :item="reading"
      :loading="readerLoading"
      @edit="editFromReader"
    />
  </section>
</template>
