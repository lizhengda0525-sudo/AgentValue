# Supabase 多端同步

同步功能在 V2.1.0-beta.1 测试版交付。电脑安装版保留原有 SQLite 本机空间，另增云空间；独立手机网页用于同步验证。安卓将以 APK 安装包交付，当前尚未生成，不要求用户自行部署网页。

## 本地配置

项目地址和公开 key 已记录到本项目的 `.env.local`，该文件被 Git 忽略。模板为 `.env.example`。数据库密码、数据库连接密码和管理员密钥都不需要写入客户端。

客户端使用公开 key 和登录账号访问云端。每条记录和附件按账号隔离；数据库拒绝直接改表，只允许带版本检查的同步接口。[Supabase 公开 key 说明](https://supabase.com/docs/guides/getting-started/api-keys)、[Storage 访问规则](https://supabase.com/docs/guides/storage/security/access-control)。

## 开通使用

1. 在 Supabase 项目的 **SQL Editor** 新建查询，执行 [初始化脚本](../supabase/migrations/202610070001_sync.sql) 的完整内容。脚本可以重复执行，不清空记录。
2. 保持 Authentication 的邮箱登录功能开启。首次使用在 AgentValue 的“本机空间 → 多端同步”中注册邮箱账号；确认邮件后登录。此处的账号密码与数据库密码分开。
3. 先点击“立即同步”，确认没有初始化错误。云空间刚开始为空；需要原有数据时，使用“备份并导入本机数据”。仅支持导入到空云空间，导入前自动备份本机库。
4. 当前可在第二个网页测试端登录同一账号，验证电脑新增事项是否出现。安卓 APK 完成后，下载并安装软件，登录同一账号即可使用，电脑无需在线；APK 开发与验收见 [路线图](roadmap.md)。

电脑与手机各自先保存到本机，联网时每 20 秒检查云端变化；回到应用或恢复网络时也会同步。修改不同记录自动合并，修改同一记录时显示两端内容，由用户选择，并先下载冲突备份。

“本机空间”和“云空间”各自保存数据。导入是复制，之后编辑原来的本机空间不会自动上传；日常多端使用请留在云空间。

## 手机网页开发预览与可选部署

此节供开发者验证网页端。个人安卓交付采用 APK，网页部署不是用户必做操作。

本地构建和预览：

```powershell
pnpm build:mobile
pnpm serve:mobile
```

产物为 `dist-mobile/`，本机预览为 `http://127.0.0.1:5174`。该地址用于电脑查看手机布局，手机正式使用需部署到 HTTPS；浏览器离线保存和安装需要安全来源。

仓库准备了手动触发的 [手机网页部署流程](../.github/workflows/mobile.yml)。如果开发者另需公共测试网址，可完成以下设置；本次发布不自动开启 Pages：

- Settings → Secrets and variables → Actions → **Variables**，添加 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。两项均为公开客户端配置，不能填数据库密码或 secret/service_role key。
- Settings → Pages → Source 选择 **GitHub Actions**。
- Actions → **Deploy AgentValue mobile website** → 手动运行。流程不会因普通推送自动发布。

本仓库为公开仓库，可使用 GitHub Pages 托管静态网页。部署成功后的准确网址以流程输出为准，Supabase 只负责账号、记录和私有附件。[GitHub Pages 自定义部署流程](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

桌面安装包必须使用同一项目配置构建，发布流程读取同名仓库 Variables。V2.0 稳定版不含云同步；试用同步请手动安装 V2.1.0-beta.1。自行构建时使用自己的 Supabase 项目，跨设备使用同一项目和账号。

## 保存、恢复与当前边界

- 同步记录包括事项、执行小计、目标、每日回顾、Prompt、生成实验、图片、Skill 信息及文件。
- 计时器运行状态只属于当前设备；完成后的执行小计会同步，避免两台设备接管同一个正在运行的计时器。
- 附件使用内容校验和和私有存储。单个附件上限 30 MB，首次导入总附件上限 200 MB。附件上传成功后才上传引用它的记录。
- 手机离线使用需要先联网打开一次，让页面和字体完成缓存。已下载的附件可离线查看；尚未下载的图片会标记待下载。网络恢复后点击“立即同步”可以重试。
- 云空间备份为独立 JSON 文件，内含压缩记录及附件。云空间恢复前先下载当前完整备份，再在本机一次替换记录并排队同步；原有桌面目录式备份仍在本机空间使用。
- 删除保留同步标记，避免其他离线设备把旧数据重新补回来。附件暂不自动清理，防止删除仍被其他记录或备份使用的文件；需关注 Supabase 项目的存储用量。
- 如果其他设备删除了事项、这台设备又离线新增小计，小计仍留在记录库和完整备份中，同步面板会标记未关联记录。
- 安卓关闭网页后不提供定时后台提醒；网页内保留待办提醒。电脑云空间接入原有系统提醒，已提醒记录按账号分开。
- 清除浏览器数据或卸载浏览器会删除尚未上传的本机缓存。重要改动请确认最近同步成功，或先导出云空间备份。

## 验证

```powershell
pnpm test
pnpm build
pnpm build:mobile
pnpm test:sync-ui
pnpm test:ui
```

自动测试使用隔离目录、模拟云端及本地 PostgreSQL。覆盖断网重启、并行记录合并、同记录冲突、删除传播、丢失回复后的幂等重试、上传时继续编辑、私有账号隔离、附件校验、完整迁移及备份恢复。

`test:sync-ui` 使用本机 Chrome 启动两个隔离窗口，测试实际桌面/手机页面和离线刷新，不创建真实 Supabase 账号或发送邮件。截图及结果位于 `artifacts/sync/`。真实云端端到端验收需初始化数据库、两端登录个人账号并验证写入、附件与断网恢复；后续以 Windows 与安卓 APK 实机验收为准。
