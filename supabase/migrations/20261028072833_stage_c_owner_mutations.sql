-- Stage C: owner updates and deletion with optimistic concurrency,
-- idempotent receipts, and synchronous public-projection revocation.

grant emanowa_owner to session_user;

-- UPDATE needs a SELECT policy in addition to its UPDATE policy. Public reads
-- intentionally cannot enumerate unlisted projections, while an owner
-- mutation must still be able to update its own unlisted projection.
create policy ema_public_projection_owner_actor_select
  on app_private.ema_public_projection
  for select to emanowa_owner
  using (
    exists (
      select 1
      from app_private.emas as source_ema
      where source_ema.id = ema_id
        and source_ema.owner_id = (select app_private.current_actor_id())
    )
  );

create index emas_owner_live_updated_idx
  on app_private.emas (owner_id, updated_at desc, public_id desc)
  where status in ('active', 'hidden');

create or replace function app_private.update_ema(
  p_public_id uuid,
  p_expected_version integer,
  p_has_wish_text boolean,
  p_wish_text text,
  p_has_nickname boolean,
  p_nickname text,
  p_has_category boolean,
  p_category text,
  p_has_design_id boolean,
  p_design_id text,
  p_has_visibility boolean,
  p_visibility text,
  p_has_message_visibility boolean,
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
  target_ema app_private.emas%rowtype;
  updated_ema app_private.emas%rowtype;
  target_world app_private.worlds%rowtype;
  operation_name text;
  key_digest bytea;
  existing_request_hash bytea;
  existing_receipt jsonb;
  receipt jsonb;
  affected_rows bigint;
  full_edit_allowed boolean;
  has_content_edit boolean;
  widens_visibility boolean;
  listed_delta integer;
  next_wish_text text;
  next_nickname text;
  next_category text;
  next_design_id text;
  next_visibility text;
  next_message_visibility text;
begin
  actor_id := app_private.current_actor_id();
  if actor_id is null then
    raise exception using errcode = 'P1001', message = 'AUTH_REQUIRED';
  end if;

  if p_public_id is null
    or p_public_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_expected_version is null
    or p_expected_version < 1
    or p_has_wish_text is null
    or p_has_nickname is null
    or p_has_category is null
    or p_has_design_id is null
    or p_has_visibility is null
    or p_has_message_visibility is null
    or not (
      p_has_wish_text
      or p_has_nickname
      or p_has_category
      or p_has_design_id
      or p_has_visibility
      or p_has_message_visibility
    )
    or (not p_has_wish_text and p_wish_text is not null)
    or (
      p_has_wish_text
      and (
        p_wish_text is null
        or length(btrim(p_wish_text)) = 0
        or octet_length(p_wish_text) > 4096
        or length(p_wish_text) - length(replace(p_wish_text, E'\n', '')) > 3
      )
    )
    or (not p_has_nickname and p_nickname is not null)
    or (
      p_has_nickname
      and p_nickname is not null
      and (octet_length(p_nickname) > 1024 or position(E'\n' in p_nickname) > 0)
    )
    or (not p_has_category and p_category is not null)
    or (
      p_has_category
      and (
        p_category is null
        or p_category not in ('family', 'health', 'study', 'work', 'love', 'challenge', 'other')
      )
    )
    or (not p_has_design_id and p_design_id is not null)
    or (p_has_design_id and (p_design_id is null or p_design_id <> 'basic_wood'))
    or (not p_has_visibility and p_visibility is not null)
    or (
      p_has_visibility
      and (p_visibility is null or p_visibility not in ('public', 'unlisted'))
    )
    or (not p_has_message_visibility and p_message_visibility is not null)
    or (
      p_has_message_visibility
      and (
        p_message_visibility is null
        or p_message_visibility not in ('public', 'owner_only')
      )
    )
    or p_idempotency_key is null
    or p_idempotency_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_hash is null
    or octet_length(p_request_hash) <> 32
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  operation_name := 'PATCH:/api/v1/me/emas/' || p_public_id::text;
  key_digest := extensions.digest(p_idempotency_key::text, 'sha256');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      actor_id::text || ':' || operation_name || ':' || p_idempotency_key::text,
      0
    )
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

  select ema.* into target_ema
  from app_private.emas as ema
  where ema.public_id = p_public_id
    and ema.status in ('active', 'hidden')
  for update;

  if not found then
    raise exception using errcode = 'P1008', message = 'NOT_FOUND';
  end if;

  if target_ema.version <> p_expected_version then
    raise exception using errcode = 'P1009', message = 'VERSION_CONFLICT';
  end if;

  select world.* into target_world
  from app_private.worlds as world
  where world.id = target_ema.world_id
  for share;

  if not found then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  full_edit_allowed := target_ema.status = 'active'
    and target_world.state = 'open'
    and transaction_timestamp() >= target_world.opens_at
    and transaction_timestamp() < target_world.closes_at;
  has_content_edit := p_has_wish_text
    or p_has_nickname
    or p_has_category
    or p_has_design_id;
  widens_visibility := (
      p_has_visibility
      and target_ema.visibility = 'unlisted'
      and p_visibility = 'public'
    )
    or (
      p_has_message_visibility
      and target_ema.message_visibility = 'owner_only'
      and p_message_visibility = 'public'
    );

  if target_ema.status = 'hidden' and has_content_edit then
    raise exception using errcode = 'P1010', message = 'FORBIDDEN';
  end if;

  if not full_edit_allowed and target_ema.status = 'active' and has_content_edit then
    raise exception using errcode = 'P1003', message = 'WORLD_NOT_OPEN';
  end if;

  if not full_edit_allowed and widens_visibility then
    raise exception using errcode = 'P1010', message = 'FORBIDDEN';
  end if;

  next_wish_text := case
    when p_has_wish_text then btrim(p_wish_text)
    else target_ema.wish_text
  end;
  next_nickname := case
    when p_has_nickname and p_nickname is not null then nullif(btrim(p_nickname), '')
    when p_has_nickname then null
    else target_ema.nickname
  end;
  next_category := case when p_has_category then p_category else target_ema.category end;
  next_design_id := case when p_has_design_id then p_design_id else target_ema.design_id end;
  next_visibility := case when p_has_visibility then p_visibility else target_ema.visibility end;
  next_message_visibility := case
    when p_has_message_visibility then p_message_visibility
    else target_ema.message_visibility
  end;

  update app_private.emas as ema
  set wish_text = next_wish_text,
      nickname = next_nickname,
      category = next_category,
      design_id = next_design_id,
      visibility = next_visibility,
      message_visibility = next_message_visibility,
      version = ema.version + 1,
      updated_at = transaction_timestamp()
  where ema.id = target_ema.id
  returning ema.* into updated_ema;

  if not found then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  if target_ema.status = 'active' then
    update app_private.ema_public_projection as projection
    set nickname = updated_ema.nickname,
        category = updated_ema.category,
        design_id = updated_ema.design_id,
        visibility = updated_ema.visibility,
        message_visibility = updated_ema.message_visibility,
        message_text = case
          when updated_ema.message_visibility = 'public' then updated_ema.wish_text
          else null
        end,
        version = updated_ema.version,
        updated_at = updated_ema.updated_at
    where projection.ema_id = updated_ema.id;

    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
    end if;
  else
    -- A hidden row must never have a public representation. Deleting a stale
    -- projection is safe and keeps a privacy restriction monotonic.
    delete from app_private.ema_public_projection as projection
    where projection.ema_id = updated_ema.id;
  end if;

  listed_delta := case
    when updated_ema.status = 'active' and updated_ema.visibility = 'public' then 1
    else 0
  end - case
    when target_ema.status = 'active' and target_ema.visibility = 'public' then 1
    else 0
  end;

  update app_private.world_chunks as chunk
  set listed_count = chunk.listed_count + listed_delta,
      revision = chunk.revision + 1,
      updated_at = transaction_timestamp()
  where chunk.world_id = updated_ema.world_id
    and chunk.cx = updated_ema.x / 20
    and chunk.cy = updated_ema.y / 20;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  receipt := jsonb_build_object(
    'publicId', updated_ema.public_id::text,
    'worldSlug', target_world.slug,
    'version', updated_ema.version,
    'result', 'updated',
    'canonicalUrl', '/w/' || target_world.slug || '/e/' || updated_ema.public_id::text
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
    updated_ema.public_id,
    updated_ema.version,
    receipt,
    200
  );

  return query select
    updated_ema.public_id,
    target_world.slug,
    updated_ema.version,
    'updated'::text,
    '/w/' || target_world.slug || '/e/' || updated_ema.public_id::text,
    false;
