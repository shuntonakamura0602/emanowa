begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_catalog, public, extensions, pg_temp;
grant emanowa_owner, emanowa_app, emanowa_admin_app, emanowa_admin_provisioner
  to session_user;
grant usage on schema extensions
  to emanowa_owner, emanowa_app, emanowa_admin_app,
     emanowa_admin_provisioner;

select extensions.no_plan();

select extensions.ok(
  exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_private'
      and relation.relname = 'world_operation_audit'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  'the world operation audit has enabled and forced RLS'
);
select extensions.is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'app_private'
      and table_name = 'world_operation_audit'
  ),
  array[
    'id',
    'admin_id',
    'world_id',
    'action',
    'reason_code',
    'before_posting_enabled',
    'after_posting_enabled',
    'created_at'
  ]::text[],
  'the operation audit contains only identifiers, fixed codes, booleans, and time'
);
select extensions.ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'app_private'
      and indexname = 'world_operation_audit_admin_id_idx'
      and indexdef ilike '%(admin_id)%'
  )
  and exists (
    select 1 from pg_indexes
    where schemaname = 'app_private'
      and indexname = 'world_operation_audit_world_history_idx'
      and indexdef ilike '%(world_id, created_at, id)%'
  ),
  'both audit foreign keys are indexed and world history has a composite path'
);
select extensions.ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'app_private'
      and tablename = 'world_operation_audit'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ),
  'the append-only operation audit has no update or delete RLS policy'
);
select extensions.is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname in (
        'get_admin_world_posting',
        'set_world_posting'
      )
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']
  ),
  2::bigint,
  'both world operation boundaries are fixed-search-path security definers'
);
select extensions.ok(
  (
    select procedure.prosrc ilike '%for update%'
      and procedure.prosrc ilike '%pg_advisory_xact_lock%'
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname = 'set_world_posting'
  ),
  'the mutation serializes the idempotency key and locks only its target world row'
);

select extensions.ok(
  has_function_privilege(
    'emanowa_admin_app',
    'app_private.get_admin_world_posting(text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'emanowa_admin_app',
    'app_private.set_world_posting(text,boolean,text,boolean,uuid,bytea)',
    'EXECUTE'
  ),
  'the admin BFF role can execute both typed world operation boundaries'
);
select extensions.ok(
  not has_function_privilege(
    'emanowa_app',
    'app_private.get_admin_world_posting(text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'emanowa_app',
    'app_private.set_world_posting(text,boolean,text,boolean,uuid,bytea)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'app_private.set_world_posting(text,boolean,text,boolean,uuid,bytea)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'app_private.set_world_posting(text,boolean,text,boolean,uuid,bytea)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'app_private.set_world_posting(text,boolean,text,boolean,uuid,bytea)',
    'EXECUTE'
  ),
  'ordinary and Data API roles cannot execute world administration functions'
);
select extensions.ok(
  not has_table_privilege(
    'emanowa_admin_app',
    'app_private.worlds',
    'UPDATE'
  )
  and not has_table_privilege(
    'emanowa_admin_app',
    'app_private.world_operation_audit',
    'SELECT'
  )
  and not has_table_privilege(
    'emanowa_admin_app',
    'app_private.world_operation_audit',
    'INSERT'
  ),
  'the admin BFF role receives no direct world or audit table privilege'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  created_at,
  updated_at
)
values
  (
    '70000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'stage-h-admin@example.test',
    now(),
    now(),
    now()
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'stage-h-ordinary@example.test',
    now(),
    now(),
    now()
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'stage-h-disabled-admin@example.test',
    now(),
    now(),
    now()
  ),
  (
    '70000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'stage-h-prospective-owner@example.test',
    now(),
    now(),
    now()
  );

set local role emanowa_admin_provisioner;
select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000001',
  true
);
insert into app_private.admin_users (user_id, role, enabled)
values (
  '70000000-0000-4000-8000-000000000001',
  'moderator',
  true
);
select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000003',
  true
);
insert into app_private.admin_users (user_id, role, enabled)
values (
  '70000000-0000-4000-8000-000000000003',
  'moderator',
  true
);
update app_private.admin_users
set enabled = false
where user_id = '70000000-0000-4000-8000-000000000003';

