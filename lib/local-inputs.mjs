/** lib/local-inputs.mjs — the local configuration a command read, for `observation.localRevision`
 *  (spec Addendum 4; docs/desktop-cli-api.md "Observation reuse").
 *
 *  Every reader of local configuration on the read verbs' paths reports what it parsed:
 *  `recordLocalInput(absPath, bytes)` for a file it read, `recordLocalInput(absPath, null)` for one it
 *  looked for and found absent (a file appearing changes the answer as much as one changing). The inputs:
 *  oats-local.yaml and every walk-up candidate loadLocal found absent (lib/workspace.mjs), oats-lock.json
 *  (lib/packages.mjs readLock / readLockIfPresent), an OATS_PACKAGE_CATALOG override (lib/core.mjs; the
 *  bundled catalog is the kernel's, not configuration), the automations snapshot (lib/automations.mjs).
 *  NOT inputs: instance homes and runtime state (the answer reports them), the parsed and observation caches.
 *
 *  Recording is a no-op until the CLI activates it for this process (a command with --max-age), so
 *  library callers and tests are unaffected unless they opt in. The first bytes recorded for a path win.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

let inputs = null; // canonical path → sha256(bytes) | "absent", while active

/** Start recording for this process (idempotent; clears nothing already recorded). */
export function activateLocalInputs() { inputs ??= new Map(); }

/** A file's canonical path: its realpath when it exists, else its directory's realpath plus its name
 *  (else the resolved path), so a symlinked deployment gives one revision. */
function canonical(absPath) {
  const path = resolve(absPath);
  try { return realpathSync(path); } catch { /* absent */ }
  try { return join(realpathSync(dirname(path)), basename(path)); } catch { return path; }
}

/** Record one input: the bytes parsed (Buffer | string), or null for a file looked for and absent. */
export function recordLocalInput(absPath, bytes) {
  if (!inputs) return;
  const key = canonical(absPath);
  if (inputs.has(key)) return;
  inputs.set(key, bytes === null || bytes === undefined ? "absent" : createHash("sha256").update(bytes).digest("hex"));
}

/** 24 lowercase hex: sha256 over the sorted `path NUL digest|absent` lines of every recorded input (the
 *  empty set included). Never a path or content. null when recording is not active. */
export function localRevision() {
  if (!inputs) return null;
  const lines = [...inputs].map(([path, digest]) => `${path}\0${digest}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 24);
}
