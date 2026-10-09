/**
 * Session Browser — look back through past sessions with a live transcript
 * preview, then switch to one.
 *
 * Usage:
 *   /sessions            browse sessions for the current project
 *   /sessions <query>    start with a search filter
 *   /sessions --all      browse sessions from every project
 *
 * Keys:
 *   type            filter (name, first message, folder; message text is searched in the background)
 *   ↑/↓             select session
 *   PgUp/PgDn       scroll preview (shift+↑/↓ scrolls by line)
 *   Home/End        jump preview to top/bottom
 *   Tab             toggle scope: this project ↔ all projects
 *   Enter           switch to the selected session
 *   Esc             clear filter, or close
 *
 * Everything is lazy so thousands of (large) sessions stay responsive:
 *   - the list comes from readdir + stat only
 *   - per-session metadata (header, first prompt, name) reads only the head/tail
 *     of a file, and only for rows that are on screen (plus a small lookahead)
 *   - full-text search streams files in the background, is debounced, and is
 *     cancelled whenever the query changes
 *   - the preview reads only the tail of a file and loads older history on demand
 */

import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type Focusable, Input, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Scope = "project" | "all";

interface Meta {
	id?: string;
	cwd?: string;
	created?: Date;
	name?: string;
	firstMessage?: string;
}

interface Row {
	path: string;
	mtime: Date;
	size: number;
	meta?: Meta;
	metaState: "none" | "queued" | "done" | "error";
	metaPromise?: Promise<void>;
}

interface PreviewItem {
	kind: "user" | "assistant" | "tool" | "summary" | "bash" | "info";
	text: string;
}

interface Preview {
	mtimeMs: number;
	size: number;
	/** Bytes from the end of the file that were read. */
	window: number;
	items: PreviewItem[];
	/** True when older history exists before the loaded window. */
	truncated: boolean;
}

interface TuiLike {
	requestRender(): void;
	terminal: { rows: number; columns: number };
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const META_CHUNK = 64 * 1024;
const META_HEAD_CAP = 2 * 1024 * 1024; // stop scanning for a first prompt after this
const META_TAIL = 64 * 1024;
const META_CONCURRENCY = 6;
const META_LOOKAHEAD = 30;
const SEARCH_CONCURRENCY = 3;
const SEARCH_DEBOUNCE_MS = 200;
const PREVIEW_DEBOUNCE_MS = 60;
const PREVIEW_INITIAL_WINDOW = 256 * 1024;
const PREVIEW_MAX_WINDOW = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOME = homedir();

function shortPath(p: string): string {
	return p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
}

function relTime(d: Date): string {
	const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
	return d.toLocaleDateString();
}

function fmtSize(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function oneLine(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b: any) => b?.type === "text" && typeof b.text === "string")
		.map((b: any) => b.text)
		.join("\n");
}

function summarizeArgs(args: Record<string, unknown> | undefined): string {
	if (!args) return "";
	for (const key of ["command", "path", "file_path", "pattern", "query", "url", "code"]) {
		const v = args[key];
		if (typeof v === "string" && v) return oneLine(v);
	}
	const first = Object.values(args).find((v) => typeof v === "string") as string | undefined;
	return first ? oneLine(first) : "";
}

function tryParse(line: string): any {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

function rowTitle(r: Row): string {
	return oneLine(r.meta?.name || r.meta?.firstMessage || "") || basename(r.path, ".jsonl");
}

/** Small promise pool with front-of-queue priority. */
class Pool {
	private active = 0;
	private queue: Array<() => void> = [];
	constructor(private limit: number) {}

	run<T>(fn: () => Promise<T>, priority = false): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const task = () => {
				this.active++;
				fn()
					.then(resolve, reject)
					.finally(() => {
						this.active--;
						this.next();
					});
			};
			if (priority) this.queue.unshift(task);
			else this.queue.push(task);
			this.next();
		});
	}

	clear(): void {
		this.queue = [];
	}

	private next(): void {
		while (this.active < this.limit && this.queue.length) this.queue.shift()!();
	}
}

// ---------------------------------------------------------------------------
// File readers (all bounded / streaming)
// ---------------------------------------------------------------------------

