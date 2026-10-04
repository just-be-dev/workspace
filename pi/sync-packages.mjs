import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

function readSettings(path) {
  const text = readFileSync(path, "utf8");
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid settings JSON: ${path}`, { cause: error });
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`Expected a settings object: ${path}`);
  }
  return { text, settings };
}

function syncPackages(source, target) {
  let targetStat;
  try {
    targetStat = lstatSync(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // Only migrate the workspace's own legacy link. Unrelated (even broken)
  // links belong to their owner and must not be followed or replaced.
  const migrate = targetStat?.isSymbolicLink();
  if (migrate) {
    try {
      if (realpathSync(target) !== realpathSync(source)) return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }

  const shared = readSettings(source);
  const packages = shared.settings.packages;
  if (!Array.isArray(packages) || packages.some((entry) => {
    const value = typeof entry === "string" ? entry : entry?.source;
    return typeof value !== "string" || !value.trim();
  })) {
    throw new Error(`Expected a valid shared package list: ${source}`);
  }

  const local = targetStat ? readSettings(target) : shared;
  const changed = !isDeepStrictEqual(local.settings.packages, packages);
  if (targetStat && !migrate && !changed) return;

  // Only packages are shared. All other existing settings remain untouched.
  const text = changed
    ? `${JSON.stringify({ ...local.settings, packages }, null, 2)}\n`
    : local.text;
  const mode = statSync(targetStat ? target : source).mode & 0o777;
  mkdirSync(dirname(target), { recursive: true });
  const temporary = mkdtempSync(join(dirname(target), ".settings-packages-"));
  try {
    const file = join(temporary, "settings.json");
    writeFileSync(file, text, { mode });
    chmodSync(file, mode);
    if (targetStat && readFileSync(target, "utf8") !== local.text) {
      throw new Error("Pi settings changed during package sync; retry the bootstrap");
    }
    renameSync(file, target);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  let action = "seeded";
  if (targetStat) {
    action = migrate ? "migrated to a machine-local file" : "packages synced";
  }
  process.stdout.write(`Pi settings ${action}: ${target}\n`);
}

try {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) throw new Error("Usage: node sync-packages.mjs <shared-settings> <local-settings>");
  syncPackages(source, target);
} catch (error) {
  console.error(`Pi package sync failed: ${error.message}`);
  process.exitCode = 1;
}
