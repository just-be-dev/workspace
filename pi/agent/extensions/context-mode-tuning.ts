import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Two adjustments to context-mode (npm:context-mode), from 36 sessions of
 * usage data (Nov 2026). Both rely on local extensions loading before
 * packages, so this file is imported before context-mode.
 *
 * 1. Replace trigger. context-mode swaps any tool output over 4 KB for a
 *    ctx_search pointer. That hit 6% of tool calls (median 6.8 KB), and the
 *    agent mostly re-ran the command another way instead of searching. 16 KB
 *    matches context-mode's own one-read limit. It reads the variable once at
 *    import, so it is set here rather than in a shell profile: pi started by
 *    Sesh or another app doesn't inherit one. An explicit value still wins.
 *
 * 2. Unbounded reads of large files. context-mode denies a `read` with no
 *    offset/limit when the file is over 16 KB and points the agent at
 *    ctx_execute. The agent then edits a file it never read and the edit is
 *    rejected with "Edit without read" (20 denials, 15 rejected edits). A read
 *    with an explicit range is let through whole, so give those reads the
 *    limit `read` applies anyway (2000 lines): same text, no denial.
 *
 * If the load order ever changes, both stop working silently; the AGENTS.md
 * rule ("read files over 16 KB with offset/limit") is the fallback for 2.
 */
process.env.CTX_REPLACE_TRIGGER_BYTES ??= "16384";

const ONE_READ_LIMIT_BYTES = 16384; // context-mode OUTPUT_CAP
const READ_DEFAULT_LINES = 2000;

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "read") return;
		const input = event.input as { path?: unknown; offset?: unknown; limit?: unknown };
		if (typeof input.path !== "string" || input.offset != null || input.limit != null) return;
		try {
			const stat = statSync(resolve(ctx.cwd, input.path));
			if (stat.isFile() && stat.size > ONE_READ_LIMIT_BYTES) input.limit = READ_DEFAULT_LINES;
		} catch {
			// Missing or unreadable: let `read` report it.
		}
	});
}
