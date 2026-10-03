import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../seed-settings.sh");
const source = resolve(import.meta.dir, "../agent/settings.json");
const dirs: string[] = [];
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "pi-settings-test-"));
	dirs.push(dir);
	return { dir, target: join(dir, "settings.json") };
}
function seed(dir: string) {
	const result = spawnSync("sh", [script, dir], { encoding: "utf8" });
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

test("existing machine-local settings survive repeated bootstrap", () => {
	const { dir, target } = fixture();
	const local = '{"defaultProvider":"openai-codex","defaultModel":"gpt-6.1-sol"}\n';
	writeFileSync(target, local);
	seed(dir);
	seed(dir);
	expect(readFileSync(target, "utf8")).toBe(local);
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
