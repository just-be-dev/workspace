import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_TAB_LABEL_LENGTH = 28;
const TITLE_SYNC_DELAYS_MS = [0, 100, 500, 1500];

type Timer = {
  unref?: () => void;
};


type EventHandler = (event: unknown, ctx: unknown) => void | Promise<void>;

type ExtensionAPI = {
  on(event: string, handler: EventHandler): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeTitle(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s'"`“”‘’()[\]{}:;,.!?-]+/, "")
    .replace(/[\s'"`“”‘’()[\]{}:;,.!?-]+$/, "")
    .trim();

  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length <= MAX_TAB_LABEL_LENGTH) {
    return normalized;
  }

  const wordBoundary = normalized.lastIndexOf(" ", MAX_TAB_LABEL_LENGTH - 1);
  const end = wordBoundary >= 12 ? wordBoundary : MAX_TAB_LABEL_LENGTH - 1;
  return `${normalized.slice(0, end).trimEnd()}…`;
}

function recordTitle(record: Record<string, unknown>): string | undefined {
  const directTitle = normalizeTitle(record.title);
  if (directTitle) {
    return directTitle;
  }

  const directName = normalizeTitle(record.name);
  if (directName) {
    return directName;
  }

  if (isRecord(record.session)) {
    return recordTitle(record.session);
  }

  return undefined;
}

function eventTitle(event: unknown): string | undefined {
  return isRecord(event) ? recordTitle(event) : undefined;
}

function sessionFilePath(ctx: unknown): string | undefined {
  if (!isRecord(ctx) || !isRecord(ctx.sessionManager)) {
    return undefined;
  }

  let sessionFile: unknown;
  try {
    sessionFile = ctx.sessionManager.getSessionFile?.();
  } catch {
    return undefined;
  }

  return typeof sessionFile === "string" && sessionFile.startsWith("/")
    ? sessionFile
    : undefined;
}

function titleFromSessionFile(sessionFile: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(sessionFile, "utf8");
  } catch {
    return undefined;
  }

  for (const line of content.split(/\r?\n/, 20)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry: unknown = JSON.parse(line);
      if (isRecord(entry)) {
        const title = recordTitle(entry);
        if (title) {
          return title;
        }
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function sessionFileTitle(ctx: unknown): string | undefined {
  const sessionFile = sessionFilePath(ctx);
  return sessionFile ? titleFromSessionFile(sessionFile) : undefined;
}



function herdr(args: string[]) {
  return spawnSync(process.env.HERDR_BIN_PATH || "herdr", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tabIdFromPane(): string | undefined {
  const paneId = process.env.HERDR_PANE_ID;
  if (!paneId) {
    return undefined;
  }

  const result = herdr(["pane", "get", paneId]);
  if (result.status !== 0 || !result.stdout) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !("result" in parsed)) {
    return undefined;
  }
  const resultBody = parsed.result;
  if (!isRecord(resultBody)) {
    return undefined;
  }

  if ("pane" in resultBody) {
    const pane = resultBody.pane;
    if (isRecord(pane) && typeof pane.tab_id === "string") {
      return pane.tab_id;
    }
  }

  if (typeof resultBody.tab_id === "string") {
    return resultBody.tab_id;
  }

  return undefined;
}

function currentTabId(): string | undefined {
  const envTabId = process.env.HERDR_TAB_ID;
  if (envTabId) {
    return envTabId;
  }
  return tabIdFromPane();
}

let lastTabName: string | undefined;

function renameHerdrTab(name: string): void {
  if (process.env.HERDR_ENV !== "1" || name === lastTabName) {
    return;
  }

  const tabId = currentTabId();
  if (!tabId) {
    return;
  }

  const result = herdr(["tab", "rename", tabId, name]);
  if (result.status === 0) {
    lastTabName = name;
  }
}

function syncTitle(name: string | undefined): void {
  if (name) {
    renameHerdrTab(name);
  }
}

function syncEventOrSessionTitle(event: unknown, ctx: unknown): void {
  syncTitle(eventTitle(event) || sessionFileTitle(ctx));
}

function scheduleSessionFileTitleSync(ctx: unknown): void {
  const sessionFile = sessionFilePath(ctx);
  if (!sessionFile) {
    return;
  }

  for (const delayMs of TITLE_SYNC_DELAYS_MS) {
    const timer = setTimeout(() => {
      syncTitle(titleFromSessionFile(sessionFile));
    }, delayMs) as Timer;
    timer.unref?.();
  }
}

function syncNowAndAfterTitleRewrites(event: unknown, ctx: unknown): void {
  syncEventOrSessionTitle(event, ctx);
  scheduleSessionFileTitleSync(ctx);
}


export default function herdrTabTitle(omp: ExtensionAPI) {
  omp.on("session_start", syncNowAndAfterTitleRewrites);
  omp.on("session_switch", syncNowAndAfterTitleRewrites);

  omp.on("agent_start", (_event, ctx) => {
    scheduleSessionFileTitleSync(ctx);
  });

  omp.on("tool_execution_start", (_event, ctx) => {
    scheduleSessionFileTitleSync(ctx);
  });

  omp.on("tool_execution_end", (_event, ctx) => {
    scheduleSessionFileTitleSync(ctx);
  });

  omp.on("agent_end", (_event, ctx) => {
    scheduleSessionFileTitleSync(ctx);
  });

  omp.on("title_change", syncEventOrSessionTitle);
  omp.on("session_info_changed", syncEventOrSessionTitle);
}
