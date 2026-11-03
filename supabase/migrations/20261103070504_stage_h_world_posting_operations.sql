-- Stage H: MFA-gated world posting operations and immutable operational audit.
-- app_private remains outside the Supabase Data API exposed schemas.

grant emanowa_owner to session_user;
set role emanowa_owner;

-- The timestamp is returned by the admin read/write DTO and changes only when
-- a committed world mutation occurs. Existing worlds receive the migration
-- transaction timestamp, which is necessarily after their creation time.
alter table app_private.worlds
  add column updated_at timestamptz not null default transaction_timestamp();

alter table app_private.worlds
  add constraint worlds_timestamps_check check (updated_at >= created_at);

create table app_private.world_operation_audit (
  id bigint generated always as identity primary key,
  admin_id uuid not null
    references app_private.admin_users(user_id) on delete restrict,
  world_id uuid not null
    references app_private.worlds(id) on delete restrict,
  action text not null,
  reason_code text not null,
  before_posting_enabled boolean not null,
  after_posting_enabled boolean not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint world_operation_audit_action_check check (
    action in ('pause', 'resume')
  ),
  constraint world_operation_audit_reason_check check (
    reason_code in (
      'abuse',
      'incident',
      'maintenance',
      'capacity',
      'launch_control',
      'other'
    )
  ),
  constraint world_operation_audit_transition_check check (
    (
      action = 'pause'
      and before_posting_enabled
      and not after_posting_enabled
    )
    or (
      action = 'resume'
      and not before_posting_enabled
      and after_posting_enabled
    )
  )
);

create index world_operation_audit_admin_id_idx
  on app_private.world_operation_audit (admin_id);
create index world_operation_audit_world_history_idx
  on app_private.world_operation_audit (world_id, created_at, id);

alter table app_private.world_operation_audit owner to emanowa_owner;
alter table app_private.world_operation_audit enable row level security;
alter table app_private.world_operation_audit force row level security;

-- The owner of SECURITY DEFINER functions is still subject to FORCE RLS. The
-- new audit table has no competing permissive policies, so actor/AAL checks
-- form a second layer around inserts and reads. worlds already has the
-- permissive owner UPDATE policy required by create_ema's FOR SHARE lock;
-- authorization for that table therefore lives at this execute-only boundary.
create policy world_operation_audit_aal2_admin_select
  on app_private.world_operation_audit
  for select to emanowa_owner
  using (
    admin_id = (select app_private.current_actor_id())
    and coalesce(pg_catalog.current_setting('app.auth_aal', true), '') = 'aal2'
    and app_private.is_current_admin()
  );

create policy world_operation_audit_aal2_admin_insert
  on app_private.world_operation_audit
  for insert to emanowa_owner
  with check (
    admin_id = (select app_private.current_actor_id())
    and coalesce(pg_catalog.current_setting('app.auth_aal', true), '') = 'aal2'
    and app_private.is_current_admin()
  );

-- Reuse the existing idempotency ledger with one exact, non-UGC receipt
-- shape. The receipt is sufficient to replay the original admin DTO even if
-- another operation has changed the world since the first response.
alter table app_private.idempotency_records
  drop constraint idempotency_receipt_check;

