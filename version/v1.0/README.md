# CRYChart 1.0.0 离线分发

本目录保存当前工作树重建的 SDK 和源码压缩包。公开包名为 `crychart`，工厂为 `cryChart()`。

SDK 和源码包均包含 `LICENSE.md` 与 `LICENSE.zh-CN.md`，采用 CRYChart 社区许可协议 1.0。免费许可不设置通道数量上限。商业授权条件见协议正文，中英文解释不一致时以中文版本为准。

- `crychart-1.0.0.tgz`：包含 JavaScript、类型声明和产品文档的安装包。
- `crychart-v1.0.0-source.zip`：包含源码、测试、构建脚本、示例和文档的源码包。
- `manifest.json`：文件大小、SHA-256、构建基线和实际验证结果。
- `source-archive-inventory.json`：源码包内每个文件的 SHA-256。

源码包不包含 Git 数据、本地依赖、浏览器缓存或开发过程日志。SDK 不依赖其他图表运行库。

安装示例：

```powershell
npm install ./crychart-1.0.0.tgz
```

原始样本、坐标轴、游标和图表接口以包内类型声明及使用手册为准。合成示例数据仅用于演示。
