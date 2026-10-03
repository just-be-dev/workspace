import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("native Pi keeps the selected model and effort across repeated clears", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-clear-rpc-"));
	const settings = JSON.stringify({
		defaultProvider: "anthropic",
		defaultModel: "claude-opus-5-5",
		defaultThinkingLevel: "high",
		enableInstallTelemetry: false,
	});
	writeFileSync(join(dir, "settings.json"), settings);
	const child = spawn("pi", [
		"--mode", "rpc", "--no-session", "--offline", "--no-extensions",
		"--no-skills", "--no-context-files",
		"-e", resolve(import.meta.dir, "../agent/extensions/clear-alias.ts"),
	], {
		cwd: dir,
		env: { ...process.env, PI_CODING_AGENT_DIR: dir, ANTHROPIC_API_KEY: "test-not-real" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	const exited = new Promise<void>((done) => child.once("close", () => done()));
	const pending = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void }>();
	const notifications: unknown[] = [];
	let buffer = "";
	let stderr = "";
	let seq = 0;
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	child.stdout.on("data", (chunk) => {
		buffer += chunk;
		while (buffer.includes("\n")) {
			const index = buffer.indexOf("\n");
			const line = buffer.slice(0, index);
			buffer = buffer.slice(index + 1);
			const record = JSON.parse(line);
			if (record.type === "extension_ui_request") notifications.push(record);
			const request = pending.get(record.id);
			if (record.type === "response" && request) {
				pending.delete(record.id);
				if (record.success) request.resolve(record.data);
				else request.reject(new Error(record.error));
			}
		}
	});
	child.on("error", (error) => {
		for (const request of pending.values()) request.reject(error);
	});
	child.on("close", () => {
		for (const request of pending.values()) request.reject(new Error(`Pi exited: ${stderr}`));
	});
	function rpc(type: string, args: object = {}): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = String(++seq);
			pending.set(id, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ id, type, ...args })}\n`);
		});
	}
	const timeout = setTimeout(() => {
		for (const request of pending.values()) request.reject(new Error(`RPC timed out: ${stderr}`));
		child.kill();
	}, 15_000);
	try {
		// No --model/--thinking flags: they would override the default again on
		// /new and make a broken implementation appear to preserve the model.
		expect((await rpc("get_state")).model.id).toBe("claude-opus-5-5");
		const selected = await rpc("set_model", { provider: "anthropic", modelId: "claude-sonnet-5" });
		await rpc("set_thinking_level", { level: "low" });
		await rpc("bash", { command: "printf 'old context'" });
		for (let i = 0; i < 2; i++) {
			expect((await rpc("prompt", { message: "/clear" })).disposition).toBe("handled");
			const state = await rpc("get_state");
			expect(state.model.id).toBe(selected.id);
			expect(state.thinkingLevel).toBe("low");
			expect((await rpc("get_messages")).messages).toEqual([]);
		}
		expect(notifications).toEqual([]);
		expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe(settings);
	} finally {
		clearTimeout(timeout);
		child.stdin.end();
		await exited;
		rmSync(dir, { recursive: true, force: true });
	}
}, 20_000);
