import 'dotenv/config.js'
import express from 'express'
import mysql from 'mysql2/promise'
import multer from 'multer'
import fs from 'node:fs'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importHtml } from './htmlImport.js'
import { buildCompany, refreshQuoteOnly, normTicker } from './company-fetch.js'

// 品牌名唯一来源：根目录 app.config.json（读取失败时回退，绝不影响服务启动）
const appName = (() => { try { return JSON.parse(fs.readFileSync(new URL('../app.config.json', import.meta.url), 'utf8')).name } catch { return '工作台' } })()

const port = Number(process.env.PORT || 3001)
const database = process.env.MYSQL_DATABASE || 'spring_workbench'
const databaseId = `\`${database.replace(/`/g, '')}\``
const config = { host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '', charset: 'utf8mb4' }
// 上传目录（knowledge 报告原稿与内嵌图片的落盘根目录）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadsRoot = path.join(__dirname, 'uploads')
// ===== 每日发现收件箱：定时任务投递 JSON，工作台启动/轮询时消费 =====
// 定时任务只写文件（写完即成功，不依赖工作台在线）；成功入库后才归档，失败留在原地等下次 → 天然幂等、离线不丢
const inboxRoot = path.resolve(process.env.DISCOVER_INBOX || 'D:/spring-workbench/inbox')
const inboxArchive = path.join(inboxRoot, 'archive')
const inboxPollMs = Number(process.env.DISCOVER_POLL_MS || 60000)
// 定时任务产出目录的轮询间隔（默认 1 分钟；设为 0 则只在启动时扫一次）
// 原来是 5 分钟，但任务本身带 8 分钟左右的随机延迟，两者叠加会让「任务写完 → 工作台能看到」拖到 15 分钟。
// 每个目录只做 readdir + stat（用 mtime 判重，不读正文），1 分钟的代价可以忽略。
const outputPollMs = Number(process.env.OUTPUT_POLL_MS || 60000)
// AI 大事的文件投放目录：定时任务只往这里写 JSON，后端扫进来入库。
// 为什么不让任务直接调 POST /api/ai-events：任务跑的那一刻服务未必开着，直连就白跑一次；
// 写文件不会丢，服务起来后补进去即可（和知识库那批报告一个思路）。
const aiEventDir = path.resolve(process.env.AI_EVENT_DIR || path.join(process.env.REPORT_DIR || 'D:/spring-workbench/reports', 'ai-events'))


// ===== 启动初始化：连接 MySQL、建库、建表（带可读错误提示与可选重试，防止环境未就绪时裸崩溃） =====
const RETRY_MAX = 3
const RETRY_DELAY_MS = 2000
const retryEnabled = () => ['1', 'true', 'yes'].includes(String(process.env.RETRY || '').toLowerCase())
const red = text => process.stderr.isTTY ? `\x1b[31m${text}\x1b[0m` : text
const isConnectError = error => {
  if (!error) return false
  const code = String(error.code || '')
  const message = String(error.message || '')
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|PROTOCOL_CONNECTION_LOST/.test(`${code} ${message}`) || error.name === 'AggregateError'
}
const isAuthError = error => !!error && String(error.code || '') === 'ER_ACCESS_DENIED_ERROR'

// ===== 奇思妙想（idea + 阶段台阶）=====
// 阶段和成果都放在 steps_json 里：阶数可以几十个，也不需要额外建表
const IDEA_DEFAULT_STEPS = ['灵感', '验证', '雏形', '推进', '落地']
const blankSteps = () => IDEA_DEFAULT_STEPS.map(n => ({ name: n, done: false, results: [] }))
const ideaRow = r => ({
  id: r.id, name: r.name, pitch: r.pitch || '',
  steps: parse(r.steps_json) || [],
  createTime: Number(r.create_time), updateTime: Number(r.update_time)
})
// 首次启动灌 4 条（「人生长视频动画」是用户的真实想法，18 阶，用来演示长阶梯折叠）
const seedIdeas = async conn => {
  const LONG = ['灵感', '找参考', '定形式', '写提纲', '采素材', '访谈家人', '写脚本', '画分镜', '画风测试', '配音试录', '一分钟样片', '内部评审', '算成本', '全片制作', '配乐', '调色剪辑', '试映', '发布']
  const mk = (names, doneCount, flags) => names.map((n, i) => ({
    name: n,
    done: i < doneCount,
    results: (flags[i] || []).map(t => (typeof t === 'string' ? { text: t } : t))
  }))
  const seeds = [
    {
      name: '人生长视频动画',
      pitch: '把一个人的一生做成 10–60 分钟的动画长片，而不是 30 秒的体验卡。',
      steps: mk(LONG, 9, {
        0: ['抖音上的「一日人生体验卡」全是短视频，10 分钟以上的长版本是空档'],
        1: [{ text: '看了《人生七年》和三部手绘传记，确认这条路有人走通过', tag: '4 部' }],
        2: [{ text: '形式定了：12 分钟，水墨 + 旁白，不做全流程动画', tag: '12 分钟' }],
        3: [{ text: '提纲 8 幕：出生 / 上学 / 搬家 / 高考 / 第一份工作 / 结婚 / 低谷 / 现在', tag: '8 幕' }],
        4: [{ text: '从家里翻出 300 张照片和 4 盘旧磁带', tag: '300 张' }],
        5: [{ text: '访谈爸妈各 1 小时，录到 12 个没听过的细节', tag: '12 个' }],
        6: [{ text: '脚本一稿 3200 字，念一遍 11 分半', tag: '3200 字' }],
        7: [{ text: '分镜 60 格，每格标了镜头时长', tag: '60 格' }],
        8: [{ text: '试了水墨、剪纸、蜡笔三种，选水墨（成本最低）', tag: '水墨' }]
      })
    },
    {
      name: '工作日早餐自动化',
      pitch: '早上 7 点不用想，20 秒出锅。',
      steps: mk(IDEA_DEFAULT_STEPS, 3, {
        0: ['把「早上没胃口」拆成三种真实场景'],
        1: [{ text: '参考 12 个菜谱，筛出 5 个 20 分钟内能做的', tag: '5 个' }],
        2: [{ text: '周末一次备料，够工作日五天', tag: '5 天' }]
      })
    },
    {
      name: '旧照片 AI 修复小站',
      pitch: '把家里 2000 张老照片救回来，别等它自己发黄。',
      steps: mk(IDEA_DEFAULT_STEPS, 2, {
        0: ['先问了 6 个亲戚，都说愿意翻影集'],
        1: [{ text: '修了 30 张试手，七成能看', tag: '30 张' }]
      })
    },
    {
      name: '通勤播客剪辑流',
      pitch: '地铁 40 分钟，剪完一期就走。',
      steps: mk(IDEA_DEFAULT_STEPS, 5, {
        0: ['通勤时间其实足够剪 20 分钟素材'],
        1: [{ text: '拿 3 期旧素材试剪，平均 35 分钟', tag: '3 期' }],
        2: [{ text: '做了一套手机端快捷键，闭眼能按', tag: '快捷键' }],
        3: [{ text: '连续 4 周周更没断', tag: '4 周' }],
        4: [{ text: '上了小宇宙，第一月 800 播放', tag: '800' }]
      })
    }
  ]
  const now = Date.now()
  let i = 0
  for (const s of seeds) {
    await conn.execute(
      'INSERT INTO ideas (id, name, pitch, steps_json, sort_no, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [`${now}-${i}-seed`, s.name, s.pitch, JSON.stringify(s.steps), i, now + i, now + i]
    )
    i++
  }
}

// ===== AI 今日大事：五家主流模型的时间线 + 当前能力基线 =====
// 主键用「日期-模型-版本名哈希」拼出来，是稳定的：同一条更新被每日任务重复投递时，
// 既会命中主键也会命中唯一键 (event_date, model, version)，走 UPDATE 而不是插出重复卡片。
const AI_MODELS = ['openai', 'claude', 'deepseek', 'kimi', 'gemini']
const AI_WEIGHTS = ['major', 'normal', 'minor']
const sha8 = text => crypto.createHash('md5').update(String(text)).digest('hex').slice(0, 16)
const aiEventRow = r => ({
  id: r.id, date: r.event_date, model: r.model, version: r.version, weight: r.weight,
  title: r.title, what: r.what_text || '', why: r.why_text || '', more: r.more_text || '',
  tags: parse(r.tags_json) || [], caps: parse(r.caps_json) || [],
  srcName: r.src_name || '', srcUrl: r.src_url || '', srcType: r.src_type || 'media',
  checkedAt: r.checked_at || '', origin: r.origin,
  createTime: Number(r.create_time), updateTime: Number(r.update_time)
})
const aiBaselineRow = r => ({ k: r.k, model: r.model, gap: Number(r.gap) || 0, vhtml: r.vhtml, lastDate: r.last_date, who: r.who, sortNo: Number(r.sort_no) || 0 })

const upsertAiEvent = async (conn, e, fallbackCheckedAt) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || '')) ? String(e.date) : ''
  if (!date) throw new Error('事件日期格式应为 YYYY-MM-DD')
  if (!AI_MODELS.includes(e.model)) throw new Error(`未知模型：${e.model}`)
  const version = String(e.version || '').trim().slice(0, 128)
  if (!version) throw new Error('缺少版本名')
  const tags = (Array.isArray(e.tags) ? e.tags : []).map(String).slice(0, 8)
  const caps = (Array.isArray(e.caps) ? e.caps : []).map(String).slice(0, 12)
  const checkedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(e.checkedAt || '')) ? String(e.checkedAt) : (fallbackCheckedAt || null)
  const id = `${date}-${e.model}-${sha8(version)}`
  const now = Date.now()
  await conn.execute(
    `INSERT INTO ai_events (id, event_date, model, version, weight, title, what_text, why_text, more_text, tags_json, caps_json, src_name, src_url, src_type, checked_at, origin, create_time, update_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE weight=VALUES(weight), title=VALUES(title), what_text=VALUES(what_text), why_text=VALUES(why_text), more_text=VALUES(more_text), tags_json=VALUES(tags_json), caps_json=VALUES(caps_json), src_name=VALUES(src_name), src_url=VALUES(src_url), src_type=VALUES(src_type), checked_at=VALUES(checked_at), update_time=VALUES(update_time)`,
    [id, date, e.model, version, AI_WEIGHTS.includes(e.weight) ? e.weight : 'normal',
      String(e.title || version).slice(0, 255), String(e.what || ''), String(e.why || ''), String(e.more || ''),
      JSON.stringify(tags), JSON.stringify(caps),
      String(e.srcName || '').slice(0, 255), String(e.srcUrl || '').slice(0, 500),
      e.srcType === 'off' ? 'off' : 'media', checkedAt, String(e.origin || 'manual').slice(0, 16), now, now]
  )
  return id
}

// 初始快照：2026-10-26 逐条核过的近一年 59 条 + 一年前 4 条简卡。只在空表时灌一次。
const seedAiEvents = async conn => {
  let seed
  try { seed = JSON.parse(fs.readFileSync(new URL('./ai-seed.json', import.meta.url), 'utf8')) } catch (error) {
    console.error(`[AI 时间线] 种子文件读取失败：${error.message}`)
    return
  }
  let n = 0
  for (const e of seed.events || []) { await upsertAiEvent(conn, e, seed.checkedAt); n++ }
  for (const b of seed.baseline || []) {
    await conn.execute(
      'INSERT INTO ai_baseline (k, model, gap, vhtml, last_date, who, sort_no) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE model=VALUES(model), gap=VALUES(gap), vhtml=VALUES(vhtml), last_date=VALUES(last_date), who=VALUES(who), sort_no=VALUES(sort_no)',
      [String(b.k).slice(0, 32), b.model, b.gap ? 1 : 0, String(b.vhtml).slice(0, 500), b.lastDate, String(b.who).slice(0, 64), Number(b.sortNo) || 0]
    )
  }
  console.log(`[AI 时间线] 已灌入初始快照 ${n} 条`)
}

// 好公司初始四家：数据是抓取时的真实快照，业务描述与历史沿革是手工整理的（抓不到）
const seedCompanies = async conn => {
  let seed
  try { seed = JSON.parse(fs.readFileSync(new URL('./companies-seed.json', import.meta.url), 'utf8')) } catch (error) {
    console.error(`[好公司] 种子文件读取失败：${error.message}`)
    return
  }
  const now = Date.now()
  let n = 0
  for (const c of seed.items || []) {
    if (!c || !c.ticker) continue
    await conn.execute(
      'INSERT INTO companies (ticker, name_cn, name_en, cik, secid, exchange, sector, biz, segments_json, history_json, notes_json, quote_json, fin_json, kline_json, sort_no, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name_cn=VALUES(name_cn), name_en=VALUES(name_en), cik=VALUES(cik), secid=VALUES(secid), exchange=VALUES(exchange), quote_json=VALUES(quote_json), fin_json=VALUES(fin_json), kline_json=VALUES(kline_json)',
      [String(c.ticker).slice(0, 16), String(c.nameCn || '').slice(0, 100), String(c.nameEn || '').slice(0, 200),
       String(c.cik || ''), String(c.secid || ''), String(c.exchange || ''), String(c.sector || ''),
       String(c.biz || ''), JSON.stringify(c.segments || []), JSON.stringify(c.history || []),
       JSON.stringify(c.notes || {}), JSON.stringify(c.quote || null),
       JSON.stringify(c.fin || []), JSON.stringify(c.kline || []), n, now, now]
    )
    n++
  }
  console.log(`[好公司] 已灌入初始 ${n} 家`)
}

