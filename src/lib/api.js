// 统一请求出口：全站唯一的 fetch 封装。
//
// 原来有两份实现，行为不一致：
//   · stores/index.js:94  —— body 传对象自动 JSON.stringify，错误只抛 `API 500`，无中文兜底
//   · CompanyView.vue:47  —— 调用方必须自己 JSON.stringify，headers 写死 Content-Type，
//                            错误文案是 `请求失败（500）`，也不认后端返回的 message
// 合并后统一为：body 可传对象或 JSON 字符串、错误带 status/detail、断网给中文提示。

// 演示版（GitHub Pages）开关：构建时由 VITE_DEMO=1 打开，正式版与 Electron 恒为 false
import { DEMO, demoApi, demoFileUrl } from './demo.js'

export const API_BASE = location.protocol === 'file:' ? 'http://localhost:3001' : ''

export class ApiError extends Error {
  constructor(message, status = 0, detail = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

/**
 * @param {string} path   以 / 开头的接口路径
 * @param {object} [opts]
 * @param {string} [opts.method]  默认 GET
 * @param {object|string} [opts.body]  对象会自动 JSON；字符串原样发送
 * @param {object} [opts.headers] 额外请求头（merge，不覆盖 Content-Type）
 * @returns {Promise<any>} 解析后的 JSON；空响应体返回 {}
 */
export async function api(path, { method = 'GET', body, headers, ...rest } = {}) {
  // 演示版没有后端，所有请求交给本地快照层处理（读快照 / 写内存）
  if (DEMO) return demoApi(path, { method, body })

  const init = { method, ...rest }
  const h = { ...(headers || {}) }

  if (body !== undefined && body !== null) {
    if (typeof body === 'string') {
      init.body = body
      if (!h['Content-Type']) h['Content-Type'] = 'application/json'
    } else {
      init.body = JSON.stringify(body)
      if (!h['Content-Type']) h['Content-Type'] = 'application/json'
    }
  }
  if (Object.keys(h).length) init.headers = h

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new ApiError('连不上后端服务，确认 3001 端口是否在跑', 0, null)
  }

  const text = await res.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = { message: text.slice(0, 300) } }
  }

  if (!res.ok) {
    throw new ApiError((data && data.message) || `请求失败（${res.status}）`, res.status, data)
  }
  return data === null ? {} : data
}

/** 拼资源 URL（上传目录里的静态文件等），已带协议的地址原样返回 */
export const fileUrl = url => {
  if (!url) return ''
  if (/^https?:/i.test(url)) return url
  // 演示版走相对路径：GitHub Pages 是 /repo/ 子路径，绝对路径会 404 到根域
  if (DEMO) return demoFileUrl(url)
  return `${API_BASE}${url}`
}
