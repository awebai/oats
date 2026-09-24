/** Readiness on the workspace model (`readinessApi: 2`), shared by the
 * zero-dependency server and renderer. The subject is a soul or an instance,
 * never a scope. The four checks are the kernel's; a provider's binding check
 * is relayed verbatim. An admitted read is not a lease or spawn authority. */
export const READINESS_API = 2;
export const CHECKS = ['installed', 'configured', 'member', 'providers'];
export const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const absolute = v => typeof v === 'string' && v.startsWith('/') && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v);
const name = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(v);
const exact = (v, keys) => record(v) && Object.keys(v).every(k => keys.includes(k));
const states = ['pass', 'fail', 'unknown', 'not-applicable'];
const unsafe = /[\x00-\x08\x0b-\x1f\x7f]|[a-z][a-z0-9+.-]*:\/\/[^\s/]*@|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+/i;
function text(v, max = 1024) { if (typeof v !== 'string' || v.length > max) throw Error(); return unsafe.test(v) ? '[Detail withheld]' : v; }
const nullable = v => v == null ? null : text(v);
export function readinessSelector(v) {
  if (!record(v)) return null;
  if (v.kind === 'soul' && exact(v, ['kind', 'soul', 'agentsRoot']) && name(v.soul) && absolute(v.agentsRoot)) return { kind: v.kind, soul: v.soul, agentsRoot: v.agentsRoot };
  if (v.kind === 'instance' && exact(v, ['kind', 'instance', 'agent', 'agentsRoot', 'server']) && name(v.instance) && name(v.agent) && absolute(v.agentsRoot)
    && (v.server == null || typeof v.server === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v.server))) return { kind: v.kind, instance: v.instance, agent: v.agent, agentsRoot: v.agentsRoot, server: v.server ?? null };
  return null;
}
/** The probe integer is the gate (no feature string). */
export function readinessSupported(cli) { return cli?.ok === true && absolute(cli.bin) && cli.readinessApi === READINESS_API; }
export function readinessTarget(v) {
  const selector = readinessSelector(v?.selector);
  if (!selector || !record(v) || typeof v.workspace !== 'string' || !v.workspace || v.workspace.length > 4096 || !absolute(v.context)
    || v.observedAs !== selector.kind || selector.kind === 'instance' && (!absolute(v.home) || selector.server)) return null;
  return { workspace: v.workspace, context: v.context, observedAs: selector.kind, selector, ...(selector.kind === 'instance' ? { home: v.home } : {}) };
}
const ERRORS = {
  E_BAD_ARGS: 'Readiness requires one workspace and a bounded, qualified read selector.',
  E_WORKSPACE_UNKNOWN: 'Select a known local workspace.', E_TARGET_CHANGED: 'The selected workspace, target or CLI changed. Refresh readiness.',
  E_SESSION_UNKNOWN: 'The selected instance is no longer reported.', E_AMBIGUOUS_INSTANCE: 'The selected instance is ambiguous.',
  E_SOUL_UNKNOWN: 'Select one local soul and its exact agents root.', E_HOME_MISMATCH: 'The instance home no longer matches its admitted identity.',
  'cli-unavailable': 'Select a compatible installed OATS CLI.', 'cli-no-readiness': 'The installed OATS CLI is older than this Desktop (no readiness API 2). Update OATS and retry.',
  'unsupported-remote-operation': 'Readiness is unavailable for remote targets; no local substitution.',
  E_UNSUPPORTED_MODE: 'Captured incarnation: readiness comes from its resolution, not current configuration.',
  'unsupported-action': 'Readiness is unavailable for this captured target; no classic fallback.', E_BUSY: 'The readiness read limit is reached. Retry when another read finishes.',
  E_FORBIDDEN_FRAME: 'This frame cannot request readiness.', E_CLI_FAILED: 'The installed CLI could not complete the readiness read.',
  E_CLI_TIMEOUT: 'The readiness read timed out.', E_CLI_OUTPUT_LIMIT: 'The readiness read exceeded its output limit.',
  E_CLI_PROTOCOL: 'The installed CLI returned invalid or contradictory readiness data.',
  'classic-workspace': 'This workspace still uses the classic layout, which answers an older readiness shape. Readiness shows here once it is on the workspace model.', E_USAGE: 'The installed CLI does not support this read.',
};
/** A provider binding check's own answer → the item status the kernel reports for it. */
export const PROVIDER_ITEM_STATUS = Object.freeze({ ready: 'pass', 'needs-configuration': 'fail', 'authorization-required': 'fail', unavailable: 'unknown' });
export function readinessFailure(code, target = null) {
  if (!Object.hasOwn(ERRORS, code)) code = 'E_CLI_FAILED';
  return { readinessViewApi: 1, status: 'unavailable', target: readinessTarget(target), data: null, reason: { code, message: ERRORS[code] } };
}
const problems = v => {
  if (!Array.isArray(v) || v.length > 64) throw Error();
  return v.map(p => { if (!record(p)) throw Error(); return { code: text(p.code, 128), message: text(p.message) }; });
};
/** A module's origin as the kernel records it: member commit, or package version + commit + integrity. */
function origin(v) {
  if (!record(v) || !['member', 'package', 'external'].includes(v.kind)) throw Error();
  const out = { kind: v.kind };
  for (const k of ['package', 'version', 'commit', 'integrity', 'repoKey']) if (Object.hasOwn(v, k)) out[k] = nullable(v[k]);
  return out;
}
const EVIDENCE = ['repoKey', 'workspace', 'commit', 'command', 'version', 'integrity', 'file'];
function item(v) {
  if (!record(v) || !states.includes(v.status) || typeof v.required !== 'boolean') throw Error();
  const evidence = {};
  if (v.evidence != null) {
    if (!record(v.evidence)) throw Error();
    for (const k of EVIDENCE) if (Object.hasOwn(v.evidence, k)) evidence[k] = v.evidence[k] === null ? null : text(v.evidence[k], 4096);
    if (Object.hasOwn(v.evidence, 'from')) evidence.from = origin(v.evidence.from);
  }
  const out = { subject: text(v.subject), status: v.status, required: v.required, reason: nullable(v.reason), producer: text(v.producer),
    evidence, remedy: nullable(v.remedy) };
  if (v.capability != null) { if (!record(v.capability)) throw Error(); out.capability = { id: text(v.capability.id, 256) }; }
  if (typeof v.code === 'string') out.code = text(v.code, 128);
  // The provider's own binding-check answer, relayed verbatim (`providers`):
  // {status, problems, warnings}. Warnings (always emitted, maybe []) never change status.
  if (Object.hasOwn(v, 'result')) {
    if (v.result === null) out.result = null;
    // A known answer fixes the item status (a contradiction fails closed). The four
    // statuses are additive: an unrecognised one is relayed as sent, and the kernel's
    // item status stands (docs/desktop-cli-api.md, providers).
    else if (record(v.result) && typeof v.result.status === 'string' && v.result.status && v.result.status.length <= 64
      && (!Object.hasOwn(PROVIDER_ITEM_STATUS, v.result.status) || PROVIDER_ITEM_STATUS[v.result.status] === v.status)) {
      out.result = { status: v.result.status, problems: problems(v.result.problems), warnings: problems(v.result.warnings) };
    } else throw Error();
  }
  if (Object.hasOwn(v, 'problems')) out.problems = problems(v.problems);
  return out;
}
function subjectOf(v, t) {
  if (!record(v)) return null;
  if (t.observedAs === 'soul') {
    if (v.kind !== 'soul' || v.soul !== t.selector.soul) return null;
    return { kind: 'soul', soul: v.soul, repoKey: nullable(v.repoKey), commit: nullable(v.commit), team: nullable(v.team) };
  }
  if (v.kind !== 'instance' || v.instance !== t.selector.instance || v.home !== t.home || v.soul !== t.selector.agent) return null;
  return { kind: 'instance', instance: v.instance, home: v.home, soul: v.soul };
}
function policy(v) {
  if (!record(v)) throw Error();
  const result = {};
  for (const key of ['childSpawns', 'worktrees']) {
    const p = v[key];
    if (!record(p) || ![true, false, null].includes(p.allowed) || typeof p.enforced !== 'boolean' || !record(p.origin)) throw Error();
    result[key] = { allowed: p.allowed, enforced: p.enforced, origin: { kind: text(p.origin.kind), detail: nullable(p.origin.detail) },
      ...(key === 'worktrees' ? { mode: nullable(p.mode) } : {}) };
  }
  return result;
}
export function readinessData(v, target) {
  try {
    const t = readinessTarget(target);
    if (!t || !record(v) || v.readinessApi !== READINESS_API || !record(v.checks) || !record(v.summary)) return null;
    const subject = subjectOf(v.subject, t);
    if (!subject) return null;
    if (typeof v.at !== 'string' || v.at.length > 40 || !Number.isFinite(Date.parse(v.at))) return null;
    const checks = {};
    for (const key of CHECKS) {
      const c = v.checks[key];
      if (!record(c) || !states.includes(c.status) || !Array.isArray(c.items) || c.items.length > 1000) return null;
      checks[key] = { status: c.status, items: c.items.map(item) };
    }
    const required = Object.values(checks).flatMap(c => c.items).filter(i => i.required);
    const s = v.summary;
    if (typeof s.ready !== 'boolean' || !['required', 'pass', 'fail', 'unknown'].every(k => Number.isInteger(s[k]) && s[k] >= 0)
      || s.required !== required.length || ['pass', 'fail', 'unknown'].some(k => s[k] !== required.filter(i => i.status === k).length)
      || s.ready !== (required.length > 0 && required.every(i => ['pass', 'not-applicable'].includes(i.status)))) return null;
    if (!Array.isArray(v.notes) || v.notes.length > 64) return null;
    return { readinessApi: READINESS_API, subject, at: v.at, checks,
      summary: { ready: s.ready, required: s.required, pass: s.pass, fail: s.fail, unknown: s.unknown },
      policy: policy(v.policy), notes: v.notes.map(n => text(n)) };
  } catch { return null; }
}
