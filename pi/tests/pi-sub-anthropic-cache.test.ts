import { describe, expect, mock, test } from "bun:test";
import { createCacheMonitor } from "../agent/extensions/pi-sub-anthropic/cache-health";

// pi ships as a compiled binary, so its packages aren't importable here. stream.ts
// needs only these two runtime values from pi-ai.
mock.module("@earendil-works/pi-ai", () => ({
	calculateCost: () => {},
	createAssistantMessageEventStream: () => {
		const events: any[] = [];
		let finish!: () => void;
		const done = new Promise<void>((resolve) => (finish = resolve));
		return { events, done, push: (e: any) => events.push(e), end: () => finish() };
	},
}));
const { createPiSubAnthropicStream } = await import("../agent/extensions/pi-sub-anthropic/stream");

const model = {
	id: "claude-opus-5-5",
	api: "anthropic-messages",
	provider: "pi-sub-anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	maxTokens: 128000,
	compat: { forceAdaptiveThinking: true },
} as any;

const tools = ["read", "bash", "edit"].map((name) => ({
	name,
	description: `${name} tool`,
	parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
}));

/** Send one request through the real provider stream and capture its JSON body. */
async function requestBody(messages: any[], apiKey: string): Promise<any> {
	let body: any;
	const fetch = async (_url: string, init: any) => {
		body = JSON.parse(Buffer.from(init.body).toString());
		const sse = [
			{ type: "message_start", message: { usage: {} } },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} },
			{ type: "message_stop" },
		]
			.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
			.join("");
		return new Response(sse, { headers: { "content-type": "text/event-stream" } });
	};
	const stream: any = createPiSubAnthropicStream()(
		model,
		{ systemPrompt: "You are a helpful harness. ".repeat(50), messages, tools } as any,
		{ apiKey, fetch, reasoning: "high" } as any,
	);
	await stream.done;
	const failed = stream.events.find((e: any) => e.type === "error");
	if (failed) throw new Error(failed.error.errorMessage ?? "stream error");
	return body;
}

type Block = { key: string; breakpoint: boolean };

/**
 * Flatten a request into Anthropic's cache order (tools, system, messages) with
 * one entry per content block. Keys drop cache_control and the per-request cch
 * attestation, which don't take part in prefix matching.
 */
function blocks(body: any): Block[] {
	const out: Block[] = [];
	const add = (where: string, block: any) => {
		const { cache_control, ...rest } = block;
		const key = `${where}:${JSON.stringify(rest).replace(/cch=[0-9a-f]+/, "cch=_")}`;
		out.push({ key, breakpoint: !!cache_control });
	};
	for (const t of body.tools ?? []) add("tool", t);
	for (const s of body.system ?? []) add("system", s);
	body.messages.forEach((m: any, i: number) => {
		const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
		for (const c of content) add(`${i}:${m.role}`, c);
	});
	return out;
}

/**
 * How many leading blocks of `before` a follow-up request `after` can read
 * from cache: the longest prefix that ends at a breakpoint in `before`, is
 * identical in `after`, and is covered by a breakpoint in `after` within
 * Anthropic's 20-block lookback.
 */
function reusedPrefix(before: Block[], after: Block[]): number {
	let same = 0;
	while (same < before.length && same < after.length && before[same].key === after[same].key) same++;
	for (let end = same; end > 0; end--) {
		if (!before[end - 1].breakpoint) continue;
		if (after.some((b, j) => b.breakpoint && j >= end - 1 && j - (end - 1) <= 20)) return end;
	}
	return 0;
}

// An agent loop: tool calls with thinking, plus the transient string-content
// user message pi-lens / context-mode append to every request (the shape that
// broke caching in Nov 2026).
const history: any[] = [{ role: "user", content: [{ type: "text", text: "Fix the bug in app.ts" }] }];
const transient = (n: number) => ({ role: "user", content: `[lens] turn ${n}: 0 findings` });
const turn = (n: number) => [
	{
		role: "assistant",
		api: "anthropic-messages",
		content: [
			{ type: "thinking", thinking: `plan ${n}`, thinkingSignature: `sig${n}` },
			{ type: "text", text: `Reading file ${n}` },
			{ type: "toolCall", id: `call_${n}`, name: "read", arguments: { path: `f${n}.ts` } },
		],
	},
	{
		role: "toolResult",
		toolCallId: `call_${n}`,
		toolName: "read",
		content: [{ type: "text", text: `contents of f${n}.ts `.repeat(200) }],
		isError: false,
	},
];

