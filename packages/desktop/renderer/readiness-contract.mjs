/** K5 data projection shared by the zero-dependency server and renderer.
 * An admitted invocation is not a producer revision/lease or spawn authority. */
export const VERIFY_UNAVAILABLE = 'signature verification is a network action; its bounded-custody contract is not yet advertised by the installed CLI';
export const ENROL_UNAVAILABLE = 'Workspace admission is unavailable: the installed CLI has no admission command or two-document revision receipt.';
export const CHECKS = ['installed', 'trusted', 'configured', 'enrolled'];
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
  if (v.kind === 'scope' && exact(v, ['kind', 'context']) && absolute(v.context)) return { kind: v.kind, context: v.context };
  if (v.kind === 'soul' && exact(v, ['kind', 'soul', 'agentsRoot']) && name(v.soul) && absolute(v.agentsRoot)) return { kind: v.kind, soul: v.soul, agentsRoot: v.agentsRoot };
  if (v.kind === 'instance' && exact(v, ['kind', 'instance', 'agent', 'agentsRoot', 'server']) && name(v.instance) && name(v.agent) && absolute(v.agentsRoot)
    && (v.server == null || typeof v.server === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v.server))) return { kind: v.kind, instance: v.instance, agent: v.agent, agentsRoot: v.agentsRoot, server: v.server ?? null };
  return null;
}
export function readinessSupported(cli) { return cli?.ok === true && absolute(cli.bin) && cli.readinessApi === 1 && Array.isArray(cli.features) && cli.features.includes('readiness'); }
export function readinessTarget(v) {
  const selector = readinessSelector(v?.selector);
  if (!selector || !record(v) || typeof v.workspace !== 'string' || !v.workspace || v.workspace.length > 4096 || !absolute(v.context)
    || v.observedAs !== selector.kind || selector.kind === 'scope' && v.context !== selector.context || selector.kind === 'instance' && (!absolute(v.home) || selector.server)) return null;
  return { workspace: v.workspace, context: v.context, observedAs: selector.kind, selector, ...(selector.kind === 'instance' ? { home: v.home } : {}) };
}
const ERRORS = {
  E_BAD_ARGS: 'Readiness requires one workspace and a bounded, qualified read selector.',
  E_WORKSPACE_UNKNOWN: 'Select a known local workspace.', E_TARGET_CHANGED: 'The selected workspace, target or CLI changed. Refresh readiness.',
  E_SESSION_UNKNOWN: 'The selected instance is no longer reported.', E_AMBIGUOUS_INSTANCE: 'The selected instance is ambiguous.',
  E_SOUL_UNKNOWN: 'Select one local soul and its exact agents root.', E_HOME_MISMATCH: 'The instance home no longer matches its admitted identity.',
  'cli-unavailable': 'Select a compatible installed OATS CLI.', 'cli-no-readiness': 'The installed CLI does not advertise readiness API 1. Update OATS and retry.',
  'unsupported-remote-operation': 'Readiness is unavailable for remote targets; no local substitution.',
  E_UNSUPPORTED_MODE: 'Captured incarnation: readiness comes from its resolution, not current configuration.',
  'unsupported-action': 'Readiness is unavailable for this captured target; no classic fallback.',
  'migration-required': 'The selected scope requires migration; readiness is unavailable.',
  'unsupported-wire-version': 'The selected scope uses an unsupported contract.', 'invalid-lock': 'The selected scope has an invalid lock; readiness is unavailable.',
  E_CONFIG_BROKEN: 'The selected scope configuration could not be read.', E_BUSY: 'The readiness read limit is reached. Retry when another read finishes.',
  E_FORBIDDEN_FRAME: 'This frame cannot request readiness.', E_CLI_FAILED: 'The installed CLI could not complete the readiness read.',
  E_CLI_TIMEOUT: 'The readiness read timed out.', E_CLI_OUTPUT_LIMIT: 'The readiness read exceeded its output limit.',
  E_CLI_PROTOCOL: 'The installed CLI returned invalid or contradictory readiness data.', E_USAGE: 'The installed CLI does not support this read.',
};
export function readinessFailure(code, target = null) {
  if (!Object.hasOwn(ERRORS, code)) code = 'E_CLI_FAILED';
  return { readinessViewApi: 1, status: 'unavailable', target: readinessTarget(target), data: null, reason: { code, message: ERRORS[code] } };
}
function signature(v) {
  if (!record(v) || !['verified', 'unsigned', 'unknown', 'invalid', 'not-applicable'].includes(v.status)) throw Error();
  let signer = null;
  if (v.status === 'verified' && v.signer != null) {
    if (!record(v.signer)) throw Error();
    const id = nullable(v.signer.id), label = nullable(v.signer.label);
    signer = { id: id === '[Detail withheld]' ? null : id, label: label === '[Detail withheld]' ? null : label };
  }
  // Never forward signature.reason: released producers include raw Git stderr.
  const reasons = { verified: 'Source signature verified; executable approval is separate.', unsigned: 'No source signature reported.',
    unknown: 'Signature verification has not been established.', invalid: 'Source signature is invalid.', 'not-applicable': 'No verifiable source commit reported.' };
  return { status: v.status, signer, reason: reasons[v.status], ...(v.trust === 'untrusted-key' ? { trust: v.trust } : {}) };
}
function item(v) {
  if (!record(v) || !states.includes(v.status) || typeof v.required !== 'boolean') throw Error();
  const evidence = {};
  if (v.evidence != null) {
    if (!record(v.evidence)) throw Error();
    for (const k of ['version', 'integrity', 'origin', 'target', 'level', 'workspace', 'revision', 'file']) if (Object.hasOwn(v.evidence, k)) evidence[k] = v.evidence[k] === null ? null : text(v.evidence[k], 4096);
  }
  return { subject: text(v.subject), status: v.status, required: v.required, reason: nullable(v.reason), producer: text(v.producer),
    evidence, remedy: nullable(v.remedy), ...(v.signature === undefined ? {} : { signature: signature(v.signature) }) };
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
    if (!t || !record(v) || v.readinessApi !== 1 || !record(v.subject) || !record(v.checks) || !record(v.summary)) return null;
    const scope = t.observedAs === 'scope';
    if (scope ? v.subject.kind !== 'scope' || v.subject.context !== t.selector.context
      : v.subject.kind !== 'soul' || v.subject.name !== (t.selector.soul || t.selector.agent)) return null;
    const subject = scope ? { kind: 'scope', context: v.subject.context } : { kind: 'soul', name: v.subject.name };
    // Optional additive producer echo, not required and never a synthetic revision.
    if (record(v.subject.selector)) {
      subject.selector = {};
      for (const k of ['kind', 'context', 'soul', 'name', 'home', 'agentsRoot', 'server']) if (Object.hasOwn(v.subject.selector, k)) subject.selector[k] = v.subject.selector[k] === null ? null : text(v.subject.selector[k], 4096);
    }
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
    return { readinessApi: 1, subject, at: v.at, checks,
      summary: { ready: s.ready, required: s.required, pass: s.pass, fail: s.fail, unknown: s.unknown },
      policy: policy(v.policy), notes: v.notes.map(n => text(n)) };
  } catch { return null; }
}
