// 聚焦月计划输入框，截图修复后效果
const { chromium } = require('C:\\Users\\LEGION\\AppData\\Local\\npm-cache\\_npx\\e41f203b7505f1fb\\node_modules\\playwright')
const { mkdirSync } = require('node:fs')
;(async () => {
  mkdirSync('outputs', { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })

  // 切到"计划打卡"页（nav pill 的第二个）
  const planTab = await page.locator('button').filter({ hasText: '计划打卡' }).first()
  await planTab.click()
  await page.waitForTimeout(500)

  // 找月计划输入框（"本月想推进什么？"placeholder）并聚焦
  const monthInput = page.locator('input[placeholder="本月想推进什么？"]')
  await monthInput.scrollIntoViewIfNeeded()
  await monthInput.focus()
  await page.waitForTimeout(400)

  await page.screenshot({ path: 'outputs/fix-month-focused.png' })

  // 数值验证：n-input 内部 input 的 box-shadow 应该只剩 Naive 自带那一层
  const info = await page.evaluate(() => {
    const root = document.querySelector('.n-input')
    const innerEl = document.querySelector('input.n-input__input-el')
    const stateBorder = document.querySelector('.n-input__state-border')
    return {
      rootBoxShadow: root ? getComputedStyle(root).boxShadow : 'no-root',
      rootBorderRadius: root ? getComputedStyle(root).borderRadius : 'no-root',
      innerBoxShadow: innerEl ? getComputedStyle(innerEl).boxShadow : 'no-inner',
      innerBorderRadius: innerEl ? getComputedStyle(innerEl).borderRadius : 'no-inner',
      stateBorderBoxShadow: stateBorder ? getComputedStyle(stateBorder).boxShadow : 'no-state',
      stateBorderBorderRadius: stateBorder ? getComputedStyle(stateBorder).borderRadius : 'no-state',
    }
  })
  console.log(JSON.stringify(info, null, 2))

  // 截图未聚焦态对照
  await page.locator('h1,.brand,body').first().click({ position: { x: 5, y: 5 } })
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'outputs/fix-month-unfocused.png' })

  await browser.close()
})()
