-- Stage E: bounded nearby-slot discovery for public invitation links.
-- The function is kept in the non-exposed schema and can only be executed by
-- the limited BFF role. Its owner is NOBYPASSRLS, so direct unlisted lookup is
-- still gated by the transaction-local lookup UUID used by Stage B.

grant emanowa_owner to session_user;

create or replace function app_private.get_nearby_slots(
  p_world_slug text,
  p_near_public_id uuid,
  p_x integer,
  p_y integer
)
returns table (
  origin_x integer,
  origin_y integer,
  searched_radius integer,
  candidate_x integer,
  candidate_y integer,
  slot_number integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  target_world_id uuid;
  target_x integer;
  target_y integer;
begin
  if (p_near_public_id is null) = (p_x is null and p_y is null)
    or ((p_x is null) <> (p_y is null))
    or (p_x is not null and (p_x not between 0 and 999 or p_y not between 0 and 999))
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  if p_near_public_id is not null then
    select world.id, projection.x, projection.y
      into target_world_id, target_x, target_y
    from app_private.worlds as world
    join app_private.ema_public_projection as projection
      on projection.world_id = world.id
    where world.slug = p_world_slug
      and projection.public_id = p_near_public_id;
  else
    select world.id, p_x, p_y
      into target_world_id, target_x, target_y
    from app_private.worlds as world
    where world.slug = p_world_slug;
  end if;

  if target_world_id is null then
    return;
  end if;

  return query
  with available as (
    select
      candidate.x,
      candidate.y,
      candidate.y * 1000 + candidate.x + 1 as slot_number,
      greatest(
        pg_catalog.abs(candidate.x - target_x),
        pg_catalog.abs(candidate.y - target_y)
      ) as chebyshev_distance,
      (candidate.x - target_x) * (candidate.x - target_x)
        + (candidate.y - target_y) * (candidate.y - target_y)
        as distance_squared
    from pg_catalog.generate_series(
      greatest(0, target_x - 20),
      least(999, target_x + 20)
    ) as candidate_x(x)
    cross join pg_catalog.generate_series(
      greatest(0, target_y - 20),
      least(999, target_y + 20)
    ) as candidate_y(y)
    cross join lateral (
      select candidate_x.x, candidate_y.y
    ) as candidate
    left join app_private.slot_occupancy as occupancy
      on occupancy.world_id = target_world_id
      and occupancy.x = candidate.x
      and occupancy.y = candidate.y
    where occupancy.ema_id is null
  ), chosen_radius as (
    select case
      when pg_catalog.count(*) filter (where chebyshev_distance <= 3) >= 8 then 3
      when pg_catalog.count(*) filter (where chebyshev_distance <= 8) >= 8 then 8
      else 20
    end::integer as radius
    from available
  ), chosen_candidates as (
    select available.x, available.y, available.slot_number,
      available.distance_squared
    from available
    cross join chosen_radius
    where available.chebyshev_distance <= chosen_radius.radius
    order by available.distance_squared, available.slot_number
    limit 8
  )
  select
    target_x,
    target_y,
    chosen_radius.radius,
    chosen_candidates.x,
    chosen_candidates.y,
    chosen_candidates.slot_number
  from chosen_radius
  left join chosen_candidates on true
  order by chosen_candidates.distance_squared nulls last,
    chosen_candidates.slot_number nulls last;
end
$function$;

alter function app_private.get_nearby_slots(text, uuid, integer, integer)
  owner to emanowa_owner;

revoke all on function app_private.get_nearby_slots(text, uuid, integer, integer)
  from public, anon, authenticated, service_role, emanowa_app;
grant execute on function app_private.get_nearby_slots(text, uuid, integer, integer)
  to emanowa_app;

comment on function app_private.get_nearby_slots(text, uuid, integer, integer)
  is 'Returns at most eight currently empty nearby slots within a bounded 41x41 search area; candidates are not reservations.';

revoke emanowa_owner from session_user;
