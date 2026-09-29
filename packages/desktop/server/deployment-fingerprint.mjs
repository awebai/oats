/** A cache-validity fingerprint of the two files the kernel reads local configuration from:
 * `oats-local.yaml` (this machine's teams, soul launch preferences, disabled souls, roots) and
 * `oats-config.yaml`. Their content changes outside Desktop — `oats teams`, `oats soul teams`,
 * `oats sync`, an agent editing its own teams from a terminal — and `inspect --soul` and
 * `oats souls` report facts derived from it, so a held result keyed only on the kernel's
 * workspace status would outlive a local edit.
 *
 * This is file METADATA only (size and mtime), never content: the Desktop still learns every
 * deployment fact from the kernel's JSON and parses no deployment file. The fingerprint is a
 * key component that says "ask the kernel again", nothing more. A missing file fingerprints
 * as null (that too is a state: it appearing or vanishing moves the key).
 *
 * Read-only kernel verbs (status, souls, capabilities, inspect) and spawns leave both files'
 * metadata alone (checked against oats 0.30.0), so the fingerprint is stable across everything
 * the Desktop itself runs; a future kernel read rewriting them would make every cycle a
 * re-read — visible in the argv log, not silent. */
import { statSync } from 'node:fs';
import { join } from 'node:path';

export const FINGERPRINTED_FILES = Object.freeze(['oats-local.yaml', 'oats-config.yaml']);

export function deploymentFingerprint(deployment, { stat = statSync } = {}) {
  return JSON.stringify(FINGERPRINTED_FILES.map(name => {
    try { const st = stat(join(deployment, name)); return [name, st.size, Math.floor(st.mtimeMs)]; }
    catch { return [name, null, null]; }
  }));
}
