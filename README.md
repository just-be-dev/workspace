# workspace

This is the configuration for the tools I use for agent driven development.

I'm trending towards doing as much in the terminal as I can and biasing towards tools
with high levels of customizability.

Uses the fantasic [`mise`](https://mise.jdx.dev) to bootstrap everything.

## What's inside

| Path                | Tool | Installed by | Symlinked to |
| ------------------- | ---- | ------------ | ------------ |
| `herdr/config.toml` | [herdr](https://herdr.dev) | `mise/workspace.toml` -> `herdr` | `~/.config/herdr/config.toml` |
| `nvim/`             | [LazyVim](https://lazyvim.org) | `mise/workspace.toml` -> `neovim` | `~/.config/nvim` |
| `ghostty/config`    | [Ghostty](https://ghostty.org) | post-tools hook (`brew --cask`) | `~/.config/ghostty/config` |
| `ghui/config.json`  | [ghui](https://github.com/kitlangton/ghui) | `mise/workspace.toml` -> `npm:@kitlangton/ghui` | `~/.config/ghui/config.json` |
| `hunk/config.toml`  | [hunk](https://github.com/modem-dev/hunk) | `mise/workspace.toml` -> `hunk` | `~/.config/hunk/config.toml` |
| `omp/agent/config.yml`   | [omp](https://omp.sh) | `mise/workspace.toml` -> `github:can1357/oh-my-pi` | `~/.omp/agent/config.yml` |
| `omp/agent/extensions/`  | omp extensions | (config only) | `~/.omp/agent/extensions` |
| `skills/effect-setup/`   | [agent skill](https://github.com/anthropics/skills) | (config only) | `~/.agents/skills/effect-setup` |
| `skills/mise-setup/`     | agent skill | (config only) | `~/.agents/skills/mise-setup` |
| `mise/workspace.toml`     | (tool list) | — | `~/.config/mise/conf.d/workspace.toml` |

### Global tools

The CLI tools (herdr, neovim, hunk, ghui, omp) are declared in
[`mise/workspace.toml`](./mise/workspace.toml), which is symlinked to
`~/.config/mise/conf.d/workspace.toml`. mise loads `conf.d/*.toml` into the **global**
config, so the tools are active in every directory, not just this repo, and
your personal `~/.config/mise/config.toml` stays untouched. `mise bootstrap`
installs them from the merged config.

Only config is tracked. Runtime files (logs, sockets, `state.json`, caches,
`session.json`) stay out.

For **omp**, only non-secret config is tracked: `config.yml` and the
`extensions/` directory. OAuth credentials and runtime state stay in
`~/.omp/agent/agent.db` and related files; authenticate with `/login` or
provider environment variables after bootstrap.

**Skills** live in the shared `~/.agents/skills/` directory (read by omp and other
agents). That directory also holds skills installed by a skill manager, so each
tracked skill under [`skills/`](./skills) is symlinked individually rather than
linking the whole directory. Add a skill by dropping its folder in `skills/` and
adding a matching `[dotfiles]` entry in [`mise.toml`](./mise.toml).

## Install

From a fresh clone, run the install script. It installs mise if missing,
trusts the repo, and runs `mise bootstrap`. Re-running is safe:

```sh
./install.sh
```

The bootstrap process...

1. applies `[dotfiles]`, including the `conf.d/workspace.toml` global-tools link,
2. installs those tools (herdr, neovim, hunk, ghui, omp) into the global config,
3. runs the post-tools hook to install the Ghostty cask.

For dotfiles which are being symlinked, the install script will back up any existing files. Otherwise running the installer would be destructive.
