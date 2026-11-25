# 构建和发布 CRYChart

CRYChart 以公开包 `@crysound/crychart` 分发。首个公开版本 `1.0.1` 的内容与校验值见[发行验收记录](releases/1.0.1.md)。公开包包含 ESM、CommonJS、浏览器脚本、主题模块及完整 TypeScript 声明，保留 CRYChart Community License 1.0。

## 准备发行包

在源码仓库根目录使用已锁定的依赖：

```powershell
npm ci
npm run typecheck
npm test
npm run test:opentest-contract
New-Item -ItemType Directory -Force .cache/npm-release
npm pack --pack-destination .cache/npm-release
npm run test:browser
npm run test:gallery
```

`prepack` 构建库、示例及类型，并检查运行入口与版本一致性。检查实际归档中的文件，确认 `dist/types/index.d.ts` 和 `dist/types/themes.d.ts` 存在，再从归档安装到独立消费工程，验证 ESM、CommonJS 以及严格 NodeNext、Bundler 类型检查。

npm 包仅包含运行库、类型、中英文许可证、README 和 `docs/npm-usage.md`。完整使用手册、历史性能数据、功能报告、OpenTest 合同和修复记录保留在仓库。历史包位于 `version/v1.0/`，其旧版本号与验收结果不代表新发行版。

## 通过 GitHub Actions 发布

首次发布前，先把 `.github/workflows/publish.yml` 合入 `main`。使用有包管理权限的 npm 账号，打开 `@crysound/crychart` 的 **Settings → Trusted publishing**，选择 **GitHub Actions**，填入：

| 字段 | 值 |
| --- | --- |
| Organization or user | `crysound` |
| Repository | `CRYChart` |
| Workflow filename | `publish.yml` |
| Environment name | 留空 |
| Allowed actions | 启用 `npm publish` |

保存后在两天内完成首次成功发布。无需添加 npm token 到 GitHub Secrets。参见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

1. 合入发版改动，确认 `package.json` 的版本与安装说明一致。等发版提交在 `main` 上的 **CRYChart CI** 通过。
2. 在 [GitHub Releases](https://github.com/crysound/CRYChart/releases) 创建正式 Release。将版本标签（例如 `v1.0.2`）指向该提交，填写发版说明，点击 **Publish release**。
3. 在 [GitHub Actions](https://github.com/crysound/CRYChart/actions/workflows/publish.yml) 查看结果。流程会验收实际归档、发布到 npm 的 `latest`，再从 registry 下载归档并核对内容。

若任务失败，先查 npm 上的目标版本，再修正配置并重跑失败任务。若版本已经存在，流程只核对归档和 `latest`，不会覆盖内容。若要修正已发布的包，使用新版本号。

## 手动发布

使用具备 `crysound` 组织发布权限的账号在本机登录。以下示例使用当前源码版本 `1.0.4`。先验收该版本的归档，再发布：

```powershell
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish .cache/npm-release/crysound-crychart-1.0.4.tgz --access public --tag latest --registry=https://registry.npmjs.org/
npm view @crysound/crychart@1.0.4 version dist.integrity --registry=https://registry.npmjs.org/
```

按 npm 提示完成本次发布所需的网页认证。发布成功后，对比 registry 的完整性摘要与已验收归档，再从 registry 安装验证。包名与版本一经发布不能复用，内容修正使用新的版本号。

若发布返回账号因近期安全敏感操作被临时暂停，先确认是否使用过恢复码登录。[npm 对恢复码登录实施 72 小时只读保护](https://docs.npmjs.com/recovering-your-2fa-enabled-account/)，期间登录可以成功，但不能发布、创建访问令牌或调整组织权限。保护期自动结束，重新登录不会提前解除。旧网页认证链接失效时，不重复使用旧链接；恢复发布时重新发起命令并完成其新认证会话。

宿主接入使用 pnpm 精确版本和锁文件，见 [npm 使用说明](npm-usage.md)。源码仓库继续使用现有 npm 锁文件维护构建工具，不改变应用使用 pnpm 安装本库的方式。
