<script setup>
import { focusTodos, toggleFocus, last7days, weekRate, streak, page, readItems, readToday, removeKnowledgeCheck } from '../stores/domain.js'
import { catColor, db, knowledgePager, fetchKnowledgeOne, API_BASE } from '../stores/index.js'
import { todayProgress, ringOffset, greeting, dateLine, monthDoneToday, todayTotalTasks } from '../stores/ui.js'
import { splitBody } from '../utils/text.js'
import { NModal } from 'naive-ui'
import { ref, computed } from 'vue'
import AppCard from '../components/AppCard.vue'
import AppEmpty from '../components/AppEmpty.vue'
import AppButton from '../components/AppButton.vue'
import AppFace from '../components/AppFace.vue'
// 云霄仙子 Q 版（官方动画原片）：焦点卡右侧角色位
// 用哪张图走「素材库」的形象位映射（stores/yunxiao.js），这里只声明自己是哪一格
import { faceStyle } from '../assets/yunxiao/index.js'
import { slotFace } from '../stores/yunxiao.js'
const RING = 314.16
const yxF = computed(() => slotFace('home-focus'))

// 「今日已读」点标题直接开阅读窗：列表接口只回当前页，按 id 单取全文
const readShow = ref(false)
const readLoading = ref(false)
const readItem = ref(null)
const readSegs = ref([])
async function openRead(it) {
  readItem.value = { title: it.title, originDate: it.originDate }
  readSegs.value = []
  readShow.value = true
  readLoading.value = true
  try {
    const k = await fetchKnowledgeOne(it.kbId)
    readItem.value = k
    readSegs.value = splitBody(k.content)
  } catch {
    readSegs.value = []
    readItem.value = { ...readItem.value, missing: true }
  } finally { readLoading.value = false }
}
</script>

