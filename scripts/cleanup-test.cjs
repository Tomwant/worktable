// 清理测试残留：删除测试打卡项，清空今天的测试 items（恢复用户数据干净）
const { chromium } = require('C:\\Users\\LEGION\\AppData\\Local\\npm-cache\\_npx\\e41f203b7505f1fb\\node_modules\\playwright')
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })

  const result = await page.evaluate(async () => {
    const KEY = 'spring-workbench-v2'
    const db = JSON.parse(localStorage.getItem(KEY) || '{}')
    const TEST_NAMES = ['测试打卡项ABC', '复测任务-即时生成']

    // 1. 找出测试任务 id
    const testTasks = (db.checkTasks || []).filter(t => TEST_NAMES.includes(t.name))
    const testIds = new Set(testTasks.map(t => t.id))
    console.log('发现测试任务:', testTasks.length)

    // 2. 从 checkTasks 删除
    db.checkTasks = (db.checkTasks || []).filter(t => !testIds.has(t.id))

    // 3. 从所有 checkins 的 items 中删除测试任务条目 + 清空今天的测试备注
    for (const c of db.checkins || []) {
      c.items = (c.items || []).filter(i => !testIds.has(i.taskId))
      // 今天条目若有"高频输入测试"备注则清掉（保留今天自身状态）
      for (const i of c.items) {
        if (i.note && i.note.includes('高频输入测试')) i.note = ''
      }
    }

    // 4. 写回 localStorage
    localStorage.setItem(KEY, JSON.stringify(db))
    return { removed: testTasks.length, tasksLeft: db.checkTasks.length, checkinsLeft: (db.checkins || []).length }
  })

  console.log('本地清理结果:', JSON.stringify(result))
  await browser.close()
})()
