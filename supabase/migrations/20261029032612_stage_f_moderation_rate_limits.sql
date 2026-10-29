-- Stage F: reports, administrator moderation, immutable audit records, and
-- database-backed rate limits shared by every application instance.

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'emanowa_admin_app') then
    create role emanowa_admin_app
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  else
    alter role emanowa_admin_app
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'emanowa_admin_provisioner') then
    create role emanowa_admin_provisioner
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  else
    alter role emanowa_admin_provisioner
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$roles$;

-- NOINHERIT only blocks implicit privilege inheritance; a role membership can
-- still permit SET ROLE. Normalize pre-existing deployments as well as fresh
-- installs by removing every parent membership from the deliberately limited
-- application/object roles. This only removes memberships where one of these
-- roles is the member. It does not touch the migration session's temporary
-- membership in emanowa_owner below (session_user is the member there).
do $memberships$
declare
  membership record;
begin
  for membership in
    select granted_role.rolname as granted_role_name,
           member_role.rolname as member_role_name
    from pg_catalog.pg_auth_members as role_membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = role_membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = role_membership.member
    where member_role.rolname in (
      'emanowa_app',
      'emanowa_admin_app',
      'emanowa_admin_provisioner',
      'emanowa_owner'
    )
  loop
    execute pg_catalog.format(
      'revoke %I from %I',
      membership.granted_role_name,
      membership.member_role_name
    );
  end loop;
end
$memberships$;

alter role emanowa_admin_app set statement_timeout = '8s';
alter role emanowa_admin_app set lock_timeout = '3s';
alter role emanowa_admin_app set idle_in_transaction_session_timeout = '10s';

-- Supabase applies migrations as a provisioning role. Existing private
-- objects are owned by the deliberately NOLOGIN/NOBYPASSRLS owner role, so
-- take that role only for this transactional migration and always revoke the
-- temporary membership before the migration returns.
grant emanowa_owner to session_user;
set role emanowa_owner;

revoke all on schema app_private from emanowa_admin_app;
grant usage on schema app_private to emanowa_admin_app;
revoke all on schema app_private from emanowa_admin_provisioner;
grant usage on schema app_private to emanowa_admin_provisioner;

-- OTP quota consumption is reserved so a CAPTCHA rejection can release only
-- the request that failed, without decrementing another concurrent request.
-- Other actions retain the compact aggregate counter and never populate this
-- opaque, maximum-one-entry array.
alter table app_private.rate_limit_buckets
  add column reservation_ids uuid[] not null default '{}'::uuid[];

alter table app_private.rate_limit_buckets
  add constraint rate_limit_otp_reservation_count_check check (
    action <> 'otp' or count = cardinality(reservation_ids)
  );

-- Stage B kept mutation receipts intentionally narrow. Stage F adds two
-- equally narrow receipt shapes so report retries never need to copy UGC.
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
    )
  );

create index reports_created_queue_idx
  on app_private.reports (created_at desc, id desc);

-- The object owner remains subject to FORCE RLS. These policies therefore
-- form a second authorization layer underneath every SECURITY DEFINER API.
create policy admin_users_enabled_self_select
  on app_private.admin_users
  for select to emanowa_owner
  using (
    enabled
    and user_id = (select app_private.current_actor_id())
  );

-- A separate NOLOGIN provisioning role is the only writer. Neither app role
-- inherits it, and an operator grants it to one migration session only long
-- enough to enable or disable a previously verified Auth user.
create policy admin_users_provision_select
  on app_private.admin_users
  for select to emanowa_admin_provisioner
  using (user_id = (select app_private.current_actor_id()));

create policy admin_users_provision_insert
  on app_private.admin_users
  for insert to emanowa_admin_provisioner
  with check (
    enabled
    and role = 'moderator'
    and user_id = (select app_private.current_actor_id())
  );

create policy admin_users_provision_update
  on app_private.admin_users
  for update to emanowa_admin_provisioner
  using (user_id = (select app_private.current_actor_id()))
  with check (
    role = 'moderator'
    and user_id = (select app_private.current_actor_id())
  );

create policy emas_enabled_admin_select
  on app_private.emas
  for select to emanowa_owner
  using (
    exists (
      select 1
      from app_private.admin_users as admin_user
      where admin_user.user_id = (select app_private.current_actor_id())
        and admin_user.enabled
    )
  );

