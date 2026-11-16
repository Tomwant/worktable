// 决定性验证：读当前 5173 真实渲染的输入框/下拉圆角 + 截图
const { createRequire } = require('module')
const req = createRequire(require('path').join(process.env.HOME, 'AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/'))
const { chromium } = req('playwright')
const { mkdirSync } = require('node:fs')

;(async () => {
  mkdirSync('outputs', { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.keyboard.press('3') // finance
  await page.waitForTimeout(1000)

  const r = await page.evaluate(() => {
    const nInput = document.querySelector('.n-input')
    const sel = document.querySelector('.n-base-selection')
    const inputBorder = document.querySelector('.n-input__border')
    const cs = el => el ? getComputedStyle(el) : null
    return {
      inputRadiusVar: cs(nInput)?.getPropertyValue('--n-border-radius'),
      inputRootRadius: cs(nInput)?.borderRadius,
      inputBorderEl: cs(inputBorder)?.border,
      selectRadius: cs(sel)?.borderRadius
    }
  })
  console.log('当前 5173 真实渲染：', JSON.stringify(r, null, 2))

  await page.screenshot({ path: 'outputs/style-finance.png' })
  // 聚焦输入框看光晕
  await page.evaluate(() => { const el = document.querySelector('.n-input__input-el'); if (el) el.focus() })
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'outputs/style-focus.png' })

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
