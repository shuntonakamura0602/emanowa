begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_catalog, public, extensions;
grant emanowa_owner, emanowa_app to session_user;
grant usage on schema extensions to emanowa_app;

select extensions.plan(58);

select extensions.ok(
  has_function_privilege(
    'emanowa_app',
    'app_private.update_ema(uuid,integer,boolean,text,boolean,text,boolean,text,boolean,text,boolean,text,boolean,text,uuid,bytea)',
    'EXECUTE'
  ),
  'BFF role can execute owner updates'
);
select extensions.ok(
  has_function_privilege('emanowa_app', 'app_private.delete_ema(uuid,integer,uuid,bytea)', 'EXECUTE'),
  'BFF role can execute owner deletion'
);
select extensions.ok(
  has_function_privilege('emanowa_app', 'app_private.list_owner_worlds(integer,timestamptz,uuid)', 'EXECUTE'),
  'BFF role can execute owner-world keyset listing'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'app_private.update_ema(uuid,integer,boolean,text,boolean,text,boolean,text,boolean,text,boolean,text,boolean,text,uuid,bytea)',
    'EXECUTE'
  ),
  'anon cannot execute owner updates'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'app_private.delete_ema(uuid,integer,uuid,bytea)', 'EXECUTE'),
  'authenticated cannot execute owner deletion directly'
);
select extensions.ok(
  not has_function_privilege('service_role', 'app_private.list_owner_worlds(integer,timestamptz,uuid)', 'EXECUTE'),
  'service_role cannot execute owner-world listing directly'
);
select extensions.is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname in ('update_ema', 'delete_ema', 'list_owner_worlds')
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']
  ),
  3::bigint,
  'all Stage C boundaries are fixed-search-path security definers'
);
select extensions.is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'app_private'
      and tablename = 'ema_public_projection'
      and policyname = 'ema_public_projection_owner_actor_select'
      and cmd = 'SELECT'
  ),
  1::bigint,
  'owner mutations have the SELECT policy required to update unlisted projections'
);
select extensions.is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'app_private'
      and indexname = 'emas_owner_live_updated_idx'
      and indexdef ilike '%(owner_id, updated_at DESC, public_id DESC)%'
      and indexdef ilike '%WHERE (status = ANY%'
  ),
  1::bigint,
  'owner-world keyset listing has a live-row partial index'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'stage-c-a@example.test', now(), now()),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'stage-c-b@example.test', now(), now()),
  ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'stage-c-c@example.test', now(), now());

set local role emanowa_owner;
create policy stage_c_test_world_update on app_private.worlds
  for update to emanowa_owner using (true) with check (true);
update app_private.worlds
set state = 'open',
    opens_at = transaction_timestamp() - interval '1 hour',
    closes_at = transaction_timestamp() + interval '1 year'
where slug = '2027';
reset role;

set local role emanowa_app;
select set_config('app.actor_id', '', true);
select extensions.throws_ok(
  $$select * from app_private.update_ema(
    '550e8400-e29b-41d4-a716-446655440000', 1,
    true, '願い', false, null, false, null, false, null, false, null, false, null,
    '31000000-0000-4000-8000-000000000099', decode(repeat('99', 32), 'hex')
  )$$,
  'P1001', 'AUTH_REQUIRED', 'update rejects a missing actor'
);
select extensions.throws_ok(
  $$select * from app_private.list_owner_worlds(12, null, null)$$,
  'P1001', 'AUTH_REQUIRED', 'owner-world listing rejects a missing actor'
);

select set_config('app.actor_id', '11000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select * from app_private.create_ema(
    '2027', 40, 40, 'Aの最初の願い', 'A', 'health', 'basic_wood', 'public', 'public',
    '31000000-0000-4000-8000-000000000001', decode(repeat('11', 32), 'hex')
  )$$,
  'owner A creates an active public ema'
);
select set_config(
  'test.owner_a_public_id',
  (select public_id::text from app_private.get_owner_ema('2027')),
  true
);

