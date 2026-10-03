import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATE_TYPE = "clear-model";
type ClearModel = {
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
};

export default function (pi: ExtensionAPI) {
	// /new replaces the extension runtime. Restore through the replacement's
	// API, never the stale pi/ctx captured by the command handler.
	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "new") return;
		const entry = ctx.sessionManager.getEntries().find(
			(entry) => entry.type === "custom" && entry.customType === STATE_TYPE,
		);
		if (entry?.type !== "custom") return;
		const state = entry.data as ClearModel;
		const model = ctx.modelRegistry.find(state.provider, state.modelId);
		if (!model || !(await pi.setModel(model))) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Could not restore ${state.provider}/${state.modelId}; check model availability and login.`,
					"warning",
				);
			}
			return;
		}
		pi.setThinkingLevel(state.thinkingLevel);
	});

	pi.registerCommand("clear", {
		description: "Start a fresh session, keeping the current model and effort",
		handler: async (_args, ctx) => {
			const model = ctx.model;
			const state: ClearModel | undefined = model ? {
				provider: model.provider,
				modelId: model.id,
				thinkingLevel: pi.getThinkingLevel(),
			} : undefined;
			await ctx.newSession({
				setup: async (sessionManager) => {
					// Custom entries persist outside the model's conversation context.
					if (state) sessionManager.appendCustomEntry(STATE_TYPE, state);
				},
			});
		},
	});
}
