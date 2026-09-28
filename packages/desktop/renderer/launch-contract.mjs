/** Soul launch preferences (feature `launch-preference`, OATS 0.30; docs/desktop-cli-api.md
 * "Soul launch preferences"). The kernel's closed Launch object, decoded once for every reader:
 * `oats souls` rows and `inspect --soul` (what a spawn with no flags would decide), `spawn --preview`
 * (flags applied) and `inspect --home` (the record, plus `launchCurrent`). A kernel without the
 * feature emits none of these fields, so every reader treats `launch` as optional. */
import { HARNESSES } from './harness-names.mjs';

const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const model = v => v === null || text(v, 256);
const LAUNCH_CONFIG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CODE = /^E_[A-Z0-9_]{1,62}$/;

/** Where the effective launch came from, per document: a report never says `flag`; only a home's
 * record says `recorded` (a home from before 0.30). */
export const REPORT_FROM = Object.freeze(['local', 'local-default', 'soul', 'host']);
export const PREVIEW_FROM = Object.freeze(['flag', ...REPORT_FROM]);
export const RECORD_FROM = Object.freeze([...PREVIEW_FROM, 'recorded']);

/** LaunchPreference `{harness, model}` (model a string or null), or null (none declared). */
function preference(v) {
  if (v === null) return null;
  if (!exact(v, ['harness', 'model']) || !HARNESSES.includes(v.harness) || !model(v.model)) return undefined;
  return { harness: v.harness, model: v.model };
}

/** An effective launch `{harness, model|null, launchConfig|null}` (also readiness `launch-changed`'s
 * `recorded`/`current`), or `undefined` when malformed. */
export function effectiveOf(e) {
  if (!exact(e, ['harness', 'model', 'launchConfig']) || !HARNESSES.includes(e.harness) || !model(e.model)
    || !(e.launchConfig === null || (typeof e.launchConfig === 'string' && LAUNCH_CONFIG.test(e.launchConfig)))) return undefined;
  return { harness: e.harness, model: e.model, launchConfig: e.launchConfig };
}

/** The Launch object, closed, or `undefined` when malformed (the reader then refuses its document). */
export function launchOf(v, from = REPORT_FROM) {
  if (!exact(v, ['declared', 'effective', 'from', 'at', 'problem'])) return undefined;
  const declared = preference(v.declared);
  const e = v.effective;
  if (declared === undefined || !exact(e, ['harness', 'model', 'launchConfig']) || !HARNESSES.includes(e.harness) || !model(e.model)
    || !(e.launchConfig === null || (typeof e.launchConfig === 'string' && LAUNCH_CONFIG.test(e.launchConfig)))) return undefined;
  if (!from.includes(v.from) || !(v.at === null || text(v.at, 1024))) return undefined;
  let problem = null;
  if (v.problem !== null) {
    const p = v.problem;
    if (!exact(p, ['code', 'message', 'fix']) || !CODE.test(p.code) || !text(p.message, 1024) || !text(p.fix, 1024)) return undefined;
    problem = { code: p.code, message: p.message, fix: p.fix };
  }
  return { declared, effective: { harness: e.harness, model: e.model, launchConfig: e.launchConfig }, from: v.from, at: v.at, problem };
}
