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
- **Cache health monitor** (`cache-health.ts`, wired in `index.ts`). Watches
  the usage on every response. It warns in the UI, adds a red "cache broken"
  footer status, and logs to `~/.pi/agent/cache-health.log` (headless runs and
  subagents print to stderr instead of the UI) when:
  - a request sends more than 8k uncached input tokens (healthy is about 2-4,
    since the tail is always a breakpoint), or
  - two warm requests in a row read less than half the previous prompt from
    cache (the prefix is changing between turns).
  Replayed over ~35k recorded requests: it fired on the first request of 294 of
  352 pre-fix sessions and never on healthy ones.
- **Regression tests** in `pi/tests/pi-sub-anthropic-cache.test.ts` send
  agent-loop requests through the real stream with a fake `fetch` and check
  the breakpoint layout, including that each request reads the previous one
  from cache through its last assistant turn. Reverting either half of the
  caching fix fails them. Run `bun test pi/tests` after touching `stream.ts`.

## Updating from upstream

Diff a new upstream release against 0.1.10, carry its changes over by hand, keep
the fix above (or drop it if upstream fixed the same bug), and bump the version
at the top of this file. Restart pi afterwards; `/reload` doesn't re-import
providers.
