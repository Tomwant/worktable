// 最终回归：问题1(闪退=同步风暴) 问题2(添加后不生成) + 本地优先防覆盖
const { chromium } = require('C:\\Users\\LEGION\\AppData\\Local\\npm-cache\\_npx\\e41f203b7505f1fb\\node_modules\\playwright')
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })

  // 预置本地数据（模拟用户已有真实打卡项），再启动 —— 验证本地优先不被空后端覆盖
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    const KEY = 'spring-workbench-v2'
    const now = new Date()
    const mk = n => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`
    const y = now.getFullYear(), m = now.getMonth() + 1
    const planId = 'plan-local-001', taskId = 'task-local-001'
    const db = {
      categories: ['未分类', '学习', '工作'],
      yearPlans: [], monthPlans: [{ id: planId, year: y, month: m, yearPlanId: null, name: '本地月计划', category: '学习', desc: '', createTime: Date.now() }],
      checkTasks: [{ id: taskId, monthPlanId: planId, name: '本地打卡项', category: '学习', createTime: Date.now() }],
      checkins: [], discovers: [], knowledge: [], transactions: [],
      finance: { openingBalance: 0, monthBudget: 0 }
    }
    localStorage.setItem(KEY, JSON.stringify(db))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  const kept = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('spring-workbench-v2') || '{}')
    return { tasks: (db.checkTasks || []).map(t => t.name) }
  })
  console.log('本地优先验证: 启动后本地打卡项仍保留 =', kept.tasks.includes('本地打卡项') ? '✅' : '❌ 被覆盖!', JSON.stringify(kept.tasks))

  // 进入计划打卡页，检查每日打卡区生成了本地打卡项
  await page.locator('button', { hasText: '计划打卡' }).first().click()
  await page.waitForTimeout(600)
  const daily = await page.locator('.daily-row .cb-line b').allTextContents()
  console.log('问题2验证: 本地月计划打卡项出现在每日列表 =', daily.includes('本地打卡项') ? '✅' : '❌', JSON.stringify(daily))

  // 再次添加一个任务 → 立即生成
  const taskInput = page.locator('.month-block').first().locator('input[placeholder*="加打卡项"]')
  await taskInput.fill('回归新增项')
  await page.locator('.month-block').first().locator('button', { hasText: '+ 添加' }).click()
  await page.waitForTimeout(500)
  const daily2 = await page.locator('.daily-row .cb-line b').allTextContents()
  console.log('问题2b: 添加后即时生成 =', daily2.includes('回归新增项') ? '✅' : '❌', JSON.stringify(daily2))

  // 高频勾选 + 打字不崩（原 flash:'sync' 每键全量同步 → 卡死）
  const rows = await page.locator('.daily-row .done').count()
  for (let i = 0; i < Math.min(rows, 5); i++) { await page.locator('.daily-row .done').nth(i).click(); await page.waitForTimeout(40) }
  await page.locator('.daily-row .note').first().click()
  await page.locator('.daily-row .note').first().type('回归打字风暴验证', { delay: 10 })
  await page.waitForTimeout(1200)
  const alive = await page.evaluate(() => document.querySelectorAll('.daily-row').length)
  console.log('问题1验证: 高频勾选+打字后页面存活 =', alive > 0 ? '✅' : '❌')
  console.log('JS错误:', errors.length ? errors.join('\n') : '无')

  await page.screenshot({ path: 'outputs/fix-final-regression.png' })
  await browser.close()
})()
