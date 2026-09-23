const fs = require('node:fs');
const path = require('node:path');

function uninstallerPath(executable) {
  return path.join(path.dirname(executable), 'Uninstall AgentValue.exe');
}

function isInstalledApp(executable, packaged) {
  return packaged && fs.existsSync(uninstallerPath(executable));
}

module.exports = { uninstallerPath, isInstalledApp };
