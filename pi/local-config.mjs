import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readObject(path, label) {
  const text = readFileSync(path, "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${path}`, { cause: error });
  }
  if (!isObject(value)) throw new Error(`Expected a ${label} object: ${path}`);
  return { text, value };
}

/**
 * Keep `target` a machine-local file whose shared parts follow `source`.
 * `reconcile(shared, local)` returns the next local object; it only runs after
 * both files parse. A missing target is seeded from `source`, and the
 * workspace's own legacy symlink to `source` is migrated to a real file.
 * Unrelated (even broken) symlinks belong to their owner and are left alone.
 */
export function syncLocalConfig({ source, target, label, reconcile }) {
  let targetStat;
  try {
    targetStat = lstatSync(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const migrate = targetStat?.isSymbolicLink();
  if (migrate) {
    try {
      if (realpathSync(target) !== realpathSync(source)) return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }

  const shared = readObject(source, label);
  const local = targetStat ? readObject(target, label) : shared;
  const next = reconcile(shared.value, local.value);
  const changed = !isDeepStrictEqual(next, local.value);
  if (targetStat && !migrate && !changed) return;

  const text = changed ? `${JSON.stringify(next, null, 2)}\n` : local.text;
  const mode = statSync(targetStat ? target : source).mode & 0o777;
  mkdirSync(dirname(target), { recursive: true });
  const temporary = mkdtempSync(join(dirname(target), `.${basename(target)}-sync-`));
  try {
    const file = join(temporary, basename(target));
    writeFileSync(file, text, { mode });
    chmodSync(file, mode);
    if (targetStat && readFileSync(target, "utf8") !== local.text) {
      throw new Error(`${label} changed during sync; retry the bootstrap`);
    }
    renameSync(file, target);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  let action = "seeded";
  if (targetStat) action = migrate ? "migrated to a machine-local file" : "synced";
  process.stdout.write(`${label} ${action}: ${target}\n`);
}

export function main(usage, run) {
  try {
    const [source, target] = process.argv.slice(2);
    if (!source || !target) throw new Error(`Usage: ${usage}`);
    run(source, target);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
