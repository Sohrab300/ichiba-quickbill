#!/usr/bin/env bash
# Database tests on a THROWAWAY local Postgres (no Docker, no Supabase project, nothing remote).
#
#   npm run test:db                 # or: bash scripts/test-db-local.sh
#   PG_BIN=/path/to/pg/bin npm run test:db
#
# 1. initdb a fresh cluster in a temp directory, listening only on 127.0.0.1:<random port>;
# 2. add the few Supabase objects the migrations expect (roles anon/authenticated/service_role,
#    auth.users, schema extensions);
# 3. apply supabase/migrations/* older than FIXTURE_BEFORE, load scripts/db-tests/fixtures.sql
#    (so later migrations run against existing invoices, like production), then the same with
#    fixtures-before-decimal-qty.sql before DECIMAL_FIXTURE_BEFORE (weighed and edited invoices
#    issued by the older create_invoice), and apply the rest;
# 4. run every scripts/db-tests/*.test.sql, then scripts/db-tests/check-preview.ts (invoice
#    numbers from the database vs. the browser preview in src/lib/gst.ts).
# The cluster is stopped and deleted on exit. Needs the Postgres server binaries (Postgres.app
# or Homebrew postgresql@15+); Supabase runs Postgres 15/17.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD
FIXTURE_BEFORE=20261115300000 # first migration that should see pre-existing invoices
DECIMAL_FIXTURE_BEFORE=20261115500000 # first migration that should see weighed / edited invoices

find_pg_bin() {
  if [[ -n ${PG_BIN:-} ]]; then echo "$PG_BIN"; return; fi
  local d
  for d in /Applications/Postgres.app/Contents/Versions/latest/bin /opt/homebrew/opt/postgresql@17/bin \
           /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@15/bin /usr/lib/postgresql/*/bin; do
    if [[ -x $d/postgres && -x $d/initdb && -x $d/pg_ctl ]]; then echo "$d"; return; fi
  done
  if command -v postgres >/dev/null && command -v initdb >/dev/null; then dirname "$(command -v postgres)"; return; fi
  echo "No Postgres server binaries found. Install Postgres.app or set PG_BIN." >&2
  exit 1
}

BIN=$(find_pg_bin)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ichiba-dbtest.XXXXXX")
DATA=$TMP/data
PORT=$((20000 + RANDOM % 20000))

cleanup() {
  "$BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

"$BIN/initdb" -D "$DATA" -U postgres -A trust --no-sync -E UTF8 --locale=C >/dev/null
"$BIN/pg_ctl" -D "$DATA" -l "$TMP/server.log" -w \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off" start >/dev/null
echo "Throwaway Postgres $("$BIN/postgres" --version | awk '{print $NF}') on 127.0.0.1:$PORT"

# Only ever this local cluster. The test files refuse to run unless ichiba.throwaway=yes.
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres PGDATABASE=postgres PGOPTIONS="-c ichiba.throwaway=yes"
psql_run() { "$BIN/psql" -X -q -v ON_ERROR_STOP=1 "$@"; }

psql_run <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create schema extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
SQL

apply() {
  echo "  migrate $(basename "$1")"
  psql_run --single-transaction -f "$1" >/dev/null
}

fixtures_loaded=false
decimal_fixtures_loaded=false
for f in "$ROOT"/supabase/migrations/*.sql; do
  name=$(basename "$f")
  if ! $fixtures_loaded && [[ ${name%%_*} -ge $FIXTURE_BEFORE ]]; then
    echo "  fixtures (pre-existing invoices)"
    psql_run -f "$ROOT/scripts/db-tests/fixtures.sql" >/dev/null
    fixtures_loaded=true
  fi
  if ! $decimal_fixtures_loaded && [[ ${name%%_*} -ge $DECIMAL_FIXTURE_BEFORE ]]; then
    echo "  fixtures (weighed / edited invoices before decimal qty)"
    psql_run -f "$ROOT/scripts/db-tests/fixtures-before-decimal-qty.sql" >/dev/null
    decimal_fixtures_loaded=true
  fi
  apply "$f"
done
if ! $fixtures_loaded; then psql_run -f "$ROOT/scripts/db-tests/fixtures.sql" >/dev/null; fi
if ! $decimal_fixtures_loaded; then psql_run -f "$ROOT/scripts/db-tests/fixtures-before-decimal-qty.sql" >/dev/null; fi

status=0
for t in "$ROOT"/scripts/db-tests/*.test.sql; do
  echo "Running $(basename "$t")"
  if ! psql_run -f "$t" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /'; then status=1; fi
done

echo "Running check-preview.ts"
psql_run -At -c "select coalesce(jsonb_agg(public.invoice_json(id) order by invoice_no), '[]') from public.invoices" \
  >"$TMP/invoices.json"
npx --no-install tsx "$ROOT/scripts/db-tests/check-preview.ts" "$TMP/invoices.json" || status=1

if [[ $status -ne 0 ]]; then echo "DB TESTS FAILED"; else echo "DB tests passed"; fi
exit $status