// 网页测评的初始骨架：7 个常见 AI 网站 + 7 条可复用的测试任务。
// 只给「测谁 / 测什么」，**不造任何评测记录** —— 分数必须是真的测出来的，
// 预置假分数会让人分不清哪些是自己测的。
const seedEvalBase = async conn => {
  const now = Date.now()
  const products = [
    { name: 'DeepSeek', url: 'chat.deepseek.com', tag: '国内', color: '#4d6bfe' },
    { name: 'Kimi', url: 'kimi.moonshot.cn', tag: '国内', color: '#1f2430' },
    { name: '豆包', url: 'doubao.com', tag: '国内', color: '#3b7cff' },
    { name: '通义千问', url: 'tongyi.aliyun.com', tag: '国内', color: '#6b5ce7' },
    { name: 'ChatGPT', url: 'chatgpt.com', tag: '海外', color: '#10a37f' },
    { name: 'Claude', url: 'claude.ai', tag: '海外', color: '#c96442' },
    { name: 'Gemini', url: 'gemini.google.com', tag: '海外', color: '#4285f4' }
  ]
  let i = 0
  for (const p of products) {
    await conn.execute(
      'INSERT INTO eval_products (id, name, url, tag, color, memo, sort_no, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [`p${now}-${i}`, p.name, p.url, p.tag, p.color, '', i, now]
    )
    i++
  }
  const tasks = [
    { name: '长文摘要', brief: '2000 字文章压到 200 字，不许丢数字', prompt: '把下面这篇文章压缩到 200 字以内。要求：保留所有关键数字和结论，不要评价，不要加"本文讲述了"这类开头。\n\n[粘贴文章]' },
    { name: '代码改写', brief: 'Python 脚本转 TypeScript 并补类型', prompt: '把下面的 Python 脚本改写成 TypeScript，保持行为一致，给所有函数补上参数和返回值类型，不要引入新依赖。\n\n[粘贴代码]' },
    { name: '中文文案', brief: '一条产品卖点写 300 字，别用"赋能"', prompt: '给这个产品写一条 300 字左右的卖点文案。要求：说人话，不堆形容词，不许出现"赋能""闭环""抓手"这类词。\n\n产品：[填写]' },
    { name: '表格抽取', brief: '截图里的表格转成 Markdown', prompt: '把图片里的表格转成 Markdown 表格，合并单元格请拆开展平，最后核对一遍合计是否对得上。' },
    { name: '多轮追问', brief: '同一话题追问 5 轮，看会不会跑偏', prompt: '（这个任务不用提示词：连续追问 5 轮，第 3 轮起故意改一次设定，看它记不记得住之前的约束）' },
    { name: '长文档理解', brief: '上传 30 页 PDF，提 5 条要点', prompt: '读完这份文档，给我 5 条最重要的要点，每条不超过 30 字，按重要性排序，只说文档里有的。' },
    { name: '图像理解', brief: '看一张营收图，说出趋势和拐点', prompt: '看这张图，说出整体趋势、增速变化的拐点在哪一年，以及你最不确定的地方是什么。' }
  ]
  i = 0
  for (const t of tasks) {
    await conn.execute(
      'INSERT INTO eval_tasks (id, name, brief, prompt, sort_no, create_time) VALUES (?, ?, ?, ?, ?, ?)',
      [`t${now}-${i}`, t.name, t.brief, t.prompt, i, now]
    )
    i++
  }
  console.log(`[网页测评] 已灌入初始 ${products.length} 个产品 / ${tasks.length} 条任务（不含评测记录）`)
}

