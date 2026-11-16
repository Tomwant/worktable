// 导出「演示快照」：把本地真库的数据抓成静态 JSON，供 GitHub Pages 只读版使用。
//
// 用法：
//   1. 先起后端（npm run dev:api）和 MySQL
//   2. node scripts/export-demo.mjs
//   3. 产出 public/demo/bundle.json + public/uploads/knowledge/*.html
//
// 设计要点：
//   · 知识库排序（按系列分期）依赖 MySQL 的 SUBSTRING_INDEX，前端复刻不了 ——
//     所以直接让后端以 sort=series 全量返回，把排好的顺序原样落盘。演示层只做切片和关键词过滤。
//   · attachmentUrl 从 `/uploads/...` 改写成 `uploads/...` 相对路径：
//     GitHub Pages 是子路径部署（/repo/），绝对路径会 404 到根域。
//   · 只导出 GET 能拿到的数据，写接口一律不进快照。

import { writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.DEMO_API_BASE || 'http://127.0.0.1:3001'
// 放 public/ 之外：否则正式版构建也会把真实数据打进 dist
const OUT_DIR = join(ROOT, 'demodata', 'demo')
const KB_SRC = join(ROOT, 'server', 'uploads', 'knowledge')
const KB_DST = join(ROOT, 'demodata', 'uploads', 'knowledge')

const get = async path => {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.json()
}

// 子路径部署：绝对路径改相对
const rel = url => (typeof url === 'string' && url.startsWith('/') ? url.slice(1) : url)

const main = async () => {
  console.log(`[export] 数据源 ${BASE}`)

  const [
    state, transactions, finance, discovers, ideas, assets,
    appConfig, aiEvents, evalOverview, evalRuns, feedsStatus
  ] = await Promise.all([
    get('/api/state'),
    get('/api/transactions'),
    get('/api/finance'),
    get('/api/discovers'),
    get('/api/ideas'),
    get('/api/assets'),
    get('/api/app-config'),
    get('/api/ai-events'),
    get('/api/eval/overview'),
    get('/api/eval/runs'),
    get('/api/knowledge/feeds-status')
  ])

  // 知识库：后端 pageSize 上限 100，必须翻页拉全（131 条 = 2 页）
  // 用 sort=series 让后端把「按系列分期」的复杂排序算好，演示层直接沿用这个顺序
  const KB_PAGE = 100
  const first = await get(`/api/knowledge?page=1&pageSize=${KB_PAGE}&sort=series`)
  const kbRaw = [...(first.items || [])]
  const totalPages = first.totalPages || 1
  for (let p = 2; p <= totalPages; p++) {
    const next = await get(`/api/knowledge?page=${p}&pageSize=${KB_PAGE}&sort=series`)
    kbRaw.push(...(next.items || []))
  }
  const kbItems = kbRaw.map(it => ({ ...it, attachmentUrl: rel(it.attachmentUrl) }))
  console.log(`[export] 知识库 ${kbItems.length} 条（totalAll=${first.totalAll}，${totalPages} 页）`)
  if (kbItems.length !== first.totalAll) {
    console.warn(`[export] 警告：抓取条数(${kbItems.length}) 与 totalAll(${first.totalAll}) 不一致`)
  }

  // 好公司：列表 + 逐家详情（fin/kline 都在详情里）
  const companies = await get('/api/companies')
  const list = companies.items || []
  const details = {}
  for (const c of list) {
    const d = await get(`/api/companies/${encodeURIComponent(c.ticker)}`)
    const item = d.item || d
    // 详情里的链接/官网保持原样；只有本地静态资源需要改相对路径
    details[c.ticker] = item
  }
  console.log(`[export] 好公司 ${list.length} 家`)

  const bundle = {
    exportedAt: new Date().toISOString(),
    appConfig,
    state,
    transactions,
    finance,
    discovers,
    ideas,
    assets,
    aiEvents,
    evalOverview,
    evalRuns,
    feedsStatus,
    companies: list,
    companyDetails: details,
    // facets 由演示层按全量现算，这里只存条目
    knowledge: kbItems
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const bundlePath = join(OUT_DIR, 'bundle.json')
  const json = JSON.stringify(bundle)
  writeFileSync(bundlePath, json)
  console.log(`[export] bundle.json  ${(json.length / 1024).toFixed(0)} KB`)

  // 知识库报告 HTML：整目录同步（先清空避免残留已删除的报告）
  if (existsSync(KB_SRC)) {
    if (existsSync(KB_DST)) rmSync(KB_DST, { recursive: true, force: true })
    mkdirSync(KB_DST, { recursive: true })
    let copied = 0
    for (const f of readdirSync(KB_SRC)) {
      const src = join(KB_SRC, f)
      if (!f.endsWith('.html')) continue
      copyFileSync(src, join(KB_DST, f))
      copied++
    }
    console.log(`[export] 拷贝报告 HTML ${copied} 个 -> demodata/uploads/knowledge/`)
  } else {
    console.warn('[export] 警告：找不到 server/uploads/knowledge，报告正文预览会 404')
  }

  console.log('[export] 完成')
}

main().catch(e => {
  console.error('[export] 失败：', e.message)
  console.error('  确认后端已启动（npm run dev:api），且 MySQL 可连接。')
  process.exit(1)
})
