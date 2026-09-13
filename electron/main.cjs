const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  shell,
  protocol,
  net,
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Vault } = require('./store.cjs');
const fs = require('node:fs');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vault',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let vault,
  win,
  backupRunning = false;
const isolatedData = process.env.AGENTVAULT_DATA_DIR;
if (isolatedData) app.setPath('userData', path.join(isolatedData, 'electron'));
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(() => {
      vault = new Vault(isolatedData || path.join(app.getPath('home'), '.agentvault'));
      protocol.handle('vault', async (request) => {
        try {
          const url = new URL(request.url);
          if (url.hostname !== 'media') return new Response('Not found', { status: 404 });
          const file = vault.media(url.pathname.slice(1));
          return net.fetch(pathToFileURL(file).href);
        } catch {
          return new Response('Not found', { status: 404 });
        }
      });
      ipcMain.handle('vault:call', async (event, operation, input = {}) => {
        if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
          throw new Error('无效来源');
        try {
          if (backupRunning && !['state', 'copy', 'chooseImages'].includes(operation))
            throw new Error('正在备份，请稍后再试');
          let data;
          switch (operation) {
            case 'state':
              data = vault.state();
              break;
            case 'savePrompt':
              data = vault.savePrompt(input);
              break;
            case 'addGeneration':
              data = vault.addGeneration(input);
              break;
            case 'favorite':
              vault.favorite(input.kind, input.id);
              break;
            case 'delete': {
              const result = await dialog.showMessageBox(win, {
                type: 'question',
                buttons: ['取消', '删除'],
                defaultId: 0,
                cancelId: 0,
                title: '删除收藏',
                message: '确定删除这条收藏吗？',
                detail: '记录会从收藏库移除。磁盘副本暂时保留，可通过先前备份恢复记录。',
                noLink: true,
              });
              if (result.response === 1) {
                vault.remove(input.kind, input.id);
                data = true;
              } else data = false;
              break;
            }
            case 'copy':
              if (typeof input.text !== 'string' || input.text.length > 200000)
                throw new Error('复制内容无效');
              clipboard.writeText(input.text);
              if (input.id) vault.used(input.id);
              break;
            case 'chooseImages': {
              const result = await dialog.showOpenDialog(win, {
                title: '选择图片',
                properties: ['openFile', 'multiSelections'],
                filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
              });
              data = result.canceled ? [] : result.filePaths;
              break;
            }
            case 'scanLocal': {
              const result = await dialog.showOpenDialog(win, {
                title: '选择 Skill 文件夹或其父目录',
                properties: ['openDirectory'],
              });
              data = result.canceled ? null : vault.scanLocal(result.filePaths[0]);
              break;
            }
            case 'scanGithub':
              data = await vault.scanGithub(input.url);
              break;
            case 'importSkills':
              data = vault.importSkills(input.token, input.keys);
              break;
            case 'saveSkill':
              vault.saveSkill(input);
              break;
            case 'exportSkill': {
              const result = await dialog.showOpenDialog(win, {
                title: '选择目标 skills 目录，将创建一个 Skill 子目录',
                properties: ['openDirectory', 'createDirectory'],
              });
              data = result.canceled ? null : vault.exportSkill(input.id, result.filePaths[0]);
              break;
            }
            case 'openSkill': {
              const error = await shell.openPath(vault.skill(input.id).directory);
              if (error) throw new Error(error);
              break;
            }
            case 'openData': {
              const error = await shell.openPath(vault.root);
              if (error) throw new Error(error);
              break;
            }
            case 'checkUpdate':
              data = await vault.checkUpdate(input.id);
              break;
            case 'updateSkill':
              data = await vault.updateSkill(input.id);
              break;
            case 'backup': {
              const result = await dialog.showOpenDialog(win, {
                title: '选择备份保存位置',
                properties: ['openDirectory', 'createDirectory'],
              });
              if (!result.canceled) {
                backupRunning = true;
                try {
                  data = await vault.exportBackup(result.filePaths[0]);
                } finally {
                  backupRunning = false;
                }
              }
              break;
            }
            default:
              throw new Error('不支持的操作');
          }
          return { ok: true, data };
        } catch (error) {
          return { ok: false, error: error.message || '操作失败，请重试' };
        }
      });
      win = new BrowserWindow({
        width: 1380,
        height: 900,
        minWidth: 980,
        minHeight: 680,
        backgroundColor: '#f5f6f8',
        title: 'AgentVault',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (e) => e.preventDefault());
      win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      win.on('ready-to-show', () => win.show());
      win.loadFile(path.join(__dirname, '../dist/index.html'));
      win.webContents.on('render-process-gone', (_e, details) =>
        console.error('Renderer stopped:', details.reason),
      );
      app.on('activate', () => {
        if (win) win.show();
      });
    })
    .catch((e) => {
      dialog.showErrorBox('AgentVault 启动失败', e.message);
      app.quit();
    });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  vault?.close();
});
