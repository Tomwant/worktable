// 复现问题2：添加打卡项后每日打卡区是否生成
const { chromium } = require('C:\\Users\\LEGION\\AppData\\Local\\npm-cache\\_npx\\e41f203b7505f1fb\\node_modules\\playwright')
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()) })

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  // 切到计划打卡
  await page.locator('button', { hasText: '计划打卡' }).first().click()
  await page.waitForTimeout(600)

  // 查看现有数据
  const state1 = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('spring-workbench-v2') || '{}')
    return {
      yearPlans: db.yearPlans?.length || 0,
      monthPlans: db.monthPlans?.length || 0,
      checkTasks: db.checkTasks?.length || 0,
      checkins: db.checkins?.length || 0,
      selectedMonth: new Date().getMonth() + 1,
      year: new Date().getFullYear()
    }
  })
  console.log('初始数据:', JSON.stringify(state1))

  // 若没有本月月计划，先加一个月计划
  const hasMonthPlan = await page.locator('.month-block').count()
  let planName = ''
  if (!hasMonthPlan) {
    await page.locator('input[placeholder="本月想推进什么？"]').fill('测试月计划-每日生成')
    // 选分类
    await page.locator('input[placeholder="本月想推进什么？"]').fill('测试月计划')
    await page.locator('button', { hasText: '+ 新增月计划' }).first().click()
    await page.waitForTimeout(400)
  }
  planName = await page.locator('.month-block summary b').first().textContent().catch(() => '')
  console.log('使用的月计划:', planName)

  // 在第一个月计划下添加打卡项
  const taskInput = page.locator('.month-block').first().locator('input[placeholder*="加打卡项"]')
  await taskInput.fill('测试打卡项ABC')
  await page.locator('.month-block').first().locator('button', { hasText: '+ 添加' }).click()
  await page.waitForTimeout(600)

  // 检查任务是否入 db、以及每日列表是否出现
  const after = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('spring-workbench-v2') || '{}')
    const checkTasks = db.checkTasks || []
    return {
      checkTasks: checkTasks.map(t => t.name),
      taskAdded: checkTasks.some(t => t.name === '测试打卡项ABC'),
      checkinsCount: (db.checkins || []).length
    }
  })
  console.log('添加后:', JSON.stringify(after, null, 2))

  // 每日打卡区显示的任务名
  const dailyNames = await page.locator('.daily-row .cb-line b').allTextContents().catch(() => [])
  console.log('每日打卡区任务:', JSON.stringify(dailyNames))
  console.log('JS错误:', errors.length ? errors.join('\n') : '无')

  await page.screenshot({ path: 'outputs/bug2-daily-missing.png' })
  await browser.close()
})()
