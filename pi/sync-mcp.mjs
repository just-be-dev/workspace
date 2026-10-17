import { isObject, main, syncLocalConfig } from "./local-config.mjs";

// Names of the servers last synced from the repo, recorded in the local file so
// repo removals propagate without touching machine-local servers. Pi preserves
// unknown top-level keys when /mcp rewrites the file.
const MANAGED = "workspaceManagedServers";
// Per-machine toggles that /mcp saves into the file defining the server.
const LOCAL_FIELDS = ["enabled", "exposure", "toolExposure"];

function reconcile(shared, local) {
  const sharedServers = shared.mcpServers ?? {};
  if (!isObject(sharedServers) || !Object.values(sharedServers).every(isObject)) {
    throw new Error("Expected shared mcpServers to be an object of server objects");
  }
  const { [MANAGED]: managed = [], ...rest } = local;
  const localServers = local.mcpServers ?? {};
  if (!isObject(localServers)) throw new Error("Expected local mcpServers to be an object");
  if (!Array.isArray(managed)) throw new Error(`Expected local ${MANAGED} to be an array`);

  const servers = { ...localServers };
  for (const name of managed) {
    if (!(name in sharedServers)) delete servers[name];
  }
  for (const [name, server] of Object.entries(sharedServers)) {
    const previous = isObject(localServers[name]) ? localServers[name] : {};
    const kept = Object.fromEntries(LOCAL_FIELDS.filter((key) => key in previous).map((key) => [key, previous[key]]));
    servers[name] = { ...server, ...kept };
  }
  return { ...rest, mcpServers: servers, [MANAGED]: Object.keys(sharedServers) };
}

main("node sync-mcp.mjs <shared-mcp> <local-mcp>", (source, target) => {
  try {
    syncLocalConfig({ source, target, label: "Pi MCP config", reconcile });
  } catch (error) {
    throw new Error(`Pi MCP sync failed: ${error.message}`, { cause: error });
  }
});