const initDatabase = async () => {
  // 第 1 阶段：连接 MySQL 服务（可选：RETRY=1 时最多重试 3 次，每次间隔 2 秒）
  let root = null
  for (let attempt = 1; attempt <= 1 + RETRY_MAX; attempt++) {
    try {
      root = await mysql.createConnection(config)
      break
    } catch (error) {
      const canRetry = retryEnabled() && attempt <= RETRY_MAX && isConnectError(error)
      if (!canRetry) throw error
      console.error(`[MySQL] 第 ${attempt} 次连接失败（${error.code || error.message}），${RETRY_DELAY_MS / 1000} 秒后重试（剩余 ${RETRY_MAX - attempt} 次）…`)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
  // 第 2 阶段：建库（失败时关闭 root 连接，不留半开连接）
  try {
    await root.query(`CREATE DATABASE IF NOT EXISTS ${databaseId} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await root.end()
    root = null
  } catch (error) {
    if (root) await root.end().catch(() => {})
    throw error
  }
  // 第 3 阶段：创建连接池并完成建表/迁移/种子（失败时关闭连接池，不留半开连接）
  const p = mysql.createPool({ ...config, database, waitForConnections: true, connectionLimit: 5, timezone: 'Z', dateStrings: true })
  try {
    for (const statement of [
      'CREATE TABLE IF NOT EXISTS year_plans (id VARCHAR(64) PRIMARY KEY, year INT NOT NULL, name VARCHAR(255) NOT NULL, category VARCHAR(64) NOT NULL DEFAULT \'未分类\', description TEXT, create_time BIGINT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS month_plans (id VARCHAR(64) PRIMARY KEY, year_plan_id VARCHAR(64) NULL, year INT NOT NULL, month INT NOT NULL, name VARCHAR(255) NOT NULL, category VARCHAR(64) NOT NULL DEFAULT \'未分类\', description TEXT, create_time BIGINT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS check_tasks (id VARCHAR(64) PRIMARY KEY, month_plan_id VARCHAR(64) NOT NULL, name VARCHAR(255) NOT NULL, category VARCHAR(64) NOT NULL DEFAULT \'未分类\', create_time BIGINT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS categories (name VARCHAR(64) PRIMARY KEY)',
      'CREATE TABLE IF NOT EXISTS daily_checkins (id VARCHAR(64) PRIMARY KEY, check_date DATE UNIQUE NOT NULL, items_json JSON NOT NULL, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS daily_discovers (id VARCHAR(64) PRIMARY KEY, record_date DATE NOT NULL, title VARCHAR(255) NOT NULL, source VARCHAR(255), series VARCHAR(32) NULL, period INT NULL, link TEXT, content LONGTEXT NOT NULL, tags_json JSON NOT NULL, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL, KEY idx_disc_date (record_date))',
      "CREATE TABLE IF NOT EXISTS knowledge_entries (id VARCHAR(64) PRIMARY KEY, source ENUM('checkin','discover') NOT NULL, source_id VARCHAR(128) NOT NULL, title VARCHAR(255) NOT NULL, content LONGTEXT NOT NULL, tags_json JSON NOT NULL, origin_date DATE NOT NULL, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS transactions (id VARCHAR(64) PRIMARY KEY, type ENUM('income','expense') NOT NULL, amount DECIMAL(14,2) NOT NULL, record_date DATE NOT NULL, category VARCHAR(64) NOT NULL, note VARCHAR(500), create_time BIGINT NOT NULL)",
      'CREATE TABLE IF NOT EXISTS finance_config (id TINYINT PRIMARY KEY, opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0, month_budget DECIMAL(14,2) NOT NULL DEFAULT 0)',
      // 奇思妙想：一个 idea 一条记录，阶段与成果都在 steps_json 里（阶数可变，几十阶也不改表）
      'CREATE TABLE IF NOT EXISTS ideas (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, pitch VARCHAR(500) NULL, steps_json JSON NOT NULL, sort_no INT NOT NULL DEFAULT 0, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL)',
      // AI 今日大事：一条更新一条记录。唯一键 (日期+模型+版本) 让每日任务可以无脑 upsert，重复写入不会产生重复卡片。
      "CREATE TABLE IF NOT EXISTS ai_events (id VARCHAR(64) PRIMARY KEY, event_date DATE NOT NULL, model VARCHAR(16) NOT NULL, version VARCHAR(128) NOT NULL, weight ENUM('major','normal','minor') NOT NULL DEFAULT 'normal', title VARCHAR(255) NOT NULL, what_text TEXT, why_text TEXT, more_text TEXT, tags_json JSON NOT NULL, caps_json JSON, src_name VARCHAR(255) NULL, src_url VARCHAR(500) NULL, src_type ENUM('off','media') NOT NULL DEFAULT 'media', checked_at DATE NULL, origin VARCHAR(16) NOT NULL DEFAULT 'seed', create_time BIGINT NOT NULL, update_time BIGINT NOT NULL, UNIQUE KEY uk_ai_event (event_date, model, version), KEY idx_ai_date (event_date))",
      // 当前能力基线：不是新闻，是「现在这一行能力能做到什么」，人工/任务维护，点一行跳到改写它的那次更新
      'CREATE TABLE IF NOT EXISTS ai_baseline (k VARCHAR(32) PRIMARY KEY, model VARCHAR(16) NOT NULL, gap TINYINT NOT NULL DEFAULT 0, vhtml VARCHAR(500) NOT NULL, last_date DATE NOT NULL, who VARCHAR(64) NOT NULL, sort_no INT NOT NULL DEFAULT 0)',
      // 好公司：一家公司一条记录。财报十来年、五年月线都放 JSON 里（单家约 6KB），不拆子表，读写都简单。
      // ticker 做主键：同一只股票重复添加就是覆盖刷新，不会出现两条一样的。
      "CREATE TABLE IF NOT EXISTS companies (ticker VARCHAR(16) PRIMARY KEY, name_cn VARCHAR(100) NULL, name_en VARCHAR(200) NULL, cik VARCHAR(12) NULL, secid VARCHAR(24) NULL, exchange VARCHAR(16) NULL, sector VARCHAR(100) NULL, biz TEXT NULL, segments_json JSON NULL, history_json JSON NULL, notes_json JSON NULL, quote_json JSON NULL, fin_json LONGTEXT NULL, kline_json LONGTEXT NULL, sort_no INT NOT NULL DEFAULT 0, create_time BIGINT NOT NULL, update_time BIGINT NOT NULL)",
      // 素材库：用户自己上传的 Q 版图（内置 6 张官方原片走前端静态导入，不入库）
      // pos_y / zoom 是「圆形裁切」的构图参数：立绘多半脸偏上，竖图直接居中会切掉额头
      'CREATE TABLE IF NOT EXISTS asset_images (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, url VARCHAR(500) NOT NULL, w INT NOT NULL DEFAULT 0, h INT NOT NULL DEFAULT 0, pos_y TINYINT NOT NULL DEFAULT 50, zoom DECIMAL(4,2) NOT NULL DEFAULT 1.20, create_time BIGINT NOT NULL)',
      // 应用级配置：单行（id=1）。目前只存素材上传上限，用户可以在素材库页面直接改，
      // 所以不能写成代码常量 —— 前端提示、前端拦截、后端校验三处都读这张表。
      'CREATE TABLE IF NOT EXISTS app_config (id TINYINT PRIMARY KEY, asset_max_mb INT NOT NULL DEFAULT 50)',
      // 一次性标记位（k/v）。目前只存 eval_seeded：网页测评的初始骨架灌过一次就不再灌，
      // 否则用户把预置产品全删掉之后，每次重启都会被「空表就灌」的逻辑复活一遍。
      'CREATE TABLE IF NOT EXISTS app_meta (k VARCHAR(64) PRIMARY KEY, v VARCHAR(255) NULL, create_time BIGINT NOT NULL)',
      // 网页测评 · 被测对象：一个 AI 网站一条。用户自己增删，不硬编码在前端。
      'CREATE TABLE IF NOT EXISTS eval_products (id VARCHAR(64) PRIMARY KEY, name VARCHAR(120) NOT NULL, url VARCHAR(300) NULL, tag VARCHAR(32) NULL, color VARCHAR(16) NULL, memo VARCHAR(500) NULL, sort_no INT NOT NULL DEFAULT 0, create_time BIGINT NOT NULL)',
      // 网页测评 · 测试任务：题目 + 默认提示词。跨产品复用，同一道题才能横着比。
      'CREATE TABLE IF NOT EXISTS eval_tasks (id VARCHAR(64) PRIMARY KEY, name VARCHAR(120) NOT NULL, brief VARCHAR(500) NULL, prompt TEXT NULL, sort_no INT NOT NULL DEFAULT 0, create_time BIGINT NOT NULL)',
      // 网页测评 · 评测记录：唯一事实来源。一格可以有多条（复测），矩阵显示最新一条、角标显示次数，
      // 历史一条不删 —— 所以绝不在这张表上做「同一格唯一」的约束。
      'CREATE TABLE IF NOT EXISTS eval_runs (id VARCHAR(64) PRIMARY KEY, product_id VARCHAR(64) NOT NULL, task_id VARCHAR(64) NOT NULL, score TINYINT NOT NULL, good_json JSON NULL, bad_json JSON NULL, seconds INT NOT NULL DEFAULT 0, prompt TEXT NULL, answer LONGTEXT NULL, note VARCHAR(500) NULL, run_date DATE NOT NULL, create_time BIGINT NOT NULL, KEY idx_eval_cell (product_id, task_id), KEY idx_eval_time (create_time))'
    ]) await p.query(statement)
    // 迁移：旧表可能缺少 category 列（MySQL 不支持 ADD COLUMN IF NOT EXISTS，故先探测）
    const ensureColumn = async (table, column, ddl) => {
      const [[col]] = await p.query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [database, table, column])
      if (!col || !col.n) await p.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
    }
    await ensureColumn('year_plans', 'category', "category VARCHAR(64) NOT NULL DEFAULT '未分类'")
    await ensureColumn('month_plans', 'category', "category VARCHAR(64) NOT NULL DEFAULT '未分类'")
    await ensureColumn('check_tasks', 'category', "category VARCHAR(64) NOT NULL DEFAULT '未分类'")
    // knowledge_entries.source 增加 'import' 枚举值（幂等：先探测 COLUMN_TYPE 是否已含 import）
    const [[sourceCol]] = await p.query(`SELECT COLUMN_TYPE AS columnType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'knowledge_entries' AND COLUMN_NAME = 'source'`, [database])
    if (sourceCol && !/import/.test(sourceCol.columnType || '')) await p.query("ALTER TABLE knowledge_entries MODIFY COLUMN source ENUM('checkin','discover','import') NOT NULL")
    // knowledge_entries 新增附件列（导入 HTML 报告时记录原稿地址与类型）
    await ensureColumn('knowledge_entries', 'attachment_url', 'attachment_url VARCHAR(500) NULL')
    await ensureColumn('knowledge_entries', 'attachment_type', 'attachment_type VARCHAR(32) NULL')
    // 导入时用户填写的「来源」标签（source 恒为 'import' 仅表数据来源，用户来源存 source_label）
    await ensureColumn('knowledge_entries', 'source_label', 'source_label VARCHAR(255) NULL')
    // 记录源文件修改时间：同步时据此判重（按内容长度不可靠——emoji 在 JS 算 2 字符、MySQL 算 1 字符）
    await ensureColumn('knowledge_entries', 'source_mtime', 'source_mtime BIGINT NULL')
    // 好公司：公司档案（官网/年报链接）、研究备忘、上次财报抓取时间
    // update_time 会被每日行情刷新频繁改动，不能用来判断「财报是不是旧的」，所以单独记一列
    await ensureColumn('companies', 'info_json', 'info_json LONGTEXT NULL')
    await ensureColumn('companies', 'memo_json', 'memo_json LONGTEXT NULL')
    await ensureColumn('companies', 'fin_sync_at', 'fin_sync_at BIGINT NULL')
    await p.query("INSERT IGNORE INTO finance_config (id, opening_balance, month_budget) VALUES (1, 0, 0)")
    for (const c of ['未分类', '学习', '工作', '健康', '运动', '阅读', '生活', '理财']) await p.query('INSERT IGNORE INTO categories (name) VALUES (?)', [c])
  // —— 四处「初始骨架」统一走 seedOnce：灌过一次就打标记，之后再也不灌 ——
  // 不能再用「表为空就灌」：用户把预置数据全删掉是正常操作，那样每次重启都会原样复活，
  // 甚至以新 id 再插一份（网页测评 2026-11-04 踩过：7 个产品复活 + 任务变 14 条）。
  // tables 传多个表时要求全部为空才算首次；老库升级上来（有数据、没标记）只补标记，绝不重灌。
  const seedOnce = async (key, tables, seedFn) => {
    const [[hit]] = await p.query('SELECT v FROM app_meta WHERE k = ? LIMIT 1', [key])
    if (hit) return
    let allEmpty = true
    for (const t of tables) {
      const [[row]] = await p.query(`SELECT COUNT(*) AS n FROM ${t}`)
      if (row && row.n) { allEmpty = false; break }
    }
    if (allEmpty) await seedFn(p)
    await p.execute(
      'INSERT INTO app_meta (k, v, create_time) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
      [key, '1', Date.now()]
    )
  }
  // 奇思妙想的初始数据：用户删空后重启不再复活
  await seedOnce('seed:ideas', ['ideas'], seedIdeas)
  // AI 今日大事的初始快照
  await seedOnce('seed:ai_events', ['ai_events'], seedAiEvents)
  // 好公司的初始四家（特斯拉/苹果/英伟达/微软）
  await seedOnce('seed:companies', ['companies'], seedCompanies)
  // 网页测评的初始骨架：只灌「测谁 / 测什么」，评测记录一条不造
  await seedOnce('eval_seeded', ['eval_products', 'eval_tasks'], seedEvalBase)
  } catch (error) {
    await p.end().catch(() => {})
    throw error
  }
  return p
}

let pool
try {
  pool = await initDatabase()
} catch (error) {
  const connectFailed = isConnectError(error)
  const authFailed = isAuthError(error)
  console.error('')
  console.error(red('=========================================================='))
  console.error(red(`✖ ${appName} 启动失败：MySQL 初始化未完成。`))
  if (connectFailed) {
    console.error(red(`  错误：连接 MySQL 失败（${error.code || error.name || '未知错误'}）。`))
    console.error(red('  原因：MySQL 服务未启动 / 未就绪，或主机、端口不可达。'))
    console.error(red(''))
    console.error(red('  请先启动 MySQL，再重新运行 npm run dev：'))
    console.error(red('    ① 打开「小皮面板(phpstudy_pro)」→ MySQL 5.7.26 → 点击【启动】；'))
    console.error(red('    ② 或手动启动服务：以管理员身份运行  net start mysql  或  mysqld；'))
    console.error(red('    ③ 若配置不同，请核对 .env 中的 MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD。'))
    console.error(red(''))
    console.error(red('  提示：可设置环境变量 RETRY=1 自动重试（最多 3 次、间隔 2 秒）。'))
  } else if (authFailed) {
    console.error(red('  错误：MySQL 拒绝了当前账号密码（ER_ACCESS_DENIED_ERROR）。'))
    console.error(red('  请核对 .env 中 MYSQL_USER / MYSQL_PASSWORD 是否与数据库一致。'))
  } else {
    console.error(`  错误详情：${error && error.message ? error.message : error}`)
    console.error(red('  请检查 MySQL 账号权限、数据库 spring_workbench 及表结构是否正常。'))
  }
  console.error(red('=========================================================='))
  process.exit(1)
}

const queryRows = async table => (await pool.query(`SELECT * FROM ${table}`))[0]
const parse = value => typeof value === 'string' ? JSON.parse(value) : value
const money = value => Math.round(Number(value || 0) * 100) / 100
const dateStr = value => { if (value == null) return ''; const d = value instanceof Date ? value : new Date(value); if (isNaN(d.getTime())) return String(value).slice(0, 10); return d.toISOString().slice(0, 10) }
const toState = async () => {
  // 每日发现、知识库都已拆独立接口：单条正文最大 23KB / 12KB，全塞进 state 会让每次刷新拖到 1MB+
  // 知识库另有分页接口 GET /api/knowledge?page=，这里只留空占位
  const [yearPlans, monthPlans, checkTasks, checkins, transactions, finance, categories] =
    await Promise.all(['year_plans', 'month_plans', 'check_tasks', 'daily_checkins', 'transactions', 'finance_config', 'categories'].map(queryRows))
  const fin = finance[0] || { opening_balance: 0, month_budget: 0 }
  return {
    categories: categories.map(x => x.name),
    yearPlans: yearPlans.map(x => ({ id: x.id, year: x.year, name: x.name, category: x.category || '未分类', desc: x.description || '', createTime: Number(x.create_time) })),
    monthPlans: monthPlans.map(x => ({ id: x.id, yearPlanId: x.year_plan_id, year: x.year, month: x.month, name: x.name, category: x.category || '未分类', desc: x.description || '', createTime: Number(x.create_time) })),
    checkTasks: checkTasks.map(x => ({ id: x.id, monthPlanId: x.month_plan_id, name: x.name, category: x.category || '未分类', createTime: Number(x.create_time) })),
    checkins: checkins.map(x => ({ id: x.id, checkDate: dateStr(x.check_date), items: parse(x.items_json), createTime: Number(x.create_time), updateTime: Number(x.update_time) })),
    // 每日发现、知识库都走独立接口，state 只留空占位
    discovers: [],
    knowledge: [],
    transactions: transactions.map(x => ({ id: x.id, type: x.type, amount: money(x.amount), date: dateStr(x.record_date), category: x.category, note: x.note || '', createTime: Number(x.create_time) })),
    finance: { openingBalance: money(fin.opening_balance), monthBudget: money(fin.month_budget) }
  }
}

const app = express()
// 上传目录：启动时确保存在，并以静态资源对外提供（/uploads/knowledge/<id>.html 及内嵌图片）
fs.mkdirSync(uploadsRoot, { recursive: true })
app.use('/uploads', express.static(uploadsRoot))
// body 上限提到 80mb：素材单张放宽到 50MB，base64 编码后约 67MB，再留 JSON 余量；
// 导入的 HTML 报告也可能内嵌大体积 base64 图片
app.use(express.json({ limit: '80mb' }))
// 裸 HTML body（定时任务可直接把报告 POST 过来）
app.use(express.text({ type: 'text/html', limit: '80mb' }))
app.get('/api/state', async (_req, res, next) => { try { res.json(await toState()) } catch (error) { next(error) } })
app.put('/api/state', async (req, res, next) => {
  const list = key => Array.isArray(req.body?.[key]) ? req.body[key] : []
  // 服务端兜底守卫（P0）：冷启动时前端 bootstrap 未完成可能推来空状态。若无「五张业务表全空 + 服务端仍有数据 + 客户端未就绪」三者同时成立，则不拦截。
  try {
    // 每日发现已拆独立接口，不参与全量 PUT 的空判断（否则正文一多会被误判成"有数据"）
    const payloadEmpty = ['yearPlans', 'monthPlans', 'checkTasks', 'checkins'].every(k => list(k).length === 0)
    if (payloadEmpty && req.get('x-client-ready') !== '1') {
      const [[row]] = await pool.query('SELECT (SELECT COUNT(*) FROM year_plans)+(SELECT COUNT(*) FROM month_plans)+(SELECT COUNT(*) FROM check_tasks)+(SELECT COUNT(*) FROM daily_checkins) AS n')
      if (Number(row.n) > 0) return res.status(409).json({ ok: false, message: '拒绝保存空数据：服务端仍有数据，但本次提交为空。' })
    }
  } catch (error) { return next(error) }
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 资金表（transactions / finance_config）、知识库（knowledge_entries）、每日发现（daily_discovers）均已拆独立接口，全量 PUT 不再触碰
    for (const table of ['year_plans', 'month_plans', 'check_tasks', 'daily_checkins', 'categories']) await conn.query(`DELETE FROM ${table}`)
    const catNames = list('categories').filter(Boolean)
    for (const c of catNames) await conn.execute('INSERT INTO categories (name) VALUES (?)', [String(c).slice(0, 64)])
    for (const x of list('yearPlans')) await conn.execute('INSERT INTO year_plans (id, year, name, category, description, create_time) VALUES (?, ?, ?, ?, ?, ?)', [x.id, x.year, x.name, x.category || '未分类', x.desc || '', x.createTime || Date.now()])
    for (const x of list('monthPlans')) await conn.execute('INSERT INTO month_plans (id, year_plan_id, year, month, name, category, description, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [x.id, x.yearPlanId || null, x.year, x.month, x.name, x.category || '未分类', x.desc || '', x.createTime || Date.now()])
    for (const x of list('checkTasks')) await conn.execute('INSERT INTO check_tasks (id, month_plan_id, name, category, create_time) VALUES (?, ?, ?, ?, ?)', [x.id, x.monthPlanId, x.name, x.category || '未分类', x.createTime || Date.now()])
    for (const x of list('checkins')) await conn.execute('INSERT INTO daily_checkins (id, check_date, items_json, create_time, update_time) VALUES (?, ?, ?, ?, ?)', [x.id, x.checkDate, JSON.stringify(x.items || []), x.createTime || Date.now(), x.updateTime || Date.now()])
    await conn.commit(); res.json({ ok: true })
  } catch (error) { await conn.rollback(); next(error) } finally { conn.release() }
})

// ===== 每日发现：单条写入 + 收件箱消费（不复用全量 PUT，避免覆盖其他业务数据） =====
const DISCOVER_TAG_MAX = 8
const todayStr = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
// 入参归一与校验：title/content 必填，recordDate 缺省取今天（补录时由调用方显式给出生成日）
const discoverPayload = body => {
  const title = String(body?.title || '').trim().slice(0, 255)
  const content = String(body?.content || '').trim()
  if (!title) return { error: 'title 不能为空' }
  if (!content) return { error: 'content 不能为空' }
  const recordDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.recordDate || '')) ? String(body.recordDate) : todayStr()
  const tags = Array.isArray(body?.tags) ? body.tags.map(t => String(t || '').trim()).filter(Boolean).slice(0, DISCOVER_TAG_MAX) : []
  return {
    item: {
      title,
      content,
      recordDate,
      source: String(body?.source || '定时任务').trim().slice(0, 255),
      series: body?.series ? String(body.series).trim().slice(0, 32) : '',
      period: Number(body?.period) || null,
      link: String(body?.link || '').trim().slice(0, 2000),
      tags
    }
  }
}
// 幂等写入：同「日期 + 标题 + 来源」视为同一条，命中则更新内容，不重复插入
// series/period：来自定时任务产出的系列名与期号，用于卡片上标「第 N 期」
const upsertDiscover = async item => {
  const now = Date.now()
  const series = item.series ? String(item.series).slice(0, 32) : null
  const period = Number.isFinite(+item.period) && +item.period > 0 ? Math.floor(+item.period) : null
  const [exist] = await pool.execute('SELECT id FROM daily_discovers WHERE record_date = ? AND title = ? AND source = ? LIMIT 1', [item.recordDate, item.title, item.source])
  if (exist.length) {
    const id = exist[0].id
    await pool.execute('UPDATE daily_discovers SET content = ?, link = ?, tags_json = ?, series = ?, period = ?, update_time = ? WHERE id = ?', [item.content, item.link, JSON.stringify(item.tags), series, period, now, id])
    return { id, ...item, series, period, updated: true }
  }
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`
  await pool.execute('INSERT INTO daily_discovers (id, record_date, title, source, link, content, tags_json, series, period, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, item.recordDate, item.title, item.source, item.link, item.content, JSON.stringify(item.tags), series, period, now, now])
  return { id, ...item, series, period, updated: false }
}

app.post('/api/discovers', async (req, res, next) => {
  const { item, error } = discoverPayload(req.body)
  if (error) return res.status(400).json({ message: error })
  try {
    const saved = await upsertDiscover(item)
    res.json({ ok: true, item: saved })
  } catch (error) { next(error) }
})

// ===== 每日发现读取接口：列表只回摘要，正文按 id 单独取（67 期正文合计 1MB+，不能一次传） =====
// 摘要前先剥掉 <style>/<script>，否则卡片上会显示一堆 CSS 源码（HTML 产出的 <style> 排在正文之前）
const excerptOf = (raw, len = 180) => String(raw || '')
  // 先整块剥掉 <head>：里面只有 <title> 和 meta，留着会让列表摘要第一句变成
  // 「财务知识 · 第01期 · 毛利与毛利率 财务知识 · 第 01 期 毛利与毛利率：…」，标题重复两遍
  .replace(/<head[\s\S]*?<\/head>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/[*_`>|]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, len)

const discoverRow = x => ({
  id: x.id,
  recordDate: dateStr(x.record_date),
  title: x.title,
  source: x.source || '',
  tags: parse(x.tags_json),
  series: x.series || '',
  period: x.period == null ? null : Number(x.period),
  excerpt: excerptOf(x.content_peek),
  createTime: Number(x.create_time),
  updateTime: Number(x.update_time)
})

app.get('/api/discovers', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, record_date, title, source, tags_json, series, period, LEFT(content, 3000) AS content_peek, create_time, update_time FROM daily_discovers ORDER BY record_date DESC, period DESC, create_time DESC')
    res.json(rows.map(discoverRow))
  } catch (error) { next(error) }
})
app.get('/api/discovers/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM daily_discovers WHERE id = ? LIMIT 1', [req.params.id])
    if (!rows.length) return res.status(404).json({ message: '记录不存在' })
    const x = rows[0]
    res.json({ ...discoverRow({ ...x, content_peek: x.content }), link: x.link || '', content: x.content })
  } catch (error) { next(error) }
})
app.delete('/api/discovers/:id', async (req, res, next) => {
  try {
    const [result] = await pool.execute('DELETE FROM daily_discovers WHERE id = ?', [req.params.id])
    res.json({ ok: true, deleted: result.affectedRows })
  } catch (error) { next(error) }
})

// ===== 定时任务产出目录 → 知识库 =====
// 这三类都是「成期的完整报告」（有文件名、有期号、几 KB 到几十 KB、自带排版），归属知识库；
// 「每日发现」只放手动记录的零散灵感。原稿落盘 + iframe 预览，绝不重新生成内容。
// dirs：第一个是今后任务的固定输出目录，后面是历史产出目录（WorkBuddy 的 automation-<时间戳> 会变，所以两个都扫）
const knowledgeUploadDir = path.join(uploadsRoot, 'knowledge')
const reportRoot = path.resolve(process.env.REPORT_DIR || 'D:/spring-workbench/reports')
const outputFeeds = [
  {
    series: '金融概念',
    sourceLabel: '定时任务 · 金融概念',
    dirs: [path.join(reportRoot, 'finance'), path.resolve(process.env.OUTPUT_DIR_FINANCE || 'C:/Users/LEGION/WorkBuddy/automation-2026-09-09-23-33-35')],
    exts: ['.html'],
    parse: name => {
      const m = name.match(/^金融概念_第(\d+)期_(.+?)_(\d{4}-\d{2}-\d{2})\.html$/i)
      return m ? { period: Number(m[1]), topic: m[2].trim(), originDate: m[3] } : null
    }
  },
  {
    series: '概率学概念',
    sourceLabel: '定时任务 · 概率学概念',
    dirs: [path.join(reportRoot, 'probability'), path.resolve(process.env.OUTPUT_DIR_PROBABILITY || 'C:/Users/LEGION/WorkBuddy/automation-2026-09-09-23-36-48/概率学每日推送')],
    exts: ['.md'],
    parse: name => {
      const m = name.match(/^(\d{4}-\d{2}-\d{2})_第(\d+)期_(.+)\.md$/i)
      return m ? { period: Number(m[2]), topic: m[3].trim(), originDate: m[1] } : null
    }
  },
  {
    series: '实时新闻',
    sourceLabel: '定时任务 · 实时新闻',
    dirs: [path.join(reportRoot, 'news'), path.resolve(process.env.OUTPUT_DIR_NEWS || 'C:/Users/LEGION/WorkBuddy/automation-2026-09-09-23-38-42/outputs')],
    exts: ['.html'],
    parse: name => {
      const m = name.match(/^美股每日新闻简报_(\d{4}-\d{2}-\d{2})\.html$/i)
      return m ? { period: null, topic: '美股每日新闻简报', originDate: m[1] } : null
    }
  },
  {
    series: '财务知识',
    sourceLabel: '定时任务 · 财务知识',
    // 启用日：任务建好到第一次跑出文件之间有个时间窗，这段窗口里不该算「从未同步」
    since: '2026-10-29',
    // 固定目录排第一：任务里让人写到这里（D:/spring-workbench/reports/finance-knowledge）；
    // 自动化自带的工作目录排第二，防它某一次把文件写回 cwd —— 单靠 cwd 的话，
    // 目录名带时间戳，将来重建任务就换了路径，这一路会无声地变成「从未同步」。
    dirs: [
      path.join(reportRoot, 'finance-knowledge'),
      path.resolve(process.env.OUTPUT_DIR_FINANCE_KNOWLEDGE || 'C:/Users/LEGION/WorkBuddy/automation-2026-10-29-15-26-59')
    ],
    exts: ['.html', '.md'],
    // 这一路的任务刚建，历史文件名还没定死，所以严格格式对不上就走宽松解析：
    // 文件名里的 YYYY-MM-DD 当日期、剩下的当主题；连日期都没有就等扫描时用 mtime 兜底。
    // 宁可期号排得粗糙，也不能因为文件名差一个字符就整路不入库 —— 那正是「任务卡了看不出来」的老毛病。
    parse: name => {
      const strict = name.match(/^财务知识_第(\d+)期_(.+?)_(\d{4}-\d{2}-\d{2})\.(html|md)$/i)
      if (strict) return { period: Number(strict[1]), topic: strict[2].trim(), originDate: strict[3] }
      const base = name.replace(/\.(html|md)$/i, '')
      const dm = base.match(/(\d{4}-\d{2}-\d{2})/)
      const pm = base.match(/第\s*(\d+)\s*期/)
      const topic = base
        .replace(/财务知识/g, '')
        .replace(/第\s*\d+\s*期/g, '')
        .replace(/\d{4}-\d{2}-\d{2}/g, '')
        .replace(/[_\-\s]+/g, ' ')
        .trim()
      return { period: pm ? Number(pm[1]) : null, topic: topic || '财务知识', originDate: dm ? dm[1] : '' }
    }
  }
]

// ===== 同步进度（供知识库页的「今日自动更新」弹窗读取）=====
// 每次 syncOutputs 进来先 eventId++ 并置 running=true，前端轮询到 eventId 变化就弹窗；
// 三路各自记 status：running（正在入库）/ done（今天已同步）/ wait（今天产出还没到）。
// 这里只存内存，进程重启即清空——它是"本次动作的进度"，不是持久业务数据。
const syncStatus = { running: false, startedAt: 0, finishedAt: 0, eventId: 0, today: '', feeds: {} }
const beginSyncStatus = () => {
  syncStatus.running = true
  syncStatus.startedAt = Date.now()
  syncStatus.finishedAt = 0
  syncStatus.eventId += 1
  syncStatus.today = todayStr()
  syncStatus.feeds = {}
  for (const f of outputFeeds) {
    syncStatus.feeds[f.series] = { status: 'running', title: '', originDate: '', imported: false, count: 0, at: 0, note: '' }
  }
}
const endSyncStatus = () => {
  syncStatus.running = false
  syncStatus.finishedAt = Date.now()
  for (const series of Object.keys(syncStatus.feeds)) {
    if (syncStatus.feeds[series].status === 'running') syncStatus.feeds[series].status = 'wait'
  }
}
const syncStatusPayload = () => ({
  running: syncStatus.running,
  startedAt: syncStatus.startedAt,
  finishedAt: syncStatus.finishedAt,
  eventId: syncStatus.eventId,
  today: syncStatus.today || todayStr(),
  feeds: outputFeeds.map(f => {
    const st = syncStatus.feeds[f.series] || { status: 'idle', title: '', originDate: '', imported: false, count: 0, at: 0, note: '' }
    return { series: f.series, ...st }
  })
})

// Markdown → 自带样式的单文件 HTML：概率任务是 .md，统一转成 HTML 落盘，
// 知识库预览就能走同一条 iframe 通路（前端零改动）
const mdEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const mdInline = s => mdEscape(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
const mdToHtml = (md, docTitle) => {
  const out = []
  let list = null
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) { closeList(); continue }
    // 折叠块：md 里直接写 <details>/<summary>/</details> 标签行，原样透传不转义
    // （知识库预览是 sandbox="" 的 iframe，禁脚本，只能用原生 details 做「点开看答案」）
    if (/^\s*<\/?details\b/i.test(line) || /^\s*<\/?summary\b/i.test(line)) { closeList(); out.push(line.trim()); continue }
    if (/^\s*-{3,}\s*$/.test(line)) { closeList(); out.push('<hr>'); continue }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { closeList(); const lv = Math.min(h[1].length, 4); out.push(`<h${lv}>${mdInline(h[2])}</h${lv}>`); continue }
    const ul = line.match(/^\s*[-*+]\s+(.+)$/)
    if (ul) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' } out.push(`<li>${mdInline(ul[1])}</li>`); continue }
    const ol = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' } out.push(`<li>${mdInline(ol[1])}</li>`); continue }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) { closeList(); out.push(`<blockquote>${mdInline(quote[1])}</blockquote>`); continue }
    closeList(); out.push(`<p>${mdInline(line.trim())}</p>`)
  }
  closeList()
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${mdEscape(docTitle)}</title>
<style>
:root{--bg:#fffdf7;--ink:#2b2b2b;--sub:#6b6b6b;--accent:#c8772e;--line:#eee2cf}
*{box-sizing:border-box}
body{margin:0;padding:28px 18px;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.85;font-size:15px}
.wrap{max-width:760px;margin:0 auto}
h1{font-size:25px;line-height:1.35;margin:0 0 12px}
h2{font-size:19px;margin:26px 0 10px;padding-left:10px;border-left:3px solid var(--accent)}
h3{font-size:16px;margin:20px 0 8px}
p{margin:10px 0}
ul,ol{margin:10px 0;padding-left:22px}
li{margin:5px 0}
blockquote{margin:12px 0;padding:10px 14px;background:#fff;border-left:3px solid var(--line);color:var(--sub)}
hr{border:0;border-top:1px solid var(--line);margin:24px 0}
code{background:#f4ece0;padding:1px 5px;border-radius:4px;font-size:13px}
strong{color:#8a4b12}
details.qz{margin:12px 0;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden}
details.qz summary{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;list-style:none;user-select:none;font-weight:700;color:var(--ink);transition:background .16s}
details.qz summary:hover{background:#fdf8f0}
details.qz summary::-webkit-details-marker{display:none}
details.qz summary::marker{content:""}
details.qz summary::after{content:"看答案 ▾";margin-left:auto;flex:0 0 auto;font-size:12px;font-weight:600;color:#8a5a1e;background:#faf0e2;border-radius:999px;padding:2px 10px;white-space:nowrap}
details.qz[open] summary{background:#fdfaf4;border-bottom:1px dashed var(--line)}
details.qz[open] summary::after{content:"收起 ▴";background:#f2e6d4}
details.qz > *:not(summary){padding-left:14px;padding-right:14px}
details.qz > *:not(summary):last-child{padding-bottom:12px}
details.qz blockquote:empty{display:none}
</style></head><body><div class="wrap">${out.join('\n')}</div></body></html>`
}

// 写入知识库：原稿落盘 uploads/knowledge/<id>.html，content 存纯文本供搜索与摘要
const upsertReport = async ({ title, sourceLabel, sourceId, sourceMtime, html, text, originDate, tags }) => {
  const now = Date.now()
  await fsp.mkdir(knowledgeUploadDir, { recursive: true })
  const [exist] = await pool.execute('SELECT id FROM knowledge_entries WHERE source_label = ? AND source_id = ? LIMIT 1', [sourceLabel, sourceId])
  if (exist.length) {
    const id = exist[0].id
    await fsp.writeFile(path.join(knowledgeUploadDir, `${id}.html`), html, 'utf8')
    await pool.execute(
      'UPDATE knowledge_entries SET title = ?, content = ?, tags_json = ?, origin_date = ?, attachment_url = ?, attachment_type = ?, source_mtime = ?, update_time = ? WHERE id = ?',
      [title, text, JSON.stringify(tags), originDate, `/uploads/knowledge/${id}.html`, 'html', sourceMtime, now, id]
    )
    return { id, updated: true }
  }
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`
  await fsp.writeFile(path.join(knowledgeUploadDir, `${id}.html`), html, 'utf8')
  await pool.execute(
    'INSERT INTO knowledge_entries (id, source, source_label, source_id, source_mtime, title, content, tags_json, origin_date, attachment_url, attachment_type, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, 'import', sourceLabel, sourceId, sourceMtime, title, text, JSON.stringify(tags), originDate, `/uploads/knowledge/${id}.html`, 'html', now, now]
  )
  return { id, updated: false }
}

// 扫目录 → 读原文 → 幂等入库。内容长度没变的直接跳过，日常轮询只读文件、不写库
const syncOutputs = async () => {
  const stat = { total: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }
  beginSyncStatus()
  try {
  for (const feed of outputFeeds) {
    const snap = syncStatus.feeds[feed.series]
    let feedReady = 0
    let feedNew = 0
    let feedErr = 0
    const files = []
    let scannedAny = false
    for (const dir of feed.dirs) {
      let names
      try { names = await fsp.readdir(dir); scannedAny = true } catch { continue }
      for (const name of names) {
        if (!feed.exts.some(ext => name.toLowerCase().endsWith(ext))) continue
        const meta = feed.parse(name)
        if (!meta) { stat.skipped++; continue }
        // 文件名里没有日期（宽松解析的最坏情况）→ 退回文件修改时间，按本机时区取日期。
        // 用 toISOString 会在凌晨 0-8 点把日期算成前一天（UTC），那种「差一天」最难查。
        if (!meta.originDate) {
          try {
            const d = new Date((await fsp.stat(path.join(dir, name))).mtimeMs)
            meta.originDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          } catch { stat.skipped++; continue }
        }
        // 同名文件可能在历史目录与固定目录各有一份：先出现的优先，后面的靠幂等键更新
        if (files.some(x => x.name === name)) continue
        files.push({ ...meta, name, dir })
      }
    }
    if (!scannedAny) {
      stat.errors.push(`${feed.series}：所有产出目录都不存在（${feed.dirs.join(' / ')}）`)
      snap.status = 'error'
      snap.note = '产出目录不存在'
      continue
    }
    if (!files.length) { snap.status = 'wait'; snap.note = '今天还没有产出文件'; continue }
    files.sort((a, b) => a.originDate.localeCompare(b.originDate) || (a.period || 0) - (b.period || 0))
    // 文件名不带期号的系列（新闻）：按日期升序自动编号，标题里也能标「第 N 期」
    let auto = 0
    for (const f of files) {
      if (f.period) auto = Math.max(auto, f.period)
      else f.period = ++auto
    }
    const [known] = await pool.execute('SELECT source_id, source_mtime FROM knowledge_entries WHERE source_label = ?', [feed.sourceLabel])
    const mtimeMap = new Map(known.map(r => [r.source_id, Number(r.source_mtime || 0)]))
    for (const f of files) {
      try {
        const filePath = path.join(f.dir, f.name)
        const mtime = Math.floor((await fsp.stat(filePath)).mtimeMs)
        if (mtimeMap.get(f.name) === mtime) { stat.total++; feedReady++; continue }
        const raw = (await fsp.readFile(filePath, 'utf8')).trim()
        if (!raw) { stat.skipped++; continue }
        const text = excerptOf(raw, 20000)
        const title = `第${f.period}期 · ${f.topic}`
        const html = f.name.toLowerCase().endsWith('.md') ? mdToHtml(raw, `${feed.series} ${title}`) : raw
        const saved = await upsertReport({ title, sourceLabel: feed.sourceLabel, sourceId: f.name, sourceMtime: mtime, html, text, originDate: f.originDate, tags: [feed.series, '每日', `第${f.period}期`] })
        if (saved.updated) stat.updated++
        else stat.inserted++
        feedNew++
        feedReady++
        stat.total++
      } catch (error) { feedErr++; stat.errors.push(`${f.name}：${error.message}`) }
    }
    // 该系列「今天这一份」是否已到齐：最新一份的日期 = 今天 → done，否则还在等
    const latest = files[files.length - 1]
    if (latest && latest.originDate === syncStatus.today) {
      snap.status = feedErr ? 'error' : 'done'
      snap.note = ''
      snap.title = `第${latest.period}期 · ${latest.topic}`
      snap.originDate = latest.originDate
    } else {
      snap.status = 'wait'
      snap.note = latest ? `今天还没产出（最新一份 ${latest.originDate}）` : '今天还没有产出文件'
    }
    snap.imported = feedNew > 0
    snap.count = feedReady
    snap.at = Date.now()
  }
  } finally {
    endSyncStatus()
  }
  if (stat.inserted || stat.updated || stat.errors.length) {
    console.log(`[知识库] 产出同步 ${stat.total} 份（新增 ${stat.inserted} / 更新 ${stat.updated}）${stat.errors.length ? `，失败 ${stat.errors.length}` : ''}`)
    for (const e of stat.errors) console.error(`[知识库] ${e}`)
  }
  return stat
}

// ===== AI 大事：文件投放 → 入库 =====
// 用 app_meta 记「文件名 -> mtime」，同一份文件只处理一次。
// 为什么必须判重：每分钟重扫会把用户在界面上改过的标题/权重/标签又刷回文件里的旧值。
// 想强制重导某份文件：POST /api/ai-events/sync?force=1
const syncAiEventFiles = async ({ force = false } = {}) => {
  const stat = { files: 0, imported: 0, skipped: 0, errors: [] }
  let names
  try { names = await fsp.readdir(aiEventDir) } catch { return stat }   // 目录还没建：静默跳过，不报错
  const conn = await pool.getConnection()
  try {
    for (const name of names.sort()) {
      if (!/\.json$/i.test(name)) continue
      const filePath = path.join(aiEventDir, name)
      let mtime = 0
      try { mtime = Math.floor((await fsp.stat(filePath)).mtimeMs) } catch { continue }
      const metaKey = `ai_imp:${name}`.slice(0, 64)
      const [[seen]] = await conn.execute('SELECT v FROM app_meta WHERE k = ? LIMIT 1', [metaKey])
      if (!force && seen && String(seen.v) === String(mtime)) continue
      let events
      try {
        const raw = JSON.parse(await fsp.readFile(filePath, 'utf8'))
        events = Array.isArray(raw) ? raw : (raw.events || [])
      } catch (error) {
        stat.errors.push(`${name}：JSON 解析失败（${error.message}）`)
        continue
      }
      for (const e of events) {
        try {
          await upsertAiEvent(conn, { ...e, origin: e.origin || 'auto' }, e.checkedAt)
          stat.imported++
        } catch (error) {
          stat.skipped++
          stat.errors.push(`${name}：${e?.version || '(缺版本名)'} — ${error.message}`)
        }
      }
      stat.files++
      await conn.execute(
        'INSERT INTO app_meta (k, v, create_time) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
        [metaKey, String(mtime), Date.now()]
      )
    }
  } finally { conn.release() }
  if (stat.files || stat.errors.length) {
    console.log(`[AI 时间线] 文件入库：${stat.files} 个文件 / ${stat.imported} 条${stat.skipped ? `，跳过 ${stat.skipped} 条` : ''}`)
    for (const e of stat.errors.slice(0, 5)) console.error(`[AI 时间线] ${e}`)
  }
  return stat
}

app.post('/api/ai-events/sync', async (req, res, next) => {
  try { res.json({ ok: true, ...(await syncAiEventFiles({ force: req.query.force === '1' })) }) } catch (error) { next(error) }
})

app.post('/api/knowledge/sync', async (_req, res, next) => {
  try { res.json({ ok: true, ...(await syncOutputs()) }) } catch (error) { next(error) }
})

// 今日各路产出进度：知识库页的「今日自动更新」弹窗从这里轮询，只读内存快照，不碰数据库
app.get('/api/knowledge/sync-progress', (_req, res) => res.json(syncStatusPayload()))

// ===== 各路定时任务「最近一次产出」（知识库右上角入口用）=====
// 为什么不用内存里的 syncStatus：进程一重启就空了，而「上一次成功是哪天」必须随时查得到。
// 所以这里查库（knowledge_entries.origin_date），内存只用来补充「此刻是否正在同步」。
const daysBehind = (from, to) => {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null
}
const feedsStatus = async () => {
  const today = todayStr()
  const list = []
  for (const feed of outputFeeds) {
    const [latestRows] = await pool.execute(
      'SELECT title, origin_date FROM knowledge_entries WHERE source_label = ? ORDER BY origin_date DESC, update_time DESC LIMIT 1',
      [feed.sourceLabel]
    )
    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM knowledge_entries WHERE source_label = ?',
      [feed.sourceLabel]
    )
    const latest = latestRows[0] || null
    const lastDate = latest ? dateStr(latest.origin_date) : ''
    const behind = lastDate ? daysBehind(lastDate, today) : null
    // 全新一路（任务刚建、第一次还没跑）：库里一份都没有不等于「卡住」，
    // 否则今天刚加完的财务知识，明早九点前就会把入口染成金色告警。
    const sinceDays = feed.since ? daysBehind(feed.since, today) : null
    const firstPending = !lastDate && sinceDays !== null && sinceDays < 2
    const mem = syncStatus.feeds[feed.series] || null
    // 内存态只在本次进程内有效；重启后回落到「按日期推断」，这样入口永远读得到东西
    const fallback = behind === null ? (firstPending ? 'wait' : 'idle') : behind <= 1 ? 'done' : 'wait'
    list.push({
      series: feed.series,
      title: latest ? latest.title : '',
      originDate: lastDate,
      total: Number((countRows[0] || {}).total || 0),
      daysBehind: behind,
      // 落后 1 天算正常（今天的产出可能还没到点），2 天及以上才判定「卡住」
      stale: behind === null ? !firstPending : behind >= 2,
      pending: !!firstPending,
      syncing: !!mem && mem.status === 'running',
      status: mem && mem.status ? mem.status : fallback,
      note: mem ? mem.note || '' : '',
      imported: !!(mem && mem.imported)
    })
  }
  return {
    today,
    running: syncStatus.running,
    staleCount: list.filter(x => x.stale && !x.syncing).length,
    feeds: list
  }
}
app.get('/api/knowledge/feeds-status', async (_req, res, next) => {
  try { res.json(await feedsStatus()) } catch (error) { next(error) }
})

// 消费收件箱：逐个文件读取 → 写库 → 成功才移入 archive（移动即「已消费」标记，失败留原地等下次）
const ingestInbox = async () => {
  await fsp.mkdir(inboxRoot, { recursive: true })
  const names = (await fsp.readdir(inboxRoot)).filter(n => /\.json$/i.test(n))
  if (!names.length) return { imported: 0, failed: 0 }
  let imported = 0
  let failed = 0
  for (const name of names) {
    const file = path.join(inboxRoot, name)
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8'))
      const list = Array.isArray(parsed) ? parsed : [parsed]
      if (!list.length) throw new Error('文件内容为空')
      for (const one of list) {
        const { item, error } = discoverPayload(one)
        if (error) throw new Error(error)
        await upsertDiscover(item)
        imported++
      }
      await fsp.mkdir(inboxArchive, { recursive: true })
      const target = path.join(inboxArchive, name)
      const occupied = await fsp.access(target).then(() => true, () => false)
      await fsp.rename(file, occupied ? path.join(inboxArchive, `${Date.now()}-${name}`) : target)
    } catch (error) {
      // 单个文件失败不阻塞其余文件，且不归档 → 下次扫描会重试
      failed++
      console.error(`[每日发现] 导入失败 ${name}：${error.message}`)
    }
  }
  console.log(`[每日发现] 收件箱导入 ${imported} 条${failed ? `，失败 ${failed} 个文件` : ''}`)
  return { imported, failed }
}

// ===== 资金模块独立接口（transactions + finance，按条提交，避免全量重写） =====
const txRow = x => ({ id: x.id, type: x.type, amount: money(x.amount), date: dateStr(x.record_date), category: x.category, note: x.note || '', createTime: Number(x.create_time) })

app.get('/api/transactions', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, type, amount, record_date, category, note, create_time FROM transactions ORDER BY create_time DESC')
    res.json(rows.map(txRow))
  } catch (error) { next(error) }
})
app.post('/api/transactions', async (req, res, next) => {
  const x = req.body || {}
  try {
    await pool.execute('INSERT INTO transactions (id, type, amount, record_date, category, note, create_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [x.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, x.type === 'income' ? 'income' : 'expense', x.amount || 0, x.date, x.category || '其他', x.note || '', x.createTime || Date.now()])
    res.json({ ok: true })
  } catch (error) { next(error) }
})
app.delete('/api/transactions/:id', async (req, res, next) => {
  try {
    await pool.execute('DELETE FROM transactions WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.get('/api/finance', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT opening_balance, month_budget FROM finance_config WHERE id = 1')
    const f = rows[0] || { opening_balance: 0, month_budget: 0 }
    res.json({ openingBalance: money(f.opening_balance), monthBudget: money(f.month_budget) })
  } catch (error) { next(error) }
})
app.put('/api/finance', async (req, res, next) => {
  const f = req.body || {}
  try {
    await pool.execute('INSERT INTO finance_config (id, opening_balance, month_budget) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE opening_balance = ?, month_budget = ?',
      [f.openingBalance || 0, f.monthBudget || 0, f.openingBalance || 0, f.monthBudget || 0])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

// ===== 知识库独立接口（knowledge_entries，支持导入定时任务产出的 HTML 报告） =====
// 与「全量 PUT /api/state」解耦：导入的条目只走这里，避免任何一次全量同步把它抹掉
const knowledgeRow = x => ({ id: x.id, source: x.source, sourceLabel: x.source_label || '', sourceId: x.source_id, title: x.title, content: x.content, tags: parse(x.tags_json), originDate: dateStr(x.origin_date), attachmentUrl: x.attachment_url || '', attachmentType: x.attachment_type || '', createTime: Number(x.create_time), updateTime: Number(x.update_time) })

// 知识库分页：翻开哪一页只取这一页的正文。67 份报告合计约 28 万字，全量下发会把列表拖到卡死。
// 返回 facets（来源/标签去重）供筛选下拉使用，它始终按全库算，不受当前筛选影响。
// ===== 奇思妙想：独立接口，不走全量 /api/state =====
app.get('/api/ideas', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, name, pitch, steps_json, create_time, update_time FROM ideas ORDER BY sort_no ASC, create_time DESC')
    res.json({ items: rows.map(ideaRow) })
  } catch (error) { next(error) }
})
app.post('/api/ideas', async (req, res, next) => {
  try {
    const body = req.body || {}
    const name = String(body.name || '').trim()
    if (!name) return res.status(400).json({ message: '缺少名称' })
    const steps = Array.isArray(body.steps) && body.steps.length ? body.steps : blankSteps()
    const now = Date.now()
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`
    await pool.execute(
      'INSERT INTO ideas (id, name, pitch, steps_json, sort_no, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, String(body.pitch || ''), JSON.stringify(steps), 0, now, now]
    )
    res.json({ ok: true, item: { id, name, pitch: String(body.pitch || ''), steps, createTime: now, updateTime: now } })
  } catch (error) { next(error) }
})
// 改名称 / 一句话 / 整串阶段与成果：阶段是在前端整体维护的，一次 PUT 提交即可
app.put('/api/ideas/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const body = req.body || {}
    const [rows] = await pool.execute('SELECT id, name, pitch, steps_json, create_time, update_time FROM ideas WHERE id = ? LIMIT 1', [id])
    if (!rows.length) return res.status(404).json({ message: '想法不存在' })
    const cur = ideaRow(rows[0])
    const name = body.name === undefined ? cur.name : (String(body.name).trim() || cur.name)
    const pitch = body.pitch === undefined ? cur.pitch : String(body.pitch)
    const steps = Array.isArray(body.steps) ? body.steps : cur.steps
    const now = Date.now()
    await pool.execute('UPDATE ideas SET name = ?, pitch = ?, steps_json = ?, update_time = ? WHERE id = ?',
      [name, pitch, JSON.stringify(steps), now, id])
    res.json({ ok: true, item: { ...cur, name, pitch, steps, updateTime: now } })
  } catch (error) { next(error) }
})
app.delete('/api/ideas/:id', async (req, res, next) => {
  try {
    await pool.execute('DELETE FROM ideas WHERE id = ?', [String(req.params.id)])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

// ===== AI 今日大事：独立接口，同样不走全量 /api/state =====
// 一次把事件与基线都给前端：数据量在几十到几百条，前端要拿全量做筛选计数 / 热力条 / 分组，分页反而更绕。
app.get('/api/ai-events', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ai_events ORDER BY event_date DESC, FIELD(model, \'openai\',\'claude\',\'deepseek\',\'kimi\',\'gemini\'), update_time DESC')
    const [base] = await pool.query('SELECT * FROM ai_baseline ORDER BY sort_no ASC')
    res.json({ items: rows.map(aiEventRow), baseline: base.map(aiBaselineRow) })
  } catch (error) { next(error) }
})
// 每日任务往这里投：可以单条，也可以 { events: [...] } 批量，重复投递不会产生重复卡片
app.post('/api/ai-events', async (req, res, next) => {
  try {
    const body = req.body || {}
    const list = Array.isArray(body.events) ? body.events : (Array.isArray(body) ? body : [body])
    if (!list.length) return res.status(400).json({ message: '没有要写入的事件' })
    const checkedAt = body.checkedAt && /^\d{4}-\d{2}-\d{2}$/.test(String(body.checkedAt)) ? String(body.checkedAt) : todayStr()
    const ids = []
    for (const e of list) ids.push(await upsertAiEvent(pool, e, checkedAt))
    res.json({ ok: true, count: ids.length, ids })
  } catch (error) {
    // 数据格式错误是 400（任务投错格式时能一眼看出来），不是 500
    if (/^(未知模型|事件日期格式|缺少版本名)/.test(String(error.message || ''))) return res.status(400).json({ message: error.message })
    next(error)
  }
})
// 手工修正一条（错别字、日期差一天、来源换了）
app.put('/api/ai-events/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const [rows] = await pool.execute('SELECT * FROM ai_events WHERE id = ? LIMIT 1', [id])
    if (!rows.length) return res.status(404).json({ message: '这条更新不存在' })
    const cur = aiEventRow(rows[0])
    const body = req.body || {}
    const pick = (v, fallback) => (v === undefined ? fallback : v)
    const next_ = {
      weight: AI_WEIGHTS.includes(body.weight) ? body.weight : cur.weight,
      title: String(pick(body.title, cur.title)).slice(0, 255) || cur.title,
      what: String(pick(body.what, cur.what)),
      why: String(pick(body.why, cur.why)),
      more: String(pick(body.more, cur.more)),
      tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 8) : cur.tags,
      caps: Array.isArray(body.caps) ? body.caps.map(String).slice(0, 12) : cur.caps,
      srcName: String(pick(body.srcName, cur.srcName)).slice(0, 255),
      srcUrl: String(pick(body.srcUrl, cur.srcUrl)).slice(0, 500),
      srcType: body.srcType === 'off' || body.srcType === 'media' ? body.srcType : cur.srcType
    }
    const now = Date.now()
    await pool.execute(
      'UPDATE ai_events SET weight = ?, title = ?, what_text = ?, why_text = ?, more_text = ?, tags_json = ?, caps_json = ?, src_name = ?, src_url = ?, src_type = ?, update_time = ? WHERE id = ?',
      [next_.weight, next_.title, next_.what, next_.why, next_.more, JSON.stringify(next_.tags), JSON.stringify(next_.caps), next_.srcName, next_.srcUrl, next_.srcType, now, id]
    )
    res.json({ ok: true, item: { ...cur, ...next_, updateTime: now } })
  } catch (error) { next(error) }
})
app.delete('/api/ai-events/:id', async (req, res, next) => {
  try {
    await pool.execute('DELETE FROM ai_events WHERE id = ?', [String(req.params.id)])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

// ===== 好公司：财报抓 SEC 官方 XBRL，行情抓东方财富，独立接口不进 /api/state =====
const safeParse = (value, fallback) => {
  if (value == null) return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return fallback }
}

// full=false 用于列表：不返回十来年财报和五年月线，列表只要摘要
const companyRow = (r, full = true) => {
  const row = {
    ticker: r.ticker,
    nameCn: r.name_cn || '',
    nameEn: r.name_en || '',
    cik: r.cik || '',
    secid: r.secid || '',
    exchange: r.exchange || '',
    sector: r.sector || '',
    biz: r.biz || '',
    segments: safeParse(r.segments_json, []),
    history: safeParse(r.history_json, []),
    notes: safeParse(r.notes_json, {}),
    info: safeParse(r.info_json, null),
    memo: safeParse(r.memo_json, []),
    quote: safeParse(r.quote_json, null),
    sortNo: r.sort_no || 0,
    finSyncAt: Number(r.fin_sync_at) || 0,
    createTime: Number(r.create_time) || 0,
    updateTime: Number(r.update_time) || 0
  }
  if (full) {
    row.fin = safeParse(r.fin_json, [])
    row.kline = safeParse(r.kline_json, [])
  }
  return row
}

const DEFAULT_NOTES = { moat: '', mgmt: '', space: '', quality: '', risk: '', price: '', verdict: '待研究' }

// 把一次「全量抓取」的结果写回库。
// 铁律：抓取只负责它抓得到的东西，人工写过的字段一律以库里为准。
// 尤其 info.website / info.links —— 抓取层永远拿不到官网（SEC 的 website 字段普遍为空），
// 不特殊保护的话，每点一次「更新数据」用户填的官网就没了。
const applyReload = async (cur, data) => {
  const now = Date.now()
  const has = v => typeof v === 'string' ? v.trim().length > 0
    : Array.isArray(v) ? v.length > 0
      : !!(v && typeof v === 'object' && Object.keys(v).length)
  const curInfo = cur.info || {}
  const info = {
    ...curInfo,
    ...(data.info || {}),
    website: curInfo.website || '',
    links: Array.isArray(curInfo.links) ? curInfo.links : []
  }
  await pool.execute(
    'UPDATE companies SET name_cn = ?, name_en = ?, cik = ?, secid = ?, exchange = ?, sector = ?, info_json = ?, quote_json = ?, fin_json = ?, kline_json = ?, fin_sync_at = ?, update_time = ? WHERE ticker = ?',
    [
      cur.nameCn || data.nameCn,
      data.nameEn || cur.nameEn,
      data.cik,
      data.secid,
      data.exchange,
      has(cur.sector) ? cur.sector : (data.sector || ''),
      JSON.stringify(info),
      JSON.stringify(data.quote),
      JSON.stringify(data.fin),
      JSON.stringify(data.kline),
      now,
      now,
      data.ticker
    ]
  )
  return info
}

// 列表：一次全给（个人自用，几十家以内），但要保证轻量
app.get('/api/companies', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT ticker, name_cn, name_en, cik, secid, exchange, sector, biz, segments_json, history_json, notes_json, info_json, memo_json, quote_json, fin_json, fin_sync_at, sort_no, create_time, update_time FROM companies ORDER BY sort_no ASC, create_time ASC')
    // 列表卡片要显示最新财年的营收/净利，所以从 fin_json 里摘最后一年的四个数，不把整串财报吐出去
    const items = rows.map(r => {
      const item = companyRow(r, false)
      const fin = safeParse(r.fin_json, [])
      const last = fin.length ? fin[fin.length - 1] : null
      item.latest = last ? {
        fy: last.fy, revenue: last.revenue, netIncome: last.netIncome,
        grossMargin: last.grossMargin, netMargin: last.netMargin, roe: last.roe, debtRatio: last.debtRatio
      } : null
      item.fyCount = fin.length
      return item
    })
    res.json({ items })
  } catch (error) { next(error) }
})

