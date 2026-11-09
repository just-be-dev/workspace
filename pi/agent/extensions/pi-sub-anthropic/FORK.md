# pi-sub-anthropic (local fork)

Vendored from [`pi-sub-anthropic`](https://github.com/spksoft/pi-sub-anthropic)
**0.1.10** (MIT, see `LICENSE`) so `pi update` can't replace it. It loads as a
plain extension directory, so it must NOT also be listed in `packages`, or the
provider registers twice.

## Changes from upstream

- **Prompt caching with extension-appended messages** (`stream.ts`,
  `applyMessageCacheBreakpoints`). Upstream only marks the last message for
  caching when its content is an array. pi-lens (turn findings) and
  context-mode (memory) append transient user messages with *string* content,
  so those requests had no message-level breakpoint at all: `cacheRead` stuck
  at the system prompt, `cacheWrite` 0, and the whole history billed as fresh
  input (hundreds of dollars a day on long Opus sessions). Now a string tail is
  promoted to a cached text block, as pi's built-in anthropic provider does, and
  the newest assistant message gets a second breakpoint so the next request
  still has a stable prefix to hit when the transient tail changes.

## Updating from upstream

Diff a new upstream release against 0.1.10, carry its changes over by hand, keep
the fix above (or drop it if upstream fixed the same bug), and bump the version
at the top of this file. Restart pi afterwards; `/reload` doesn't re-import
providers.