async function readRange(path: string, start: number, length: number): Promise<string> {
	const fh = await open(path, "r");
	try {
		const buf = Buffer.alloc(length);
		const { bytesRead } = await fh.read(buf, 0, length, start);
		return buf.subarray(0, bytesRead).toString("utf8");
	} finally {
		await fh.close();
	}
}

/** Read header, first user prompt and session name from the head/tail of a file. */
async function readMeta(path: string, size: number): Promise<Meta> {
	const meta: Meta = {};
	const fh = await open(path, "r");
	let headEnd = 0;
	try {
		const decoder = new StringDecoder("utf8");
		const buf = Buffer.alloc(META_CHUNK);
		let pending = "";
		let sawHeader = false;
		const handle = (line: string) => {
			if (!line) return;
			if (!sawHeader) {
				sawHeader = true;
				const h = tryParse(line);
				if (h?.type === "session") {
					meta.id = h.id;
					meta.cwd = typeof h.cwd === "string" ? h.cwd : undefined;
					meta.created = h.timestamp ? new Date(h.timestamp) : undefined;
				}
				return;
			}
			if (line.includes('"type":"session_info"')) {
				const e = tryParse(line);
				if (e?.type === "session_info") meta.name = e.name?.trim() || undefined;
			} else if (!meta.firstMessage && line.includes('"role":"user"')) {
				const e = tryParse(line);
				if (e?.type === "message" && e.message?.role === "user") {
					const t = oneLine(textOf(e.message.content));
					if (t) meta.firstMessage = t.slice(0, 500);
				}
			}
		};
		while (headEnd < size && headEnd < META_HEAD_CAP && !meta.firstMessage) {
			const { bytesRead } = await fh.read(buf, 0, META_CHUNK, headEnd);
			if (bytesRead <= 0) break;
			headEnd += bytesRead;
			const lines = (pending + decoder.write(buf.subarray(0, bytesRead))).split("\n");
			pending = lines.pop() ?? "";
			for (const l of lines) handle(l);
		}
		if (headEnd >= size) handle(pending + decoder.end());

		// Session names are usually set later on; check the tail for the latest one.
		if (size > headEnd) {
			const start = Math.max(headEnd, size - META_TAIL);
			const tbuf = Buffer.alloc(size - start);
			const { bytesRead } = await fh.read(tbuf, 0, tbuf.length, start);
			const lines = tbuf.subarray(0, bytesRead).toString("utf8").split("\n");
			if (start > 0) lines.shift(); // partial line
			for (const l of lines) {
				if (!l.includes('"type":"session_info"')) continue;
				const e = tryParse(l);
				if (e?.type === "session_info") meta.name = e.name?.trim() || undefined;
			}
		}
	} finally {
		await fh.close();
	}
	return meta;
}

/**
 * Stream a session file and check whether every token appears in user or
 * assistant message text (or the session name). Cancellable via `isCancelled`.
 */
async function fileMatches(path: string, tokens: string[], isCancelled: () => boolean): Promise<boolean> {
	const remaining = new Set(tokens);
	const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 256 * 1024 });
	const rl = createInterface({ input: stream, crlfDelay: Infinity });
	try {
		for await (const line of rl) {
			if (isCancelled()) return false;
			let text: string | undefined;
			if (line.includes('"type":"session_info"')) {
				text = tryParse(line)?.name;
			} else if (line.includes('"role":"user"') || line.includes('"role":"assistant"')) {
				const e = tryParse(line);
				const role = e?.message?.role;
				if (e?.type === "message" && (role === "user" || role === "assistant")) text = textOf(e.message.content);
			}
			if (!text) continue;
			const lower = text.toLowerCase();
			for (const t of remaining) if (lower.includes(t)) remaining.delete(t);
			if (remaining.size === 0) return true;
		}
		return false;
	} catch {
		return false;
	} finally {
		rl.close();
		stream.destroy();
	}
}

