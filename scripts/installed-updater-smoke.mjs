import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const executable = path.resolve(process.argv[2] || '');
const testRoot = path.resolve(process.argv[3] || '');
assert.ok(fs.existsSync(executable), 'Installed executable is missing');
assert.ok(fs.existsSync(testRoot), 'Installer test root is missing');
assert.ok(executable.startsWith(testRoot + path.sep), 'Only test temporary installations');

const env = {
  ...process.env,
  APPDATA: path.join(testRoot, 'roaming'),
  LOCALAPPDATA: path.join(testRoot, 'local'),
};
delete env.AGENTVALUE_DATA_DIR;
delete env.AGENTVAULT_DATA_DIR;
delete env.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await electron.launch({ executablePath: executable, env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.vault));
  const status = await page.evaluate(() => window.vault.call('softwareStatus'));
  assert.equal(status.canUninstall, true);
  assert.notEqual(status.phase, 'unavailable', 'Custom installation disabled software updates');
  assert.equal(path.resolve(status.installDirectory), path.dirname(executable));
  console.log('Custom-path installed app enables software updates.');
} finally {
  if (app) await app.close();
}
