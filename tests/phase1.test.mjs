import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { templateVariables, resolveTemplate } from '../src/template.ts';
const require = createRequire(import.meta.url);
const { Vault } = require('../electron/store.cjs');
const { inspectBackup, parts } = require('../electron/backup.cjs');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
);
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-phase1-'));
  const vault = new Vault(path.join(root, 'vault'));
  const image = path.join(root, 'image.png');
  fs.writeFileSync(image, png);
  t.after(() => {
    try {
      vault.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vault, image };
}
const save = (vault, title = 'original') =>
  vault.savePrompt({ kind: 'text', title, content: '持久正文 {{语言}}' });

test('templates deduplicate Chinese names, preserve escapes and treat values as literal text', () => {
  const template = '{{ 语言 }} {{语言}} {{主题}} \\{{原样}} {{{坏格式}}} {{ }}';
  assert.deepEqual(templateVariables(template), ['语言', '主题']);
  assert.equal(
    resolveTemplate(template, { 语言: '中文', 主题: '$& {{语言}} <script>' }),
    '中文 中文 $& {{语言}} <script> {{原样}} {{{坏格式}}} {{ }}',
  );
  assert.equal(
    resolveTemplate('{{constructor}} {{__proto__}}', {}),
    '{{constructor}} {{__proto__}}',
  );
  assert.equal(resolveTemplate('{{x}}', { x: '' }), '');
  assert.equal(resolveTemplate('plain', {}), 'plain');
});

test('multi-file import failure cleans copied images and Skill directories', (t) => {
  const { root, vault, image } = setup(t);
  const invalid = path.join(root, 'bad.png');
  fs.writeFileSync(invalid, 'bad');
  assert.throws(
    () =>
      vault.savePrompt({ kind: 'image', title: 'bad', content: 'x', references: [image, invalid] }),
    /格式/,
  );
  assert.deepEqual(fs.readdirSync(path.join(vault.root, 'images/references')), []);
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'SKILL.md'), '# example');
  const scan = vault.scanLocal(source);
  assert.throws(() => vault.importSkills(scan.token, ['.', 'invalid']), /路径无效/);
  assert.deepEqual(fs.readdirSync(path.join(vault.root, 'skills')), []);
  assert.equal(vault.state().skills.length, 0);
});

test('startup import recovery removes only uncommitted files', (t) => {
  const { vault, image } = setup(t);
  vault.savePrompt({ kind: 'image', title: 'kept', content: 'x', references: [image] });
  const kept = vault.db.prepare('SELECT path FROM images').get().path;
  const orphan = `images/references/${randomUUID()}.png`;
  fs.writeFileSync(path.join(vault.root, orphan), png);
  fs.writeFileSync(
    path.join(vault.root, 'staging', `import-${randomUUID()}.json`),
    JSON.stringify([kept, orphan]),
  );
  vault.close();
  const reopened = new Vault(vault.root);
  assert.ok(fs.existsSync(path.join(vault.root, kept)));
  assert.ok(!fs.existsSync(path.join(vault.root, orphan)));
  reopened.close();
});

test('image ordering, selected cover and deletion preserve other images and snapshots', (t) => {
  const { vault, image } = setup(t);
  const id = vault.savePrompt({
    kind: 'image',
    title: 'images',
    content: 'original',
    references: [image, image],
    generation: { rating: 4, outputs: [image] },
  });
  const original = vault.state().prompts[0],
    [first, second] = original.images;
  vault.manageImage({ id: second.id, action: 'move', direction: -1 });
  vault.manageImage({ id: second.id, action: 'cover' });
  let record = vault.state().prompts[0];
  assert.equal(record.cover_id, second.id);
  assert.equal(record.images.filter((i) => i.role === 'reference')[0].id, second.id);
  vault.manageImage({ id: second.id, action: 'delete' });
  record = vault.state().prompts[0];
  assert.equal(record.cover_id, null);
  assert.equal(record.images.length, 2);
  assert.equal(record.generations[0].snapshot, 'original');
  assert.equal(record.images.find((i) => i.id === first.id).role, 'reference');
  assert.throws(() => vault.manageImage({ id: first.id, action: 'move', direction: 8 }), /方向/);
  vault.close();
  const reopened = new Vault(vault.root);
  assert.equal(reopened.state().prompts[0].id, id);
  reopened.close();
});

