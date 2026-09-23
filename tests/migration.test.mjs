import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Vault } = require('../electron/store.cjs');
const { inspectBackup } = require('../electron/backup.cjs');
const {
  copyData,
  defaultDataDirectory,
  resolveDataDirectory,
  readDataChoice,
  saveDataChoice,
} = require('../electron/data-location.cjs');

test('old AgentVault library migrates inside the installed app without changing the original', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-migration-'));
  try {
    const legacy = path.join(root, 'home', '.agentvault');
    const old = new Vault(legacy);
    old.savePrompt({ kind: 'text', title: '旧收藏', content: '保留正文', tags: ['迁移'] });
    old.close();
    fs.renameSync(path.join(legacy, 'agentvalue.db'), path.join(legacy, 'agentvault.db'));
    const executable = path.join(root, 'Programs', 'AgentValue', 'app', 'AgentValue.exe');
    const target = await resolveDataDirectory({
      executable,
      home: path.join(root, 'home'),
      configFile: path.join(root, 'settings.json'),
      localAppData: path.join(root, 'Local'),
    });
    assert.equal(target, path.join(root, 'Programs', 'AgentValue', 'app', 'data'));
    assert.ok(fs.existsSync(path.join(legacy, 'agentvault.db')));
    assert.ok(fs.existsSync(path.join(target, 'agentvalue.db')));
    const migrated = new Vault(target);
    assert.equal(migrated.state().prompts[0].content, '保留正文');
    migrated.close();
    assert.equal(
      await resolveDataDirectory({
        executable,
        home: path.join(root, 'home'),
        configFile: path.join(root, 'settings.json'),
        localAppData: path.join(root, 'Local'),
      }),
      target,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('custom installation keeps data inside the app and copies the prior adjacent library', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-install-location-'));
  try {
    const localAppData = path.join(root, 'Local');
    const previousAdjacent = path.join(root, 'Chosen', 'AgentValue-data');
    const old = new Vault(previousAdjacent);
    old.savePrompt({ kind: 'text', title: '原有收藏', content: '迁移到新安装位置' });
    old.close();

    const executable = path.join(root, 'Chosen', 'AgentValue', 'AgentValue.exe');
    const target = defaultDataDirectory(executable);
    assert.equal(target, path.join(root, 'Chosen', 'AgentValue', 'data'));
    assert.equal(
      await resolveDataDirectory({
        executable,
        home: path.join(root, 'home'),
        configFile: path.join(root, 'settings.json'),
        localAppData,
      }),
      target,
    );
    const migrated = new Vault(target);
    assert.equal(migrated.state().prompts[0].content, '迁移到新安装位置');
    migrated.close();
    assert.ok(fs.existsSync(path.join(previousAdjacent, 'agentvalue.db')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('moving from the old default installation copies its library into the chosen app folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-old-default-'));
  try {
    const localAppData = path.join(root, 'Local');
    const previousDefault = path.join(localAppData, 'Programs', 'AgentValue', 'data');
    const old = new Vault(previousDefault);
    old.savePrompt({ kind: 'text', title: '旧默认目录', content: '继续保留' });
    old.close();
    const executable = path.join(root, 'Chosen', 'AgentValue', 'AgentValue.exe');
    const target = await resolveDataDirectory({
      executable,
      home: path.join(root, 'home'),
      configFile: path.join(root, 'settings.json'),
      localAppData,
    });
    assert.equal(target, path.join(root, 'Chosen', 'AgentValue', 'data'));
    const migrated = new Vault(target);
    assert.equal(migrated.state().prompts[0].content, '继续保留');
    migrated.close();
    assert.ok(fs.existsSync(path.join(previousDefault, 'agentvalue.db')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migration does not mkdir an existing parent such as a Windows drive root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-drive-root-'));
  const originalMkdir = fs.mkdirSync;
  try {
    const source = new Vault(path.join(root, 'source'));
    source.savePrompt({ kind: 'text', title: '旧收藏', content: '保留' });
    source.close();
    fs.mkdirSync = (directory, options) => {
      if (path.resolve(directory) === root) {
        const error = new Error(`EPERM: operation not permitted, mkdir '${root}'`);
        error.code = 'EPERM';
        throw error;
      }
      return originalMkdir(directory, options);
    };
    const target = path.join(root, 'new-data');
    await copyData(source.root, target, 'agentvalue.db');
    assert.ok(fs.existsSync(path.join(target, 'agentvalue.db')));
  } finally {
    fs.mkdirSync = originalMkdir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('data location change copies and verifies before selection, and refuses nonempty targets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-location-'));
  try {
    const source = new Vault(path.join(root, 'original'));
    source.savePrompt({ kind: 'text', title: '收藏', content: '不可丢失' });
    const target = path.join(root, 'selected');
    await copyData(source.root, target, 'agentvalue.db', source.db);
    const config = path.join(root, 'settings', 'settings.json');
    saveDataChoice(config, target);
    assert.equal(readDataChoice(config), target);
    const missingChoice = path.join(root, 'missing-choice.json');
    saveDataChoice(missingChoice, path.join(root, 'disconnected'));
    await assert.rejects(
      resolveDataDirectory({
        executable: path.join(root, 'app', 'AgentValue.exe'),
        home: root,
        configFile: missingChoice,
      }),
      /已选数据目录不可用/,
    );
    const moved = new Vault(target);
    assert.equal(moved.state().prompts[0].content, '不可丢失');
    moved.close();
    assert.equal(source.state().prompts[0].content, '不可丢失');
    await assert.rejects(copyData(source.root, target, 'agentvalue.db', source.db), /非空/);
    source.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('old AgentVault backups remain restorable and new backups use AgentValue', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-backup-'));
  try {
    const source = new Vault(path.join(root, 'source'));
    source.savePrompt({ kind: 'text', title: '旧备份内容', content: '兼容' });
    const backupRoot = path.join(root, 'backups');
    fs.mkdirSync(backupRoot);
    const saved = await source.exportBackup(backupRoot);
    assert.equal(JSON.parse(fs.readFileSync(path.join(saved, 'manifest.json'))).app, 'AgentValue');
    const legacy = path.join(root, 'legacy');
    fs.cpSync(saved, legacy, { recursive: true });
    fs.renameSync(path.join(legacy, 'agentvalue.db'), path.join(legacy, 'agentvault.db'));
    const manifestFile = path.join(legacy, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile));
    manifest.app = 'AgentVault';
    manifest.checksums['agentvault.db'] = manifest.checksums['agentvalue.db'];
    delete manifest.checksums['agentvalue.db'];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.equal(inspectBackup(legacy).counts.prompts, 1);
    const restored = new Vault(path.join(root, 'restored'));
    restored.inspectBackup(legacy);
    await restored.restoreBackup();
    assert.equal(restored.state().prompts[0].content, '兼容');
    assert.ok(fs.existsSync(path.join(restored.root, 'agentvalue.db')));
    restored.close();
    source.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
