begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_catalog, public, extensions;
grant emanowa_owner, emanowa_app to session_user;
grant usage on schema extensions to emanowa_app;

select extensions.plan(48);

select extensions.tables_are(
  'app_private',
  array[
    'admin_users',
    'ema_public_projection',
    'emas',
    'idempotency_records',
    'moderation_audit',
    'rate_limit_buckets',
    'reports',
    'slot_occupancy',
    'world_chunks',
    'worlds'
  ],
  'app_private contains exactly the ten P0 tables'
);

select extensions.ok(has_schema_privilege('emanowa_app', 'app_private', 'USAGE'), 'BFF role can resolve the private API schema');
select extensions.ok(not has_schema_privilege('anon', 'app_private', 'USAGE'), 'anon cannot resolve the private schema');
select extensions.ok(not has_schema_privilege('authenticated', 'app_private', 'USAGE'), 'authenticated cannot resolve the private schema');
select extensions.ok(not has_schema_privilege('service_role', 'app_private', 'USAGE'), 'service_role cannot resolve the private schema');
select extensions.ok(not has_schema_privilege('public', 'app_private', 'USAGE'), 'PUBLIC cannot resolve the private schema');

select extensions.is((select rolsuper from pg_roles where rolname = 'emanowa_app'), false, 'BFF role is not superuser');
select extensions.is((select rolbypassrls from pg_roles where rolname = 'emanowa_app'), false, 'BFF role cannot bypass RLS');
select extensions.is((select rolcanlogin from pg_roles where rolname = 'emanowa_app'), false, 'BFF role is NOLOGIN in committed migrations');
select extensions.is((select rolbypassrls from pg_roles where rolname = 'emanowa_owner'), false, 'private object owner cannot bypass RLS');
select extensions.ok(
  not pg_has_role('postgres', 'emanowa_app', 'USAGE') and not pg_has_role('postgres', 'emanowa_app', 'SET'),
  'role-creator administration cannot inherit or SET the BFF role'
);
select extensions.ok(
  not pg_has_role('postgres', 'emanowa_owner', 'USAGE') and not pg_has_role('postgres', 'emanowa_owner', 'SET'),
  'role-creator administration cannot inherit or SET the object-owner role'
);
select extensions.ok(has_schema_privilege('emanowa_owner', 'extensions', 'USAGE'), 'function owner can resolve the allow-listed pgcrypto helper');

select extensions.ok(not has_table_privilege('emanowa_app', 'app_private.emas', 'SELECT'), 'BFF role has no direct table access');
select extensions.ok(not has_table_privilege('anon', 'app_private.emas', 'SELECT'), 'anon has no direct table access');
select extensions.ok(not has_table_privilege('authenticated', 'app_private.emas', 'SELECT'), 'authenticated has no direct table access');
select extensions.ok(not has_table_privilege('service_role', 'app_private.emas', 'SELECT'), 'service_role has no direct table access');
select extensions.ok(
  has_function_privilege('emanowa_app', 'app_private.create_ema(text,integer,integer,text,text,text,text,text,text,uuid,bytea)', 'EXECUTE'),
  'BFF role can execute the typed create boundary'
);
select extensions.ok(
  not has_function_privilege('anon', 'app_private.create_ema(text,integer,integer,text,text,text,text,text,text,uuid,bytea)', 'EXECUTE'),
  'anon cannot execute the create boundary'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'app_private.create_ema(text,integer,integer,text,text,text,text,text,text,uuid,bytea)', 'EXECUTE'),
  'authenticated cannot execute the create boundary'
);
select extensions.ok(
  not has_function_privilege('service_role', 'app_private.create_ema(text,integer,integer,text,text,text,text,text,text,uuid,bytea)', 'EXECUTE'),
  'service_role cannot execute the create boundary'
);

