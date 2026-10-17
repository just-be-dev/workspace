import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../seed-settings.sh");
const source = resolve(import.meta.dir, "../agent/settings.json");
const dirs: string[] = [];
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "pi-settings-test-"));
	dirs.push(dir);
	return { dir, target: join(dir, "settings.json") };
}
function seed(dir: string, bootstrap = script) {
	const result = spawnSync("sh", [bootstrap, dir], { encoding: "utf8" });
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("new installs get a local file with Opus 5.5", () => {
	const { dir } = fixture();
	const nested = join(dir, "agent");
	seed(nested);
	const target = join(nested, "settings.json");
	expect(lstatSync(target).isSymbolicLink()).toBe(false);
	expect(JSON.parse(readFileSync(target, "utf8"))).toMatchObject({
		defaultProvider: "anthropic", defaultModel: "claude-opus-5-5",
	});
	expect(readFileSync(target, "utf8")).toBe(readFileSync(source, "utf8"));
});

test("bootstrap syncs packages while preserving every machine-local preference", () => {
	const { dir, target } = fixture();
	const local = {
		defaultProvider: "openai-codex", defaultModel: "gpt-6.1-sol",
		defaultThinkingLevel: "max", theme: "system", lastChangelogVersion: "local",
		compaction: { enabled: false }, extensions: ["./local-extension.ts"],
		packages: ["npm:local-only"],
	};
	writeFileSync(target, JSON.stringify(local));
	chmodSync(target, 0o600);
	seed(dir);
	const synced = readFileSync(target, "utf8");
	expect(JSON.parse(synced)).toEqual({
		...local, packages: JSON.parse(readFileSync(source, "utf8")).packages,
	});
	expect(statSync(target).mode & 0o777).toBe(0o600);
	seed(dir);
	expect(readFileSync(target, "utf8")).toBe(synced);
});

test("the old workspace symlink migrates without changing shared settings", () => {
	const { dir, target } = fixture();
	const before = readFileSync(source, "utf8");
	symlinkSync(source, target);
	seed(dir);
	expect(lstatSync(target).isSymbolicLink()).toBe(false);
	expect(readFileSync(target, "utf8")).toBe(before);
	writeFileSync(target, '{"defaultModel":"gpt-6.1-sol"}');
	seed(dir);
	expect(readFileSync(source, "utf8")).toBe(before);
	expect(JSON.parse(readFileSync(target, "utf8")).defaultModel).toBe("gpt-6.1-sol");
});

test("an unrelated settings symlink is left alone", () => {
	const { dir, target } = fixture();
	const unrelated = join(dir, "my-settings.json");
	writeFileSync(unrelated, "{}");
	symlinkSync(unrelated, target);
	seed(dir);
	expect(lstatSync(target).isSymbolicLink()).toBe(true);
	expect(readFileSync(target, "utf8")).toBe("{}");
});

test("an unrelated broken symlink is not clobbered", () => {
	const { dir, target } = fixture();
	symlinkSync(join(dir, "missing.json"), target);
	seed(dir);
	expect(lstatSync(target).isSymbolicLink()).toBe(true);
	expect(existsSync(target)).toBe(false);
});

function workspaceFixture(packages: unknown, mcpServers: unknown = {}) {
	const { dir, target } = fixture();
	const workspace = join(dir, "workspace", "pi");
	mkdirSync(join(workspace, "agent"), { recursive: true });
	const bootstrap = join(workspace, "seed-settings.sh");
	const manifest = join(workspace, "agent", "settings.json");
	const mcpManifest = join(workspace, "agent", "mcp.json");
	copyFileSync(script, bootstrap);
	for (const file of ["local-config.mjs", "sync-packages.mjs", "sync-mcp.mjs"]) {
		copyFileSync(join(dirname(script), file), join(workspace, file));
	}
	writeFileSync(manifest, JSON.stringify({ defaultModel: "shared-default", packages }));
	writeFileSync(mcpManifest, JSON.stringify({ mcpServers }));
	return { dir, target, bootstrap, manifest, mcpManifest, mcpTarget: join(dir, "mcp.json") };
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const shared = { url: "https://shared.example/mcp", description: "shared" };

test("new installs get a local MCP file with the repo's servers", () => {
	const { dir } = fixture();
	seed(dir);
	const target = join(dir, "mcp.json");
	expect(lstatSync(target).isSymbolicLink()).toBe(false);
	const servers = readJson(resolve(import.meta.dir, "../agent/mcp.json")).mcpServers;
	expect(readJson(target)).toEqual({ mcpServers: servers, workspaceManagedServers: Object.keys(servers) });
});

test("the old MCP symlink migrates without changing the shared file", () => {
	const f = workspaceFixture([], { shared });
	const before = readFileSync(f.mcpManifest, "utf8");
	symlinkSync(f.mcpManifest, f.mcpTarget);
	seed(f.dir, f.bootstrap);
	expect(lstatSync(f.mcpTarget).isSymbolicLink()).toBe(false);
	expect(readFileSync(f.mcpManifest, "utf8")).toBe(before);
	expect(readJson(f.mcpTarget)).toEqual({ mcpServers: { shared }, workspaceManagedServers: ["shared"] });
});

test("MCP sync keeps machine-only servers and local toggles, and propagates removals", () => {
	const f = workspaceFixture([], { shared, gone: { url: "https://gone.example/mcp" } });
	const linear = { url: "https://mcp.linear.app/mcp" };
	writeFileSync(f.mcpTarget, JSON.stringify({
		autoEnableCodemode: false,
		mcpServers: { linear, shared: { url: "https://old.example/mcp", enabled: false, exposure: "direct" } },
	}));
	seed(f.dir, f.bootstrap);
	expect(readJson(f.mcpTarget)).toEqual({
		autoEnableCodemode: false,
		mcpServers: { linear, shared: { ...shared, enabled: false, exposure: "direct" }, gone: { url: "https://gone.example/mcp" } },
		workspaceManagedServers: ["shared", "gone"],
	});
	const synced = readFileSync(f.mcpTarget, "utf8");
	seed(f.dir, f.bootstrap);
	expect(readFileSync(f.mcpTarget, "utf8")).toBe(synced);
	writeFileSync(f.mcpManifest, JSON.stringify({ mcpServers: { shared } }));
	seed(f.dir, f.bootstrap);
	expect(readJson(f.mcpTarget).mcpServers).toEqual({ linear, shared: { ...shared, enabled: false, exposure: "direct" } });
	expect(readJson(f.mcpTarget).workspaceManagedServers).toEqual(["shared"]);
});

test("malformed local MCP config fails without overwriting the file", () => {
	const f = workspaceFixture([], { shared });
	const local = '{ "mcpServers":';
	writeFileSync(f.mcpTarget, local);
	const result = spawnSync("sh", [f.bootstrap, f.dir], { encoding: "utf8" });
	expect(result.status).not.toBe(0);
	expect(readFileSync(f.mcpTarget, "utf8")).toBe(local);
});

test("repo package additions, removals and resource filters reach existing machines", () => {
	const f = workspaceFixture(["npm:first"]);
	writeFileSync(f.target, JSON.stringify({ defaultModel: "local", packages: [] }));
	seed(f.dir, f.bootstrap);
	expect(JSON.parse(readFileSync(f.target, "utf8")).packages).toEqual(["npm:first"]);
	const packages = [{ source: "npm:second@1.0.0", extensions: ["index.ts"], skills: [] }];
	writeFileSync(f.manifest, JSON.stringify({ defaultModel: "changed-shared-default", packages }));
	seed(f.dir, f.bootstrap);
	expect(JSON.parse(readFileSync(f.target, "utf8"))).toEqual({ defaultModel: "local", packages });
	expect(JSON.parse(readFileSync(f.manifest, "utf8")).defaultModel).toBe("changed-shared-default");
	writeFileSync(f.manifest, JSON.stringify({ packages: [] }));
	seed(f.dir, f.bootstrap);
	expect(JSON.parse(readFileSync(f.target, "utf8")).packages).toEqual([]);
});

test("matching package lists do not rewrite local formatting", () => {
	const f = workspaceFixture(["npm:first"]);
	const local = '{ "theme": "system", "packages": ["npm:first"] }\n';
	writeFileSync(f.target, local);
	seed(f.dir, f.bootstrap);
	expect(readFileSync(f.target, "utf8")).toBe(local);
});

test("malformed local settings fail without overwriting the file", () => {
	const f = workspaceFixture(["npm:first"]);
	const local = '{ "defaultModel":';
	writeFileSync(f.target, local);
	const result = spawnSync("sh", [f.bootstrap, f.dir], { encoding: "utf8" });
	expect(result.status).not.toBe(0);
	expect(readFileSync(f.target, "utf8")).toBe(local);
});

test("invalid shared packages do not seed a new settings file", () => {
	const f = workspaceFixture([{}]);
	const result = spawnSync("sh", [f.bootstrap, f.dir], { encoding: "utf8" });
	expect(result.status).not.toBe(0);
	expect(existsSync(f.target)).toBe(false);
});

test("sync uses PI_CODING_AGENT_DIR when no directory argument is given", () => {
	const f = workspaceFixture(["npm:first"]);
	const result = spawnSync("sh", [f.bootstrap], {
		encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: f.dir },
	});
	expect(result.status).toBe(0);
	expect(JSON.parse(readFileSync(f.target, "utf8")).packages).toEqual(["npm:first"]);
});

test("invalid shared packages fail without overwriting local settings", () => {
	for (const packages of ["not-an-array", [null], [{}], [""]]) {
		const f = workspaceFixture(packages);
		const local = '{"defaultModel":"local","packages":["npm:keep"]}';
		writeFileSync(f.target, local);
		const result = spawnSync("sh", [f.bootstrap, f.dir], { encoding: "utf8" });
		expect(result.status).not.toBe(0);
		expect(readFileSync(f.target, "utf8")).toBe(local);
	}
});
