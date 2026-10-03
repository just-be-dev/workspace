import { describe, expect, test } from "bun:test";
import clearAlias from "../agent/extensions/clear-alias";

type Model = { provider: string; id: string };
const opus: Model = { provider: "anthropic", id: "claude-opus-5-5" };
const gpt: Model = { provider: "openai-codex", id: "gpt-6.1-sol" };

// Simulate Pi 1.0: /new creates a fresh extension runtime, then runs setup
// and session_start. The old pi/ctx are invalid after replacement.
function harness(options: {
	model?: Model;
	thinking?: string;
	cancelled?: boolean;
	available?: boolean;
	auth?: boolean;
} = {}) {
	let model = options.model;
	let thinking = options.thinking ?? "xhigh";
	let entries: any[] = [{ type: "message", message: { content: "old conversation" } }];
	const notices: string[] = [];
	const changes: string[] = [];
	let start: ((event: any, ctx: any) => Promise<void>) | undefined;
	let command: ((args: string, ctx: any) => Promise<void>) | undefined;
	let sessions = 0;
	const defaults = { model: opus, thinking: "high" };

	function load() {
		const generation = sessions;
		const assertFresh = () => {
			if (generation !== sessions) throw new Error("Stale extension API");
		};
		const pi = {
			registerCommand: (_name: string, config: any) => { command = config.handler; },
			on: (_name: string, handler: any) => { start = handler; },
			getThinkingLevel: () => { assertFresh(); return thinking; },
			setThinkingLevel: (level: string) => {
				assertFresh(); thinking = level; changes.push("thinking");
			},
			setModel: async (value: Model) => {
				assertFresh();
				if (options.auth === false) return false;
				model = value; changes.push("model"); return true;
			},
		};
		clearAlias(pi as never);
	}

	function context() {
		const generation = sessions;
		return {
			get model() {
				if (generation !== sessions) throw new Error("Stale command context");
				return model;
			},
			hasUI: true,
			ui: { notify: (message: string) => notices.push(message) },
			sessionManager: { getEntries: () => entries },
			modelRegistry: { find: (provider: string, id: string) =>
				options.available === false ? undefined : { provider, id } },
			newSession: async (settings?: any) => {
				if (options.cancelled) return { cancelled: true };
				sessions++;
				model = defaults.model;
				thinking = defaults.thinking;
				entries = [];
				load();
				await settings?.setup?.({ appendCustomEntry: (customType: string, data: unknown) =>
					entries.push({ type: "custom", customType, data }) });
				await start?.({ reason: "new" }, context());
				return { cancelled: false };
			},
		};
	}

	load();
	return {
		clear: () => command!("", context()),
		start: (reason: string) => start?.({ reason }, context()),
		get model() { return model; },
		get thinking() { return thinking; },
		get entries() { return entries; },
		notices,
		changes,
	};
}

describe("/clear", () => {
	test("keeps the selected model and effort, not the startup defaults", async () => {
		const session = harness({ model: gpt });
		await session.clear();
		expect(session.model).toEqual(gpt);
		expect(session.thinking).toBe("xhigh");
		expect(session.entries.every((entry) => entry.type !== "message")).toBe(true);
		expect(session.changes).toEqual(["model", "thinking"]);
	});

	test("works on repeated clears with fresh extension APIs", async () => {
		const session = harness({ model: gpt, thinking: "low" });
		await session.clear();
		await session.clear();
		expect(session.model).toEqual(gpt);
		expect(session.thinking).toBe("low");
	});

	test("does not replace the session if another extension cancels", async () => {
		const session = harness({ model: gpt, cancelled: true });
		await session.clear();
		expect(session.model).toEqual(gpt);
		expect(session.entries[0].type).toBe("message");
		expect(session.changes).toEqual([]);
	});

	test("uses normal defaults when no model was selected", async () => {
		const session = harness();
		await session.clear();
		expect(session.model).toEqual(opus);
		expect(session.changes).toEqual([]);
	});

	test("does not reapply the captured model on resume or reload", async () => {
		const session = harness({ model: gpt });
		await session.clear();
		session.changes.length = 0;
		await session.start("resume");
		await session.start("reload");
		expect(session.changes).toEqual([]);
	});

	for (const failure of ["available", "auth"] as const) {
		test(`warns when the previous model is no longer ${failure}`, async () => {
			const session = harness({ model: gpt, [failure]: false });
			await session.clear();
			expect(session.notices).toHaveLength(1);
			expect(session.model).toEqual(opus);
			expect(session.changes).toEqual([]);
		});
	}
});