create policy emas_enabled_admin_update
  on app_private.emas
  for update to emanowa_owner
  using (
    exists (
      select 1
      from app_private.admin_users as admin_user
      where admin_user.user_id = (select app_private.current_actor_id())
        and admin_user.enabled
    )
  )
  with check (
    exists (
      select 1
      from app_private.admin_users as admin_user
      where admin_user.user_id = (select app_private.current_actor_id())
        and admin_user.enabled
    )
  );

create policy reports_enabled_admin_select
  on app_private.reports
  for select to emanowa_owner
  using (
    exists (
      select 1
      from app_private.admin_users as admin_user
      where admin_user.user_id = (select app_private.current_actor_id())
        and admin_user.enabled
    )
  );

create policy reports_enabled_admin_update
  on app_private.reports
  for update to emanowa_owner
  using (
    exists (
      select 1
      from app_private.admin_users as admin_user
      where admin_user.user_id = (select app_private.current_actor_id())
        and admin_user.enabled
    )
  )
  with check (
    exists (
      select 1
      from app_private.admin_users as admin_user
      where admin_user.user_id = (select app_private.current_actor_id())
        and admin_user.enabled
    )
  );

create policy moderation_audit_enabled_admin_select
  on app_private.moderation_audit
  for select to emanowa_owner
  using (
    admin_id = (select app_private.current_actor_id())
    and exists (
      select 1
      from app_private.admin_users as admin_user
      where admin_user.user_id = (select app_private.current_actor_id())
        and admin_user.enabled
    )
  );

create policy moderation_audit_enabled_admin_insert
  on app_private.moderation_audit
  for insert to emanowa_owner
  with check (
    admin_id = (select app_private.current_actor_id())
    and exists (
      select 1
      from app_private.admin_users as admin_user
      where admin_user.user_id = (select app_private.current_actor_id())
        and admin_user.enabled
    )
  );

create policy rate_limit_owner_all
  on app_private.rate_limit_buckets
  for all to emanowa_owner
  using (true)
  with check (true);

create or replace function app_private.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    exists (
      select 1
      from app_private.admin_users as admin_user
      where admin_user.user_id = (select app_private.current_actor_id())
        and admin_user.enabled
        and admin_user.role = 'moderator'
    ),
    false
  )
$function$;

create or replace function app_private.create_report(
  p_world_slug text,
  p_public_id uuid,
  p_reason text,
  p_detail text,
  p_idempotency_key uuid,
  p_request_hash bytea
)
returns table (
  report_id uuid,
  accepted boolean,
  replayed boolean,
  http_status integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_id uuid;
  target_ema_id bigint;
  operation_name text;
  key_digest bytea;
  existing_request_hash bytea;
  existing_receipt jsonb;
  existing_report app_private.reports%rowtype;
  new_report_id uuid;
  response_status integer;
  receipt jsonb;
begin
  actor_id := app_private.current_actor_id();
  if actor_id is null then
    raise exception using errcode = 'P1001', message = 'AUTH_REQUIRED';
  end if;

  if p_world_slug is null
    or length(p_world_slug) = 0
    or p_public_id is null
    or p_public_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason is null
    or p_reason not in ('spam', 'harassment', 'personal_information', 'sexual_content', 'illegal_content', 'other')
    or (p_detail is not null and octet_length(p_detail) > 2048)
    or p_idempotency_key is null
    or p_idempotency_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_hash is null
    or octet_length(p_request_hash) <> 32
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  operation_name := 'POST:/api/v1/worlds/' || p_world_slug || '/emas/' || p_public_id::text || '/reports';
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
      (existing_receipt ->> 'reportId')::uuid,
      (existing_receipt ->> 'accepted')::boolean,
      true,
      (existing_receipt ->> 'httpStatus')::integer;
    return;
  end if;

  perform pg_catalog.set_config('app.lookup_public_id', p_public_id::text, true);

  select projection.ema_id
    into target_ema_id
  from app_private.ema_public_projection as projection
  join app_private.worlds as world on world.id = projection.world_id
  where world.slug = p_world_slug
    and projection.public_id = p_public_id;

  if not found then
    raise exception using errcode = 'P1008', message = 'NOT_FOUND';
  end if;

  -- Different idempotency keys for the same reporter/ema still serialize to
  -- one open report, matching the partial unique index without a retry race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':open-report:' || target_ema_id::text, 0)
  );

  select report.*
    into existing_report
  from app_private.reports as report
  where report.reporter_id = actor_id
    and report.ema_id = target_ema_id
    and report.state = 'open'
  for update;

  if found then
    new_report_id := existing_report.id;
    response_status := 200;
  else
    insert into app_private.reports (ema_id, reporter_id, reason, detail)
    values (target_ema_id, actor_id, p_reason, nullif(btrim(p_detail), ''))
    returning id into new_report_id;
    response_status := 201;
  end if;

  receipt := jsonb_build_object(
    'reportId', new_report_id::text,
    'accepted', true,
    'httpStatus', response_status
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
    p_public_id,
    1,
    receipt,
    response_status
  );

  return query select new_report_id, true, false, response_status;
