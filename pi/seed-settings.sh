#!/bin/sh
# Seed local Pi preferences once; reconcile repo-managed packages on every run.
set -eu

pi_dir="$(CDPATH= cd "$(dirname "$0")" && pwd)"
agent_dir="${1:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}}"

exec node "$pi_dir/sync-packages.mjs" "$pi_dir/agent/settings.json" "$agent_dir/settings.json"
