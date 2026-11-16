// 键盘快捷键注册。四处各写一遍「忽略输入控件 + 注册/注销」，逻辑同构、边界各不相同。
//
// 搬家来源：
//   · App.vue               —— 导航键 1~8，焦点在 input/textarea/select/button 上时不触发
//   · IdeasView.vue:88      —— Esc 退回列表，输入框里不抢
//   · KnowledgeView.vue:96  —— Ctrl/Cmd+K 聚焦搜索，输入框里也要能触发
//   · AiTimelineView.vue    —— 上下箭头在卡片间移焦点（依赖具体 DOM，留在原位，不走这个 hook）
//
// 默认在输入控件里不触发（避免打字时误跳页），需要「输入中也能按」的显式开 allowInInput。

import { onMounted, onUnmounted } from 'vue'

const DEFAULT_GUARD = 'input,textarea,select,button'

/**
 * @param {Record<string, (e: KeyboardEvent) => void>} handlers
 *        键名小写；组合键用 `mod+k`（Ctrl 或 Cmd）、`alt+`、`shift+`。例：{ escape, '1', 'mod+k' }
 * @param {object} [opts]
 * @param {boolean} [opts.allowInInput=false] 为真时焦点在输入控件里也触发
 * @param {string}  [opts.guard]  自定义「不触发」的元素选择器，默认 input,textarea,select,button
 * @param {EventTarget} [opts.target] 默认 window
 */
export function useHotkeys(handlers, opts = {}) {
  const { allowInInput = false, guard = DEFAULT_GUARD, target = window } = opts

  const onKey = e => {
    if (!allowInInput) {
      // e.target 不一定是元素（窗口级派发时是 window），别直接读 tagName
      const el = e.target
      if (el && typeof el.matches === 'function' && el.matches(guard)) return
    }

    const key = String(e.key || '').toLowerCase()
    const candidates = []
    if (e.ctrlKey || e.metaKey) candidates.push('mod+' + key)
    if (e.altKey) candidates.push('alt+' + key)
    if (e.shiftKey) candidates.push('shift+' + key)
    candidates.push(key)

    for (const c of candidates) {
      const fn = handlers[c]
      if (fn) { fn(e); return }
    }
  }

  onMounted(() => target.addEventListener('keydown', onKey))
  onUnmounted(() => target.removeEventListener('keydown', onKey))

  return { onKey }
}