end
$function$;

create or replace function app_private.consume_rate_limit(
  p_action text,
  p_subject_hash bytea,
  p_window_seconds integer,
  p_limit integer
)
returns table (
  allowed boolean,
  current_count integer,
  retry_after_seconds integer,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  configured_window integer;
  configured_limit integer;
  request_time timestamptz := transaction_timestamp();
  bucket_start timestamptz;
  bucket_reset timestamptz;
  next_count integer;
begin
  select limits.window_seconds, limits.maximum
    into configured_window, configured_limit
  from (
    values
      ('create'::text, 60, 10),
      ('edit'::text, 600, 30),
      ('report'::text, 3600, 5),
      ('image'::text, 60, 30),
      ('otp_verify_link'::text, 600, 5)
  ) as limits(action, window_seconds, maximum)
  where limits.action = p_action;

  if configured_window is null
    or p_subject_hash is null
    or octet_length(p_subject_hash) <> 32
    or p_window_seconds is distinct from configured_window
    or p_limit is distinct from configured_limit
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  bucket_start := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from request_time) / configured_window) * configured_window
  );
  bucket_reset := bucket_start + pg_catalog.make_interval(secs => configured_window);

  -- Amortize global expiry cleanup over live requests so one-time subjects do
  -- not remain forever. The expires_at index feeds a bounded batch, while
  -- SKIP LOCKED avoids making one limiter request wait behind another cleanup.
  with expired as (
    select bucket.ctid
    from app_private.rate_limit_buckets as bucket
    where bucket.expires_at <= request_time
    order by bucket.expires_at
    limit 100
    for update skip locked
  )
  delete from app_private.rate_limit_buckets as bucket
  using expired
  where bucket.ctid = expired.ctid;

  insert into app_private.rate_limit_buckets (
    action,
    subject_hash,
    window_start,
    count,
    expires_at
  ) values (
    p_action,
    p_subject_hash,
    bucket_start,
    1,
    bucket_reset
  )
  on conflict (action, subject_hash, window_start) do update set
    count = least(app_private.rate_limit_buckets.count + 1, configured_limit + 1),
    expires_at = excluded.expires_at
  returning count into next_count;

  return query select
    next_count <= configured_limit,
    next_count,
    case
      when next_count <= configured_limit then 0
      else greatest(1, ceil(extract(epoch from (bucket_reset - request_time)))::integer)
    end,
    bucket_reset;
end
$function$;