app.get('/api/companies/:ticker', async (req, res, next) => {
  try {
    const ticker = normTicker(req.params.ticker)
    const [rows] = await pool.execute('SELECT * FROM companies WHERE ticker = ? LIMIT 1', [ticker])
    if (!rows.length) return res.status(404).json({ message: '这家公司还没加进来' })
    res.json({ item: companyRow(rows[0], true) })
  } catch (error) { next(error) }
})

// 添加公司：输代码 → 抓财报和行情 → 入库。
// 已经存在的公司重新添加 = 刷新数据，但人工写的业务/历史/判断要保住，不能被抓取冲掉。
app.post('/api/companies', async (req, res, next) => {
  try {
    const raw = String((req.body || {}).ticker || '').trim()
    if (!raw) return res.status(400).json({ message: '请填股票代码' })

    let data
    try {
      data = await buildCompany(raw)
    } catch (error) {
      // 抓不到不是服务器坏了，是代码不对或源站限流，原样告诉前端
      return res.status(422).json({ message: error.message || '抓取失败' })
    }

    const [existing] = await pool.execute('SELECT * FROM companies WHERE ticker = ? LIMIT 1', [data.ticker])
    const now = Date.now()
    const quote = data.quote

    if (existing.length) {
      const cur = companyRow(existing[0], true)
      await applyReload(cur, data)
      const [after] = await pool.execute('SELECT * FROM companies WHERE ticker = ? LIMIT 1', [data.ticker])
      return res.json({ ok: true, existed: true, item: companyRow(after[0], true) })
    }

    const item = {
      ...data,
      biz: data.biz,
      segments: data.segments,
      history: data.history,
      notes: DEFAULT_NOTES,
      info: data.info || null,
      memo: []
    }
    await pool.execute(
      'INSERT INTO companies (ticker, name_cn, name_en, cik, secid, exchange, sector, biz, segments_json, history_json, notes_json, info_json, memo_json, quote_json, fin_json, kline_json, fin_sync_at, sort_no, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [item.ticker, item.nameCn, item.nameEn, item.cik, item.secid, item.exchange, item.sector, item.biz,
       JSON.stringify(item.segments), JSON.stringify(item.history), JSON.stringify(item.notes),
       JSON.stringify(item.info), JSON.stringify(item.memo),
       JSON.stringify(quote), JSON.stringify(data.fin), JSON.stringify(data.kline), now, 0, now, now]
    )
    const [after] = await pool.execute('SELECT * FROM companies WHERE ticker = ? LIMIT 1', [item.ticker])
    res.json({ ok: true, existed: false, item: companyRow(after[0], true) })
  } catch (error) { next(error) }
})

