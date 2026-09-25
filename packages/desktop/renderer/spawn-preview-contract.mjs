/** Spawn preview (API 2) on workspace model v2: the choices a spawn may carry,
 * their fixed argv, and the bounded projection of the kernel's preview. */
import { absolute, record } from './readiness-contract.mjs';
import { spawnDecision } from './spawn-decision.mjs';
export { absolute, record };
const exact = (v, keys) => record(v) && Object.keys(v).every(k => keys.includes(k));
const name = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(v);
/** The kernel caps instance names, explicit and derived, at 64 characters
 * (#159, E_INSTANCE_NAME_INVALID). A longer --name or --purpose can never
 * name an instance, so it is refused before any CLI call. */
export const INSTANCE_NAME_MAX = 64;
const INSTANCE_TOKEN = new RegExp(`^[a-z0-9][a-z0-9-]{0,${INSTANCE_NAME_MAX - 1}}$`, 'i');
const arg = (v, max = 1024) => typeof v === 'string' && !!v && v.length <= max && !v.startsWith('-') && !/[\x00-\x1f\x7f]/.test(v);
const safe = (v, max = 4096) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]|https?:\/\/[^/\s]*@|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/.test(v);
const nullable = v => v === null || safe(v);
const names = v => Array.isArray(v) && v.length <= 512 && v.every(x => safe(x, 512));
const CAPABILITY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const RESIDENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A team label (teams contract; the kernel's label grammar). */
const TEAM_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const JOIN_MAX = 16;
const joinText = v => typeof v === 'string' && v.split(',').every(l => TEAM_LABEL.test(l)) && new Set(v.split(',')).size === v.split(',').length && v.split(',').length <= JOIN_MAX;
/** The soul's teams as the preview reports them (kernel `teams`, primary
 * first), without the payloads: [{label, team, mapped}]; null when not
 * reported, undefined when unreadable. Idempotent over the server projection. */
function teamsOf(v) {
  if (v.teams === undefined || v.teams === null) return null;
  if (!Array.isArray(v.teams) || v.teams.length > 64) return undefined;
  const out = [];
  for (const t of v.teams) {
    if (!record(t) || !TEAM_LABEL.test(t.label ?? '') || typeof t.mapped !== 'boolean' || (t.mapped ? !safe(t.team, 256) || !t.team : t.team !== null)) return undefined;
    out.push({ label: t.label, team: t.team, mapped: t.mapped });
  }
  return new Set(out.map(t => t.label)).size === out.length ? out : undefined;
}
/** Whether the messaging provider declares the spawn setting `join` (teams
 * contract). The ONE gate for the spawn Teams choice: a provider that does not
 * declare it would ignore a bound join=, so without the declared fact the row
 * is not offered. Stand-in shape (kernel pending): the preview's messaging
 * module row lists its declared setting keys in `declares`. */
const joinDeclared = row => Array.isArray(row?.declares) && row.declares.includes('join');
/** The soul's messaging provider, the identity its bound payload carries, and
 * where that identity's mode came from: the one module on layer messaging,
 * decision.effective.providers[cap].identity (what the apply binds; the
 * preview's settings must agree), and settingsOrigins[cap]['/identity/mode']
 * ({kind, at}; feature settings-origins). No identity or no origin means the
 * kernel reported none — the Desktop never supplies one. */
function originOf(o) {
  if (o === undefined || o === null) return null;
  if (!exact(o, ['kind', 'at']) || !safe(o.kind, 64) || !o.kind || !safe(o.at, 512) || !o.at) return undefined;
  return { kind: o.kind, at: o.at };
}
function messagingOf(v) {
  // Idempotent: the renderer re-validates the server's projection, which
  // carries `messaging` itself instead of the kernel's modules/settings.
  if (!Object.hasOwn(v, 'modules') && Object.hasOwn(v, 'messaging')) {
    const m = v.messaging;
    if (m === null) return null;
    if (!exact(m, ['provider', 'identity', 'origin', 'join', 'joinDeclared']) || !Object.hasOwn(m, 'origin') || !CAPABILITY.test(m.provider ?? '')
      || typeof m.joinDeclared !== 'boolean' || m.join !== null && !joinText(m.join)) return undefined;
    const origin = originOf(m.origin);
    if (origin === undefined) return undefined;
    const join = { join: m.join, joinDeclared: m.joinDeclared };
    if (m.identity === null) return { provider: m.provider, identity: null, origin, ...join };
    const i = m.identity;
    if (!exact(i, ['mode', 'resident']) || !['local', 'global'].includes(i.mode) || i.resident !== null && !RESIDENT.test(i.resident)) return undefined;
    return { provider: m.provider, identity: { mode: i.mode, resident: i.resident }, origin, ...join };
  }
  if (!Array.isArray(v.modules)) return null;
  const rows = v.modules.filter(m => record(m) && m.layer === 'messaging');
  if (!rows.length) return null;
  if (rows.length !== 1 || !CAPABILITY.test(rows[0].name ?? '')) return undefined;
  const cap = rows[0].name, bound = v.decision?.effective?.providers?.[cap], shown = v.settings?.[cap];
  if (!record(bound) || !record(shown) || JSON.stringify(bound.identity ?? null) !== JSON.stringify(shown.identity ?? null)) return undefined;
  // The bound join (what the apply binds) must be the preview's settings echo.
  if ((bound.join ?? null) !== (shown.join ?? null) || bound.join !== undefined && !joinText(bound.join)) return undefined;
  const join = { join: bound.join ?? null, joinDeclared: joinDeclared(rows[0]) };
  if (Object.hasOwn(v, 'settingsOrigins') && !record(v.settingsOrigins) || v.settingsOrigins?.[cap] !== undefined && !record(v.settingsOrigins[cap])) return undefined;
  const origin = originOf(v.settingsOrigins?.[cap]?.['/identity/mode']);
  if (origin === undefined) return undefined;
  const i = bound.identity;
  if (i === undefined) return { provider: cap, identity: null, origin, ...join };
  if (!record(i) || !['local', 'global'].includes(i.mode) || i.resident !== undefined && !RESIDENT.test(i.resident)) return undefined;
  return { provider: cap, identity: { mode: i.mode, resident: i.resident ?? null }, origin, ...join };
}
export const previewSupported = cli => cli?.ok === true && absolute(cli.bin) && cli.spawnPreviewApi === 2
  && Array.isArray(cli.features) && cli.features.includes('spawn-preview-2');
export function previewSelector(v) {
  return exact(v, ['soul', 'agentsRoot']) && name(v.soul) && absolute(v.agentsRoot) ? { soul: v.soul, agentsRoot: v.agentsRoot } : null;
}
export function previewChoices(v) {
  if (!exact(v, ['purpose', 'name', 'work', 'branch', 'base', 'runtime', 'model', 'launchConfig', 'backend', 'yolo', 'relation', 'identity', 'join'])) return null;
  // --name (exact, unprefixed; feature spawn-name) and --purpose are mutually exclusive.
  if (Object.hasOwn(v, 'purpose') && Object.hasOwn(v, 'name')) return null;
  const out = {};
  for (const k of ['purpose', 'name', 'branch', 'base', 'runtime', 'launchConfig', 'backend']) if (Object.hasOwn(v, k)) {
    if (!arg(v[k]) || (k === 'purpose' || k === 'name') && !INSTANCE_TOKEN.test(v[k])
      || k === 'launchConfig' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v[k])
      || k === 'runtime' && !['pi', 'claude', 'codex'].includes(v[k]) || k === 'backend' && !['tmux', 'herdr'].includes(v[k])) return null;
    out[k] = v[k];
  }
  // The only work override the Desktop offers: a checkout soul in a worktree.
  if (Object.hasOwn(v, 'work')) { if (v.work !== 'worktree') return null; out.work = 'worktree'; }
  if (Object.hasOwn(v, 'yolo')) { if (typeof v.yolo !== 'boolean') return null; out.yolo = v.yolo; }
  // Messaging identity (decision 27; feature spawn-provider-payload): sent to
  // the soul's messaging provider as --provider <cap> identity.mode=… — there
  // is no kernel flag. `provider` is the capability the preview reported on
  // layer messaging; the kernel refuses any other (E_CAPABILITY_MISSING).
  if (Object.hasOwn(v, 'identity')) {
    const i = v.identity;
    if (!record(i) || !CAPABILITY.test(i.provider ?? '')) return null;
    if (exact(i, ['provider', 'mode']) && i.mode === 'local') out.identity = { provider: i.provider, mode: 'local' };
    else if (exact(i, ['provider', 'mode', 'resident']) && i.mode === 'global' && RESIDENT.test(i.resident ?? '')) out.identity = { provider: i.provider, mode: 'global', resident: i.resident };
    else return null;
  }
  // Teams to join beyond the personal team (teams contract): the provider's
  // spawn setting, sent as --provider <cap> join=<a,b>. Labels are the preview's
  // mapped ones; the kernel/provider decides eligibility (E_TEAM_NOT_ELIGIBLE).
  if (Object.hasOwn(v, 'join')) {
    const j = v.join;
    if (!exact(j, ['provider', 'labels']) || !CAPABILITY.test(j.provider ?? '') || !Array.isArray(j.labels) || !j.labels.length
      || !j.labels.every(l => typeof l === 'string' && TEAM_LABEL.test(l)) || !joinText(j.labels.join(','))) return null;
    out.join = { provider: j.provider, labels: [...j.labels] };
  }
  const model = v.model === undefined ? { kind: 'inherit' } : v.model;
  if (exact(model, ['kind']) && ['inherit', 'native-default'].includes(model.kind)) out.model = { kind: model.kind };
  else if (exact(model, ['kind', 'value']) && model.kind === 'custom' && arg(model.value) && model.value !== '@native-default') out.model = { kind: model.kind, value: model.value };
  else return null;
  const relation = v.relation === undefined ? { kind: 'unrelated' } : v.relation;
  if (!record(relation)) return null;
  if (exact(relation, ['kind']) && relation.kind === 'unrelated') out.relation = { kind: 'unrelated' };
  else {
    const a = relation.anchor;
    if (!exact(relation, ['kind', 'anchor']) || !['child', 'sibling', 'parent'].includes(relation.kind)
      || !exact(a, ['instance', 'agent', 'agentsRoot', 'server']) || !name(a.instance) || !name(a.agent) || !absolute(a.agentsRoot) || a.server != null) return null;
    out.relation = { kind: relation.kind, anchor: { instance: a.instance, agent: a.agent, agentsRoot: a.agentsRoot, server: null } };
  }
  return out;
}
/** The spawn flags for admitted choices — shared by preview and apply. */
export function choiceArgv(choices) {
  const argv = [];
  for (const [k, flag] of [['purpose', '--purpose'], ['name', '--name'], ['work', '--work'], ['branch', '--branch'], ['base', '--base'], ['runtime', '--runtime'], ['launchConfig', '--launch-config'], ['backend', '--backend']]) if (choices[k] !== undefined) argv.push(flag, choices[k]);
  if (choices.model.kind !== 'inherit') argv.push('--model', choices.model.kind === 'native-default' ? '@native-default' : choices.model.value);
  if (choices.yolo !== undefined) argv.push(choices.yolo ? '--yolo' : '--no-yolo');
  if (choices.relation.kind !== 'unrelated') argv.push('--relation', choices.relation.kind, '--relative-to', choices.relation.anchor.instance, '--relative-root', choices.relation.anchor.agentsRoot);
  if (choices.identity) {
    argv.push('--provider', choices.identity.provider, `identity.mode=${choices.identity.mode}`);
    if (choices.identity.mode === 'global') argv.push('--provider', choices.identity.provider, `identity.resident=${choices.identity.resident}`);
  }
  if (choices.join) argv.push('--provider', choices.join.provider, `join=${choices.join.labels.join(',')}`);
  return argv;
}
export function previewTarget(v) {
  const selector = previewSelector(v?.selector);
  return selector && safe(v.workspace) && !!v.workspace && absolute(v.context)
    ? { workspace: v.workspace, context: v.context, selector } : null;
}
const errors = {
  E_BAD_ARGS: 'Preview requires one local workspace, qualified soul and bounded choices.',
  E_PREVIEW_UNAVAILABLE: 'Spawning needs an OATS CLI that advertises spawn-preview-2 (spawnPreviewApi 2). Update OATS and retry.',
  E_WORKSPACE_UNKNOWN: 'Choose a known local workspace.',
  E_SOUL_UNKNOWN: 'The exact selected soul is unavailable or ambiguous.',
  E_TARGET_CHANGED: 'The workspace, soul, anchor or CLI changed while reading. Reading again.',
  E_UNSUPPORTED_MODE: 'This soul cannot be spawned standalone from here.',
  'unsupported-remote-operation': 'Defaults are decided on the execution server; they are not read here.',
  E_RELATIVE_AMBIGUOUS: 'The selected relation anchor cannot be addressed unambiguously.',
  E_SESSION_UNKNOWN: 'The selected relation anchor is no longer available.', E_HOME_MISMATCH: 'The relation anchor no longer matches its home.',
  E_UNSUPPORTED_OPTION: 'A chosen option is not supported for this soul or installed CLI.',
  E_BRANCH_EXISTS: 'The proposed branch already exists. Choose another branch and preview again.',
  E_BASE_UNKNOWN: 'The proposed base does not resolve to a commit.', E_CHILD_SPAWNS_DISABLED: 'The selected parent does not allow child spawns.',
  E_REQUIREMENT_INACTIVE: 'A declared soul requirement is not active.', E_LAUNCH_ENV_MISSING: 'Required launch environment references are unavailable.',
  E_LAUNCH_EXECUTABLE: 'The selected launch executable is unavailable.', E_LAUNCH_PROBE_UNSUPPORTED: 'The selected launch cannot be preflighted safely.',
  E_LAUNCH_CONFIG_UNKNOWN: 'The selected launch configuration is unavailable.', E_MODEL_UNKNOWN: 'The selected model could not be resolved.',
  E_CLONE_MISSING: 'This soul works in a member repository that is not cloned on this machine.',
  E_INSTANCE_NAME_INVALID: 'That name is not a valid instance name (a lowercase slug of at most 64 characters that is not a soul name).',
  E_INSTANCE_NAME_TAKEN: 'An instance with that name already exists in this deployment.',
  E_SOUL_AMBIGUOUS: 'More than one member declares a soul with this name.',
  E_BUSY: 'Two spawn previews are already running. Retry when one finishes.',
  E_CLI_TIMEOUT: 'The spawn preview timed out.', E_CLI_OUTPUT_LIMIT: 'The spawn preview exceeded its output limit.',
  E_CLI_PROTOCOL: 'The CLI returned an invalid or mismatched API 2 preview.', E_CLI_FAILED: 'The installed CLI could not complete the preview.',
  E_FORBIDDEN_FRAME: 'This frame cannot request a spawn preview.',
};
const KERNEL_CODE = /^E_[A-Z0-9_]{1,63}$/;
/** A kernel refusal keeps its own code and message (bounded, printable): the
 * kernel's remedy — "git clone … " for E_CLONE_MISSING — is the useful part.
 * Desktop-side codes use the fixed table. */
