// 前端验证：记一笔应触发 POST /api/transactions，而非全量 PUT /api/state
const { createRequire } = require('module')
const req = createRequire(require('path').join(process.env.HOME, 'AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/'))
const { chromium } = req('playwright')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const requests = []
  page.on('request', r => { if (r.url().includes('/api/')) requests.push(`${r.method()} ${r.url().split('?')[0]}`) })

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.keyboard.press('3') // finance
  await page.waitForTimeout(1000)

  // 记录记一笔前的请求，清空
  requests.length = 0

  // 填金额
  const amtInput = page.locator('.tx-form .n-input__input-el').first()
  await amtInput.fill('100')
  // 点记一笔
  await page.locator('.tx-form button.primary').click()
  await page.waitForTimeout(1500)

  console.log('记一笔触发的 API 请求：')
  requests.forEach(r => console.log('  ' + r))

  // 验证后端数据
  const after = await page.evaluate(async () => {
    const r = await fetch('http://localhost:3001/api/transactions')
    return await r.json()
  })
  console.log('后端 transactions：', JSON.stringify(after))

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