// 只改人工维护的部分：业务描述、收入结构、历史、我的判断
app.patch('/api/companies/:ticker', async (req, res, next) => {
  try {
    const ticker = normTicker(req.params.ticker)
    const body = req.body || {}
    const [rows] = await pool.execute('SELECT * FROM companies WHERE ticker = ? LIMIT 1', [ticker])
    if (!rows.length) return res.status(404).json({ message: '这家公司还没加进来' })
    const cur = companyRow(rows[0], true)

    const curInfo = cur.info || {}
    const next_ = {
      nameCn: body.nameCn === undefined ? cur.nameCn : String(body.nameCn).slice(0, 100),
      sector: body.sector === undefined ? cur.sector : String(body.sector).slice(0, 100),
      biz: body.biz === undefined ? cur.biz : String(body.biz),
      segments: Array.isArray(body.segments) ? body.segments : cur.segments,
      history: Array.isArray(body.history) ? body.history : cur.history,
      notes: (body.notes && typeof body.notes === 'object') ? { ...DEFAULT_NOTES, ...cur.notes, ...body.notes } : cur.notes,
      // 档案里只有官网和自定义链接是人工的，其余（行业/年报直链等）由抓取维护，不接受前端改
      info: body.info === undefined ? curInfo : {
        ...curInfo,
        website: body.info.website === undefined ? (curInfo.website || '') : String(body.info.website || '').trim().slice(0, 500),
        links: Array.isArray(body.info.links)
          ? body.info.links
            .filter(l => l && String(l.url || '').trim())
            .slice(0, 20)
            .map(l => ({ label: String(l.label || '').slice(0, 60), url: String(l.url).trim().slice(0, 500) }))
          : (curInfo.links || [])
      },
      memo: Array.isArray(body.memo)
        ? body.memo
          .filter(m => m && String(m.text || '').trim())
          .slice(-200)
          .map(m => ({ at: Number(m.at) || Date.now(), text: String(m.text).slice(0, 4000) }))
        : cur.memo,
      sortNo: body.sortNo === undefined ? cur.sortNo : Number(body.sortNo) || 0
    }
    const now = Date.now()
    await pool.execute(
      'UPDATE companies SET name_cn = ?, sector = ?, biz = ?, segments_json = ?, history_json = ?, notes_json = ?, info_json = ?, memo_json = ?, sort_no = ?, update_time = ? WHERE ticker = ?',
      [next_.nameCn, next_.sector, next_.biz, JSON.stringify(next_.segments), JSON.stringify(next_.history),
       JSON.stringify(next_.notes), JSON.stringify(next_.info), JSON.stringify(next_.memo), next_.sortNo, now, ticker]
    )
    res.json({ ok: true, item: { ...cur, ...next_, updateTime: now } })
  } catch (error) { next(error) }
})

