#!/bin/sh
# Seed native, machine-local Pi settings. Never overwrite existing local choices.
set -eu

source="$(CDPATH= cd "$(dirname "$0")" && pwd)/agent/settings.json"
agent_dir="${1:-$HOME/.pi/agent}"
target="$agent_dir/settings.json"

if [ -L "$target" ] && [ "$target" -ef "$source" ]; then
  # Migrate our old shared symlink without changing its contents. Copy before
  # replacing the link so a failed copy leaves the original config intact.
  temporary="$(mktemp "$agent_dir/settings.json.local.XXXXXX")"
  trap 'rm -f "$temporary"' 0 HUP INT TERM
  cp -p "$target" "$temporary"
  mv -f "$temporary" "$target"
  echo "Pi settings migrated to a machine-local file: $target"
elif [ ! -e "$target" ] && [ ! -L "$target" ]; then
  mkdir -p "$agent_dir"
  cp "$source" "$target"
  echo "Pi settings seeded (Opus 5.5): $target"
fi
