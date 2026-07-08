import { spawnSync } from "node:child_process";

const MAX_TAB_LABEL_LENGTH = 28;

type EventHandler = (event: unknown, ctx: unknown) => void | Promise<void>;

type ExtensionAPI = {
  on(event: string, handler: EventHandler): void;
  getSessionName?(): string | undefined;
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

function eventName(event: unknown): string | undefined {
  if (!isRecord(event) || !("name" in event)) {
    return undefined;
  }
  return normalizeTitle(event.name);
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

function renameHerdrTab(name: string): void {
  if (process.env.HERDR_ENV !== "1") {
    return;
  }

  const tabId = currentTabId();
  if (!tabId) {
    return;
  }

  herdr(["tab", "rename", tabId, name]);
}

export default function herdrTabTitle(omp: ExtensionAPI) {
  omp.on("session_start", () => {
    renameHerdrTab(normalizeTitle(omp.getSessionName?.()) || "dev layout");
  });

  omp.on("session_switch", () => {
    const name = normalizeTitle(omp.getSessionName?.());
    if (name) {
      renameHerdrTab(name);
    }
  });

  omp.on("session_info_changed", (event) => {
    const name = eventName(event);
    if (name) {
      renameHerdrTab(name);
    }
  });
}
