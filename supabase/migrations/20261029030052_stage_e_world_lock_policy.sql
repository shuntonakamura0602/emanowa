-- SELECT ... FOR SHARE is a row-locking read. With FORCE RLS PostgreSQL also
-- requires the row to satisfy an UPDATE policy, even though create_ema never
-- changes the world row. The owner role is NOLOGIN in normal operation and
-- only execute-only SECURITY DEFINER functions run as it; the BFF role still
-- has no direct table privileges.

grant emanowa_owner to session_user;

create policy worlds_owner_update_lock on app_private.worlds
  for update to emanowa_owner
  using (true)
  with check (true);

revoke emanowa_owner from session_user;
