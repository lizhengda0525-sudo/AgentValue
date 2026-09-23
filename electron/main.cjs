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
const { thumbnailService } = require('./thumbnails.cjs');
const { databaseFile } = require('./backup.cjs');
const {
  settingsFile,
  saveDataChoice,
  copyData,
  resolveDataDirectory,
} = require('./data-location.cjs');
const { createAppUpdater } = require('./app-update.cjs');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vault',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let vault,
  win,
  appUpdater,
  backupRunning = false;
let activeCalls = 0;
const isolatedData = process.env.AGENTVALUE_DATA_DIR || process.env.AGENTVAULT_DATA_DIR;
const dataSettings = settingsFile();
app.setName('AgentValue');
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
    .then(async () => {
      app.setAppUserModelId('io.github.lizhengda0525-sudo.agentvalue');
      const dataDirectory = await resolveDataDirectory({
        executable: app.getPath('exe'),
        home: app.getPath('home'),
        configFile: dataSettings,
        override: isolatedData,
      });
      vault = new Vault(dataDirectory);
      const thumbnail = thumbnailService(vault);
      protocol.handle('vault', async (request) => {
        try {
          const url = new URL(request.url);
          if (url.hostname !== 'media') return new Response('Not found', { status: 404 });
          const file = url.searchParams.has('thumbnail')
            ? await thumbnail(url.pathname.slice(1))
            : vault.media(url.pathname.slice(1));
          return net.fetch(pathToFileURL(file).href);
        } catch {
          return new Response('Not found', { status: 404 });
        }
      });
      ipcMain.handle('vault:call', async (event, operation, input = {}) => {
        if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
          throw new Error('无效来源');
        activeCalls++;
        try {
          if (backupRunning && !['state', 'softwareStatus'].includes(operation))
            throw new Error('正在备份或恢复，请稍后再试');
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
            case 'manageImage': {
              if (input.action === 'delete') {
                const result = await dialog.showMessageBox(win, {
                  type: 'question',
                  buttons: ['取消', '移除图片'],
                  defaultId: 0,
                  cancelId: 0,
                  message: '从这条记录中移除图片？',
                  detail: '其他图片和实验快照会保留。恢复该图片关联需使用之前的备份。',
                  noLink: true,
                });
                if (result.response !== 1) {
                  data = false;
                  break;
                }
                if (backupRunning) throw new Error('正在备份或恢复，请稍后再试');
              }
              data = vault.manageImage(input);
              break;
            }
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
                if (backupRunning) throw new Error('正在备份或恢复，请稍后再试');
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
            case 'chooseDataLocation': {
              if (isolatedData) throw new Error('测试数据目录不能在应用内更改');
              if (activeCalls > 1 || vault.busy.size)
                throw new Error('请等待当前操作完成后再迁移数据');
              const result = await dialog.showOpenDialog(win, {
                title: '选择新的 AgentValue 数据文件夹（必须为空）',
                properties: ['openDirectory', 'createDirectory'],
              });
              if (result.canceled) break;
              const target = result.filePaths[0];
              if (path.resolve(target) === vault.root) {
                data = vault.root;
                break;
              }
              await copyData(vault.root, target, databaseFile, vault.db);
              saveDataChoice(dataSettings, target);
              data = target;
              setImmediate(() => {
                app.relaunch();
                app.exit(0);
              });
              break;
            }
            case 'softwareStatus':
              data = { ...appUpdater.status(), currentVersion: app.getVersion() };
              break;
            case 'checkSoftwareUpdate':
              data = await appUpdater.check();
              break;
            case 'downloadSoftwareUpdate':
              data = await appUpdater.download();
              break;
            case 'installSoftwareUpdate':
              if (activeCalls > 1 || vault.busy.size)
                throw new Error('请等待当前操作完成后再更新软件');
              data = appUpdater.install();
              break;
            case 'checkUpdate':
              data = await vault.checkUpdate(input.id);
              break;
            case 'updateSkill':
              data = await vault.updateSkill(input.id);
              break;
            case 'backup': {
              if (activeCalls > 1) throw new Error('请等待当前操作完成后再备份');
              if (vault.busy.size) throw new Error('Skill 正在更新，请稍后备份');
              backupRunning = true;
              try {
                const result = await dialog.showOpenDialog(win, {
                  title: '选择备份保存位置',
                  properties: ['openDirectory', 'createDirectory'],
                });
                if (!result.canceled) {
                  data = await vault.exportBackup(result.filePaths[0]);
                }
              } finally {
                backupRunning = false;
              }
              break;
            }
            case 'inspectBackup': {
              if (activeCalls > 1) throw new Error('请等待当前操作完成后再校验备份');
              backupRunning = true;
              try {
                const result = await dialog.showOpenDialog(win, {
                  title: '选择包含 manifest.json 的备份文件夹',
                  properties: ['openDirectory'],
                });
                data = result.canceled ? null : vault.inspectBackup(result.filePaths[0]);
              } finally {
                backupRunning = false;
              }
              break;
            }
            case 'restoreBackup': {
              if (activeCalls > 1) throw new Error('请等待当前操作完成后再恢复');
              backupRunning = true;
              try {
                data = await vault.restoreBackup();
              } finally {
                backupRunning = false;
              }
              break;
            }
            default:
              throw new Error('不支持的操作');
          }
          return { ok: true, data };
        } catch (error) {
          return { ok: false, error: error.message || '操作失败，请重试' };
        } finally {
          activeCalls--;
        }
      });
      win = new BrowserWindow({
        width: 1380,
        height: 900,
        minWidth: 980,
        minHeight: 680,
        backgroundColor: '#f5f6f8',
        title: 'AgentValue',
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
      appUpdater = createAppUpdater(
        win,
        app.isPackaged &&
          !isolatedData &&
          path.basename(path.dirname(app.getPath('exe'))).toLowerCase() === 'app',
      );
      app.on('activate', () => {
        if (win) win.show();
      });
    })
    .catch((e) => {
      dialog.showErrorBox('AgentValue 启动失败', e.message);
      app.quit();
    });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  vault?.close();
});