select extensions.is(
  (
    select jsonb_build_object(
      'count', count(*),
      'worldSlug', min(world_slug),
      'status', min(status)
    )
    from app_private.list_owner_worlds(12, null, null)
  ),
  jsonb_build_object('count', 1, 'worldSlug', '2027', 'status', 'active'),
  'owner-world listing returns only the live owner summary'
);
select extensions.is(
  (select count(*) from app_private.list_owner_worlds(51, null, null)),
  1::bigint,
  'owner-world listing allows one internal lookahead row beyond the API maximum'
);
select extensions.is(
  (
    select count(*)
    from app_private.list_owner_worlds(
      12,
      (select updated_at from app_private.get_owner_ema('2027')),
      current_setting('test.owner_a_public_id')::uuid
    )
  ),
  0::bigint,
  'owner-world keyset cursor excludes the cursor row'
);
select extensions.throws_ok(
  $$select * from app_private.list_owner_worlds(12, transaction_timestamp(), null)$$,
  'P1002', 'VALIDATION_ERROR', 'owner-world cursor requires both keyset components'
);
select extensions.throws_ok(
  $$select * from app_private.list_owner_worlds(52, null, null)$$,
  'P1002', 'VALIDATION_ERROR', 'owner-world listing enforces the maximum limit'
);

