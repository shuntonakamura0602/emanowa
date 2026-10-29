begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_catalog, public, extensions, pg_temp;
grant emanowa_owner, emanowa_app, emanowa_admin_app, emanowa_admin_provisioner to session_user;
grant usage on schema extensions to emanowa_app, emanowa_admin_app, emanowa_admin_provisioner;

select extensions.no_plan();

select extensions.is(
  (select rolbypassrls from pg_roles where rolname = 'emanowa_admin_app'),
  false,
  'admin BFF role cannot bypass RLS'
);
select extensions.is(
  (select rolcanlogin from pg_roles where rolname = 'emanowa_admin_app'),
  false,
  'admin BFF role remains NOLOGIN in committed migrations'
);
select extensions.ok(
  not exists (
    select 1
    from pg_auth_members as role_membership
    join pg_roles as member_role on member_role.oid = role_membership.member
    where member_role.rolname in (
      'emanowa_app',
      'emanowa_admin_app',
      'emanowa_admin_provisioner',
      'emanowa_owner'
    )
  ),
  'limited application and object roles retain no parent role memberships'
);
select extensions.ok(
  not exists (
    select 1
    from (
      values
        ('emanowa_app'::name, 'emanowa_owner'::name),
        ('emanowa_app'::name, 'emanowa_admin_app'::name),
        ('emanowa_app'::name, 'emanowa_admin_provisioner'::name),
        ('emanowa_admin_app'::name, 'emanowa_owner'::name),
        ('emanowa_admin_app'::name, 'emanowa_app'::name),
        ('emanowa_admin_app'::name, 'emanowa_admin_provisioner'::name),
        ('emanowa_admin_provisioner'::name, 'emanowa_owner'::name),
        ('emanowa_admin_provisioner'::name, 'emanowa_app'::name),
        ('emanowa_admin_provisioner'::name, 'emanowa_admin_app'::name)
    ) as role_pair(member_role, granted_role)
    cross join (values ('USAGE'::text), ('SET'::text)) as privilege(kind)
    where pg_has_role(role_pair.member_role, role_pair.granted_role, privilege.kind)
  ),
  'ordinary, admin, and provisioner roles cannot use or SET ROLE to each other or the owner'
);
select extensions.ok(
  not (select rolcanlogin from pg_roles where rolname = 'emanowa_admin_provisioner')
    and not (select rolbypassrls from pg_roles where rolname = 'emanowa_admin_provisioner')
    and not pg_has_role('emanowa_app', 'emanowa_admin_provisioner', 'USAGE')
    and not pg_has_role('emanowa_app', 'emanowa_admin_provisioner', 'SET')
    and not pg_has_role('emanowa_admin_app', 'emanowa_admin_provisioner', 'USAGE')
    and not pg_has_role('emanowa_admin_app', 'emanowa_admin_provisioner', 'SET'),
  'the NOLOGIN provisioner is not inherited by either application role'
);
select extensions.ok(
  not has_table_privilege('emanowa_admin_provisioner', 'app_private.admin_users', 'SELECT')
    and not has_table_privilege('emanowa_admin_provisioner', 'app_private.admin_users', 'INSERT')
    and not has_table_privilege('emanowa_admin_provisioner', 'app_private.admin_users', 'UPDATE')
    and has_column_privilege('emanowa_admin_provisioner', 'app_private.admin_users', 'enabled', 'UPDATE'),
  'provisioner receives only column-level admin ledger privileges'
);
select extensions.ok(
  not pg_has_role('postgres', 'emanowa_owner', 'USAGE')
    and not pg_has_role('postgres', 'emanowa_owner', 'SET'),
  'the migration leaves no usable owner membership on the provisioning role'
);
select extensions.ok(
  has_schema_privilege('emanowa_admin_app', 'app_private', 'USAGE'),
  'admin BFF role can resolve only the private function schema'
);
select extensions.ok(
  not has_table_privilege('emanowa_admin_app', 'app_private.admin_users', 'SELECT')
    and not has_table_privilege('emanowa_admin_app', 'app_private.reports', 'SELECT')
    and not has_table_privilege('emanowa_admin_app', 'app_private.emas', 'UPDATE'),
  'admin BFF role has no direct table access'
);

