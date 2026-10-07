import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SyncEngine } from '../src/sync/engine.ts';
import { CloudBackend } from '../src/sync/cloud-backend.ts';
import { emptyAssistant } from '../shared/assistant-validation.js';
import { unzipSync } from 'fflate';
const require = createRequire(import.meta.url);
const timeout = globalThis.setTimeout;
globalThis.setTimeout = (...args) => {
  const handle = timeout(...args);
  if (args[1] === 60000) handle.unref();
  return handle;
};
const { Vault } = require('../electron/store.cjs');
const { syncExport } = require('../electron/sync-export.cjs');
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJvUAAAAASUVORK5CYII=';
const task = {
  id: 'task',
  title: '同步事项',
  category: 'work',
  project: '',
  status: 'todo',
  priority: 'normal',
  date: '',
  start: '',
  end: '',
  deadline: '',
  notes: '',
};
async function setup(t) {
  const engine = await new SyncEngine(crypto.randomUUID(), {
    push() {
      throw new Error('offline');
    },
    pull: async () => [],
    upload: async () => {},
    download: async () => {
      throw new Error('offline');
    },
  }).open();
  const backend = new CloudBackend(engine);
  t.after(() => backend.dispose());
  return backend;
}
test('cloud CRUD persists all assistant types, images, experiment snapshots and Skill attachments', async (t) => {
  const b = await setup(t);
  const read = await b.call('assistantState');
  const assistant = {
    ...emptyAssistant(),
    tasks: [task],
    goals: [
      { id: 'goal', title: '完成', project: '项目', category: 'work', hint: '', month: '2026-10' },
    ],
    reviews: { '2026-10-07': '回顾' },
    savedReviews: { '2026-10-07': { text: '已完成', signature: 'snapshot' } },
  };
  await b.call('assistantSave', { state: assistant, revision: read.revision });
  assert.equal((await b.call('assistantState')).tasks[0].title, '同步事项');
  const image = await b.call('uploadImage', { name: 'example.png', base64: png });
  const id = await b.call('savePrompt', {
    kind: 'image',
    title: '图片提示词',
    content: 'original',
    references: [image],
    generation: { outputs: [image], rating: 4, model: 'model' },
  });
  await b.call('savePrompt', { id, title: '更新标题', content: 'new content' });
  let state = await b.call('state');
  assert.equal(state.prompts[0].generations[0].snapshot, 'original');
  assert.equal(state.prompts[0].images.length, 2);
  assert.ok(state.prompts[0].images[0].url.startsWith('blob:'));
  await b.call('manageImage', { id: state.prompts[0].images[0].id, action: 'cover' });
  await b.call('favorite', { kind: 'prompt', id });
  state = await b.call('state');
  assert.equal(state.prompts[0].favorite, true);
  assert.ok(state.prompts[0].cover_id);
  const scan = await b.call('scanLocal', {
    files: [
      {
        path: 'reader/SKILL.md',
        base64: Buffer.from('---\nname: reader\ndescription: 阅读\n---\n# Skill').toString(
          'base64',
        ),
      },
      { path: 'reader/references/guide.md', base64: Buffer.from('guide').toString('base64') },
    ],
  });
  const result = await b.call('importSkills', { token: scan.token, keys: ['reader'] });
  assert.equal(result.imported, 1);
  const skill = (await b.call('state')).skills[0];
  assert.deepEqual(skill.files, ['SKILL.md', 'references/guide.md']);
  const exported = await b.call('exportSkill', { id: skill.id });
  assert.equal(exported.name, 'reader.zip');
  assert.ok((await (await fetch(exported.download)).arrayBuffer()).byteLength > 100);
  await b.call('saveSkill', { id: skill.id, name: '阅读', description: 'test', tags: ['阅读'] });
  assert.equal((await b.call('state')).skills[0].name, '阅读');
  await b.call('delete', { kind: 'prompt', id });
  assert.equal((await b.call('state')).prompts.length, 0);
  assert.equal(
    (await b.engine.snapshot()).rows.filter((r) => ['image', 'generation'].includes(r.kind)).length,
    0,
  );
});
test('cloud backup validates checksums and restores atomically; stale editor and traversal rejected', async (t) => {
  const b = await setup(t);
  const id = await b.call('savePrompt', { kind: 'text', title: '备份内容', content: 'text' });
  const state = await b.call('state');
  await b.engine.commit([
    {
      kind: 'goal',
      id: 'g',
      data: { id: 'g', title: 'G', project: 'P', hint: '', month: '2026-10', category: 'work' },
    },
  ]);
  await assert.rejects(
    b.call('savePrompt', { id, title: 'stale', content: 'x', _revision: state.syncRevision }),
    /草稿/,
  );
  const backup = await b.call('backup'),
    archive = await (await fetch(backup.download)).json();
  const preview = await b.call('inspectBackup', { archive });
  assert.equal(preview.verified, true);
  assert.equal(preview.counts.prompts, 1);
  await assert.rejects(
    b.call('scanLocal', {
      files: [{ path: '../SKILL.md', base64: Buffer.from('bad').toString('base64') }],
    }),
    /路径/,
  );
  await b.call('delete', { kind: 'prompt', id });
  const previous = globalThis.document;
  globalThis.document = {
    createElement() {
      return { click() {} };
    },
  };
  try {
    await b.call('restoreBackup');
  } finally {
    globalThis.document = previous;
  }
  assert.equal((await b.call('state')).prompts[0].title, '备份内容');
});
test('native first migration backs up original library and copies binary media plus Skill hierarchy', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-sync-export-'));
  const vault = new Vault(path.join(root, 'data'));
  t.after(() => {
    vault.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const p = path.join(root, 'image.png');
  fs.writeFileSync(p, Buffer.from(png, 'base64'));
  vault.savePrompt({ kind: 'image', title: '原图片', content: 'source', references: [p] });
  const source = path.join(root, 'skill');
  fs.mkdirSync(path.join(source, 'references'), { recursive: true });
  fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: fixture\n---\nSkill');
  fs.writeFileSync(path.join(source, 'references', 'a.bin'), Buffer.from([0, 1, 255]));
  const scan = vault.scanLocal(source);
  vault.importSkills(
    scan.token,
    scan.candidates.map((c) => c.key),
  );
  const old = vault.assistantState();
  vault.assistantSave({ state: { ...old, tasks: [task] }, revision: old.revision });
  const data = await syncExport(vault, path.join(root, 'backups'));
  assert.ok(fs.existsSync(path.join(data.backupPath, 'manifest.json')));
  const b = await setup(t);
  await b.importLocal(data);
  const copied = await b.call('state');
  assert.equal(copied.prompts[0].title, '原图片');
  assert.equal(copied.skills.length, 1);
  assert.equal((await b.call('assistantState')).tasks[0].title, '同步事项');
  assert.equal(vault.state().prompts.length, 1);
  assert.equal(vault.assistantState().tasks.length, 1);
  await assert.rejects(b.importLocal(data), /空云空间/);
});
test('Skill export uses its complete pinned snapshot even if child metadata is still arriving', async (t) => {
  const b = await setup(t),
    one = await b.engine.storeBlob(new Blob(['new main'])),
    two = await b.engine.storeBlob(new Blob(['new guide'])),
    old = await b.engine.storeBlob(new Blob(['old guide']));
  await b.engine.commit([
    {
      kind: 'skill',
      id: 's',
      data: {
        name: 'reader',
        files: ['SKILL.md', 'references/guide.md'],
        file_manifest: { 'SKILL.md': one, 'references/guide.md': two },
      },
    },
    {
      kind: 'skillFile',
      id: 'old',
      data: { skill_id: 's', path: 'references/guide.md', blob: old },
    },
  ]);
  const result = await b.call('exportSkill', { id: 's' }),
    zip = unzipSync(new Uint8Array(await (await fetch(result.download)).arrayBuffer()));
  assert.equal(new TextDecoder().decode(zip['reader/SKILL.md']), 'new main');
  assert.equal(new TextDecoder().decode(zip['reader/references/guide.md']), 'new guide');
  await b.engine.commit([
    { kind: 'skill', id: 'legacy', data: { name: 'legacy', files: ['SKILL.md'] } },
  ]);
  await assert.rejects(b.call('exportSkill', { id: 'legacy' }), /同步完整/);
});
