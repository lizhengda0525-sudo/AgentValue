import { openDB, type IDBPDatabase } from 'idb';

export type Kind =
  | 'task'
  | 'log'
  | 'goal'
  | 'review'
  | 'savedReview'
  | 'prompt'
  | 'generation'
  | 'image'
  | 'skill'
  | 'skillFile';
export type Data = Record<string, any>;
export const blobReferences = (data: Data): string[] =>
  [
    ...new Set([...(data.blob ? [data.blob] : []), ...Object.values(data.file_manifest || {})]),
  ] as string[];
export type Edit = { kind: Kind; id: string; data: Data; deleted?: boolean };
export type Remote = {
  kind: Kind;
  record_id: string;
  data: Data;
  deleted: boolean;
  version: number;
  change_seq: number;
  updated_at: string;
};
export type Mutation = Edit & { operationId: string; baseVersion: number; deleted: boolean };
type Row = Edit & { key: string; version: number; deleted: boolean };
type Pending = { key: string; mutation: Mutation; frozen: boolean; next?: Edit };
export type Conflict = { key: string; remote: Remote; local: Edit };
export interface Transport {
  push(mutation: Mutation): Promise<{ status: 'applied' | 'conflict'; record: Remote }>;
  pull(cursor: number): Promise<Remote[]>;
  upload(hash: string, blob: Blob): Promise<void>;
  download(hash: string): Promise<Blob>;
}
export type SyncStatus = {
  pending: number;
  conflicts: number;
  syncing: boolean;
  lastSync: string;
  error: string;
};
const keyOf = (r: { kind: Kind; id: string }) => `${r.kind}:${r.id}`;
const same = (a: Edit, b: Edit) =>
  !!a.deleted === !!b.deleted && canonical(a.data) === canonical(b.data);
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const kinds: Kind[] = [
  'task',
  'log',
  'goal',
  'review',
  'savedReview',
  'prompt',
  'generation',
  'image',
  'skill',
  'skillFile',
];
export function validateEdit(edit: Edit) {
  if (
    !kinds.includes(edit.kind) ||
    typeof edit.id !== 'string' ||
    !edit.id.length ||
    edit.id.length > 160 ||
    !edit.data ||
    typeof edit.data !== 'object' ||
    Array.isArray(edit.data) ||
    new TextEncoder().encode(JSON.stringify(edit.data)).length > 4_000_000
  )
    throw new Error('同步记录格式无效');
  if (edit.data.blob && !/^[a-f0-9]{64}$/.test(edit.data.blob)) throw new Error('附件编号无效');
  if (
    edit.data.file_manifest !== undefined &&
    (!edit.data.file_manifest ||
      typeof edit.data.file_manifest !== 'object' ||
      Array.isArray(edit.data.file_manifest) ||
      Object.keys(edit.data.file_manifest).length > 10000 ||
      Object.values(edit.data.file_manifest).some(
        (hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash),
      ))
  )
    throw new Error('Skill 文件版本无效');
}
function validateRemote(r: Remote) {
  validateEdit({ ...r, id: r.record_id });
  if (
    !Number.isSafeInteger(r.version) ||
    r.version < 1 ||
    !Number.isSafeInteger(r.change_seq) ||
    r.change_seq < 1 ||
    typeof r.deleted !== 'boolean'
  )
    throw new Error('云端版本无效，请停止同步并检查数据库');
}