alter table app_private.idempotency_records
  add constraint idempotency_receipt_check check (
    jsonb_typeof(receipt_json) = 'object'
    and (
      (
        receipt_json ?& array['publicId', 'worldSlug', 'version', 'result', 'canonicalUrl']
        and receipt_json - array['publicId', 'worldSlug', 'version', 'result', 'canonicalUrl'] = '{}'::jsonb
      )
      or (
        receipt_json ?& array['reportId', 'accepted', 'httpStatus']
        and receipt_json - array['reportId', 'accepted', 'httpStatus'] = '{}'::jsonb
        and jsonb_typeof(receipt_json -> 'accepted') = 'boolean'
        and (receipt_json ->> 'httpStatus')::integer in (200, 201)
      )
      or (
        receipt_json ?& array['reportId', 'state', 'version']
        and receipt_json - array['reportId', 'state', 'version'] = '{}'::jsonb
        and receipt_json ->> 'state' in ('resolved', 'dismissed')
        and (receipt_json ->> 'version')::integer >= 1
      )
      or (
        receipt_json ?& array[
          'worldSlug',
          'worldName',
          'worldState',
          'postingEnabled',
          'opensAt',
          'closesAt',
          'updatedAt'
        ]
        and receipt_json - array[
          'worldSlug',
          'worldName',
          'worldState',
          'postingEnabled',
          'opensAt',
          'closesAt',
          'updatedAt'
        ] = '{}'::jsonb
        and jsonb_typeof(receipt_json -> 'worldSlug') = 'string'
        and jsonb_typeof(receipt_json -> 'worldName') = 'string'
        and receipt_json ->> 'worldState' in ('preview', 'open', 'archived')
        and jsonb_typeof(receipt_json -> 'postingEnabled') = 'boolean'
        and jsonb_typeof(receipt_json -> 'opensAt') = 'string'
        and jsonb_typeof(receipt_json -> 'closesAt') = 'string'
        and jsonb_typeof(receipt_json -> 'updatedAt') = 'string'
      )
    )
  );

create or replace function app_private.get_admin_world_posting(
  p_world_slug text
)
returns table (
  world_slug text,
  world_name text,
  state text,
  posting_enabled boolean,
  opens_at timestamptz,
  closes_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  admin_id uuid;
begin
  admin_id := app_private.current_actor_id();
  if admin_id is null
    or coalesce(pg_catalog.current_setting('app.auth_aal', true), '') <> 'aal2'
    or not app_private.is_current_admin()
  then
    raise exception using errcode = 'P1012', message = 'ADMIN_REQUIRED';
  end if;

  if p_world_slug is null or p_world_slug !~ '^[0-9]{4}$' then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  return query
  select
    world.slug,
    world.name,
    world.state,
    world.posting_enabled,
    world.opens_at,
    world.closes_at,
    world.updated_at
  from app_private.worlds as world
  where world.slug = p_world_slug;

  if not found then
    raise exception using errcode = 'P1008', message = 'NOT_FOUND';
  end if;
end
$function$;

create or replace function app_private.set_world_posting(
  p_world_slug text,
  p_posting_enabled boolean,
  p_reason_code text,
  p_expected_current boolean,
  p_idempotency_key uuid,
  p_request_hash bytea
)
returns table (
  world_slug text,
  world_name text,
  state text,
  posting_enabled boolean,
  opens_at timestamptz,
  closes_at timestamptz,
  updated_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  admin_id uuid;
  target_world app_private.worlds%rowtype;
  updated_world app_private.worlds%rowtype;
  operation_name text;
  action_name text;
  key_digest bytea;
  existing_request_hash bytea;
  existing_receipt jsonb;
  receipt jsonb;
begin
  admin_id := app_private.current_actor_id();
  if admin_id is null
    or coalesce(pg_catalog.current_setting('app.auth_aal', true), '') <> 'aal2'
    or not app_private.is_current_admin()
  then
    raise exception using errcode = 'P1012', message = 'ADMIN_REQUIRED';
  end if;

  if p_world_slug is null
    or p_world_slug !~ '^[0-9]{4}$'
    or p_posting_enabled is null
    or p_reason_code is null
    or p_reason_code not in (
      'abuse',
      'incident',
      'maintenance',
      'capacity',
      'launch_control',
      'other'
    )
    or p_expected_current is null
    or p_posting_enabled = p_expected_current
    or p_idempotency_key is null
    or p_idempotency_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_hash is null
    or pg_catalog.octet_length(p_request_hash) <> 32
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  operation_name := 'PATCH:/api/v1/admin/worlds/' || p_world_slug || '/posting';
  action_name := case when p_posting_enabled then 'resume' else 'pause' end;
  key_digest := extensions.digest(p_idempotency_key::text, 'sha256');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      admin_id::text || ':' || operation_name || ':' || p_idempotency_key::text,
      0
    )
  );

  select record.request_hash, record.receipt_json
    into existing_request_hash, existing_receipt
  from app_private.idempotency_records as record
  where record.owner_id = admin_id
    and record.operation = operation_name
    and record.key_hash = key_digest;

  if found then
    if existing_request_hash <> p_request_hash then
      raise exception using errcode = 'P1005', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;

    return query select
      existing_receipt ->> 'worldSlug',
      existing_receipt ->> 'worldName',
      existing_receipt ->> 'worldState',
      (existing_receipt ->> 'postingEnabled')::boolean,
      (existing_receipt ->> 'opensAt')::timestamptz,
      (existing_receipt ->> 'closesAt')::timestamptz,
      (existing_receipt ->> 'updatedAt')::timestamptz,
      true;
    return;
  end if;

  -- This is the only row lock in the mutation. The caller opens a short
  -- transaction, establishes actor/AAL context, invokes this function, and
  -- commits immediately after the single update/audit/receipt unit.
  select world.*
    into target_world
  from app_private.worlds as world
  where world.slug = p_world_slug
  for update;

  if not found then
    raise exception using errcode = 'P1008', message = 'NOT_FOUND';
  end if;

  if target_world.posting_enabled <> p_expected_current then
    raise exception using errcode = 'P1009', message = 'VERSION_CONFLICT';
  end if;

  update app_private.worlds as world
  set posting_enabled = p_posting_enabled,
      updated_at = transaction_timestamp()
  where world.id = target_world.id
  returning world.* into updated_world;

  if not found then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  insert into app_private.world_operation_audit (
    admin_id,
    world_id,
    action,
    reason_code,
    before_posting_enabled,
    after_posting_enabled
  ) values (
    admin_id,
    updated_world.id,
    action_name,
    p_reason_code,
    target_world.posting_enabled,
    updated_world.posting_enabled
  );

  receipt := pg_catalog.jsonb_build_object(
    'worldSlug', updated_world.slug,
    'worldName', updated_world.name,
    'worldState', updated_world.state,
    'postingEnabled', updated_world.posting_enabled,
    'opensAt', updated_world.opens_at,
    'closesAt', updated_world.closes_at,
    'updatedAt', updated_world.updated_at
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
    admin_id,
    operation_name,
    key_digest,
    p_request_hash,
    null,
    null,
    receipt,
    200
  );

  return query select
    updated_world.slug,
    updated_world.name,
    updated_world.state,
    updated_world.posting_enabled,
    updated_world.opens_at,
    updated_world.closes_at,
    updated_world.updated_at,
    false;