end
$function$;

create or replace function app_private.list_owner_worlds(
  p_limit integer default 12,
  p_before_updated_at timestamptz default null,
  p_before_public_id uuid default null
)
returns table (
  world_slug text,
  world_name text,
  world_state text,
  public_id uuid,
  slot_number integer,
  status text,
  design_id text,
  visibility text,
  message_visibility text,
  version integer,
  updated_at timestamptz
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

  if p_limit is null
    or p_limit not between 1 and 51
    or ((p_before_updated_at is null) <> (p_before_public_id is null))
    or (
      p_before_public_id is not null
      and p_before_public_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  return query
  select
    world.slug,
    world.name,
    world.state,
    ema.public_id,
    ema.slot_number,
    ema.status,
    ema.design_id,
    ema.visibility,
    ema.message_visibility,
    ema.version,
    ema.updated_at
  from app_private.emas as ema
  join app_private.worlds as world on world.id = ema.world_id
  where ema.owner_id = actor_id
    and ema.status in ('active', 'hidden')
    and (
      p_before_updated_at is null
      or (ema.updated_at, ema.public_id) < (p_before_updated_at, p_before_public_id)
    )
  order by ema.updated_at desc, ema.public_id desc
  limit p_limit;
end
$function$;

create or replace function app_private.delete_ema(
  p_public_id uuid,
  p_expected_version integer,
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
  target_ema app_private.emas%rowtype;
  deleted_ema app_private.emas%rowtype;
  target_world app_private.worlds%rowtype;
  operation_name text;
  key_digest bytea;
  existing_request_hash bytea;
  existing_receipt jsonb;
  receipt jsonb;
  affected_rows bigint;
  active_delta integer;
  listed_delta integer;
begin
  actor_id := app_private.current_actor_id();
  if actor_id is null then
    raise exception using errcode = 'P1001', message = 'AUTH_REQUIRED';
  end if;

  if p_public_id is null
    or p_public_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_expected_version is null
    or p_expected_version < 1
    or p_idempotency_key is null
    or p_idempotency_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_hash is null
    or octet_length(p_request_hash) <> 32
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  operation_name := 'DELETE:/api/v1/me/emas/' || p_public_id::text;
  key_digest := extensions.digest(p_idempotency_key::text, 'sha256');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      actor_id::text || ':' || operation_name || ':' || p_idempotency_key::text,
      0
    )
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

  select ema.* into target_ema
  from app_private.emas as ema
  where ema.public_id = p_public_id
    and ema.status in ('active', 'hidden')
  for update;

  if not found then
    raise exception using errcode = 'P1008', message = 'NOT_FOUND';
  end if;

  if target_ema.version <> p_expected_version then
    raise exception using errcode = 'P1009', message = 'VERSION_CONFLICT';
  end if;

  select world.* into target_world
  from app_private.worlds as world
  where world.id = target_ema.world_id
  for share;

  if not found then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  delete from app_private.ema_public_projection as projection
  where projection.ema_id = target_ema.id;
  get diagnostics affected_rows = row_count;
  if target_ema.status = 'active' and affected_rows <> 1 then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  delete from app_private.slot_occupancy as occupancy
  where occupancy.ema_id = target_ema.id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  update app_private.emas as ema
  set status = 'deleted',
      wish_text = null,
      nickname = null,
      version = ema.version + 1,
      updated_at = transaction_timestamp(),
      deleted_at = transaction_timestamp()
  where ema.id = target_ema.id
  returning ema.* into deleted_ema;

  if not found then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  active_delta := case when target_ema.status = 'active' then -1 else 0 end;
  listed_delta := case
    when target_ema.status = 'active' and target_ema.visibility = 'public' then -1
    else 0
  end;

  update app_private.world_chunks as chunk
  set occupied_count = chunk.occupied_count - 1,
      active_count = chunk.active_count + active_delta,
      listed_count = chunk.listed_count + listed_delta,
      revision = chunk.revision + 1,
      updated_at = transaction_timestamp()
  where chunk.world_id = deleted_ema.world_id
    and chunk.cx = deleted_ema.x / 20
    and chunk.cy = deleted_ema.y / 20;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  receipt := jsonb_build_object(
    'publicId', deleted_ema.public_id::text,
    'worldSlug', target_world.slug,
    'version', deleted_ema.version,
    'result', 'deleted',
    'canonicalUrl', '/w/' || target_world.slug || '/e/' || deleted_ema.public_id::text
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
    deleted_ema.public_id,
    deleted_ema.version,
    receipt,
    200
  );

  return query select
    deleted_ema.public_id,
    target_world.slug,
    deleted_ema.version,
    'deleted'::text,
    '/w/' || target_world.slug || '/e/' || deleted_ema.public_id::text,
    false;
end
$function$;

alter function app_private.update_ema(
  uuid, integer, boolean, text, boolean, text, boolean, text,
  boolean, text, boolean, text, boolean, text, uuid, bytea
) owner to emanowa_owner;
alter function app_private.delete_ema(uuid, integer, uuid, bytea)
  owner to emanowa_owner;
alter function app_private.list_owner_worlds(integer, timestamptz, uuid)
  owner to emanowa_owner;

revoke all on function app_private.update_ema(
  uuid, integer, boolean, text, boolean, text, boolean, text,
  boolean, text, boolean, text, boolean, text, uuid, bytea
) from public, anon, authenticated, service_role, emanowa_app;
revoke all on function app_private.delete_ema(uuid, integer, uuid, bytea)
  from public, anon, authenticated, service_role, emanowa_app;
revoke all on function app_private.list_owner_worlds(integer, timestamptz, uuid)
  from public, anon, authenticated, service_role, emanowa_app;

grant execute on function app_private.update_ema(
  uuid, integer, boolean, text, boolean, text, boolean, text,
  boolean, text, boolean, text, boolean, text, uuid, bytea
) to emanowa_app;
grant execute on function app_private.delete_ema(uuid, integer, uuid, bytea)
  to emanowa_app;
grant execute on function app_private.list_owner_worlds(integer, timestamptz, uuid)
  to emanowa_app;

comment on function app_private.update_ema(
  uuid, integer, boolean, text, boolean, text, boolean, text,
  boolean, text, boolean, text, boolean, text, uuid, bytea
) is 'Owner-only optimistic update; optional values use explicit presence flags.';
comment on function app_private.delete_ema(uuid, integer, uuid, bytea)
  is 'Owner-only soft deletion that scrubs private text and frees occupancy.';
comment on function app_private.list_owner_worlds(integer, timestamptz, uuid)
  is 'Owner-only live-world summaries using updated-at/public-id keyset pagination.';

revoke emanowa_owner from session_user;