reset role;
set local role emanowa_owner;
update app_private.worlds
set state = 'open',
    posting_enabled = true,
    opens_at = transaction_timestamp() - interval '1 hour',
    closes_at = transaction_timestamp() + interval '1 year'
where slug = '2027';

reset role;
create temporary table stage_h_target (public_id uuid primary key);
grant select, insert on stage_h_target to emanowa_app, emanowa_owner;
set local role emanowa_app;
select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000002',
  true
);
insert into stage_h_target (public_id)
select public_id
from app_private.create_ema(
  '2027',
  700,
  700,
  '停止中も保護される既存本文',
  '既存利用者',
  'other',
  'basic_wood',
  'public',
  'public',
  '72000000-0000-4000-8000-000000000001',
  decode(repeat('21', 32), 'hex')
);

reset role;
set local role emanowa_admin_app;
select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000002',
  true
);
select set_config('app.auth_aal', 'aal2', true);
select extensions.throws_ok(
  $$select * from app_private.get_admin_world_posting('2027')$$,
  'P1012',
  'ADMIN_REQUIRED',
  'an AAL2 ordinary actor is rejected by the server-managed admin ledger'
);

select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000001',
  true
);
select set_config('app.auth_aal', '', true);
select extensions.throws_ok(
  $$select * from app_private.get_admin_world_posting('2027')$$,
  'P1012',
  'ADMIN_REQUIRED',
  'an enabled admin without an AAL assertion cannot read operational state'
);
select set_config('app.auth_aal', 'aal1', true);
select extensions.throws_ok(
  $$select * from app_private.set_world_posting(
      '2027', false, 'incident', true,
      '71000000-0000-4000-8000-000000000001',
      decode(repeat('11', 32), 'hex')
    )$$,
  'P1012',
  'ADMIN_REQUIRED',
  'an enabled admin at AAL1 cannot pause posting'
);

select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000003',
  true
);
select set_config('app.auth_aal', 'aal2', true);
select extensions.throws_ok(
  $$select * from app_private.get_admin_world_posting('2027')$$,
  'P1012',
  'ADMIN_REQUIRED',
  'a disabled admin immediately loses the operational boundary'
);

select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000001',
  true
);
select extensions.is(
  (
    select jsonb_build_object(
      'slug', world_slug,
      'state', state,
      'postingEnabled', posting_enabled,
      'hasSchedule', opens_at is not null and closes_at is not null,
      'hasUpdatedAt', updated_at is not null
    )
    from app_private.get_admin_world_posting('2027')
  ),
  jsonb_build_object(
    'slug', '2027',
    'state', 'open',
    'postingEnabled', true,
    'hasSchedule', true,
    'hasUpdatedAt', true
  ),
  'an AAL2 enabled admin receives the non-UGC world operation DTO'
);
select extensions.throws_ok(
  $$select * from app_private.get_admin_world_posting('999')$$,
  'P1002',
  'VALIDATION_ERROR',
  'admin world lookup validates the four-digit slug contract'
);
select extensions.throws_ok(
  $$select * from app_private.get_admin_world_posting('2026')$$,
  'P1008',
  'NOT_FOUND',
  'admin world lookup does not fabricate an unknown world'
);
select extensions.throws_ok(
  $$select * from app_private.set_world_posting(
      '2027', false, 'free-form incident detail', true,
      '71000000-0000-4000-8000-000000000002',
      decode(repeat('12', 32), 'hex')
    )$$,
  'P1002',
  'VALIDATION_ERROR',
  'free-form operational reasons are rejected instead of entering the audit'
);

