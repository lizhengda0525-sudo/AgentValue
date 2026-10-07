import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../src/sync/engine.ts';
class Cloud {
  records = new Map();
  receipts = new Map();
  blobs = new Map();
  seq = 0;
  offline = false;
  loseReply = false;
  wait;
  async push(m) {
    if (this.offline) throw new Error('offline');
    if (this.wait) await this.wait;
    if (this.receipts.has(m.operationId)) return structuredClone(this.receipts.get(m.operationId));
    const key = `${m.kind}:${m.id}`,
      old = this.records.get(key);
    if ((old?.version || 0) !== m.baseVersion)
      return { status: 'conflict', record: structuredClone(old) };
    const row = {
      kind: m.kind,
      record_id: m.id,
      data: structuredClone(m.data),
      deleted: m.deleted,
      version: (old?.version || 0) + 1,
      change_seq: ++this.seq,
      updated_at: new Date().toISOString(),
    };
    this.records.set(key, row);
    const result = { status: 'applied', record: row };
    this.receipts.set(m.operationId, result);
    if (this.loseReply) {
      this.loseReply = false;
      throw new Error('reply lost');
    }
    return structuredClone(result);
  }
  async pull(cursor) {
    if (this.offline) throw new Error('offline');
    return structuredClone(
      [...this.records.values()]
        .filter((r) => r.change_seq > cursor)
        .sort((a, b) => a.change_seq - b.change_seq)
        .slice(0, 200),
    );
  }
  async upload(hash, blob) {
    if (this.offline) throw new Error('offline');
    this.blobs.set(hash, blob);
  }
  async download(hash) {
    if (!this.blobs.has(hash)) throw new Error('missing');
    return this.blobs.get(hash);
  }
}
const edit = (id, title) => ({ kind: 'task', id, data: { id, title } });
const device = async (cloud, name = crypto.randomUUID()) => new SyncEngine(name, cloud).open();
test('offline changes survive reload; different records merge; deletion propagates', async () => {
  const cloud = new Cloud(),
    name = crypto.randomUUID();
  let a = await device(cloud, name);
  const b = await device(cloud);
  cloud.offline = true;
  await a.commit([edit('a', 'A')]);
  await a.sync();
  assert.equal(a.status.pending, 1);
  a.close();
  a = await device(cloud, name);
  assert.equal((await a.snapshot()).rows[0].data.title, 'A');
  cloud.offline = false;
  await b.commit([edit('b', 'B')]);
  await Promise.all([a.sync(), b.sync()]);
  await Promise.all([a.sync(), b.sync()]);
  assert.equal((await a.snapshot()).rows.length, 2);
  assert.equal((await b.snapshot()).rows.length, 2);
  await a.commit([{ ...edit('a', 'A'), deleted: true }]);
  await a.sync();
  await b.sync();
  assert.deepEqual(
    (await b.snapshot()).rows.map((r) => r.id),
    ['b'],
  );
  a.close();
  b.close();
});
test('conflicting edits survive offline restart and require explicit choice', async () => {
  const cloud = new Cloud(),
    a = await device(cloud),
    name = crypto.randomUUID();
  let b = await device(cloud, name);
  await a.commit([edit('a', 'initial')]);
  await a.sync();
  await b.sync();
  await a.commit([edit('a', 'desktop')]);
  await b.commit([edit('a', 'phone')]);
  await a.sync();
  await b.sync();
  assert.equal(b.status.conflicts, 1);
  assert.equal((await b.snapshot()).rows[0].data.title, 'phone');
  b.close();
  b = await device(cloud, name);
  const [c] = await b.conflicts();
  assert.equal(c.remote.data.title, 'desktop');
  assert.equal(c.local.data.title, 'phone');
  await b.resolve(c.key, 'local');
  await b.sync();
  await a.sync();
  assert.equal((await a.snapshot()).rows[0].data.title, 'phone');
  a.close();
  b.close();
});
test('lost reply followed by editing replays immutable receipt before sending newer edit', async () => {
  const cloud = new Cloud(),
    name = crypto.randomUUID();
  let a = await device(cloud, name);
  cloud.loseReply = true;
  await a.commit([edit('a', 'first')]);
  await a.sync();
  assert.equal(a.status.pending, 1);
  await a.commit([edit('a', 'newer')]);
  a.close();
  a = await device(cloud, name);
  await a.sync();
  assert.equal(a.status.pending, 0);
  assert.equal(a.status.conflicts, 0);
  assert.equal(cloud.records.get('task:a').data.title, 'newer');
  assert.equal(cloud.records.get('task:a').version, 2);
  a.close();
});
test('edit during network request is retained; local CAS protects drafts', async () => {
  const cloud = new Cloud(),
    a = await device(cloud);
  let finish;
  cloud.wait = new Promise((r) => {
    finish = r;
  });
  const old = await a.snapshot();
  await a.commit([edit('a', 'first')], old.revision);
  const running = a.sync();
  await new Promise((r) => setTimeout(r, 15));
  await a.commit([edit('a', 'latest')]);
  finish();
  await running;
  assert.equal(cloud.records.get('task:a').data.title, 'latest');
  await assert.rejects(a.commit([edit('b', 'stale')], old.revision), /草稿/);
  assert.equal((await a.snapshot()).rows.length, 1);
  a.close();
});
test('attachments upload before metadata; hashes checked; timer and account caches stay local', async () => {
  const cloud = new Cloud(),
    a = await device(cloud),
    b = await device(cloud),
    separate = await device(new Cloud());
  const hash = await a.storeBlob(new Blob(['file content']));
  await a.commit([{ kind: 'image', id: 'img', data: { blob: hash } }], undefined, {
    taskId: 'local',
  });
  cloud.offline = true;
  await a.sync();
  assert.equal(a.status.pending, 1);
  cloud.offline = false;
  await a.sync();
  await b.sync();
  assert.equal(await (await b.blob(hash)).text(), 'file content');
  assert.equal((await b.snapshot()).timer, undefined);
  assert.equal((await separate.snapshot()).rows.length, 0);
  a.close();
  b.close();
  separate.close();
});
test('cloud deletion versus local edit becomes a conflict instead of resurrection', async () => {
  const cloud = new Cloud(),
    a = await device(cloud),
    b = await device(cloud);
  await a.commit([edit('a', 'start')]);
  await a.sync();
  await b.sync();
  await b.commit([edit('a', 'offline work')]);
  await a.commit([{ ...edit('a', 'start'), deleted: true }]);
  await a.sync();
  await b.sync();
  const [c] = await b.conflicts();
  assert.equal(c.remote.deleted, true);
  assert.equal((await b.snapshot()).rows[0].data.title, 'offline work');
  await b.resolve(c.key, 'remote');
  assert.equal((await b.snapshot()).rows.length, 0);
  assert.equal(b.status.pending, 0);
  a.close();
  b.close();
});
test('Skill bundle uploads every pinned file before publishing its manifest', async () => {
  const cloud = new Cloud(),
    a = await device(cloud);
  const one = await a.storeBlob(new Blob(['main'])),
    two = await a.storeBlob(new Blob(['guide']));
  const original = cloud.push.bind(cloud);
  cloud.push = async (mutation) => {
    if (mutation.kind === 'skill') {
      assert.equal(cloud.blobs.size, 2);
      assert.ok(cloud.blobs.has(one) && cloud.blobs.has(two));
    }
    return original(mutation);
  };
  await a.commit([
    {
      kind: 'skill',
      id: 's',
      data: { file_manifest: { 'SKILL.md': one, 'references/guide.md': two } },
    },
  ]);
  await a.sync();
  assert.equal(a.status.pending, 0);
  assert.equal(a.status.error, '');
  a.close();
});
