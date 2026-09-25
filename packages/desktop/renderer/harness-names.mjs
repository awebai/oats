/** The harness rename (kernel 0.27.0, feature `harness`; docs/desktop-cli-api.md
 * "The harness rename"). The Desktop speaks `harness`. A released kernel without
 * the feature still speaks `runtime`: its payloads are READ in either spelling
 * (a payload carries one; the new name wins), and what the Desktop WRITES to a
 * kernel (flags, definition keys) follows the feature. Drop the old spellings
 * when the accepted range no longer includes a kernel without `harness`. */
export const HARNESSES = Object.freeze(['pi', 'claude', 'codex']);

export const harnessFeature = cli => Array.isArray(cli?.features) && cli.features.includes('harness');
/** The spawn/session/launch-config flag for this kernel. */
export const harnessFlag = cli => harnessFeature(cli) ? '--harness' : '--runtime';
/** The key a definition written to this kernel uses (launch-config set, schedule spec). */
export const harnessKey = cli => harnessFeature(cli) ? 'harness' : 'runtime';

/** A kernel row's harness: `harness`, else a released kernel's `runtime`. */
export function harnessOf(row) {
  if (!row || typeof row !== 'object') return undefined;
  if (Object.hasOwn(row, 'harness')) return row.harness;
  if (Object.hasOwn(row, 'runtime')) return row.runtime;
  return undefined;
}

/** The probe's harness list: `harnesses` with the feature, a released kernel's `runtimes` without. */
export function harnessList(probe) {
  const value = harnessFeature(probe) ? probe?.harnesses : probe?.runtimes;
  return Array.isArray(value) ? value : null;
}