select extensions.is(
  (
    select jsonb_build_object(
      'slug', world_slug,
      'postingEnabled', posting_enabled,
      'replayed', replayed
    )
    from app_private.set_world_posting(
      '2027', false, 'incident', true,
      '71000000-0000-4000-8000-000000000003',
      decode(repeat('13', 32), 'hex')
    )
  ),
  jsonb_build_object(
    'slug', '2027',
    'postingEnabled', false,
    'replayed', false
  ),
  'an AAL2 enabled admin pauses new posting with expected-current protection'
);

reset role;
set local role emanowa_app;
select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000004',
  true
);
select set_config('app.auth_aal', '', true);
select extensions.throws_ok(
  $$select * from app_private.create_ema(
      '2027', 701, 700, '停止中の新規投稿', '新規利用者', 'other',
      'basic_wood', 'public', 'public',
      '72000000-0000-4000-8000-000000000002',
      decode(repeat('22', 32), 'hex')
    )$$,
  'P1004',
  'POSTING_PAUSED',
  'pause rejects only a new ema placement with the established error contract'
);
select extensions.is(
  (
    select jsonb_build_object(
      'slug', world_slug,
      'state', world_state,
      'acceptingPosts', accepting_posts
    )
    from app_private.get_public_world('2027')
  ),
  jsonb_build_object(
    'slug', '2027',
    'state', 'open',
    'acceptingPosts', false
  ),
  'the public world remains readable and advertises paused acceptance'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_public_ema(
      '2027',
      (select public_id from stage_h_target)
    )
  ),
  1::bigint,
  'existing public ema detail remains readable while new posting is paused'
);
select extensions.is(
  (
    select jsonb_build_object(
      'accepted', accepted,
      'status', http_status
    )
    from app_private.create_report(
      '2027',
      (select public_id from stage_h_target),
      'spam',
      null,
      '72000000-0000-4000-8000-000000000003',
      decode(repeat('23', 32), 'hex')
    )
  ),
  jsonb_build_object('accepted', true, 'status', 201),
  'reporting an existing ema remains available while posting is paused'
);

select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000002',
  true
);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'result', result)
    from app_private.update_ema(
      (select public_id from stage_h_target),
      1,
      false, null,
      false, null,
      false, null,
      false, null,
      true, 'unlisted',
      true, 'owner_only',
      '72000000-0000-4000-8000-000000000004',
      decode(repeat('24', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 2, 'result', 'updated'),
  'the owner can shrink public scope while new posting is paused'
);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'result', result)
    from app_private.delete_ema(
      (select public_id from stage_h_target),
      2,
      '72000000-0000-4000-8000-000000000005',
      decode(repeat('25', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 3, 'result', 'deleted'),
  'the owner can delete and scrub an existing ema while posting is paused'
);

reset role;
set local role emanowa_admin_app;
select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000001',
  true
);
select set_config('app.auth_aal', 'aal2', true);
select extensions.is(
  (
    select jsonb_build_object(
      'postingEnabled', posting_enabled,
      'replayed', replayed
    )
    from app_private.set_world_posting(
      '2027', false, 'incident', true,
      '71000000-0000-4000-8000-000000000003',
      decode(repeat('13', 32), 'hex')
    )
  ),
  jsonb_build_object('postingEnabled', false, 'replayed', true),
  'an identical pause retry replays the original receipt'
);
select extensions.throws_ok(
  $$select * from app_private.set_world_posting(
      '2027', false, 'incident', true,
      '71000000-0000-4000-8000-000000000003',
      decode(repeat('14', 32), 'hex')
    )$$,
  'P1005',
  'IDEMPOTENCY_KEY_REUSED',
  'one world-operation key cannot represent a different request body'
);
select extensions.throws_ok(
  $$select * from app_private.set_world_posting(
      '2027', false, 'maintenance', true,
      '71000000-0000-4000-8000-000000000004',
      decode(repeat('15', 32), 'hex')
    )$$,
  'P1009',
  'VERSION_CONFLICT',
  'a fresh pause request with stale expected-current is rejected'
);

