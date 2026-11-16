// 诊断：探测 Naive Input 根元素的实际 inline style 与 CSS 变量
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

  const r = await page.evaluate(() => {
    const nInput = document.querySelector('.n-input')
    const wrapper = document.querySelector('.n-input-wrapper')
    const cs = nInput ? getComputedStyle(nInput) : null
    return {
      nInputInline: nInput ? nInput.getAttribute('style') : 'no .n-input',
      borderRadiusVar: cs ? cs.getPropertyValue('--n-border-radius') : 'no cs',
      colorVar: cs ? cs.getPropertyValue('--n-color') : '-',
      borderVar: cs ? cs.getPropertyValue('--n-border') : '-',
      boxShadowFocusVar: cs ? cs.getPropertyValue('--n-box-shadow-focus') : '-',
      nInputBorderRadius: cs ? cs.borderRadius : '-',
      wrapperBorderRadius: wrapper ? getComputedStyle(wrapper).borderRadius : '-',
      wrapperBorder: wrapper ? getComputedStyle(wrapper).border : '-',
      wrapperBg: wrapper ? getComputedStyle(wrapper).backgroundColor : '-'
    }
  })
  console.log(JSON.stringify(r, null, 2))
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
