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
npm run test:coverage
npm run test:api
npm run build
npm run test:browser
npm run test:gallery
```

`npm run test:coverage` 合并运行单元测试和 OpenTest 接口合同，用 c8/V8 统计全部 `src/**/*.ts`（不含 `.d.ts`）。覆盖率模式通过 tsx 直接执行源码，避免打包裁剪未调用函数；示例、测试驱动和 UI 自动化不计入该代码覆盖率。

CI 和 `npm run verify` 均要求行覆盖率和语句覆盖率至少 96%、分支至少 87%、函数至少 98%，任一不足即失败。门槛配置在 `.c8rc.json`，以 CI 的 Node 22/V8 统计口径为准；不同 Node 主版本的覆盖率可能不同。HTML 报告为 `codex_artifact/coverage/index.html`，同时生成 `lcov.info`、`coverage-final.json` 和 `coverage-summary.json`；CI 的 `code-coverage` 附件保留 14 天，测试或门槛失败时也会上传已生成的报告。

公开 API 到场景、断言的完整盘点见 [API 测试清单](docs/api-test-map.md)，机器可读版本为 `docs/api-test-map.json`。清单区分 `mapped`（有可追溯调用/显式绑定和断言）、`missing`（尚未绑定有效场景）、`placeholder`（兼容占位或有意为空的钩子）、`type-only`（类型声明）。绑定一个场景不表示该 API 的全部参数组合均已验证，浏览器用例不借用单元测试结果认证。

先运行 `npm run test:coverage`，再运行 `npm run test:api`，后者会核验本轮测试实际通过、源码指纹未变化、API 签名和测试引用有效、原有断言未被移除。所有非占位的可调用接口、公开字段和常量均要求有断言场景，包括继承成员、工厂方法和构造函数中赋值的 `engine` 对象。`publicValues`、`mappedValues`、`unassertedValues` 分别统计公开值总数、有场景映射及缺失映射的数量；CI 要求 `unassertedValues` 为零。新增字段/常量和 API 必须补场景后才允许更新清单，已有值映射也不能被更新命令抹除。修改测试或公开签名后，运行 `npm run api:map:update` 并审核清单差异；占位及部分实现的限制在 `docs/api-test-policy.json`。CI 上传 `api-test-map` 附件，保留 14 天。

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
