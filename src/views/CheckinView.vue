<script setup>
import {
  yearPlans, monthPlans, saveYear, saveMonth, addTask, remove, editPlan, renameTask,
  yearForm, monthForm, taskForms, taskCats, catInput, addCategory, removeCategory,
  yearAccum, monthAccum, monthPlansOf, tasksOfPlan, taskStats,
  boundPlans, yearPlanOfMonth, rebindMonth,
  selectedYear, selectedMonth, dailyList, checkDate,
  catRows, catStatsOf, catScope,
  dragKey, dropPlan
} from '../stores/domain.js'
import { db, catColor } from '../stores/index.js'
import AppCard from '../components/AppCard.vue'
import AppEmpty from '../components/AppEmpty.vue'
import AppSelect from '../components/AppSelect.vue'
import AppCategoryChip from '../components/AppCategoryChip.vue'
import AppInput from '../components/AppInput.vue'
import AppTextarea from '../components/AppTextarea.vue'
import AppDate from '../components/AppDate.vue'
import AppFace from '../components/AppFace.vue'
</script>

<template>
  <section class="page active" key="checkin">
    <div class="page-head">
      <div>
        <p class="eyebrow">计划 · 打卡</p>
        <h1>计划打卡</h1>
        <p>年计划 → 月计划 → 打卡项，每天对打卡项坚持。</p>
      </div>
      <div class="selectors">
        <AppSelect v-model="selectedYear" :options="Array.from({length:5},(_,i)=>2024+i)" />
        <AppSelect v-model="selectedMonth" :options="Array.from({length:12},(_,i)=>i+1)" label-fn="月" />
      </div>
    </div>

    <div class="plans">
      <!-- 年计划 -->
      <AppCard variant="card" class="spot">
        <div class="section-title">
          <div>
            <h2 class="with-face"><AppFace slot="checkin-year" />年计划</h2>
            <small class="meta">{{ selectedYear }} 年</small>
          </div>
        </div>
        <div class="plan-form">
          <AppInput v-model="yearForm.name" placeholder="年度目标，如：读完 24 本书" block />
          <div class="row2">
            <AppCategoryChip v-model="yearForm.category" placeholder="选择分类" />
            <AppInput v-model="yearForm.desc" placeholder="写一句目标说明" block />
          </div>
          <div class="submit-row">
            <AppInput v-model="yearForm.target" type="number" min="1" placeholder="年度目标次数（可选，如 24 本书 = 24）" block />
            <button class="primary" @click="saveYear">+ 新增年计划</button>
          </div>
        </div>

        <ul class="plan-list" v-if="yearPlans().length">
          <li v-for="p in yearPlans()" :key="p.id" class="plan-row" draggable="true" @dragstart="dragKey=p.id" @dragover.prevent @drop="dropPlan(p)">
            <span class="cat-dot" :style="{background:catColor(p.category)}"></span>
            <div class="nm">
              <b>{{ p.name }}</b>
              <small v-if="p.desc">{{ p.desc }}</small>
              <div v-if="p.target" class="yp-meta">
                <span class="yp-bar"><i :style="{width:ypPct(p)+'%'}"></i></span>
                <small class="muted"><b class="num">{{ yearAccum(p.id) }}</b> / {{ p.target }} · {{ ypPct(p) }}%</small>
              </div>
              <small v-else class="muted">年度累计 <b class="num">{{ yearAccum(p.id) }}</b> 次打卡</small>
            </div>
            <AppCategoryChip v-model="p.category" compact />
            <button class="ghost sm" @click="editPlan(p)">编辑</button>
            <button class="ghost sm danger" @click="remove(db.yearPlans,p.id)">删除</button>
            <details class="yp-detail">
              <summary>绑定明细 · {{ boundPlans(p.id).length }} 张月计划</summary>
              <div v-if="boundPlans(p.id).length" class="yp-bound">
                <div v-for="bp in boundPlans(p.id)" :key="bp.id" class="yp-bound-row">
                  <span class="mbadge">{{ bp.month }} 月</span>
                  <b>{{ bp.name }}</b>
                  <small class="muted">{{ tasksOfPlan(bp.id).length }} 项打卡</small>
                  <span class="sp"></span>
                  <em class="num">月累计 {{ monthAccum(bp.id) }} 次</em>
                  <button class="ghost sm danger" @click="rebindMonth(bp.id, '')">解绑</button>
                </div>
                <div class="yp-total">年度累计 <b class="num">{{ yearAccum(p.id) }}</b> 次 = 上方 {{ boundPlans(p.id).length }} 张月计划完成次数加总（每完成一次每日打卡 +1）</div>
              </div>
              <p v-else class="yp-empty">还没绑定月计划 → 右侧「月计划」新建时选择这张年计划，或用月计划行内的下拉把已有计划绑过来。未绑定的独立月计划不会计入任何年度累计。</p>
            </details>
          </li>
        </ul>
        <AppEmpty v-else plain>本年还没有年计划。上面填一项开始。</AppEmpty>
      </AppCard>

      <!-- 月计划 -->
      <AppCard variant="card" class="spot">
        <div class="section-title">
          <div>
            <h2 class="with-face"><AppFace slot="checkin-month" />月计划</h2>
            <small class="meta">{{ selectedMonth }} 月</small>
          </div>
        </div>
        <div class="plan-form">
          <AppInput v-model="monthForm.name" placeholder="本月想推进什么？" block />
          <div class="row2 even">
            <AppCategoryChip v-model="monthForm.category" placeholder="选择分类" />
            <AppSelect v-model="monthForm.yearPlanId" :options="yearPlans().map(p=>({value:p.id,label:p.name}))" placeholder="独立（不关联年度）" />
          </div>
          <AppTextarea v-model="monthForm.desc" :rows="2" placeholder="计划目标描述" block />
          <div class="submit-row">
            <span></span>
            <button class="primary" @click="saveMonth">+ 新增月计划</button>
          </div>
        </div>

        <div v-if="monthPlans().length" class="month-accord">
          <details v-for="p in monthPlans()" :key="p.id" class="month-block" open>
            <summary>
              <span class="cat-dot" :style="{background:catColor(p.category)}"></span>
              <b>{{ p.name }}</b>
              <small>{{ p.category }} · 累计 {{ monthAccum(p.id) }} 次</small>
              <span v-if="yearPlanOfMonth(p)" class="chip bind-chip" :title="'每月打卡计入年度累计：'+yearPlanOfMonth(p).name">→ {{ yearPlanOfMonth(p).name }}</span>
              <span v-else class="chip free-chip" title="未绑定年计划：可正常打卡，但不计入任何年度累计">独立 · 不计年度</span>
              <span class="bind-sel" @mousedown.stop @click.stop><AppSelect :options="[{value:'',label:'独立（不绑年度）'},...yearPlans().map(yp=>({value:yp.id,label:'→ '+yp.name}))]" :value="p.yearPlanId || ''" @update:value="v=>rebindMonth(p.id, v)" compact placeholder="绑定/改绑" /></span>
              <AppCategoryChip v-model="p.category" compact />
              <button class="ghost sm" @click.prevent.stop="editPlan(p)">编辑</button>
              <button class="ghost sm danger" @click.prevent.stop="remove(db.monthPlans,p.id)">删除</button>
            </summary>
            <ul class="task-list">
              <li v-for="t in tasksOfPlan(p.id)" :key="t.id" class="task-row">
                <span class="cat-dot" :style="{background:catColor(t.category)}"></span>
                <b>{{ t.name }}</b>
                <AppCategoryChip v-model="t.category" compact />
                <span class="count">已完成 {{ taskStats(t.id) }} 次</span>
                <button class="ghost sm" @click="renameTask(t)">改名</button>
                <button class="ghost sm danger" @click="remove(db.checkTasks,t.id)">删除</button>
              </li>
            </ul>
            <div class="task-add">
              <AppCategoryChip v-model="taskCats[p.id]" compact placeholder="分类" />
              <AppInput v-model="taskForms[p.id]" :placeholder="'在「'+p.name+'」下加打卡项…'" @keydown.enter="addTask(p.id)" />
              <button class="primary" @click="addTask(p.id)">+ 添加</button>
            </div>
          </details>
        </div>
        <AppEmpty v-else plain>本月还没有月计划。上面填一项开始。</AppEmpty>
      </AppCard>
    </div>

    <!-- 分类管理 + 分类统计 -->
    <AppCard variant="card" class="spot cat-section">
      <div class="section-title">
        <div>
          <p class="eyebrow">分类管理</p>
          <h2 class="with-face"><AppFace slot="checkin-cat" />按分类精确统计</h2>
        </div>
        <div class="cat-add">
          <AppInput v-model="catInput" placeholder="新分类…" block />
          <button class="primary" @click="addCategory">+ 添加</button>
        </div>
      </div>
      <div class="cat-chips">
        <span v-for="c in db.categories" :key="c" class="chip" :style="{background:catColor(c)+'22',color:catColor(c),borderColor:catColor(c)+'55'}">{{ c }}<button v-if="c!=='未分类'" @click="removeCategory(c)" title="删除">×</button></span>
      </div>

      <div class="seg">
        <button :class="{on:catScope==='month'}" @click="catScope='month'">本月 {{ selectedMonth }} 月</button>
        <button :class="{on:catScope==='year'}" @click="catScope='year'">本年 {{ selectedYear }} 年</button>
        <button :class="{on:catScope==='all'}" @click="catScope='all'">累计</button>
      </div>

      <div v-if="catRows.length" class="cat-rows">
        <div v-for="r in catRows" :key="r.name" class="cat-row">
          <span class="cat-dot" :style="{background:r.color}"></span>
          <b>{{ r.name }}</b>
          <small class="muted">{{ r.tasks }} 项打卡</small>
          <span class="num">{{ catScope==='month' ? catStatsOf(r.name, selectedYear, selectedMonth) : catScope==='year' ? catStatsOf(r.name, selectedYear) : r.count }}<i>次</i></span>
          <span class="bar"><i :style="{width:Math.min(100, r.count/Math.max(1,catRows[0].count)*100)+'%', background:r.color}"></i></span>
        </div>
      </div>
      <AppEmpty v-else plain>还没有分类数据。给计划/打卡项设置分类并完成打卡后，这里会精确统计每一类的完成次数。</AppEmpty>
    </AppCard>

    <!-- 每日打卡 -->
    <AppCard variant="card" class="check-card spot">
      <div class="section-title">
        <div>
          <p class="eyebrow">每日打卡</p>
          <h2 class="with-face"><AppFace slot="checkin-daily" />{{ formatDate(checkDate) }} · 勾选即保存</h2>
        </div>
        <AppDate v-model="checkDate" pill />
      </div>
      <div v-if="dailyList.length" class="check-list">
        <article v-for="d in dailyList" :key="d.task.id" class="daily-row" :class="{done:d.it.isFinish}" @click="d.it.isFinish=!d.it.isFinish">
          <label class="done" @click.stop>
            <input type="checkbox" v-model="d.it.isFinish"><span class="ck-mark">{{ d.it.isFinish?'✓':'' }}</span>
          </label>
          <div class="check-body">
            <div class="cb-line">
              <b :class="{done:d.it.isFinish}">{{ d.task.name }}</b>
              <span class="chip tag-chip" :style="{background:catColor(d.task.category)+'22',color:catColor(d.task.category),borderColor:catColor(d.task.category)+'55'}">{{ d.task.category }}</span>
              <small class="cb-sub">{{ d.plan.name }} · {{ d.plan.month }} 月</small>
            </div>
            <input class="note" @click.stop v-model="d.it.note" :placeholder="d.it.isFinish ? '打卡备注（点击行内任意位置可继续记录）' : '点行勾选完成，或在下方写今天做了什么…'">
          </div>
        </article>
      </div>
      <AppEmpty v-else plain>这个月还没有打卡项。请在上方月计划下添加。</AppEmpty>
      <footer>
        <button class="ghost" @click="dailyList.forEach(d=>d.it.isFinish=true)">全部完成</button>
        <button class="ghost" @click="dailyList.forEach(d=>d.it.isFinish=false)">全部取消</button>
        <span class="save-hint">勾选与备注都会自动保存 ✓</span>
      </footer>
    </AppCard>
  </section>
</template>

<script>
import { yearAccum } from '../stores/domain.js'
function formatDate(d) { return new Date(`${d}T00:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }) }
function ypPct(p) { const d = yearAccum(p.id); return p.target ? Math.min(100, Math.round(d / p.target * 100)) : 0 }
export default { methods: { formatDate, ypPct } }
</script>