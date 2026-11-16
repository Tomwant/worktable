import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 品牌名唯一来源：根目录 app.config.json
// 用 fs 读取而非 import，避免 Node ESM 对 JSON 模块要求 import 断言的问题
const appConfig = JSON.parse(readFileSync(new URL('./app.config.json', import.meta.url), 'utf8'))
const appInitial = Array.from(appConfig.name)[0] || 'W'
const faviconHref = 'data:image/svg+xml,' + [
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>",
  "<rect width='32' height='32' rx='7' fill='%234a9e66'/>",
  `<text x='16' y='23' font-size='18' text-anchor='middle' fill='%23ffffff' font-family='sans-serif'>${encodeURIComponent(appInitial)}</text>`,
  '</svg>'
].join('').replace(/</g, '%3C').replace(/>/g, '%3E')

// 把 index.html 中的 %APP_NAME% / %APP_FAVICON% 占位符替换为配置值（dev 与 build 均生效）
const injectBrand = () => ({
  name: 'inject-brand',
  transformIndexHtml: html => html
    .replaceAll('%APP_NAME%', appConfig.name)
    .replaceAll('%APP_FAVICON%', faviconHref)
})

// 演示数据注入：靠 publicDir 切换，不额外写拷贝脚本
//   · 正式版 publicDir = public/（空目录，只有一个占位文件）
//   · 演示版 publicDir = demodata/（里面有 demo/bundle.json + uploads/knowledge/*.html）
// 这样正式版构建绝不会把真实数据打进 dist，演示版也不需要后处理
export default defineConfig(({ mode }) => ({
  plugins: [vue(), injectBrand()],
  publicDir: mode === 'demo' ? 'demodata' : 'public',
  base: './',
  server: { proxy: { '/api': 'http://localhost:3001', '/uploads': 'http://localhost:3001' } }
}))
