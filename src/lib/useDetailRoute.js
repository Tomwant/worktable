// 二级详情页的「压历史 / 后退」逻辑。
//
// 好公司和奇思妙想各写了一遍完全同构的代码：
//   open()  → 设状态 + history.pushState({ [key]: id }, '')
//   close() → 先自己清状态，若 history.state[key] 存在再 history.back()
//   onPop() → 清状态（浏览器后退键 / 鼠标侧键）
// 抽出来后两处共用，新增模块也能直接套。
//
// 注意「先清状态再 back」的顺序不能倒：详情可能是直接打开的（没有 pushState），
// 此时 back 会让页面直接离开，不能指望它来清界面。

import { onMounted, onUnmounted } from 'vue'

/**
 * @param {object} cfg
 * @param {string} cfg.key        历史状态里的字段名，如 'co' / 'ideasOpen'
 * @param {() => boolean} cfg.isOpen  当前是否处于详情态（popstate 时用来判断要不要清）
 * @param {() => void} cfg.close  清掉本模块自己的详情状态
 * @returns {{ push: (id:string|number)=>void, back: ()=>void }}
 */
export function useDetailRoute({ key, isOpen, close }) {
  const onPop = () => {
    if (isOpen && isOpen()) close()
  }

  onMounted(() => window.addEventListener('popstate', onPop))
  onUnmounted(() => window.removeEventListener('popstate', onPop))

  /** 打开详情：压一条历史，浏览器后退键才能退回列表 */
  const push = id => {
    history.pushState({ [key]: id }, '')
  }

  /** 关闭详情：先清界面，有自己压的历史才回退 */
  const back = () => {
    close()
    if (history.state && history.state[key]) history.back()
  }

  return { push, back }
}
