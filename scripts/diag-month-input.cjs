// 深度诊断：在月计划输入框聚焦时，遍历周围所有元素，定位红框里"绿色小矩形"是什么
const { chromium } = require('C:\\Users\\LEGION\\AppData\\Local\\npm-cache\\_npx\\e41f203b7505f1fb\\node_modules\\playwright')
const { mkdirSync } = require('node:fs')
;(async () => {
  mkdirSync('outputs', { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })

  await page.locator('button').filter({ hasText: '计划打卡' }).first().click()
  await page.waitForTimeout(500)
  const monthInput = page.locator('input[placeholder="本月想推进什么？"]')
  await monthInput.scrollIntoViewIfNeeded()
  await monthInput.focus()
  await page.waitForTimeout(400)

  // 用 DOM 找那块绿矩形。从 input 容器向上到 root，遍历 n-input 里所有子元素的 bounding box + border + 颜色
  const dump = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="本月想推进什么？"]')
    if (!input) return { error: 'no input' }
    const nInput = input.closest('.n-input')
    if (!nInput) return { error: 'no n-input' }

    const ir = input.getBoundingClientRect()
    const result = {
      inputRect: { x: ir.x, y: ir.y, w: ir.width, h: ir.height },
      inputComputed: {
        boxShadow: getComputedStyle(input).boxShadow,
        border: getComputedStyle(input).border,
        outline: getComputedStyle(input).outline,
        padding: getComputedStyle(input).padding,
        background: getComputedStyle(input).background.slice(0, 80)
      },
      nInputRect: nInput.getBoundingClientRect(),
      nInputShadow: getComputedStyle(nInput).boxShadow,
      nInputBorder: getComputedStyle(nInput).border,
      // 列出 n-input 内部所有 .n-input__* 子元素的矩形 + 关键样式
      children: []
    }
    nInput.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      result.children.push({
        cls: el.className,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage.slice(0, 60),
        border: cs.border,
        boxShadow: cs.boxShadow.slice(0, 80),
        outline: cs.outline,
        color: cs.color,
        opacity: cs.opacity,
        visibility: cs.visibility,
        display: cs.display
      })
    })
    return result
  })

  console.log(JSON.stringify(dump, null, 2))

  // 高亮那个矩形区域截图
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="本月想推进什么？"]')
    const r = input.getBoundingClientRect()
    const overlay = document.createElement('div')
    overlay.id = 'diag-overlay'
    overlay.style.cssText = `position:fixed;left:${r.x - 4}px;top:${r.y - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2px solid red;background:rgba(255,0,0,.08);z-index:99999;pointer-events:none;`
    document.body.appendChild(overlay)
  })
  await page.screenshot({ path: 'outputs/diag-month-overlay.png' })
  await browser.close()
})()
