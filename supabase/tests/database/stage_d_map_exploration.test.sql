begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_catalog, public, extensions;
grant emanowa_owner, emanowa_app to session_user;
grant usage on schema extensions to emanowa_app;

select extensions.plan(48);

select extensions.ok(
  has_function_privilege('emanowa_app', 'app_private.get_public_overview(text,integer)', 'EXECUTE'),
  'BFF role can execute the bounded overview boundary'
);
select extensions.ok(
  has_function_privilege('emanowa_app', 'app_private.get_public_chunk_meta(text,integer,integer)', 'EXECUTE'),
  'BFF role can execute chunk metadata retrieval'
);
select extensions.ok(
  has_function_privilege('emanowa_app', 'app_private.get_random_public_ema(text,text,uuid)', 'EXECUTE'),
  'BFF role can execute indexed random discovery'
);
select extensions.ok(
  not has_function_privilege('anon', 'app_private.get_public_overview(text,integer)', 'EXECUTE'),
  'anon cannot execute the private overview boundary directly'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'app_private.get_public_chunk_meta(text,integer,integer)', 'EXECUTE'),
  'authenticated cannot execute the private chunk boundary directly'
);
select extensions.ok(
  not has_function_privilege('service_role', 'app_private.get_random_public_ema(text,text,uuid)', 'EXECUTE'),
  'service role cannot execute the private random boundary directly'
);
select extensions.is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname in (
        'get_public_overview', 'get_public_chunk_meta', 'get_random_public_ema'
      )
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']
  ),
  3::bigint,
  'all Stage D functions are fixed-search-path security definers'
);
select extensions.is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'app_private'
      and indexname = 'slot_occupancy_chunk_idx'
      and indexdef ilike '%world_id%((x / 20))%((y / 20))%y, x%'
  ),
  1::bigint,
  'chunk occupancy has a bounded expression index'
);
select extensions.is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'app_private'
      and indexname = 'ema_public_random_idx'
      and indexdef ilike '%(world_id, public_id)%'
      and indexdef ilike '%WHERE (visibility = ''public''::text)%'
  ),
  1::bigint,
  'random discovery has a public-only world and UUID index'
);
select extensions.is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'app_private'
      and indexname = 'ema_public_category_random_idx'
      and indexdef ilike '%(world_id, category, public_id)%'
      and indexdef ilike '%WHERE (visibility = ''public''::text)%'
  ),
  1::bigint,
  'category random discovery has a matching partial index'
);
select extensions.is(
  (
    select count(*)
    from pg_proc as procedure
    where procedure.oid in (
      'app_private.get_public_chunk(text,integer,integer)'::regprocedure,
      'app_private.get_public_chunk_meta(text,integer,integer)'::regprocedure
    )
      and procedure.provolatile = 's'
      and procedure.prosrc not ilike '%set_config%'
  ),
  2::bigint,
  'chunk metadata and cells are side-effect-free stable readers of the calling snapshot'
);
select extensions.ok(
  (
    select procedure.prosrc ilike '%projection.visibility = ''public''%'
    from pg_proc as procedure
    where procedure.oid = 'app_private.get_public_chunk(text,integer,integer)'::regprocedure
  ),
  'stable chunk retrieval keeps an explicit public-only projection boundary'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('12000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'stage-d-a@example.test', now(), now()),
  ('12000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'stage-d-b@example.test', now(), now()),
  ('12000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'stage-d-c@example.test', now(), now()),
  ('12000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'stage-d-d@example.test', now(), now());

set local role emanowa_owner;
create policy stage_d_test_world_update on app_private.worlds
  for update to emanowa_owner using (true) with check (true);
update app_private.worlds
set state = 'open',
    opens_at = transaction_timestamp() - interval '1 hour',
    closes_at = transaction_timestamp() + interval '1 year'
where slug = '2027';
reset role;

set local role emanowa_app;
select set_config('app.actor_id', '12000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok(
  $$select * from app_private.create_ema(
    '2027', 0, 0, 'OWNER_ONLY_SECRET_STAGE_D', 'Public A', 'health',
    'basic_wood', 'public', 'owner_only',
    '22000000-0000-4000-8000-000000000001', decode(repeat('11', 32), 'hex')
  )$$,
  'creates a listed owner-only ema in the first chunk'
);
select set_config('app.actor_id', '12000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok(
  $$select * from app_private.create_ema(
    '2027', 19, 19, 'UNLISTED_SECRET_STAGE_D', 'Unlisted B', 'other',
    'basic_wood', 'unlisted', 'public',
    '22000000-0000-4000-8000-000000000002', decode(repeat('22', 32), 'hex')
  )$$,
  'creates an unlisted ema at the first chunk edge'
);
select set_config('app.actor_id', '12000000-0000-4000-8000-000000000003', true);
select extensions.lives_ok(
  $$select * from app_private.create_ema(
    '2027', 20, 20, 'PUBLIC_STUDY_STAGE_D', 'Public C', 'study',
    'basic_wood', 'public', 'public',
    '22000000-0000-4000-8000-000000000003', decode(repeat('33', 32), 'hex')
  )$$,
  'creates a listed ema in the adjacent diagonal chunk'
);
select set_config('app.actor_id', '12000000-0000-4000-8000-000000000004', true);
select extensions.lives_ok(
  $$select * from app_private.create_ema(
    '2027', 5, 5, 'HIDDEN_SECRET_STAGE_D', 'Hidden D', 'other',
    'basic_wood', 'public', 'public',
    '22000000-0000-4000-8000-000000000004', decode(repeat('44', 32), 'hex')
  )$$,
  'creates the fixture that will become hidden'
);
reset role;

set local role emanowa_owner;
select set_config('app.actor_id', '12000000-0000-4000-8000-000000000004', true);
update app_private.emas set status = 'hidden', version = version + 1
where owner_id = app_private.current_actor_id() and x = 5 and y = 5;
delete from app_private.ema_public_projection
where ema_id = (
  select id from app_private.emas
  where owner_id = app_private.current_actor_id() and x = 5 and y = 5
);
update app_private.world_chunks
set active_count = active_count - 1,
    listed_count = listed_count - 1,
    revision = revision + 1,
    updated_at = transaction_timestamp()
where world_id = (select id from app_private.worlds where slug = '2027')
  and cx = 0
  and cy = 0;

select set_config('app.actor_id', '12000000-0000-4000-8000-000000000001', true);
update app_private.emas
set created_at = '2026-01-01T00:00:00.123456Z'::timestamptz
where owner_id = app_private.current_actor_id();
update app_private.ema_public_projection
set created_at = '2026-01-01T00:00:00.123456Z'::timestamptz
where nickname = 'Public A';

select set_config('app.actor_id', '12000000-0000-4000-8000-000000000003', true);
update app_private.emas
set created_at = '2026-01-01T00:00:00.123789Z'::timestamptz
where owner_id = app_private.current_actor_id();
update app_private.ema_public_projection
set created_at = '2026-01-01T00:00:00.123789Z'::timestamptz
where nickname = 'Public C';
reset role;

set local role emanowa_app;
select set_config('app.actor_id', '', true);
select extensions.is(
  (
    select jsonb_build_object(
      'x', x, 'y', y, 'occupied', occupied_count,
      'active', active_count, 'listed', listed_count
    )
    from app_private.get_public_overview('2027', 20)
    where x = 0 and y = 0
  ),
  jsonb_build_object('x', 0, 'y', 0, 'occupied', 3, 'active', 2, 'listed', 1),
  '20-cell overview distinguishes occupied, active, and listed counts'
);
select extensions.is(
  (
    select jsonb_build_object('occupied', occupied_count, 'active', active_count, 'listed', listed_count)
    from app_private.get_public_overview('2027', 20)
    where x = 20 and y = 20
  ),
  jsonb_build_object('occupied', 1, 'active', 1, 'listed', 1),
  '20-cell overview preserves the adjacent chunk position'
);
select extensions.is(
  (
    select jsonb_build_object('occupied', occupied_count, 'active', active_count, 'listed', listed_count)
    from app_private.get_public_overview('2027', 100)
    where x = 0 and y = 0
  ),
  jsonb_build_object('occupied', 4, 'active', 3, 'listed', 2),
  '100-cell overview aggregates existing chunks without fetching ema rows'
);
select extensions.is(
  (select count(*) from app_private.get_public_overview('2027', 100)),
  1::bigint,
  'sparse overview omits empty aggregate cells'
);
select extensions.throws_ok(
  $$select * from app_private.get_public_overview('2027', 10)$$,
  'P1002', 'VALIDATION_ERROR', 'overview rejects unsupported cell sizes'
);
select extensions.is(
  (select revision from app_private.get_public_chunk_meta('2027', 0, 0)),
  4::bigint,
  'chunk metadata tracks all first-chunk visibility changes'
);
select extensions.is(
  (select revision from app_private.get_public_chunk_meta('2027', 49, 49)),
  0::bigint,
  'an empty chunk has a real zero revision rather than being missing'
);
select extensions.is(
  (select count(*) from app_private.get_public_chunk_meta('9999', 0, 0)),
  0::bigint,
  'unknown worlds are distinct from empty chunks'
);
select extensions.is(
  (
    select jsonb_build_object(
      'kind', kind, 'publicId', public_id, 'nickname', nickname,
      'category', category, 'design', design_id, 'message', message_text
    )
    from app_private.get_public_chunk('2027', 0, 0)
    where x = 19 and y = 19
  ),
  jsonb_build_object(
    'kind', 'occupied', 'publicId', null, 'nickname', null,
    'category', null, 'design', null, 'message', null
  ),
  'unlisted chunk cells expose only occupancy'
);
select extensions.is(
  (
    select jsonb_build_object(
      'kind', kind, 'publicId', public_id, 'nickname', nickname,
      'category', category, 'design', design_id, 'message', message_text
    )
    from app_private.get_public_chunk('2027', 0, 0)
    where x = 5 and y = 5
  ),
  jsonb_build_object(
    'kind', 'occupied', 'publicId', null, 'nickname', null,
    'category', null, 'design', null, 'message', null
  ),
  'hidden chunk cells expose only occupancy'
);
select extensions.is(
  (select message_text from app_private.get_public_chunk('2027', 0, 0) where x = 0 and y = 0),
  null::text,
  'owner-only content is null in a listed chunk cell'
);
select extensions.is(
  (select count(*) from app_private.get_public_chunk('2027', 0, 0)),
  3::bigint,
  'chunk output includes every occupied cell and stays bounded by 400'
);
select extensions.ok(
  (select count(*) from app_private.get_public_chunk('2027', 0, 0)) <= 400,
  'chunk output cannot exceed the 20 by 20 cell limit'
);
select extensions.is(
  (select count(*) from app_private.get_public_chunk('9999', 0, 0)),
  0::bigint,
  'unknown world chunk retrieval returns no cells'
);
select extensions.is(
  (select count(*) from app_private.get_public_overview('9999', 20)),
  0::bigint,
  'unknown world overview retrieval returns no cells'
);
select extensions.is(
  (select count(*) from app_private.list_public_emas('2027', 24, null, null, null)),
  2::bigint,
  'newest feed lists active public emas only'
);
select extensions.ok(
  (
    select position(
      'UNLISTED_SECRET_STAGE_D' in coalesce(jsonb_agg(to_jsonb(feed))::text, '[]')
    ) = 0
    from app_private.list_public_emas('2027', 24, null, null, null) as feed
  ),
  'newest feed never serializes unlisted content'
);
select extensions.ok(
  (
    select position(
      'OWNER_ONLY_SECRET_STAGE_D' in coalesce(jsonb_agg(to_jsonb(cell))::text, '[]')
    ) = 0
    from app_private.get_public_chunk('2027', 0, 0) as cell
  ),
  'chunk output never serializes owner-only content'
);
select extensions.ok(
  (
    select position(
      'HIDDEN_SECRET_STAGE_D' in coalesce(jsonb_agg(to_jsonb(cell))::text, '[]')
    ) = 0
    from app_private.get_public_chunk('2027', 0, 0) as cell
  ),
  'chunk output never serializes hidden content'
);
select extensions.is(
  (select count(*) from app_private.list_public_emas('2027', 24, 'study', null, null)),
  1::bigint,
  'feed category filtering keeps the public condition'
);
select extensions.is(
  (
    with first_page as (
      select * from app_private.list_public_emas('2027', 1, null, null, null)
    )
    select count(*)
    from first_page
    cross join lateral app_private.list_public_emas(
      '2027', 1, null, first_page.created_at, first_page.public_id
    ) as next_page
  ),
  1::bigint,
  'newest feed uses bounded keyset pagination'
);
select extensions.is(
  (
    select pg_catalog.to_char(
      created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
    from app_private.list_public_emas('2027', 1, null, null, null)
  ),
  '2026-01-01T00:00:00.123789Z'::text,
  'keyset boundary preserves distinct microseconds within one millisecond'
);
select extensions.is(
  (select count(*) from app_private.get_random_public_ema(
    '2027', 'other', '00000000-0000-4000-8000-000000000000'
  )),
  0::bigint,
  'random discovery excludes unlisted and hidden candidates'
);
select extensions.is(
  (select category from app_private.get_random_public_ema(
    '2027', 'study', 'ffffffff-ffff-4fff-bfff-ffffffffffff'
  )),
  'study'::text,
  'random discovery wraps its UUID pivot with a bounded indexed query'
);
select extensions.is(
  (select message_text from app_private.get_random_public_ema(
    '2027', 'health', '00000000-0000-4000-8000-000000000000'
  )),
  null::text,
  'random discovery keeps owner-only content null'
);
select extensions.throws_ok(
  $$select * from app_private.get_random_public_ema(
    '2027', 'invalid', '00000000-0000-4000-8000-000000000000'
  )$$,
  'P1002', 'VALIDATION_ERROR', 'random discovery rejects unknown categories'
);
select extensions.throws_ok(
  $$select * from app_private.get_public_chunk_meta('2027', 50, 0)$$,
  'P1002', 'VALIDATION_ERROR', 'chunk metadata rejects out-of-range coordinates'
);
select extensions.throws_ok(
  $$select * from app_private.get_public_chunk('2027', -1, 0)$$,
  'P1002', 'VALIDATION_ERROR', 'chunk cells reject out-of-range coordinates'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_random_public_ema(
      '9999', null, '00000000-0000-4000-8000-000000000000'
    )
  ),
  0::bigint,
  'random discovery returns no item for an unknown world'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_random_public_ema(
      '2027', null, '00000000-0000-4000-8000-000000000000'
    )
  ),
  1::bigint,
  'random discovery returns at most one listed item'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_public_overview('2027', 20)
    where listed_count > active_count or active_count > occupied_count
  ),
  0::bigint,
  'all overview cells preserve count ordering'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_public_chunk('2027', 0, 0)
    where kind = 'occupied'
      and (
        public_id is not null or nickname is not null or category is not null
        or design_id is not null or message_visibility is not null
        or message_text is not null or version is not null
      )
  ),
  0::bigint,
  'all occupied placeholders are identifier-free fixed DTOs'
);

reset role;
select * from extensions.finish();
rollback;