/** Records, pending writes, conflicts and cursor are committed together. No network inside a transaction. */
export class SyncEngine {
  private db!: IDBPDatabase;
  private running?: Promise<void>;
  private closed = false;
  private listeners = new Set<() => void>();
  status: SyncStatus = { pending: 0, conflicts: 0, syncing: false, lastSync: '', error: '' };
  readonly name: string;
  private transport: Transport;
  constructor(name: string, transport: Transport) {
    this.name = name;
    this.transport = transport;
  }
  async open() {
    this.db = await openDB(this.name, 1, {
      upgrade(db) {
        for (const store of ['records', 'outbox', 'conflicts', 'blobs'])
          db.createObjectStore(store, { keyPath: 'key' });
        db.createObjectStore('meta');
      },
    });
    if (!(await this.db.get('meta', 'revision')))
      await this.db.put('meta', crypto.randomUUID(), 'revision');
    await this.refresh();
    return this;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private async refresh() {
    if (this.closed) return;
    const [pending, conflicts, lastSync] = await Promise.all([
      this.db.count('outbox'),
      this.db.count('conflicts'),
      this.db.get('meta', 'lastSync'),
    ]);
    this.status = { ...this.status, pending, conflicts, lastSync: lastSync || '' };
    for (const listener of this.listeners) listener();
  }
  async snapshot() {
    const tx = this.db.transaction(['records', 'meta']);
    const [rows, revision, timer] = await Promise.all([
      tx.objectStore('records').getAll(),
      tx.objectStore('meta').get('revision'),
      tx.objectStore('meta').get('timer'),
    ]);
    await tx.done;
    return { rows: (rows as Row[]).filter((r) => !r.deleted), revision: revision as string, timer };
  }
  async commit(edits: Edit[], expectedRevision?: string, timer?: unknown) {
    edits.forEach(validateEdit);
    const tx = this.db.transaction(['records', 'outbox', 'conflicts', 'meta'], 'readwrite');
    try {
      if (expectedRevision && (await tx.objectStore('meta').get('revision')) !== expectedRevision)
        throw new Error('数据已被其他窗口或同步更新，请保留草稿后重新载入。');
      for (const edit of edits) {
        const key = keyOf(edit),
          old: Row | undefined = await tx.objectStore('records').get(key);
        if (old && same(old, edit)) continue;
        if (!old && edit.deleted) continue;
        const pending: Pending | undefined = await tx.objectStore('outbox').get(key);
        const data = structuredClone(edit.data),
          deleted = !!edit.deleted;
        await tx
          .objectStore('records')
          .put({ ...edit, data, key, deleted, version: old?.version || 0 });
        if (pending?.frozen) {
          await tx.objectStore('outbox').put({ ...pending, next: { ...edit, data, deleted } });
        } else {
          await tx.objectStore('outbox').put({
            key,
            frozen: false,
            mutation: {
              ...edit,
              data,
              deleted,
              baseVersion: old?.version || 0,
              operationId: crypto.randomUUID(),
            },
          });
        }
        const conflict: Conflict | undefined = await tx.objectStore('conflicts').get(key);
        if (conflict)
          await tx.objectStore('conflicts').put({ ...conflict, local: { ...edit, data, deleted } });
      }
      const revision = crypto.randomUUID();
      await tx.objectStore('meta').put(revision, 'revision');
      if (timer !== undefined) await tx.objectStore('meta').put(timer, 'timer');
      await tx.done;
      await this.refresh();
      return revision;
    } catch (error) {
      tx.abort();
      await tx.done.catch(() => {});
      throw error;
    }
  }
  async storeBlob(blob: Blob) {
    if (blob.size > 30 * 1024 ** 2) throw new Error('单个附件不能超过 30 MB');
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (!(await this.db.get('blobs', hash)))
      await this.db.put('blobs', { key: hash, blob, uploaded: false });
    return hash;
  }
  async blob(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('附件编号无效');
    const cached = await this.db.get('blobs', hash);
    if (cached) return cached.blob as Blob;
    const blob = await this.transport.download(hash);
    const actual = await this.storeBlob(blob);
    if (actual !== hash) {
      await this.db.delete('blobs', actual);
      throw new Error('附件校验失败');
    }
    await this.db.put('blobs', { key: hash, blob, uploaded: true });
    return blob;
  }
  async conflicts() {
    return (await this.db.getAll('conflicts')) as Conflict[];
  }
  async resolve(key: string, choice: 'local' | 'remote') {
    const tx = this.db.transaction(['records', 'outbox', 'conflicts', 'meta'], 'readwrite');
    const conflict: Conflict | undefined = await tx.objectStore('conflicts').get(key);
    if (!conflict) {
      await tx.done;
      return;
    }
    const row: Row = await tx.objectStore('records').get(key);
    if (choice === 'remote') {
      await tx.objectStore('records').put({
        key,
        kind: conflict.remote.kind,
        id: conflict.remote.record_id,
        data: conflict.remote.data,
        deleted: conflict.remote.deleted,
        version: conflict.remote.version,
      });
      await tx.objectStore('outbox').delete(key);
    } else {
      await tx.objectStore('records').put({ ...row, version: conflict.remote.version });
      await tx.objectStore('outbox').put({
        key,
        frozen: false,
        mutation: {
          kind: row.kind,
          id: row.id,
          data: row.data,
          deleted: row.deleted,
          baseVersion: conflict.remote.version,
          operationId: crypto.randomUUID(),
        },
      });
    }
    await tx.objectStore('conflicts').delete(key);
    await tx.objectStore('meta').put(crypto.randomUUID(), 'revision');
    await tx.done;
    await this.refresh();
  }
  private async acknowledge(pending: Pending, remote: Remote) {
    const tx = this.db.transaction(['records', 'outbox', 'conflicts', 'meta'], 'readwrite');
    const current: Pending | undefined = await tx.objectStore('outbox').get(pending.key);
    if (!current || current.mutation.operationId !== pending.mutation.operationId) {
      await tx.done;
      return;
    }
    const row = await tx.objectStore('records').get(pending.key);
    if (current.next) {
      await tx.objectStore('records').put({ ...row, version: remote.version });
      await tx.objectStore('outbox').put({
        key: pending.key,
        frozen: false,
        mutation: {
          ...current.next,
          deleted: !!current.next.deleted,
          baseVersion: remote.version,
          operationId: crypto.randomUUID(),
        },
      });
    } else {
      await tx.objectStore('records').put({
        key: pending.key,
        kind: remote.kind,
        id: remote.record_id,
        data: remote.data,
        deleted: remote.deleted,
        version: remote.version,
      });
      await tx.objectStore('outbox').delete(pending.key);
    }
    await tx.objectStore('conflicts').delete(pending.key);
    await tx.done;
  }
  async sync() {
    if (this.closed) return;
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async run() {
    this.status = { ...this.status, syncing: true, error: '' };
    await this.refresh();
    try {
      // Freeze each request before sending; after a crash, replay precisely the same operation ID and payload.
      for (let attempts = 0; attempts < 1000 && !this.closed; attempts++) {
        const candidates = await this.db.getAllKeys('outbox');
        // Refresh the blocked set rather than trusting UI status from an earlier transaction.
        this.blocked = new Set((await this.conflicts()).map((c) => c.key));
        const selected = candidates.find((key) => !this.blocked.has(String(key)));
        if (!selected) break;
        const tx = this.db.transaction('outbox', 'readwrite');
        const latest: Pending | undefined = await tx.store.get(selected);
        if (!latest) {
          await tx.done;
          continue;
        }
        await tx.store.put({ ...latest, frozen: true });
        await tx.done;
        for (const hash of blobReferences(latest.mutation.data)) {
          const local = await this.db.get('blobs', hash);
          if (local && !local.uploaded) {
            await this.transport.upload(hash, local.blob);
            await this.db.put('blobs', { ...local, uploaded: true });
          }
        }
        const result = await this.transport.push(latest.mutation);
        validateRemote(result.record);
        if (
          !['applied', 'conflict'].includes(result.status) ||
          result.record.kind !== latest.mutation.kind ||
          result.record.record_id !== latest.mutation.id ||
          (result.status === 'applied' && result.record.version !== latest.mutation.baseVersion + 1)
        )
          throw new Error('云端返回了错误的记录或版本，已保留本机改动');
        if (result.status === 'applied') await this.acknowledge(latest, result.record);
        else {
          const tx = this.db.transaction(['conflicts', 'records'], 'readwrite');
          const local = await tx.objectStore('records').get(latest.key);
          await tx.objectStore('conflicts').put({ key: latest.key, remote: result.record, local });
          await tx.done;
        }
      }
      if (this.closed) return;
      let cursor: number = (await this.db.get('meta', 'cursor')) || 0;
      while (!this.closed) {
        const changes = await this.transport.pull(cursor);
        changes.forEach(validateRemote);
        if (changes.some((r, i) => r.change_seq <= (i ? changes[i - 1].change_seq : cursor)))
          throw new Error('云端同步游标无效');
        const tx = this.db.transaction(['records', 'outbox', 'conflicts', 'meta'], 'readwrite');
        let changed = false;
        for (const remote of changes) {
          const key = keyOf({ kind: remote.kind, id: remote.record_id });
          const old: Row | undefined = await tx.objectStore('records').get(key);
          const pending: Pending | undefined = await tx.objectStore('outbox').get(key);
          if (remote.version <= (old?.version || 0)) continue;
          const incoming = {
            key,
            kind: remote.kind,
            id: remote.record_id,
            data: remote.data,
            deleted: remote.deleted,
            version: remote.version,
          };
          if (pending) {
            if (!same(pending.mutation, incoming))
              await tx.objectStore('conflicts').put({ key, remote, local: old });
            // Same value may be our previously accepted write; receipt replay resolves its version safely.
          } else {
            await tx.objectStore('records').put(incoming);
            changed = true;
          }
        }
        if (changes.length) cursor = changes[changes.length - 1].change_seq;
        await tx.objectStore('meta').put(cursor, 'cursor');
        if (changed) await tx.objectStore('meta').put(crypto.randomUUID(), 'revision');
        await tx.done;
        if (changes.length < 200) break;
      }
      await this.db.put('meta', new Date().toISOString(), 'lastSync');
    } catch (error) {
      this.status = {
        ...this.status,
        error: error instanceof Error ? error.message : '暂时无法同步，改动已保存在本机',
      };
    } finally {
      this.status = { ...this.status, syncing: false };
      await this.refresh();
    }
  }
  private blocked = new Set<string>();
  close() {
    this.closed = true;
    this.listeners.clear();
    void this.running?.finally(() => this.db.close());
    if (!this.running) this.db.close();
  }
}