// 全量更新一家公司：重抓财报 + 行情 + 公司档案（比「刷新行情」慢，通常几秒）
// 人工写的一律保留：业务、历史、判断、备忘、官网、自定义链接
app.post('/api/companies/:ticker/reload', async (req, res, next) => {
  const started = Date.now()
  try {
    const ticker = normTicker(req.params.ticker)
    const [rows] = await pool.execute('SELECT * FROM companies WHERE ticker = ? LIMIT 1', [ticker])
    if (!rows.length) return res.status(404).json({ message: '这家公司还没加进来' })
    const cur = companyRow(rows[0], true)
    let data
    try {
      data = await buildCompany(cur.ticker)
    } catch (error) {
      return res.status(422).json({ message: error.message || '重新抓取失败' })
    }
    await applyReload(cur, data)
    const [after] = await pool.execute('SELECT * FROM companies WHERE ticker = ? LIMIT 1', [cur.ticker])
    res.json({ ok: true, item: companyRow(after[0], true), ms: Date.now() - started })
  } catch (error) { next(error) }
})

// 只刷行情（每日收盘后用）
app.post('/api/companies/:ticker/refresh', async (req, res, next) => {
  try {
    const ticker = normTicker(req.params.ticker)
    const [rows] = await pool.execute('SELECT * FROM companies WHERE ticker = ? LIMIT 1', [ticker])
    if (!rows.length) return res.status(404).json({ message: '这家公司还没加进来' })
    const cur = companyRow(rows[0], true)
    const now = Date.now()
    try {
      const r = await refreshQuoteOnly(ticker, cur.secid)
      const quote = {
        price: r.quote.price, chgPct: r.quote.chgPct, high: r.quote.high, low: r.quote.low,
        capYi: r.quote.capYi,
        pe: r.quote.pe != null ? r.quote.pe : (cur.quote && cur.quote.pe) || null,
        pb: r.quote.pb != null ? r.quote.pb : (cur.quote && cur.quote.pb) || null,
        quoteTime: r.quote.quoteTime
      }
      await pool.execute(
        'UPDATE companies SET quote_json = ?, kline_json = ?, secid = ?, update_time = ? WHERE ticker = ?',
        [JSON.stringify(quote), JSON.stringify(r.kline && r.kline.length ? r.kline : cur.kline), r.secid || cur.secid, now, ticker]
      )
      res.json({ ok: true, quote })
    } catch (error) {
      return res.status(422).json({ message: error.message || '行情刷新失败' })
    }
  } catch (error) { next(error) }
})

// 批量刷行情：单家失败不影响其他家。路由与每日定时任务共用这一份逻辑。
const refreshAllQuotes = async () => {
  const [rows] = await pool.query('SELECT ticker, secid FROM companies ORDER BY sort_no ASC')
  const done = [], failed = []
  for (const r of rows) {
    try {
      const out = await refreshQuoteOnly(r.ticker, r.secid)
      await pool.execute(
        'UPDATE companies SET quote_json = ?, secid = ?, update_time = ? WHERE ticker = ?',
        [JSON.stringify(out.quote), out.secid || r.secid, Date.now(), r.ticker]
      )
      done.push(r.ticker)
    } catch (error) {
      failed.push({ ticker: r.ticker, message: error.message })
    }
    await new Promise(ok => setTimeout(ok, 300))   // 别把东财打太急
  }
  return { done, failed }
}

app.post('/api/companies/refresh-all', async (_req, res, next) => {
  try {
    res.json({ ok: true, ...(await refreshAllQuotes()) })
  } catch (error) { next(error) }
})

