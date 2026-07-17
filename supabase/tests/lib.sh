#!/usr/bin/env bash
# ============================================================================
# Shared harness helper for the backend test scripts (concurrency.sh, auth_session.sh).
#
# Derives the Supabase DB container name from supabase/config.toml's project_id —
# NOT a hardcoded string — so renaming the project can never silently break the
# tests. Then it confirms the stack is actually running and exits with a clear
# message if not (so you get a useful error instead of a raw `docker exec` failure).
#
# Source it from a test script:  source "<dir>/lib.sh"   → sets $CONTAINER.
# ============================================================================
_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_project_id="$(grep -E '^[[:space:]]*project_id[[:space:]]*=' "$_lib_dir/../config.toml" | sed -E 's/[^"]*"([^"]+)".*/\1/')"

if [ -z "${_project_id:-}" ]; then
  echo "error: could not read project_id from supabase/config.toml" >&2
  exit 1
fi

CONTAINER="supabase_db_${_project_id}"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "error: the local Supabase stack is not running (no container '$CONTAINER')." >&2
  echo "       start it first:   supabase start" >&2
  exit 1
fi
