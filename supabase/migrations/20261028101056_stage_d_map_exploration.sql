-- Stage D: bounded map overview, chunk metadata, and indexed random discovery.
-- All functions stay in the non-exposed schema and are executable only by the
-- limited BFF role. The object owner is NOBYPASSRLS and all source tables FORCE
-- RLS, preserving the Stage B access boundary.

grant emanowa_owner to session_user;

create index ema_public_random_idx
  on app_private.ema_public_projection (world_id, public_id)
  where visibility = 'public';

create index ema_public_category_random_idx
  on app_private.ema_public_projection (world_id, category, public_id)
  where visibility = 'public';

create index slot_occupancy_chunk_idx
  on app_private.slot_occupancy (
    world_id,
    (x / 20),
    (y / 20),
    y,
    x
  );

create or replace function app_private.get_public_chunk(
  p_world_slug text,
  p_cx integer,
  p_cy integer
)
returns table (
  kind text,
  public_id uuid,
  world_slug text,
  x integer,
  y integer,
  slot_number integer,
  nickname text,
  category text,
  design_id text,
  visibility text,
  message_visibility text,
  message_text text,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_cx not between 0 and 49 or p_cy not between 0 and 49 then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  return query
  select
    case when projection.public_id is null then 'occupied' else 'public' end,
    projection.public_id,
    world.slug,
    occupancy.x,
    occupancy.y,
    occupancy.y * 1000 + occupancy.x + 1,
    projection.nickname,
    projection.category,
    projection.design_id,
    projection.visibility,
    projection.message_visibility,
    projection.message_text,
    projection.version,
    projection.created_at,
    projection.updated_at
  from app_private.worlds as world
  join app_private.slot_occupancy as occupancy on occupancy.world_id = world.id
  left join app_private.ema_public_projection as projection
    on projection.ema_id = occupancy.ema_id
    -- Keep the public boundary explicit and independent of any lookup GUC
    -- left behind by another function on the same pooled connection.
    and projection.visibility = 'public'
  where world.slug = p_world_slug
    and occupancy.x / 20 = p_cx
    and occupancy.y / 20 = p_cy
  order by occupancy.y, occupancy.x;
end
$function$;

create or replace function app_private.get_public_overview(
  p_world_slug text,
  p_cell_size integer
)
returns table (
  world_slug text,
  cell_size integer,
  x integer,
  y integer,
  occupied_count bigint,
  active_count bigint,
  listed_count bigint,
  as_of timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_cell_size not in (20, 100) then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  return query
  select
    world.slug,
    p_cell_size,
    ((chunk.cx * 20) / p_cell_size) * p_cell_size,
    ((chunk.cy * 20) / p_cell_size) * p_cell_size,
    sum(chunk.occupied_count)::bigint,
    sum(chunk.active_count)::bigint,
    sum(chunk.listed_count)::bigint,
    max(chunk.updated_at)
  from app_private.worlds as world
  join app_private.world_chunks as chunk on chunk.world_id = world.id
  where world.slug = p_world_slug
    and chunk.occupied_count > 0
  group by
    world.slug,
    ((chunk.cx * 20) / p_cell_size),
    ((chunk.cy * 20) / p_cell_size)
  order by
    ((chunk.cy * 20) / p_cell_size),
    ((chunk.cx * 20) / p_cell_size);
end
$function$;

create or replace function app_private.get_public_chunk_meta(
  p_world_slug text,
  p_cx integer,
  p_cy integer
)
returns table (
  world_slug text,
  cx integer,
  cy integer,
  revision bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_cx not between 0 and 49 or p_cy not between 0 and 49 then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  return query
  select
    world.slug,
    p_cx,
    p_cy,
    coalesce(chunk.revision, 0)::bigint
  from app_private.worlds as world
  left join app_private.world_chunks as chunk
    on chunk.world_id = world.id
    and chunk.cx = p_cx
    and chunk.cy = p_cy
  where world.slug = p_world_slug;
end
$function$;

create or replace function app_private.get_random_public_ema(
  p_world_slug text,
  p_category text,
  p_pivot uuid
)
returns table (
  public_id uuid,
  world_slug text,
  x integer,
  y integer,
  slot_number integer,
  nickname text,
  category text,
  design_id text,
  visibility text,
  message_visibility text,
  message_text text,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_pivot is null
    or (p_category is not null and p_category not in (
      'family', 'health', 'study', 'work', 'love', 'challenge', 'other'
    ))
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  perform pg_catalog.set_config('app.lookup_public_id', '', true);

  if p_category is null then
    return query
    select
      projection.public_id,
      world.slug,
      projection.x,
      projection.y,
      projection.slot_number,
      projection.nickname,
      projection.category,
      projection.design_id,
      projection.visibility,
      projection.message_visibility,
      projection.message_text,
      projection.version,
      projection.created_at,
      projection.updated_at
    from app_private.ema_public_projection as projection
    join app_private.worlds as world on world.id = projection.world_id
    where world.slug = p_world_slug
      and projection.visibility = 'public'
      and projection.public_id >= p_pivot
    order by projection.public_id
    limit 1;

    if found then
      return;
    end if;

    return query
    select
      projection.public_id,
      world.slug,
      projection.x,
      projection.y,
      projection.slot_number,
      projection.nickname,
      projection.category,
      projection.design_id,
      projection.visibility,
      projection.message_visibility,
      projection.message_text,
      projection.version,
      projection.created_at,
      projection.updated_at
    from app_private.ema_public_projection as projection
    join app_private.worlds as world on world.id = projection.world_id
    where world.slug = p_world_slug
      and projection.visibility = 'public'
    order by projection.public_id
    limit 1;
    return;
  end if;

  return query
  select
    projection.public_id,
    world.slug,
    projection.x,
    projection.y,
    projection.slot_number,
    projection.nickname,
    projection.category,
    projection.design_id,
    projection.visibility,
    projection.message_visibility,
    projection.message_text,
    projection.version,
    projection.created_at,
    projection.updated_at
  from app_private.ema_public_projection as projection
  join app_private.worlds as world on world.id = projection.world_id
  where world.slug = p_world_slug
    and projection.visibility = 'public'
    and projection.category = p_category
    and projection.public_id >= p_pivot
  order by projection.public_id
  limit 1;

  if found then
    return;
  end if;

  return query
  select
    projection.public_id,
    world.slug,
    projection.x,
    projection.y,
    projection.slot_number,
    projection.nickname,
    projection.category,
    projection.design_id,
    projection.visibility,
    projection.message_visibility,
    projection.message_text,
    projection.version,
    projection.created_at,
    projection.updated_at
  from app_private.ema_public_projection as projection
  join app_private.worlds as world on world.id = projection.world_id
  where world.slug = p_world_slug
    and projection.visibility = 'public'
    and projection.category = p_category
  order by projection.public_id
  limit 1;
end
$function$;

alter function app_private.get_public_overview(text, integer) owner to emanowa_owner;
alter function app_private.get_public_chunk_meta(text, integer, integer) owner to emanowa_owner;
alter function app_private.get_random_public_ema(text, text, uuid) owner to emanowa_owner;

revoke all on function app_private.get_public_overview(text, integer)
  from public, anon, authenticated, service_role, emanowa_app;
revoke all on function app_private.get_public_chunk_meta(text, integer, integer)
  from public, anon, authenticated, service_role, emanowa_app;
revoke all on function app_private.get_random_public_ema(text, text, uuid)
  from public, anon, authenticated, service_role, emanowa_app;

grant execute on function app_private.get_public_overview(text, integer)
  to emanowa_app;
grant execute on function app_private.get_public_chunk_meta(text, integer, integer)
  to emanowa_app;
grant execute on function app_private.get_random_public_ema(text, text, uuid)
  to emanowa_app;

revoke emanowa_owner from session_user;
