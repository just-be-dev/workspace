#!/usr/bin/env bash
# Bootstrap the workspace: install mise, preview the plan, then apply.
# Nothing is mutated before you confirm (except installing mise itself).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Install mise if missing.
if ! command -v mise >/dev/null 2>&1; then
	echo "mise not found — installing from https://mise.run"
	curl -fsSL https://mise.run | sh
fi
export PATH="${MISE_INSTALL_PATH:-$HOME/.local/bin}:$PATH"
if ! command -v mise >/dev/null 2>&1; then
	echo "error: mise install did not land on PATH; open a new shell and re-run." >&2
	exit 1
fi

cd "$REPO_DIR"
mise trust -q  # required before mise reads the config

# Preview — changes nothing.
echo "== bootstrap plan (no changes will be made) =="
mise bootstrap status || true
echo "=============================================="

# Confirm. WORKSPACE_ASSUME_YES=1 skips the prompt; read from /dev/tty so it
# still works under `curl … | bash`.
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

# `mise bootstrap` loads config files when the process starts. Link the global
# workspace tools config first using plain dotfile apply, not force; conflicts
# should stay visible instead of being clobbered by the installer.
mise bootstrap dotfiles apply --yes '~/.config/mise/conf.d/workspace.toml'

# Run the normal convergent bootstrap. Do not force dotfiles here: reruns should
# behave like `mise bootstrap`, leaving conflicts for the user to resolve
# explicitly instead of overwriting existing files or following legacy symlinks.
exec mise bootstrap --yes --quiet "$@"
