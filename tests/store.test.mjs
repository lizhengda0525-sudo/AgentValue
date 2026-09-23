import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Vault, within } = require('../electron/store.cjs');
const fixtures = [];
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-test-'));
  const vault = new Vault(path.join(root, 'vault'));
  t.after(() => {
    try {
      vault.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, vault };
}
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
);
test('text CRUD persists after restart, tags normalize, favorite and used time survive', (t) => {
  const { root, vault } = fixture(t);
  const recordId = vault.savePrompt({
    kind: 'text',
    title: '代码审查',
    content: '检查边界条件',
    tags: ['Java', 'Java', '  审查  '],
    category: '开发',
  });
  vault.favorite('prompt', recordId);
  vault.used(recordId);
  vault.savePrompt({
    id: recordId,
    title: 'Java 审查',
    content: '新的正文',
    tags: ['Java'],
    category: '开发',
  });
  vault.close();
  const reopened = new Vault(path.join(root, 'vault'));
  const p = reopened.state().prompts[0];
  assert.equal(p.title, 'Java 审查');
  assert.equal(p.content, '新的正文');
  assert.equal(p.favorite, true);
  assert.ok(p.used_at);
  assert.deepEqual(p.tags, ['Java']);
  reopened.remove('prompt', recordId);
  assert.equal(reopened.state().prompts.length, 0);
  reopened.close();
});
test('generation snapshots and image copies survive source deletion and prompt edits', (t) => {
  const { root, vault } = fixture(t);
  const imagePath = path.join(root, '原始.png');
  fs.writeFileSync(imagePath, png);
  const promptId = vault.savePrompt({
    kind: 'image',
    title: '水彩风景',
    content: '原始 Prompt',
    tags: ['水彩'],
    references: [imagePath],
    generation: { model: 'test model', rating: 4, ratio: '16:9', outputs: [imagePath] },
  });
  fs.unlinkSync(imagePath);
  vault.savePrompt({ id: promptId, title: '水彩风景', content: '修改后的 Prompt', tags: ['水彩'] });
  vault.addGeneration({ promptId, model: 'new model', rating: 5, snapshot: '本次独立快照' });
  const p = vault.state().prompts[0];
  assert.equal(p.generations.length, 2);
  assert.equal(p.generations[1].snapshot, '原始 Prompt');
  assert.equal(p.generations[0].snapshot, '本次独立快照');
  assert.equal(p.images.length, 2);
  assert.ok(fs.existsSync(vault.media(p.images[0].id)));
  vault.remove('prompt', promptId);
  assert.equal(vault.db.prepare('SELECT count(*) AS n FROM generations').get().n, 0);
  assert.equal(vault.db.prepare('SELECT count(*) AS n FROM images').get().n, 0);
});
test('failed image import rolls back entire prompt and validates media signatures', (t) => {
  const { root, vault } = fixture(t);
  const invalid = path.join(root, 'script.png');
  fs.writeFileSync(invalid, '<script>alert(1)</script>');
  assert.throws(
    () => vault.savePrompt({ kind: 'image', title: '坏图', content: 'x', references: [invalid] }),
    /格式/,
  );
  assert.equal(vault.state().prompts.length, 0);
  assert.throws(
    () =>
      vault.savePrompt({
        kind: 'image',
        title: 'bad rating',
        content: 'x',
        generation: { rating: 6 },
      }),
    /评分/,
  );
  assert.equal(vault.state().prompts.length, 0);
  assert.throws(() => vault.media('../agentvalue.db'), /不存在/);
});
test('local skill import deduplicates, parses YAML, copies files, refuses overwrite and escape', (t) => {
  const { root, vault } = fixture(t);
  const source = path.join(root, 'source', 'review');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    '---\nname: review\ndescription: |\n  检查代码\n  保留上下文\n---\n# 审查\n不要运行我。',
  );
  fs.writeFileSync(path.join(source, 'scripts', 'helper.txt'), 'contents');
  const scan = vault.scanLocal(path.dirname(source));
  assert.equal(scan.candidates.length, 1);
  assert.match(scan.candidates[0].description, /保留上下文/);
  assert.throws(() => vault.importSkills(scan.token, ['../']), /路径无效/);
  const result = vault.importSkills(scan.token, ['review']);
  assert.equal(result.imported, 1);
  assert.equal(vault.importSkills(scan.token, ['review']).skipped, 1);
  const s = vault.state().skills[0];
  vault.saveSkill({ id: s.id, name: 'review', description: '我的描述', tags: ['Java'] });
  const target = path.join(root, 'project');
  fs.mkdirSync(target);
  const exported = vault.exportSkill(s.id, target);
  assert.equal(fs.readFileSync(path.join(exported, 'scripts', 'helper.txt'), 'utf8'), 'contents');
  assert.throws(() => vault.exportSkill(s.id, target), /已存在/);
  fs.writeFileSync(path.join(source, 'SKILL.md'), 'changed');
  assert.match(vault.skill(s.id).content, /# 审查/);
  assert.equal(within(root, path.join(root, '..', 'escape')), false);
  assert.equal(within(root, path.join(root, 'sub')), true);
});
test('backup is portable and includes SQLite, images, skill files and readable metadata', async (t) => {
  const { root, vault } = fixture(t);
  const source = path.join(root, 'skill');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: backup-skill\n---\n# portable');
  const scan = vault.scanLocal(source);
  vault.importSkills(scan.token, ['.']);
  vault.savePrompt({ kind: 'text', title: 'backup', content: '持久保存' });
  await assert.rejects(() => vault.exportBackup(vault.root), /以外/);
  const target = await vault.exportBackup(root);
  assert.ok(fs.existsSync(path.join(target, 'manifest.json')));
  const restored = new Vault(target);
  assert.equal(restored.state().prompts[0].content, '持久保存');
  assert.ok(fs.existsSync(restored.skill(restored.state().skills[0].id).directory));
  restored.close();
});
test('invalid GitHub URLs never reach Git execution', async (t) => {
  const { vault } = fixture(t);
  for (const url of [
    'file:///c:/secret',
    'https://github.com/a/b/tree/main',
    'https://evil.com/a/b',
    '--upload-pack=command',
  ])
    await assert.rejects(() => vault.scanGithub(url), /公开 GitHub/);
});
