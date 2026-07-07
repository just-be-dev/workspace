type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type CommandContext = {
	mode?: string;
	ui: {
		notify(message: string, level: "info" | "warning" | "error"): void;
		select(title: string, options: string[]): Promise<string | undefined>;
	};
};

type ExtensionAPI = {
	getThinkingLevel(): ThinkingLevel;
	setThinkingLevel(level: ThinkingLevel): void;
	registerCommand(
		name: string,
		command: {
			description: string;
			getArgumentCompletions?: (
				prefix: string,
			) => Array<{ value: string; label: string }> | null;
			handler: (args: string, ctx: CommandContext) => Promise<void>;
		},
	): void;
};

const LEVELS: Array<{ level: ThinkingLevel; description: string }> = [
	{ level: "off", description: "no extra reasoning" },
	{ level: "minimal", description: "fastest/cheapest reasoning" },
	{ level: "low", description: "light reasoning" },
	{ level: "medium", description: "balanced reasoning" },
	{ level: "high", description: "deep reasoning" },
	{ level: "xhigh", description: "maximum reasoning" },
];

function normalizeLevel(value: string): ThinkingLevel | undefined {
	const normalized = value.trim().toLowerCase();
	return LEVELS.find(({ level }) => level === normalized)?.level;
}

function formatOption(
	level: ThinkingLevel,
	description: string,
	current: ThinkingLevel,
): string {
	const marker = level === current ? "✓" : " ";
	return `${marker} ${level.padEnd(7)} — ${description}`;
}

function parseOption(option: string): ThinkingLevel | undefined {
	const match = option.match(/^[✓ ]\s+(\w+)/);
	return match ? normalizeLevel(match[1]) : undefined;
}

export default function effort(omp: ExtensionAPI) {
	omp.registerCommand("effort", {
		description: "Change the model thinking/effort level",
		getArgumentCompletions: (prefix) => {
			const normalized = prefix.trim().toLowerCase();
			const matches = LEVELS.filter(({ level }) =>
				level.startsWith(normalized),
			);
			return matches.length > 0
				? matches.map(({ level, description }) => ({
						value: level,
						label: `${level} — ${description}`,
					}))
				: null;
		},
		handler: async (args, ctx) => {
			const requested = normalizeLevel(args);

			if (requested) {
				omp.setThinkingLevel(requested);
				const actual = omp.getThinkingLevel();
				const suffix =
					actual === requested
						? ""
						: ` (clamped to ${actual} by current model)`;
				ctx.ui.notify(`Effort set to ${actual}${suffix}`, "info");
				return;
			}

			if (args.trim()) {
				ctx.ui.notify(`Unknown effort level: ${args.trim()}`, "error");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify(
					"/effort requires the TUI unless you pass a level, e.g. /effort low",
					"error",
				);
				return;
			}

			const current = omp.getThinkingLevel();
			const choice = await ctx.ui.select(
				`Choose model effort/thinking level (current: ${current})`,
				LEVELS.map(({ level, description }) =>
					formatOption(level, description, current),
				),
			);

			if (!choice) {
				return;
			}

			const selected = parseOption(choice);
			if (!selected) {
				ctx.ui.notify("Could not parse selected effort level", "error");
				return;
			}

			omp.setThinkingLevel(selected);
			const actual = omp.getThinkingLevel();
			const suffix =
				actual === selected
					? ""
					: ` (clamped from ${selected} by current model)`;
			ctx.ui.notify(`Effort set to ${actual}${suffix}`, "info");
		},
	});
}
