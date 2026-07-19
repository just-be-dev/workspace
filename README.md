# workspace

This is the configuration for the tools I use for agent driven development.

I'm trending towards doing as much in the terminal as I can and biasing towards tools
with high levels of customizability.

Uses the fantasic [`mise`](https://mise.jdx.dev) to bootstrap everything.

## What's inside

| Path                | Tool | Installed by | Symlinked to |
| ------------------- | ---- | ------------ | ------------ |
| `herdr/config.toml` | [herdr](https://herdr.dev) | `[tools]` -> `herdr` | `~/.config/herdr/config.toml` |
| `herdr/plugins/dev-layout/` | Herdr plugin: four-pane dev layout | post-tools hook -> `herdr plugin link` | — |
| `nvim/`             | [LazyVim](https://lazyvim.org) | `[tools]` -> `neovim` (macOS; omarchy on Linux) | `~/.config/nvim` (overlay) |
| `ghostty/config`    | [Ghostty](https://ghostty.org) | post-tools hook (`brew --cask`) | `~/.config/ghostty/config` (macOS only) |
| `ghui/config.json`  | [ghui](https://github.com/kitlangton/ghui) | `[tools]` -> `npm:@kitlangton/ghui` | `~/.config/ghui/config.json` |
| `hunk/config.toml`  | [hunk](https://github.com/modem-dev/hunk) | `[tools]` -> `hunk` | `~/.config/hunk/config.toml` |
| `omp/agent/config.yml`   | [omp](https://omp.sh) | `[tools]` -> `github:can1357/oh-my-pi` | `~/.omp/agent/config.yml` |
| `omp/agent/extensions/`  | omp extensions | (config only) | `~/.omp/agent/extensions` (overlay) |
| `omp/plugins/pi-claude-bridge/` + `.tgz` | OMP plugin: Claude Code provider + AskClaude tool | post-tools hook -> `npm install` packaged local plugin | `~/.omp/plugins/node_modules/pi-claude-bridge` |
| `pi/agent/settings.json` | [pi](https://github.com/earendil-works/pi-coding-agent) | `[tools]` -> `npm:@earendil-works/pi-coding-agent` | `~/.pi/agent/settings.json` |
| `pi/agent/extensions/`   | pi extensions | (config only) | `~/.pi/agent/extensions` (overlay) |
| `skills/effect-setup/`   | [agent skill](https://github.com/anthropics/skills) | (config only) | `~/.agents/skills/effect-setup` |
| `skills/mise-setup/`     | agent skill | (config only) | `~/.agents/skills/mise-setup` |

### Global tools

The CLI tools (herdr, hunk, ghui, omp, pi, stylua, node) are declared in the
`[tools]` section of [`mise.toml`](./mise.toml). `mise bootstrap` installs them
into the **global** config, so they're active in every directory, not just this
repo. A few tools (neovim, gh, claude-code, fzf, lazygit) are scoped to macOS
only — on Arch/omarchy the system already provides them, so mise stays out of
the way.

Only config is tracked. Runtime files (logs, sockets, `state.json`, caches,
`session.json`) stay out.

### Overlaying onto omarchy

On Linux this machine runs [omarchy](https://omarchy.org), which ships its own
base configs. Where a config directory is shared with omarchy, the `[dotfiles]`
entries **overlay** our files rather than replacing the whole directory, leaving
omarchy's siblings untouched:

- **nvim** — a top-level `*.lua` glob links `init.lua` (skipping the
  nvim-managed `lazy-lock.json` / `lazyvim.json` lockfiles), and `symlink-each`
  links our files under `lua/config/` and `lua/plugins/`. omarchy keeps
  `options.lua`, themes, transparency, remote-clipboard, etc.
- **omp / pi `extensions/`** — `symlink-each` overlays our tracked extensions
  file-by-file, leaving tool-installed ones (e.g. `omarchy-system-theme.ts`) in
  place.
- **ghostty** — not a `[dotfiles]` entry (those can't be OS-scoped). On Linux
  omarchy's managed config is left alone; on macOS the post-tools hook copies
  ours in.

**omp** is the default agent setup. Only non-secret config is tracked:
`config.yml`, the `extensions` directory, and the local `pi-claude-bridge`
plugin source plus packaged tarball. OAuth credentials and runtime state stay in
`~/.omp/agent/agent.db` and related files; authenticate with `/login` or provider
environment variables after bootstrap.

**pi** is also installed and configured as a secondary agent. Its tracked
config is `settings.json` (preferences + package list) and the `extensions/`
directory. Secrets and runtime state — `auth.json`, `sessions/`, `npm/`,
`trust.json` — stay in `~/.pi/agent/` and are never tracked.

**Skills** live in the shared `~/.agents/skills/` directory (read by omp, pi, and other
agents). That directory also holds skills installed by a skill manager, so each
tracked skill under [`skills/`](./skills) is symlinked individually rather than
linking the whole directory. Add a skill by dropping its folder in `skills/` and
adding a matching `[dotfiles]` entry in [`mise.toml`](./mise.toml).

## Install

From a fresh clone, run the install script. It installs mise if missing, then
**prints a per-item plan (`mise bootstrap status`) and waits for confirmation
before changing anything** — the only thing that runs before you confirm is the
mise install itself. Re-running is safe — mise converges each step and skips
work already done:

```sh
./install.sh
```

Once you confirm, `mise bootstrap` runs with `--force-dotfiles` and:

1. installs the `[tools]` into the global config,
2. applies `[dotfiles]` — overlaying our configs onto any omarchy base (see
   [Overlaying onto omarchy](#overlaying-onto-omarchy)) rather than clobbering it,
3. runs the post-tools hook: installs fish, links the local Herdr plugin,
   installs the local omp plugin, and (macOS only) copies the Ghostty config.

`--force-dotfiles` lets managed symlinks replace the pre-existing stock nvim
files; the overlay entries (`symlink-each` / globs) only touch the files we
track, so omarchy's own configs in those directories are left in place. For
unattended runs set `WORKSPACE_ASSUME_YES=1` to skip the prompt; to inspect
without the script, `mise bootstrap status` and `mise bootstrap --dry-run` both
change nothing.
