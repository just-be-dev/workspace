#!/usr/bin/env bash
# workspace
#
# Idempotent bootstrap: ensure mise is installed, then let `mise bootstrap`
# install every tool and link every packaged config (see mise.toml). Safe to
# re-run — mise converges each step and skips work already done.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure mise is on PATH, installing it if missing (its installer is idempotent).
if ! command -v mise >/dev/null 2>&1; then
	echo "mise not found — installing from https://mise.run"
	curl -fsSL https://mise.run | sh
fi
# mise's default install location, in case the current shell hasn't picked it up.
export PATH="${MISE_INSTALL_PATH:-$HOME/.local/bin}:$PATH"
if ! command -v mise >/dev/null 2>&1; then
	echo "error: mise install did not land on PATH; open a new shell and re-run." >&2
	exit 1
fi

# Trust this repo's config, then install tools and apply [dotfiles] in one pass.
# `mise bootstrap` installs the [tools] into the global config, so they're
# available everywhere — no conf.d drop-in needed. --force-dotfiles lets managed
# symlinks replace the pre-existing stock nvim files; the symlink-each / glob
# [dotfiles] entries overlay additively, so omarchy's own files in those same
# directories (options.lua, themes, extensions, …) are left untouched.
cd "$REPO_DIR"
mise trust -q
exec mise bootstrap --yes --force-dotfiles "$@"
