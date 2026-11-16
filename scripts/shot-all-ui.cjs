// 批量截图当前 6 页真实 UI（浅色），用于对照 input-prototype.html 规范定位问题
const PW = 'C:/Users/LEGION/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright'
const { chromium } = require(PW)
const { mkdirSync } = require('node:fs')
const OUT = 'C:/Users/LEGION/Desktop/执行工作台/outputs'
mkdirSync(OUT, { recursive: true })

const pages = ['home','checkin','finance','discover','knowledge','mindmap']
const key = { home:'1', checkin:'2', finance:'3', discover:'4', knowledge:'5', mindmap:'6' }

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('[PAGE-ERR]', e.message))
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1200)
  for (const name of pages) {
    // 键盘切页（确保焦点不在输入框）
    await page.keyboard.press('Escape')
    await page.keyboard.press(key[name])
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/now-${name}.png` })
    console.log('shot', name)
  }
  await browser.close()
  console.log('DONE')
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
