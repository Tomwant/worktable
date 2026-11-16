// 输入框圆角修复验证：资金管理(输入框) + 计划打卡(年月/分类下拉)
const { createRequire } = require('module')
const req = createRequire(require('path').join(process.env.HOME, 'AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/'))
const { chromium } = req('playwright')
const { mkdirSync } = require('node:fs')

;(async () => {
  mkdirSync('outputs', { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await page.goto('http://localhost:5175/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // 资金管理页（键盘 3）
  await page.keyboard.press('3')
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'outputs/input-finance.png' })

  // 计划打卡页（键盘 2）
  await page.keyboard.press('2')
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'outputs/input-checkin.png' })

  // 打开年份下拉验证
  const selects = page.locator('.n-select')
  const count = await selects.count()
  console.log('n-select 数量:', count)
  if (count > 0) {
    await selects.nth(0).click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'outputs/input-select-open.png' })
  }

  // 聚焦一个输入框验证 focus 光晕
  const inputs = page.locator('.n-input input, .n-input__input-el')
  const icount = await inputs.count()
  console.log('input 数量:', icount)

  await browser.close()
  console.log('errors:', errors.length ? errors.join('\n') : '无')
  console.log('done')
})().catch(e => { console.error(e); process.exit(1) })
