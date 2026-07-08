#!/usr/bin/env bun
import { $ } from "bun";

const LAYOUT_LABEL = "dev layout";
const HERDR = process.env.HERDR_BIN_PATH || "herdr";

type JsonObject = Record<string, unknown>;

const decoder = new TextDecoder();

function fail(message: string): never {
  console.error(`dev-layout: ${message}`);
  process.exit(1);
}


async function runHerdr(args: string[]): Promise<string> {
  const result = await $`${HERDR} ${args}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = decoder.decode(result.stderr).trim();
    const stdout = decoder.decode(result.stdout).trim();
    const details = stderr || stdout || "no output";
    fail(`herdr ${args.join(" ")} failed: ${details}`);
  }
  return decoder.decode(result.stdout);
}

async function runJson(args: string[]): Promise<JsonObject> {
  const output = await runHerdr(args);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    fail(`herdr ${args.join(" ")} returned invalid JSON: ${String(error)}: ${JSON.stringify(output)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`herdr ${args.join(" ")} returned non-object JSON: ${JSON.stringify(parsed)}`);
  }
  return parsed as JsonObject;
}

function requirePath(payload: JsonObject, ...path: string[]): string {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(key in current)) {
      fail(`missing JSON path ${path.join(".")} in ${JSON.stringify(payload)}`);
    }
    current = (current as JsonObject)[key];
  }
  if (typeof current !== "string" || current.length === 0) {
    fail(`JSON path ${path.join(".")} was not a non-empty string in ${JSON.stringify(payload)}`);
  }
  return current;
}

async function split(
  paneId: string,
  direction: "right" | "down",
  options: { ratio?: string; focus?: boolean } = {},
): Promise<string> {
  const payload = await runJson([
    "pane",
    "split",
    paneId,
    "--direction",
    direction,
    "--ratio",
    options.ratio ?? "0.5",
    options.focus ? "--focus" : "--no-focus",
  ]);
  return requirePath(payload, "result", "pane", "pane_id");
}


async function main(): Promise<void> {
  const tabArgs = ["tab", "create", "--label", LAYOUT_LABEL, "--focus"];
  const workspaceId = process.env.HERDR_WORKSPACE_ID;
  if (workspaceId) {
    tabArgs.splice(2, 0, "--workspace", workspaceId);
  }

  const tab = await runJson(tabArgs);
  const topLeft = requirePath(tab, "result", "root_pane", "pane_id");

  const topRight = await split(topLeft, "right");
  const bottomLeft = await split(topLeft, "down", { ratio: "0.8", focus: true });
  const bottomRight = await split(topRight, "down");

  await runHerdr(["pane", "rename", topLeft, "omp"]);
  await runHerdr(["pane", "rename", topRight, "but tui"]);
  await runHerdr(["pane", "rename", bottomRight, "ghui"]);
  await runHerdr(["pane", "rename", bottomLeft, "terminal"]);

  await runHerdr(["pane", "run", topLeft, "omp"]);
  await runHerdr(["pane", "run", topRight, "but tui"]);
  await runHerdr(["pane", "run", bottomRight, "ghui"]);
}

await main();
