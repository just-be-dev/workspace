#!/usr/bin/env bash
# workspace
#
# Idempotent bootstrap: ensure mise is installed, PREVIEW the plan, then let
# `mise bootstrap` install every tool and link every packaged config (see
# mise.toml). Safe to re-run — mise converges each step and skips work done.
#
# Nothing on your system is mutated before the preview + confirmation below,
# except installing mise itself if it's missing.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Ensure mise is on PATH, installing it if missing (its installer is idempotent).
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

cd "$REPO_DIR"
# Trusting the repo config is a prerequisite for mise to read it at all (the
# dry-run below included). It only writes to mise's trust store — none of your
# configs or system packages are touched.
mise trust -q

# 2. Preview. Show exactly what would be installed and linked, changing nothing.
#    `sudo` package lines are printed, not executed. A non-zero exit here (e.g.
#    an unreachable package) is surfaced rather than aborting — seeing it in the
#    preview is the whole point.
echo "== bootstrap plan (dry run — no changes will be made) =="
mise bootstrap --dry-run --force-dotfiles "$@" || true
echo "======================================================="

# 3. Confirm before mutating. Set WORKSPACE_ASSUME_YES=1 for unattended runs.
#    We read the answer from /dev/tty so this works even under `curl … | bash`;
#    if there's no usable terminal, stop rather than apply without consent.
if [ "${WORKSPACE_ASSUME_YES:-}" != "1" ]; then
	printf 'Apply this plan? [y/N] '
	if ! { read -r reply </dev/tty; } 2>/dev/null; then
		echo >&2
		echo "no interactive terminal to confirm on; re-run with WORKSPACE_ASSUME_YES=1 to apply." >&2
		exit 1
	fi
	case "$reply" in
	[yY] | [yY][eE][sS]) ;;
	*)
		echo "aborted — no changes made." >&2
		exit 1
		;;
	esac
fi

# 4. Apply for real. `mise bootstrap` installs [tools] into the global config, so
#    they're available everywhere. --force-dotfiles lets managed symlinks replace
#    the pre-existing stock nvim files; the symlink-each / glob [dotfiles] entries
#    overlay additively, so omarchy's own files in those directories are left
#    untouched. System packages may prompt for sudo.
exec mise bootstrap --yes --force-dotfiles "$@"
