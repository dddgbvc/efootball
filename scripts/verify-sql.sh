#!/usr/bin/env bash
#
# Applies every migration to a throwaway database and runs the SQL assertions in
# supabase/tests/. Catches syntax errors, broken constraints and RLS mistakes
# without needing a Supabase project.
#
# Usage:
#   scripts/verify-sql.sh                       # uses $PGURL or a local server
#   PGURL=postgresql://... scripts/verify-sql.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGURL="${PGURL:-postgresql://postgres@localhost:5432/postgres}"
DB="efootball_verify_$$"

echo "→ creating $DB"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"

TARGET="${PGURL%/*}/$DB"
if [[ "$PGURL" == *"?"* ]]; then
  BASE="${PGURL%%\?*}"
  QUERY="${PGURL#*\?}"
  TARGET="${BASE%/*}/$DB?$QUERY"
fi

cleanup() {
  psql "$PGURL" -q -c "drop database if exists $DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "→ applying Supabase shim"
psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/00_supabase_shim.sql"

echo "→ applying migrations"
for file in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$file")"
  psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$file"
done

echo "→ applying seed"
psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed/seed.sql"

echo "→ running SQL assertions"
for file in "$ROOT"/supabase/tests/[1-9]*.sql; do
  [ -e "$file" ] || continue
  echo "   $(basename "$file")"
  psql "$TARGET" -v ON_ERROR_STOP=1 -q -f "$file"
done

echo "✓ SQL verified"
