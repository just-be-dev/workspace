/**
 * Prompt-cache health monitor (local addition, see FORK.md).
 *
 * Every request puts a cache breakpoint on its last message, so when caching
 * works the only uncached input is the handful of tokens Anthropic never
 * caches (~2-4 per request in practice). The Nov 2026 regression looked like
 * this instead: `cacheRead` stuck at the system-prompt size and the whole
 * history billed as `input`, growing every turn.
 *
 * Two checks, both on numbers the API already reports:
 *
 * - **uncached**: one request sends more than `maxUncachedInput` uncached
 *   tokens that are also a meaningful share of the prompt. Fires on the first
 *   bad request. A healthy request never trips it, cold or warm, because the
 *   tail breakpoint writes everything to cache even on a miss.
 * - **misses**: `consecutiveMisses` warm requests in a row (same model, within
 *   the cache TTL of the previous one) read less than `minWarmHitRatio` of the
 *   previous request's prompt from cache. Catches a prefix that changes every
 *   request: everything gets written, nothing gets read. Requests whose prompt
 *   shrank (compaction, a cleared context) aren't counted.
 */

export type CacheUsage = { input: number; cacheRead: number; cacheWrite: number };

export type CacheSample = {
	model: string;
	usage: CacheUsage;
	/** ms since epoch */
	timestamp: number;
};

export type CacheAlert = {
	kind: "uncached" | "misses";
	message: string;
	sample: CacheSample;
};

export type CacheMonitorOptions = {
	maxUncachedInput?: number;
	maxUncachedShare?: number;
	minWarmHitRatio?: number;
	consecutiveMisses?: number;
	/** Anthropic's ephemeral cache TTL. */
	ttlMs?: number;
	/**
	 * Clean requests in a row before a raised alert clears and can fire again.
	 * Breakage is often intermittent (only some request shapes miss), so
	 * clearing on the first clean request would re-alert every few turns.
	 */
	recoverAfter?: number;
};

const DEFAULTS: Required<CacheMonitorOptions> = {
	maxUncachedInput: 8_000,
	maxUncachedShare: 0.1,
	minWarmHitRatio: 0.5,
	consecutiveMisses: 2,
	ttlMs: 5 * 60_000,
	recoverAfter: 10,
};

const fmt = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n));

export function createCacheMonitor(options: CacheMonitorOptions = {}) {
	const opts = { ...DEFAULTS, ...options };
	let previous: { model: string; prompt: number; timestamp: number } | undefined;
	let misses = 0;
	let clean = 0;
	/** Alert kinds currently raised; cleared after `recoverAfter` clean requests. */
	const raised = new Set<CacheAlert["kind"]>();

	function observe(sample: CacheSample): CacheAlert | undefined {
		const { input, cacheRead, cacheWrite } = sample.usage;
		const prompt = input + cacheRead + cacheWrite;
		const prev = previous;
		previous = { model: sample.model, prompt, timestamp: sample.timestamp };
		if (prompt === 0) return undefined;

		let alert: CacheAlert | undefined;

		if (input > opts.maxUncachedInput && input / prompt > opts.maxUncachedShare) {
			alert = {
				kind: "uncached",
				sample,
				message:
					`Prompt cache broken: ${fmt(input)} of ${fmt(prompt)} prompt tokens sent uncached ` +
					`(cache read ${fmt(cacheRead)}, write ${fmt(cacheWrite)}). Normal is under 10.`,
			};
		}

		const sameModel = prev?.model === sample.model;
		const warmPrompt =
			prev && sameModel && sample.timestamp - prev.timestamp < opts.ttlMs && prompt >= prev.prompt
				? prev.prompt
				: undefined;
		if (warmPrompt !== undefined && cacheRead < warmPrompt * opts.minWarmHitRatio) {
			misses++;
			if (!alert && misses >= opts.consecutiveMisses) {
				alert = {
					kind: "misses",
					sample,
					message:
						`Prompt cache missing: ${misses} warm requests in a row read only ` +
						`${fmt(cacheRead)} of ~${fmt(warmPrompt)} cached tokens ` +
						`(wrote ${fmt(cacheWrite)}). The request prefix is changing between turns.`,
				};
			}
		} else if (warmPrompt !== undefined || !sameModel) {
			// A healthy warm request, or a new cache (first request / model switch).
			misses = 0;
		}

		if (!alert) {
			if (misses === 0 && ++clean >= opts.recoverAfter) raised.clear();
			return undefined;
		}
		clean = 0;
		if (raised.has(alert.kind)) return undefined;
		raised.add(alert.kind);
		return alert;
	}

	return {
		observe,
		/** True while any alert is raised and not yet cleared by a run of clean requests. */
		get unhealthy() {
			return raised.size > 0;
		},
	};
}
