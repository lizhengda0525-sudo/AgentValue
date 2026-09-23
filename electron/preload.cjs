const { contextBridge, ipcRenderer, webUtils } = require('electron');
const allowed = new Set([
  'state',
  'savePrompt',
  'addGeneration',
  'favorite',
  'delete',
  'copy',
  'chooseImages',
  'scanLocal',
  'scanGithub',
  'importSkills',
  'saveSkill',
  'exportSkill',
  'openSkill',
  'openData',
  'checkUpdate',
  'updateSkill',
  'backup',
  'inspectBackup',
  'restoreBackup',
  'manageImage',
  'chooseDataLocation',
  'softwareStatus',
  'checkSoftwareUpdate',
  'downloadSoftwareUpdate',
  'installSoftwareUpdate',
]);
contextBridge.exposeInMainWorld('vault', {
  call: async (operation, input) => {
    if (!allowed.has(operation)) throw new Error('不支持的操作');
    const result = await ipcRenderer.invoke('vault:call', operation, input);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  },
  filePath: (file) => webUtils.getPathForFile(file),
  onUpdateStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('agentvalue:update-status', handler);
    return () => ipcRenderer.removeListener('agentvalue:update-status', handler);
  },
});