create or replace function app_private.consume_recovery_otp_verification_rate_limit(
  p_pair_subject_hash bytea,
  p_target_subject_hash bytea,
  p_source_subject_hash bytea
)
returns table (
  allowed boolean,
  current_count integer,
  retry_after_seconds integer,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  request_time timestamptz := transaction_timestamp();
  bucket_start timestamptz;
  bucket_reset timestamptz;
  pair_count integer;
  target_count integer;
  source_count integer;
  next_count integer;
  lock_key bigint;
begin
  if p_pair_subject_hash is null
    or octet_length(p_pair_subject_hash) <> 32
    or p_target_subject_hash is null
    or octet_length(p_target_subject_hash) <> 32
    or p_source_subject_hash is null
    or octet_length(p_source_subject_hash) <> 32
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  bucket_start := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from request_time) / 600) * 600
  );
  bucket_reset := bucket_start + interval '600 seconds';

  -- Lock every overlapping dimension in deterministic order. This makes the
  -- three checks one decision across instances without deadlocking requests
  -- that share only an email or only a source.
  for lock_key in
    select requested_lock.lock_key
    from (
      values
        (pg_catalog.hashtextextended(
          'otp_verify:' || pg_catalog.encode(p_pair_subject_hash, 'hex'),
          20261029
        )),
        (pg_catalog.hashtextextended(
          'otp_verify_target:' || pg_catalog.encode(p_target_subject_hash, 'hex'),
          20261029
        )),
        (pg_catalog.hashtextextended(
          'otp_verify_source:' || pg_catalog.encode(p_source_subject_hash, 'hex'),
          20261029
        ))
    ) as requested_lock(lock_key)
    order by requested_lock.lock_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(lock_key);
  end loop;

  with expired as (
    select bucket.ctid
    from app_private.rate_limit_buckets as bucket
    where bucket.expires_at <= request_time
    order by bucket.expires_at
    limit 100
    for update skip locked
  )
  delete from app_private.rate_limit_buckets as bucket
  using expired
  where bucket.ctid = expired.ctid;

  select bucket.count into pair_count
  from app_private.rate_limit_buckets as bucket
  where bucket.action = 'otp_verify'
    and bucket.subject_hash = p_pair_subject_hash
    and bucket.window_start = bucket_start;

  select bucket.count into target_count
  from app_private.rate_limit_buckets as bucket
  where bucket.action = 'otp_verify_target'
    and bucket.subject_hash = p_target_subject_hash
    and bucket.window_start = bucket_start;

  select bucket.count into source_count
  from app_private.rate_limit_buckets as bucket
  where bucket.action = 'otp_verify_source'
    and bucket.subject_hash = p_source_subject_hash
    and bucket.window_start = bucket_start;

  pair_count := coalesce(pair_count, 0);
  target_count := coalesce(target_count, 0);
  source_count := coalesce(source_count, 0);

  -- A repeatedly exhausted pair must not consume the shared NAT or target
  -- quota. Conversely, an exhausted broad dimension must not create a fresh
  -- bucket for every rotated email/source pair.
  if pair_count >= 5 then
    insert into app_private.rate_limit_buckets (
      action, subject_hash, window_start, count, expires_at
    ) values (
      'otp_verify', p_pair_subject_hash, bucket_start, 1, bucket_reset
    )
    on conflict (action, subject_hash, window_start) do update set
      count = least(app_private.rate_limit_buckets.count + 1, 6),
      expires_at = excluded.expires_at
    returning count into next_count;

    return query select
      false,
      next_count,
      greatest(1, ceil(extract(epoch from (bucket_reset - request_time)))::integer),
      bucket_reset;
    return;
  end if;

  if source_count >= 30 then
    insert into app_private.rate_limit_buckets (
      action, subject_hash, window_start, count, expires_at
    ) values (
      'otp_verify_source', p_source_subject_hash, bucket_start, 1, bucket_reset
    )
    on conflict (action, subject_hash, window_start) do update set
      count = least(app_private.rate_limit_buckets.count + 1, 31),
      expires_at = excluded.expires_at
    returning count into next_count;

    return query select
      false,
      next_count,
      greatest(1, ceil(extract(epoch from (bucket_reset - request_time)))::integer),
      bucket_reset;
    return;
  end if;

  if target_count >= 30 then
    insert into app_private.rate_limit_buckets (
      action, subject_hash, window_start, count, expires_at
    ) values (
      'otp_verify_target', p_target_subject_hash, bucket_start, 1, bucket_reset
    )
    on conflict (action, subject_hash, window_start) do update set
      count = least(app_private.rate_limit_buckets.count + 1, 31),
      expires_at = excluded.expires_at
    returning count into next_count;

    return query select
      false,
      next_count,
      greatest(1, ceil(extract(epoch from (bucket_reset - request_time)))::integer),
      bucket_reset;
    return;
  end if;

  insert into app_private.rate_limit_buckets (
    action, subject_hash, window_start, count, expires_at
  ) values (
    'otp_verify', p_pair_subject_hash, bucket_start, 1, bucket_reset
  )
  on conflict (action, subject_hash, window_start) do update set
    count = least(app_private.rate_limit_buckets.count + 1, 6),
    expires_at = excluded.expires_at
  returning count into next_count;

  insert into app_private.rate_limit_buckets (
    action, subject_hash, window_start, count, expires_at
  ) values (
    'otp_verify_target', p_target_subject_hash, bucket_start, 1, bucket_reset
  )
  on conflict (action, subject_hash, window_start) do update set
    count = least(app_private.rate_limit_buckets.count + 1, 31),
    expires_at = excluded.expires_at;

  insert into app_private.rate_limit_buckets (
    action, subject_hash, window_start, count, expires_at
  ) values (
    'otp_verify_source', p_source_subject_hash, bucket_start, 1, bucket_reset
  )
  on conflict (action, subject_hash, window_start) do update set
    count = least(app_private.rate_limit_buckets.count + 1, 31),
    expires_at = excluded.expires_at;

  return query select true, next_count, 0, bucket_reset;
end
$function$;

