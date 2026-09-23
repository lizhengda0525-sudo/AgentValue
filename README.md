# AgentValue

一个本地 AI 资产收藏工具：Skills、文本 Prompt、图片 Prompt 与生成实验。

当前交付平台为 **Windows x64**。

## 直接启动

从 [Releases](https://github.com/lizhengda0525-sudo/AgentValue/releases/latest) 下载 `AgentValue-Setup-*-windows-x64.exe`。安装向导会让你确认或更改安装文件夹；安装后从桌面或开始菜单启动。无需安装 Node.js、Codex 或 API Key。使用 GitHub Skill 导入功能仍需安装 Git。当前源码版本为 **0.3.3**。

从源码打包后，可双击项目根目录的 `Start-AgentValue.vbs` 启动测试用的 `release/win-unpacked/AgentValue.exe`。源码仓库不包含打包产物。

首次启动是空库。设置页可以按需添加两条明确标注的文本示例。所有测试使用隔离目录，不会往个人库加入测试数据。

安装向导建议的位置为 `%LOCALAPPDATA%\Programs\AgentValue\app`，对应数据文件夹为 `%LOCALAPPDATA%\Programs\AgentValue\data`。如果改选其他安装文件夹，例如 `D:\Apps\AgentValue`，默认数据文件夹会建在旁边的 `D:\Apps\AgentValue-data`，避免卸载时删除个人数据。后续更新沿用所选安装位置。可在软件设置页点击“卸载 AgentValue”，也可从 Windows“已安装的应用”卸载；两种方式都会保留个人数据。设置页也可选择空文件夹迁移数据，迁移成功前保留原目录。首次安装会自动复制旧版 `%USERPROFILE%\.agentvault` 收藏库；从旧默认位置改装到新位置时也会复制原有数据，旧目录不会自动删除。

## 已实现

- 首页：真实数量、最近使用 Prompt、最近添加 Skill、最近图片。
- 文本：新增、编辑、分类、标签、收藏、删除确认、全文搜索、一键复制。
- 模板：正文支持 `{{语言}}`、`{{主题}}` 等中文变量；复制时填写、预览，不修改原始模板。重复变量只填写一次；`\{{变量名}}` 按字面复制，不执行脚本。首版变量均为必填自由文本。
- 图片：多张参考图和效果图、选择与拖放、画廊、放大查看；实验记录保存模型、尺寸、比例、参数、评分、备注及不可变正文快照。
- 图片整理：单张移除、前后排序、指定封面；列表与详情使用按需缓存的缩略图，大图仍读取原文件。移除图片会确认，其他图片与实验快照保留。
- Skills：本地目录递归扫描；公开 GitHub 仓库扫描后选择导入；显示 SKILL.md 和文件列表、编辑描述/标签、收藏、搜索、打开文件夹、复制到项目。
- 更新：记录 Commit、检查远程版本、手动更新副本；保留个人名称/标签/收藏；检测外部文件修改并阻止覆盖；复制时拒绝覆盖同名目录。
- 设置：打开或更改数据目录；导出带 SHA-256 文件校验和的完整备份及 JSON 清单；应用内校验、预览和恢复备份，恢复前自动备份当前库。
- 软件更新：启动后及运行期间每 6 小时检查 GitHub Releases；发现新版后由用户下载、重启安装。软件退出后不在后台运行。

## 数据设计

SQLite 是正文和元数据的唯一数据源，避免正文与文件之间出现两份可编辑副本。标签作为规范化去重后的 JSON 数组保存，V1 暂不维护独立标签字典。图片为磁盘副本，通过随机 ID 引用。Skill 使用独立目录与内容指纹；保存相对路径，备份可迁移到其他用户或电脑。

删除收藏会删除相关数据库记录，但暂保留磁盘文件；手动更新的旧 Skill 保存在 `staging` 中。这样可以先保护资产，不在 V1 做自动垃圾清理。Git 下载目录属于缓存，目前也保留在 `git` 中；备份不包含 Git 缓存和 staging 历史目录。

完整备份用于恢复当前收藏库，包含数据库、`skills`、`images`、`catalog.json` 和说明文件。在设置中点击“选择备份并恢复”，选中含 `manifest.json` 的备份目录，核对数量后确认替换整个库。恢复前的完整备份保存到数据目录旁的 `<数据目录名>-recovery` 文件夹，完成后显示具体路径。可再次选择它恢复。暂不支持部分导入或合并。

支持旧版 AgentVault 的 Schema 1/2 备份：校验数据库与引用文件后恢复到新版格式；旧版无校验和的备份会在预览中明确显示。缺失文件、校验和不匹配、未来版本、符号链接和带 WAL/SHM 的不完整备份会拒绝恢复。校验范围上限为 100000 个文件、10 GB。

导入失败会清理未提交的图片和 Skill 副本；程序中断后会根据导入日志检查并清理。恢复时使用暂存目录和替换日志，在提交前的替换阶段中断会于下次启动回退。缩略图位于 `thumbnails` 缓存目录，不包含在备份中；无法生成缩略图的格式回退到原图。

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

打包前请关闭当前输出目录中的 AgentValue。`pnpm package` 输出安装包与 `release/latest.yml` 更新信息；CI 在 Windows 上构建、测试并发布同一份安装包。协作约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

`pnpm dev` 仅用于前端热更新预览；完整磁盘与剪贴板功能请通过构建后的 Electron 桌面运行。可通过 `AGENTVALUE_DATA_DIR` 指定隔离数据目录，测试脚本已自动设置。

## V1 范围

不接入在线图片生成，不运行 Skill，不处理账号、云同步、Agent 编排或 MCP。GitHub 目前支持公开仓库根地址，不支持私有仓库或 `/tree/...` 链接；需要网络的操作可等待最多 120 秒。搜索为本地子串匹配，适合个人收藏规模。

窗口使用隔离上下文与 sandbox，渲染进程没有 Node 权限。所有写入通过受限 IPC 操作；Skill 与 Prompt 正文以纯文本显示，不执行导入内容。

优化方案见 [docs/implementation-plan.md](docs/implementation-plan.md)。自动验收输出位于 `artifacts`。

扩展路线与参考仓库见 [产品路线图](docs/product-roadmap-2026-09-14.md)。0.2.0 完成第一批的恢复、图片整理和基础变量模板；图片元数据导入、全局快捷窗、资产分享包和分页搜索仍在后续范围。

## 与协作者共享

对方可直接下载安装包，也可克隆源码继续开发。每台电脑使用独立的本地收藏库，Git 不同步私人 Prompt 或图片；共享收藏请使用设置里的备份导出与恢复。仓库为公开可读，提交修改则需要仓库所有者授予写入权限，或通过 fork 和 Pull Request 协作。
