# OpenTest 轴交互和十字游标修复

日期：2026-11-09。

问题来源：桌面的 `OpenTest-CRYChart-UI特性差异分析-20261108.md`。

| 问题 | 修复行为 | 使用入口 |
| --- | --- | --- |
| 轴右键事件缺失 | 将原始 `contextmenu` 事件送至命中的轴。轴监听器可阻止事件冒泡。 | `axis.addEventListener('contextmenu', handler)` |
| 悬停高亮未绘制 | 默认启用悬停高亮。绘制反馈限于命中的轴区域。离开、隐藏和销毁清理悬停状态。 | `setHighlightOnHover()` |
| 十字图标回退 | 注册并绘制实际图像。游标标记和点系列均保留图标对象。 | `chart.engine.addCustomIcon()` |

## 轴事件

```ts
axis.addEventListener('contextmenu', event => {
  event.preventDefault()
  event.stopPropagation()
  // 在此打开轴菜单。
})
```

原始事件保留浏览器坐标。命中检测区分 X、左 Y、右 Y 和并排轴。
绘图区右键保留图表自己的行为。隐藏或已销毁的轴不会收到事件。

## 悬停和导出

`getHighlight()` 返回手动高亮值。
`getHighlightOnHover()` 返回悬停开关。
指针位置独立于这两个设置。

导出前保存这两个设置，再临时关闭高亮。
导出后恢复原设置。OpenTest 的现有导出流程可以继续使用。

本次绘制提供深色和浅色主题的轴区域反馈。
本记录只覆盖已列出的交互和样式检查，不表示全部高亮配置均已验收。

## 自定义图标

```ts
const canvas = document.createElement('canvas')
canvas.width = canvas.height = 13
const context = canvas.getContext('2d')!
context.strokeStyle = '#2E90FA'
context.lineWidth = 2
context.beginPath()
context.moveTo(1, 6.5)
context.lineTo(12, 6.5)
context.moveTo(6.5, 1)
context.lineTo(6.5, 12)
context.stroke()

const icon = chart.engine.addCustomIcon(canvas, { width: 13, height: 13 })
const marker = chart.addCursor().getPointMarker()
marker.setShape(icon).setSize({ x: 13, y: 13 })
// 停用图标时释放图标资源。
icon.dispose()
```

宽度和高度使用 CSS 像素。图像应已具备有效尺寸。
图标的尺寸设置方法返回新图标，原图标保持不变。
图标释放会通知渲染器清理纹理。
图表销毁会释放注册的图标，但不会关闭调用方提供的图像。

## 验证记录

真实 Chrome 修复前的记录位于 OpenTest 前端：
`codex_artifact/ui-parity-20261109/root/browser/baseline-2026-11-09T01-35-11.457Z/report.json`。

该次复现使用前台 Chrome 156 和 AMD Direct3D11。
三类轴右键均未送达，六组轴悬停变化均为 0 像素。
OpenTest 轴右键打开了外层图卡菜单。

修复后的真实 Chrome 验收通过 24 项检查。
记录位于 OpenTest 前端：
`codex_artifact/ui-parity-20261109/root/browser/verify-2026-11-09T01-58-02.835Z/report.json`。

检查包含三个轴和并排轴的右键与悬停。
菜单操作覆盖自动/固定范围、线性/对数、属性和单位保存。
单位保存走实际服务封装，传输层使用受控响应。
API 回读确认保存了 `kHz`。
实际导出流程会关闭高亮，再恢复高亮。

十字游标使用真实 `useCursor`。
鼠标移动后，通过方向键定位单个样本，读数为 `2000 / 7`。
图标尺寸为 13 × 13，截图确认蓝色十字可见。
点系列的 WebGL 图标绘制和释放也通过检查。

图表像素检查使用浏览器中的 `engine.captureFrame()`。
菜单截图使用 Chrome 调试协议。
两者均运行于前台 Chrome 156，使用 AMD Direct3D11。
截图工具曾触发指针离开，修正后的检查直接取图表帧。
早期测试夹具的失败记录保留，未计入通过项。
本轮 Chrome 已关闭，调试端口已释放。

核心回归通过 1184 项，保留原有 2 项跳过。
OpenTest 接口测试通过 23 项。
前端菜单、游标和导出定向测试通过 236 项。
新增图标定向检查通过 5 项。
Core 类型检查、公共消费接口类型检查和构建通过。

OpenTest 已重新安装本地包。
Core 和前端安装包的 ESM SHA-256 相同：
`7e160a5ef3707a189dc62afec74551b31337caca833238691562129be4ad9736`。

本轮不重新声明全部组件功能或性能对比结果。