create or replace function app_private.reserve_otp_rate_limit(
  p_subject_hash bytea,
  p_window_seconds integer,
  p_limit integer,
  p_reservation_id uuid
)
returns table (
  allowed boolean,
  current_count integer,
  retry_after_seconds integer,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  request_time timestamptz := transaction_timestamp();
  bucket_start timestamptz;
  bucket_reset timestamptz;
  bucket_count integer;
begin
  if p_subject_hash is null
    or octet_length(p_subject_hash) <> 32
    or p_window_seconds is distinct from 60
    or p_limit is distinct from 1
    or p_reservation_id is null
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  -- OTP is a true per-recipient cooldown, not a calendar-minute window. The
  -- transaction advisory lock closes the empty-row race without retaining a
  -- raw email or granting the app role direct table access. Hash collisions
  -- can only serialize unrelated recipients; they cannot weaken the limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.encode(p_subject_hash, 'hex'),
      20261029
    )
  );

  -- The bounded batch keeps cleanup amortized and avoids a full scan on a
  -- live request. Reservation IDs live only inside their expiring bucket.
  with expired as (
    select bucket.ctid
    from app_private.rate_limit_buckets as bucket
    where bucket.expires_at <= request_time
    order by bucket.expires_at
    limit 100
    for update skip locked
  )
  delete from app_private.rate_limit_buckets as bucket
  using expired
  where bucket.ctid = expired.ctid;

  select bucket.count, bucket.expires_at
    into bucket_count, bucket_reset
  from app_private.rate_limit_buckets as bucket
  where bucket.action = 'otp'
    and bucket.subject_hash = p_subject_hash
    and bucket.count > 0
    and bucket.expires_at > request_time
  order by bucket.expires_at desc
  limit 1
  for update;

  if found then
    return query select
      false,
      bucket_count + 1,
      greatest(
        1,
        ceil(extract(epoch from (bucket_reset - request_time)))::integer
      ),
      bucket_reset;
    return;
  end if;

  bucket_start := request_time;
  bucket_reset := request_time + interval '60 seconds';

  insert into app_private.rate_limit_buckets (
    action,
    subject_hash,
    window_start,
    count,
    expires_at,
    reservation_ids
  ) values (
    'otp',
    p_subject_hash,
    bucket_start,
    1,
    bucket_reset,
    array[p_reservation_id]
  );

  return query select true, 1, 0, bucket_reset;
end
$function$;

