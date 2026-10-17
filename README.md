# workspace

This is the configuration for the tools I use for agent driven development.

I'm trending towards doing as much in the terminal as I can and biasing towards tools
with high levels of customizability.

Uses the fantasic [`mise`](https://mise.jdx.dev) to bootstrap everything.

## What's inside

| Path                | Tool | Installed by | Symlinked to |
| ------------------- | ---- | ------------ | ------------ |
| `mise/workspace.toml` | Global mise tool config | `[dotfiles]` | `~/.config/mise/conf.d/workspace.toml` |
| `herdr/config.toml` | [herdr](https://herdr.dev) | `mise/workspace.toml` -> `herdr` | `~/.config/herdr/config.toml` |
| `herdr/plugins/dev-layout/` | Herdr plugin: four-pane dev layout | post-tools hook -> `herdr plugin link` | — |
| `herdr/plugin-config/jhochenbaum.hunkdiff/config.toml` | Herdr plugin config: hunk review round-trip | `mise.toml` -> `jhochenbaum/herdr-hunk-diff` | `~/.config/herdr/plugins/config/jhochenbaum.hunkdiff/config.toml` |
| — | [herdr-projects](https://github.com/eliasstravik/herdr-projects) coordinator and worktree plugin | post-tools hook -> `herdr plugin install` | — |
| `herdr-mirror/hosts.toml` | [herdr-mirror](https://github.com/nikok6/herdr-mirror) remote host config | `[dotfiles]` | `~/.config/herdr-mirror/hosts.toml` |
| `nvim/`             | [LazyVim](https://lazyvim.org) | `mise/workspace.toml` -> `neovim` (macOS; omarchy on Linux) | `~/.config/nvim` (overlay) |
| `ghostty/config`    | [Ghostty](https://ghostty.org) | post-tools hook (`brew --cask`) | `~/.config/ghostty/config` (macOS only) |
| `ghui/config.json`  | [ghui](https://github.com/kitlangton/ghui) | `mise/workspace.toml` -> `npm:@kitlangton/ghui` | `~/.config/ghui/config.json` |
| `hunk/config.toml`  | [hunk](https://github.com/modem-dev/hunk) | `mise/workspace.toml` -> `hunk` | `~/.config/hunk/config.toml` |
| `pi/agent/settings.json` | [pi](https://github.com/earendil-works/pi) preferences seed + shared package list | post-tools hook -> `pi/seed-settings.sh` | preferences copied once; packages synced on every bootstrap |
| `pi/agent/mcp.json`      | pi built-in MCP servers (shared) | post-tools hook -> `pi/seed-settings.sh` | shared servers synced into a local `~/.pi/agent/mcp.json` |
| `pi/agent/extensions/`   | pi extensions | (config only) | `~/.pi/agent/extensions` (overlay) |
| `skills/effect-setup/`   | [agent skill](https://github.com/anthropics/skills) | (config only) | `~/.agents/skills/effect-setup` |
| `skills/mise-setup/`     | agent skill | (config only) | `~/.agents/skills/mise-setup` |

### Global tools

The CLI tools (herdr, hunk, ghui, pi, stylua, atuin, and Rust) are declared
in [`mise/workspace.toml`](./mise/workspace.toml). The main
[`mise.toml`](./mise.toml) symlinks that file to
`~/.config/mise/conf.d/workspace.toml`, making those tools global instead of
repo-local. A few tools (neovim, gh, claude-code, fzf, lazygit) are scoped to
macOS only — on Arch/omarchy the system already provides them, so mise stays out
of the way.

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
- **pi `extensions/`** — `symlink-each` overlays our tracked extensions
  file-by-file, leaving tool-installed ones (e.g. `omarchy-system-theme.ts`) in
  place.
- **ghostty** — not a `[dotfiles]` entry (those can't be OS-scoped). On Linux
  omarchy's managed config is left alone; on macOS the post-tools hook copies
  ours in.

**pi** is the agent harness. Its tracked config is a `settings.json` preferences
seed and authoritative package list, `mcp.json` (shared built-in MCP servers),
and the `extensions/` directory. The live settings and MCP files are
machine-local, not symlinked; bootstrap reconciles only the `packages` field and
the shared MCP servers with the repo. Loose extension files remain symlinked. Secrets and runtime state — `auth.json`,
`mcp-auth.json`, `sessions/`, `npm/`, `trust.json` — stay in `~/.pi/agent/` and are
never tracked.

### Pi sessions and machine-local defaults

- `/clear` starts an empty session while keeping the current model and thinking
  level. `/new` retains Pi's normal behavior: start with configured defaults.
- The bootstrap seeds `~/.pi/agent/settings.json` with **Opus 5.5**
  (`anthropic/claude-opus-5-5`) only if no settings exist. It also converts the
  old workspace settings symlink to a local file, preserving its contents.
  On reruns, only `packages` is reconciled; existing defaults and all other
  preferences are preserved. Unrelated settings symlinks are left alone.
- On the personal machine, the local default is **GPT 6.1**
  (`openai-codex/gpt-6.1-sol`). Work machines keep the Opus seed. To change a
  machine's default, open `/model` and press **Ctrl+S** on the desired model.
  Resuming a session restores that session's recorded model instead.
- Preferences remain local. Change them through `/settings` or the local JSON
  file; later seed changes do not overwrite existing preferences.
- **Packages are shared.** Add, remove, pin or filter packages in the `packages`
  array of `pi/agent/settings.json`, then run the sync command below on each
  machine after pulling. The repo list replaces the local list, including
  removals; installed package files remain machine-local. Pi resolves missing
  declared packages on its next normal startup (not in offline mode).
- `pi install` still edits only the live settings file. To keep an installation
  shared, also record its package declaration in `pi/agent/settings.json`.
  Local-only package declarations are removed by the next bootstrap sync.

### Pi MCP servers

- **Shared servers** live in `pi/agent/mcp.json` and reach every machine on the
  next bootstrap. Each repo entry replaces the local definition, but local
  `enabled`, `exposure`, and `toolExposure` (what `/mcp` saves) are kept.
  Removing an entry from the repo removes it locally too; the local file's
  `workspaceManagedServers` key records which names came from the repo.
- **Machine-only servers** (e.g. Linear on the work machine) go straight into the
  local file and are never touched by the sync:

  ```sh
  pi mcp add linear --url https://mcp.linear.app/mcp
  ```

  A local server with the same name as a shared one is replaced by the shared
  definition, so give machine-only servers distinct names.

For an existing checkout, seed/migrate settings and MCP config and sync packages without
running the full bootstrap (Node required):

```sh
sh pi/seed-settings.sh
```

Run `/reload` after updating extensions. Regression tests (Bun and Pi required):

```sh
bun test pi/tests
```

**Skills** live in the shared `~/.agents/skills/` directory (read by pi and other
agents). That directory also holds skills installed by a skill manager, so each
tracked skill under [`skills/`](./skills) is symlinked individually rather than
linking the whole directory. Add a skill by dropping its folder in `skills/` and
adding matching `[dotfiles]` entries in [`mise.toml`](./mise.toml).

## Install

From a fresh clone, run the install script. It installs mise if missing, then
**prints a per-item plan (`mise bootstrap status`) and waits for confirmation
before changing anything** — the only thing that runs before you confirm is the
mise install itself. Re-running is safe — mise converges each step and skips
work already done:

```sh
./install.sh
```

Once you confirm, the install script first links
`~/.config/mise/conf.d/workspace.toml` with a plain dotfile apply, then starts a
fresh `mise bootstrap`. It intentionally does **not** pass `--force-dotfiles`:
conflicting real files stay visible in the plan instead of being clobbered by
the installer.

The bootstrap then converges the normal mise parts:

1. installs system packages,
2. applies `[dotfiles]` where targets are missing or already managed,
3. confirms the global tools are installed and runs the post-tools hook:
   installs fish, installs Ghostty on macOS if missing, installs/links Herdr
   plugins, copies the Ghostty config, seeds/migrates local Pi preferences, and
   syncs the shared Pi package list.

If a dotfile target is reported as `differs`, resolve it explicitly after
reviewing the file. For unattended runs set `WORKSPACE_ASSUME_YES=1` to skip
the prompt; to inspect without the script, `mise bootstrap status` and
`mise bootstrap --dry-run` both change nothing.
