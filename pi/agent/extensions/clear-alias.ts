type ExtensionAPI = {
	registerCommand(
		name: string,
		command: {
			description: string;
			handler: (
				args: string,
				ctx: { newSession(): Promise<void> },
			) => Promise<void>;
		},
	): void;
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "Alias for /new — start a new session",
		handler: async (_args: string, ctx: { newSession(): Promise<void> }) => {
			await ctx.newSession();
		},
	});
}
