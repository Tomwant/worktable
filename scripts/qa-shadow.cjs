// 定位 focus box-shadow 光晕所在元素
const { createRequire } = require('module')
const req = createRequire(require('path').join(process.env.HOME, 'AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/'))
const { chromium } = req('playwright')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:5175/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.keyboard.press('3')
  await page.waitForTimeout(800)
  await page.evaluate(() => { const el = document.querySelector('.n-input__input-el'); if (el) el.focus() })
  await page.waitForTimeout(500)

  const r = await page.evaluate(() => {
    const sels = ['.n-input', '.n-input-wrapper', '.n-input__border', '.n-input__state-border']
    const out = {}
    for (const s of sels) {
      const el = document.querySelector(s)
      if (el) {
        const c = getComputedStyle(el)
        out[s] = { boxShadow: c.boxShadow, className: el.className }
      }
    }
    return out
  })
  console.log(JSON.stringify(r, null, 2))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
