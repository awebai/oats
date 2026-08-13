/**
 * core-loader.mjs — locate the globally installed @awebai/oats kernel and
 * re-export its lib/core.mjs. The pi package is a thin adapter: it never ships
 * the kernel, skills, injects, or capabilities — those live in the global CLI
 * package (npm i -g @awebai/oats), the single source of truth that the
 * future Claude plugin shares.
 *
 * Resolution order:
 *   1. $OATS_PKG_ROOT (explicit override, e.g. a dev clone)
 *   2. the `oats` binary on PATH → realpath → its package root
 *   3. `npm root -g`/@awebai/oats (binary not linked but package present)
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const PKG_NAME = "@awebai/oats";

function isKernelRoot(dir) {
  const pj = join(dir, "package.json");
  if (!existsSync(pj) || !existsSync(join(dir, "lib", "core.mjs"))) return false;
  try { return JSON.parse(readFileSync(pj, "utf8")).name === PKG_NAME; } catch { return false; }
}

function findKernelRoot() {
  if (process.env.OATS_PKG_ROOT && isKernelRoot(process.env.OATS_PKG_ROOT)) return process.env.OATS_PKG_ROOT;
  try {
    const bin = execSync("command -v oats", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (bin) {
      let d = dirname(realpathSync(bin)); // <pkg>/bin/oats.mjs → <pkg>/bin
      while (d !== dirname(d)) {
        if (isKernelRoot(d)) return d;
        d = dirname(d);
      }
    }
  } catch { /* not on PATH */ }
  try {
    const g = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const cand = join(g, PKG_NAME);
    if (isKernelRoot(cand)) return cand;
  } catch { /* no npm */ }
  return undefined;
}

export const OATS_PKG_ROOT = findKernelRoot();
if (!OATS_PKG_ROOT) {
  throw new Error(
    "OATS kernel not found — the pi adapter needs the oats CLI installed globally.\n" +
    "  Install it:  npm install -g @awebai/oats\n" +
    "  (or point OATS_PKG_ROOT at a checkout of the awebai/oats repo)",
  );
}

const core = await import(pathToFileURL(join(OATS_PKG_ROOT, "lib", "core.mjs")).href);

export const { appendLogEntry, PACKAGED_SKILLS_DIR } = core;

/** Kernel package version (for skew diagnostics against the adapter). */
export function kernelVersion() {
  try { return JSON.parse(readFileSync(join(OATS_PKG_ROOT, "package.json"), "utf8")).version; } catch { return "unknown"; }
}
