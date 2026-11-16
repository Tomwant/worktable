// 应用品牌配置的唯一来源：项目根目录 app.config.json
// 改名字只改那一个文件即可，以下位置会自动跟随：
//   顶栏品牌名 / 浏览器标题 / favicon / Electron 窗口标题 / 功能地图中心节点 / 服务端启动日志
import appConfig from '../app.config.json'

export const APP_NAME = appConfig.name
export const APP_NAME_EN = appConfig.nameEn
// logo 字形：取应用名首字（顶栏圆标 + favicon 共用）
export const APP_INITIAL = Array.from(APP_NAME)[0] || 'W'
