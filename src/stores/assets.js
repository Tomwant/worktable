// 素材库：用户上传的 Q 版图 + 每个页面的壁纸。
//
// 两件事刻意分开存：
//   · 图片文件 —— 落后端 server/uploads/assets/，登记在 MySQL 表 asset_images。
//     不放 localStorage：base64 一张就几十万字符，5MB 配额装不了几张，而且清缓存就没了。
//   · 壁纸选择 —— 纯前端偏好（哪一页用哪张图），存 localStorage，换设备不影响图片本身。
//
// 内置 6 张官方原片仍然走 assets/yunxiao/index.js 的静态导入（不打接口、离线可用），
// 这里只负责把「内置 + 上传」合并成同一个候选池，供形象位和壁纸挑选。

import { ref, computed } from 'vue'
import { API_BASE, api } from '../lib/api.js'
import { YUNXIAO_FACES } from '../assets/yunxiao/index.js'

/** 页面的稳定 id（与 App.vue 的 nav 一致），壁纸按这个存 */
export const PAGES = [
  { id: 'home', name: '工作台' },
  { id: 'checkin', name: '计划打卡' },
  { id: 'finance', name: '资金管理' },
  { id: 'discover', name: '每日发现' },
  { id: 'ai', name: 'AI 大事' },
  { id: 'knowledge', name: '知识库' },
  { id: 'ideas', name: '奇思妙想' },
  { id: 'company', name: '好公司' },
  { id: 'eval', name: '网页测评' },
  { id: 'assets', name: '素材库' }
]

const WALL_KEY = 'swb-wallpapers'

/** 后端登记的上传素材（原始行） */
export const uploaded = ref([])

/** 上传素材 → 与内置素材同构的形状，这样形象位、壁纸都能直接用 */export function uploadToFace(row) {
  return {
    key: 'up:' + row.id,
    src: API_BASE + row.url,
    label: row.name,
    pos: `50% ${row.posY}%`,
    scale: row.zoom,
    size: row.w && row.h ? `${row.w}×${row.h}` : '自定义',
    note: '我上传的',
    uploadId: row.id
  }
}

/** 候选池：内置 6 张 + 我上传的 */
export const allFaces = computed(() => [...YUNXIAO_FACES, ...uploaded.value.map(uploadToFace)])

/** 按 key 取一条，找不到回落内置第一张 */
export function faceByKey(key) {
  const pool = allFaces.value
  return pool.find(f => f.key === key) || YUNXIAO_FACES[0]
}

export async function loadAssets() {
  const r = await api('/api/assets')
  uploaded.value = Array.isArray(r?.items) ? r.items : []
  return uploaded.value
}

// ===== 上传上限（可改，存后端 app_config 单行表）=====
// 卡片文案、选图拦截、后端校验必须读同一个值，所以页面挂载时拉一次，
// 改完就地写回 ref，不用刷新。后端没起来时退回默认 50，不弹错打扰。
export const assetMaxMb = ref(50)

export async function loadAssetConfig() {
  try {
    const r = await api('/api/app-config')
    const mb = Number(r?.assetMaxMb)
    if (mb > 0) assetMaxMb.value = Math.round(mb)
  } catch { /* 后端未启动，沿用默认值 */ }
  return assetMaxMb.value
}

export async function saveAssetMaxMb(mb) {
  const r = await api('/api/app-config', { method: 'PUT', body: { assetMaxMb: mb } })
  const next = Number(r?.assetMaxMb)
  if (next > 0) assetMaxMb.value = Math.round(next)
  return assetMaxMb.value
}

/** 读本地文件为 dataURL，顺带拿到原始像素尺寸（后端不解析图片） */
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读不到这个文件'))
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const img = new Image()
      img.onload = () => resolve({ dataUrl, w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => reject(new Error('这不是一张能打开的图片'))
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

export async function uploadAsset(file, name) {
  const { dataUrl, w, h } = await readImage(file)
  // 立绘多半脸偏上，竖图默认居中会切掉额头 —— 先给 42%，用户可在素材卡上再调
  const r = await api('/api/assets', { method: 'POST', body: { name: name || file.name.replace(/\.[^.]+$/, ''), dataUrl, w, h, posY: 42, zoom: 1.2 } })
  if (r?.item) uploaded.value = [...uploaded.value, r.item]
  return r?.item
}

export async function patchAsset(id, patch) {
  const r = await api(`/api/assets/${id}`, { method: 'PATCH', body: patch })
  if (r?.item) uploaded.value = uploaded.value.map(x => (x.id === id ? r.item : x))
  return r?.item
}

export async function removeAsset(id) {
  await api(`/api/assets/${id}`, { method: 'DELETE' })
  uploaded.value = uploaded.value.filter(x => x.id !== id)
  // 删掉的图如果正被某页当壁纸，壁纸一起撤掉，避免留一个 404 的背景
  const w = { ...wallpapers.value }
  const dead = Object.entries(w).filter(([, u]) => String(u).includes(`/assets/${id}.`)).map(([k]) => k)
  if (dead.length) {
    dead.forEach(k => delete w[k])
    wallpapers.value = w
  }
}

// ===== 每页壁纸 =====
function loadWalls() {
  try { return JSON.parse(localStorage.getItem(WALL_KEY) || '{}') || {} } catch { return {} }
}

/** pageId → 图片地址 */
export const wallpapers = ref(loadWalls())

export function setWallpaper(pageId, url) {
  wallpapers.value = { ...wallpapers.value, [pageId]: url }
  localStorage.setItem(WALL_KEY, JSON.stringify(wallpapers.value))
}

export function clearWallpaper(pageId) {
  const next = { ...wallpapers.value }
  delete next[pageId]
  wallpapers.value = next
  localStorage.setItem(WALL_KEY, JSON.stringify(next))
}
