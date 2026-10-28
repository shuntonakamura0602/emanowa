-- Stage B: private P0 schema, RLS boundaries, and atomic placement contract.
-- app_private is intentionally absent from Supabase Data API exposed schemas.

create extension if not exists pgcrypto with schema extensions;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'emanowa_owner') then
    create role emanowa_owner
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  else
    alter role emanowa_owner
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'emanowa_app') then
    create role emanowa_app
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  else
    alter role emanowa_app
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$roles$;

-- Supabase applies migrations as a constrained administrator. Membership is
-- needed only while ownership is assigned and is revoked at the end.
grant emanowa_owner to session_user;

alter role emanowa_app set statement_timeout = '8s';
alter role emanowa_app set lock_timeout = '3s';
alter role emanowa_app set idle_in_transaction_session_timeout = '10s';

create schema if not exists app_private authorization emanowa_owner;
alter schema app_private owner to emanowa_owner;

revoke all on schema app_private from public, anon, authenticated, service_role;
grant usage on schema app_private to emanowa_app;
grant usage on schema extensions to emanowa_owner;
grant execute on function extensions.digest(text, text) to emanowa_owner;

create table app_private.worlds (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  state text not null,
  posting_enabled boolean not null default true,
  width integer not null default 1000,
  height integer not null default 1000,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint worlds_slug_check check (slug ~ '^[0-9]{4}$'),
  constraint worlds_name_check check (length(btrim(name)) between 1 and 100),
  constraint worlds_state_check check (state in ('preview', 'open', 'archived')),
  constraint worlds_dimensions_check check (width = 1000 and height = 1000),
  constraint worlds_period_check check (opens_at < closes_at)
);

