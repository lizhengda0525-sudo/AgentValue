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
]);
contextBridge.exposeInMainWorld('vault', {
  call: async (operation, input) => {
    if (!allowed.has(operation)) throw new Error('不支持的操作');
    const result = await ipcRenderer.invoke('vault:call', operation, input);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  },
  filePath: (file) => webUtils.getPathForFile(file),
});
