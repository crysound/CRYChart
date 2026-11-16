# 安装和使用 CRYChart

在应用目录安装固定版本：

```powershell
pnpm add --save-exact @crysound/crychart@1.0.2 --registry=https://registry.npmjs.org/
```

ES 模块和 TypeScript 使用相同入口：

```ts
import { cryChart } from '@crysound/crychart'
import type { CRYChartOptions } from '@crysound/crychart'

const options: CRYChartOptions = {}
const context = cryChart(options)
const chart = context.ChartXY({ container: document.getElementById('chart')! })
const line = chart.addLineSeries({ schema: { x: { auto: true }, y: {} } })
line.appendSamples({ y: new Float32Array([1, 2, 3]) }, { start: 0, step: 1 })

// 在页面或组件卸载时调用。
context.dispose()
```

图表容器需要明确的宽度和高度。CommonJS 使用 `require('@crysound/crychart')`。ES 模块主题入口为 `@crysound/crychart/themes`；CommonJS 从主入口取得主题。浏览器普通脚本为 `dist/crychart.global.js`，全局对象仍为 `CRYChart`。

从旧 `crychart` 包迁移时，将主入口和主题入口改为上述作用域包名。图表工厂、类型和浏览器全局名称保持不变。提交应用的 `package.json` 和 `pnpm-lock.yaml`，后续安装执行 `pnpm install --frozen-lockfile`。

运行包不包含源码、示例工程或历史验收报告。完整说明见[源码仓库使用手册](https://github.com/crysound/CRYChart/blob/main/docs/使用手册.md)。

CRYChart 采用 [CRYChart Community License 1.0](../LICENSE.md)，并提供[中文版](../LICENSE.zh-CN.md)。商业分发、OEM、设备配套交付及付费托管遵循协议第 7 条。
