#!/usr/bin/env node
// Stdio MCP proxy for Codex's cua_repl server.
//
// cua_repl asks the client to approve each app ("Allow Computer Use to use
// Calculator?") through MCP form elicitation, and refuses to work when the
// client does not advertise it. Pi's MCP client has no elicitation support,
// so this proxy:
//   1. adds `capabilities.elicitation.form` to the client's `initialize`, and
//   2. answers `elicitation/create` requests itself by asking the pi extension
//      over a Unix socket ($COMPUTER_USE_APPROVAL_SOCKET); declines if unreachable.
// Every other message passes through untouched (newline-delimited JSON-RPC).
//
// Usage: node proxy.mjs <command> [...args]   (env is inherited)

import { spawn } from "node:child_process";
import { connect } from "node:net";
import { createInterface } from "node:readline";

const [command, ...args] = process.argv.slice(2);
if (!command) {
	console.error("computer-use proxy: missing server command");
	process.exit(2);
}

const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
child.on("error", (error) => {
	console.error(`computer-use proxy: cannot start ${command}: ${error.message}`);
	process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

const toServer = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);

function parse(line) {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

// Client (pi) -> server
createInterface({ input: process.stdin }).on("line", (line) => {
	const msg = parse(line);
	if (msg?.method === "initialize" && msg.params) {
		const caps = msg.params.capabilities ?? {};
		caps.elicitation = { ...caps.elicitation, form: {} };
		msg.params.capabilities = caps;
		return toServer(msg);
	}
	child.stdin.write(`${line}\n`);
});
process.stdin.on("end", () => child.stdin.end());

// Server -> client (pi)
createInterface({ input: child.stdout }).on("line", (line) => {
	const msg = parse(line);
	if (msg?.method === "elicitation/create" && msg.id !== undefined) {
		askExtension(msg.params ?? {}).then((result) => toServer({ jsonrpc: "2.0", id: msg.id, result }));
		return;
	}
	process.stdout.write(`${line}\n`);
});

/** Ask the pi extension for a decision; resolves to an ElicitResult. */
function askExtension(params) {
	const decline = { action: "decline" };
	const socketPath = process.env.COMPUTER_USE_APPROVAL_SOCKET;
	if (!socketPath) return Promise.resolve(decline);

	return new Promise((resolve) => {
		let buffer = "";
		const socket = connect(socketPath);
		const done = (result) => {
			socket.destroy();
			resolve(result);
		};
		socket.on("connect", () => socket.write(`${JSON.stringify(params)}\n`));
		socket.on("data", (chunk) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline >= 0) done(parse(buffer.slice(0, newline)) ?? decline);
		});
		socket.on("error", () => done(decline));
		socket.on("close", () => done(decline));
	});
}

// Keep the server informed if pi's stdout goes away.
process.stdout.on("error", () => child.kill());
