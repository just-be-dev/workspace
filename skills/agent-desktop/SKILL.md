---
name: agent-desktop
description: >
  Computer use: see and operate desktop apps (macOS, Linux, Windows) through the OS accessibility
  tree with the agent-desktop CLI. Use when a task needs a GUI: click buttons, fill forms, read UI
  state, navigate menus, toggle checkboxes, scroll, drag, type text, press shortcuts, take
  screenshots, manage apps and windows, use the clipboard, or read notifications.
---

# agent-desktop

`agent-desktop` (<https://github.com/vercel-labs/agent-desktop>) is a CLI, run through the shell
tool. Every command prints one JSON envelope with `ok` and either `data` or `error`. The
observe → act → verify loop runs in you.

The real guide is compiled into the binary so it always matches the installed version. Before
the first desktop action in a session, load it instead of guessing flags:

```sh
agent-desktop status                                          # platform, permissions, surfaces
agent-desktop skills get desktop  | jq -r '.data.content'     # loop, refs, verification, retry rules
agent-desktop skills get platform | jq -r '.data.content'     # what differs on this OS
```

Load references only when needed (`agent-desktop skills get desktop workflows`,
`commands-observation`, `commands-interaction`, `commands-system`), and use
`agent-desktop <command> --help` for flags.

Core loop, for orientation only — follow the loaded guide:

```sh
agent-desktop snapshot --skeleton --app "Notes" -i --compact   # map the app; every actionable element gets a ref
agent-desktop snapshot --root @s8f3k2p9:e3 -i --compact        # drill into one region
agent-desktop click @s8f3k2p9:e12                              # act on a snapshot-qualified ref
agent-desktop snapshot --root @s8f3k2p9:e3 -i --compact        # verify by re-reading
```

- Refs belong to their snapshot; on `STALE_REF` or `AMBIGUOUS_TARGET`, snapshot again.
- Retry only when `error.disposition.retry` is `safe`.
- Headless by default (no pointer movement or focus stealing); `--headed` allows physical input.
- If `status` reports `accessibility: denied`, run `agent-desktop permissions --guide` and ask the
  user to grant the launching app (terminal / Sesh) Accessibility (and Screen Recording for
  screenshots). Do not try to work around missing permissions.
- Snapshots, screenshots and clipboard contents can contain private data; keep them out of
  commits, logs and uploads.
