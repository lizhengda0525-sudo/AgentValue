import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Vault } = require('../electron/store.cjs');
const { createLocalServer } = require('../electron/local-server.cjs');
const task = (id = 'task') => ({
  id,
  title: '实际任务',
  category: 'work',
  project: '项目',
  status: 'todo',
  priority: 'normal',
  date: '2026-10-05',
  start: '09:00',
  end: '10:00',
  deadline: '',
  notes: '',
});
const setup = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-assistant-'));
  let vault = new Vault(path.join(root, 'data'));
  t.after(() => {
    vault.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    get vault() {
      return vault;
    },
    reopen: () => {
      vault.close();
      vault = new Vault(path.join(root, 'data'));
      return vault;
    },
  };
};
test('new database is empty; tasks, daily logs, goals, drafts, saved review and running timer survive restart', (t) => {
  const fixture = setup(t),
    before = fixture.vault.assistantState();
  assert.equal(before.tasks.length, 0);
  const startedAt = Date.now() - 1000;
  const state = {
    ...before,
    tasks: [task()],
    logs: [
      {
        id: 'log',
        taskId: 'task',
        date: '2026-10-05',
        start: '09:00',
        end: '09:30',
        summary: '完成草稿',
        source: 'manual',
      },
    ],
    goals: [
      { id: 'goal', title: '交付', category: 'work', project: '项目', hint: '', month: '2026-10' },
    ],
    reviews: { '2026-10-05': '回顾草稿' },
    savedReviews: { '2026-10-05': { text: '回顾定稿', signature: 'snapshot' } },
    timer: { taskId: 'task', startedAt, segments: [] },
  };
  const saved = fixture.vault.assistantSave({ state, revision: before.revision });
  const after = fixture.reopen().assistantState();
  assert.equal(after.revision, saved.revision);
  for (const key of ['tasks', 'logs', 'goals', 'reviews', 'savedReviews', 'timer'])
    assert.deepEqual(after[key], state[key]);
});
test('stale writer is rejected; invalid schedules and orphan logs cannot partially replace saved data', (t) => {
  const { vault } = setup(t),
    before = vault.assistantState();
  const state = { ...before, tasks: [task()] };
  const saved = vault.assistantSave({ state, revision: before.revision });
  assert.throws(
    () => vault.assistantSave({ state: { ...state, tasks: [] }, revision: before.revision }),
    /其他窗口/,
  );
  assert.throws(
    () =>
      vault.assistantSave({
        state: { ...state, tasks: [task(), { ...task('other'), end: '08:00' }] },
        revision: saved.revision,
      }),
    /计划时间/,
  );
  assert.throws(
    () =>
      vault.assistantSave({
        state: {
          ...state,
          logs: [
            {
              id: 'log',
              taskId: 'missing',
              date: '2026-10-05',
              start: '09:00',
              end: '10:00',
              summary: '',
            },
          ],
        },
        revision: saved.revision,
      }),
    /事项不存在/,
  );
  assert.deepEqual(vault.assistantState().tasks, [task()]);
  assert.equal(vault.assistantState().revision, saved.revision);
});
test('deleting task with logs and timer is atomic; removed assets do not prevent subsequent saves', (t) => {
  const { vault } = setup(t),
    state = vault.assistantState();
  const promptId = vault.savePrompt({ kind: 'text', title: '工具', content: '正文' });
  state.tasks = [{ ...task(), assetId: promptId, assetKind: 'prompt', asset: '工具' }];
  state.timer = {
    taskId: 'task',
    startedAt: null,
    segments: [{ start: Date.now() - 1000, end: Date.now() }],
  };
  let { revision } = vault.assistantSave({ state, revision: state.revision });
  vault.remove('prompt', promptId);
  revision = vault.assistantSave({ state, revision }).revision;
  assert.equal(vault.assistantState().tasks[0].assetId, undefined);
  vault.assistantSave({
    state: {
      ...state,
      tasks: [],
      logs: [],
      timer: { taskId: null, startedAt: null, segments: [] },
    },
    revision,
  });
  assert.equal(vault.assistantState().tasks.length, 0);
});
test('backup restores all assistant data alongside assets and retains a recovery copy', async (t) => {
  const { root, vault } = setup(t),
    state = vault.assistantState();
  state.tasks = [task()];
  state.reviews = { '2026-10-05': '已保存' };
  vault.assistantSave({ state, revision: state.revision });
  const promptId = vault.savePrompt({ kind: 'text', title: '实际资产', content: '提示词' });
  const target = await vault.exportBackup(root);
  const latest = vault.assistantState();
  latest.tasks[0].title = '临时修改';
  vault.assistantSave({ state: latest, revision: latest.revision });
  vault.inspectBackup(target);
  const restored = await vault.restoreBackup();
  assert.equal(vault.assistantState().tasks[0].title, '实际任务');
  assert.equal(vault.assistantState().reviews['2026-10-05'], '已保存');
  assert.equal(vault.state().prompts[0].id, promptId);
  assert.ok(fs.existsSync(restored.recovery));
  assert.throws(
    () => vault.assistantSave({ state: latest, revision: latest.revision }),
    /其他窗口/,
  );
});
test('schema 2 migrates without changing the existing asset library', (t) => {
  const fixture = setup(t),
    id = fixture.vault.savePrompt({ kind: 'text', title: '已有收藏', content: '保留正文' });
  fixture.vault.db.exec(
    'DROP TABLE assistant_records; DROP TABLE assistant_meta; PRAGMA user_version=2;',
  );
  const migrated = fixture.reopen();
  assert.equal(migrated.state().schema, 3);
  assert.equal(migrated.state().prompts[0].id, id);
  assert.equal(migrated.assistantState().tasks.length, 0);
});
test('local HTTP backend persists actual tasks and assets; rejects foreign origins, untrusted sessions and file traversal', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvalue-http-'));
  const { server, listen } = createLocalServer({
    root: path.join(root, 'data'),
    dist: path.resolve('dist'),
    port: 0,
  });
  await listen();
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const session = await (await fetch(url + '/api/session')).json();
  const call = async (operation, input) => {
    const response = await fetch(url + '/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AgentValue-Token': session.token },
      body: JSON.stringify({ operation, input }),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };
  const before = await call('assistantState');
  await call('assistantSave', { state: { ...before, tasks: [task()] }, revision: before.revision });
  assert.equal((await call('assistantState')).tasks[0].title, '实际任务');
  const id = await call('savePrompt', {
    kind: 'text',
    title: '浏览器真实资产',
    content: '持久保存',
  });
  assert.equal((await call('state')).prompts[0].id, id);
  assert.equal(
    (await fetch(url + '/api/session', { headers: { Origin: 'https://attacker.example' } })).status,
    403,
  );
  assert.equal(
    (
      await fetch(url + '/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    400,
  );
  await assert.rejects(
    call('scanLocal', {
      files: [{ path: '../escape/SKILL.md', base64: Buffer.from('bad').toString('base64') }],
    }),
    /文件路径/,
  );
  const backup = await call('backup');
  const archive = await (await fetch(url + backup.download)).json();
  assert.equal(archive.app, 'AgentValue-Archive');
  assert.ok(archive.files['agentvalue.db']);
  await call('savePrompt', { id, title: '更改后的资产', content: '新正文' });
  await call('inspectBackup', { archive });
  await call('restoreBackup');
  assert.equal((await call('state')).prompts[0].title, '浏览器真实资产');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
    'base64',
  );
  const imageKey = await call('uploadImage', {
    name: '验收图片.png',
    base64: png.toString('base64'),
  });
  const imagePromptId = await call('savePrompt', {
    kind: 'image',
    title: '真实图片',
    content: '第一版',
    generation: { outputs: [imageKey], rating: 4, model: 'fixture' },
  });
  await call('savePrompt', { id: imagePromptId, title: '真实图片', content: '第二版' });
  const record = (await call('state')).prompts.find((p) => p.id === imagePromptId);
  assert.equal(record.generations[0].snapshot, '第一版');
  assert.equal(record.generations[0].rating, 4);
  assert.equal(record.images[0].name, '验收图片.png');
  assert.deepEqual(Buffer.from(await (await fetch(url + record.images[0].url)).arrayBuffer()), png);
  await call('manageImage', { id: record.images[0].id, action: 'cover' });
  assert.equal(
    (await call('state')).prompts.find((p) => p.id === imagePromptId).cover_id,
    record.images[0].id,
  );
  const content = '---\nname: 验收skill\ndescription: 本地导入\n---\n# Skill\n实际内容';
  const scan = await call('scanLocal', {
    files: [
      { path: 'fixture/SKILL.md', base64: Buffer.from(content).toString('base64') },
      { path: 'fixture/references/notes.md', base64: Buffer.from('参考文件').toString('base64') },
    ],
  });
  assert.equal(scan.candidates.length, 1);
  assert.equal(
    (await call('importSkills', { token: scan.token, keys: [scan.candidates[0].key] })).imported,
    1,
  );
  const skill = (await call('state')).skills[0];
  assert.equal(skill.content, content);
  const exported = await call('exportSkill', { id: skill.id });
  const requireBuilder = createRequire(require.resolve('electron-builder'));
  const unzipper = createRequire(requireBuilder.resolve('app-builder-lib'))('unzipper');
  const zip = await unzipper.Open.buffer(
    Buffer.from(await (await fetch(url + exported.download)).arrayBuffer()),
  );
  assert.deepEqual(zip.files.map((f) => f.path).sort(), [
    '验收skill/SKILL.md',
    '验收skill/references/notes.md',
  ]);
  assert.equal(
    (await zip.files.find((f) => f.path.endsWith('SKILL.md')).buffer()).toString(),
    content,
  );
  const completeBackup = await call('backup'),
    completeArchive = await (await fetch(url + completeBackup.download)).json();
  await call('delete', { kind: 'prompt', id: imagePromptId });
  await call('delete', { kind: 'skill', id: skill.id });
  const preview = await call('inspectBackup', { archive: completeArchive });
  assert.equal(preview.counts.tasks, 1);
  assert.equal(preview.counts.skills, 1);
  await call('restoreBackup');
  const recovered = await call('state');
  assert.equal(recovered.skills[0].content, content);
  assert.equal(
    recovered.prompts.find((p) => p.id === imagePromptId).images[0].name,
    '验收图片.png',
  );
});