end
$function$;

alter function app_private.get_admin_world_posting(text)
  owner to emanowa_owner;
alter function app_private.set_world_posting(text, boolean, text, boolean, uuid, bytea)
  owner to emanowa_owner;

revoke all on table app_private.world_operation_audit
  from public, anon, authenticated, service_role, emanowa_app,
       emanowa_admin_app, emanowa_admin_provisioner;
revoke all on sequence app_private.world_operation_audit_id_seq
  from public, anon, authenticated, service_role, emanowa_app,
       emanowa_admin_app, emanowa_admin_provisioner;

revoke all on function app_private.get_admin_world_posting(text)
  from public, anon, authenticated, service_role, emanowa_app,
       emanowa_admin_app, emanowa_admin_provisioner;
revoke all on function app_private.set_world_posting(text, boolean, text, boolean, uuid, bytea)
  from public, anon, authenticated, service_role, emanowa_app,
       emanowa_admin_app, emanowa_admin_provisioner;

grant execute on function app_private.get_admin_world_posting(text)
  to emanowa_admin_app;
grant execute on function app_private.set_world_posting(text, boolean, text, boolean, uuid, bytea)
  to emanowa_admin_app;

reset role;

comment on table app_private.world_operation_audit is
  'Immutable pause/resume audit containing only admin/world IDs, fixed reason codes, and boolean transitions; never UGC.';
comment on function app_private.get_admin_world_posting(text) is
  'AAL2 admin-only world posting state and schedule DTO without UGC.';
comment on function app_private.set_world_posting(text, boolean, text, boolean, uuid, bytea) is
  'AAL2 admin-only idempotent pause/resume with optimistic expected-current comparison and immutable audit.';

revoke emanowa_owner from session_user;
