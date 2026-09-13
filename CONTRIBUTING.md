# 协作开发

仓库名为 **AgentValue**，应用名为 **AgentVault**。目前支持 Windows x64。

## 第一次运行

安装 Node.js 24.x 和 Git 后，在终端执行：

```powershell
npm install --global pnpm@11.19.0
git clone https://github.com/lizhengda0525-sudo/AgentValue.git
cd AgentValue
pnpm install --frozen-lockfile
pnpm launch
```

不需要 Codex、API Key、额外数据库服务或原开发电脑的路径。应用会自动创建当前用户自己的 `.agentvault` 目录。初始库为空；设置页可以添加两条文本示例。

## 日常开发

从最新 main 创建功能分支，完成修改后提交 Pull Request：

```powershell
git switch main
git pull --ff-only
git switch -c feature/my-change
pnpm build
pnpm test
pnpm test:ui
```

`pnpm launch` 会重新构建并启动完整桌面应用。`pnpm dev` 仅启动 Vite 前端服务，不包含 Electron 的本地文件接口；目前的完整开发方式是修改后重新构建/启动。

`pnpm test:ui` 使用临时目录和测试窗口，不写入日常收藏库。`pnpm test:github` 会访问公开 GitHub 仓库，属于可选网络集成测试。测试截图和结果写入 `artifacts`，不提交到 Git。

打包前关闭当前目录中的便携版程序，然后运行 `pnpm package`。输出 `release/AgentVault-win32-x64`，必须分发整个文件夹。安装依赖时应保留 `pnpm-lock.yaml`，修改依赖后提交更新的锁文件。

## 目录

- `src`：React 界面、类型与样式。
- `electron/main.cjs`：窗口、IPC、系统对话框与剪贴板。
- `electron/store.cjs`：SQLite、图片副本、Skill 导入与更新。
- `electron/preload.cjs`：受限渲染进程接口。
- `scripts`：打包和真实窗口/网络测试。
- `tests`：数据层测试。
- `docs`：设计与验收记录。

CI 在 Windows 上构建、运行数据测试、打包，再验证打包后的真实窗口流程。成功构建会上传便携版 artifact；正式可下载版本位于 Releases。

## 数据与权限

Git 共享程序源码，不同步个人收藏。需要分享已有资产时，使用设置中的完整备份；另一位使用者在退出应用后按照 README 恢复。不要将 `.agentvault`、数据库、个人图片、备份或凭据提交到仓库。

这是公开仓库，任何人都可以克隆和下载程序。直接推送需要仓库写入权限；没有权限时可 fork 后提 Pull Request，由仓库所有者管理协作者访问。
