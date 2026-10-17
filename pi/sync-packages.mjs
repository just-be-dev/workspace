import { main, syncLocalConfig } from "./local-config.mjs";

// Only `packages` is shared. All other existing settings remain untouched.
function reconcile(shared, local) {
  const packages = shared.packages;
  if (!Array.isArray(packages) || packages.some((entry) => {
    const value = typeof entry === "string" ? entry : entry?.source;
    return typeof value !== "string" || !value.trim();
  })) {
    throw new Error("Expected a valid shared package list");
  }
  return { ...local, packages };
}

main("node sync-packages.mjs <shared-settings> <local-settings>", (source, target) => {
  try {
    syncLocalConfig({ source, target, label: "Pi settings", reconcile });
  } catch (error) {
    throw new Error(`Pi package sync failed: ${error.message}`, { cause: error });
  }
});