create or replace function app_private.release_otp_rate_limit(
  p_subject_hash bytea,
  p_reservation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  released boolean;
begin
  if p_subject_hash is null
    or octet_length(p_subject_hash) <> 32
    or p_reservation_id is null
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  delete from app_private.rate_limit_buckets as bucket
  where bucket.action = 'otp'
    and bucket.subject_hash = p_subject_hash
    and p_reservation_id = any(bucket.reservation_ids)
  returning true into released;

  return coalesce(released, false);
end
$function$;

create or replace function app_private.list_admin_reports(
  p_state text,
  p_limit integer,
  p_before_created_at timestamptz,
  p_before_report_id uuid
)
returns table (
  report_id uuid,
  reason text,
  detail text,
  report_state text,
  report_version integer,
  created_at timestamptz,
  resolved_at timestamptz,
  ema_public_id uuid,
  world_slug text,
  slot_number integer,
  ema_status text,
  ema_version integer,
  nickname text,
  category text,
  design_id text,
  visibility text,
  message_visibility text,
  message_text text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not app_private.is_current_admin() then
    raise exception using errcode = 'P1012', message = 'ADMIN_REQUIRED';
  end if;

  if (p_state is not null and p_state not in ('open', 'resolved', 'dismissed'))
    or p_limit is null
    or p_limit not between 1 and 51
    or ((p_before_created_at is null) <> (p_before_report_id is null))
    or (
      p_before_report_id is not null
      and p_before_report_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  return query
  select
    report.id,
    report.reason,
    report.detail,
    report.state,
    report.version,
    report.created_at,
    report.resolved_at,
    ema.public_id,
    world.slug,
    ema.slot_number,
    ema.status,
    ema.version,
    ema.nickname,
    ema.category,
    ema.design_id,
    ema.visibility,
    ema.message_visibility,
    case
      when ema.status = 'active' and ema.message_visibility = 'public' then ema.wish_text
      else null
    end
  from app_private.reports as report
  join app_private.emas as ema on ema.id = report.ema_id
  join app_private.worlds as world on world.id = ema.world_id
  where (p_state is null or report.state = p_state)
    and (
      p_before_created_at is null
      or (report.created_at, report.id) < (p_before_created_at, p_before_report_id)
    )
  order by report.created_at desc, report.id desc
  limit p_limit;
end
$function$;

create or replace function app_private.moderate_ema(
  p_public_id uuid,
  p_action text,
  p_reason_code text,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_request_hash bytea
)
returns table (
  public_id uuid,
  world_slug text,
  status text,
  version integer,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  admin_id uuid;
  target_ema app_private.emas%rowtype;
  updated_ema app_private.emas%rowtype;
  target_world app_private.worlds%rowtype;
  operation_name text;
  key_digest bytea;
  existing_request_hash bytea;
  existing_receipt jsonb;
  receipt jsonb;
  after_status text;
  result_name text;
  affected_rows bigint;
  active_delta integer;
  listed_delta integer;
  occupied_delta integer;
begin
  admin_id := app_private.current_actor_id();
  if admin_id is null or not app_private.is_current_admin() then
    raise exception using errcode = 'P1012', message = 'ADMIN_REQUIRED';
  end if;

  if p_public_id is null
    or p_public_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_action is null
    or p_action not in ('hide', 'restore', 'delete')
    or p_reason_code is null
    or p_reason_code not in ('spam', 'harassment', 'personal_information', 'sexual_content', 'illegal_content', 'other')
    or p_expected_version is null
    or p_expected_version < 1
    or p_idempotency_key is null
    or p_idempotency_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_hash is null
    or octet_length(p_request_hash) <> 32
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  operation_name := 'POST:/api/v1/admin/emas/' || p_public_id::text || '/moderation';
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
      (existing_receipt ->> 'publicId')::uuid,
      existing_receipt ->> 'worldSlug',
      case
        when p_action = 'hide' then 'hidden'
        when p_action = 'restore' then 'active'
        else 'deleted'
      end,
      (existing_receipt ->> 'version')::integer,
      true;
    return;
  end if;

  select ema.*
    into target_ema
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

  if (p_action = 'hide' and target_ema.status <> 'active')
    or (p_action = 'restore' and target_ema.status <> 'hidden')
  then
    raise exception using errcode = 'P1010', message = 'FORBIDDEN';
  end if;

  select world.*
    into target_world
  from app_private.worlds as world
  where world.id = target_ema.world_id
  for share;

  if not found then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  if p_action in ('hide', 'delete') then
    delete from app_private.ema_public_projection as projection
    where projection.ema_id = target_ema.id;

    get diagnostics affected_rows = row_count;
    if target_ema.status = 'active' and affected_rows <> 1 then
      raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
    end if;
  end if;

  if p_action = 'delete' then
    delete from app_private.slot_occupancy as occupancy
    where occupancy.ema_id = target_ema.id;

    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
    end if;
  end if;

  after_status := case
    when p_action = 'hide' then 'hidden'
    when p_action = 'restore' then 'active'
    else 'deleted'
  end;

  update app_private.emas as ema
  set status = after_status,
      wish_text = case when p_action = 'delete' then null else ema.wish_text end,
      nickname = case when p_action = 'delete' then null else ema.nickname end,
      version = ema.version + 1,
      updated_at = transaction_timestamp(),
      deleted_at = case when p_action = 'delete' then transaction_timestamp() else null end
  where ema.id = target_ema.id
  returning ema.* into updated_ema;

  if not found then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  if p_action = 'restore' then
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
    ) values (
      updated_ema.id,
      updated_ema.public_id,
      updated_ema.world_id,
      updated_ema.x,
      updated_ema.y,
      updated_ema.slot_number,
      updated_ema.nickname,
      updated_ema.category,
      updated_ema.design_id,
      updated_ema.visibility,
      updated_ema.message_visibility,
      case when updated_ema.message_visibility = 'public' then updated_ema.wish_text else null end,
      updated_ema.version,
      updated_ema.created_at,
      updated_ema.updated_at
    );
  end if;

  occupied_delta := case when p_action = 'delete' then -1 else 0 end;
  active_delta := case
    when p_action = 'hide' then -1
    when p_action = 'restore' then 1
    when p_action = 'delete' and target_ema.status = 'active' then -1
    else 0
  end;
  listed_delta := case
    when target_ema.visibility <> 'public' then 0
    when p_action = 'hide' then -1
    when p_action = 'restore' then 1
    when p_action = 'delete' and target_ema.status = 'active' then -1
    else 0
  end;

  update app_private.world_chunks as chunk
  set occupied_count = chunk.occupied_count + occupied_delta,
      active_count = chunk.active_count + active_delta,
      listed_count = chunk.listed_count + listed_delta,
      revision = chunk.revision + 1,
      updated_at = transaction_timestamp()
  where chunk.world_id = updated_ema.world_id
    and chunk.cx = updated_ema.x / 20
    and chunk.cy = updated_ema.y / 20;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  insert into app_private.moderation_audit (
    admin_id,
    ema_id,
    action,
    reason_code,
    before_status,
    after_status
  ) values (
    admin_id,
    target_ema.id,
    p_action,
    p_reason_code,
    target_ema.status,
    after_status
  );

  result_name := case when p_action = 'delete' then 'deleted' else 'updated' end;
  receipt := jsonb_build_object(
    'publicId', updated_ema.public_id::text,
    'worldSlug', target_world.slug,
    'version', updated_ema.version,
    'result', result_name,
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
    admin_id,
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
    updated_ema.status,
    updated_ema.version,
    false;
end
$function$;

create or replace function app_private.update_report(
  p_report_id uuid,
  p_state text,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_request_hash bytea
)
returns table (
  report_id uuid,
  state text,
  version integer,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  admin_id uuid;
  target_report app_private.reports%rowtype;
  updated_report app_private.reports%rowtype;
  operation_name text;
  key_digest bytea;
  existing_request_hash bytea;
  existing_receipt jsonb;
  receipt jsonb;
begin
  admin_id := app_private.current_actor_id();
  if admin_id is null or not app_private.is_current_admin() then
    raise exception using errcode = 'P1012', message = 'ADMIN_REQUIRED';
  end if;

  if p_report_id is null
    or p_report_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_state is null
    or p_state not in ('resolved', 'dismissed')
    or p_expected_version is null
    or p_expected_version < 1
    or p_idempotency_key is null
    or p_idempotency_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_hash is null
    or octet_length(p_request_hash) <> 32
  then
    raise exception using errcode = 'P1002', message = 'VALIDATION_ERROR';
  end if;

  operation_name := 'PATCH:/api/v1/admin/reports/' || p_report_id::text;
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
      (existing_receipt ->> 'reportId')::uuid,
      existing_receipt ->> 'state',
      (existing_receipt ->> 'version')::integer,
      true;
    return;
  end if;

  select report.*
    into target_report
  from app_private.reports as report
  where report.id = p_report_id
  for update;

  if not found then
    raise exception using errcode = 'P1008', message = 'NOT_FOUND';
  end if;

  if target_report.version <> p_expected_version then
    raise exception using errcode = 'P1009', message = 'VERSION_CONFLICT';
  end if;

  update app_private.reports as report
  set state = p_state,
      version = report.version + 1,
      resolved_at = transaction_timestamp()
  where report.id = target_report.id
  returning report.* into updated_report;

  if not found then
    raise exception using errcode = 'P1011', message = 'INVARIANT_VIOLATION';
  end if;

  receipt := jsonb_build_object(
    'reportId', updated_report.id::text,
    'state', updated_report.state,
    'version', updated_report.version
  );

  insert into app_private.idempotency_records (
    owner_id,
    operation,
    key_hash,
    request_hash,
    result_version,
    receipt_json,
    http_status
  ) values (
    admin_id,
    operation_name,
    key_digest,
    p_request_hash,
    updated_report.version,
    receipt,
    200
  );

  return query select
    updated_report.id,
    updated_report.state,
    updated_report.version,
    false;
end
$function$;

alter function app_private.is_current_admin() owner to emanowa_owner;
alter function app_private.create_report(text, uuid, text, text, uuid, bytea)
  owner to emanowa_owner;
alter function app_private.consume_rate_limit(text, bytea, integer, integer)
  owner to emanowa_owner;
alter function app_private.consume_recovery_otp_verification_rate_limit(bytea, bytea, bytea)
  owner to emanowa_owner;
alter function app_private.reserve_otp_rate_limit(bytea, integer, integer, uuid)
  owner to emanowa_owner;
alter function app_private.release_otp_rate_limit(bytea, uuid)
  owner to emanowa_owner;
alter function app_private.list_admin_reports(text, integer, timestamptz, uuid)
  owner to emanowa_owner;
alter function app_private.moderate_ema(uuid, text, text, integer, uuid, bytea)
  owner to emanowa_owner;
alter function app_private.update_report(uuid, text, integer, uuid, bytea)
  owner to emanowa_owner;

revoke all on all tables in schema app_private from emanowa_admin_app;
revoke all on all sequences in schema app_private from emanowa_admin_app;
revoke all on all tables in schema app_private from emanowa_admin_provisioner;
revoke all on all sequences in schema app_private from emanowa_admin_provisioner;
grant select (user_id, role, enabled) on table app_private.admin_users
  to emanowa_admin_provisioner;
grant insert (user_id, role, enabled) on table app_private.admin_users
  to emanowa_admin_provisioner;
grant update (enabled) on table app_private.admin_users
  to emanowa_admin_provisioner;
grant execute on function app_private.current_actor_id()
  to emanowa_admin_provisioner;

revoke all on function app_private.is_current_admin()
  from public, anon, authenticated, service_role, emanowa_app, emanowa_admin_app;
revoke all on function app_private.create_report(text, uuid, text, text, uuid, bytea)
  from public, anon, authenticated, service_role, emanowa_app, emanowa_admin_app;
revoke all on function app_private.consume_rate_limit(text, bytea, integer, integer)
  from public, anon, authenticated, service_role, emanowa_app, emanowa_admin_app;
revoke all on function app_private.consume_recovery_otp_verification_rate_limit(bytea, bytea, bytea)
  from public, anon, authenticated, service_role, emanowa_app, emanowa_admin_app;
revoke all on function app_private.reserve_otp_rate_limit(bytea, integer, integer, uuid)
  from public, anon, authenticated, service_role, emanowa_app, emanowa_admin_app;
revoke all on function app_private.release_otp_rate_limit(bytea, uuid)
  from public, anon, authenticated, service_role, emanowa_app, emanowa_admin_app;
revoke all on function app_private.list_admin_reports(text, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role, emanowa_app, emanowa_admin_app;
revoke all on function app_private.moderate_ema(uuid, text, text, integer, uuid, bytea)
  from public, anon, authenticated, service_role, emanowa_app, emanowa_admin_app;
revoke all on function app_private.update_report(uuid, text, integer, uuid, bytea)
  from public, anon, authenticated, service_role, emanowa_app, emanowa_admin_app;

grant execute on function app_private.create_report(text, uuid, text, text, uuid, bytea)
  to emanowa_app;
grant execute on function app_private.consume_rate_limit(text, bytea, integer, integer)
  to emanowa_app;
grant execute on function app_private.consume_recovery_otp_verification_rate_limit(bytea, bytea, bytea)
  to emanowa_app;
grant execute on function app_private.reserve_otp_rate_limit(bytea, integer, integer, uuid)
  to emanowa_app;
grant execute on function app_private.release_otp_rate_limit(bytea, uuid)
  to emanowa_app;

grant execute on function app_private.is_current_admin()
  to emanowa_admin_app;
grant execute on function app_private.list_admin_reports(text, integer, timestamptz, uuid)
  to emanowa_admin_app;
grant execute on function app_private.moderate_ema(uuid, text, text, integer, uuid, bytea)
  to emanowa_admin_app;
grant execute on function app_private.update_report(uuid, text, integer, uuid, bytea)
  to emanowa_admin_app;

reset role;

comment on role emanowa_admin_app is
  'NOLOGIN, NOBYPASSRLS role for MFA-gated administration only; provision its secret out-of-band.';
comment on role emanowa_admin_provisioner is
  'NOLOGIN, NOBYPASSRLS role granted temporarily to migration sessions for verified admin enable/disable only.';
comment on function app_private.create_report(text, uuid, text, text, uuid, bytea) is
  'Creates or reuses one open report per actor/ema without exposing the reporter.';
comment on function app_private.consume_rate_limit(text, bytea, integer, integer) is
  'Atomic shared rate-limit bucket with server-fixed actions, windows, and limits.';
comment on function app_private.consume_recovery_otp_verification_rate_limit(bytea, bytea, bytea) is
  'Atomically applies pair, target, and source recovery-code limits without poisoning unrelated dimensions.';
comment on function app_private.reserve_otp_rate_limit(bytea, integer, integer, uuid) is
  'Reserves one shared OTP quota slot with an opaque request ID for safe CAPTCHA rollback.';
comment on function app_private.release_otp_rate_limit(bytea, uuid) is
  'Idempotently releases only the matching unsent OTP reservation.';
comment on function app_private.list_admin_reports(text, integer, timestamptz, uuid) is
  'MFA-BFF-only moderation queue; never returns reporter identity or owner-only text.';
comment on function app_private.moderate_ema(uuid, text, text, integer, uuid, bytea) is
  'Admin-only idempotent hide/restore/delete with synchronous projection updates and audit.';
comment on function app_private.update_report(uuid, text, integer, uuid, bytea) is
  'Admin-only optimistic report resolution, separate from ema moderation.';

revoke emanowa_owner from session_user;