select extensions.ok(
  has_function_privilege(
    'emanowa_app',
    'app_private.create_report(text,uuid,text,text,uuid,bytea)',
    'EXECUTE'
  ),
  'ordinary BFF role can create reports through the typed boundary'
);
select extensions.ok(
  has_function_privilege(
    'emanowa_app',
    'app_private.consume_rate_limit(text,bytea,integer,integer)',
    'EXECUTE'
  )
    and has_function_privilege(
      'emanowa_app',
      'app_private.consume_recovery_otp_verification_rate_limit(bytea,bytea,bytea)',
      'EXECUTE'
    )
    and has_function_privilege(
      'emanowa_app',
      'app_private.reserve_otp_rate_limit(bytea,integer,integer,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'emanowa_app',
      'app_private.release_otp_rate_limit(bytea,uuid)',
      'EXECUTE'
    ),
  'ordinary BFF role can consume shared counters and reserve/release OTP quota'
);
select extensions.ok(
  not has_function_privilege(
    'emanowa_app',
    'app_private.list_admin_reports(text,integer,timestamptz,uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'emanowa_app',
      'app_private.moderate_ema(uuid,text,text,integer,uuid,bytea)',
      'EXECUTE'
    ),
  'ordinary BFF role has no administration function grants'
);
select extensions.ok(
  has_function_privilege(
    'emanowa_admin_app',
    'app_private.list_admin_reports(text,integer,timestamptz,uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'emanowa_admin_app',
      'app_private.moderate_ema(uuid,text,text,integer,uuid,bytea)',
      'EXECUTE'
    )
    and has_function_privilege(
      'emanowa_admin_app',
      'app_private.update_report(uuid,text,integer,uuid,bytea)',
      'EXECUTE'
    ),
  'admin BFF role receives only the administration function boundary'
);
select extensions.ok(
  not has_function_privilege(
    'emanowa_admin_app',
    'app_private.create_report(text,uuid,text,text,uuid,bytea)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'emanowa_admin_app',
      'app_private.consume_rate_limit(text,bytea,integer,integer)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'emanowa_admin_app',
      'app_private.consume_recovery_otp_verification_rate_limit(bytea,bytea,bytea)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'emanowa_admin_app',
      'app_private.reserve_otp_rate_limit(bytea,integer,integer,uuid)',
      'EXECUTE'
    ),
  'admin connection cannot become a general mutation connection'
);
select extensions.is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname in (
        'is_current_admin',
        'create_report',
        'consume_rate_limit',
        'consume_recovery_otp_verification_rate_limit',
        'reserve_otp_rate_limit',
        'release_otp_rate_limit',
        'list_admin_reports',
        'moderate_ema',
        'update_report'
      )
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']
  ),
  9::bigint,
  'all Stage F boundaries are fixed-search-path security definers'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'app_private.create_report(text,uuid,text,text,uuid,bytea)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'app_private.list_admin_reports(text,integer,timestamptz,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'app_private.moderate_ema(uuid,text,text,integer,uuid,bytea)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'app_private.consume_recovery_otp_verification_rate_limit(bytea,bytea,bytea)',
      'EXECUTE'
    ),
  'Data API roles cannot execute report or administration boundaries'
);

insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('60000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'stage-f-owner@example.test', now(), now(), now()),
  ('60000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'stage-f-reporter@example.test', now(), now(), now()),
  ('60000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'stage-f-admin@example.test', now(), now(), now()),
  ('60000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'stage-f-ordinary@example.test', now(), now(), now());

set local role emanowa_admin_provisioner;
select set_config('app.actor_id', '60000000-0000-4000-8000-000000000003', true);
insert into app_private.admin_users (user_id, role, enabled)
values ('60000000-0000-4000-8000-000000000003', 'moderator', true);
select extensions.throws_ok(
  $$update app_private.admin_users set created_at = now()
    where user_id = '60000000-0000-4000-8000-000000000003'$$,
  '42501',
  null,
  'provisioner cannot rewrite administrator creation timestamps'
);
select extensions.throws_ok(
  $$update app_private.admin_users set role = 'moderator'
    where user_id = '60000000-0000-4000-8000-000000000003'$$,
  '42501',
  null,
  'provisioner cannot rewrite administrator roles'
);
select extensions.throws_ok(
  $$update app_private.admin_users set user_id = '60000000-0000-4000-8000-000000000004'
    where user_id = '60000000-0000-4000-8000-000000000003'$$,
  '42501',
  null,
  'provisioner cannot transfer an administrator row to another user'
);
reset role;

set local role emanowa_owner;
update app_private.worlds
set state = 'open', posting_enabled = true,
    opens_at = now() - interval '1 hour', closes_at = now() + interval '1 year'
where slug = '2027';
reset role;

create temporary table stage_f_target (public_id uuid primary key);
grant select, insert on stage_f_target to emanowa_app, emanowa_admin_app, emanowa_owner;

set local role emanowa_app;
select set_config('app.actor_id', '60000000-0000-4000-8000-000000000001', true);
insert into stage_f_target (public_id)
select public_id
from app_private.create_ema(
  '2027', 610, 610, '管理対象の非公開本文', '通報対象', 'other',
  'basic_wood', 'public', 'owner_only',
  '61000000-0000-4000-8000-000000000001', decode(repeat('11', 32), 'hex')
);

select set_config('app.actor_id', '60000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (
    select jsonb_build_object(
      'accepted', accepted,
      'replayed', replayed,
      'status', http_status
    )
    from app_private.create_report(
      '2027', (select public_id from stage_f_target), 'spam', '確認してください',
      '62000000-0000-4000-8000-000000000001', decode(repeat('21', 32), 'hex')
    )
  ),
  jsonb_build_object('accepted', true, 'replayed', false, 'status', 201),
  'the first report is accepted with 201'
);
select extensions.is(
  (
    select jsonb_build_object('replayed', replayed, 'status', http_status)
    from app_private.create_report(
      '2027', (select public_id from stage_f_target), 'spam', '確認してください',
      '62000000-0000-4000-8000-000000000001', decode(repeat('21', 32), 'hex')
    )
  ),
  jsonb_build_object('replayed', true, 'status', 201),
  'an identical report retry restores the original 201 receipt'
);
select extensions.throws_ok(
  $$select * from app_private.create_report(
      '2027', (select public_id from stage_f_target), 'spam', '別内容',
      '62000000-0000-4000-8000-000000000001', decode(repeat('22', 32), 'hex')
    )$$,
  'P1005',
  'IDEMPOTENCY_KEY_REUSED',
  'one report idempotency key cannot represent a different body'
);
select extensions.is(
  (
    select http_status
    from app_private.create_report(
      '2027', (select public_id from stage_f_target), 'harassment', null,
      '62000000-0000-4000-8000-000000000002', decode(repeat('23', 32), 'hex')
    )
  ),
  200,
  'a second key reuses the same open reporter/ema report instead of growing the queue'
);
select extensions.throws_ok(
  $$select * from app_private.create_report(
      '2026', (select public_id from stage_f_target), 'spam', null,
      '62000000-0000-4000-8000-000000000003', decode(repeat('24', 32), 'hex')
    )$$,
  'P1008',
  'NOT_FOUND',
  'cross-world report targets are indistinguishable from missing targets'
);

reset role;
set local role emanowa_admin_app;
select set_config('app.actor_id', '60000000-0000-4000-8000-000000000004', true);
select extensions.is(app_private.is_current_admin(), false, 'an ordinary actor is not an administrator');
select extensions.throws_ok(
  $$select * from app_private.list_admin_reports('open', 50, null, null)$$,
  'P1012',
  'ADMIN_REQUIRED',
  'an ordinary actor on the admin connection still cannot list reports'
);

select set_config('app.actor_id', '60000000-0000-4000-8000-000000000003', true);
select extensions.is(app_private.is_current_admin(), true, 'the enabled server-managed moderator is recognized');
select extensions.is(
  (select count(*) from app_private.list_admin_reports('open', 50, null, null)),
  1::bigint,
  'the report queue contains one open report'
);
select extensions.is(
  (select message_text from app_private.list_admin_reports('open', 50, null, null)),
  null::text,
  'owner-only text is absent from the admin queue'
);
select extensions.ok(
  not (to_jsonb(queue) ? 'reporter_id')
    and not (to_jsonb(queue) ? 'reporterId'),
  'the admin queue row has no reporter identity field'
)
from app_private.list_admin_reports('open', 50, null, null) as queue;

select extensions.is(
  (
    select jsonb_build_object('status', status, 'version', version, 'replayed', replayed)
    from app_private.moderate_ema(
      (select public_id from stage_f_target), 'hide', 'spam', 1,
      '63000000-0000-4000-8000-000000000001', decode(repeat('31', 32), 'hex')
    )
  ),
  jsonb_build_object('status', 'hidden', 'version', 2, 'replayed', false),
  'moderation hides the ema with optimistic versioning'
);
select extensions.is(
  (select message_text from app_private.list_admin_reports('open', 50, null, null)),
  null::text,
  'a hidden ema never returns text from the admin queue'
);
select extensions.is(
  (
    select replayed
    from app_private.moderate_ema(
      (select public_id from stage_f_target), 'hide', 'spam', 1,
      '63000000-0000-4000-8000-000000000001', decode(repeat('31', 32), 'hex')
    )
  ),
  true,
  'an identical moderation retry does not repeat the state change or audit'
);

reset role;
set local role emanowa_app;
select set_config('app.actor_id', '', true);
select extensions.is(
  (
    select count(*)
    from app_private.get_public_ema('2027', (select public_id from stage_f_target))
  ),
  0::bigint,
  'hidden content immediately disappears from public detail'
);
select extensions.is(
  (
    select jsonb_build_object('kind', kind, 'publicId', public_id)
    from app_private.get_public_chunk('2027', 30, 30)
    where x = 610 and y = 610
  ),
  jsonb_build_object('kind', 'occupied', 'publicId', null),
  'hidden moderation preserves opaque occupancy without a public id'
);

reset role;
set local role emanowa_owner;
select set_config('app.actor_id', '60000000-0000-4000-8000-000000000003', true);
select extensions.is(
  (select count(*) from app_private.moderation_audit),
  1::bigint,
  'the hide and its replay leave one immutable moderation audit row'
);
select extensions.is(
  (
    select jsonb_build_object(
      'action', action,
      'before', before_status,
      'after', after_status,
      'reason', reason_code
    )
    from app_private.moderation_audit
  ),
  jsonb_build_object('action', 'hide', 'before', 'active', 'after', 'hidden', 'reason', 'spam'),
  'the audit captures actor action, reason, and status transition without UGC'
);

reset role;
set local role emanowa_admin_app;
select set_config('app.actor_id', '60000000-0000-4000-8000-000000000003', true);
select extensions.is(
  (
    select jsonb_build_object('status', status, 'version', version)
    from app_private.moderate_ema(
      (select public_id from stage_f_target), 'restore', 'other', 2,
      '63000000-0000-4000-8000-000000000002', decode(repeat('32', 32), 'hex')
    )
  ),
  jsonb_build_object('status', 'active', 'version', 3),
  'an administrator can restore a hidden, non-deleted ema'
);
select extensions.is(
  (
    select jsonb_build_object('state', state, 'version', version, 'replayed', replayed)
    from app_private.update_report(
      (select report_id from app_private.list_admin_reports('open', 50, null, null)),
      'resolved', 1,
      '64000000-0000-4000-8000-000000000001', decode(repeat('41', 32), 'hex')
    )
  ),
  jsonb_build_object('state', 'resolved', 'version', 2, 'replayed', false),
  'report resolution is versioned separately from ema moderation'
);
select extensions.is(
  (select count(*) from app_private.list_admin_reports('open', 50, null, null)),
  0::bigint,
  'resolved reports leave the open queue'
);
select extensions.is(
  (select count(*) from app_private.list_admin_reports('resolved', 50, null, null)),
  1::bigint,
  'resolved reports remain available in the selected terminal queue'
);
select extensions.is(
  (
    select jsonb_build_object('status', status, 'version', version)
    from app_private.moderate_ema(
      (select public_id from stage_f_target), 'delete', 'personal_information', 3,
      '63000000-0000-4000-8000-000000000003', decode(repeat('33', 32), 'hex')
    )
  ),
  jsonb_build_object('status', 'deleted', 'version', 4),
  'admin deletion scrubs and releases an active ema'
);
select extensions.throws_ok(
  $$select * from app_private.moderate_ema(
      (select public_id from stage_f_target), 'restore', 'other', 4,
      '63000000-0000-4000-8000-000000000004', decode(repeat('34', 32), 'hex')
    )$$,
  'P1008',
  'NOT_FOUND',
  'deleted emas cannot be restored'
);

reset role;
set local role emanowa_owner;
select set_config('app.actor_id', '60000000-0000-4000-8000-000000000003', true);
select extensions.is(
  (
    select jsonb_build_object(
      'status', status,
      'wish', wish_text,
      'nickname', nickname,
      'deleted', deleted_at is not null
    )
    from app_private.emas
    where public_id = (select public_id from stage_f_target)
  ),
  jsonb_build_object('status', 'deleted', 'wish', null, 'nickname', null, 'deleted', true),
  'admin deletion scrubs wish text and nickname at rest'
);
select extensions.is(
  (select count(*) from app_private.moderation_audit),
  3::bigint,
  'hide, restore, and delete each leave one audit row'
);
select extensions.is(
  (
    select jsonb_build_object('occupied', occupied_count, 'active', active_count, 'listed', listed_count)
    from app_private.world_chunks
    where world_id = '00000000-0000-4000-8000-000000002027'
      and cx = 30 and cy = 30
  ),
  jsonb_build_object('occupied', 0, 'active', 0, 'listed', 0),
  'moderation deltas restore then remove chunk counts without double-decrementing'
);

reset role;
set local role emanowa_app;
select extensions.is(
  (
    select jsonb_build_object('allowed', allowed, 'count', current_count, 'retry', retry_after_seconds)
    from app_private.consume_rate_limit(
      'otp_verify_link', decode(repeat('ff', 32), 'hex'), 600, 5
    )
  ),
  jsonb_build_object('allowed', true, 'count', 1, 'retry', 0),
  'email-link verification attempts use an independent shared counter'
);
select extensions.throws_ok(
  $$select * from app_private.consume_rate_limit(
      'otp_verify_link', decode(repeat('ff', 32), 'hex'), 60, 5
    )$$,
  'P1002',
  'VALIDATION_ERROR',
  'callers cannot weaken the email-link verification policy'
);
select extensions.throws_ok(
  $$select * from app_private.consume_rate_limit(
      'otp_verify', decode(repeat('fc', 32), 'hex'), 600, 5
    )$$,
  'P1002',
  'VALIDATION_ERROR',
  'the generic limiter cannot race the recovery pair counter'
);
select extensions.throws_ok(
  $$select * from app_private.consume_rate_limit(
      'otp_verify_source', decode(repeat('fe', 32), 'hex'), 600, 30
    )$$,
  'P1002',
  'VALIDATION_ERROR',
  'the generic limiter cannot race the recovery source counter'
);
select extensions.throws_ok(
  $$select * from app_private.consume_rate_limit(
      'otp_verify_target', decode(repeat('fd', 32), 'hex'), 600, 30
    )$$,
  'P1002',
  'VALIDATION_ERROR',
  'the generic limiter cannot race the recovery target counter'
);
select extensions.is(
  (
    select array_agg(limited.allowed order by attempt.number)
    from generate_series(1, 5) as attempt(number)
    cross join lateral app_private.consume_recovery_otp_verification_rate_limit(
      decode(repeat(case when attempt.number > 0 then 'e1' else '00' end, 32), 'hex'),
      decode(repeat('e2', 32), 'hex'),
      decode(repeat('e3', 32), 'hex')
    ) as limited
  ),
  array[true, true, true, true, true],
  'recovery verification atomically allows the first five pair attempts'
);
select extensions.is(
  (
    select jsonb_build_object('allowed', allowed, 'count', current_count)
    from app_private.consume_recovery_otp_verification_rate_limit(
      decode(repeat('e1', 32), 'hex'),
      decode(repeat('e2', 32), 'hex'),
      decode(repeat('e3', 32), 'hex')
    )
  ),
  jsonb_build_object('allowed', false, 'count', 6),
  'the sixth pair attempt is denied by the narrow recovery limit'
);

reset role;
set local role emanowa_owner;
select extensions.is(
  (
    select jsonb_build_object(
      'pair', max(count) filter (where action = 'otp_verify'),
      'target', max(count) filter (where action = 'otp_verify_target'),
      'source', max(count) filter (where action = 'otp_verify_source')
    )
    from app_private.rate_limit_buckets
    where subject_hash in (
      decode(repeat('e1', 32), 'hex'),
      decode(repeat('e2', 32), 'hex'),
      decode(repeat('e3', 32), 'hex')
    )
  ),
  jsonb_build_object('pair', 6, 'target', 5, 'source', 5),
  'an exhausted pair does not poison its target or shared source quota'
);

insert into app_private.rate_limit_buckets (
  action, subject_hash, window_start, count, expires_at
) values (
  'otp_verify_source',
  decode(repeat('e6', 32), 'hex'),
  to_timestamp(floor(extract(epoch from transaction_timestamp()) / 600) * 600),
  30,
  to_timestamp(floor(extract(epoch from transaction_timestamp()) / 600) * 600) + interval '600 seconds'
);
reset role;
set local role emanowa_app;
select extensions.is(
  (
    select jsonb_build_object('allowed', allowed, 'count', current_count)
    from app_private.consume_recovery_otp_verification_rate_limit(
      decode(repeat('e4', 32), 'hex'),
      decode(repeat('e5', 32), 'hex'),
      decode(repeat('e6', 32), 'hex')
    )
  ),
  jsonb_build_object('allowed', false, 'count', 31),
  'the source-wide recovery limit denies a rotated target'
);
reset role;
set local role emanowa_owner;
select extensions.ok(
  not exists (
    select 1 from app_private.rate_limit_buckets
    where subject_hash in (
      decode(repeat('e4', 32), 'hex'),
      decode(repeat('e5', 32), 'hex')
    )
  ),
  'an exhausted source does not create pair or target buckets for rotations'
);

insert into app_private.rate_limit_buckets (
  action, subject_hash, window_start, count, expires_at
) values (
  'otp_verify_target',
  decode(repeat('e8', 32), 'hex'),
  to_timestamp(floor(extract(epoch from transaction_timestamp()) / 600) * 600),
  30,
  to_timestamp(floor(extract(epoch from transaction_timestamp()) / 600) * 600) + interval '600 seconds'
);
reset role;
set local role emanowa_app;
select extensions.is(
  (
    select jsonb_build_object('allowed', allowed, 'count', current_count)
    from app_private.consume_recovery_otp_verification_rate_limit(
      decode(repeat('e7', 32), 'hex'),
      decode(repeat('e8', 32), 'hex'),
      decode(repeat('e9', 32), 'hex')
    )
  ),
  jsonb_build_object('allowed', false, 'count', 31),
  'the target-wide recovery limit denies a rotated source'
);
reset role;
set local role emanowa_owner;
select extensions.ok(
  not exists (
    select 1 from app_private.rate_limit_buckets
    where subject_hash in (
      decode(repeat('e7', 32), 'hex'),
      decode(repeat('e9', 32), 'hex')
    )
  ),
  'an exhausted target does not create pair or source buckets for rotations'
);
reset role;
set local role emanowa_app;
select extensions.is(
  (
    select jsonb_build_object('allowed', allowed, 'count', current_count, 'retry', retry_after_seconds)
    from app_private.reserve_otp_rate_limit(
      decode(repeat('aa', 32), 'hex'), 60, 1,
      '64000000-0000-4000-8000-000000000001'
    )
  ),
  jsonb_build_object('allowed', true, 'count', 1, 'retry', 0),
  'the first request in a shared bucket is allowed'
);
select extensions.ok(
  (
    select not allowed and current_count = 2 and retry_after_seconds between 1 and 60
    from app_private.reserve_otp_rate_limit(
      decode(repeat('aa', 32), 'hex'), 60, 1,
      '64000000-0000-4000-8000-000000000002'
    )
  ),
  'the next request is rejected with a bounded Retry-After'
);
select extensions.throws_ok(
  $$select * from app_private.reserve_otp_rate_limit(
      decode(repeat('aa', 32), 'hex'), 60, 2,
      '64000000-0000-4000-8000-000000000003'
    )$$,
  'P1002',
  'VALIDATION_ERROR',
  'callers cannot weaken a server-fixed rate limit'
);
select extensions.throws_ok(
  $$select * from app_private.consume_rate_limit(
      'otp', decode(repeat('aa', 32), 'hex'), 60, 1
    )$$,
  'P1002',
  'VALIDATION_ERROR',
  'the aggregate limiter cannot bypass OTP reservation semantics'
);
select extensions.is(
  app_private.release_otp_rate_limit(
    decode(repeat('dd', 32), 'hex'),
    '64000000-0000-4000-8000-000000000001'
  ),
  false,
  'a mismatched subject cannot release another OTP reservation'
);
select extensions.is(
  app_private.release_otp_rate_limit(
    decode(repeat('aa', 32), 'hex'),
    '64000000-0000-4000-8000-000000000001'
  ),
  true,
  'an explicitly unsent OTP releases its own reservation'
);
select extensions.is(
  app_private.release_otp_rate_limit(
    decode(repeat('aa', 32), 'hex'),
    '64000000-0000-4000-8000-000000000001'
  ),
  false,
  'releasing the same OTP reservation twice is idempotent'
);
select extensions.is(
  (
    select jsonb_build_object('allowed', allowed, 'count', current_count)
    from app_private.reserve_otp_rate_limit(
      decode(repeat('aa', 32), 'hex'), 60, 1,
      '64000000-0000-4000-8000-000000000004'
    )
  ),
  jsonb_build_object('allowed', true, 'count', 1),
  'a CAPTCHA rollback makes exactly one OTP slot available again'
);

reset role;
set local role emanowa_owner;
insert into app_private.rate_limit_buckets (
  action, subject_hash, window_start, count, expires_at, reservation_ids
)
values (
  'otp', decode(repeat('ee', 32), 'hex'),
  date_trunc('minute', transaction_timestamp()) - interval '1 second',
  1,
  transaction_timestamp() + interval '30 seconds',
  array['64000000-0000-4000-8000-000000000007'::uuid]
);
reset role;
set local role emanowa_app;
select extensions.ok(
  (
    select not allowed and current_count = 2 and retry_after_seconds between 1 and 30
    from app_private.reserve_otp_rate_limit(
      decode(repeat('ee', 32), 'hex'), 60, 1,
      '64000000-0000-4000-8000-000000000008'
    )
  ),
  'an unexpired OTP cooldown survives a calendar-minute boundary'
);

reset role;
set local role emanowa_owner;
insert into app_private.rate_limit_buckets (
  action, subject_hash, window_start, count, expires_at, reservation_ids
)
values (
  'otp', decode(repeat('bb', 32), 'hex'),
  now() - interval '2 minutes', 1, now() - interval '1 minute',
  array['64000000-0000-4000-8000-000000000005'::uuid]
);
reset role;
set local role emanowa_app;
select extensions.is(
  (
    select current_count
    from app_private.reserve_otp_rate_limit(
      decode(repeat('cc', 32), 'hex'), 60, 1,
      '64000000-0000-4000-8000-000000000006'
    )
  ),
  1,
  'a different subject request proceeds while amortizing global cleanup'
);
reset role;
set local role emanowa_owner;
select extensions.is(
  (
    select count(*)
    from app_private.rate_limit_buckets
    where action = 'otp' and subject_hash = decode(repeat('bb', 32), 'hex')
  ),
  0::bigint,
  'expired buckets for one-time, unrelated subjects are eventually removed'
);
select extensions.is(
  (
    select count(*)
    from app_private.rate_limit_buckets
    where action = 'otp' and subject_hash = decode(repeat('cc', 32), 'hex')
  ),
  1::bigint,
  'global cleanup does not remove the current subject window'
);
select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'app_private'
      and indexname = 'reports_open_reporter_ema_uq'
      and indexdef ilike '%WHERE (state = ''open''%'
  ),
  'the open report dedupe is enforced by a partial unique index'
);

reset role;
set local role emanowa_admin_provisioner;
select set_config('app.actor_id', '60000000-0000-4000-8000-000000000003', true);
update app_private.admin_users
set enabled = false
where user_id = '60000000-0000-4000-8000-000000000003';
select extensions.is(
  (select enabled from app_private.admin_users where user_id = '60000000-0000-4000-8000-000000000003'),
  false,
  'the dedicated provisioner can disable exactly the selected moderator'
);
reset role;
set local role emanowa_admin_app;
select set_config('app.actor_id', '60000000-0000-4000-8000-000000000003', true);
select extensions.is(app_private.is_current_admin(), false, 'a disabled moderator immediately loses admin recognition');
select extensions.throws_ok(
  $$select * from app_private.list_admin_reports('resolved', 50, null, null)$$,
  'P1012',
  'ADMIN_REQUIRED',
  'a disabled moderator cannot keep using an existing admin connection'
);

reset role;
select * from extensions.finish();
rollback;
