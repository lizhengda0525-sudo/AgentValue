# AgentVault V1 验收记录

验证日期：2026-09-13。环境：Windows x64，Node 24，Electron 44.3.0。

## 通过的检查

- TypeScript 类型检查与 Vite 生产构建。
- 6 项数据层测试：文本增删改与重启；图片副本及实验快照；异常事务回滚；Skill YAML 解析、重复检测与不覆盖复制；可迁移备份；拒绝非法 GitHub 地址。
- 7 组真实 Electron 窗口流程，开发版与便携版均通过：启动空库；文本/标签/收藏/全文搜索/实际剪贴板；图片选择上传/本地媒体协议/Gallery/快照/新增实验/大图；Skill 扫描选择/导入/编辑标签/复制与覆盖拒绝；重启持久化；备份；删除确认的取消与确认分支。
- 窗口流程未捕获到任何渲染异常。测试的原生目录选择与删除确认通过测试驱动返回已知路径/选择，后续仍走正式 IPC 与真实磁盘操作；没有自动操作其他应用。
- GitHub 实际网络流程：扫描 `https://github.com/openai/skills`，发现 44 个 Skill，选择导入 `skill-creator`，读取真实远端 Commit；将测试库中的本地 Commit 模拟为旧值，验证更新提醒和重新下载，确认保留个人名称/标签/收藏；人为修改副本后确认更新被阻止。
- 已检查首页、画廊和图片详情截图，调整文字对比度。
- `pnpm audit --prod`：未报告已知漏洞。

## 交付

- `release/AgentVault-win32-x64/AgentVault.exe`：可直接运行的 Windows x64 便携版。
- `Start-AgentVault.vbs`：项目根目录双击启动入口。
- `README.md`：功能、数据目录、恢复方法、开发命令与 V1 边界。
- `artifacts/home.png`、`gallery.png`、`image-detail.png`：隔离测试窗口截图。
- `artifacts/smoke-results.json`、`github-results.json`：自动验收结果。

便携版已使用隔离数据目录完成重启与持久化验证。正式个人库使用用户主目录下 `.agentvault`，没有预装测试数据。

尚未提供安装器、代码签名、私有仓库认证、在线图片生成、自动垃圾清理或应用内备份恢复。这些不影响当前个人本地收藏流程。
