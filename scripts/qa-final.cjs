// 最终确认：边框元素实际渲染 + focus 态截图
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

  const before = await page.evaluate(() => {
    const border = document.querySelector('.n-input__border')
    const sb = document.querySelector('.n-input__state-border')
    const root = document.querySelector('.n-input')
    return {
      rootRadius: root ? getComputedStyle(root).borderRadius : '-',
      borderElBorder: border ? getComputedStyle(border).border : '-',
      borderElRadius: border ? getComputedStyle(border).borderRadius : '-',
      stateBorderDefault: sb ? getComputedStyle(sb).border : '-'
    }
  })

  // 聚焦第一个输入框
  await page.evaluate(() => {
    const el = document.querySelector('.n-input__input-el')
    if (el) el.focus()
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'outputs/input-focus.png' })

  const after = await page.evaluate(() => {
    const sb = document.querySelector('.n-input__state-border')
    const root = document.querySelector('.n-input')
    return {
      stateBorderFocus: sb ? getComputedStyle(sb).border : '-',
      rootBoxShadowFocus: root ? getComputedStyle(root).boxShadow : '-'
    }
  })

  console.log('=== 默认态 ===')
  console.log(JSON.stringify(before, null, 2))
  console.log('=== focus 态 ===')
  console.log(JSON.stringify(after, null, 2))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
