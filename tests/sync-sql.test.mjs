import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('real PostgreSQL migration: isolation, compare-and-swap, receipts, tombstones and privileges', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
      insert into auth.users values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');`);
    const migration = await fs.readFile(
      new URL('../supabase/migrations/202610070001_sync.sql', import.meta.url),
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration); // safe to rerun in SQL Editor
    await db.exec(`set role authenticated; set test.uid='00000000-0000-4000-8000-000000000001';`);
    const push = async (input) =>
      (await db.query('select public.agentvalue_push($1::jsonb) result', [JSON.stringify(input)]))
        .rows[0].result;
    const input = {
      kind: 'task',
      id: 'a',
      data: { title: 'A' },
      deleted: false,
      baseVersion: 0,
      operationId: crypto.randomUUID(),
    };
    const first = await push(input);
    assert.equal(first.status, 'applied');
    assert.equal(first.record.version, 1);
    assert.deepEqual(await push(input), first);
    await assert.rejects(push({ ...input, data: { title: 'reused' } }), /reused/);
    const stale = await push({
      ...input,
      operationId: crypto.randomUUID(),
      data: { title: 'stale' },
    });
    assert.equal(stale.status, 'conflict');
    assert.equal(stale.record.data.title, 'A');
    const deleted = await push({
      ...input,
      operationId: crypto.randomUUID(),
      baseVersion: 1,
      deleted: true,
      data: {},
    });
    assert.equal(deleted.record.version, 2);
    assert.equal(deleted.record.deleted, true);
    assert.ok(deleted.record.change_seq > first.record.change_seq);
    const rows = (await db.query('select public.agentvalue_pull(0,200) result')).rows[0].result;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].deleted, true);
    assert.equal(
      (await db.query('select public.agentvalue_pull($1,200) result', [rows[0].change_seq])).rows[0]
        .result.length,
      0,
    );
    await assert.rejects(
      db.exec(
        "insert into public.agentvalue_records(owner_id,kind,record_id) values(auth.uid(),'task','b')",
      ),
      /permission denied/,
    );
    await assert.rejects(db.exec('select * from public.agentvalue_receipts'), /permission denied/);
    await db.exec(
      "insert into storage.objects values('agentvalue-private','00000000-0000-4000-8000-000000000001/file')",
    );
    assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
    await assert.rejects(
      db.exec(
        "insert into storage.objects values('agentvalue-private','00000000-0000-4000-8000-000000000002/file')",
      ),
      /row-level security/,
    );
    assert.equal((await db.query('delete from storage.objects returning *')).rows.length, 0);
    await db.exec(`set test.uid='00000000-0000-4000-8000-000000000002';`);
    assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
    assert.equal((await db.query('select * from public.agentvalue_records')).rows.length, 0);
    assert.deepEqual((await db.query('select public.agentvalue_pull() result')).rows[0].result, []);
    assert.equal((await push({ ...input, operationId: crypto.randomUUID() })).status, 'applied');
    await db.exec('set role anon');
    await assert.rejects(db.exec('select public.agentvalue_pull()'), /permission denied/);
  } finally {
    await db.close();
  }
});
