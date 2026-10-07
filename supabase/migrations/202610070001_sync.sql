-- AgentValue: execute once in the project's SQL Editor. No private keys are needed by clients.
begin;
create table if not exists public.agentvalue_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('task','log','goal','review','savedReview','prompt','generation','image','skill','skillFile')),
  record_id text not null check (length(record_id) between 1 and 160),
  data jsonb not null default '{}',
  deleted boolean not null default false,
  version bigint not null default 1 check (version > 0),
  change_seq bigint generated always as identity,
  updated_at timestamptz not null default now(),
  primary key(owner_id,kind,record_id),
  check (octet_length(data::text) <= 4000000)
);
create index if not exists agentvalue_changes on public.agentvalue_records(owner_id,change_seq);
create table if not exists public.agentvalue_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  primary key(owner_id,operation_id)
);
alter table public.agentvalue_records enable row level security;
alter table public.agentvalue_receipts enable row level security;
drop policy if exists own_records on public.agentvalue_records;
create policy own_records on public.agentvalue_records for select to authenticated using (owner_id=auth.uid());
revoke all on public.agentvalue_records, public.agentvalue_receipts from anon, authenticated;
grant select on public.agentvalue_records to authenticated;

create or replace function public.agentvalue_pull(after_seq bigint default 0, page_size integer default 200)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); rows jsonb;
begin
  if uid is null then raise exception 'Login required'; end if;
  -- Serializes each user's writes and reads so cursors never skip an uncommitted change.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 57021));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.change_seq),'[]'::jsonb) into rows
  from (select kind, record_id, data, deleted, version, change_seq, updated_at
    from public.agentvalue_records where owner_id=uid and change_seq>greatest(after_seq,0)
    order by change_seq limit least(greatest(page_size,1),500)) r;
  return rows;
end $$;

create or replace function public.agentvalue_push(mutation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); op uuid; k text; rid text; expected bigint;
  current_row public.agentvalue_records; receipt public.agentvalue_receipts; result jsonb;
begin
  if uid is null then raise exception 'Login required'; end if;
  if jsonb_typeof(mutation) is distinct from 'object' then raise exception 'Invalid mutation'; end if;
  op := (mutation->>'operationId')::uuid;
  k := mutation->>'kind'; rid := mutation->>'id'; expected := (mutation->>'baseVersion')::bigint;
  if op is null or k is null or k not in ('task','log','goal','review','savedReview','prompt','generation','image','skill','skillFile')
    or rid is null or length(rid) not between 1 and 160 or expected is null or expected<0
    or jsonb_typeof(mutation->'deleted') is distinct from 'boolean'
    or jsonb_typeof(mutation->'data') is distinct from 'object'
    or octet_length((mutation->'data')::text)>4000000 then raise exception 'Invalid mutation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 57021));
  select * into receipt from public.agentvalue_receipts where owner_id=uid and operation_id=op;
  if found then
    if receipt.request<>mutation then raise exception 'Operation ID was reused'; end if;
    return receipt.result;
  end if;
  select * into current_row from public.agentvalue_records where owner_id=uid and kind=k and record_id=rid;
  if coalesce(current_row.version,0)<>expected then
    return jsonb_build_object('status','conflict','record',to_jsonb(current_row)-'owner_id');
  end if;
  insert into public.agentvalue_records(owner_id,kind,record_id,data,deleted)
    values(uid,k,rid,mutation->'data',(mutation->>'deleted')::boolean)
    on conflict(owner_id,kind,record_id) do update set data=excluded.data,deleted=excluded.deleted,
      version=public.agentvalue_records.version+1,
      change_seq=default,
      updated_at=clock_timestamp()
    returning * into current_row;
  result := jsonb_build_object('status','applied','record',to_jsonb(current_row)-'owner_id');
  insert into public.agentvalue_receipts values(uid,op,mutation,result);
  return result;
end $$;
revoke all on function public.agentvalue_pull(bigint,integer), public.agentvalue_push(jsonb) from public,anon;
grant execute on function public.agentvalue_pull(bigint,integer), public.agentvalue_push(jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values('agentvalue-private','agentvalue-private',false,31457280)
on conflict(id) do update set public=false,file_size_limit=31457280;
drop policy if exists agentvalue_read_files on storage.objects;
drop policy if exists agentvalue_create_files on storage.objects;
create policy agentvalue_read_files on storage.objects for select to authenticated
using (bucket_id='agentvalue-private' and (storage.foldername(name))[1]=auth.uid()::text);
-- Files are immutable and content-addressed. Existing blobs are never overwritten by another device.
create policy agentvalue_create_files on storage.objects for insert to authenticated
with check (bucket_id='agentvalue-private' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