create table app_private.emas (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  world_id uuid not null references app_private.worlds(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  x integer not null,
  y integer not null,
  slot_number integer generated always as (y * 1000 + x + 1) stored,
  wish_text text,
  nickname text,
  category text not null,
  design_id text not null default 'basic_wood',
  visibility text not null,
  message_visibility text not null,
  status text not null default 'active',
  version integer not null default 1,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  deleted_at timestamptz,
  constraint emas_public_id_v4_check check (
    public_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint emas_xy_check check (x between 0 and 999 and y between 0 and 999),
  constraint emas_slot_number_check check (slot_number between 1 and 1000000),
  constraint emas_wish_bytes_check check (wish_text is null or octet_length(wish_text) <= 4096),
  constraint emas_wish_lines_check check (
    wish_text is null or length(wish_text) - length(replace(wish_text, E'\n', '')) <= 3
  ),
  constraint emas_nickname_check check (
    nickname is null or (octet_length(nickname) <= 1024 and position(E'\n' in nickname) = 0)
  ),
  constraint emas_category_check check (
    category in ('family', 'health', 'study', 'work', 'love', 'challenge', 'other')
  ),
  constraint emas_design_check check (design_id = 'basic_wood'),
  constraint emas_visibility_check check (visibility in ('public', 'unlisted')),
  constraint emas_message_visibility_check check (message_visibility in ('public', 'owner_only')),
  constraint emas_status_check check (status in ('active', 'hidden', 'deleted')),
  constraint emas_version_check check (version >= 1),
  constraint emas_timestamps_check check (updated_at >= created_at),
  constraint emas_live_or_deleted_check check (
    (
      status in ('active', 'hidden')
      and wish_text is not null
      and length(btrim(wish_text)) > 0
      and deleted_at is null
    )
    or (
      status = 'deleted'
      and wish_text is null
      and nickname is null
      and deleted_at is not null
    )
  ),
  constraint emas_identity_position_uq unique (id, world_id, x, y),
  constraint emas_public_identity_position_uq unique (id, public_id, world_id, x, y)
);

create unique index emas_live_slot_uq
  on app_private.emas (world_id, y, x)
  where status in ('active', 'hidden');
create unique index emas_live_owner_uq
  on app_private.emas (world_id, owner_id)
  where status in ('active', 'hidden');
create index emas_world_owner_idx on app_private.emas (world_id, owner_id);
create index emas_owner_id_idx on app_private.emas (owner_id);

create table app_private.ema_public_projection (
  ema_id bigint primary key references app_private.emas(id) on delete cascade,
  public_id uuid not null unique,
  world_id uuid not null references app_private.worlds(id) on delete cascade,
  x integer not null,
  y integer not null,
  slot_number integer not null,
  nickname text,
  category text not null,
  design_id text not null,
  visibility text not null,
  message_visibility text not null,
  message_text text,
  version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint ema_public_projection_xy_check check (x between 0 and 999 and y between 0 and 999),
  constraint ema_public_projection_slot_check check (
    slot_number = y * 1000 + x + 1 and slot_number between 1 and 1000000
  ),
  constraint ema_public_projection_category_check check (
    category in ('family', 'health', 'study', 'work', 'love', 'challenge', 'other')
  ),
  constraint ema_public_projection_design_check check (design_id = 'basic_wood'),
  constraint ema_public_projection_visibility_check check (visibility in ('public', 'unlisted')),
  constraint ema_public_projection_message_visibility_check check (
    message_visibility in ('public', 'owner_only')
  ),
  constraint ema_public_projection_message_check check (
    (message_visibility = 'owner_only' and message_text is null)
    or (
      message_visibility = 'public'
      and message_text is not null
      and length(btrim(message_text)) > 0
      and octet_length(message_text) <= 4096
    )
  ),
  constraint ema_public_projection_version_check check (version >= 1),
  constraint ema_public_projection_timestamps_check check (updated_at >= created_at),
  constraint ema_public_projection_identity_position_fkey
    foreign key (ema_id, public_id, world_id, x, y)
    references app_private.emas (id, public_id, world_id, x, y)
    on delete cascade
);

create index ema_public_projection_world_xy_idx
  on app_private.ema_public_projection (world_id, y, x);
create index ema_public_feed_idx
  on app_private.ema_public_projection (world_id, created_at desc, public_id desc)
  where visibility = 'public';
create index ema_public_category_feed_idx
  on app_private.ema_public_projection (world_id, category, created_at desc, public_id desc)
  where visibility = 'public';

create table app_private.slot_occupancy (
  world_id uuid not null references app_private.worlds(id) on delete cascade,
  x integer not null,
  y integer not null,
  ema_id bigint not null unique references app_private.emas(id) on delete cascade,
  primary key (world_id, x, y),
  constraint slot_occupancy_xy_check check (x between 0 and 999 and y between 0 and 999),
  constraint slot_occupancy_identity_position_fkey
    foreign key (ema_id, world_id, x, y)
    references app_private.emas (id, world_id, x, y)
    on delete cascade
);

create table app_private.world_chunks (
  world_id uuid not null references app_private.worlds(id) on delete cascade,
  cx integer not null,
  cy integer not null,
  occupied_count integer not null default 0,
  active_count integer not null default 0,
  listed_count integer not null default 0,
  revision bigint not null default 0,
  updated_at timestamptz not null default transaction_timestamp(),
  primary key (world_id, cx, cy),
  constraint world_chunks_coordinates_check check (cx between 0 and 49 and cy between 0 and 49),
  constraint world_chunks_counts_check check (
    listed_count between 0 and 400
    and active_count between 0 and 400
    and occupied_count between 0 and 400
    and listed_count <= active_count
    and active_count <= occupied_count
  ),
  constraint world_chunks_revision_check check (revision >= 0)
);

create table app_private.idempotency_records (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  operation text not null,
  key_hash bytea not null,
  request_hash bytea not null,
  result_public_id uuid references app_private.emas(public_id) on delete restrict,
  result_version integer,
  receipt_json jsonb not null,
  http_status integer not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint idempotency_operation_check check (length(operation) between 1 and 200),
  constraint idempotency_key_hash_check check (octet_length(key_hash) = 32),
  constraint idempotency_request_hash_check check (octet_length(request_hash) = 32),
  constraint idempotency_result_version_check check (result_version is null or result_version >= 1),
  constraint idempotency_receipt_check check (
    jsonb_typeof(receipt_json) = 'object'
    and receipt_json ?& array['publicId', 'worldSlug', 'version', 'result', 'canonicalUrl']
    and receipt_json - array['publicId', 'worldSlug', 'version', 'result', 'canonicalUrl'] = '{}'::jsonb
  ),
  constraint idempotency_http_status_check check (http_status between 200 and 299)
);

create unique index idempotency_owner_operation_key_uq
  on app_private.idempotency_records (owner_id, operation, key_hash);
create index idempotency_result_public_id_idx
  on app_private.idempotency_records (result_public_id)
  where result_public_id is not null;

create table app_private.reports (
  id uuid primary key default gen_random_uuid(),
  ema_id bigint not null references app_private.emas(id) on delete restrict,
  reporter_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  detail text,
  state text not null default 'open',
  version integer not null default 1,
  created_at timestamptz not null default transaction_timestamp(),
  resolved_at timestamptz,
  constraint reports_id_v4_check check (
    id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint reports_reason_check check (
    reason in ('spam', 'harassment', 'personal_information', 'sexual_content', 'illegal_content', 'other')
  ),
  constraint reports_detail_check check (detail is null or octet_length(detail) <= 2048),
  constraint reports_state_check check (state in ('open', 'resolved', 'dismissed')),
  constraint reports_version_check check (version >= 1),
  constraint reports_resolution_check check (
    (state = 'open' and resolved_at is null)
    or (state in ('resolved', 'dismissed') and resolved_at is not null)
  )
);

create unique index reports_open_reporter_ema_uq
  on app_private.reports (reporter_id, ema_id)
  where state = 'open';
create index reports_ema_id_idx on app_private.reports (ema_id);
create index reports_reporter_id_idx on app_private.reports (reporter_id);
create index reports_queue_idx on app_private.reports (state, created_at, id);

create table app_private.admin_users (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null default 'moderator',
  enabled boolean not null default true,
  created_at timestamptz not null default transaction_timestamp(),
  constraint admin_users_role_check check (role = 'moderator')
);

create table app_private.moderation_audit (
  id bigint generated always as identity primary key,
  admin_id uuid not null references app_private.admin_users(user_id) on delete restrict,
  ema_id bigint not null references app_private.emas(id) on delete restrict,
  action text not null,
  reason_code text not null,
  before_status text not null,
  after_status text not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint moderation_audit_action_check check (action in ('hide', 'restore', 'delete')),
  constraint moderation_audit_reason_check check (
    reason_code in ('spam', 'harassment', 'personal_information', 'sexual_content', 'illegal_content', 'other')
  ),
  constraint moderation_audit_before_status_check check (before_status in ('active', 'hidden')),
  constraint moderation_audit_after_status_check check (after_status in ('active', 'hidden', 'deleted'))
);

create index moderation_audit_admin_id_idx on app_private.moderation_audit (admin_id);
create index moderation_audit_ema_id_idx on app_private.moderation_audit (ema_id);
create index moderation_audit_created_at_idx on app_private.moderation_audit (created_at, id);

create table app_private.rate_limit_buckets (
  action text not null,
  subject_hash bytea not null,
  window_start timestamptz not null,
  count integer not null default 0,
  expires_at timestamptz not null,
  primary key (action, subject_hash, window_start),
  constraint rate_limit_action_check check (length(action) between 1 and 100),
  constraint rate_limit_subject_hash_check check (octet_length(subject_hash) = 32),
  constraint rate_limit_count_check check (count >= 0),
  constraint rate_limit_window_check check (expires_at > window_start)
);

create index rate_limit_expires_at_idx on app_private.rate_limit_buckets (expires_at);

-- The P0 world is product data, not only a development fixture. Insert it
-- before FORCE RLS is enabled so a remote db push does not depend on seed.sql.
insert into app_private.worlds (
  id,
  slug,
  name,
  state,
  posting_enabled,
  width,
  height,
  opens_at,
  closes_at
) values (
  '00000000-0000-4000-8000-000000002027'::uuid,
  '2027',
  '2027年のえまのわ',
  'preview',
  true,
  1000,
  1000,
  '2026-12-19T15:00:00Z'::timestamptz,
  '2027-12-31T15:00:00Z'::timestamptz
)
on conflict (slug) do nothing;

alter table app_private.worlds owner to emanowa_owner;
alter table app_private.emas owner to emanowa_owner;
alter table app_private.ema_public_projection owner to emanowa_owner;
alter table app_private.slot_occupancy owner to emanowa_owner;
alter table app_private.world_chunks owner to emanowa_owner;
alter table app_private.idempotency_records owner to emanowa_owner;
alter table app_private.reports owner to emanowa_owner;
alter table app_private.admin_users owner to emanowa_owner;
alter table app_private.moderation_audit owner to emanowa_owner;
alter table app_private.rate_limit_buckets owner to emanowa_owner;

alter table app_private.worlds enable row level security;
alter table app_private.worlds force row level security;
alter table app_private.emas enable row level security;
alter table app_private.emas force row level security;
alter table app_private.ema_public_projection enable row level security;
alter table app_private.ema_public_projection force row level security;
alter table app_private.slot_occupancy enable row level security;
alter table app_private.slot_occupancy force row level security;
alter table app_private.world_chunks enable row level security;
alter table app_private.world_chunks force row level security;
alter table app_private.idempotency_records enable row level security;
alter table app_private.idempotency_records force row level security;
alter table app_private.reports enable row level security;
alter table app_private.reports force row level security;
alter table app_private.admin_users enable row level security;
alter table app_private.admin_users force row level security;
alter table app_private.moderation_audit enable row level security;
alter table app_private.moderation_audit force row level security;
alter table app_private.rate_limit_buckets enable row level security;
alter table app_private.rate_limit_buckets force row level security;

create or replace function app_private.current_actor_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  actor_text text;
begin
  actor_text := nullif(pg_catalog.current_setting('app.actor_id', true), '');
  if actor_text is null then
    return null;
  end if;
  return actor_text::uuid;
exception
  when invalid_text_representation then
    return null;
end
$function$;

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
volatile
security definer
set search_path = ''
as $function$
begin
  if p_cx not between 0 and 49 or p_cy not between 0 and 49 then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  perform pg_catalog.set_config('app.lookup_public_id', '', true);

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
    and projection.visibility = 'public'
  where world.slug = p_world_slug
    and occupancy.x between p_cx * 20 and p_cx * 20 + 19
    and occupancy.y between p_cy * 20 and p_cy * 20 + 19
  order by occupancy.y, occupancy.x;
end
$function$;

create or replace function app_private.get_owner_ema(p_world_slug text)
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
  wish_text text,
  status text,
  version integer,
  created_at timestamptz,
  updated_at timestamptz,
  edit_content boolean,
  visibility_mode text,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
begin
  actor_id := app_private.current_actor_id();
  if actor_id is null then
    raise exception using errcode = 'P1001', message = 'AUTH_REQUIRED';
  end if;

  return query
  select
    ema.public_id,
    world.slug,
    ema.x,
    ema.y,
    ema.slot_number,
    ema.nickname,
    ema.category,
    ema.design_id,
    ema.visibility,
    ema.message_visibility,
    ema.wish_text,
    ema.status,
    ema.version,
    ema.created_at,
    ema.updated_at,
    ema.status = 'active'
      and world.state = 'open'
      and transaction_timestamp() >= world.opens_at
      and transaction_timestamp() < world.closes_at,
    case
      when ema.status = 'active'
        and world.state = 'open'
        and transaction_timestamp() >= world.opens_at
        and transaction_timestamp() < world.closes_at
        then 'all'
      else 'restrict_only'
    end,
    true
  from app_private.emas as ema
  join app_private.worlds as world on world.id = ema.world_id
  where world.slug = p_world_slug
    and ema.owner_id = actor_id
    and ema.status in ('active', 'hidden');
end
$function$;

create or replace function app_private.get_public_world(p_world_slug text)
returns table (
  world_slug text,
  world_name text,
  world_state text,
  width integer,
  height integer,
  opens_at timestamptz,
  closes_at timestamptz,
  accepting_posts boolean,
  occupied_count bigint,
  active_count bigint,
  listed_count bigint,
  stats_as_of timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    world.slug,
    world.name,
    world.state,
    world.width,
    world.height,
    world.opens_at,
    world.closes_at,
    world.state = 'open'
      and world.posting_enabled
      and transaction_timestamp() >= world.opens_at
      and transaction_timestamp() < world.closes_at,
    coalesce(stats.occupied_count, 0::bigint),
    coalesce(stats.active_count, 0::bigint),
    coalesce(stats.listed_count, 0::bigint),
    coalesce(stats.as_of, world.created_at)
  from app_private.worlds as world
  left join lateral (
    select
      sum(chunk.occupied_count)::bigint as occupied_count,
      sum(chunk.active_count)::bigint as active_count,
      sum(chunk.listed_count)::bigint as listed_count,
      max(chunk.updated_at) as as_of
    from app_private.world_chunks as chunk
    where chunk.world_id = world.id
  ) as stats on true
  where world.slug = p_world_slug
$function$;

create or replace function app_private.get_public_ema(
  p_world_slug text,
  p_public_id uuid
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
  perform pg_catalog.set_config('app.lookup_public_id', p_public_id::text, true);

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
    and projection.public_id = p_public_id;
end
$function$;

create or replace function app_private.list_public_emas(
  p_world_slug text,
  p_limit integer default 24,
  p_category text default null,
  p_before_created_at timestamptz default null,
  p_before_public_id uuid default null
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
  if p_limit not between 1 and 50
    or (p_category is not null and p_category not in ('family', 'health', 'study', 'work', 'love', 'challenge', 'other'))
    or ((p_before_created_at is null) <> (p_before_public_id is null))
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  perform pg_catalog.set_config('app.lookup_public_id', '', true);

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
    and (p_category is null or projection.category = p_category)
    and (
      p_before_created_at is null
      or (projection.created_at, projection.public_id) < (p_before_created_at, p_before_public_id)
    )
  order by projection.created_at desc, projection.public_id desc
  limit p_limit;
end
$function$;

create or replace function app_private.current_lookup_public_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  lookup_text text;
begin
  lookup_text := nullif(pg_catalog.current_setting('app.lookup_public_id', true), '');
  if lookup_text is null then
    return null;
  end if;
  return lookup_text::uuid;
exception
  when invalid_text_representation then
    return null;
end
$function$;

alter function app_private.current_actor_id() owner to emanowa_owner;
alter function app_private.current_lookup_public_id() owner to emanowa_owner;

create policy worlds_owner_select on app_private.worlds
  for select to emanowa_owner using (true);

create policy emas_owner_select on app_private.emas
  for select to emanowa_owner
  using (owner_id = (select app_private.current_actor_id()));
create policy emas_owner_insert on app_private.emas
  for insert to emanowa_owner
  with check (
    (select app_private.current_actor_id()) is not null
    and owner_id = (select app_private.current_actor_id())
  );
create policy emas_owner_update on app_private.emas
  for update to emanowa_owner
  using (owner_id = (select app_private.current_actor_id()))
  with check (owner_id = (select app_private.current_actor_id()));

create policy ema_public_projection_owner_select on app_private.ema_public_projection
  for select to emanowa_owner
  using (
    visibility = 'public'
    or (
      visibility = 'unlisted'
      and public_id = (select app_private.current_lookup_public_id())
    )
  );
create policy ema_public_projection_owner_insert on app_private.ema_public_projection
  for insert to emanowa_owner with check (true);
create policy ema_public_projection_owner_update on app_private.ema_public_projection
  for update to emanowa_owner using (true) with check (true);
create policy ema_public_projection_owner_delete on app_private.ema_public_projection
  for delete to emanowa_owner using (true);

create policy slot_occupancy_owner_all on app_private.slot_occupancy
  for all to emanowa_owner using (true) with check (true);
create policy world_chunks_owner_all on app_private.world_chunks
  for all to emanowa_owner using (true) with check (true);

create policy idempotency_owner_select on app_private.idempotency_records
  for select to emanowa_owner
  using (owner_id = (select app_private.current_actor_id()));
create policy idempotency_owner_insert on app_private.idempotency_records
  for insert to emanowa_owner
  with check (owner_id = (select app_private.current_actor_id()));

create policy reports_owner_select on app_private.reports
  for select to emanowa_owner
  using (reporter_id = (select app_private.current_actor_id()));
create policy reports_owner_insert on app_private.reports
  for insert to emanowa_owner
  with check (reporter_id = (select app_private.current_actor_id()));
create policy reports_owner_update on app_private.reports
  for update to emanowa_owner
  using (reporter_id = (select app_private.current_actor_id()))
  with check (reporter_id = (select app_private.current_actor_id()));

create or replace function app_private.create_ema(
  p_world_slug text,
  p_x integer,
  p_y integer,
  p_wish_text text,
  p_nickname text,
  p_category text,
  p_design_id text,
  p_visibility text,
  p_message_visibility text,
  p_idempotency_key uuid,
  p_request_hash bytea
)
returns table (
  public_id uuid,
  world_slug text,
  version integer,
  result text,
  canonical_url text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  target_world app_private.worlds%rowtype;
  operation_name text;
  key_digest bytea;
  existing_request_hash bytea;
  existing_receipt jsonb;
  new_ema_id bigint;
  new_public_id uuid := gen_random_uuid();
  new_version integer := 1;
  receipt jsonb;
  violated_constraint text;
  normalized_nickname text;
begin
  actor_id := app_private.current_actor_id();
  if actor_id is null then
    raise exception using errcode = 'P1001', message = 'AUTH_REQUIRED';
  end if;

  if p_world_slug is null
    or p_x not between 0 and 999
    or p_y not between 0 and 999
    or p_wish_text is null
    or length(btrim(p_wish_text)) = 0
    or octet_length(p_wish_text) > 4096
    or length(p_wish_text) - length(replace(p_wish_text, E'\n', '')) > 3
    or (p_nickname is not null and (octet_length(p_nickname) > 1024 or position(E'\n' in p_nickname) > 0))
    or p_category not in ('family', 'health', 'study', 'work', 'love', 'challenge', 'other')
    or p_design_id <> 'basic_wood'
    or p_visibility not in ('public', 'unlisted')
    or p_message_visibility not in ('public', 'owner_only')
    or p_idempotency_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_hash is null
    or octet_length(p_request_hash) <> 32
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  normalized_nickname := nullif(btrim(p_nickname), '');
  operation_name := 'create_ema:' || p_world_slug;
  key_digest := extensions.digest(p_idempotency_key::text, 'sha256');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || operation_name || ':' || p_idempotency_key::text, 0)
  );

  select record.request_hash, record.receipt_json
    into existing_request_hash, existing_receipt
  from app_private.idempotency_records as record
  where record.owner_id = actor_id
    and record.operation = operation_name
    and record.key_hash = key_digest;

  if found then
    if existing_request_hash <> p_request_hash then
      raise exception using errcode = 'P1005', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;

    return query select
      (existing_receipt ->> 'publicId')::uuid,
      existing_receipt ->> 'worldSlug',
      (existing_receipt ->> 'version')::integer,
      existing_receipt ->> 'result',
      existing_receipt ->> 'canonicalUrl',
      true;
    return;
  end if;

  select world.* into target_world
  from app_private.worlds as world
  where world.slug = p_world_slug
  for share;

  if not found
    or target_world.state <> 'open'
    or transaction_timestamp() < target_world.opens_at
    or transaction_timestamp() >= target_world.closes_at
  then
    raise exception using errcode = 'P1003', message = 'WORLD_NOT_OPEN';
  end if;

  if not target_world.posting_enabled then
    raise exception using errcode = 'P1004', message = 'POSTING_PAUSED';
  end if;

  begin
    insert into app_private.emas (
      public_id,
      world_id,
      owner_id,
      x,
      y,
      wish_text,
      nickname,
      category,
      design_id,
      visibility,
      message_visibility,
      status,
      version
    ) values (
      new_public_id,
      target_world.id,
      actor_id,
      p_x,
      p_y,
      p_wish_text,
      normalized_nickname,
      p_category,
      p_design_id,
      p_visibility,
      p_message_visibility,
      'active',
      new_version
    ) returning id into new_ema_id;
  exception
    when unique_violation then
      get stacked diagnostics violated_constraint = constraint_name;
      if violated_constraint = 'emas_live_owner_uq' then
        raise exception using errcode = 'P1006', message = 'OWNER_LIMIT_REACHED';
      elsif violated_constraint = 'emas_live_slot_uq' then
        raise exception using errcode = 'P1007', message = 'SLOT_TAKEN';
      else
        raise;
      end if;
  end;

  insert into app_private.slot_occupancy (world_id, x, y, ema_id)
  values (target_world.id, p_x, p_y, new_ema_id);

  insert into app_private.ema_public_projection (
    ema_id,
    public_id,
    world_id,
    x,
    y,
    slot_number,
    nickname,
    category,
    design_id,
    visibility,
    message_visibility,
    message_text,
    version,
    created_at,
    updated_at
  )
  select
    ema.id,
    ema.public_id,
    ema.world_id,
    ema.x,
    ema.y,
    ema.slot_number,
    ema.nickname,
    ema.category,
    ema.design_id,
    ema.visibility,
    ema.message_visibility,
    case when ema.message_visibility = 'public' then ema.wish_text else null end,
    ema.version,
    ema.created_at,
    ema.updated_at
  from app_private.emas as ema
  where ema.id = new_ema_id;

  insert into app_private.world_chunks (
    world_id,
    cx,
    cy,
    occupied_count,
    active_count,
    listed_count,
    revision,
    updated_at
  ) values (
    target_world.id,
    p_x / 20,
    p_y / 20,
    1,
    1,
    case when p_visibility = 'public' then 1 else 0 end,
    1,
    transaction_timestamp()
  )
  on conflict (world_id, cx, cy) do update set
    occupied_count = app_private.world_chunks.occupied_count + 1,
    active_count = app_private.world_chunks.active_count + 1,
    listed_count = app_private.world_chunks.listed_count + excluded.listed_count,
    revision = app_private.world_chunks.revision + 1,
    updated_at = excluded.updated_at;

  receipt := jsonb_build_object(
    'publicId', new_public_id::text,
    'worldSlug', target_world.slug,
    'version', new_version,
    'result', 'created',
    'canonicalUrl', '/w/' || target_world.slug || '/e/' || new_public_id::text
  );

  insert into app_private.idempotency_records (
    owner_id,
    operation,
    key_hash,
    request_hash,
    result_public_id,
    result_version,
    receipt_json,
    http_status
  ) values (
    actor_id,
    operation_name,
    key_digest,
    p_request_hash,
    new_public_id,
    new_version,
    receipt,
    201
  );

  return query select
    new_public_id,
    target_world.slug,
    new_version,
    'created'::text,
    '/w/' || target_world.slug || '/e/' || new_public_id::text,
    false;
end
$function$;

alter function app_private.create_ema(text, integer, integer, text, text, text, text, text, text, uuid, bytea)
  owner to emanowa_owner;
alter function app_private.get_public_world(text) owner to emanowa_owner;
alter function app_private.get_public_ema(text, uuid) owner to emanowa_owner;
alter function app_private.list_public_emas(text, integer, text, timestamptz, uuid) owner to emanowa_owner;
alter function app_private.get_public_chunk(text, integer, integer) owner to emanowa_owner;
alter function app_private.get_owner_ema(text) owner to emanowa_owner;

revoke all on all tables in schema app_private from public, anon, authenticated, service_role, emanowa_app;
revoke all on all sequences in schema app_private from public, anon, authenticated, service_role, emanowa_app;
revoke all on all functions in schema app_private from public, anon, authenticated, service_role, emanowa_app;

grant execute on function app_private.current_actor_id() to emanowa_app;
grant execute on function app_private.current_lookup_public_id() to emanowa_app;
grant execute on function app_private.create_ema(text, integer, integer, text, text, text, text, text, text, uuid, bytea)
  to emanowa_app;
grant execute on function app_private.get_public_world(text) to emanowa_app;
grant execute on function app_private.get_public_ema(text, uuid) to emanowa_app;
grant execute on function app_private.list_public_emas(text, integer, text, timestamptz, uuid) to emanowa_app;
grant execute on function app_private.get_public_chunk(text, integer, integer) to emanowa_app;
grant execute on function app_private.get_owner_ema(text) to emanowa_app;

alter default privileges for role emanowa_owner in schema app_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role emanowa_owner in schema app_private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role emanowa_owner in schema app_private
  revoke execute on functions from public, anon, authenticated, service_role;

comment on schema app_private is
  'Non-exposed Emanowa source-of-truth schema. Access only through the limited BFF role.';
comment on role emanowa_app is
  'NOLOGIN by default. Provision LOGIN and a secret out-of-band, then return to NOLOGIN when unused.';

revoke emanowa_owner from session_user;
