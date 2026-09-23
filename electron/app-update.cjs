const { autoUpdater } = require('electron-updater');

function createAppUpdater(window, enabled) {
  let state = { phase: 'idle' };
  let checking = false;
  const publish = (next) => {
    state = { ...state, ...next };
    if (!window.isDestroyed()) window.webContents.send('agentvalue:update-status', state);
  };
  if (!enabled) {
    state = { phase: 'unavailable', message: '请安装正式版以使用软件更新' };
    return {
      status: () => state,
      check: async () => state,
      download: async () => state,
      install: () => false,
    };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => publish({ phase: 'checking', message: '' }));
  autoUpdater.on('update-available', (info) =>
    publish({ phase: 'available', version: info.version, message: '' }),
  );
  autoUpdater.on('update-not-available', () =>
    publish({ phase: 'current', version: undefined, message: '' }),
  );
  autoUpdater.on('download-progress', (progress) =>
    publish({ phase: 'downloading', percent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    publish({ phase: 'ready', version: info.version, percent: 100 }),
  );
  autoUpdater.on('error', (error) =>
    publish({ phase: 'error', message: error.message || '检查更新失败' }),
  );

  const check = async () => {
    if (checking || state.phase === 'downloading' || state.phase === 'ready') return state;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      publish({ phase: 'error', message: error.message || '检查更新失败' });
    } finally {
      checking = false;
    }
    return state;
  };
  const download = async () => {
    if (state.phase !== 'available') return state;
    publish({ phase: 'downloading', percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      publish({ phase: 'error', message: error.message || '下载更新失败' });
    }
    return state;
  };
  const install = () => {
    if (state.phase !== 'ready') return false;
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  };
  setTimeout(check, 10000).unref();
  setInterval(check, 6 * 60 * 60 * 1000).unref();
  return { status: () => state, check, download, install };
}

module.exports = { createAppUpdater };
