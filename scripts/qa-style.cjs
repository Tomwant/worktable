// 数值验证：读取输入框/下拉的实际计算样式，确认圆角14px、软边、玻璃底、focus光晕生效
const { createRequire } = require('module')
const req = createRequire(require('path').join(process.env.HOME, 'AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/'))
const { chromium } = req('playwright')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:5175/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.keyboard.press('3') // finance
  await page.waitForTimeout(800)

  const report = await page.evaluate(() => {
    const out = []
    const input = document.querySelector('.n-input-wrapper')
    const inputEl = document.querySelector('.n-input__input-el')
    const sel = document.querySelector('.n-base-selection')
    const selLabel = document.querySelector('.n-base-selection-label')

    function cs(el) { return el ? getComputedStyle(el) : null }

    const i = cs(input)
    if (i) out.push({
      name: '输入框 wrapper',
      borderRadius: i.borderRadius,
      border: i.border,
      borderColor: i.borderColor,
      backgroundColor: i.backgroundColor,
      height: i.height
    })
    const ie = cs(inputEl)
    if (ie) out.push({ name: '输入框 input 元素', fontSize: ie.fontSize, color: ie.color })

    const s = cs(sel)
    if (s) out.push({
      name: '下拉框 selection',
      borderRadius: s.borderRadius,
      border: s.border,
      borderColor: s.borderColor,
      backgroundColor: s.backgroundColor,
      height: s.height
    })
    const sl = cs(selLabel)
    if (sl) out.push({ name: '下拉框文字', fontSize: sl.fontSize, color: sl.color })
    return out
  })

  // focus 光晕验证：聚焦输入框读取 boxShadow
  const focusReport = await page.evaluate(() => {
    const inputEl = document.querySelector('.n-input__input-el')
    if (inputEl) inputEl.focus()
    const wrapper = document.querySelector('.n-input-wrapper')
    return wrapper ? getComputedStyle(wrapper).boxShadow : 'no wrapper'
  })

  console.log(JSON.stringify(report, null, 2))
  console.log('focus boxShadow:', focusReport)
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
