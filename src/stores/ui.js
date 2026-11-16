// 全局 UI 状态：主题、导出导入、Dock 进度、今日提示
import { ref, computed, watch } from 'vue'
import { db, today, notify, pushSync, API_BASE, api } from './index.js'
import { DEMO } from '../lib/demo.js'
import { focusTodos, dailyList } from './domain.js'
import { APP_NAME } from '../config.js'

export const theme = ref(localStorage.getItem('swb-theme') || 'light')
// 关键：data-theme 必须「启动即写入 + 每次切换自动同步」。
// 之前只在 toggleTheme 里写，导致重开时 theme 状态与页面 data-theme 不一致 → 点一次反而切成相反主题，要点两次才生效。
// immediate:true 保证模块加载（挂载前）就把当前主题落到 <html>，一次点击即生效。
watch(theme, v => {
  document.documentElement.setAttribute('data-theme', v)
  localStorage.setItem('swb-theme', v)
}, { immediate: true })
export function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}
export const ringOffset = (p) => 314.16 * (1 - p / 100)
export const todayProgress = computed(() => {
  const items = focusTodos.value
  if (!items.length) return 0
  return Math.round(items.filter(i => i.it.isFinish).length / items.length * 100)
})
export const todayTotalTasks = computed(() => focusTodos.value.length)
export const monthDoneToday = computed(() => focusTodos.value.filter(i => i.it.isFinish).length)
export const todayHint = computed(() => `今日已完成 ${monthDoneToday.value}/${todayTotalTasks.value} 项`)
export const dateLine = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 ${['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]}`
})
export const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 5) return '夜深了，早些休息'
  if (h < 11) return '早上好，开启新的一天'
  if (h < 13) return '中午好，记得午休'
  if (h < 18) return '下午好，趁精神不错'
  if (h < 22) return '晚上好，做个收尾'
  return '夜深了，早些休息'
})

export function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${APP_NAME}-${today()}.json`
  a.click()
  notify('已导出 JSON 文件')
}

export function importData(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const r = new FileReader()
  r.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result)
      Object.assign(db, data)
      pushSync()
      notify('数据已导入')
    } catch { notify('文件格式无效') }
  }
  r.readAsText(file)
}

const KEY = 'spring-workbench-v2'
// API_BASE 从 ./index.js 统一导入（那里 re-export 自 lib/api.js），不再各文件重复定义
const emptyState = () => ({
  categories: ['未分类', '学习', '工作', '健康', '运动', '阅读', '生活', '理财'],
  yearPlans: [], monthPlans: [], checkTasks: [], checkins: [], discovers: [], knowledge: [], transactions: [],
  finance: { openingBalance: 0, monthBudget: 0 }
})
export async function clearData() {
  // 第一次确认
  if (!window.confirm('确认要清除所有系统数据吗？\n\n本操作会清空：年/月计划、打卡项、打卡记录、发现、知识、交易、账单设置。\n不可恢复！')) return false
  // 第二次确认（防误触）
  if (!window.confirm('再次确认：真的要删除以上所有数据？')) return false
  // 演示版没有真库：清空只会把本地缓存删掉，之后每次打开都是空站。
  // 这里改成「还原成初始快照」，朋友点坏了也能一键复原
  if (DEMO) {
    try {
      localStorage.removeItem(KEY)
      localStorage.removeItem('swb-demo-side-v1')
    } catch { /* 隐私模式写不进去，忽略 */ }
    notify('演示版已重置为初始数据')
    setTimeout(() => location.reload(), 500)
    return true
  }
  try {
    await api('/api/state', { method: 'DELETE' })
  } catch { /* 后端不可用时仍清本地缓存 */ }
  // 清本地缓存并重置内存数据
  localStorage.removeItem(KEY)
  const fresh = emptyState()
  for (const key of Object.keys(fresh)) {
    if (Array.isArray(db[key])) db[key] = fresh[key]
    else if (typeof fresh[key] === 'object' && fresh[key]) db[key] = fresh[key]
  }
  notify('系统数据已清除')
  return true
}