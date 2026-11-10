# CRYChart

[English](README.md) | **简体中文**

CRYChart 是 **CRYSOUND 为 OpenTest 定制的前端渲染库**，基于 TypeScript 开发。

CRYChart 面向 OpenTest 的数据可视化场景，提供流式数据绘制、交互坐标轴、游标、二维和三维图表。绘图使用 WebGL2，并提供 Canvas 回退。

包名为 `crychart`，当前版本为 **1.0.0**。

## 安装与构建

```powershell
npm ci
npm run build
npm run dev
```

本地示例地址为 <http://127.0.0.1:4178/>。图表容器需要明确的宽度和高度。

## 使用

```ts
import { cryChart, ColorRGBA, SolidFill, SolidLine } from 'crychart'
import type { CRYChart, CRYChartOptions } from 'crychart'

const options: CRYChartOptions = {}
const context: CRYChart = cryChart(options)
const chart = context.ChartXY({ container: document.getElementById('chart')! })
const line = chart.addLineSeries({ schema: { x: { auto: true }, y: {} } })
line.setMaxSampleCount(100_000)
line.setStrokeStyle(new SolidLine({
  thickness: 2,
  fillStyle: new SolidFill({ color: ColorRGBA(60, 210, 180) }),
}))
line.appendSamples({ y: new Float32Array([1, 2, 3]) }, { start: 0, step: 0.001 })

// 组件卸载时释放图表和绘图资源。
context.dispose()
```

包提供 ES 模块、CommonJS、浏览器脚本和 TypeScript 类型声明。浏览器脚本的全局对象为 `CRYChart`。主题入口为 `crychart/themes`。

## 验证

```powershell
npm run typecheck
npm run typecheck:tests
npm test
npm run build
npm run test:browser
npm run test:gallery
npm run test:functional
npm run test:performance
```

`npm run verify` 按顺序执行以上 CRYChart 检查。`typecheck:tests` 对测试代码及其依赖执行严格类型检查；`test:functional` 执行当前构建的完整功能场景，缺项或失败均返回非零退出码。`test:performance` 执行完整性能协议，含两组各 10 分钟长测和 128 通道容量测试；它需要足够的运行时间和内存。OpenTest 专用契约测试不属于这组本库验证。

性能负载、历史基准和限值配置见 [性能自动化说明](docs/performance-automation.md)。没有显式性能限值时，报告区分执行通过与性能达标，不将历史基准当作当前保证。

浏览器测试使用已安装的可见 Chrome。数据和接口测试不能替代图像、交互及性能测试。性能结果只适用于记录中的数据量、绘图区、设备像素比和机器配置。

## 许可协议

CRYChart 采用 [CRYChart 社区许可协议 1.0](LICENSE.zh-CN.md)，并提供 [English version](LICENSE.md)。

免费许可不设置通道、数据系列、曲线、数据点或视图数量上限。商业分发、OEM、设备配套交付和收费托管的授权条件见协议第 7 条。中英文解释不一致时，以中文版为准。

## 文档

- [使用手册](docs/使用手册.md)
- [性能说明](docs/性能说明.md)
- [高精度历史波形与 Scope 延迟复测](docs/performance-scope-high-precision-20261109.md)
- [架构说明](docs/architecture.md)
- [产品规格](SPEC.md)

示例中的合成数据仅用于演示和测试。继续使用的外部数据、模型和素材保留各自的来源及授权说明。
