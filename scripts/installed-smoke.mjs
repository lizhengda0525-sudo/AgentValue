import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const executable = path.resolve(process.argv[2] || '');
assert.ok(fs.existsSync(executable), 'Installed executable is missing');
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-installed-ui-'));
const env = { ...process.env, AGENTVALUE_DATA_DIR: testData };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: executable, env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: /好灵感，值得被收藏/ }).waitFor();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '卸载 AgentValue' }).waitFor();
  const status = await page.evaluate(() => window.vault.call('softwareStatus'));
  assert.equal(status.canUninstall, true);
  assert.equal(path.resolve(status.installDirectory), path.dirname(executable));
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  assert.equal(await page.evaluate(() => window.vault.call('uninstallSoftware')), false);
  assert.ok(fs.existsSync(executable), 'Cancelled uninstall removed the program');
  console.log('Installed app shows uninstall option; cancellation leaves the app installed.');
} finally {
  if (app) await app.close();
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!testData.startsWith(tempRoot)) throw new Error('Test data escaped TEMP');
  fs.rmSync(testData, { recursive: true, force: true });
}
