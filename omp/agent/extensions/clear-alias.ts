type CommandContext = {
  newSession(): Promise<void>;
};

type ExtensionAPI = {
  registerCommand(
    name: string,
    command: {
      description: string;
      handler(args: string, ctx: CommandContext): Promise<void>;
    },
  ): void;
};

export default function clearAlias(omp: ExtensionAPI) {
  omp.registerCommand("clear", {
    description: "Alias for /new — start a new session",
    handler: async (_args: string, ctx: CommandContext) => {
      await ctx.newSession();
    },
  });
}
