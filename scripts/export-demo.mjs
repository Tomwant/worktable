// 导出「演示快照」：把本地真库的数据抓成静态 JSON，供 GitHub Pages 只读版使用。
//
// 用法：
//   1. 先起后端（npm run dev:api）和 MySQL
//   2. npm run export:demo
//   3. 产出 demodata/demo/*.json + demodata/uploads/knowledge/*.html
//
// 为什么拆成 5 个文件（不要合并回一个 bundle.json）：
//   GitHub Pages 从国内访问约 30–50 KB/s，131 份报告的正文合计约 1.4MB（gzip 后 538KB），
//   单个 bundle 实测首次要等 40 秒以上，页面长时间空白。拆开后首屏只拉 core.json（约 25KB），
//   知识库正文、AI 时间线、公司详情都等真正进到那个页面才拉。
//
// 设计要点：
//   · 知识库排序（按系列分期）依赖 MySQL 的 SUBSTRING_INDEX，前端复刻不了 ——
//     所以直接让后端以 sort=series 全量返回，把排好的顺序原样落盘。演示层只做切片和关键词过滤。
//   · 列表只带 200 字摘要（字段名仍叫 content，列表卡片的两行摘要逻辑不用改）；
//     完整正文单独放 knowledge-full.json，进知识库后空闲时预取，点「阅读全文」时已经就位。
//   · attachmentUrl 从 `/uploads/...` 改写成 `uploads/...` 相对路径：
//     GitHub Pages 是子路径部署（/repo/），绝对路径会 404 到根域。
//   · 只导出 GET 能拿到的数据，写接口一律不进快照。

import { writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.DEMO_API_BASE || 'http://127.0.0.1:3001'
// 放 public/ 之外：否则正式版构建也会把真实数据打进 dist
const DEMO_DIR = join(ROOT, 'demodata', 'demo')
const KB_SRC = join(ROOT, 'server', 'uploads', 'knowledge')
const KB_DST = join(ROOT, 'demodata', 'uploads', 'knowledge')

// 列表摘要保留多少字：卡片只显示两行，200 字足够，且能让按关键词搜正文时仍然命中
const SUMMARY_CHARS = 200

const get = async path => {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.json()
}

// 子路径部署：绝对路径改相对
const rel = url => (typeof url === 'string' && url.startsWith('/') ? url.slice(1) : url)

const write = (name, data) => {
  const p = join(DEMO_DIR, name)
  const json = JSON.stringify(data)
  writeFileSync(p, json)
  console.log(`[export] ${name.padEnd(22)} ${(json.length / 1024).toFixed(1).padStart(8)} KB`)
  return json.length
}

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
  console.log(`[export] 知识库 ${kbRaw.length} 条（totalAll=${first.totalAll}，${totalPages} 页）`)
  if (kbRaw.length !== first.totalAll) {
    console.warn(`[export] 警告：抓取条数(${kbRaw.length}) 与 totalAll(${first.totalAll}) 不一致`)
  }

  // 列表条目：正文换成摘要，其余字段原样
  const kbList = kbRaw.map(it => {
    const content = typeof it.content === 'string' ? it.content : ''
    return {
      ...it,
      attachmentUrl: rel(it.attachmentUrl),
      content: content.slice(0, SUMMARY_CHARS),
      // 演示层据此判断「正文还没取全」，点开大窗时可以等预取完成
      truncated: content.length > SUMMARY_CHARS
    }
  })

  // 好公司：列表 + 逐家详情（fin/kline 都在详情里）
  const companies = await get('/api/companies')
  const list = companies.items || []
  const details = {}
  for (const c of list) {
    const d = await get(`/api/companies/${encodeURIComponent(c.ticker)}`)
    details[c.ticker] = d.item || d
  }
  console.log(`[export] 好公司 ${list.length} 家`)

  mkdirSync(DEMO_DIR, { recursive: true })

  // ---- 1. 首屏数据：只放首页/打卡/资金/想法要用的，越小越好 ----
  write('core.json', {
    exportedAt: new Date().toISOString(),
    appConfig,
    state,
    transactions,
    finance,
    discovers,
    ideas,
    assets,
    evalOverview,
    evalRuns,
    feedsStatus,
    companies: list,
    // 首页「知识沉淀 N 条」用它，避免为了一个数字先拉整份知识库
    knowledgeCount: kbRaw.length,
    aiEventsCount: (aiEvents.items || []).length
  })

  // ---- 2. 知识库列表（含 200 字摘要）----
  write('knowledge.json', {
    exportedAt: new Date().toISOString(),
    items: kbList
  })

  // ---- 3. 知识库完整正文：按列表顺序分片，每片 30 条 ----
  // 为什么分片：全文合计 1.2MB，国内拉 github.io 要 10 秒上下。
  // 分片后点开任意一条只需拉它所在那一片（约 240KB / gzip 90KB，两三秒），
  // 进知识库页先预取第 0 片，覆盖前 30 条（前三页）通常就够了。
  const SHARD_SIZE = 30
  const shardCount = Math.max(1, Math.ceil(kbRaw.length / SHARD_SIZE))
  for (let i = 0; i < shardCount; i++) {
    const slice = kbRaw.slice(i * SHARD_SIZE, (i + 1) * SHARD_SIZE)
    const bodies = {}
    for (const it of slice) {
      const content = typeof it.content === 'string' ? it.content : ''
      if (content) bodies[String(it.id)] = content
    }
    write(`knowledge-full-${i}.json`, {
      exportedAt: new Date().toISOString(),
      from: i * SHARD_SIZE,
      to: Math.min((i + 1) * SHARD_SIZE, kbRaw.length),
      bodies
    })
  }
  console.log(`[export] 正文分片 ${shardCount} 个（每片 ${SHARD_SIZE} 条）`)
  // 旧版本的单文件，留着会白白多占 1.2MB 仓库体积
  if (existsSync(join(DEMO_DIR, 'knowledge-full.json'))) {
    rmSync(join(DEMO_DIR, 'knowledge-full.json'), { force: true })
    console.log('[export] 已清理旧的 knowledge-full.json')
  }

  // ---- 4. AI 时间线 ----
  write('ai-events.json', {
    exportedAt: new Date().toISOString(),
    items: aiEvents.items || [],
    baseline: aiEvents.baseline || []
  })

  // ---- 5. 公司详情（点开某家才拉）----
  write('company-details.json', {
    exportedAt: new Date().toISOString(),
    items: details
  })

  // 知识库报告 HTML：整目录同步（先清空避免残留已删除的报告）
  if (existsSync(KB_SRC)) {
    if (existsSync(KB_DST)) rmSync(KB_DST, { recursive: true, force: true })
    mkdirSync(KB_DST, { recursive: true })
    let copied = 0
    for (const f of readdirSync(KB_SRC)) {
      if (!f.endsWith('.html')) continue
      copyFileSync(join(KB_SRC, f), join(KB_DST, f))
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
