# 协作开发

AgentValue 目前交付 Windows x64 安装包；独立手机网页可用于同步测试，安卓 APK 在下一阶段。当前状态见 [路线图](docs/roadmap.md)。

## 第一次运行

安装 Node.js 24.x 和 Git 后，在终端执行：

```powershell
npm install --global pnpm@11.19.0
git clone https://github.com/lizhengda0525-sudo/AgentValue.git
cd AgentValue
pnpm install --frozen-lockfile
pnpm launch
```

不需要 Codex、API Key、额外数据库服务或原开发电脑的路径。安装版在安装根目录旁创建 `data` 文件夹；首次运行会迁移旧版 `.agentvault` 数据。初始库为空；设置页可以添加两条文本示例。

## 日常开发

从最新 main 创建功能分支，完成修改后提交 Pull Request：

```powershell
git switch main
git pull --ff-only
git switch -c codex/my-change
pnpm build
pnpm test
pnpm test:ui
```

`pnpm launch` 会重新构建并启动完整桌面应用。`pnpm dev` 同时启动 Vite 和本机后端；浏览器支持实际数据操作。托盘、系统通知和数据目录迁移使用桌面版。

`pnpm test:ui` 使用临时目录和测试窗口，不写入日常收藏库。`pnpm test:github` 会访问公开 GitHub 仓库，属于可选网络集成测试。测试截图和结果写入 `artifacts`，不提交到 Git。

打包前关闭当前输出目录中的测试程序，然后运行 `pnpm package`。输出 `release/AgentValue-Setup-<版本>-windows-x64.exe` 和 `latest.yml`。GitHub 更新提供方使用同名元数据，通过 Release 的 prerelease 标记隔离测试版；稳定版自动更新关闭预发布接收。安装依赖时保留 `pnpm-lock.yaml`，修改依赖后提交更新的锁文件。

需要云同步时复制 `.env.example` 为 `.env.local`，使用自己的 Supabase 项目地址和 publishable key，并执行 [初始化脚本](supabase/migrations/202610070001_sync.sql)。不得将数据库密码或 secret/service_role key 加入客户端。

`pnpm build:mobile` 和 `pnpm serve:mobile` 提供独立网页测试端；`pnpm test:sync-ui` 验证隔离电脑与手机网页中的离线和冲突场景，使用模拟云端，不发送真实注册邮件。设 `AGENTVALUE_SYNC_NATIVE=1` 并用 `AGENTVALUE_EXECUTABLE` 指定打包程序，可检查真实原生 IPC 和首次导入。真实多端验收另需两个设备登录同一账号。

## 目录

- `src`：React 界面、类型与样式。
- `electron/main.cjs`：窗口、IPC、系统对话框与剪贴板。
- `electron/store.cjs`：SQLite、图片副本、Skill 导入与更新。
- `electron/preload.cjs`：受限渲染进程接口。
- `src/sync`：云空间、离线队列、账号与冲突处理。
- `shared`：本机与云空间共用的数据校验。
- `supabase/migrations`：数据权限、版本检查同步接口与私有附件规则。
- `scripts`：真实窗口与网络测试。
- `tests`：数据层测试。
- `docs`：设计与验收记录。

CI 在 Windows 上构建、运行数据测试、打包，再验证打包后的真实窗口流程。成功构建会上传安装包 artifact；正式可下载版本位于 Releases。

## 发布新版本

依照 [AGENTS.md](AGENTS.md) 取得本次推送与发布授权。更新 `package.json`，编写 `docs/releases/v<版本>.md`，先在本地完成构建和测试。推送 main 并等待 Windows CI 通过，再为同一提交创建并推送版本标签。

标签推送触发 **Publish AgentValue Windows installer**：核对版本与 main，构建安装包、验证打包程序，以及安装/升级/卸载保留数据后发布。稳定版进入 Latest；包含预发布后缀的测试版标记为 prerelease，不替换稳定版 Latest。安装包附渠道更新文件、blockmap 和 SHA-256 校验文件，已发布版本不覆盖。

GitHub Actions 的 Variables 需设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`，只能放公开客户端配置。发布流程缺少配置会停止，避免产生无法登录云空间的安装包。私人 `.env.local` 不提交，开发者自行配置。

手机网页的 Pages 流程只手动触发，目前不作为安卓交付方式；安卓按 APK 计划继续开发。

## 数据与权限

Git 共享程序源码，不共享个人收藏。需要同步自己设备时在云空间登录同一账号；分享整库可导出备份，由接收者校验并确认恢复。不要将旧版 `.agentvault`、新版 `data`、数据库、个人图片、备份或凭据提交到仓库。

这是公开仓库，任何人都可以克隆和下载程序。直接推送需要仓库写入权限；没有权限时可 fork 后提 Pull Request，由仓库所有者管理协作者访问。
