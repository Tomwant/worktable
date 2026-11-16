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
  const BASE = 'http://localhost:5175/'
  const errors = []
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()) })

  const shot = async (name) => page.screenshot({ path: `${OUT}/${name}.png` })
  const clickSel = async (locator, label) => {
    try { await locator.scrollIntoViewIfNeeded(); await locator.click({ timeout: 4000 }); await page.waitForTimeout(600) }
    catch (e) { errors.push(`${label}: ${e.message}`) }
  }

  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 35000 })
    await page.waitForTimeout(900)
    await shot('naive-home')

    await page.click('.side nav button:has-text("计划打卡")', { timeout: 5000 })
    await page.waitForTimeout(700)
    await shot('naive-checkin')

    const yr = page.locator('.selectors .app-sel').first()
    await clickSel(yr, 'year-select')
    await shot('naive-checkin-year-open')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    const cat = page.locator('.row2 .app-sel.compact').first()
    await clickSel(cat, 'category-chip')
    await shot('naive-checkin-cat-open')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    const mp = page.locator('.row2 .app-sel').nth(1)
    await clickSel(mp, 'month-yearplan')
    await shot('naive-checkin-month-open')

    await page.click('.side nav button:has-text("资金管理")', { timeout: 5000 })
    await page.waitForTimeout(700)
    await shot('naive-finance')

    await page.click('.side nav button:has-text("知识库")', { timeout: 5000 })
    await page.waitForTimeout(700)
    await shot('naive-knowledge')
  } catch (e) { errors.push('SCRIPT: ' + e.message) }

  await browser.close()
  console.log('=== QA RESULT ===')
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS — render OK')
})()
