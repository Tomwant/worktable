// Q 版形象位映射 —— 「哪个位置放哪张图」的唯一配置源。
//
// 为什么要这一层：
//   之前每处形象位都在组件里写死 face="tuozai"，想换一张就得改代码重新构建。
//   现在页面上所有形象位都登记成 slot，组件只认 slot id，具体用哪张图
//   存在这里（localStorage 持久化），在「素材库」页点一下立刻全站生效。
//
// 刻意不含顶栏导航：导航 pill 太窄，塞头像会糊（18–22px）或把顶栏撑厚（28px+），
// 2026-10-27 定版 —— 导航保持原图标，Q 版只用在页面内容里。
//
// 新增形象位：SLOTS 里加一条 + slotMap 给默认值 + 组件传 slot="xxx"。

import { ref, watch } from 'vue'
import { YUNXIAO_FACES } from '../assets/yunxiao/index.js'
import { allFaces, faceByKey } from './assets.js'

const STORE_KEY = 'swb-yunxiao-slots'

/**
 * 形象位登记表（顺序 = 素材库里的展示顺序）
 *   id     稳定标识，组件里用它
 *   name   素材库显示名
 *   where  用在哪（人能看懂的描述）
 *   px     该位置的显示尺寸，仅用于素材库展示
 */
export const SLOTS = [
  { id: 'page-home',        name: '工作台 · 趋势卡', where: '「近 7 天打卡趋势」右上角', group: '工作台', px: 36 },
  { id: 'home-streak',      name: '工作台 · 连续卡', where: '「连续打卡」右上角',        group: '工作台', px: 36 },
  { id: 'home-knowledge',   name: '工作台 · 沉淀卡', where: '「知识沉淀」右上角',        group: '工作台', px: 36 },
  { id: 'checkin-year',     name: '打卡 · 年计划',   where: '年计划卡标题左侧',          group: '计划打卡', px: 36 },
  { id: 'checkin-month',    name: '打卡 · 月计划',   where: '月计划卡标题左侧',          group: '计划打卡', px: 36 },
  { id: 'checkin-cat',      name: '打卡 · 分类统计', where: '「按分类精确统计」标题左侧', group: '计划打卡', px: 36 },
  { id: 'checkin-daily',    name: '打卡 · 每日打卡', where: '日期勾选卡标题左侧',        group: '计划打卡', px: 36 },
  { id: 'finance-account',  name: '资金 · 账户设置', where: '「账户设置」标题左侧',      group: '资金管理', px: 36 },
  { id: 'finance-add',      name: '资金 · 记一笔',   where: '「记一笔」标题左侧',        group: '资金管理', px: 36 },
  { id: 'finance-trend',    name: '资金 · 收支图',   where: '「近 6 月收支」标题左侧',   group: '资金管理', px: 36 },
  { id: 'finance-pie',      name: '资金 · 支出分布', where: '「本月支出分布」标题左侧',  group: '资金管理', px: 36 },
  { id: 'finance-flow',     name: '资金 · 流水明细', where: '「流水明细」标题左侧',      group: '资金管理', px: 36 },
  { id: 'page-discover',    name: '每日发现',        where: '每日发现的区块标题',        group: '每日发现', px: 36 },
  { id: 'ai-base',          name: 'AI · 能力基线',   where: '「当前能力基线」标题左侧',  group: 'AI 大事', px: 36 },
  { id: 'ai-rhythm',        name: 'AI · 发布节奏',   where: '「近 52 周」标题左侧',      group: 'AI 大事', px: 36 },
  { id: 'page-knowledge',   name: '知识库',          where: '知识库的区块标题',          group: '知识库', px: 36 },
  { id: 'page-ideas',       name: '奇思妙想',        where: '「奇思妙想」标题左侧',      group: '奇思妙想', px: 36 },
  { id: 'page-company',     name: '好公司',          where: '公司页 8 个区块标题左侧',   group: '好公司', px: 36 },
  { id: 'eval-overview',    name: '测评 · 概览',     where: '「测评概览」标题左侧',      group: '网页测评', px: 36 },
  { id: 'eval-matrix',      name: '测评 · 矩阵',     where: '「测评矩阵」标题左侧',      group: '网页测评', px: 36 },
  { id: 'home-focus',       name: '首页 · 今日焦点', where: '工作台右上角的圆形形象位',  group: '工作台', px: 132 },
  { id: 'empty-default',    name: '空态 · 默认形象', where: '各页面「暂无内容」时的小人', group: '全局', px: 96 }
]

/**
 * 出厂默认。
 * 原则：同一页内相邻的区块**不用同一张图** —— 三张卡挂三个一样的头像会像复制粘贴，
 * 反而比不放更单调。所以打卡、资金两页按区块细分，6 张图在页内轮着用。
 * 好公司一页有 8 个区块，6 张图必然复用，就统一给一格。
 */
export const DEFAULT_MAP = {
  'page-home': 'tuozai',
  'home-streak': 'heart',
  'home-knowledge': 'baoxiong',
  'checkin-year': 'tuozai',
  'checkin-month': 'heart',
  'checkin-cat': 'window',
  'checkin-daily': 'baoxiong',
  'finance-account': 'window',
  'finance-add': 'heart',
  'finance-trend': 'cloud',
  'finance-pie': 'window2',
  'finance-flow': 'tuozai',
  'page-discover': 'window2',
  'ai-base': 'cloud',
  'ai-rhythm': 'tuozai',
  'page-knowledge': 'baoxiong',
  'page-ideas': 'heart',
  'page-company': 'window',
  'eval-overview': 'window2',
  'eval-matrix': 'cloud',
  'home-focus': 'tuozai',
  'empty-default': 'baoxiong'
}

function load() {
  const base = { ...DEFAULT_MAP }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw)
    // 只接受登记表里存在的 id/key，防止旧数据或手改 localStorage 带进脏值
    // 上传素材的 key 是 `up:<id>`，此刻 /api/assets 还没回来，不能因为「内置表里没有」就丢掉，
    // 否则每次刷新形象位都会被打回默认（这个坑很隐蔽：看着像没保存）
    const validKey = k => YUNXIAO_FACES.some(f => f.key === k) || /^up:[A-Za-z0-9-]+$/.test(k)
    for (const [id, key] of Object.entries(saved || {})) {
      if (id in base && validKey(key)) base[id] = key
    }
  } catch {
    // 解析失败就用默认值，不让素材库把整个应用带崩
  }
  return base
}

/** 形象位 → 图片 key */
export const slotMap = ref(load())

watch(slotMap, v => localStorage.setItem(STORE_KEY, JSON.stringify(v)), { deep: true })

/** 给某处形象位换图 */
export function setSlot(id, faceKey) {
  if (!(id in DEFAULT_MAP)) return false
  if (!allFaces.value.some(f => f.key === faceKey)) return false
  slotMap.value = { ...slotMap.value, [id]: faceKey }
  return true
}

/**
 * 取某处形象位的完整素材登记（含 src / pos / scale）。
 * 走 faceByKey 而不是内置表：内置 6 张 + 我上传的图是同一个候选池，
 * 上传后立刻能分配给任意形象位，不必改代码。
 */
export function slotFace(id) {
  return faceByKey(slotMap.value[id] || DEFAULT_MAP[id])
}

/** 某张图当前被哪些形象位在用 —— 素材库列表里显示「用在哪」 */
export function slotsUsing(faceKey) {
  return SLOTS.filter(s => (slotMap.value[s.id] || DEFAULT_MAP[s.id]) === faceKey)
}

/** 恢复出厂 */
export function resetSlots() {
  slotMap.value = { ...DEFAULT_MAP }
}