select extensions.is(
  (
    select jsonb_build_object('version', version, 'result', result, 'replayed', replayed)
    from app_private.update_ema(
      current_setting('test.owner_a_public_id')::uuid, 1,
      true, 'Aの更新した秘密の願い', true, null, true, 'work', false, null,
      true, 'unlisted', true, 'owner_only',
      '32000000-0000-4000-8000-000000000001', decode(repeat('21', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 2, 'result', 'updated', 'replayed', false),
  'owner updates content and both privacy controls atomically'
);
reset role;
select extensions.is(
  (
    select jsonb_build_object(
      'wish', wish_text,
      'nickname', nickname,
      'category', category,
      'visibility', visibility,
      'messageVisibility', message_visibility,
      'version', version
    )
    from app_private.emas
    where public_id = current_setting('test.owner_a_public_id')::uuid
  ),
  jsonb_build_object(
    'wish', 'Aの更新した秘密の願い',
    'nickname', null,
    'category', 'work',
    'visibility', 'unlisted',
    'messageVisibility', 'owner_only',
    'version', 2
  ),
  'source row contains the normalized owner update and incremented version'
);
select extensions.is(
  (
    select jsonb_build_object(
      'visibility', visibility,
      'messageVisibility', message_visibility,
      'messageText', message_text,
      'version', version
    )
    from app_private.ema_public_projection
    where public_id = current_setting('test.owner_a_public_id')::uuid
  ),
  jsonb_build_object(
    'visibility', 'unlisted',
    'messageVisibility', 'owner_only',
    'messageText', null,
    'version', 2
  ),
  'privacy shrink removes private text from the projection in the same transaction'
);
select extensions.is(
  (
    select jsonb_build_object(
      'occupied', occupied_count,
      'active', active_count,
      'listed', listed_count,
      'revision', revision
    )
    from app_private.world_chunks
    where cx = 2 and cy = 2
  ),
  jsonb_build_object('occupied', 1, 'active', 1, 'listed', 0, 'revision', 2),
  'public-to-unlisted decrements only listed count and advances revision'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'replayed', replayed)
    from app_private.update_ema(
      current_setting('test.owner_a_public_id')::uuid, 2,
      true, 'Aのunlisted更新', false, null, false, null, false, null,
      false, null, false, null,
      '32000000-0000-4000-8000-000000000002', decode(repeat('22', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 3, 'replayed', false),
  'an already-unlisted projection remains owner-updatable under RLS'
);
reset role;
select extensions.is(
  (
    select jsonb_build_object('version', version, 'messageText', message_text)
    from app_private.ema_public_projection
    where public_id = current_setting('test.owner_a_public_id')::uuid
  ),
  jsonb_build_object('version', 3, 'messageText', null),
  'unlisted projection update keeps owner-only content absent'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'replayed', replayed)
    from app_private.update_ema(
      current_setting('test.owner_a_public_id')::uuid, 1,
      true, 'Aの更新した秘密の願い', true, null, true, 'work', false, null,
      true, 'unlisted', true, 'owner_only',
      '32000000-0000-4000-8000-000000000001', decode(repeat('21', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 2, 'replayed', true),
  'same update key and body replays the immutable original receipt'
);
reset role;
select extensions.is(
  (
    select jsonb_build_object('version', ema.version, 'revision', chunk.revision)
    from app_private.emas as ema
    join app_private.world_chunks as chunk
      on chunk.world_id = ema.world_id and chunk.cx = ema.x / 20 and chunk.cy = ema.y / 20
    where ema.public_id = current_setting('test.owner_a_public_id')::uuid
  ),
  jsonb_build_object('version', 3, 'revision', 3),
  'replay never rolls back current state or advances the chunk revision'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok(
  $$select * from app_private.update_ema(
    current_setting('test.owner_a_public_id')::uuid, 1,
    true, 'Aの更新した秘密の願い', true, null, true, 'work', false, null,
    true, 'unlisted', true, 'owner_only',
    '32000000-0000-4000-8000-000000000001', decode(repeat('29', 32), 'hex')
  )$$,
  'P1005', 'IDEMPOTENCY_KEY_REUSED', 'same update key rejects a different request hash'
);
select extensions.throws_ok(
  $$select * from app_private.update_ema(
    current_setting('test.owner_a_public_id')::uuid, 2,
    true, '古い版での上書き', false, null, false, null, false, null,
    false, null, false, null,
    '32000000-0000-4000-8000-000000000003', decode(repeat('23', 32), 'hex')
  )$$,
  'P1009', 'VERSION_CONFLICT', 'stale expectedVersion cannot overwrite a newer owner edit'
);

select set_config('app.actor_id', '11000000-0000-4000-8000-000000000002', true);
select extensions.throws_ok(
  $$select * from app_private.update_ema(
    current_setting('test.owner_a_public_id')::uuid, 3,
    true, '他人の上書き', false, null, false, null, false, null,
    false, null, false, null,
    '32000000-0000-4000-8000-000000000004', decode(repeat('24', 32), 'hex')
  )$$,
  'P1008', 'NOT_FOUND', 'another owner cannot update a known public ID'
);
select extensions.throws_ok(
  $$select * from app_private.delete_ema(
    current_setting('test.owner_a_public_id')::uuid, 3,
    '33000000-0000-4000-8000-000000000001', decode(repeat('31', 32), 'hex')
  )$$,
  'P1008', 'NOT_FOUND', 'another owner cannot delete a known public ID'
);
select extensions.lives_ok(
  $$select * from app_private.create_ema(
    '2027', 80, 80, 'Bの願い', 'B', 'study', 'basic_wood', 'public', 'public',
    '31000000-0000-4000-8000-000000000002', decode(repeat('12', 32), 'hex')
  )$$,
  'owner B creates an ema for hidden-state tests'
);
select set_config(
  'test.owner_b_public_id',
  (select public_id::text from app_private.get_owner_ema('2027')),
  true
);
select extensions.is(
  (
    select jsonb_build_object('count', count(*), 'publicId', min(public_id::text))
    from app_private.list_owner_worlds(12, null, null)
  ),
  jsonb_build_object('count', 1, 'publicId', current_setting('test.owner_b_public_id')),
  'owner-world listing cannot expose another owner summary'
);
reset role;

-- Set up the moderation-hidden state directly. Stage F will expose the
-- audited admin boundary; Stage C only owns the behavior after hiding.
set local role emanowa_owner;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000002', true);
update app_private.emas as ema
set status = 'hidden', version = ema.version + 1, updated_at = transaction_timestamp()
where ema.public_id = current_setting('test.owner_b_public_id')::uuid;
delete from app_private.ema_public_projection as projection
where projection.public_id = current_setting('test.owner_b_public_id')::uuid;
update app_private.world_chunks as chunk
set active_count = chunk.active_count - 1,
    listed_count = chunk.listed_count - 1,
    revision = chunk.revision + 1,
    updated_at = transaction_timestamp()
where chunk.cx = 4 and chunk.cy = 4;
reset role;

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (
    select count(*)
    from app_private.get_public_ema(
      '2027',
      current_setting('test.owner_b_public_id')::uuid
    )
  ),
  0::bigint,
  'hidden ema is absent from public detail'
);
select extensions.throws_ok(
  $$select * from app_private.update_ema(
    current_setting('test.owner_b_public_id')::uuid, 2,
    true, 'hidden本文の変更', false, null, false, null, false, null,
    false, null, false, null,
    '32000000-0000-4000-8000-000000000005', decode(repeat('25', 32), 'hex')
  )$$,
  'P1010', 'FORBIDDEN', 'hidden owner cannot edit content'
);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'result', result)
    from app_private.update_ema(
      current_setting('test.owner_b_public_id')::uuid, 2,
      false, null, false, null, false, null, false, null,
      true, 'unlisted', true, 'owner_only',
      '32000000-0000-4000-8000-000000000006', decode(repeat('26', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 3, 'result', 'updated'),
  'hidden owner may only restrict public settings'
);
reset role;
select extensions.is(
  (
    select jsonb_build_object(
      'occupied', occupied_count,
      'active', active_count,
      'listed', listed_count,
      'revision', revision
    )
    from app_private.world_chunks
    where cx = 4 and cy = 4
  ),
  jsonb_build_object('occupied', 1, 'active', 0, 'listed', 0, 'revision', 3),
  'hidden restriction keeps occupancy and does not double-decrement active counts'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'result', result, 'replayed', replayed)
    from app_private.delete_ema(
      current_setting('test.owner_b_public_id')::uuid, 3,
      '33000000-0000-4000-8000-000000000002', decode(repeat('32', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 4, 'result', 'deleted', 'replayed', false),
  'hidden owner can delete and receives a tombstone receipt'
);
reset role;
select extensions.is(
  (
    select jsonb_build_object(
      'status', ema.status,
      'wish', ema.wish_text,
      'nickname', ema.nickname,
      'projectionCount', (select count(*) from app_private.ema_public_projection as projection where projection.ema_id = ema.id),
      'occupancyCount', (select count(*) from app_private.slot_occupancy as occupancy where occupancy.ema_id = ema.id)
    )
    from app_private.emas as ema
    where ema.public_id = current_setting('test.owner_b_public_id')::uuid
  ),
  jsonb_build_object(
    'status', 'deleted',
    'wish', null,
    'nickname', null,
    'projectionCount', 0,
    'occupancyCount', 0
  ),
  'hidden deletion scrubs text and removes projection and occupancy'
);
select extensions.is(
  (
    select jsonb_build_object(
      'occupied', occupied_count,
      'active', active_count,
      'listed', listed_count,
      'revision', revision
    )
    from app_private.world_chunks
    where cx = 4 and cy = 4
  ),
  jsonb_build_object('occupied', 0, 'active', 0, 'listed', 0, 'revision', 4),
  'hidden deletion decrements occupied count only'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000002', true);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'replayed', replayed)
    from app_private.delete_ema(
      current_setting('test.owner_b_public_id')::uuid, 3,
      '33000000-0000-4000-8000-000000000002', decode(repeat('32', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 4, 'replayed', true),
  'same hidden delete request replays its immutable receipt'
);
reset role;
select extensions.is(
  (select revision from app_private.world_chunks where cx = 4 and cy = 4),
  4::bigint,
  'delete replay does not decrement counts or advance revision twice'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select * from app_private.create_ema(
    '2027', 120, 120, 'Cの公開願い', 'C', 'challenge', 'basic_wood', 'public', 'public',
    '31000000-0000-4000-8000-000000000003', decode(repeat('13', 32), 'hex')
  )$$,
  'owner C creates an ema for archived-state tests'
);
select set_config(
  'test.owner_c_public_id',
  (select public_id::text from app_private.get_owner_ema('2027')),
  true
);
reset role;

set local role emanowa_owner;
update app_private.worlds set state = 'archived' where slug = '2027';
reset role;

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select * from app_private.update_ema(
    current_setting('test.owner_c_public_id')::uuid, 1,
    true, 'archived本文の変更', false, null, false, null, false, null,
    false, null, false, null,
    '32000000-0000-4000-8000-000000000007', decode(repeat('27', 32), 'hex')
  )$$,
  'P1003', 'WORLD_NOT_OPEN', 'archived world rejects content edits'
);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'result', result)
    from app_private.update_ema(
      current_setting('test.owner_c_public_id')::uuid, 1,
      false, null, false, null, false, null, false, null,
      true, 'unlisted', true, 'owner_only',
      '32000000-0000-4000-8000-000000000008', decode(repeat('28', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 2, 'result', 'updated'),
  'archived world permits public-scope restriction'
);
reset role;
select extensions.is(
  (
    select jsonb_build_object(
      'visibility', visibility,
      'messageVisibility', message_visibility,
      'messageText', message_text,
      'version', version
    )
    from app_private.ema_public_projection
    where public_id = current_setting('test.owner_c_public_id')::uuid
  ),
  jsonb_build_object(
    'visibility', 'unlisted',
    'messageVisibility', 'owner_only',
    'messageText', null,
    'version', 2
  ),
  'archived privacy restriction is reflected synchronously in projection'
);
select extensions.is(
  (
    select jsonb_build_object('listed', listed_count, 'revision', revision)
    from app_private.world_chunks
    where cx = 6 and cy = 6
  ),
  jsonb_build_object('listed', 0, 'revision', 2),
  'archived privacy restriction updates listed count and revision'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000003', true);
select extensions.is(
  (
    select version
    from app_private.update_ema(
      current_setting('test.owner_c_public_id')::uuid, 2,
      false, null, false, null, false, null, false, null,
      true, 'unlisted', true, 'owner_only',
      '32000000-0000-4000-8000-000000000009', decode(repeat('2a', 32), 'hex')
    )
  ),
  3,
  'an identical permitted archived patch still increments version'
);
reset role;
select extensions.is(
  (select revision from app_private.world_chunks where cx = 6 and cy = 6),
  3::bigint,
  'identical successful archived patch still advances chunk revision'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select * from app_private.update_ema(
    current_setting('test.owner_c_public_id')::uuid, 3,
    false, null, false, null, false, null, false, null,
    true, 'public', true, 'public',
    '32000000-0000-4000-8000-000000000010', decode(repeat('2b', 32), 'hex')
  )$$,
  'P1010', 'FORBIDDEN', 'archived world rejects public-scope expansion'
);
reset role;
select extensions.is(
  (
    select jsonb_build_object('version', version, 'visibility', visibility, 'messageVisibility', message_visibility)
    from app_private.emas
    where public_id = current_setting('test.owner_c_public_id')::uuid
  ),
  jsonb_build_object('version', 3, 'visibility', 'unlisted', 'messageVisibility', 'owner_only'),
  'rejected archived expansion leaves source state unchanged'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'result', result, 'replayed', replayed)
    from app_private.delete_ema(
      current_setting('test.owner_a_public_id')::uuid, 3,
      '33000000-0000-4000-8000-000000000003', decode(repeat('33', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 4, 'result', 'deleted', 'replayed', false),
  'active owner deletion remains available after archiving'
);
reset role;
select extensions.is(
  (
    select jsonb_build_object(
      'status', ema.status,
      'wish', ema.wish_text,
      'nickname', ema.nickname,
      'projectionCount', (select count(*) from app_private.ema_public_projection as projection where projection.ema_id = ema.id),
      'occupancyCount', (select count(*) from app_private.slot_occupancy as occupancy where occupancy.ema_id = ema.id)
    )
    from app_private.emas as ema
    where ema.public_id = current_setting('test.owner_a_public_id')::uuid
  ),
  jsonb_build_object(
    'status', 'deleted',
    'wish', null,
    'nickname', null,
    'projectionCount', 0,
    'occupancyCount', 0
  ),
  'active deletion scrubs private fields and removes public and occupancy rows'
);
select extensions.is(
  (
    select jsonb_build_object(
      'occupied', occupied_count,
      'active', active_count,
      'listed', listed_count,
      'revision', revision
    )
    from app_private.world_chunks
    where cx = 2 and cy = 2
  ),
  jsonb_build_object('occupied', 0, 'active', 0, 'listed', 0, 'revision', 4),
  'active unlisted deletion decrements occupied and active without double-decrementing listed'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (
    select jsonb_build_object('version', version, 'replayed', replayed)
    from app_private.delete_ema(
      current_setting('test.owner_a_public_id')::uuid, 3,
      '33000000-0000-4000-8000-000000000003', decode(repeat('33', 32), 'hex')
    )
  ),
  jsonb_build_object('version', 4, 'replayed', true),
  'same active delete request replays the original receipt'
);
reset role;
select extensions.is(
  (select revision from app_private.world_chunks where cx = 2 and cy = 2),
  4::bigint,
  'active delete replay does not mutate counters again'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (
    select count(*)
    from app_private.get_public_ema('2027', current_setting('test.owner_a_public_id')::uuid)
  ),
  0::bigint,
  'deleted public ID returns no public detail'
);
select extensions.is(
  (
    select jsonb_build_object('publicId', public_id::text, 'version', version, 'replayed', replayed)
    from app_private.create_ema(
      '2027', 40, 40, 'Aの最初の願い', 'A', 'health', 'basic_wood', 'public', 'public',
      '31000000-0000-4000-8000-000000000001', decode(repeat('11', 32), 'hex')
    )
  ),
  jsonb_build_object(
    'publicId', current_setting('test.owner_a_public_id'),
    'version', 1,
    'replayed', true
  ),
  'old create retry after deletion returns its original receipt without resurrection'
);
reset role;
select extensions.is(
  (
    select jsonb_build_object(
      'status', status,
      'sourceCount', count(*),
      'liveCount', count(*) filter (where status in ('active', 'hidden'))
    )
    from app_private.emas
    where public_id = current_setting('test.owner_a_public_id')::uuid
    group by status
  ),
  jsonb_build_object('status', 'deleted', 'sourceCount', 1, 'liveCount', 0),
  'create replay preserves the deleted tombstone and does not recreate the ema'
);

set local role emanowa_app;
select set_config('app.actor_id', '11000000-0000-4000-8000-000000000001', true);
select extensions.is(
  (select count(*) from app_private.list_owner_worlds(12, null, null)),
  0::bigint,
  'owner-world listing excludes deleted tombstones'
);
reset role;

select * from extensions.finish();
rollback;
