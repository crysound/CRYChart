# CRYChart

**English** | [简体中文](README.zh-CN.md)

CRYChart is a **frontend rendering library built by CRYSOUND for OpenTest**, written in TypeScript.

Designed for OpenTest's data visualization needs, CRYChart provides streaming data rendering, interactive axes, cursors, and 2D and 3D charts. It uses WebGL2 for rendering, with a Canvas fallback.

Version `1.0.2` fixes the viewport size limit for high precision waveform axes.

## Install in an application

```powershell
pnpm add --save-exact @crysound/crychart@1.0.2 --registry=https://registry.npmjs.org/
```

Commit the application's lockfile and use `pnpm install --frozen-lockfile` for repeatable installs. See the [npm usage guide](docs/npm-usage.md) for package entry points and migration from the old `crychart` name.

## Install and build

From the repository root:

```powershell
npm ci
npm run build
npm run dev
```

Open the local examples at <http://127.0.0.1:4178/>. Chart containers must have an explicit width and height.

## Usage

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

// Dispose of charts and rendering resources when the component unmounts.
context.dispose()
```

The package provides ES modules, CommonJS, a browser script, and TypeScript declarations. The browser script exposes the `CRYChart` global. Themes are available through `@crysound/crychart/themes`.

## Validation

```powershell
npm run typecheck
npm test
npm run test:opentest-contract
npm run build
npm run test:browser
npm run test:gallery
```

Browser tests use an installed, visible Chrome browser. Data and API tests do not replace visual, interaction, or performance tests. Performance results apply only to the recorded data volume, plot area, device pixel ratio, and machine configuration.

## License

CRYChart is licensed under the [CRYChart Community License 1.0](LICENSE.md). A [Chinese version](LICENSE.zh-CN.md) is also available.

The free license imposes no limits on the number of channels, data series, curves, data points, or views. See Section 7 for the licensing conditions for commercial distribution, OEM use, delivery bundled with equipment, and paid hosting. If the English and Chinese versions differ in interpretation, the Chinese version prevails.

## Documentation

- [npm usage guide](docs/npm-usage.md)
- [User guide](https://github.com/crysound/CRYChart/blob/main/docs/使用手册.md)
- [Performance notes](https://github.com/crysound/CRYChart/blob/main/docs/性能说明.md)
- [Architecture](https://github.com/crysound/CRYChart/blob/main/docs/architecture.md)
- [Product specification](https://github.com/crysound/CRYChart/blob/main/SPEC.md)

Some documentation is currently available only in Chinese.

Synthetic data in the examples is intended for demonstrations and testing only. External data, models, and assets retain their respective source attributions and license notices.
