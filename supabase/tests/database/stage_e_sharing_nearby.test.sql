begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_catalog, public, extensions;
grant emanowa_owner, emanowa_app to session_user;
grant usage on schema extensions to emanowa_app;

select extensions.plan(30);

select extensions.ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'app_private'
      and tablename = 'worlds'
      and policyname = 'worlds_owner_update_lock'
      and cmd = 'UPDATE'
      and roles @> array['emanowa_owner'::name]
      and qual = 'true'
      and with_check = 'true'
  ),
  'world rows satisfy RLS when create_ema takes its FOR SHARE lock'
);

select extensions.ok(
  has_function_privilege(
    'emanowa_app',
    'app_private.get_nearby_slots(text,uuid,integer,integer)',
    'EXECUTE'
  ),
  'BFF role can execute bounded nearby discovery'
);
select extensions.ok(
  not has_function_privilege(
    'public',
    'app_private.get_nearby_slots(text,uuid,integer,integer)',
    'EXECUTE'
  ),
  'PUBLIC cannot execute nearby discovery directly'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'app_private.get_nearby_slots(text,uuid,integer,integer)',
    'EXECUTE'
  ),
  'anon cannot execute nearby discovery directly'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'app_private.get_nearby_slots(text,uuid,integer,integer)',
    'EXECUTE'
  ),
  'authenticated cannot execute nearby discovery directly'
);
select extensions.ok(
  not has_function_privilege(
    'service_role',
    'app_private.get_nearby_slots(text,uuid,integer,integer)',
    'EXECUTE'
  ),
  'service role cannot execute nearby discovery directly'
);
select extensions.ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig @> array['search_path=""']
      and procedure.prosrc not ilike '%set_config%'
    from pg_proc as procedure
    where procedure.oid =
      'app_private.get_nearby_slots(text,uuid,integer,integer)'::regprocedure
  ),
  'nearby discovery is a fixed-search-path stable security definer without GUC writes'
);
select extensions.ok(
  not (
    select role.rolbypassrls
    from pg_roles as role
    where role.rolname = 'emanowa_owner'
  ),
  'nearby function owner cannot bypass RLS'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('13000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'stage-e-public@example.test', now(), now()),
  ('13000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'stage-e-unlisted@example.test', now(), now()),
  ('13000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'stage-e-hidden@example.test', now(), now()),
  ('13000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'stage-e-deleted@example.test', now(), now()),
  ('13000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'stage-e-other-world@example.test', now(), now());

set local role emanowa_owner;
create policy stage_e_test_world_insert on app_private.worlds
  for insert to emanowa_owner with check (true);
create policy stage_e_test_ema_insert on app_private.emas
  for insert to emanowa_owner with check (true);
create policy stage_e_test_ema_select on app_private.emas
  for select to emanowa_owner using (true);

insert into app_private.worlds (
  id, slug, name, state, posting_enabled, width, height, opens_at, closes_at
) values (
  '00000000-0000-4000-8000-000000002028',
  '2028',
  '2028年のえまのわ',
  'preview',
  true,
  1000,
  1000,
  '2027-12-19T15:00:00Z',
  '2028-12-31T15:00:00Z'
);

insert into app_private.emas (
  public_id, world_id, owner_id, x, y, wish_text, nickname, category,
  design_id, visibility, message_visibility, status, deleted_at
)
values
  (
    '23000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000002027',
    '13000000-0000-4000-8000-000000000001',
    500, 500, 'OWNER_ONLY_SECRET_STAGE_E', 'Public target', 'health',
    'basic_wood', 'public', 'owner_only', 'active', null
  ),
  (
    '23000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000002027',
    '13000000-0000-4000-8000-000000000002',
    600, 600, 'UNLISTED_SECRET_STAGE_E', 'Unlisted target', 'other',
    'basic_wood', 'unlisted', 'public', 'active', null
  ),
  (
    '23000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000002027',
    '13000000-0000-4000-8000-000000000003',
    700, 700, 'HIDDEN_SECRET_STAGE_E', 'Hidden target', 'other',
    'basic_wood', 'public', 'public', 'hidden', null
  ),
  (
    '23000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000002027',
    '13000000-0000-4000-8000-000000000004',
    800, 800, null, null, 'other',
    'basic_wood', 'public', 'public', 'deleted', transaction_timestamp()
  ),
  (
    '23000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000002028',
    '13000000-0000-4000-8000-000000000005',
    500, 500, 'OTHER_WORLD_SECRET_STAGE_E', 'Other world', 'other',
    'basic_wood', 'public', 'public', 'active', null
  );

insert into app_private.ema_public_projection (
  ema_id, public_id, world_id, x, y, slot_number, nickname, category,
  design_id, visibility, message_visibility, message_text, version,
  created_at, updated_at
)
select
  ema.id, ema.public_id, ema.world_id, ema.x, ema.y, ema.slot_number,
  ema.nickname, ema.category, ema.design_id, ema.visibility,
  ema.message_visibility,
  case when ema.message_visibility = 'public' then ema.wish_text else null end,
  ema.version, ema.created_at, ema.updated_at
from app_private.emas as ema
where ema.public_id in (
  '23000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000002',
  '23000000-0000-4000-8000-000000000005'
);

insert into app_private.slot_occupancy (world_id, x, y, ema_id)
select ema.world_id, ema.x, ema.y, ema.id
from app_private.emas as ema
where ema.status in ('active', 'hidden');

reset role;
set local role emanowa_app;
select set_config('app.actor_id', '', true);
select set_config('app.lookup_public_id', '', true);

select extensions.is(
  (
    select jsonb_build_object('x', origin_x, 'y', origin_y, 'radius', searched_radius)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000001', null, null
    )
    limit 1
  ),
  jsonb_build_object('x', 500, 'y', 500, 'radius', 3),
  'a listed invitation resolves its origin without an authenticated actor'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000001', null, null
    )
    where candidate_x is not null
  ),
  8::bigint,
  'nearby discovery returns at most the requested eight candidates'
);
select extensions.is(
  (
    select jsonb_agg(
      jsonb_build_array(candidate_x, candidate_y, slot_number)
      order by candidate_order
    )
    from (
      select *, row_number() over () as candidate_order
      from app_private.get_nearby_slots(
        '2027', '23000000-0000-4000-8000-000000000001', null, null
      )
    ) as candidates
  ),
  jsonb_build_array(
    jsonb_build_array(500, 499, 499501),
    jsonb_build_array(499, 500, 500500),
    jsonb_build_array(501, 500, 500502),
    jsonb_build_array(500, 501, 501501),
    jsonb_build_array(499, 499, 499500),
    jsonb_build_array(501, 499, 499502),
    jsonb_build_array(499, 501, 501500),
    jsonb_build_array(501, 501, 501502)
  ),
  'candidates are ordered by squared distance and then slot number'
);
select extensions.ok(
  (
    select position(
      'OWNER_ONLY_SECRET_STAGE_E'
      in coalesce(jsonb_agg(to_jsonb(candidate))::text, '[]')
    ) = 0
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000001', null, null
    ) as candidate
  ),
  'nearby output never includes the invitation message or display metadata'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000002', null, null
    )
  ),
  0::bigint,
  'an unlisted target is not discoverable without the exact lookup UUID'
);
select set_config(
  'app.lookup_public_id',
  '23000000-0000-4000-8000-000000000002',
  true
);
select extensions.is(
  (
    select jsonb_build_array(origin_x, origin_y)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000002', null, null
    )
    limit 1
  ),
  jsonb_build_array(600, 600),
  'an exact unlisted invitation resolves without exposing its contents'
);
select set_config(
  'app.lookup_public_id',
  '23000000-0000-4000-8000-000000000001',
  true
);
select extensions.is(
  (
    select count(*)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000002', null, null
    )
  ),
  0::bigint,
  'a different lookup UUID cannot enumerate an unlisted invitation'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000003', null, null
    )
  ),
  0::bigint,
  'hidden invitations do not resolve'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000004', null, null
    )
  ),
  0::bigint,
  'deleted invitations do not resolve'
);
select extensions.is(
  (
    select count(*)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000005', null, null
    )
  ),
  0::bigint,
  'an invitation cannot cross world boundaries'
);
select set_config('app.lookup_public_id', '', true);
select extensions.is(
  (
    select jsonb_build_array(origin_x, origin_y, candidate_x, candidate_y)
    from app_private.get_nearby_slots('2027', null, 10, 20)
    limit 1
  ),
  jsonb_build_array(10, 20, 10, 20),
  'coordinate discovery may offer its empty origin as the first candidate'
);
select extensions.is(
  (select count(*) from app_private.get_nearby_slots('9999', null, 10, 20)),
  0::bigint,
  'an unknown world is distinct from an empty candidate set'
);
select extensions.throws_ok(
  $$select * from app_private.get_nearby_slots('2027', null, null, null)$$,
  'P1002', 'VALIDATION_ERROR', 'nearby discovery requires an origin mode'
);
select extensions.throws_ok(
  $$select * from app_private.get_nearby_slots(
    '2027', '23000000-0000-4000-8000-000000000001', 10, 20
  )$$,
  'P1002', 'VALIDATION_ERROR', 'nearby discovery rejects mixed origin modes'
);
select extensions.throws_ok(
  $$select * from app_private.get_nearby_slots('2027', null, 10, null)$$,
  'P1002', 'VALIDATION_ERROR', 'nearby discovery rejects partial coordinates'
);
select extensions.throws_ok(
  $$select * from app_private.get_nearby_slots('2027', null, -1, 20)$$,
  'P1002', 'VALIDATION_ERROR', 'nearby discovery rejects coordinates outside the world'
);
select extensions.ok(
  (
    select bool_and(
      candidate_x between 0 and 999 and candidate_y between 0 and 999
    )
    from app_private.get_nearby_slots('2027', null, 0, 0)
  ),
  'bounded discovery never returns coordinates outside a world corner'
);
reset role;
set local role emanowa_owner;
select extensions.is(
  (
    select count(*)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000001', null, null
    ) as candidate
    join app_private.slot_occupancy as occupancy
      on occupancy.world_id = '00000000-0000-4000-8000-000000002027'
      and occupancy.x = candidate.candidate_x
      and occupancy.y = candidate.candidate_y
  ),
  0::bigint,
  'every returned candidate is currently empty'
);

