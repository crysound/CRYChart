# CRYChart 源码与离线包

源码目录为 `D:/workspace/CRYChart`，包版本为 `1.0.0`。当前分支为 `version/v1.0`。构建内容与指纹以对应交付清单为准。

## 构建与启动

```powershell
cd D:/workspace/CRYChart
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

在 Chrome 中访问 `http://127.0.0.1:4178/`。基础示例位于 `/examples/index.html`，完整场景目录位于 `/examples/official/index.html`。端口已占用时，启动前设置 `$env:PORT = '4180'`。

包提供 ES 模块、CommonJS、浏览器普通脚本和 TypeScript 类型声明。入口工厂为 `cryChart`，上下文类型为 `CRYChart`，选项类型为 `CRYChartOptions`。

## 验证范围

单元测试检查数据、几何、事件和生命周期。浏览器测试使用真实可见 Chrome，检查指定图形与交互。OpenTest 消费合同通过 `npm run test:opentest-contract` 单独检查。该命令不能证明整个应用完成替包或部署。

本地场景目录包含 167 个条目。历史本库检查与当前源码验收分别记录；目录数量不代表当前构建的通过数。详见 [功能清单](functional-verification.json) 和 [HTML 场景表](CRYChart-functional-report.html)。

离线归档位于 `version/v1.0/`。使用前核对清单中的文件哈希。性能自测的构建、负载和限制见 [性能说明](性能说明.md)。OpenTest 在本次清理中保持只读。
