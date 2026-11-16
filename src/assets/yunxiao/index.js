// 云霄仙子素材统一入口
// 全部为《师兄啊师兄》动画 Q 版小剧场原片截图，只做 CSS 裁切，不做任何图像处理。
//
// ⚠️ 关键：object-position 的百分比不是「脸在图里的相对位置」，而是
//    「可移动余量的百分比」。更坑的是——**它和 transform:scale 会互相影响**：
//    scale 放大后，原本的偏移也一起被放大，所以同一张图在不同 scale 下
//    最优 object-position 是不同的。因此这里把「位置 + 倍数」成对存，不可拆开用。
//
// 数值来自实测标定（docs/_pos-calib.html，六张图 × 8 档逐格截图比对），
// 不是公式算的。历史教训：2026-10-27 用「肤色中位数」自动定位，被背景污染，
// 六张有四五张算偏，头像里看到的是侧脸或后脑勺。

import q01 from './official/q01-tuozai.jpg'
import q02 from './official/q02-heart.png'
import q03 from './official/q03-window.jpg'
import q04 from './official/q04-window2.jpg'
import q05 from './official/q05-cloud.png'
import q06 from './official/q06-baoxiong.png'

/**
 * 素材登记表 —— 全站唯一来源。
 * 页面里任何地方要放 Q 版形象，都从这里取，不要在组件里写死路径或坐标。
 *
 *   key      短名，组件里传 face="tuozai" 用这个
 *   src      图片地址
 *   label    素材库里显示的名字
 *   pos      object-position（和 scale 成对使用，别单独改）
 *   scale    放大倍数，把脸放到约 45% 圆宽
 *   size     原图像素，素材库列表里展示
 */
export const YUNXIAO_FACES = [
  { key: 'tuozai',   src: q01, label: '托腮 · 户外',      pos: '80% 50%', scale: 1.36, size: '1438×1078', note: '脸最大最清楚，首页默认' },
  { key: 'heart',    src: q02, label: '双手合十 · 室内',  pos: '80% 50%', scale: 1.50, size: '2275×1280', note: '像在许愿，配年度目标' },
  { key: 'window',   src: q03, label: '木格窗 · 托下巴',  pos: '60% 50%', scale: 1.25, size: '1920×1080', note: '神情认真，配算账' },
  { key: 'window2',  src: q04, label: '木格窗 · 侧脸',    pos: '70% 50%', scale: 1.29, size: '1674×1039', note: '同场景另一角度' },
  { key: 'cloud',    src: q05, label: '云海半身',         pos: '50% 40%', scale: 1.80, size: '484×535',   note: '竖图，脸偏小要放大更多' },
  { key: 'baoxiong', src: q06, label: '捧脸特写',         pos: '50% 50%', scale: 1.22, size: '310×465',   note: '竖版特写，分辨率最低' },
]

/** key → src */
export const yunxiaoQ = Object.fromEntries(YUNXIAO_FACES.map(f => [f.key, f.src]))
/** key → object-position */
export const FACE_AT = Object.fromEntries(YUNXIAO_FACES.map(f => [f.key, f.pos]))
/** key → 放大倍数 */
export const FACE_SCALE = Object.fromEntries(YUNXIAO_FACES.map(f => [f.key, f.scale]))
/** key → 展示名 */
export const FACE_LABEL = Object.fromEntries(YUNXIAO_FACES.map(f => [f.key, f.label]))

/** 按 key 取一条登记，找不到时回落到第一张（避免空 src） */
export function faceOf(key) {
  return YUNXIAO_FACES.find(f => f.key === key) || YUNXIAO_FACES[0]
}

/**
 * 给 <img> 用的行内样式片段：位置 + 倍数一次给全。
 * 用法：<img :src="f.src" :style="faceStyle(f)" />
 */
export function faceStyle(f) {
  return {
    objectFit: 'cover',
    objectPosition: f.pos,
    transform: `scale(${f.scale})`,
    transformOrigin: 'center 50%',
  }
}

export default yunxiaoQ