reset role;
create temporary table stage_e_radius_three_blockers on commit drop as
select
  x,
  y,
  row_number() over (order by y, x) as fixture_number
from pg_catalog.generate_series(497, 503) as xs(x)
cross join pg_catalog.generate_series(497, 503) as ys(y)
where not (x = 500 and y = 500);
grant select on stage_e_radius_three_blockers to emanowa_owner;

insert into auth.users (id, aud, role, email, created_at, updated_at)
select
  format(
    '31000000-0000-4000-8000-%s',
    lpad(fixture_number::text, 12, '0')
  )::uuid,
  'authenticated',
  'authenticated',
  format('stage-e-radius3-%s@example.test', fixture_number),
  now(),
  now()
from stage_e_radius_three_blockers;

set local role emanowa_owner;
insert into app_private.emas (
  public_id, world_id, owner_id, x, y, wish_text, nickname, category,
  design_id, visibility, message_visibility, status
)
select
  format(
    '41000000-0000-4000-8000-%s',
    lpad(fixture_number::text, 12, '0')
  )::uuid,
  '00000000-0000-4000-8000-000000002027',
  format(
    '31000000-0000-4000-8000-%s',
    lpad(fixture_number::text, 12, '0')
  )::uuid,
  x,
  y,
  'blocked',
  null,
  'other',
  'basic_wood',
  'public',
  'owner_only',
  'hidden'