select extensions.is(
  (select count(*) from pg_class as relation join pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'app_private' and relation.relkind in ('r', 'p') and relation.relrowsecurity),
  10::bigint,
  'RLS is enabled on all P0 tables'
);
select extensions.is(
  (select count(*) from pg_class as relation join pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'app_private' and relation.relkind in ('r', 'p') and relation.relforcerowsecurity),
  10::bigint,
  'RLS is forced on all P0 tables'
);
select extensions.is(
  (select count(*) from pg_proc as procedure join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'app_private'
     and procedure.proname in ('create_ema', 'get_public_world', 'get_public_ema', 'list_public_emas', 'get_public_chunk', 'get_owner_ema')
     and procedure.prosecdef and procedure.proconfig @> array['search_path=""']),
  6::bigint,
  'all six boundary functions are fixed-search-path security definers'
);
select extensions.is(
  (select count(*) from pg_proc as procedure join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'app_private' and procedure.proname in ('current_actor_id', 'current_lookup_public_id') and not procedure.prosecdef),
  2::bigint,
  'GUC parsers remain security-invoker helpers'
);

select extensions.is(
  (select jsonb_build_object('slug', slug, 'state', state, 'width', width, 'height', height, 'opensAt', opens_at, 'closesAt', closes_at)
   from app_private.worlds where slug = '2027'),
  jsonb_build_object('slug', '2027', 'state', 'preview', 'width', 1000, 'height', 1000,
    'opensAt', '2026-12-19T15:00:00Z'::timestamptz, 'closesAt', '2027-12-31T15:00:00Z'::timestamptz),
  'the 2027 preview world is durable product data'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-a@example.test', now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-b@example.test', now(), now()),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'owner-c@example.test', now(), now());

set local role emanowa_owner;
create policy stage_b_test_world_update on app_private.worlds
  for update to emanowa_owner using (true) with check (true);
update app_private.worlds
set state = 'open', opens_at = now() - interval '1 hour', closes_at = now() + interval '1 year'
where slug = '2027';
reset role;

set local role emanowa_app;
select set_config('app.actor_id', '', true);
select extensions.throws_ok(
  $$select * from app_private.create_ema('2027', 10, 10, '秘密の願い', 'A', 'health', 'basic_wood', 'public', 'owner_only',
    '20000000-0000-4000-8000-000000000001', decode(repeat('11', 32), 'hex'))$$,
  'P1001', 'AUTH_REQUIRED', 'create rejects a missing transaction actor'
);

select set_config('app.actor_id', '10000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select * from app_private.create_ema('2027', 10, 10, '秘密の願い', 'A', 'health', 'basic_wood', 'public', 'owner_only',
    '20000000-0000-4000-8000-000000000001', decode(repeat('11', 32), 'hex'))$$,
  'owner A creates one owner-only-message public ema'
);
select extensions.is((select wish_text from app_private.get_owner_ema('2027')), '秘密の願い', 'owner A can retrieve the private wish text');
reset role;
select extensions.is((select message_text from app_private.ema_public_projection where nickname = 'A'), null::text,
  'owner-only text is absent from the public projection at rest');
set local role emanowa_app;
select extensions.is(
  (select message_text from app_private.get_public_ema('2027', (select public_id from app_private.get_owner_ema('2027')))),
  null::text,
  'owner-only text is absent from public detail output'
);
select extensions.is(
  (select replayed from app_private.create_ema('2027', 10, 10, '秘密の願い', 'A', 'health', 'basic_wood', 'public', 'owner_only',
    '20000000-0000-4000-8000-000000000001', decode(repeat('11', 32), 'hex'))),
  true,
  'an identical idempotent retry replays its receipt'
);
select extensions.throws_ok(
  $$select * from app_private.create_ema('2027', 10, 10, '秘密の願い', 'A', 'health', 'basic_wood', 'public', 'owner_only',
    '20000000-0000-4000-8000-000000000001', decode(repeat('12', 32), 'hex'))$$,
  'P1005', 'IDEMPOTENCY_KEY_REUSED', 'an idempotency key cannot represent a different request hash'
);
select extensions.throws_ok(
  $$select * from app_private.create_ema('2027', 11, 10, '二つ目', 'A2', 'work', 'basic_wood', 'public', 'public',
    '20000000-0000-4000-8000-000000000002', decode(repeat('13', 32), 'hex'))$$,
  'P1006', 'OWNER_LIMIT_REACHED', 'one owner cannot hold two live emas in one world'
);

