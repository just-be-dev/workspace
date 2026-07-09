import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import herdrTabTitle from "./herdr-tab-title.ts";

type Handler = (event?: unknown, ctx?: unknown) => void | Promise<void>;
type HerdrCall = ["tab", "rename", string, string];
type EnvKey = "HERDR_ENV" | "HERDR_TAB_ID" | "HERDR_PANE_ID" | "HERDR_BIN_PATH" | "HERDR_CAPTURE_PATH";

const envKeys: EnvKey[] = [
  "HERDR_ENV",
  "HERDR_TAB_ID",
  "HERDR_PANE_ID",
  "HERDR_BIN_PATH",
  "HERDR_CAPTURE_PATH",
];

let originalEnv: Partial<Record<EnvKey, string | undefined>> = {};
let cleanupDirs: string[] = [];

beforeEach(() => {
  originalEnv = {};
  cleanupDirs = [];
  for (const key of envKeys) {
    originalEnv[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setupHerdr() {
  const dir = mkdtempSync(join(tmpdir(), "herdr-tab-title-"));
  cleanupDirs.push(dir);

  const binPath = join(dir, "herdr-fake");
  const capturePath = join(dir, "calls.txt");
  writeFileSync(
    binPath,
    ["#!/bin/sh", `printf '%s\\n' "$@" >> ${JSON.stringify(capturePath)}`].join("\n"),
  );
  chmodSync(binPath, 0o755);

  process.env.HERDR_ENV = "1";
  process.env.HERDR_TAB_ID = "tab-123";
  delete process.env.HERDR_PANE_ID;
  process.env.HERDR_BIN_PATH = binPath;
  process.env.HERDR_CAPTURE_PATH = capturePath;

  return { capturePath, dir };
}

function registerExtension(sessionName = "dev layout") {
  const handlers = new Map<string, Handler>();
  const omp = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    getSessionName() {
      return sessionName;
    },
  };

  herdrTabTitle(omp);

  return {
    async emit(event: string, payload?: unknown, ctx?: unknown) {
      const handler = handlers.get(event);
      if (!handler) {
        throw new Error(`No handler registered for ${event}`);
      }
      await handler(payload, ctx);
    },
  };
}

function readHerdrCalls(capturePath: string): HerdrCall[] {
  if (!existsSync(capturePath)) {
    return [];
  }

  const lines = readFileSync(capturePath, "utf8").split("\n").filter(Boolean);
  const calls: HerdrCall[] = [];
  for (let index = 0; index < lines.length; index += 4) {
    calls.push(lines.slice(index, index + 4) as HerdrCall);
  }
  return calls;
}

test("title_change renames the current Herdr tab to the normalized event title", async () => {
  const { capturePath } = setupHerdr();
  const omp = registerExtension();

  await omp.emit("title_change", {
    type: "title_change",
    title: "  “Ship\t tab\nsync!”  ",
  });

  expect(readHerdrCalls(capturePath)).toEqual([
    ["tab", "rename", "tab-123", "Ship tab sync"],
  ]);
});

test("session_start renames from the current session file title", async () => {
  const { capturePath, dir } = setupHerdr();
  const sessionFile = join(dir, "session.ndjson");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session_start", cwd: dir }),
      JSON.stringify({ type: "title", title: "  Session\tfile\ntitle  " }),
    ].join("\n"),
  );
  const omp = registerExtension();

  await omp.emit(
    "session_start",
    { type: "session_start" },
    { sessionManager: { getSessionFile: () => sessionFile } },
  );

  expect(readHerdrCalls(capturePath)).toEqual([
    ["tab", "rename", "tab-123", "Session file title"],
  ]);
});

test("session_start with empty or missing titles does not rename to the layout name", async () => {
  const { capturePath, dir } = setupHerdr();
  const sessionFile = join(dir, "session.ndjson");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "title", title: "  \t\n  " }),
      JSON.stringify({ type: "title_change" }),
    ].join("\n"),
  );
  const omp = registerExtension("dev layout");

  await omp.emit(
    "session_start",
    { type: "session_start", title: "   " },
    { sessionManager: { getSessionFile: () => sessionFile } },
  );

  expect(readHerdrCalls(capturePath)).toEqual([]);
});
