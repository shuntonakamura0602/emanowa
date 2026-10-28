#!/usr/bin/env bash

set -euo pipefail

readonly container_name="supabase_db_emanowa"
readonly database_user="supabase_admin"
readonly database_name="postgres"

if ! docker inspect "$container_name" >/dev/null 2>&1; then
  printf '%s\n' "Local Supabase is not running. Run pnpm supabase:start first." >&2
  exit 1
fi

for test_file in supabase/tests/database/*.test.sql; do
  output_file="$(mktemp "${TMPDIR:-/tmp}/emanowa-pgtap.XXXXXX")"
  trap 'rm -f "$output_file"' EXIT

  printf '%s\n' "$test_file"
  if ! docker exec -i "$container_name" psql \
    -X -A -t -q -v ON_ERROR_STOP=1 \
    -U "$database_user" -d "$database_name" \
    <"$test_file" 2>&1 | tee "$output_file"; then
    exit 1
  fi

  if ! grep -Eq '^1\.\.[0-9]+$' "$output_file"; then
    printf '%s\n' "pgTAP plan was not emitted for $test_file" >&2
    exit 1
  fi
  if grep -Eq '^not ok ' "$output_file"; then
    printf '%s\n' "pgTAP assertion failed in $test_file" >&2
    exit 1
  fi

  rm -f "$output_file"
  trap - EXIT
done

printf '%s\n' "All local pgTAP tests passed."