/** Parse the tail of a session file and return the active branch as preview items. */
function buildPreview(raw: string, partial: boolean): { items: PreviewItem[]; truncated: boolean } {
	const lines = raw.split("\n");
	if (partial) lines.shift(); // first line is likely cut in half
	const byId = new Map<string, any>();
	let leaf: any;
	for (const line of lines) {
		if (!line.trim()) continue;
		const entry = tryParse(line);
		if (!entry || entry.type === "session" || typeof entry.id !== "string") continue;
		byId.set(entry.id, entry);
		leaf = entry;
	}

	// Walk the active branch from the last-appended entry back as far as we have.
	const branch: any[] = [];
	const seen = new Set<string>();
	let e = leaf;
	let truncated = false;
	while (e && !seen.has(e.id)) {
		seen.add(e.id);
		branch.push(e);
		if (!e.parentId) break;
		const parent = byId.get(e.parentId);
		if (!parent) {
			truncated = partial;
			break;
		}
		e = parent;
	}
	if (!leaf && partial) truncated = true;
	branch.reverse();

	const items: PreviewItem[] = [];
	for (const e of branch) {
		if (e.type === "compaction" && e.summary) {
			items.push({ kind: "summary", text: `[compacted] ${e.summary}` });
		} else if (e.type === "branch_summary" && e.summary) {
			items.push({ kind: "summary", text: `[branch summary] ${e.summary}` });
		} else if (e.type === "custom_message" && e.display) {
			const t = textOf(e.content);
			if (t) items.push({ kind: "info", text: `[${e.customType}] ${t}` });
		} else if (e.type === "message") {
			const m = e.message;
			if (!m) continue;
			if (m.role === "user") {
				const t = textOf(m.content);
				if (t) items.push({ kind: "user", text: t });
			} else if (m.role === "assistant") {
				const t = textOf(m.content);
				if (t.trim()) items.push({ kind: "assistant", text: t });
				if (Array.isArray(m.content)) {
					for (const b of m.content) {
						if (b?.type === "toolCall") {
							const a = summarizeArgs(b.arguments);
							items.push({ kind: "tool", text: `⚙ ${b.name}${a ? `  ${a}` : ""}` });
						}
					}
				}
				if (m.stopReason === "error" && m.errorMessage) {
					items.push({ kind: "info", text: `[error] ${m.errorMessage}` });
				}
			} else if (m.role === "bashExecution") {
				items.push({ kind: "bash", text: `$ ${m.command}` });
			}
		}
	}
	return { items, truncated };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

class SessionBrowser implements Focusable {
	private _focused = false;
	private input = new Input({ prompt: "" });
	private disposed = false;

	private scope: Scope;
	private rows: Partial<Record<Scope, Row[]>> = {};
	private discovering: Partial<Record<Scope, boolean>> = {};
	private discoverError: Partial<Record<Scope, string>> = {};
	private rowByPath = new Map<string, Row>();
	private filtered: Row[] = [];

	private selected = 0;
	private listOffset = 0;
	private visibleCount = 10;

	private metaPool = new Pool(META_CONCURRENCY);

	// Search state
	private tokens: string[] = [];
	private searchGen = 0;
	private searchPool = new Pool(SEARCH_CONCURRENCY);
	private searchResults = new Map<string, boolean>();
	private searchDone = 0;
	private searchTotal = 0;
	private searchTimer: ReturnType<typeof setTimeout> | undefined;

	// Preview state
	/** Preview scroll offset measured from the bottom (0 = newest at bottom). */
	private previewScroll = 0;
	private previewCache = new Map<string, Preview>();
	private previewLoading = new Set<string>();
	private previewTimer: ReturnType<typeof setTimeout> | undefined;
	private wrapCache: { key: string; lines: string[] } | undefined;
	private lastPreviewLineCount = 0;
	private lastPreviewHeight = 0;

	private refilterScheduled = false;

	constructor(
		private tui: TuiLike,
		private theme: Theme,
		private ctx: ExtensionCommandContext,
		private currentFile: string | undefined,
		private projectDir: string,
		private projectNeedsCwdFilter: boolean,
		initialScope: Scope,
		initialQuery: string,
		private done: (result: Row | undefined) => void,
	) {
		this.scope = initialScope;
		this.input.setValue(initialQuery);
		(this.input as any).cursor = initialQuery.length;
		this.tokens = this.parseTokens();
		this.discover(initialScope);
	}

	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.input.focused = v;
	}

	private finish(result: Row | undefined): void {
		this.disposed = true;
		this.searchGen++;
		this.metaPool.clear();
		this.searchPool.clear();
		clearTimeout(this.searchTimer);
		clearTimeout(this.previewTimer);
		this.done(result);
	}

	private requestRender(): void {
		if (!this.disposed) this.tui.requestRender();
	}

	// ----- discovery (readdir + stat only) ---------------------------------

	private async listDir(dir: string): Promise<Row[]> {
		let names: string[];
		try {
			names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
		} catch {
			return [];
		}
		const out: Row[] = [];
		await Promise.all(
			names.map(async (n) => {
				const p = join(dir, n);
				try {
					const st = await stat(p);
					out.push(this.rowByPath.get(p) ?? { path: p, mtime: st.mtime, size: st.size, metaState: "none" });
				} catch {
					/* vanished */
				}
			}),
		);
		return out;
	}

	private discover(scope: Scope): void {
		if (this.rows[scope] || this.discovering[scope]) return;
		this.discovering[scope] = true;
		(async () => {
			let dirs: string[];
			if (scope === "project") {
				dirs = [this.projectDir];
			} else {
				const root = join(getAgentDir(), "sessions");
				const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
				dirs = entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => join(root, e.name));
				if (!dirs.includes(this.projectDir) && !this.projectDir.startsWith(root)) dirs.push(this.projectDir);
			}
			const acc: Row[] = [];
			// Discover directory by directory so the list fills in progressively.
			for (let i = 0; i < dirs.length; i += 16) {
				if (this.disposed) return;
				const batch = await Promise.all(dirs.slice(i, i + 16).map((d) => this.listDir(d)));
				for (const rows of batch) {
					for (const r of rows) {
						this.rowByPath.set(r.path, r);
						acc.push(r);
					}
				}
				acc.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
				this.rows[scope] = acc.slice();
				if (this.scope === scope) this.scheduleRefilter();
			}
			this.rows[scope] = acc;
		})()
			.catch((err) => {
				this.discoverError[scope] = err instanceof Error ? err.message : String(err);
			})
			.finally(() => {
				this.discovering[scope] = false;
				if (this.scope === scope) {
					this.scheduleRefilter();
					this.startSearch();
				}
				this.requestRender();
			});
	}

	// ----- metadata (head/tail reads, on demand) ---------------------------

	private ensureMeta(row: Row, priority: boolean): Promise<void> {
		if (row.metaState === "done" || row.metaState === "error") return Promise.resolve();
		if (row.metaPromise && !priority) return row.metaPromise;
		row.metaState = "queued";
		// A priority request re-enqueues at the front; whichever task runs first does the read.
		const p = this.metaPool.run(async () => {
			if (this.disposed || row.metaState !== "queued") return;
			try {
				row.meta = await readMeta(row.path, row.size);
				row.metaState = "done";
			} catch {
				row.metaState = "error";
			}
			// Metadata can change filter results (title match / project cwd filter).
			if (this.tokens.length || this.projectNeedsCwdFilter) this.scheduleRefilter();
			else this.requestRender();
		}, priority);
		row.metaPromise = row.metaPromise ? Promise.race([row.metaPromise, p]) : p;
		return row.metaPromise;
	}

	/** Load metadata for rows on screen plus a small lookahead. */
	private requestVisibleMeta(): void {
		const end = Math.min(this.filtered.length, this.listOffset + this.visibleCount + META_LOOKAHEAD);
		for (let i = this.listOffset; i < end; i++) {
			const r = this.filtered[i]!;
			if (r.metaState === "none") void this.ensureMeta(r, i < this.listOffset + this.visibleCount);
		}
	}

	// ----- filtering & search ----------------------------------------------

	private parseTokens(): string[] {
		return this.input.getValue().toLowerCase().split(/\s+/).filter(Boolean);
	}

	private quickMatch(r: Row): boolean {
		const hay = `${r.meta?.name ?? ""}\n${r.meta?.firstMessage ?? ""}\n${r.meta?.cwd ?? ""}\n${r.path}`.toLowerCase();
		return this.tokens.every((t) => hay.includes(t));
	}

	private scheduleRefilter(): void {
		if (this.refilterScheduled || this.disposed) return;
		this.refilterScheduled = true;
		setTimeout(() => {
			this.refilterScheduled = false;
			if (this.disposed) return;
			this.refilter();
			this.requestRender();
		}, 16);
	}

	private refilter(resetSelection = false): void {
		const prev = resetSelection ? undefined : this.filtered[this.selected]?.path;
		const all = this.rows[this.scope] ?? [];
		const cwd = this.ctx.cwd;
		this.filtered = all.filter((r) => {
			if (this.scope === "project" && this.projectNeedsCwdFilter && r.meta?.cwd && r.meta.cwd !== cwd) return false;
			if (!this.tokens.length) return true;
			return this.quickMatch(r) || this.searchResults.get(r.path) === true;
		});
		let idx = prev ? this.filtered.findIndex((r) => r.path === prev) : -1;
		if (idx < 0) {
			// Prefer not landing on the current session.
			const firstOther = this.filtered.findIndex((r) => r.path !== this.currentFile);
			idx = !this.tokens.length && firstOther >= 0 ? firstOther : 0;
		}
		this.select(idx, idx !== this.selected || this.filtered[idx]?.path !== prev);
	}

	private onQueryChanged(): void {
		this.tokens = this.parseTokens();
		this.searchGen++;
		this.searchPool.clear();
		this.searchResults.clear();
		this.searchDone = this.searchTotal = 0;
		this.refilter(true);
		clearTimeout(this.searchTimer);
		this.searchTimer = setTimeout(() => this.startSearch(), SEARCH_DEBOUNCE_MS);
	}

	/** Background full-text search across the current scope. */
	private startSearch(): void {
		clearTimeout(this.searchTimer);
		if (this.disposed || !this.tokens.length || this.discovering[this.scope]) return;
		const gen = ++this.searchGen;
		this.searchPool.clear();
		const tokens = this.tokens.slice();
		const rows = (this.rows[this.scope] ?? []).filter((r) => !this.searchResults.has(r.path));
		this.searchTotal = rows.length + this.searchResults.size;
		this.searchDone = this.searchResults.size;
		const cancelled = () => this.disposed || gen !== this.searchGen;
		for (const r of rows) {
			this.searchPool
				.run(async () => {
					if (cancelled()) return;
					await this.ensureMeta(r, false);
					if (cancelled()) return;
					const hit = this.quickMatch(r) || (await fileMatches(r.path, tokens, cancelled));
					if (cancelled()) return;
					this.searchResults.set(r.path, hit);
					this.searchDone++;
					if (hit) this.scheduleRefilter();
					else if (this.searchDone % 25 === 0 || this.searchDone === this.searchTotal) this.requestRender();
				})
				.catch(() => {});
		}
		this.requestRender();
	}

	// ----- selection & preview ---------------------------------------------

	private select(idx: number, resetScroll = true): void {
		const n = this.filtered.length;
		this.selected = n === 0 ? 0 : Math.max(0, Math.min(n - 1, idx));
		if (resetScroll) this.previewScroll = 0;
		const r = this.filtered[this.selected];
		if (!r) return;
		void this.ensureMeta(r, true);
		clearTimeout(this.previewTimer);
		const cached = this.previewCache.get(r.path);
		if (cached && cached.mtimeMs === r.mtime.getTime()) return;
		// Debounce so holding ↑/↓ doesn't read every file along the way.
		this.previewTimer = setTimeout(() => this.loadPreview(r, PREVIEW_INITIAL_WINDOW), PREVIEW_DEBOUNCE_MS);
	}

	private loadPreview(r: Row, window: number): void {
		if (this.disposed || this.previewLoading.has(r.path)) return;
		this.previewLoading.add(r.path);
		(async () => {
			try {
				const st = await stat(r.path);
				let win = Math.min(window, st.size);
				for (;;) {
					const start = st.size - win;
					const raw = await readRange(r.path, start, win);
					const { items, truncated } = buildPreview(raw, start > 0);
					// A single huge line (e.g. images) can swallow the window; grow until something shows.
					if (items.length === 0 && start > 0 && win < PREVIEW_MAX_WINDOW) {
						win = Math.min(st.size, win * 4);
						continue;
					}
					this.previewCache.set(r.path, { mtimeMs: st.mtimeMs, size: st.size, window: win, items, truncated });
					break;
				}
			} catch (err) {
				this.previewCache.set(r.path, {
					mtimeMs: 0,
					size: 0,
					window: 0,
					items: [{ kind: "info", text: `Could not read session: ${err instanceof Error ? err.message : err}` }],
					truncated: false,
				});
			} finally {
				this.previewLoading.delete(r.path);
				this.requestRender();
			}
		})();
	}

	/** Load older history when scrolled to the top of a truncated preview. */
	private maybeLoadOlder(): void {
		const r = this.filtered[this.selected];
		const p = r && this.previewCache.get(r.path);
		if (!r || !p || !p.truncated || p.window >= p.size) return;
		const maxScroll = Math.max(0, this.lastPreviewLineCount - this.lastPreviewHeight);
		if (this.previewScroll >= maxScroll) {
			// previewScroll is bottom-relative, so the view stays put as lines are prepended.
			this.loadPreview(r, Math.min(p.size, Math.min(PREVIEW_MAX_WINDOW, p.window * 4)));
		}
	}

	// ----- input -----------------------------------------------------------

	handleInput(data: string): void {
		const page = Math.max(1, this.lastPreviewHeight - 2);
		const maxScroll = Math.max(0, this.lastPreviewLineCount - this.lastPreviewHeight);

		if (matchesKey(data, "escape")) {
			if (this.input.getValue()) {
				this.input.setValue("");
				this.onQueryChanged();
			} else {
				this.finish(undefined);
				return;
			}
		} else if (matchesKey(data, "return")) {
			const r = this.filtered[this.selected];
			if (r) {
				this.finish(r);
				return;
			}
		} else if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) {
			this.select(this.selected - 1);
		} else if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
			this.select(this.selected + 1);
		} else if (matchesKey(data, "pageup")) {
			this.previewScroll = Math.min(maxScroll, this.previewScroll + page);
			this.maybeLoadOlder();
		} else if (matchesKey(data, "pagedown")) {
			this.previewScroll = Math.max(0, this.previewScroll - page);
		} else if (matchesKey(data, "shift+up")) {
			this.previewScroll = Math.min(maxScroll, this.previewScroll + 1);
			this.maybeLoadOlder();
		} else if (matchesKey(data, "shift+down")) {
			this.previewScroll = Math.max(0, this.previewScroll - 1);
		} else if (matchesKey(data, "home")) {
			this.previewScroll = maxScroll;
			this.maybeLoadOlder();
		} else if (matchesKey(data, "end")) {
			this.previewScroll = 0;
		} else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			this.scope = this.scope === "project" ? "all" : "project";
			this.discover(this.scope);
			this.refilter();
			this.startSearch();
		} else {
			const before = this.input.getValue();
			this.input.handleInput(data);
			if (this.input.getValue() !== before) this.onQueryChanged();
		}
		this.requestRender();
	}

	invalidate(): void {
		this.wrapCache = undefined;
		(this.input as any).invalidate?.();
	}

	// ----- render ----------------------------------------------------------

	render(width: number): string[] {
		const th = this.theme;
		const rows = Math.max(14, (this.tui.terminal?.rows ?? 40) - 6);
		const lines: string[] = [];
		const fit = (s: string, w: number) => {
			const t = truncateToWidth(s, w, "…");
			return t + " ".repeat(Math.max(0, w - visibleWidth(t)));
		};

		// Header
		const scopeLabel =
			this.scope === "project"
				? `${th.fg("accent", "this project")} ${th.fg("dim", "· all")}`
				: `${th.fg("dim", "this project ·")} ${th.fg("accent", "all projects")}`;
		const total = this.rows[this.scope]?.length ?? 0;
		const status: string[] = [`${this.filtered.length}/${total}`];
		if (this.discovering[this.scope]) status.push("scanning…");
		if (this.tokens.length && this.searchTotal && this.searchDone < this.searchTotal) {
			status.push(`searching ${this.searchDone}/${this.searchTotal}`);
		}
		lines.push(fit(`${th.bold(th.fg("accent", " Sessions"))}  ${scopeLabel}  ${th.fg("dim", status.join(" · "))}`, width));

		// Search box
		const inputLine = this.input.render(Math.max(10, width - 4))[0] ?? "";
		lines.push(fit(` ${th.fg("accent", "⌕")} ${inputLine}`, width));
		lines.push(th.fg("border", "─".repeat(width)));

		const bodyHeight = rows - lines.length - 2;
		const listW = Math.max(28, Math.min(60, Math.floor(width * 0.38)));
		const previewW = Math.max(10, width - listW - 3);

		const left = this.renderList(listW, bodyHeight);
		const right = this.renderPreview(previewW, bodyHeight);
		const sep = th.fg("border", " │ ");
		for (let i = 0; i < bodyHeight; i++) {
			lines.push(fit(left[i] ?? "", listW) + sep + fit(right[i] ?? "", previewW));
		}

		lines.push(th.fg("border", "─".repeat(width)));
		lines.push(
			fit(th.fg("dim", " ↑↓ select · PgUp/PgDn scroll · Home/End top/bottom · Tab scope · Enter switch · Esc close"), width),
		);
		return lines;
	}

	private renderList(w: number, h: number): string[] {
		const th = this.theme;
		const all = this.rows[this.scope];
		if (this.discoverError[this.scope]) return [th.fg("error", `Failed to list sessions: ${this.discoverError[this.scope]}`)];
		if (!all || (all.length === 0 && this.discovering[this.scope])) return [th.fg("dim", "Scanning sessions…")];
		if (this.filtered.length === 0) {
			const searching = this.tokens.length && this.searchDone < this.searchTotal;
			return [th.fg("dim", searching ? "Searching…" : "No matching sessions")];
		}

		const itemH = 2;
		const visible = Math.max(1, Math.floor(h / itemH));
		this.visibleCount = visible;
		if (this.selected < this.listOffset) this.listOffset = this.selected;
		if (this.selected >= this.listOffset + visible) this.listOffset = this.selected - visible + 1;
		this.listOffset = Math.max(0, Math.min(this.listOffset, Math.max(0, this.filtered.length - visible)));
		this.requestVisibleMeta();

		const out: string[] = [];
		for (let i = this.listOffset; i < Math.min(this.filtered.length, this.listOffset + visible); i++) {
			const r = this.filtered[i]!;
			const isSel = i === this.selected;
			const isCur = r.path === this.currentFile;
			const loaded = r.metaState === "done" || r.metaState === "error";
			const title = loaded ? rowTitle(r) : "…";
			const marker = isSel ? th.fg("accent", "▶ ") : "  ";
			const titleStyled = isSel
				? th.bold(th.fg("accent", title))
				: r.meta?.name
					? th.fg("text", title)
					: th.fg("muted", title);
			out.push(truncateToWidth(marker + (isCur ? th.fg("success", "● ") : "") + titleStyled, w, "…"));
			const meta = [relTime(r.mtime), fmtSize(r.size)];
			if (this.scope === "all" && r.meta?.cwd) meta.push(shortPath(r.meta.cwd));
			out.push(truncateToWidth(`  ${th.fg("dim", meta.join(" · "))}`, w, "…"));
		}
		return out;
	}

	private renderPreview(w: number, h: number): string[] {
		const th = this.theme;
		const r = this.filtered[this.selected];
		this.lastPreviewHeight = h;
		if (!r) {
			this.lastPreviewLineCount = 0;
			return [];
		}

		const header: string[] = [];
		header.push(truncateToWidth(th.bold(rowTitle(r)), w, "…"));
		const cur = r.path === this.currentFile ? th.fg("success", "  (current session)") : "";
		const facts = [
			r.meta?.cwd ? shortPath(r.meta.cwd) : undefined,
			r.meta?.created ? `created ${r.meta.created.toLocaleString()}` : undefined,
			fmtSize(r.size),
		].filter(Boolean);
		header.push(truncateToWidth(th.fg("dim", facts.join(" · ")) + cur, w, "…"));
		header.push(th.fg("border", "┄".repeat(w)));

		const bodyH = Math.max(1, h - header.length);
		const preview = this.previewCache.get(r.path);
		if (!preview) {
			this.lastPreviewLineCount = 0;
			return [...header, th.fg("dim", "Loading preview…")];
		}

		// Wrapping is cached per session/width/window so keypresses stay cheap.
		const key = `${r.path}|${w}|${preview.mtimeMs}|${preview.window}`;
		if (this.wrapCache?.key !== key) {
			const body: string[] = [];
			if (preview.truncated) body.push(th.fg("dim", "  ⋯ older history not loaded — scroll up to load more"));
			for (const item of preview.items) body.push(...this.renderItem(item, w));
			if (preview.items.length === 0) body.push(th.fg("dim", "(empty session)"));
			this.wrapCache = { key, lines: body };
		}
		const body = this.wrapCache.lines;

		this.lastPreviewLineCount = body.length;
		this.lastPreviewHeight = bodyH;
		const maxScroll = Math.max(0, body.length - bodyH);
		this.previewScroll = Math.min(this.previewScroll, maxScroll);
		const end = body.length - this.previewScroll;
		const start = Math.max(0, end - bodyH);
		const slice = body.slice(start, end);

		const loadingMore = this.previewLoading.has(r.path);
		if (start > 0 || loadingMore) {
			const hint = th.fg("dim", loadingMore ? " loading older history… " : ` ↑ ${start} more lines (PgUp) `);
			header[header.length - 1] = th.fg("border", "┄".repeat(Math.max(0, w - visibleWidth(hint)))) + hint;
		}
		return [...header, ...slice];
	}

	private renderItem(item: PreviewItem, w: number): string[] {
		const th = this.theme;
		const MAX_LINES = 12;
		const wrapCapped = (text: string, prefix: string, style: (s: string) => string, cap = MAX_LINES) => {
			const inner = Math.max(4, w - visibleWidth(prefix));
			const indent = " ".repeat(visibleWidth(prefix));
			const wrapped: string[] = [];
			for (const para of text.replace(/\t/g, "  ").split("\n")) {
				wrapped.push(...(para ? wrapTextWithAnsi(para, inner) : [""]));
				if (wrapped.length > cap + 1) break; // don't wrap text we won't show
			}
			while (wrapped.length && !wrapped[0]!.trim()) wrapped.shift();
			while (wrapped.length && !wrapped[wrapped.length - 1]!.trim()) wrapped.pop();
			const out = wrapped.slice(0, cap).map((l, i) => (i === 0 ? prefix : indent) + style(l));
			if (wrapped.length > cap) out.push(indent + th.fg("dim", "…"));
			return out;
		};

		switch (item.kind) {
			case "user":
				return ["", ...wrapCapped(item.text, th.fg("accent", "❯ "), (s) => th.fg("accent", s))];
			case "assistant":
				return wrapCapped(item.text, "  ", (s) => th.fg("text", s));
			case "tool":
				return [truncateToWidth(`  ${th.fg("dim", oneLine(item.text.slice(0, 500)))}`, w, "…")];
			case "bash":
				return [truncateToWidth(`  ${th.fg("warning", oneLine(item.text.slice(0, 500)))}`, w, "…")];
			case "summary":
				return ["", ...wrapCapped(item.text, "  ", (s) => th.fg("muted", s), 6)];
			case "info":
				return wrapCapped(item.text, "  ", (s) => th.fg("dim", s), 4);
		}
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerCommand("sessions", {
		description: "Browse past sessions with a transcript preview and switch to one (--all for every project)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/sessions requires interactive mode", "error");
				return;
			}

			let query = args.trim();
			let scope: Scope = "project";
			if (/(^|\s)--all(\s|$)/.test(query)) {
				scope = "all";
				query = query.replace(/(^|\s)--all(\s|$)/, " ").trim();
			}

			const currentFile = ctx.sessionManager.getSessionFile();
			const projectDir = ctx.sessionManager.getSessionDir();
			// A custom (flat) session dir mixes projects, so filter by header cwd as metadata loads.
			const sm = ctx.sessionManager as unknown as { usesDefaultSessionDir?: () => boolean };
			const projectNeedsCwdFilter = sm.usesDefaultSessionDir ? !sm.usesDefaultSessionDir() : false;

			const chosen = await ctx.ui.custom<Row | undefined>(
				(tui, theme, _kb, done) =>
					new SessionBrowser(
						tui as unknown as TuiLike,
						theme,
						ctx,
						currentFile,
						projectDir,
						projectNeedsCwdFilter,
						scope,
						query,
						done,
					),
			);

			if (!chosen) return;
			if (chosen.path === currentFile) {
				ctx.ui.notify("Already in that session", "info");
				return;
			}

			const label = rowTitle(chosen).slice(0, 60);
			await ctx.waitForIdle();
			const result = await ctx.switchSession(chosen.path, {
				withSession: async (newCtx) => {
					newCtx.ui.notify(`Switched to: ${label}`, "info");
				},
			});
			if (result?.cancelled) ctx.ui.notify("Switch cancelled", "info");
		},
	});
}