for (const [label, apiKey] of [
	["OAuth", "sk-ant-oat01-test"],
	["API key", "sk-ant-api03-test"],
] as const) {
	describe(`prompt caching (${label})`, () => {
		test("every request stays within 4 breakpoints and caches its tail", async () => {
			let messages = [...history];
			for (let n = 1; n <= 4; n++) {
				const b = blocks(await requestBody([...messages, transient(n)], apiKey));
				expect(b.filter((x) => x.breakpoint).length).toBeLessThanOrEqual(4);
				expect(b.at(-1)!.breakpoint).toBe(true);
				messages = [...messages, ...turn(n)];
			}
		});

		// The previous request's tail (last tool result + transient message) is
		// written again as part of the new prefix; everything through its last
		// assistant turn must be read. Before the fix only tools + system were.
		test("each request reads the previous one from cache through its last assistant turn", async () => {
			let messages = [...history];
			let previous: Block[] | undefined;
			let checked = 0;
			for (let n = 1; n <= 4; n++) {
				const current = blocks(await requestBody([...messages, transient(n)], apiKey));
				const anchor = previous?.findLastIndex((b) => b.key.includes(":assistant:")) ?? -1;
				if (previous && anchor >= 0) {
					expect(reusedPrefix(previous, current)).toBe(anchor + 1);
					checked++;
				}
				previous = current;
				messages = [...messages, ...turn(n)];
			}
			expect(checked).toBeGreaterThanOrEqual(2);
		});
	});
}

describe("cache monitor", () => {
	const t0 = Date.parse("2026-11-10T00:00:00Z");
	const at = (s: number) => t0 + s * 1000;
	const usage = (input: number, cacheRead: number, cacheWrite: number) => ({ input, cacheRead, cacheWrite });
	const sample = (s: number, u: ReturnType<typeof usage>, m = "claude-opus-5-5") => ({ model: m, usage: u, timestamp: at(s) });

	test("stays quiet on healthy traffic (real post-fix numbers)", () => {
		const mon = createCacheMonitor();
		const seq = [usage(4, 0, 41025), usage(2, 41025, 1800), usage(2, 42825, 950), usage(3, 43775, 12000)];
		for (const [i, u] of seq.entries()) expect(mon.observe(sample(i * 20, u))).toBeUndefined();
		expect(mon.unhealthy).toBe(false);
	});

	test("alerts on the first request that bills history as input (real pre-fix numbers)", () => {
		const mon = createCacheMonitor();
		const alert = mon.observe(sample(0, usage(11971, 0, 29312)));
		expect(alert?.kind).toBe("uncached");
		expect(mon.unhealthy).toBe(true);
		// No repeat while still broken, even with clean requests in between.
		expect(mon.observe(sample(10, usage(2, 41000, 500)))).toBeUndefined();
		expect(mon.observe(sample(20, usage(15020, 29312, 0)))).toBeUndefined();
	});

	test("alerts when the prefix churns: everything written, nothing read", () => {
		const mon = createCacheMonitor();
		expect(mon.observe(sample(0, usage(2, 0, 40000)))).toBeUndefined();
		expect(mon.observe(sample(10, usage(2, 1000, 41000)))).toBeUndefined();
		expect(mon.observe(sample(20, usage(2, 1000, 42000)))?.kind).toBe("misses");
	});

	test("ignores misses that are expected: cache expiry, compaction, model switch", () => {
		const mon = createCacheMonitor();
		mon.observe(sample(0, usage(2, 0, 40000)));
		expect(mon.observe(sample(600, usage(2, 0, 41000)))).toBeUndefined(); // > 5 min idle
		expect(mon.observe(sample(610, usage(2, 0, 9000)))).toBeUndefined(); // compacted
		expect(mon.observe(sample(620, usage(2, 0, 9500), "claude-sonnet-5-5"))).toBeUndefined();
		expect(mon.observe(sample(630, usage(2, 0, 9900), "claude-opus-5-5"))).toBeUndefined();
		expect(mon.unhealthy).toBe(false);
	});

	test("re-alerts after recovering", () => {
		const mon = createCacheMonitor({ recoverAfter: 3 });
		expect(mon.observe(sample(0, usage(20000, 0, 30000)))).toBeDefined();
		for (let i = 1; i <= 3; i++) mon.observe(sample(i * 10, usage(2, 50000 + i, 100)));
		expect(mon.unhealthy).toBe(false);
		expect(mon.observe(sample(50, usage(20000, 30000, 0)))?.kind).toBe("uncached");
	});
});
