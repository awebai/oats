/** Read-only K6 API2. No API1 fallback and no mutation/decision application. */
import { absolute, record } from './readiness-contract.mjs';
export { absolute, record };
const exact = (v, keys) => record(v) && Object.keys(v).every(k => keys.includes(k));
const name = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(v);
const arg = (v, max = 1024) => typeof v === 'string' && !!v && v.length <= max && !v.startsWith('-') && !/[\x00-\x1f\x7f]/.test(v);
const safe = (v, max = 4096) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]|https?:\/\/[^/\s]*@|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/.test(v);
const nullable = v => v === null || safe(v);
const names = v => Array.isArray(v) && v.length <= 512 && v.every(x => safe(x, 512));
export const PREVIEW_ONLY = 'Preview-only choices cannot be submitted yet. Clear them to use existing spawn options; guarded apply is a separate follow-up.';
export const previewSupported = cli => cli?.ok === true && absolute(cli.bin) && cli.spawnPreviewApi === 2
  && Array.isArray(cli.features) && cli.features.includes('spawn-preview-2');
export function previewSelector(v) {
  return exact(v, ['soul', 'agentsRoot']) && name(v.soul) && absolute(v.agentsRoot) ? { soul: v.soul, agentsRoot: v.agentsRoot } : null;
}
export function previewChoices(v) {
  if (!exact(v, ['purpose', 'branch', 'base', 'runtime', 'model', 'launchConfig', 'backend', 'yolo', 'allowChildSpawns', 'relation'])) return null;
  const out = {};
  for (const k of ['purpose', 'branch', 'base', 'runtime', 'launchConfig', 'backend']) if (Object.hasOwn(v, k)) {
    if (!arg(v[k]) || k === 'purpose' && !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(v[k])
      || k === 'launchConfig' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v[k])
      || k === 'runtime' && !['pi', 'claude', 'codex'].includes(v[k]) || k === 'backend' && !['tmux', 'herdr'].includes(v[k])) return null;
    out[k] = v[k];
  }
  for (const k of ['yolo', 'allowChildSpawns']) if (Object.hasOwn(v, k)) { if (typeof v[k] !== 'boolean') return null; out[k] = v[k]; }
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
export function previewTarget(v) {
  const selector = previewSelector(v?.selector);
  return selector && safe(v.workspace) && !!v.workspace && absolute(v.context)
    ? { workspace: v.workspace, context: v.context, selector } : null;
}
const errors = {
  E_BAD_ARGS: 'Preview requires one local workspace, qualified soul and bounded choices.',
  E_PREVIEW_UNAVAILABLE: 'Spawn preview requires advertised spawn-preview-2 and integer spawnPreviewApi 2. API 1 is unsafe and is not invoked.',
  E_PREVIEW_ONLY: PREVIEW_ONLY, E_WORKSPACE_UNKNOWN: 'Choose a known local workspace.',
  E_SOUL_UNKNOWN: 'The exact selected soul is unavailable or ambiguous.',
  E_TARGET_CHANGED: 'The workspace, soul, anchor or CLI changed. Request a new preview.',
  E_UNSUPPORTED_MODE: 'Preview is unavailable for this execution mode; no classic fallback.',
  'unsupported-remote-operation': 'Spawn preview is local only; no remote-to-local substitution.',
  E_RELATIVE_AMBIGUOUS: 'The selected relation anchor cannot be addressed unambiguously.',
  E_SESSION_UNKNOWN: 'The selected relation anchor is no longer available.', E_HOME_MISMATCH: 'The relation anchor no longer matches its home.',
  E_UNSUPPORTED_OPTION: 'A chosen option is not supported for this soul or installed CLI.',
  E_BRANCH_EXISTS: 'The proposed branch already exists. Choose another branch and preview again.',
  E_BASE_UNKNOWN: 'The proposed base does not resolve to a commit.', E_CHILD_SPAWNS_DISABLED: 'The selected parent does not allow child spawns.',
  E_REQUIREMENT_INACTIVE: 'A declared soul requirement is not active.', E_LAUNCH_ENV_MISSING: 'Required launch environment references are unavailable.',
  E_LAUNCH_EXECUTABLE: 'The selected launch executable is unavailable.', E_LAUNCH_PROBE_UNSUPPORTED: 'The selected launch cannot be preflighted safely.',
  E_LAUNCH_CONFIG_UNKNOWN: 'The selected launch configuration is unavailable.', E_MODEL_UNKNOWN: 'The selected model could not be resolved.',
  E_BUSY: 'Two spawn previews are already running. Retry when one finishes.',
  E_CLI_TIMEOUT: 'The spawn preview timed out.', E_CLI_OUTPUT_LIMIT: 'The spawn preview exceeded its output limit.',
  E_CLI_PROTOCOL: 'The CLI returned an invalid or mismatched API 2 preview.', E_CLI_FAILED: 'The installed CLI could not complete the preview.',
  E_FORBIDDEN_FRAME: 'This frame cannot request a spawn preview.',
};
export function previewFailure(code, target = null) {
  if (!Object.hasOwn(errors, code)) code = 'E_CLI_FAILED';
  return { spawnPreviewViewApi: 1, status: 'unavailable', target: previewTarget(target), data: null, reason: { code, message: errors[code] } };
}
/** Published API2 contract; compare byte-exact subject/decision data.
 * Revision is opaque producer data, not computed or accepted by a mutation here. */
