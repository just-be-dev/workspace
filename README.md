# adx: Agentic Development Experience

This is the configuration for the tools I use for agent driven development. 

I'm trending towards doing as much in the terminal as I can and biasing towards tools 
with high levels of customizability. 

Uses the fantasic [`mise`](https://mise.jdx.dev) to bootstrap everything.

## What's inside

| Path                | Tool | Installed by | Symlinked to |
| ------------------- | ---- | ------------ | ------------ |
| `herdr/config.toml` | [herdr](https://herdr.dev) | `mise/adx.toml` -> `herdr` | `~/.config/herdr/config.toml` |
| `nvim/`             | [LazyVim](https://lazyvim.org) | `mise/adx.toml` -> `neovim` | `~/.config/nvim` |
| `ghostty/config`    | [Ghostty](https://ghostty.org) | post-tools hook (`brew --cask`) | `~/.config/ghostty/config` |
| `ghui/config.json`  | [ghui](https://github.com/kitlangton/ghui) | `mise/adx.toml` -> `npm:@kitlangton/ghui` | `~/.config/ghui/config.json` |
| `hunk/config.toml`  | [hunk](https://github.com/modem-dev/hunk) | `mise/adx.toml` -> `hunk` | `~/.config/hunk/config.toml` |
| `mise/adx.toml`     | (tool list) | — | `~/.config/mise/conf.d/adx.toml` |

### Global tools

The CLI tools (herdr, neovim, hunk, ghui) are declared in
[`mise/adx.toml`](./mise/adx.toml), which is symlinked to
`~/.config/mise/conf.d/adx.toml`. mise loads `conf.d/*.toml` into the **global**
config, so the tools are active in every directory, not just this repo, and
your personal `~/.config/mise/config.toml` stays untouched. `mise bootstrap`
installs them from the merged config.

Only config is tracked. Runtime files (logs, sockets, `state.json`, caches,
`session.json`) stay out.

## Install

From a fresh clone, run the install script. It installs mise if missing,
trusts the repo, and runs `mise bootstrap`. Re-running is safe:

```sh
./install.sh
```

The bootstrap process...

1. applies `[dotfiles]`, including the `conf.d/adx.toml` global-tools link,
2. installs those tools (herdr, neovim, hunk, ghui) into the global config,
3. runs the post-tools hook to install the Ghostty cask.

`--force-dotfiles` is needed the first time because a real `~/.config/nvim`
directory must be replaced by the symlink. Re-running is idempotent.

`mise.toml` pins `min_version`, so mise refuses to run if it's too old for the
experimental `mise bootstrap` / `[dotfiles]` features. Bump it after upgrading
mise with `mise self-update`.

### Apply only the symlinks (skip tool installs)

```sh
mise dotfiles apply --force   # or: mise bootstrap --yes --only dotfiles
mise dotfiles status          # show applied / missing / differs
```

After installing:

- Reload Ghostty's config (**Cmd+Shift+,**) or restart the terminal.
- Launch `nvim` once so lazy.nvim syncs plugins (installs `diffview.nvim`).

## Notes

### Shift+Enter newline in pi (Ghostty)

pi already binds `tui.input.newLine` to `shift+enter` (and `ctrl+j`). The
problem is the terminal: by default Ghostty sends `[27;2;13~` for Shift+Enter,
which pi does not interpret as a newline. The packaged Ghostty config remaps it:

```
keybind = shift+enter=text:"\n"
```

This sends a raw newline (`\n`), which pi receives as `ctrl+j`, already mapped
to `tui.input.newLine`. So Shift+Enter inserts a newline while plain Enter
still submits.

### ghui "open in editor" → nvim + Diffview

In ghui, press `e` on a pull request to hand it off to your editor. The packaged
[`ghui/config.json`](./ghui/config.json) sets:

```json
"editorCommand": "cd {{repoPath}} && gh pr checkout {{number}} && nvim -c \"DiffviewOpen {{baseRef}}...{{headRef}}\""
```

This checks out the PR branch in its local clone and opens the diff against the
base branch using [`diffview.nvim`](./nvim/lua/plugins/diffview.lua), which the
packaged LazyVim config installs. `repoPaths` maps `:owner/:repo` to
`~/Code/:repo`; adjust it in `ghui/config.json` if you keep clones elsewhere.
