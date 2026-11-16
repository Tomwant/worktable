const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
// 品牌名唯一来源：根目录 app.config.json
const appConfig = require('../app.config.json')

// ── 待机/锁屏/关屏防退出：窗口被遮挡或失焦时不禁用渲染、不冻结后台计时器 ──
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// ── dev 模式自动探测前端端口：vite 默认 5173，被别的项目占用时会自动递增到 5174/5175… ──
// 用 app.config.json 的品牌名匹配首页标题，避免把同时运行的其他 vite 项目误认成自己
let devUrl = null
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function resolveDevUrl(attempts = 24) {
  if (process.env.ELECTRON_START_URL) return process.env.ELECTRON_START_URL
  for (let i = 0; i < attempts; i++) {
    for (const port of [5173, 5174, 5175, 5176, 5177]) {
      try {
        const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(700) })
        if (!res.ok) continue
        const html = await res.text()
        if (html.includes(appConfig.name) && html.includes('/@vite/client')) return `http://localhost:${port}`
      } catch {}
    }
    await sleep(500)
  }
  console.error('[main] 未探测到工作台前端，回退 5173')
  return 'http://localhost:5173'
}

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    title: appConfig.name,
    backgroundColor: '#fff9ef',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  const prodUrl = 'file://' + path.join(__dirname, '..', 'dist', 'index.html')
  window.loadURL(app.isPackaged ? prodUrl : devUrl || 'http://localhost:5173')
  window.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })

  // ── 崩溃自愈：渲染进程崩溃 / 无响应 → 自动刷新恢复，而不是让窗口消失触发退出 ──
  let lastCrashAt = 0
  window.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    const now = Date.now()
    if (now - lastCrashAt < 5000) return // 5 秒内连续崩则不再热重载，避免死循环刷屏
    lastCrashAt = now
    console.error('[main] renderer gone:', details.reason, details.exitCode, '→ auto reload')
    setTimeout(() => { if (!window.isDestroyed()) window.webContents.reload() }, 800)
  })
  window.webContents.on('unresponsive', () => {
    const now = Date.now()
    if (now - lastCrashAt < 5000) return
    lastCrashAt = now
    console.error('[main] renderer unresponsive → auto reload')
    setTimeout(() => { if (!window.isDestroyed()) window.webContents.reload() }, 500)
  })
  window.on('closed', () => console.error('[main] window closed @', new Date().toLocaleTimeString()))
  return window
}

// ── GPU / 子进程掉线兜底（睡眠、关屏后最常见）：记录并自动刷新窗口 ──
app.on('child-process-gone', (_e, details) => {
  if (details.type === 'GPU' || details.reason === 'crashed' || details.reason === 'killed') {
    console.error('[main] child process gone:', details.type, details.reason)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) setTimeout(() => win.webContents.reload(), 600)
    }
  }
})

app.whenReady().then(async () => {
  if (!app.isPackaged) {
    devUrl = await resolveDevUrl()
    console.error('[main] devUrl =', devUrl)
  }
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ── 退出诊断：任何退出路径都在终端留痕，用于定位"自动退出"根因 ──
app.on('before-quit', () => console.error('[main] before-quit 触发 @', new Date().toLocaleTimeString()))
app.on('will-quit', () => console.error('[main] will-quit @', new Date().toLocaleTimeString()))
process.on('exit', code => console.error('[main] 进程退出 code=' + code + ' @', new Date().toLocaleTimeString()))