test('restore validates checksums, replaces library and preserves a usable pre-restore backup', async (t) => {
  const { root, vault, image } = setup(t);
  vault.savePrompt({
    kind: 'image',
    title: 'backup image',
    content: 'original',
    references: [image],
  });
  const target = await vault.exportBackup(root);
  save(vault, 'after backup');
  fs.mkdirSync(path.join(vault.root, 'electron'), { recursive: true });
  fs.writeFileSync(path.join(vault.root, 'electron/untouched'), 'keep');
  const preview = vault.inspectBackup(target);
  assert.equal(preview.verified, true);
  assert.equal(preview.counts.images, 1);
  const restored = await vault.restoreBackup();
  assert.equal(vault.state().prompts.length, 1);
  assert.equal(vault.state().prompts[0].title, 'backup image');
  assert.equal(inspectBackup(restored.recovery).counts.prompts, 2);
  assert.equal(fs.readFileSync(path.join(vault.root, 'electron/untouched'), 'utf8'), 'keep');
  assert.ok(fs.existsSync(vault.media(vault.state().prompts[0].images[0].id)));
  assert.equal(fs.existsSync(path.join(vault.root, 'restore-journal.json')), false);
});

test('changed and missing backup files reject restore without altering current data', async (t) => {
  const { root, vault, image } = setup(t);
  vault.savePrompt({ kind: 'image', title: 'safe', content: 'x', references: [image] });
  const target = await vault.exportBackup(root);
  vault.inspectBackup(target);
  const relative = vault.db.prepare('SELECT path FROM images').get().path;
  fs.appendFileSync(path.join(target, relative), 'tampered');
  await assert.rejects(() => vault.restoreBackup(), /校验/);
  assert.equal(vault.state().prompts[0].title, 'safe');
  fs.unlinkSync(path.join(target, relative));
  assert.throws(() => vault.inspectBackup(target), /清单|ENOENT/);
  assert.equal(vault.state().prompts[0].title, 'safe');
});

test('restore rolls back if opening the replacement database fails', async (t) => {
  const { root, vault } = setup(t);
  save(vault);
  const target = await vault.exportBackup(root);
  save(vault, 'keep current');
  vault.inspectBackup(target);
  const open = vault.openDatabase.bind(vault);
  let count = 0;
  vault.openDatabase = () => {
    if (++count === 1) throw new Error('injected open failure');
    open();
  };
  await assert.rejects(() => vault.restoreBackup(), /injected/);
  assert.equal(vault.state().prompts.length, 2);
  assert.equal(fs.existsSync(path.join(vault.root, 'restore-journal.json')), false);
});

test('restart rolls back an interruption at every managed-file replacement boundary', async (t) => {
  for (let boundary = 0; boundary <= parts.length * 2; boundary++) {
    await t.test(`boundary ${boundary}`, (t) => {
      const { vault, image } = setup(t);
      vault.savePrompt({ kind: 'image', title: 'old library', content: 'x', references: [image] });
      vault.close();
      const stageName = `restore-${randomUUID()}`,
        stage = path.join(vault.root, 'staging', stageName);
      fs.mkdirSync(path.join(stage, 'previous'), { recursive: true });
      fs.mkdirSync(path.join(stage, 'next'));
      for (const part of parts)
        fs.cpSync(path.join(vault.root, part), path.join(stage, 'next', part), { recursive: true });
      fs.writeFileSync(
        path.join(vault.root, 'restore-journal.json'),
        JSON.stringify({ stage: stageName, committed: false }),
      );
      let step = 0;
      for (const part of parts) {
        if (step++ < boundary)
          fs.renameSync(path.join(vault.root, part), path.join(stage, 'previous', part));
        if (step++ < boundary)
          fs.renameSync(path.join(stage, 'next', part), path.join(vault.root, part));
      }
      const reopened = new Vault(vault.root);
      assert.equal(reopened.state().prompts[0].title, 'old library');
      assert.ok(fs.existsSync(reopened.media(reopened.state().prompts[0].images[0].id)));
      assert.equal(fs.existsSync(path.join(vault.root, 'restore-journal.json')), false);
      reopened.close();
    });
  }
});

test('legacy schema 1 backup migrates while keeping prompt content and images', async (t) => {
  const { root, vault, image } = setup(t);
  vault.savePrompt({ kind: 'image', title: 'legacy', content: '正文', references: [image] });
  const target = await vault.exportBackup(root);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(target, 'agentvalue.db'));
  db.exec(
    'ALTER TABLE prompts DROP COLUMN cover_id; ALTER TABLE images DROP COLUMN position; PRAGMA user_version=1;',
  );
  db.close();
  const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
  manifest.schema = 1;
  delete manifest.checksums;
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(vault.inspectBackup(target).verified, false);
  await vault.restoreBackup();
  assert.equal(vault.state().schema, 2);
  assert.equal(vault.state().prompts[0].content, '正文');
  assert.equal(vault.state().prompts[0].images.length, 1);
});
