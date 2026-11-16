import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = 'outputs'
mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5175/'
const errors = []
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()) })

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}
async function clickSel(locator, label) {
  try {
    await locator.scrollIntoViewIfNeeded()
    await locator.click({ timeout: 4000 })
    await page.waitForTimeout(600)
  } catch (e) { errors.push(`${label}: ${e.message}`) }
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 35000 })
  await page.waitForTimeout(900)
  await shot('naive-home')

  // 侧边栏进入「计划打卡」
  await page.click('.side nav button:has-text("计划打卡")', { timeout: 5000 })
  await page.waitForTimeout(700)
  await shot('naive-checkin')

  // 打开右上角年份下拉，验证是否贴齐 / 溢出视口
  const yr = page.locator('.selectors .app-sel').first()
  await clickSel(yr, 'year-select')
  await shot('naive-checkin-year-open')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // 打开「选择分类」chip（年计划 row2 的第一个 compact select），验证错位是否根治
  const cat = page.locator('.row2 .app-sel.compact').first()
  await clickSel(cat, 'category-chip')
  await shot('naive-checkin-cat-open')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // 打开月计划年计划关联下拉
  const mp = page.locator('.row2 .app-sel').nth(1)
  await clickSel(mp, 'month-yearplan')
  await shot('naive-checkin-month-open')

  // 资金管理页
  await page.click('.side nav button:has-text("资金管理")', { timeout: 5000 })
  await page.waitForTimeout(700)
  await shot('naive-finance')

  // 知识库页（筛选条含多个下拉/日期）
  await page.click('.side nav button:has-text("知识库")', { timeout: 5000 })
  await page.waitForTimeout(700)
  await shot('naive-knowledge')
} catch (e) {
  errors.push('SCRIPT: ' + e.message)
}

await browser.close()
console.log('=== QA RESULT ===')
console.log(errors.length ? errors.join('\n') : 'NO ERRORS (consoole/page) — render OK')
