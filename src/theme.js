// Naive UI 主题令牌：把「云霄 · 云隐（紫）」映射进 Naive 控件
// 色值唯一来源是 style.css 的 :root / [data-theme="dark"]，这里只是跟着抄一遍
import { darkTheme } from 'naive-ui'

const shared = {
  borderRadius: '14px',
  borderRadiusSmall: '10px',
  fontSize: '14px',
  fontFamily: "'Noto Sans SC',-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
}

// 浅色：输入/下拉/日期共用的「软边 + 玻璃底」令牌
const lightInput = {
  borderRadius: '14px',
  color: 'rgba(255,255,255,.6)',
  colorFocus: 'rgba(255,255,255,.92)',
  border: '1px solid rgba(72,50,110,.12)',
  borderHover: '1px solid rgba(72,50,110,.24)',
  borderFocus: '1px solid #7d5ba6',
  boxShadowFocus: '0 4px 16px -2px rgba(125,91,166,.28)',
  placeholderColor: '#8f87a3'
}
const lightSelection = {
  borderRadius: '14px',
  color: 'rgba(255,255,255,.6)',
  colorActive: 'rgba(255,255,255,.92)',
  border: '1px solid rgba(72,50,110,.12)',
  borderHover: '1px solid rgba(72,50,110,.24)',
  borderActive: '1px solid #7d5ba6',
  borderFocus: '1px solid #7d5ba6',
  boxShadowActive: '0 4px 16px -2px rgba(125,91,166,.28)',
  boxShadowFocus: '0 4px 16px -2px rgba(125,91,166,.28)'
}

// 深色：紫墨底 + 淡紫主色
const darkInput = {
  borderRadius: '14px',
  color: 'rgba(255,255,255,.06)',
  colorFocus: 'rgba(255,255,255,.10)',
  border: '1px solid rgba(255,255,255,.12)',
  borderHover: '1px solid rgba(255,255,255,.22)',
  borderFocus: '1px solid #c4a7e7',
  boxShadowFocus: '0 4px 16px -2px rgba(196,167,231,.32)',
  placeholderColor: '#a49bb8'
}
const darkSelection = {
  borderRadius: '14px',
  color: 'rgba(255,255,255,.06)',
  colorActive: 'rgba(255,255,255,.10)',
  border: '1px solid rgba(255,255,255,.12)',
  borderHover: '1px solid rgba(255,255,255,.22)',
  borderActive: '1px solid #c4a7e7',
  borderFocus: '1px solid #c4a7e7',
  boxShadowActive: '0 4px 16px -2px rgba(196,167,231,.32)',
  boxShadowFocus: '0 4px 16px -2px rgba(196,167,231,.32)'
}

// 浅色：淡紫白底 + 紫主色
// success 保持绿系（语义色，不能跟主色混）；其余状态色走仙金 / 深红
export const lightThemeOverrides = {
  common: {
    ...shared,
    primaryColor: '#7d5ba6',
    primaryColorHover: '#63478a',
    primaryColorPressed: '#553c78',
    primaryColorSuppl: '#b9a3dd',
    infoColor: '#5f8fd8',
    successColor: '#4e9e6a',
    warningColor: '#c9a961',
    errorColor: '#b8434f',
    textColorBase: '#2a2338',
    textColor1: '#2a2338',
    textColor2: '#5d5473',
    textColor3: '#8f87a3',
    bodyColor: '#fdfcff',
    baseColor: '#fdfcff',
    cardColor: 'rgba(255,255,255,.72)',
    modalColor: '#fdfcff',
    popoverColor: '#fdfcff',
    borderColor: 'rgba(72,50,110,.14)',
    dividerColor: 'rgba(72,50,110,.10)'
  },
  Input: lightInput,
  Select: { peers: { InternalSelection: lightSelection } },
  Card: { borderRadius: '22px' },
  Tag: { borderRadius: '100px' }
}

// 深色主题覆盖
export const darkThemeOverrides = {
  common: {
    ...shared,
    primaryColor: '#c4a7e7',
    primaryColorHover: '#d3c0ee',
    primaryColorPressed: '#a385cf',
    primaryColorSuppl: '#a385cf',
    infoColor: '#8fa9e8',
    successColor: '#7fd3a2',
    warningColor: '#dcb97a',
    errorColor: '#f09595',
    textColorBase: '#ece7f5',
    textColor1: '#ece7f5',
    textColor2: '#b9b0cd',
    textColor3: '#a49bb8',
    bodyColor: '#221c33',
    baseColor: '#221c33',
    cardColor: 'rgba(255,255,255,.055)',
    modalColor: '#221c33',
    popoverColor: '#221c33',
    borderColor: 'rgba(255,255,255,.12)',
    dividerColor: 'rgba(255,255,255,.10)'
  },
  Input: darkInput,
  Select: { peers: { InternalSelection: darkSelection } },
  Card: { borderRadius: '22px' },
  Tag: { borderRadius: '100px' }
}

export { darkTheme }