export function previewFailure(code, target = null, kernelMessage) {
  const kernel = typeof code === 'string' && KERNEL_CODE.test(code) && typeof kernelMessage === 'string'
    && kernelMessage.trim() && kernelMessage.length <= 2048 && safe(kernelMessage.replace(/\n/g, ' '), 2048);
  if (kernel) return { spawnPreviewViewApi: 1, status: 'unavailable', target: previewTarget(target), data: null, reason: { code, message: kernelMessage } };
  if (!Object.hasOwn(errors, code)) code = 'E_CLI_FAILED';
  return { spawnPreviewViewApi: 1, status: 'unavailable', target: previewTarget(target), data: null, reason: { code, message: errors[code] } };
}
/** The kernel's v2 preview, projected to what the dialog shows and the apply
 * binds. Top-level facts must agree with the decision the apply is bound to
 * (`--expect-decision`); the revision is opaque producer data. Modules,
 * capabilities and skills are the kernel's business and are not projected. */
const hex24 = v => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);
export function previewData(v, expected) {
  const t = previewTarget(expected);
  if (!t || !record(v) || v.spawnPreviewApi !== 2 || v.preview !== true || !record(v.subject)
    || v.subject.soul !== t.selector.soul || v.subject.agentsRoot !== t.selector.agentsRoot || v.subject.dir !== t.context) return null;
  const d = spawnDecision(v.decision, { effectiveRequired: true });
  if (!d || !hex24(v.resolution) || d.resolution !== v.resolution) return null;
  const e = d.effective, base = d.base;
  if (v.instance !== d.instance || v.home !== d.home || v.branch !== d.branch
    || (v.base === null ? base !== null : !record(v.base) || v.base.ref !== base?.ref || v.base.oid !== base?.oid)
    || v.work !== e.work || v.repo !== e.repo || v.runtime !== e.runtime || v.model !== e.model || v.launchConfig !== e.launchConfig
    || (v.yolo ?? null) !== e.yolo || v.backend !== e.backend || (v.relation ?? null) !== (e.relation?.kind ?? null)
    || Object.hasOwn(v, 'policy') && v.policy?.childSpawns?.allowed !== e.childSpawns) return null;
  if (!safe(v.modelSource) || !v.modelSource || v.team !== null && !safe(v.team, 256)
    || (e.work === 'worktree' ? !absolute(v.worktree) : v.worktree !== null)
    || !record(v.backendStatus) || v.backendStatus.name !== v.backend || typeof v.backendStatus.installed !== 'boolean' || v.backendStatus.started !== false
    || !record(v.preflight) || !['complete', 'timeout'].includes(v.preflight.status) || !Number.isInteger(v.preflight.budgetMs) || v.preflight.budgetMs <= 0 || v.preflight.budgetMs > 20000
    || !Number.isSafeInteger(v.preflight.elapsedMs) || v.preflight.elapsedMs < 0) return null;
  const messaging = messagingOf(v), teams = teamsOf(v);
  if (messaging === undefined || teams === undefined) return null;
  return { spawnPreviewApi: 2, preview: true, subject: { soul: v.subject.soul, agentsRoot: v.subject.agentsRoot, dir: v.subject.dir },
    decision: d, resolution: d.resolution, instance: d.instance, home: d.home, branch: d.branch, base: base ? { ...base } : null,
    repo: e.repo, work: e.work, worktree: v.worktree, runtime: e.runtime, model: e.model, modelSource: v.modelSource, relation: e.relation?.kind ?? null,
    launchConfig: e.launchConfig, yolo: e.yolo, backend: e.backend, team: v.team ?? null,
    backendStatus: { name: v.backendStatus.name, installed: v.backendStatus.installed, started: false },
    preflight: { status: v.preflight.status, budgetMs: v.preflight.budgetMs, elapsedMs: v.preflight.elapsedMs }, messaging, teams };
}
