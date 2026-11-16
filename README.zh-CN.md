# CRYChart

[English](README.md) | **简体中文**

CRYChart 是 **CRYSOUND 为 OpenTest 定制的前端渲染库**，基于 TypeScript 开发。

CRYChart 面向 OpenTest 的数据可视化场景，提供流式数据绘制、交互坐标轴、游标、二维和三维图表。绘图使用 WebGL2，并提供 Canvas 回退。

`1.0.2` 修复了高精度波形轴的视口跨度限制。

## 在应用中安装

```powershell
pnpm add --save-exact @crysound/crychart@1.0.2 --registry=https://registry.npmjs.org/
```

提交应用的锁文件，后续执行 `pnpm install --frozen-lockfile`。包入口和旧 `crychart` 包名的迁移方式见 [npm 使用说明](docs/npm-usage.md)。

## 安装与构建

```powershell
npm ci
npm run build
npm run dev
```

本地示例地址为 <http://127.0.0.1:4178/>。图表容器需要明确的宽度和高度。

## 使用

```ts
import { cryChart, ColorRGBA, SolidFill, SolidLine } from '@crysound/crychart'
import type { CRYChart, CRYChartOptions } from '@crysound/crychart'

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

包提供 ES 模块、CommonJS、浏览器脚本和 TypeScript 类型声明。浏览器脚本的全局对象为 `CRYChart`。主题入口为 `@crysound/crychart/themes`。

## 验证

```powershell
npm run typecheck
npm test
npm run test:opentest-contract
npm run build
npm run test:browser
npm run test:gallery
```

浏览器测试使用已安装的可见 Chrome。数据和接口测试不能替代图像、交互及性能测试。性能结果只适用于记录中的数据量、绘图区、设备像素比和机器配置。

## 许可协议

CRYChart 采用 [CRYChart 社区许可协议 1.0](LICENSE.zh-CN.md)，并提供 [English version](LICENSE.md)。

免费许可不设置通道、数据系列、曲线、数据点或视图数量上限。商业分发、OEM、设备配套交付和收费托管的授权条件见协议第 7 条。中英文解释不一致时，以中文版为准。

## 文档

- [npm 使用说明](docs/npm-usage.md)
- [使用手册](https://github.com/crysound/CRYChart/blob/main/docs/使用手册.md)
- [性能说明](https://github.com/crysound/CRYChart/blob/main/docs/性能说明.md)
- [架构说明](https://github.com/crysound/CRYChart/blob/main/docs/architecture.md)
- [产品规格](https://github.com/crysound/CRYChart/blob/main/SPEC.md)

示例中的合成数据仅用于演示和测试。继续使用的外部数据、模型和素材保留各自的来源及授权说明。
