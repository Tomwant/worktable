// 验证 5173 端口加载的输入框圆角是否为新代码（14px）
const { createRequire } = require('module')
const req = createRequire(require('path').join(process.env.HOME, 'AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/'))
const { chromium } = req('playwright')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.keyboard.press('3') // finance
  await page.waitForTimeout(800)

  const r = await page.evaluate(() => {
    const nInput = document.querySelector('.n-input')
    const border = document.querySelector('.n-input__border')
    return {
      radiusVar: nInput ? getComputedStyle(nInput).getPropertyValue('--n-border-radius') : 'no .n-input',
      rootRadius: nInput ? getComputedStyle(nInput).borderRadius : '-',
      borderEl: border ? getComputedStyle(border).border : '-'
    }
  })
  console.log(JSON.stringify(r, null, 2))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
