import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isInstalledApp } = require('../electron/installation.cjs');

test('installed app can update from a user-selected directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-install-'));
  try {
    const executable = path.join(directory, 'AgentValue.exe');
    assert.equal(isInstalledApp(executable, true), false);
    fs.writeFileSync(path.join(directory, 'Uninstall AgentValue.exe'), '');
    assert.equal(isInstalledApp(executable, true), true);
    assert.equal(isInstalledApp(executable, false), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
