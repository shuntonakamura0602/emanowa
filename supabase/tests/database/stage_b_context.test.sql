create extension if not exists pgtap with schema extensions;
set search_path = pg_catalog, public, extensions;

begin;
grant emanowa_app to session_user;
grant usage on schema extensions to emanowa_app;
select extensions.plan(2);
set local role emanowa_app;
select set_config('app.actor_id', '10000000-0000-4000-8000-000000000001', true);
select extensions.is(
  app_private.current_actor_id(),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'the transaction-local actor is visible inside its transaction'
);
commit;

set role emanowa_app;
select extensions.is(
  app_private.current_actor_id(),
  null::uuid,
  'the actor capability is absent after commit on the same connection'
);
reset role;
select * from extensions.finish();
revoke usage on schema extensions from emanowa_app;
revoke emanowa_app from session_user;
