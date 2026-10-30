/**
 * core-loader.mjs — locate the @awebai/oats kernel and re-export its
 * lib/core.mjs. The pi package is a thin adapter: it never ships the kernel,
 * skills, injects, or capabilities — those live in the kernel package, the
 * single source of truth that the future Claude plugin shares.
 *
 * Resolution order:
 *   1. $OATS_PKG_ROOT (explicit override, e.g. a dev clone)
 *   2. inside an instance, the home's kernel shim ($OATS_INSTANCE_HOME/.oats/bin/oats,
 *      a link to the kernel that launched it) → realpath → its package root, whatever
 *      PATH pi has
 *   3. the `oats` binary on PATH → realpath → its package root
 *   4. `npm root -g`/<either npm name of the kernel> (binary not linked but package present)
 * Steps 2 and 3 find the package from the binary's real path: an `oats` that is
 * a script running the kernel from elsewhere names no package, and is passed
 * over. Step 2 takes only a link, and falls through silently without one.
 */
import { execSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const PKG_NAMES = ["@awebai/oats", "@oats-project/oats"];

function isKernelRoot(dir) {
  const pj = join(dir, "package.json");
  if (!existsSync(pj) || !existsSync(join(dir, "lib", "core.mjs"))) return false;
  try { return PKG_NAMES.includes(JSON.parse(readFileSync(pj, "utf8")).name); } catch { return false; }
}

/** The kernel package a binary's real path lies in (<pkg>/bin/oats.mjs → <pkg>), or undefined. */
function kernelRootOf(bin) {
  let d = dirname(realpathSync(bin));
  while (d !== dirname(d)) {
    if (isKernelRoot(d)) return d;
    d = dirname(d);
  }
  return undefined;
}

function findKernelRoot() {
  if (process.env.OATS_PKG_ROOT && isKernelRoot(process.env.OATS_PKG_ROOT)) return process.env.OATS_PKG_ROOT;
  if (process.env.OATS_INSTANCE_HOME) {
    try {
      const shim = join(process.env.OATS_INSTANCE_HOME, ".oats", "bin", "oats");
      const root = lstatSync(shim).isSymbolicLink() ? kernelRootOf(shim) : undefined;
      if (root) return root;
    } catch { /* no shim: the PATH lookup below */ }
  }
  try {
    const bin = execSync("command -v oats", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const root = bin ? kernelRootOf(bin) : undefined;
    if (root) return root;
  } catch { /* not on PATH */ }
  try {
    const g = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    for (const name of PKG_NAMES) {
      const cand = join(g, name);
      if (isKernelRoot(cand)) return cand;
    }
  } catch { /* no npm */ }
  return undefined;
}

export const OATS_PKG_ROOT = findKernelRoot();
if (!OATS_PKG_ROOT) {
  throw new Error(
    "OATS kernel not found. In an OATS instance the bridge uses the kernel that launched it; elsewhere it needs one of:\n" +
    "  npm install -g @awebai/oats\n" +
    "  an `oats` on PATH that links to the kernel's bin/oats.mjs (npm link, in a checkout); a script that runs it is not followed\n" +
    "  OATS_PKG_ROOT=<the kernel's package directory, such as a checkout of awebai/oats>",
  );
}

const core = await import(pathToFileURL(join(OATS_PKG_ROOT, "lib", "core.mjs")).href);

export const { appendLogEntry, PACKAGED_SKILLS_DIR } = core;

/** Kernel package version (for skew diagnostics against the adapter). */
export function kernelVersion() {
  try { return JSON.parse(readFileSync(join(OATS_PKG_ROOT, "package.json"), "utf8")).version; } catch { return "unknown"; }
}
