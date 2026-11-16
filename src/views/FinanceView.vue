<script setup>
import {
  txForm, finForm, txFilter, financeEdit, addTx, applyFinance,
  allIncome, allExpense, totalBalance, monthIncome, monthExpense, budgetLeft,
  expenseByCat, expenseCatTotal, monthStats, shownTx
} from '../stores/domain.js'
import { db, fmt, catColor, deleteTransaction } from '../stores/index.js'
import AppCard from '../components/AppCard.vue'
import AppEmpty from '../components/AppEmpty.vue'
import AppSeg from '../components/AppSeg.vue'
import AppCategoryChip from '../components/AppCategoryChip.vue'
import AppInput from '../components/AppInput.vue'
import AppDate from '../components/AppDate.vue'
import AppFace from '../components/AppFace.vue'

const txCategories = ['餐饮', '交通', '居家', '娱乐', '医疗', '学习', '人情', '其他']
</script>

<template>
  <section class="page active" key="finance">
    <div class="page-head">
      <div>
        <p class="eyebrow">资金管理</p>
        <h1>资金管理</h1>
        <p>记清每一笔，心里有本账。</p>
      </div>
      <div class="selectors"><button class="primary" @click="financeEdit=!financeEdit">{{ financeEdit ? '收起' : '账户设置' }}</button></div>
    </div>

    <div v-if="financeEdit" class="card glass spot fin-set">
      <div class="section-title"><h2 class="with-face"><AppFace slot="finance-account" />账户设置</h2></div>
      <div class="split">
        <label>期初本金（¥）<AppInput type="number" min="0" v-model="finForm.openingBalance" :placeholder="String(db.finance.openingBalance||0)" block /></label>
        <label>每月预算（¥）<AppInput type="number" min="0" v-model="finForm.monthBudget" :placeholder="String(db.finance.monthBudget||0)" block /></label>
      </div>
      <button class="primary" @click="applyFinance">保存设置</button>
    </div>

    <div class="fin-stats">
      <AppCard variant="card" class="spot"><p class="eyebrow">总存款</p><h3 class="num">{{ fmt(totalBalance) }}</h3><small>期初 {{ fmt(db.finance.openingBalance) }}</small></AppCard>
      <AppCard variant="card" class="spot"><p class="eyebrow">本月存入</p><h3 class="num inc">{{ fmt(monthIncome) }}</h3><small>累计收入 {{ fmt(allIncome) }}</small></AppCard>
      <AppCard variant="card" class="spot"><p class="eyebrow">本月花费</p><h3 class="num dec">{{ fmt(monthExpense) }}</h3><small>累计支出 {{ fmt(allExpense) }}</small></AppCard>
      <AppCard variant="card" class="spot"><p class="eyebrow">本月预算剩余</p><h3 class="num" :class="{over:budgetLeft<0}">{{ fmt(budgetLeft) }}</h3><small>预算 {{ fmt(db.finance.monthBudget) }}</small></AppCard>
    </div>

    <div class="fin-grid">
      <AppCard variant="card" class="spot">
        <div class="section-title"><h2 class="with-face"><AppFace slot="finance-add" />记一笔</h2></div>
        <div class="tx-form">
          <AppSeg
            v-model="txForm.type"
            :options="[{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }]"
          />
          <label>金额<AppInput type="number" min="0" v-model="txForm.amount" placeholder="0" block /></label>
          <label>日期<AppDate v-model="txForm.date" pill /></label>
          <label class="block">类目
            <AppCategoryChip v-model="txForm.category" />
          </label>
          <label>备注（可选）<AppInput v-model="txForm.note" placeholder="如：…" block /></label>
          <button class="primary" @click="addTx">+ 记一笔</button>
        </div>
      </AppCard>

      <AppCard variant="card" class="spot">
        <div class="section-title"><h2 class="with-face"><AppFace slot="finance-trend" />近 6 月收支</h2></div>
        <svg viewBox="0 0 480 200" class="bars">
          <line x1="40" y1="180" x2="460" y2="180" stroke="rgba(150,140,120,.2)" stroke-dasharray="3 4"/>
          <g v-for="(m, i) in monthStats" :key="m.key">
            <rect :x="40 + i * 70" :y="180 - Math.max(2, m.income/100)" width="14" :height="Math.max(2, m.income/100)" rx="3" class="bar inc"/>
            <rect :x="58 + i * 70" :y="180 - Math.max(2, m.expense/100)" width="14" :height="Math.max(2, m.expense/100)" rx="3" class="bar exp"/>
            <text :x="55 + i * 70" y="195" text-anchor="middle" fill="var(--text-3)" font-size="11">{{ m.label }}</text>
          </g>
          <text v-if="!monthStats.some(m => m.income || m.expense)" x="240" y="110" text-anchor="middle" fill="var(--text-3)" font-size="13">近 6 月还没有流水</text>
        </svg>
        <div class="legend"><span><i style="background:#7d5ba6"></i>收入</span><span><i style="background:#b8434f"></i>支出</span></div>
      </AppCard>

      <AppCard variant="card" class="spot">
        <div class="section-title"><h2 class="with-face"><AppFace slot="finance-pie" />本月支出分布</h2></div>
        <div v-if="expenseCatTotal" class="pie-wrap">
          <svg viewBox="-1 -1 2 2" class="pie">
            <template v-for="(amt, cat) in expenseByCat" :key="cat">
              <path :d="pieSlice(cat, amt, expenseCatTotal, expenseByCat)" :fill="catColor(cat)" />
            </template>
          </svg>
          <ul class="pie-legend">
            <li v-for="(amt, cat) in expenseByCat" :key="cat">
              <i :style="{background:catColor(cat)}"></i>{{ cat }} <em>{{ Math.round(amt/expenseCatTotal*100) }}%</em>
            </li>
          </ul>
        </div>
        <AppEmpty v-else plain>本月暂无支出</AppEmpty>
      </AppCard>
    </div>

    <AppCard variant="card" class="spot fin-tx">
      <div class="section-title">
        <h2 class="with-face"><AppFace slot="finance-flow" />流水明细</h2>
        <AppDate v-model="txFilter.month" mode="month" pill />
      </div>
      <div v-if="shownTx.length" class="tx-list">
        <div v-for="t in shownTx" :key="t.id" class="tx-row" :data-type="t.type">
          <span class="tx-ic" :class="t.type">{{ t.type==='income' ? '↓' : '↑' }}</span>
          <div class="tx-mid"><b>{{ t.category }}</b><small class="tx-note">{{ t.note || '—' }}</small><small class="tx-date">{{ t.date }}</small></div>
          <span class="tx-amt" :class="t.type">{{ t.type==='income' ? '+' : '−' }}{{ fmt(t.amount) }}</span>
          <button class="tx-del" title="删除" @click="deleteTransaction(t.id)">×</button>
        </div>
      </div>
      <AppEmpty v-else plain>这个月还没有流水。记一笔吧。</AppEmpty>
    </AppCard>
  </section>
</template>

<script>
import { catColor } from '../stores/index.js'
function pieSlice(cat, amt, total, byCat) {
  let acc = 0
  for (const [k, v] of Object.entries(byCat)) { if (k === cat) break; acc += v }
  const start = (acc / total) * Math.PI * 2 - Math.PI / 2
  const end = start + (amt / total) * Math.PI * 2
  const r = 1
  const x1 = Math.cos(start), y1 = Math.sin(start)
  const x2 = Math.cos(end), y2 = Math.sin(end)
  const large = (end - start) > Math.PI ? 1 : 0
  return `M 0 0 L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}
export default { methods: { pieSlice, catColor } }
</script>