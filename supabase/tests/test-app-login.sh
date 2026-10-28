#!/usr/bin/env bash
set -euo pipefail

admin_url="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
app_password="$(openssl rand -hex 24)"

cleanup() {
  psql "$admin_url" --set=ON_ERROR_STOP=1 \
    --command="alter role emanowa_app nologin password null" >/dev/null
}
trap cleanup EXIT INT TERM

psql "$admin_url" --set=ON_ERROR_STOP=1 --set=app_password="$app_password" <<'SQL'
alter role emanowa_app login password :'app_password';
SQL

app_url="postgresql://emanowa_app:${app_password}@127.0.0.1:54322/postgres"

role_state="$(psql "$app_url" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL'
select current_user || ':' || rolsuper::text || ':' || rolbypassrls::text
from pg_roles
where rolname = current_user;
SQL
)"

if [[ "$role_state" != "emanowa_app:false:false" ]]; then
  printf 'unexpected app role state: %s\n' "$role_state" >&2
  exit 1
fi

actor_after_commit="$(psql "$app_url" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL' | tail -n 1
begin;
select set_config('app.actor_id', '10000000-0000-4000-8000-000000000001', true) is not null;
commit;
select coalesce(app_private.current_actor_id()::text, '<null>');
SQL
)"

if [[ "$actor_after_commit" != "<null>" ]]; then
  printf 'transaction-local actor leaked after commit: %s\n' "$actor_after_commit" >&2
  exit 1
fi

printf 'emanowa_app login boundary and transaction-local actor cleanup verified\n'