export function previewData(v, expected) {
  const t = previewTarget(expected);
  if (!t || !record(v) || v.spawnPreviewApi !== 2 || v.preview !== true || !record(v.subject)
    || v.subject.soul !== t.selector.soul || v.subject.agentsRoot !== t.selector.agentsRoot || v.subject.dir !== t.context) return null;
  const d = v.decision;
  if (!record(d) || !name(d.instance) || !absolute(d.home) || !nullable(d.branch) || typeof d.revision !== 'string' || !/^[a-f0-9]{24}$/.test(d.revision)) return null;
  let base = null;
  if (d.base !== null) {
    if (!record(d.base) || !safe(d.base.ref) || !d.base.ref || typeof d.base.oid !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(d.base.oid)) return null;
    base = { ref: d.base.ref, oid: d.base.oid };
  }
  if (!['worktree', 'checkout', 'directory', 'workspace', 'attached'].includes(v.work) || !['pi', 'claude', 'codex'].includes(v.runtime)
    || !nullable(v.model) || !safe(v.modelSource) || !v.modelSource || !nullable(v.launchConfig) || v.yolo !== undefined && v.yolo !== null && typeof v.yolo !== 'boolean'
    || !absolute(v.repo) || !nullable(v.worktree) || !['tmux', 'herdr'].includes(v.backend)
    || !record(v.backendStatus) || v.backendStatus.name !== v.backend || typeof v.backendStatus.installed !== 'boolean' || v.backendStatus.started !== false
    || !record(v.preflight) || !['complete', 'timeout'].includes(v.preflight.status) || !Number.isInteger(v.preflight.budgetMs) || v.preflight.budgetMs <= 0 || v.preflight.budgetMs > 20000
    || !Number.isSafeInteger(v.preflight.elapsedMs) || v.preflight.elapsedMs < 0
    || !names(v.capabilities) || !names(v.skills) || ![null, 'child', 'sibling', 'parent'].includes(v.relation) || !nullable(v.parentInstance)) return null;
  if (v.work === 'worktree' ? !d.branch || !base || !absolute(v.worktree) : d.branch !== null || base !== null || v.worktree !== null) return null;
  for (const k of ['instance', 'home', 'branch']) if (Object.hasOwn(v, k) && v[k] !== d[k]) return null;
  if (Object.hasOwn(v, 'base') && (v.base === null ? base !== null : !record(v.base) || v.base.ref !== base?.ref || v.base.oid !== base?.oid)) return null;
  if (Object.hasOwn(v, 'agent') && v.agent !== t.selector.soul) return null;
  const p = v.policy?.childSpawns;
  if (!record(p) || typeof p.allowed !== 'boolean' || !record(p.origin) || !safe(p.origin.kind) || !nullable(p.origin.detail ?? null)) return null;
  return { spawnPreviewApi: 2, preview: true, subject: { soul: v.subject.soul, agentsRoot: v.subject.agentsRoot, dir: v.subject.dir },
    decision: { instance: d.instance, home: d.home, branch: d.branch, base, revision: d.revision },
    repo: v.repo, work: v.work, worktree: v.worktree, runtime: v.runtime, model: v.model, modelSource: v.modelSource, launchConfig: v.launchConfig,
    yolo: v.yolo ?? null, backend: v.backend,
    backendStatus: { name: v.backendStatus.name, installed: v.backendStatus.installed, started: false },
    preflight: { status: v.preflight.status, budgetMs: v.preflight.budgetMs, elapsedMs: v.preflight.elapsedMs },
    relation: v.relation, parentInstance: v.parentInstance, policy: { childSpawns: { allowed: p.allowed, origin: { kind: p.origin.kind, detail: p.origin.detail ?? null } } },
    capabilities: [...v.capabilities], skills: [...v.skills] };
}