from stage_e_radius_three_blockers;
insert into app_private.slot_occupancy (world_id, x, y, ema_id)
select ema.world_id, ema.x, ema.y, ema.id
from app_private.emas as ema
where ema.public_id::text like '41000000-0000-4000-8000-%';

reset role;
set local role emanowa_app;
select set_config('app.lookup_public_id', '', true);
select extensions.is(
  (
    select searched_radius
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000001', null, null
    )
    limit 1
  ),
  8,
  'search expands from radius three to radius eight when fewer than eight slots remain'
);
select extensions.is(
  (
    select count(candidate_x)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000001', null, null
    )
  ),
  8::bigint,
  'expanded search still returns no more than eight candidates'
);

reset role;
create temporary table stage_e_radius_twenty_blockers on commit drop as
select
  candidates.x,
  candidates.y,
  row_number() over (order by candidates.y, candidates.x) as fixture_number
from (
  select xs.x, ys.y
  from pg_catalog.generate_series(480, 520) as xs(x)
  cross join pg_catalog.generate_series(480, 520) as ys(y)
) as candidates
left join app_private.slot_occupancy as occupancy
  on occupancy.world_id = '00000000-0000-4000-8000-000000002027'
  and occupancy.x = candidates.x
  and occupancy.y = candidates.y
where occupancy.ema_id is null;
grant select on stage_e_radius_twenty_blockers to emanowa_owner;

insert into auth.users (id, aud, role, email, created_at, updated_at)
select
  format(
    '32000000-0000-4000-8000-%s',
    lpad(fixture_number::text, 12, '0')
  )::uuid,
  'authenticated',
  'authenticated',
  format('stage-e-radius20-%s@example.test', fixture_number),
  now(),
  now()
from stage_e_radius_twenty_blockers;

set local role emanowa_owner;
insert into app_private.emas (
  public_id, world_id, owner_id, x, y, wish_text, nickname, category,
  design_id, visibility, message_visibility, status
)
select
  format(
    '42000000-0000-4000-8000-%s',
    lpad(fixture_number::text, 12, '0')
  )::uuid,
  '00000000-0000-4000-8000-000000002027',
  format(
    '32000000-0000-4000-8000-%s',
    lpad(fixture_number::text, 12, '0')
  )::uuid,
  x,
  y,
  'blocked',
  null,
  'other',
  'basic_wood',
  'public',
  'owner_only',
  'hidden'
from stage_e_radius_twenty_blockers;
insert into app_private.slot_occupancy (world_id, x, y, ema_id)
select ema.world_id, ema.x, ema.y, ema.id
from app_private.emas as ema
where ema.public_id::text like '42000000-0000-4000-8000-%';

reset role;
set local role emanowa_app;
select extensions.is(
  (
    select searched_radius
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000001', null, null
    )
    limit 1
  ),
  20,
  'a saturated near area terminates at the bounded radius twenty'
);
select extensions.is(
  (
    select count(candidate_x)
    from app_private.get_nearby_slots(
      '2027', '23000000-0000-4000-8000-000000000001', null, null
    )
  ),
  0::bigint,
  'a saturated 41 by 41 area returns a finite empty candidate list'
);

reset role;
select * from extensions.finish();
rollback;