select set_config('app.actor_id', '10000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select * from app_private.create_ema('2027', 12, 10, '公開してよい願い', 'B', 'study', 'basic_wood', 'unlisted', 'public',
    '20000000-0000-4000-8000-000000000003', decode(repeat('21', 32), 'hex'))$$,
  'owner B creates an unlisted ema in the same chunk'
);
select extensions.is((select nickname from app_private.get_owner_ema('2027')), 'B', 'owner B sees only owner B data through owner retrieval');
select extensions.is((select count(*) from app_private.list_public_emas('2027', 24, null, null, null)), 1::bigint,
  'public enumeration excludes unlisted emas');
select extensions.is(
  (select message_text from app_private.get_public_ema('2027', (select public_id from app_private.get_owner_ema('2027')))),
  '公開してよい願い',
  'an exact public-id lookup can retrieve an active unlisted ema'
);
select extensions.is(
  (select jsonb_build_object('kind', kind, 'publicId', public_id, 'nickname', nickname, 'messageText', message_text)
   from app_private.get_public_chunk('2027', 0, 0) where x = 12 and y = 10),
  jsonb_build_object('kind', 'occupied', 'publicId', null, 'nickname', null, 'messageText', null),
  'chunk output exposes only occupancy for an unlisted slot'
);

select set_config('app.actor_id', '10000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select * from app_private.create_ema('2027', 12, 10, '衝突', 'C', 'other', 'basic_wood', 'public', 'public',
    '20000000-0000-4000-8000-000000000004', decode(repeat('31', 32), 'hex'))$$,
  'P1007', 'SLOT_TAKEN', 'two owners cannot occupy the same live slot'
);

reset role;
select extensions.is(
  (select jsonb_build_object('occupied', occupied_count, 'active', active_count, 'listed', listed_count, 'revision', revision)
   from app_private.world_chunks where cx = 0 and cy = 0),
  jsonb_build_object('occupied', 2, 'active', 2, 'listed', 1, 'revision', 2),
  'atomic creates maintain chunk counts and revision'
);
select extensions.is(
  (select count(*) from app_private.slot_occupancy as occupancy
   left join app_private.emas as ema on (ema.id, ema.world_id, ema.x, ema.y) = (occupancy.ema_id, occupancy.world_id, occupancy.x, occupancy.y)
   where ema.id is null),
  0::bigint,
  'occupancy rows cannot drift from source identity and coordinates'
);
select extensions.is(
  (select count(*) from app_private.ema_public_projection as projection
   left join app_private.emas as ema
     on (ema.id, ema.public_id, ema.world_id, ema.x, ema.y) =
        (projection.ema_id, projection.public_id, projection.world_id, projection.x, projection.y)
   where ema.id is null),
  0::bigint,
  'projection rows cannot drift from source id, public id, world, or coordinates'
);
select extensions.is(
  (select count(*) from pg_indexes where schemaname = 'app_private'
   and indexname in ('emas_live_slot_uq', 'emas_live_owner_uq') and indexdef ilike '%WHERE (status = ANY%'),
  2::bigint,
  'partial live-slot and live-owner uniqueness indexes both exist'
);
select extensions.is(
  (select count(*) from pg_constraint where connamespace = 'app_private'::regnamespace
   and conname = 'ema_public_projection_identity_position_fkey' and contype = 'f' and array_length(conkey, 1) = 5),
  1::bigint,
  'projection identity is protected by a five-column composite foreign key'
);

set local role emanowa_owner;
select set_config('app.actor_id', '10000000-0000-4000-8000-000000000001', true);
select extensions.is((select count(*) from app_private.emas), 1::bigint, 'FORCE RLS limits the owner role to actor A rows');
select set_config('app.actor_id', '10000000-0000-4000-8000-000000000002', true);
select extensions.is((select count(*) from app_private.emas), 1::bigint, 'FORCE RLS limits the owner role to actor B rows');
reset role;
set local role emanowa_app;
select set_config('app.lookup_public_id', '', true);
select extensions.is(app_private.current_lookup_public_id(), null::uuid, 'ordinary reads clear the exact-lookup capability');
reset role;

select * from extensions.finish();
rollback;
