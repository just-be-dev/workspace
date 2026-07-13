import { expect, test } from "bun:test";
import clearAlias from "../extensions/clear-alias.ts";

test("/clear command starts a new session", async () => {
  const commands = new Map<string, { description: string; handler(args: string, ctx: { newSession(): Promise<void> }): Promise<void> }>();

  clearAlias({
    registerCommand(name, command) {
      commands.set(name, command);
    },
  });

  const command = commands.get("clear");
  expect(command?.description).toBe("Alias for /new — start a new session");

  let newSessionCalls = 0;
  await command?.handler("ignored", {
    async newSession() {
      newSessionCalls += 1;
    },
  });

  expect(newSessionCalls).toBe(1);
});
