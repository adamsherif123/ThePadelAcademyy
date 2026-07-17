#!/usr/bin/env bash
# ============================================================================
# Runs the pgTAP suites (rls / rpc / rpc_admin / auth) via `supabase test db`,
# with a clear preflight failure if the local stack isn't up (lib.sh) instead of
# a bare CLI connection error. Invoked by `pnpm test:db`.
# ============================================================================
set -uo pipefail

# Preflight only — confirms the stack is running (and derives nothing we use here,
# but gives the same clear "run supabase start" message as the other suites).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

exec supabase test db
