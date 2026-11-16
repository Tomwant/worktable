const path = require('path')
const { createRequire } = require('module')
const home = process.env.USERPROFILE || 'C:/Users/LEGION'
const PW = path.join(home, 'AppData', 'Local', 'npm-cache', '_npx', 'e41f203b7505f1fb', 'node_modules')
const pwReq = createRequire(path.join(PW, '..', '__pw__.js'))
const { chromium } = pwReq('playwright')
const { mkdirSync } = require('node:fs')
;(async () => {
  const OUT = 'outputs'
  mkdirSync(OUT, { recursive: true })
  const errors = []
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
  const shot = async (n) => page.screenshot({ path: `${OUT}/${n}.png` })
  await page.goto('http://localhost:5175/', { waitUntil: 'networkidle', timeout: 35000 })
  await page.waitForTimeout(600)
  // 资金管理
  await page.click('.side nav button:has-text("资金管理")', { timeout: 5000 }); await page.waitForTimeout(700); await shot('naive-finance')
  // 每日发现
  await page.click('.side nav button:has-text("每日发现")', { timeout: 5000 }); await page.waitForTimeout(700); await shot('naive-discover')
  // 打开发现弹窗
  try { await page.click('button:has-text("记录新发现")', { timeout: 4000 }); await page.waitForTimeout(600); await shot('naive-discover-modal') } catch (e) { errors.push('modal: ' + e.message) }
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  // 知识库
  await page.click('.side nav button:has-text("知识库")', { timeout: 5000 }); await page.waitForTimeout(700); await shot('naive-knowledge')
  // 功能地图
  await page.click('.side nav button:has-text("功能地图")', { timeout: 5000 }); await page.waitForTimeout(700); await shot('naive-mindmap')
  await browser.close()
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'PAGES QA OK')
})()
