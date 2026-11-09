# 迁移问题修复记录：2026-11-07

本文件记录 2026-11-07 的消费接口修复。CRYChart 工作目录是 `D:/workspace/CRYChart`。当时验证对象是 `opentest-old` 中实际使用的调用链。历史结果只对应当时构建。

## 接口修复

| 接口 | 当前行为 | 使用边界 |
| --- | --- | --- |
| `new ColorShadingStyles.Simple()` | 三维线、点和网格使用原始材质颜色；关闭网格光照和 Sphere 点高光 | 其他光照模型不在该专项验证范围内 |
| `mesh.setModelGeometry({vertices, indices})` | 保留模型原始顶点，按模型对齐、位置和缩放生成绘制坐标 | 原有 `setGeometry({positions, indices})` 仍使用轴坐标 |
| `mesh.setModelAlignment({x,y,z})` | 每个维度的 `-1`、`0`、`1` 分别表示模型最小边界、中心和最大边界 | 设置模型原点，不是相机位置 |
| `mesh.setModelLocation({x,y,z})` | 用轴坐标指定模型原点的位置 | 原始顶点单位与世界坐标缩放分别设置 |
| `mesh.setScale({x,y,z})` | 用世界坐标倍率缩放模型；相同值不重复构建网格 | 支持各维度独立倍率 |
| `mesh.setBackfaceCullingMode(...)` | 每个网格实际设置面剔除状态 | 包含测点页面使用的 `'disabled'` |
| `mesh.setDepthTestEnabled(...)` | 每个网格实际设置深度测试状态 | 绘制后恢复引擎的渲染状态基线 |
| `series.setHighlightOnHover(false)` | 接受三维页面中禁用悬停高亮的调用 | `true` 明确报不支持；不表示实现了悬停高亮 |
| `chart.setBoundingBoxStrokeStyle(emptyLine)` | 隐藏三维包围盒边线 | 其他线样式实际用于包围盒绘制 |
| `translateCoordinate(point, coordsAxis, coordsRelative)` | 返回以图表左下角为原点的 CSS 像素坐标 | DOM 顶部位置为 `chart.getSizePixels().y - relative.y`；屏幕到三维的反向转换仍需平面或深度 |
| `chart.addEventListener('camerachange', handler)` | 绘制后发布有效相机视图变化，事件携带 `cameraLocation` | 相同视图和纯数据重绘不重复发布 |
| `chart.engine.getBackgroundFillStyle()` / `setBackgroundFillStyle(...)` | 读取和设置实际背景，支持原页面截图前设置不透明背景及截图后恢复 | engine 对象保持稳定，setter 返回 engine |
| `rectangleSeries.setDrawOrder({seriesDrawOrderIndex})` | 按指定顺序绘制重叠柱形；相同顺序保留创建顺序 | 当前支持矩形系列的业务调用 |
| `import type {UITextBox}` | 导出实际文本 UI 元素类型 | 类型导入，不是可实例化的运行时构造器 |
| `AxisScrollStrategies.fitting({considerVisibleRangeOnly:true})` | 普通 XY 线和点只统计另一条绑定轴可见范围内的有限数据对 | 支持独立轴、乱序和 NaN；几何、热图及三维系列在显式启用时明确报不支持 |

可见范围拟合保留完整原始数据。例如，X 数据为 `[0,20000,30000]`，Y 数据为 `[100,1,2]`；当 X 可见范围为 `[20000,30000]` 时，Y 拟合范围是 `[1,2]`，原始三条数据仍保留。单调数据使用二分定位和极值块缓存，避免每次追加都复制完整历史。

```ts
import { ColorShadingStyles, emptyLine } from 'crychart'

chart.setBoundingBoxStrokeStyle(emptyLine)
const line = chart.addLineSeries()
  .setHighlightOnHover(false)
  .setColorShadingStyle(new ColorShadingStyles.Simple())

const mesh = chart.addMeshModel()
  .setModelGeometry({ vertices, indices })
  .setModelAlignment({ x: -1, y: -1, z: -1 })
  .setModelLocation({ x: 0, y: 0, z: 0 })
  .setScale(worldScale)
  .setBackfaceCullingMode('disabled')
  .setDepthTestEnabled(true)
  .setHighlightOnHover(false)
  .setColorShadingStyle(new ColorShadingStyles.Simple())
```

## 前端依赖环境

`D:/workspace/opentest-old/opentest-frontend/node_modules` 中的旧 junction 指向不存在的另一份工作区。旧目录已整体移入本工程的 `codex_artifact/crychart-migration/backup`，未递归删除或修改 junction 指向的外部目录。

使用工程要求的 pnpm 10.6.5 和原锁文件重装依赖。离线安装因缺少 `docx@9.9.0` 缓存失败；随后读取软件包注册表，按冻结锁文件完成安装。`package.json`、`pnpm-lock.yaml` 和 `pnpm-workspace.yaml` 的内容均保持不变。新的虚拟存储目录和 TypeScript、Vue、vue-tsc、Vite 的实际解析路径均位于当前前端工程内。

```powershell
pnpm install --frozen-lockfile --ignore-scripts --prefer-offline --store-dir D:/.pnpm-store
```

上述恢复跳过了依赖安装脚本，不能据此判定所有原生依赖和应用打包流程通过。恢复目录中保留安装日志、路径和文件哈希核验、诊断分类以及 `ROLLBACK.md`。

## 验证范围

最终构建的 SHA-256 为 `5655706ed50c22eafc6c919c4009d906351ed1c637761cc28c4d4b943ac508a9`。类型检查、构建和实际消费调用链的严格 TypeScript 检查通过。回归测试共 1169 项：1167 通过，0 失败，2 跳过。OpenTest 契约测试 23/23 通过。

可见 Chrome 156 的原组件验收通过 97/97 项检查。长方体、半球和圆柱均覆盖视角切换、真实拖动、滚轮激活、逐点投影、选择、主题、导出、尺寸变化和卸载。独立材质检查读取真实画布像素，确认 Simple 网格和 Sphere 使用材质原始 RGB。Chrome 和测试服务均已关闭。

最终报告位于 `codex_artifact/migration-fixes-20261107/consumer-fixture/runs/2026-11-07T11-44-51.687Z/report.json`。每次运行独立保存报告和截图；失败记录保留，不计入通过结果。测试使用原 Vue 组件、几何算法、SCSS、Vue 和 Element Plus；主题偏好、Electron 保存入口使用有记录的浏览器宿主边界。该结果不能证明整个应用已完成迁移，也不覆盖完整性能验收。

前端环境恢复后，Node 类型检查通过；应用类型检查仍有 25 条诊断。测试类型检查使用 8 GB 堆内存后不再内存溢出，但相对现有基线仍新增 782 次诊断，涉及 118 个文件。未通过修改类型基线来消除这些失败。

本次未替换前端生产包导入或依赖清单，未迁移其他工程。全量生产调用盘点、应用级迁移、Electron 打包和新的性能对比仍需独立验证。