app.delete('/api/companies/:ticker', async (req, res, next) => {
  try {
    await pool.execute('DELETE FROM companies WHERE ticker = ?', [normTicker(req.params.ticker)])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

// 知识打卡：直接写库，不走全量 PUT /api/state。
// 前端点一下立刻本地生效，这里负责落库并回传当天完整 items；请求失败时前端回滚并提示，
// 避免出现「界面显示已打卡、数据库其实没写」这种只存在浏览器里的假状态。
app.post('/api/checkins/knowledge', async (req, res, next) => {
  try {
    const body = req.body || {}
    const kbId = String(body.kbId || '').trim()
    if (!kbId) return res.status(400).json({ message: '缺少 kbId' })
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : todayStr()
    const [rows] = await pool.execute('SELECT items_json FROM daily_checkins WHERE check_date = ? LIMIT 1', [day])
    const items = rows.length ? parse(rows[0].items_json) : []
    const at = items.findIndex(it => it && it.kind === 'knowledge' && it.kbId === kbId)
    // body.remove === true：工作台的 ✕ 是明确取消；否则按当前状态 toggle（有就删、没有就加）
    const removing = body.remove === true || at >= 0
    if (at >= 0) items.splice(at, 1)
    if (!removing) {
      items.push({
        kind: 'knowledge', kbId,
        title: String(body.title || ''), originDate: String(body.originDate || day),
        isFinish: true, note: '', createTime: Date.now()
      })
    }
    const now = Date.now()
    await pool.execute(
      'INSERT INTO daily_checkins (id, check_date, items_json, create_time, update_time) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE items_json = VALUES(items_json), update_time = VALUES(update_time)',
      [`day-${day}`, day, JSON.stringify(items), now, now]
    )
    res.json({ ok: true, date: day, added: !removing, items })
  } catch (error) { next(error) }
})
app.get('/api/knowledge', async (req, res, next) => {
  try {
    // 非法/负数一律回退默认值（pageSize 上限 100，防止一次拉全库又把前端拖死）
    const rawPage = parseInt(req.query.page, 10)
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
    const rawSize = parseInt(req.query.pageSize, 10)
    const pageSize = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(100, rawSize) : 12
    const kw = String(req.query.keyword || '').trim()
    const source = String(req.query.source || '').trim()
    const tag = String(req.query.tag || '').trim()
    const startDate = String(req.query.start || '').trim()
    const endDate = String(req.query.end || '').trim()

    const where = []
    const params = []
    if (kw) { where.push('(title LIKE ? OR content LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`) }
    if (source) { where.push("COALESCE(NULLIF(source_label, ''), source) = ?"); params.push(source) }
    if (tag) { where.push('tags_json LIKE ?'); params.push(`%"${tag}"%`) }
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { where.push('origin_date >= ?'); params.push(startDate) }
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) { where.push('origin_date <= ?'); params.push(endDate) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    // 排序三选一（白名单拼字面量，用户传什么都进不了语句）：
    //   series     「按系列分期」—— 同一系列连成一块，块内期号从大到小（默认）
    //   date_asc   最早在前
    //   date_desc  最近在前
    // 期号没单独建列，藏在 title 里（「第33期 · 黑天鹅事件」）。MySQL 5.7 没有
    // REGEXP_SUBSTR，只能 SUBSTRING_INDEX 抠 + REGEXP 先确认，抠不到（手工导入、打卡沉淀）
    // 记 0，DESC 时落在这个系列块的末尾 —— 正好符合「没期号的排后面」。
    const periodNoOf = t => `CASE WHEN ${t}.title REGEXP '第[0-9]+期' THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(${t}.title, '第', -1), '期', 1) AS UNSIGNED) ELSE 0 END`
    // ⚠️ 必须带表名前缀。子查询里 FROM knowledge_entries x 也有 source_label/source/title 同名列，
    // 不限定的话 MySQL 会把右边解析成 x 的列，条件恒真、四个系列拿到同一个键值，
    // 排序就退化回按系列名 —— 表现为「金融概念跑到最后一块」。
    const PERIOD_NO = periodNoOf('knowledge_entries')
    const SERIES_KEY = `COALESCE(NULLIF(knowledge_entries.source_label, ''), knowledge_entries.source)`
    const SERIES_KEY_X = `COALESCE(NULLIF(x.source_label, ''), x.source)`
    const rawSort = String(req.query.sort || '').trim()
    const sortKey = rawSort === 'date_asc' || rawSort === 'series' ? rawSort : 'date_desc'
    const orderSql = sortKey === 'date_asc'
      ? 'ORDER BY origin_date ASC, create_time ASC'
      : sortKey === 'series'
        // 系列块的先后：先看「这个系列最新一期是哪天」（否则早些时候用得多、现在停更的系列
        // 会一直压在最上面），同一天再比「这个系列跑到第几期」——跑得最远的排前面。
        // 最后才按系列名兜底，保证结果稳定、翻页不会跳条。
        ? `ORDER BY (SELECT MAX(x.origin_date) FROM knowledge_entries x WHERE ${SERIES_KEY_X} = ${SERIES_KEY}) DESC, (SELECT MAX(${periodNoOf('x')}) FROM knowledge_entries x WHERE ${SERIES_KEY_X} = ${SERIES_KEY}) DESC, ${SERIES_KEY} ASC, ${PERIOD_NO} DESC, origin_date DESC, create_time DESC`
        : 'ORDER BY origin_date DESC, create_time DESC'

    const [[cnt]] = await pool.query(`SELECT COUNT(*) AS n FROM knowledge_entries ${whereSql}`, params)
    const total = Number(cnt.n)
    // 全库总数：工作台的「知识沉淀 N 条」要用它，不能被页面上的临时筛选带着走
    const [[allCnt]] = await pool.query('SELECT COUNT(*) AS n FROM knowledge_entries')
    const totalAll = Number(allCnt.n)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const cur = Math.min(page, totalPages)
    // LIMIT/OFFSET 已 parseInt 并夹在合法区间，直接拼数字（mysql2 对 LIMIT ? 的占位处理不统一）
    const [rows] = await pool.query(
      `SELECT id, source, source_label, source_id, title, content, tags_json, origin_date, attachment_url, attachment_type, create_time, update_time
       FROM knowledge_entries ${whereSql} ${orderSql}
       LIMIT ${pageSize} OFFSET ${(cur - 1) * pageSize}`,
      params
    )

    const [srcRows] = await pool.query("SELECT DISTINCT COALESCE(NULLIF(source_label, ''), source) AS s FROM knowledge_entries")
    const [tagRows] = await pool.query('SELECT tags_json FROM knowledge_entries')
    const tagSet = new Set()
    for (const r of tagRows) for (const t of parse(r.tags_json)) tagSet.add(t)

    res.json({
      items: rows.map(knowledgeRow),
      total, totalAll, page: cur, pageSize, totalPages, sort: sortKey,
      facets: { sources: srcRows.map(r => r.s).filter(Boolean), tags: Array.from(tagSet) }
    })
  } catch (error) { next(error) }
})
// 单条取全文：工作台的「今日已读」点标题时按 id 拉正文（列表接口只回当前页，不确定在哪一页）
app.get('/api/knowledge/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, source, source_label, source_id, title, content, tags_json, origin_date, attachment_url, attachment_type, create_time, update_time
       FROM knowledge_entries WHERE id = ? LIMIT 1`,
      [String(req.params.id)]
    )
    if (!rows.length) return res.status(404).json({ message: '条目不存在' })
    res.json(knowledgeRow(rows[0]))
  } catch (error) { next(error) }
})
// 导入：application/json → { html, title?, source?, tags?, originDate?, images? }；text/html → 整个 body 当 HTML
app.post('/api/knowledge/import', async (req, res, next) => {
  try {
    const payload = typeof req.body === 'string' ? { html: req.body } : (req.body || {})
    const html = String(payload.html || '')
    if (!html.trim()) return res.status(400).json({ message: '缺少 HTML 内容' })
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { title, text, rewrittenHtml } = await importHtml({ html, id, images: Array.isArray(payload.images) ? payload.images : [], uploadsRoot })
    const finalTitle = (typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : title || '未命名报告').slice(0, 255)
    const sourceLabel = typeof payload.source === 'string' && payload.source.trim() ? payload.source.trim().slice(0, 255) : null
    const tags = Array.isArray(payload.tags) ? payload.tags.map(t => String(t).trim()).filter(Boolean) : []
    const originDate = typeof payload.originDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.originDate) ? payload.originDate : new Date().toISOString().slice(0, 10)
    const now = Date.now()
    // 同名同日期去重守卫：默认拦截，前端确认后带 force:true 重发即可放行
    if (payload.force !== true) {
      const [dup] = await pool.execute(
        'SELECT id FROM knowledge_entries WHERE title = ? AND origin_date = ? LIMIT 1',
        [finalTitle, originDate]
      )
      if (dup.length) {
        // 此刻 importHtml 已把内嵌图片落盘到 uploads/knowledge/<id>/，必须清理，否则留孤儿文件
        await fsp.rm(path.join(uploadsRoot, 'knowledge', id), { recursive: true, force: true })
        return res.status(409).json({
          message: `已存在同日的《${finalTitle}》，是否仍要导入？`,
          duplicate: { id: dup[0].id, title: finalTitle, originDate }
        })
      }
    }
    // 报告原稿落盘（图片 src 已改写为 /uploads 绝对路径，iframe 预览与外部链接均可正常渲染）
    await fsp.mkdir(path.join(uploadsRoot, 'knowledge'), { recursive: true })
    await fsp.writeFile(path.join(uploadsRoot, 'knowledge', `${id}.html`), rewrittenHtml, 'utf8')
    const attachmentUrl = `/uploads/knowledge/${id}.html`
    await pool.execute(
      'INSERT INTO knowledge_entries (id, source, source_label, source_id, title, content, tags_json, origin_date, attachment_url, attachment_type, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, 'import', sourceLabel, '', finalTitle, text, JSON.stringify(tags), originDate, attachmentUrl, 'html', now, now]
    )
    res.json({ ok: true, entry: { id, source: 'import', sourceLabel: sourceLabel || '', sourceId: '', title: finalTitle, content: text, tags, originDate, attachmentUrl, attachmentType: 'html', createTime: now, updateTime: now } })
  } catch (error) { next(error) }
})
app.delete('/api/knowledge/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    await pool.execute('DELETE FROM knowledge_entries WHERE id = ?', [id])
    // 一并清理原稿 HTML 与其内嵌图片目录
    await fsp.rm(path.join(uploadsRoot, 'knowledge', `${id}.html`), { force: true })
    await fsp.rm(path.join(uploadsRoot, 'knowledge', id), { recursive: true, force: true })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.use((error, _req, res, _next) => {
  // body 解析类错误先行映射，避免被误报为「数据库写入失败」
  if (error && error.type === 'entity.too.large') return res.status(413).json({ message: '内容过大（超过 50MB），请拆分后再导入。' })
  if (error && error.type === 'entity.parse.failed') return res.status(400).json({ message: '请求体不是合法 JSON。' })
  console.error(error.message)
  res.status(500).json({ message: '数据库连接或写入失败，请检查 .env 中的 MySQL 配置。' })
})
// ===== 素材库：用户上传的 Q 版图 =====
// 内置 6 张官方原片走前端静态导入；这里只管用户自己加的图（以及以后换的新角色图）。
// 传输用 base64 JSON 而不是 multipart：multer 只剩 node_modules 残留、package.json 里已经没有，
// 换台机器装依赖就会 500。图片本身不大（通常 200KB–2MB），50mb 的 json limit 够用。
const assetDir = path.join(uploadsRoot, 'assets')
const ASSET_EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif' }

const assetRow = r => ({ id: r.id, name: r.name, url: r.url, w: r.w, h: r.h, posY: Number(r.pos_y), zoom: Number(r.zoom), createTime: Number(r.create_time) })

// ===== 应用级配置（单行 app_config） =====
// 素材上限做成可改的：用户在素材库卡片上点数字就能改，所以三个地方都得读同一份值
// —— 卡片文案、前端选图拦截、这里的上传校验。范围 1–200MB 是有意的：
// 小了下不了高清立绘，大了 base64 之后请求体会把内存顶上去。
const APP_CONFIG_ROW = 1
const DEFAULT_ASSET_MAX_MB = 50
const ASSET_MAX_MB_RANGE = [1, 200]

async function getAppConfig() {
  const [rows] = await pool.query('SELECT asset_max_mb FROM app_config WHERE id = ?', [APP_CONFIG_ROW])
  const mb = Math.round(Number(rows?.[0]?.asset_max_mb))
  return { assetMaxMb: Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_ASSET_MAX_MB }
}

app.get('/api/app-config', async (_req, res, next) => {
  try { res.json(await getAppConfig()) } catch (error) { next(error) }
})

app.put('/api/app-config', async (req, res, next) => {
  try {
    const mb = Math.round(Number(req.body?.assetMaxMb))
    if (!Number.isFinite(mb) || mb < ASSET_MAX_MB_RANGE[0] || mb > ASSET_MAX_MB_RANGE[1]) {
      return res.status(400).json({ message: `上限只能填 ${ASSET_MAX_MB_RANGE[0]}–${ASSET_MAX_MB_RANGE[1]}（MB）` })
    }
    await pool.execute(
      'INSERT INTO app_config (id, asset_max_mb) VALUES (?, ?) ON DUPLICATE KEY UPDATE asset_max_mb = VALUES(asset_max_mb)',
      [APP_CONFIG_ROW, mb]
    )
    res.json({ ok: true, ...(await getAppConfig()) })
  } catch (error) { next(error) }
})

app.get('/api/assets', async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, name, url, w, h, pos_y, zoom, create_time FROM asset_images ORDER BY create_time ASC')
    res.json({ items: rows.map(assetRow) })
  } catch (error) { next(error) }
})

app.post('/api/assets', async (req, res, next) => {
  try {
    const body = req.body || {}
    const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(String(body.dataUrl || '').replace(/\s/g, ''))
    if (!m) return res.status(400).json({ message: '图片格式无法识别（只支持 png / jpg / webp / gif）' })
    const ext = ASSET_EXT[m[1].toLowerCase()]
    if (!ext) return res.status(400).json({ message: `不支持 ${m[1]} 格式，请用 png / jpg / webp` })
    const buf = Buffer.from(m[2], 'base64')
    if (!buf.length) return res.status(400).json({ message: '图片是空的' })
    const { assetMaxMb } = await getAppConfig()
    if (buf.length > assetMaxMb * 1024 * 1024) {
      return res.status(413).json({ message: `单张图别超过 ${assetMaxMb}MB（上限可在素材库卡片上改），先压一下` })
    }

    const now = Date.now()
    const id = `a${now}-${Math.random().toString(36).slice(2, 7)}`
    await fsp.mkdir(assetDir, { recursive: true })
    await fsp.writeFile(path.join(assetDir, `${id}.${ext}`), buf)
    const url = `/uploads/assets/${id}.${ext}`
    const name = String(body.name || '').trim().slice(0, 60) || `新素材 ${new Date(now).toLocaleDateString('zh-CN')}`
    const w = Number(body.w) || 0
    const h = Number(body.h) || 0
    const posY = Math.min(100, Math.max(0, Number(body.posY) || 50))
    const zoom = Math.min(3, Math.max(1, Number(body.zoom) || 1.2))
    await pool.execute(
      'INSERT INTO asset_images (id, name, url, w, h, pos_y, zoom, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, url, w, h, posY, zoom, now]
    )
    res.json({ ok: true, item: { id, name, url, w, h, posY, zoom, createTime: now } })
  } catch (error) { next(error) }
})

// 改名 / 调整圆形裁切的构图（posY 纵向偏移 0–100、zoom 放大倍数 1–3）
app.patch('/api/assets/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const [rows] = await pool.execute('SELECT id, name, url, w, h, pos_y, zoom, create_time FROM asset_images WHERE id = ? LIMIT 1', [id])
    if (!rows.length) return res.status(404).json({ message: '素材不存在' })
    const cur = assetRow(rows[0])
    const body = req.body || {}
    const name = body.name === undefined ? cur.name : (String(body.name).trim().slice(0, 60) || cur.name)
    const posY = body.posY === undefined ? cur.posY : Math.min(100, Math.max(0, Number(body.posY)))
    const zoom = body.zoom === undefined ? cur.zoom : Math.min(3, Math.max(1, Number(body.zoom)))
    await pool.execute('UPDATE asset_images SET name = ?, pos_y = ?, zoom = ? WHERE id = ?', [name, posY, zoom, id])
    res.json({ ok: true, item: { ...cur, name, posY, zoom } })
  } catch (error) { next(error) }
})

app.delete('/api/assets/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const [rows] = await pool.execute('SELECT id, url FROM asset_images WHERE id = ? LIMIT 1', [id])
    if (!rows.length) return res.status(404).json({ message: '素材不存在' })
    await pool.execute('DELETE FROM asset_images WHERE id = ?', [id])
    // 文件跟着删，否则 uploads/assets 会攒一堆没人引用的孤儿图
    const file = path.join(assetDir, path.basename(rows[0].url || ''))
    await fsp.rm(file, { force: true })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

// ==================== 网页测评 ====================
// 三张表：eval_products（测谁）/ eval_tasks（测什么）/ eval_runs（测的结果）。
// 全部走独立接口，不进 /api/state —— 回答原文可能几十 KB，塞进 state 会把每次刷新拖慢。
// 矩阵格子和所有统计都由 eval_runs 现算，不存「格子分数」这种冗余字段，复测才不会覆盖历史。

const EVAL_TABLES = ['eval_products', 'eval_tasks', 'eval_runs']
// JSON 列可能为 NULL、也可能是驱动已经解好的数组，统一兜成数组，别让前端拿到字符串
const safeJson = (v, dft) => {
  if (v === null || v === undefined) return dft
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return dft }
}
const evalProductRow = r => ({
  id: r.id, name: r.name, url: r.url || '', tag: r.tag || '',
  color: r.color || '', memo: r.memo || '', sortNo: Number(r.sort_no) || 0
})
const evalTaskRow = r => ({
  id: r.id, name: r.name, brief: r.brief || '',
  prompt: r.prompt || '', sortNo: Number(r.sort_no) || 0
})

// 一格里可能测过多次：矩阵显示「最后一次」，角标显示次数，历史全留。
// MySQL 5.7 没有窗口函数，用 GROUP_CONCAT 按 create_time 倒序取第一个值，
// 比「先取 MAX(create_time) 再 JOIN」稳 —— 同一毫秒写两条也不会重复或漏。
const EVAL_CELL_SQL = `
  SELECT product_id AS pid, task_id AS tid, COUNT(*) AS n,
         CAST(SUBSTRING_INDEX(GROUP_CONCAT(score ORDER BY create_time DESC, id DESC), ',', 1) AS UNSIGNED) AS score,
         SUBSTRING_INDEX(GROUP_CONCAT(run_date ORDER BY create_time DESC, id DESC), ',', 1) AS runDate
  FROM eval_runs GROUP BY product_id, task_id`

async function evalOverview() {
  const [[products], [tasks], [cells], [totals]] = await Promise.all([
    pool.query('SELECT id, name, url, tag, color, memo, sort_no FROM eval_products ORDER BY sort_no ASC, create_time ASC'),
    pool.query('SELECT id, name, brief, prompt, sort_no FROM eval_tasks ORDER BY sort_no ASC, create_time ASC'),
    pool.query(EVAL_CELL_SQL),
    pool.query('SELECT COUNT(*) AS runs FROM eval_runs')
  ])
  const items = cells.map(c => ({
    pid: c.pid, tid: c.tid, score: Number(c.score) || 0,
    n: Number(c.n) || 0, date: c.runDate || ''
  }))
  return {
    products: products.map(evalProductRow),
    tasks: tasks.map(evalTaskRow),
    cells: items,
    stats: {
      runs: Number(totals?.[0]?.runs) || 0,
      // 有记录的格子数，前端用它和 products×tasks 对比出「还没测的组合」
      filled: items.length
    }
  }
}

app.get('/api/eval/overview', async (_req, res, next) => {
  try { res.json(await evalOverview()) } catch (error) { next(error) }
})

// 测试流水：按时间倒序，只回摘要（excerpt），正文点开再看
app.get('/api/eval/runs', async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 40))
    const pid = String(req.query.pid || '').trim()
    const tid = String(req.query.tid || '').trim()
    const where = []
    const args = []
    if (pid) { where.push('product_id = ?'); args.push(pid) }
    if (tid) { where.push('task_id = ?'); args.push(tid) }
    const sql = `SELECT id, product_id, task_id, score, good_json, bad_json, seconds, run_date, create_time, LEFT(answer, 160) AS excerpt
                 FROM eval_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY create_time DESC, id DESC LIMIT ?`
    const [rows] = await pool.query(sql, [...args, limit])
    res.json({
      items: rows.map(r => ({
        id: r.id, pid: r.product_id, tid: r.task_id, score: Number(r.score) || 0,
        good: safeJson(r.good_json, []), bad: safeJson(r.bad_json, []),
        seconds: Number(r.seconds) || 0, date: r.run_date || '',
        createTime: Number(r.create_time) || 0, excerpt: r.excerpt || ''
      }))
    })
  } catch (error) { next(error) }
})

// 单条详情：含提问与完整回答原文
app.get('/api/eval/runs/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, product_id, task_id, score, good_json, bad_json, seconds, prompt, answer, note, run_date, create_time
       FROM eval_runs WHERE id = ? LIMIT 1`, [String(req.params.id)]
    )
    if (!rows.length) return res.status(404).json({ message: '这条记录不在了' })
    const r = rows[0]
    res.json({
      item: {
        id: r.id, pid: r.product_id, tid: r.task_id, score: Number(r.score) || 0,
        good: safeJson(r.good_json, []), bad: safeJson(r.bad_json, []),
        seconds: Number(r.seconds) || 0, prompt: r.prompt || '', answer: r.answer || '',
        note: r.note || '', date: r.run_date || '', createTime: Number(r.create_time) || 0
      }
    })
  } catch (error) { next(error) }
})

// 记一次评测。同一格可以反复记，每次都新增一条，历史不动。
app.post('/api/eval/runs', async (req, res, next) => {
  try {
    const body = req.body || {}
    const pid = String(body.pid || '').trim()
    const tid = String(body.tid || '').trim()
    const score = Math.round(Number(body.score))
    if (!pid || !tid) return res.status(400).json({ message: '缺产品或任务' })
    if (!Number.isFinite(score) || score < 1 || score > 5) return res.status(400).json({ message: '评分只能是 1–5' })
    const [[p], [t]] = await Promise.all([
      pool.execute('SELECT id FROM eval_products WHERE id = ? LIMIT 1', [pid]),
      pool.execute('SELECT id FROM eval_tasks WHERE id = ? LIMIT 1', [tid])
    ])
    if (!p.length) return res.status(404).json({ message: '产品不在了，刷新一下' })
    if (!t.length) return res.status(404).json({ message: '任务不在了，刷新一下' })

    const now = Date.now()
    const id = `r${now}-${Math.random().toString(36).slice(2, 7)}`
    const strArr = v => JSON.stringify(Array.isArray(v) ? v.map(x => String(x).slice(0, 32)).slice(0, 12) : [])
    await pool.execute(
      `INSERT INTO eval_runs (id, product_id, task_id, score, good_json, bad_json, seconds, prompt, answer, note, run_date, create_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, pid, tid, score, strArr(body.good), strArr(body.bad),
       Math.max(0, Math.min(86400, Math.round(Number(body.seconds) || 0))),
       String(body.prompt || '').slice(0, 8000), String(body.answer || '').slice(0, 200000),
       String(body.note || '').slice(0, 500), todayStr(), now]
    )
    res.json({ ok: true, id, ...(await evalOverview()) })
  } catch (error) { next(error) }
})

app.delete('/api/eval/runs/:id', async (req, res, next) => {
  try {
    const [r] = await pool.execute('DELETE FROM eval_runs WHERE id = ?', [String(req.params.id)])
    if (!r.affectedRows) return res.status(404).json({ message: '这条记录已经删过了' })
    res.json({ ok: true, ...(await evalOverview()) })
  } catch (error) { next(error) }
})

// —— 被测产品 ——
app.post('/api/eval/products', async (req, res, next) => {
  try {
    const body = req.body || {}
    const name = String(body.name || '').trim().slice(0, 120)
    if (!name) return res.status(400).json({ message: '产品名不能为空' })
    const now = Date.now()
    const id = `p${now}-${Math.random().toString(36).slice(2, 7)}`
    const [[maxRow]] = await pool.query('SELECT COALESCE(MAX(sort_no), -1) AS m FROM eval_products')
    await pool.execute(
      'INSERT INTO eval_products (id, name, url, tag, color, memo, sort_no, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, String(body.url || '').trim().slice(0, 300), String(body.tag || '').trim().slice(0, 32),
       /^#[0-9a-f]{3,8}$/i.test(String(body.color || '')) ? body.color : '',
       String(body.memo || '').trim().slice(0, 500), Number(maxRow?.[0]?.m ?? -1) + 1, now]
    )
    res.json({ ok: true, id, ...(await evalOverview()) })
  } catch (error) { next(error) }
})

app.patch('/api/eval/products/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const [rows] = await pool.execute('SELECT id, name, url, tag, color, memo, sort_no FROM eval_products WHERE id = ? LIMIT 1', [id])
    if (!rows.length) return res.status(404).json({ message: '产品不在了' })
    const cur = evalProductRow(rows[0])
    const b = req.body || {}
    const name = b.name === undefined ? cur.name : (String(b.name).trim().slice(0, 120) || cur.name)
    await pool.execute(
      'UPDATE eval_products SET name = ?, url = ?, tag = ?, color = ?, memo = ? WHERE id = ?',
      [name,
       b.url === undefined ? cur.url : String(b.url).trim().slice(0, 300),
       b.tag === undefined ? cur.tag : String(b.tag).trim().slice(0, 32),
       b.color === undefined ? cur.color : (/^#[0-9a-f]{3,8}$/i.test(String(b.color)) ? b.color : cur.color),
       b.memo === undefined ? cur.memo : String(b.memo).trim().slice(0, 500),
       id]
    )
    res.json({ ok: true, ...(await evalOverview()) })
  } catch (error) { next(error) }
})

// 删产品：默认不删它的评测记录。库里还有记录时返回 409 + 条数，
// 前端确认后带 ?withRuns=1 再请求一次才连记录一起删 —— 免得手滑把测过的原文清了。
app.delete('/api/eval/products/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const [rows] = await pool.execute('SELECT id, name FROM eval_products WHERE id = ? LIMIT 1', [id])
    if (!rows.length) return res.status(404).json({ message: '产品不在了' })
    const [[cnt]] = await pool.execute('SELECT COUNT(*) AS n FROM eval_runs WHERE product_id = ?', [id])
    const n = Number(cnt?.n) || 0
    if (n && String(req.query.withRuns || '') !== '1') {
      return res.status(409).json({ message: `${rows[0].name} 还有 ${n} 条评测记录`, duplicate: true, runs: n })
    }
    await pool.execute('DELETE FROM eval_runs WHERE product_id = ?', [id])
    await pool.execute('DELETE FROM eval_products WHERE id = ?', [id])
    res.json({ ok: true, deletedRuns: n, ...(await evalOverview()) })
  } catch (error) { next(error) }
})

// —— 测试任务 ——
app.post('/api/eval/tasks', async (req, res, next) => {
  try {
    const body = req.body || {}
    const name = String(body.name || '').trim().slice(0, 120)
    if (!name) return res.status(400).json({ message: '任务名不能为空' })
    const now = Date.now()
    const id = `t${now}-${Math.random().toString(36).slice(2, 7)}`
    const [[maxRow]] = await pool.query('SELECT COALESCE(MAX(sort_no), -1) AS m FROM eval_tasks')
    await pool.execute(
      'INSERT INTO eval_tasks (id, name, brief, prompt, sort_no, create_time) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, String(body.brief || '').trim().slice(0, 500), String(body.prompt || '').slice(0, 8000),
       Number(maxRow?.[0]?.m ?? -1) + 1, now]
    )
    res.json({ ok: true, id, ...(await evalOverview()) })
  } catch (error) { next(error) }
})

app.patch('/api/eval/tasks/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const [rows] = await pool.execute('SELECT id, name, brief, prompt, sort_no FROM eval_tasks WHERE id = ? LIMIT 1', [id])
    if (!rows.length) return res.status(404).json({ message: '任务不在了' })
    const cur = evalTaskRow(rows[0])
    const b = req.body || {}
    const name = b.name === undefined ? cur.name : (String(b.name).trim().slice(0, 120) || cur.name)
    await pool.execute(
      'UPDATE eval_tasks SET name = ?, brief = ?, prompt = ? WHERE id = ?',
      [name,
       b.brief === undefined ? cur.brief : String(b.brief).trim().slice(0, 500),
       b.prompt === undefined ? cur.prompt : String(b.prompt).slice(0, 8000),
       id]
    )
    res.json({ ok: true, ...(await evalOverview()) })
  } catch (error) { next(error) }
})

app.delete('/api/eval/tasks/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id)
    const [rows] = await pool.execute('SELECT id, name FROM eval_tasks WHERE id = ? LIMIT 1', [id])
    if (!rows.length) return res.status(404).json({ message: '任务不在了' })
    const [[cnt]] = await pool.execute('SELECT COUNT(*) AS n FROM eval_runs WHERE task_id = ?', [id])
    const n = Number(cnt?.n) || 0
    if (n && String(req.query.withRuns || '') !== '1') {
      return res.status(409).json({ message: `这条任务已有 ${n} 条评测记录`, duplicate: true, runs: n })
    }
    await pool.execute('DELETE FROM eval_runs WHERE task_id = ?', [id])
    await pool.execute('DELETE FROM eval_tasks WHERE id = ?', [id])
    res.json({ ok: true, deletedRuns: n, ...(await evalOverview()) })
  } catch (error) { next(error) }
})

app.delete('/api/state', async (_req, res, next) => {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 仅清空业务数据，保留 categories 默认种子
    await conn.query('SET FOREIGN_KEY_CHECKS=0')
    for (const table of ['year_plans', 'month_plans', 'check_tasks', 'daily_checkins', 'daily_discovers', 'knowledge_entries', 'transactions', 'eval_runs']) await conn.query(`DELETE FROM ${table}`)
    await conn.query('SET FOREIGN_KEY_CHECKS=1')
    await conn.execute('INSERT IGNORE INTO categories (name) VALUES (?), (?), (?), (?), (?), (?), (?), (?)', ['未分类', '学习', '工作', '健康', '运动', '阅读', '生活', '理财'])
    // 重置 finance_config 默认值
    await conn.execute('INSERT INTO finance_config (id, opening_balance, month_budget) VALUES (1, 0, 0) ON DUPLICATE KEY UPDATE opening_balance=0, month_budget=0')
    await conn.commit(); res.json({ ok: true, message: '所有业务数据已清空' })
  } catch (error) { await conn.rollback(); next(error) } finally { conn.release() }
})
app.listen(port, () => {
  console.log(`${appName} API: http://localhost:${port}`)
  // 每日发现收件箱：启动即消费一次，之后按 DISCOVER_POLL_MS 轮询（设为 0 则只在启动时扫）
  const scan = () => ingestInbox().catch(error => console.error(`[每日发现] 收件箱扫描异常：${error.message}`))
  scan()
  if (inboxPollMs > 0) setInterval(scan, inboxPollMs).unref()
  // 定时任务产出目录：启动扫一次把历史补齐进知识库，之后每 OUTPUT_POLL_MS 跟一次（默认 5 分钟）
  const sync = () => syncOutputs().catch(error => console.error(`[知识库] 产出同步异常：${error.message}`))
  sync()
  if (outputPollMs > 0) setInterval(sync, outputPollMs).unref()
  // AI 大事：与知识库同一个节奏扫。任务只写文件，这里负责落库，服务重启也不会漏。
  const aiSync = () => syncAiEventFiles().catch(error => console.error(`[AI 时间线] 文件同步异常：${error.message}`))
  aiSync()
  if (outputPollMs > 0) setInterval(aiSync, outputPollMs).unref()

  // 好公司行情：美股收盘对应北京时间凌晨，这里在 6:30 之后自动刷一次。
  // 用内存记日期保证一天只刷一次；服务重启后当天会再刷一次，代价是多几个请求，
  // 换来的是「重启也不会整天不更新」。
  let quoteDay = ''
  const syncQuotes = async () => {
    const now = new Date()
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (quoteDay === day) return
    if (now.getHours() * 100 + now.getMinutes() < 630) return
    quoteDay = day
    try {
      const { done, failed } = await refreshAllQuotes()
      if (done.length) console.log(`[好公司] 行情已更新 ${done.length} 家${failed.length ? `，失败 ${failed.length} 家` : ''}`)
    } catch (error) {
      console.error(`[好公司] 行情更新异常：${error.message}`)
    }
  }
  setTimeout(syncQuotes, 20 * 1000).unref()
  setInterval(syncQuotes, 15 * 60 * 1000).unref()
})