<template>
  <section class="page active" key="home">
    <AppCard variant="focus" class="focus glass spot">
      <div class="ring">
        <svg viewBox="0 0 116 116">
          <circle class="track" cx="58" cy="58" r="50"></circle>
          <circle class="value" cx="58" cy="58" r="50" :stroke-dasharray="RING" :stroke-dashoffset="ringOffset(todayProgress)"></circle>
        </svg>
        <div class="center"><div><b>{{ todayProgress }}%</b><span>今日完成</span></div></div>
      </div>
      <div class="mid">
        <p class="eyebrow">{{ dateLine }}</p>
        <h1>{{ greeting }}</h1>
        <p class="sub" v-if="todayTotalTasks">已完成 <em>{{ monthDoneToday }}</em>/{{ todayTotalTasks }} 项 · 连续打卡 <em>{{ streak }}</em> 天</p>
        <p class="sub" v-else>先去「计划打卡」给这个月加打卡项吧</p>
      </div>
      <div class="todos" v-if="focusTodos.length">
        <div v-for="t in focusTodos" :key="t.task.id" class="todo" @click="toggleFocus(t)">
          <span class="check" :class="{ok:t.it.isFinish}">{{ t.it.isFinish ? '✓' : '' }}</span>
          <span class="nm"><b :class="{done:t.it.isFinish}">{{ t.task.name }}</b><small>{{ t.plan.name }} · {{ t.task.category||'未分类' }}</small></span>
          <span class="tag" :style="{background:catColor(t.task.category||'未分类')+'22',color:catColor(t.task.category||'未分类')}">{{ t.task.category||'未分类' }}</span>
        </div>
      </div>
      <div class="todos" v-else><AppEmpty plain size="sm">还没有今日打卡项</AppEmpty></div>
      <div class="yx-avatar" title="云霄仙子">
        <img :src="yxF.src" :style="faceStyle(yxF)" alt="云霄仙子 Q 版" />
      </div>
    </AppCard>

    <!-- 今日已读：知识库里点过「打卡」的知识，横向一条，不撑高上面的焦点卡 -->
    <div class="readbar">
      <span class="lb">
        <span class="ic">◉</span>
        <b>今日已读</b>
        <span class="n">{{ readToday }} 篇</span>
      </span>
      <div v-if="readItems.length" class="read-list">
        <span v-for="it in readItems" :key="it.kbId" class="rd">
          <span class="t" :title="it.title" @click="openRead(it)">✓ {{ it.title }}</span>
          <button class="x" title="取消打卡" @click="removeKnowledgeCheck(it.kbId)">✕</button>
        </span>
      </div>
      <span v-else class="rd-empty">今天还没有打卡任何知识，去知识库挑一篇。</span>
      <button class="go" @click="page = 'knowledge'">去知识库挑一篇</button>
    </div>

    <div class="bento">
      <AppCard variant="bento" class="tall spot">
        <div class="head">
          <div>
            <p class="eyebrow">趋势</p>
            <h3>近 7 天打卡趋势</h3>
          </div>
          <div class="head-r"><small>本周 {{ weekRate }}%</small><AppFace slot="page-home" /></div>
        </div>
        <svg viewBox="0 0 480 200" class="bars">
          <line x1="20" y1="180" x2="470" y2="180" stroke="rgba(150,140,120,.2)" stroke-dasharray="3 4"/>
          <g v-for="(d, i) in last7days" :key="d.key">
            <rect :x="20 + i * 65" :y="180 - Math.max(2, d.count * 90)" width="40" :height="Math.max(2, d.count * 90)" rx="6" class="bar"/>
            <text :x="40 + i * 65" y="195" text-anchor="middle" fill="var(--text-3)" font-size="11">{{ d.label }}</text>
            <text v-if="d.count > 0" :x="40 + i * 65" :y="170 - d.count * 90" text-anchor="middle" fill="var(--accent-deep)" font-size="11" font-weight="700">{{ d.count }}</text>
          </g>
          <text v-if="!last7days.some(d => d.count > 0)" x="240" y="120" text-anchor="middle" fill="var(--text-3)" font-size="13">本周还没有打卡数据</text>
        </svg>
      </AppCard>

      <AppCard variant="bento" class="spot">
        <div class="head">
          <div>
            <p class="eyebrow">连续</p>
            <h3>连续打卡</h3>
          </div>
          <AppFace slot="home-streak" />
        </div>
        <p class="big"><em>{{ streak }}</em><i>天</i></p>
        <small>坚持，比强度更重要</small>
        <p class="hint">{{ streak }} 天 · 每天一点点</p>
      </AppCard>

      <AppCard variant="bento" class="spot">
        <div class="head">
          <div>
            <p class="eyebrow">沉淀</p>
            <h3>知识沉淀</h3>
          </div>
          <AppFace slot="home-knowledge" />
        </div>
        <p class="big"><em>{{ knowledgePager.totalAll }}</em><i>条</i></p>
        <small>打卡与发现的自动结晶</small>
        <p class="hint">点「知识库」查看</p>
      </AppCard>
    </div>

    <!-- 今日已读的阅读窗 -->
    <n-modal
      v-model:show="readShow"
      preset="card"
      class="app-modal glass k-full-modal"
      :mask-closable="true"
      :close-on-esc="true"
      style="width:min(760px,94vw)"
    >
      <template #header>
        <div class="k-full-head">
          <h3>{{ readItem?.title }}</h3>
          <small>{{ readItem?.originDate }}{{ readItem?.sourceLabel ? ' · ' + readItem.sourceLabel : '' }}</small>
        </div>
      </template>
      <div class="k-full-body">
        <p v-if="readLoading" class="empty">正在读取正文…</p>
        <p v-else-if="readItem?.missing" class="empty">这条知识的正文已经取不到了（可能已被删除）。</p>
        <template v-else>
          <p v-for="(seg, i) in readSegs" :key="i">{{ seg }}</p>
        </template>
      </div>
      <template #footer>
        <div class="modal-actions">
          <a v-if="readItem?.attachmentUrl" class="k-open-link" :href="API_BASE + readItem.attachmentUrl" target="_blank" rel="noopener noreferrer">查看原报告</a>
          <button class="ghost sm" @click="readShow = false">关闭</button>
        </div>
      </template>
    </n-modal>
  </section>
</template>