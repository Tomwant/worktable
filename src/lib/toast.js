// 全局轻提示（toast）。同一时刻只显示一条，新消息覆盖旧消息并重置计时。
//
// 搬家来源：
//   · stores/index.js:84-86  —— toast ref + notify()，2200ms
//   · CompanyView.vue:73     —— 自建 toast/err 两个 ref + toastTimer + say(text, bad)，3200ms
// 合并后保留「成功 2200ms / 失败 3200ms」的既有手感，调用方按语义选 notify 或 notifyError。

import { ref } from 'vue'

export const toast = ref('')
export const toastError = ref(false)

let timer = null

/** 显示一条提示。opts.error 为真时按失败样式显示并延长到 3200ms */
export function notify(message, opts = {}) {
  const error = !!opts.error
  const ms = opts.ms != null ? opts.ms : (error ? 3200 : 2200)
  toast.value = message
  toastError.value = error
  clearTimeout(timer)
  timer = setTimeout(() => { toast.value = ''; toastError.value = false }, ms)
}

/** 失败提示的简写 */
export const notifyError = message => notify(message, { error: true })

/** 立刻收起（切换页面等场景） */
export function clearToast() {
  clearTimeout(timer)
  toast.value = ''
  toastError.value = false
}
