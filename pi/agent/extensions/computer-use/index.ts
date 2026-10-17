import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Registers Codex's bundled Computer Use REPL (the "cua_repl" MCP server that
// ships with the ChatGPT/Codex desktop app) as the "computer-use" MCP server.
// Command, args and env are read from the newest installed plugin version on
// every load, so app updates are picked up without editing this file.
//
// cua_repl asks for per-app approval via MCP form elicitation, which pi's MCP
// client doesn't support. The server is therefore launched through proxy.mjs,
// which advertises elicitation and forwards approval requests to this
// extension over a Unix socket; we answer them with a pi UI prompt.

const SERVER_NAME = "computer-use";
const SOURCE_ENTRY = "cua_repl";
const PLUGIN_DIR = join(homedir(), ".codex/plugins/cache/openai-bundled/unified-computer-use");
const PROXY = join(dirname(fileURLToPath(import.meta.url)), "proxy.mjs");
const APPROVALS_FILE = join(homedir(), ".pi/agent/computer-use-approvals.json");
const SOCKET_PATH = `/tmp/pi-computer-use-${process.pid}.sock`;

type CodexMcpEntry = {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	startup_timeout_sec?: number;
};

type ElicitParams = {
	message?: string;
	_meta?: {
		persist?: string[];
		riskLevel?: string;
		subtitle?: string;
		tool_name?: string;
		tool_params?: { app?: string };
		tool_params_display?: { display_name?: string; value?: string }[];
	};
};

type ElicitResult = { action: "accept" | "decline" | "cancel"; content?: Record<string, never>; _meta?: object };

/** Compare dotted numeric versions like "26.1007.21159". */
function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function loadEntry(): { version: string; entry: CodexMcpEntry } {
	const versions = readdirSync(PLUGIN_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(join(PLUGIN_DIR, d.name, ".mcp.json")))
		.map((d) => d.name)
		.sort(compareVersions);
	const version = versions.at(-1);
	if (!version) throw new Error(`no unified-computer-use version with .mcp.json in ${PLUGIN_DIR}`);

	let config: { mcpServers?: Record<string, unknown> };
	try {
		config = JSON.parse(readFileSync(join(PLUGIN_DIR, version, ".mcp.json"), "utf8"));
	} catch (error) {
		throw new Error(`cannot read ${version}/.mcp.json: ${(error as Error).message}`);
	}
	const entry = config?.mcpServers?.[SOURCE_ENTRY] as CodexMcpEntry | undefined;
	if (!entry?.command) throw new Error(`"${SOURCE_ENTRY}" missing from ${version}/.mcp.json`);
	return { version, entry };
}

function readAlwaysApproved(): Set<string> {
	try {
		const data = JSON.parse(readFileSync(APPROVALS_FILE, "utf8")) as { always?: string[] };
		return new Set(data.always ?? []);
	} catch {
		return new Set();
	}
}

function saveAlwaysApproved(keys: Set<string>): void {
	mkdirSync(dirname(APPROVALS_FILE), { recursive: true });
	writeFileSync(APPROVALS_FILE, `${JSON.stringify({ always: [...keys].sort() }, null, "\t")}\n`);
}

export default function (pi: ExtensionAPI) {
	let loaded: ReturnType<typeof loadEntry>;
	try {
		loaded = loadEntry();
	} catch (error) {
		// Codex/ChatGPT not installed on this machine: stay inert.
		pi.on("session_start", async (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(`computer-use: ${(error as Error).message}`, "warning");
		});
		return;
	}

	const { version, entry } = loaded;
	pi.registerMcpServer(SERVER_NAME, {
		command: process.execPath,
		args: [PROXY, entry.command, ...(entry.args ?? [])],
		env: { ...entry.env, COMPUTER_USE_APPROVAL_SOCKET: SOCKET_PATH },
		// Computer-use actions (screenshots, app launches, approvals) can be slow.
		timeout: Math.max(entry.startup_timeout_sec ?? 120, 120),
		// Codex enables only js/js_reset for the model (turn_ended is a host hook).
		toolExposure: { js: "codemode", js_reset: "codemode", "*": "hidden" },
		description: `Codex Computer Use (v${version}): control macOS desktop apps and browsers from a persistent JS REPL`,
	});

	// ---- Approval bridge -------------------------------------------------
	let ctx: ExtensionContext | undefined;
	let server: Server | undefined;
	let queue: Promise<unknown> = Promise.resolve();
	const sessionApproved = new Set<string>();

	async function decide(params: ElicitParams): Promise<ElicitResult> {
		const meta = params._meta ?? {};
		const key = meta.tool_params?.app ?? meta.tool_name ?? params.message ?? "unknown";
		if (sessionApproved.has(key) || readAlwaysApproved().has(key)) return { action: "accept", content: {} };
		if (!ctx?.hasUI) return { action: "decline" };

		const allowAlways = meta.persist?.includes("always") ?? false;
		const choices = ["Allow once", "Allow for this session", ...(allowAlways ? ["Always allow"] : []), "Deny"];
		const detail = [meta.subtitle, meta.riskLevel && `risk: ${meta.riskLevel}`, key].filter(Boolean).join(" · ");
		const choice = await ctx.ui.select(`${params.message ?? "Allow Computer Use?"}\n${detail}`, choices);

		switch (choice) {
			case "Allow once":
				return { action: "accept", content: {} };
			case "Allow for this session":
				sessionApproved.add(key);
				return { action: "accept", content: {}, _meta: { persist: "session" } };
			case "Always allow": {
				const always = readAlwaysApproved();
				always.add(key);
				saveAlwaysApproved(always);
				return { action: "accept", content: {}, _meta: { persist: "always" } };
			}
			case "Deny":
				return { action: "decline" };
			default:
				return { action: "cancel" };
		}
	}

	function closeServer() {
		server?.close();
		server = undefined;
		rmSync(SOCKET_PATH, { force: true });
	}

	pi.on("session_start", async (_event, nextCtx) => {
		ctx = nextCtx;
		if (server) return;
		rmSync(SOCKET_PATH, { force: true });
		server = createServer((socket) => {
			let buffer = "";
			socket.on("data", (chunk) => {
				buffer += chunk;
				const newline = buffer.indexOf("\n");
				if (newline < 0) return;
				let params: ElicitParams = {};
				try {
					params = JSON.parse(buffer.slice(0, newline));
				} catch {
					// Malformed request: fall through and let decide() decline/prompt generically.
				}
				// Serialize prompts so concurrent requests don't stack dialogs.
				const result = queue.then(() => decide(params));
				queue = result.catch(() => undefined);
				result
					.catch((): ElicitResult => ({ action: "decline" }))
					.then((res) => socket.end(`${JSON.stringify(res)}\n`));
			});
			socket.on("error", () => socket.destroy());
		});
		server.on("error", (error) => ctx?.hasUI && ctx.ui.notify(`computer-use approvals: ${error.message}`, "error"));
		server.listen(SOCKET_PATH);
	});

	pi.on("session_shutdown", async () => {
		ctx = undefined;
		closeServer();
	});
}