reset role;
set local role emanowa_owner;
select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000001',
  true
);
select set_config('app.auth_aal', 'aal2', true);
select extensions.is(
  (
    select jsonb_build_object(
      'action', action,
      'reason', reason_code,
      'before', before_posting_enabled,
      'after', after_posting_enabled
    )
    from app_private.world_operation_audit
  ),
  jsonb_build_object(
    'action', 'pause',
    'reason', 'incident',
    'before', true,
    'after', false
  ),
  'pause writes one fixed-code boolean transition without copying UGC'
);
select extensions.is(
  (select count(*) from app_private.world_operation_audit),
  1::bigint,
  'pause replay and rejected requests do not duplicate the audit'
);
select extensions.is(
  (
    select count(*)
    from app_private.idempotency_records
    where operation = 'PATCH:/api/v1/admin/worlds/2027/posting'
  ),
  1::bigint,
  'only the committed pause owns an idempotency receipt'
);
select extensions.ok(
  not exists (
    select 1
    from app_private.idempotency_records
    where operation = 'PATCH:/api/v1/admin/worlds/2027/posting'
      and receipt_json ?| array[
        'reasonCode',
        'detail',
        'wishText',
        'nickname',
        'email'
      ]
  ),
  'the world operation receipt contains neither reason detail nor UGC'
);

reset role;
set local role emanowa_admin_app;
select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000001',
  true
);
select set_config('app.auth_aal', 'aal2', true);
select extensions.is(
  (
    select jsonb_build_object(
      'postingEnabled', posting_enabled,
      'replayed', replayed
    )
    from app_private.set_world_posting(
      '2027', true, 'maintenance', false,
      '71000000-0000-4000-8000-000000000005',
      decode(repeat('16', 32), 'hex')
    )
  ),
  jsonb_build_object('postingEnabled', true, 'replayed', false),
  'an AAL2 enabled admin resumes new posting'
);
select extensions.is(
  (select posting_enabled from app_private.get_admin_world_posting('2027')),
  true,
  'the admin read boundary reflects the resumed state'
);
select extensions.is(
  (
    select jsonb_build_object(
      'postingEnabled', posting_enabled,
      'replayed', replayed
    )
    from app_private.set_world_posting(
      '2027', false, 'incident', true,
      '71000000-0000-4000-8000-000000000003',
      decode(repeat('13', 32), 'hex')
    )
  ),
  jsonb_build_object('postingEnabled', false, 'replayed', true),
  'replaying the old pause after resume returns its original immutable DTO'
);

reset role;
set local role emanowa_owner;
select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000001',
  true
);
select set_config('app.auth_aal', 'aal2', true);
select extensions.is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'action', action,
        'reason', reason_code,
        'before', before_posting_enabled,
        'after', after_posting_enabled
      ) order by id
    )
    from app_private.world_operation_audit
  ),
  jsonb_build_array(
    jsonb_build_object(
      'action', 'pause',
      'reason', 'incident',
      'before', true,
      'after', false
    ),
    jsonb_build_object(
      'action', 'resume',
      'reason', 'maintenance',
      'before', false,
      'after', true
    )
  ),
  'pause and resume produce exactly two ordered operational audit transitions'
);
select extensions.is(
  (
    select count(*)
    from app_private.idempotency_records
    where operation = 'PATCH:/api/v1/admin/worlds/2027/posting'
  ),
  2::bigint,
  'pause and resume retain one idempotency receipt each'
);

select set_config(
  'app.actor_id',
  '70000000-0000-4000-8000-000000000002',
  true
);
select extensions.is(
  (select count(*) from app_private.world_operation_audit),
  0::bigint,
  'forced RLS hides operational audit rows from a non-admin owner context'
);
select extensions.throws_ok(
  $$insert into app_private.world_operation_audit (
      admin_id,
      world_id,
      action,
      reason_code,
      before_posting_enabled,
      after_posting_enabled
    ) values (
      '70000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000002027',
      'pause',
      'other',
      true,
      false
    )$$,
  '42501',
  null,
  'forced RLS rejects direct audit insertion outside the AAL2 admin actor'
);

reset role;
select * from extensions.finish();
rollback;
