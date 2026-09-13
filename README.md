# AgentVault

一个本地 AI 资产收藏工具：Skills、文本 Prompt、图片 Prompt 与生成实验。

仓库名称为 **AgentValue**，桌面应用名称为 **AgentVault**。当前交付平台为 **Windows x64**。

## 直接启动

从 [Releases](https://github.com/lizhengda0525-sudo/AgentValue/releases/latest) 下载 `AgentVault-0.1.0-windows-x64.zip`，完整解压后双击 `AgentVault.exe`。便携版不需要安装 Node.js，也不需要 Codex 或 API Key。使用 GitHub 导入功能需要安装 Git。

请保留 EXE 旁边的所有 DLL、resources 和其他文件，不要只复制 exe。从源码自行打包后，也可双击项目根目录的 `Start-AgentVault.vbs`，它会启动 `release/AgentVault-win32-x64/AgentVault.exe`。源码仓库不包含打包产物。

首次启动是空库。设置页可以按需添加两条明确标注的文本示例。所有测试使用隔离目录，不会往个人库加入测试数据。

默认数据位置：`C:\Users\<用户名>\.agentvault`。

## 已实现

- 首页：真实数量、最近使用 Prompt、最近添加 Skill、最近图片。
- 文本：新增、编辑、分类、标签、收藏、删除确认、全文搜索、一键复制。
- 图片：多张参考图和效果图、选择与拖放、画廊、放大查看；实验记录保存模型、尺寸、比例、参数、评分、备注及不可变正文快照。
- Skills：本地目录递归扫描；公开 GitHub 仓库扫描后选择导入；显示 SKILL.md 和文件列表、编辑描述/标签、收藏、搜索、打开文件夹、复制到项目。
- 更新：记录 Commit、检查远程版本、手动更新副本；保留个人名称/标签/收藏；检测外部文件修改并阻止覆盖；复制时拒绝覆盖同名目录。
- 设置：打开数据目录、导出数据库与文件的完整备份，以及可阅读的 JSON 清单。

## 数据设计

SQLite 是正文和元数据的唯一数据源，避免正文与文件之间出现两份可编辑副本。标签作为规范化去重后的 JSON 数组保存，V1 暂不维护独立标签字典。图片为磁盘副本，通过随机 ID 引用。Skill 使用独立目录与内容指纹；保存相对路径，备份可迁移到其他用户或电脑。

删除收藏会删除相关数据库记录，但暂保留磁盘文件；手动更新的旧 Skill 保存在 `staging` 中。这样可以先保护资产，不在 V1 做自动垃圾清理。Git 下载目录属于缓存，目前也保留在 `git` 中；备份不包含 Git 缓存和 staging 历史目录。

完整备份用于恢复当前收藏库，包含数据库、`skills`、`images`、`catalog.json` 和说明文件。恢复时：退出程序，先另存现有数据目录，再将备份中的 `agentvault.db`、`skills`、`images` 放入新的或清空后的数据目录；不要把旧数据库的 WAL/SHM 文件混入新目录。

## 开发与验证

安装 Node.js **24.x** 与 Git，然后执行以下命令。依赖版本通过 pnpm 11.19.0 与锁文件固定。

```powershell
npm install --global pnpm@11.19.0
git clone https://github.com/lizhengda0525-sudo/AgentValue.git
cd AgentValue
pnpm install --frozen-lockfile
pnpm launch
```

后续验证与打包：

```powershell
pnpm test
pnpm test:ui
pnpm test:github
pnpm package
```

打包前请关闭当前输出目录中的 AgentVault。CI 在 Windows 上自动构建、测试并上传便携版；协作约定和目录说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

`pnpm dev` 仅用于前端热更新预览；完整磁盘与剪贴板功能请通过构建后的 Electron 桌面运行。可通过 `AGENTVAULT_DATA_DIR` 指定隔离数据目录，测试脚本已自动设置。

## V1 范围

不接入在线图片生成，不运行 Skill，不处理账号、云同步、Agent 编排或 MCP。GitHub 目前支持公开仓库根地址，不支持私有仓库或 `/tree/...` 链接；需要网络的操作可等待最多 120 秒。搜索为本地子串匹配，适合个人收藏规模。

窗口使用隔离上下文与 sandbox，渲染进程没有 Node 权限。所有写入通过受限 IPC 操作；Skill 与 Prompt 正文以纯文本显示，不执行导入内容。

优化方案见 [docs/implementation-plan.md](docs/implementation-plan.md)。自动验收输出位于 `artifacts`。

## 与协作者共享

对方可直接下载便携版，也可克隆源码继续开发。每台电脑使用独立的本地收藏库，Git 不同步私人 Prompt 或图片；共享收藏请使用设置里的备份导出与恢复。仓库为公开可读，提交修改则需要仓库所有者授予写入权限，或通过 fork 和 Pull Request 协作。
