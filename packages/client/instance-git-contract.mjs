/** Public K1 DTO checks only; no Git parsing, filesystem reads or kernel imports.
 * Shared by the Desktop read boundary and its inert renderer controller. */
export const INSTANCE_GIT_MINIMUM_VERSION = '0.24.7';
export const INSTANCE_DIFF_LIMIT = 256 * 1024;
export const gitKinds = ['changed', 'renamed', 'copied', 'unmerged', 'untracked'];
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.length > 0 && !v.includes('\0');
const nullable = v => v === null || text(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
const optionalCount = v => v === null || count(v);
export const gitFileId = v => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);
export const gitRevision = v => v === 'unborn' || typeof v === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
// An opaque producer fingerprint, NOT a Git tree object or a path.
export const gitIndexRevision = v => typeof v === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
export function gitObservation(v) {
  if (!object(v) || !gitRevision(v.revision) || !gitIndexRevision(v.indexRevision)
    || !text(v.at) || !Number.isFinite(Date.parse(v.at)) || !text(v.worktree) || !nullable(v.branch)
    || typeof v.detached !== 'boolean' || typeof v.unborn !== 'boolean'
    || v.unborn !== (v.revision === 'unborn') || (v.detached && (v.unborn || v.branch !== null))) return null;
  return { revision: v.revision, indexRevision: v.indexRevision, at: v.at, worktree: v.worktree,
    branch: v.branch, detached: v.detached, unborn: v.unborn };
}
export function gitTarget(v) {
  if (!object(v) || !['workspace', 'instance', 'agent', 'agentsRoot', 'home'].every(k => text(v[k])) || !nullable(v.server)) return null;
  return Object.fromEntries(['workspace', 'instance', 'agent', 'agentsRoot', 'home', 'server'].map(k => [k, v[k]]));
}
export const gitTargetKey = v => JSON.stringify([v.workspace, v.instance, v.agent, v.agentsRoot, v.home, v.server]);
/* Per-file line counts (kernel #238, 0.29.1): additions/deletions are non-negative integers or
   null (unknown, NOT zero: binary, untracked, submodules); binary is a boolean or null. Absent on
   older kernels, so absent here too. */
const lineCount = v => v === null || (Number.isSafeInteger(v) && v >= 0);
const lineCounts = v => ['additions', 'deletions'].every(k => v[k] === undefined || lineCount(v[k])) && (v.binary === undefined || v.binary === null || typeof v.binary === 'boolean');
const counted = v => Object.fromEntries(['additions', 'deletions', 'binary'].filter(k => v[k] !== undefined).map(k => [k, v[k]]));
export function gitFile(v, full = false) {
  if (!object(v) || !gitFileId(v.id) || !gitKinds.includes(v.kind) || typeof v.xy !== 'string'
    || !/^[.MADRCUT?!]{2}$/.test(v.xy) || !text(v.path) || !nullable(v.origPath)
    || (['renamed', 'copied'].includes(v.kind) && !text(v.origPath))
    || (full && typeof v.submodule !== 'boolean') || (v.score !== undefined && !text(v.score))
    || (full && !lineCounts(v))) return null;
  return { id: v.id, kind: v.kind, xy: v.xy, path: v.path, origPath: v.origPath,
    ...(full ? { submodule: v.submodule, ...(v.score === undefined ? {} : { score: v.score }), ...counted(v) } : {}) };
}
export function gitState(v, target) {
  const observation = gitObservation(v?.observation);
  if (!object(v) || v.instanceGitApi !== 1 || !observation || !target
    || v.home !== target.home || v.instance !== target.instance || v.agent !== target.agent || !nullable(v.workMode)
    || !object(v.recorded) || !nullable(v.recorded.branch) || !nullable(v.recorded.repo) || typeof v.recorded.drift !== 'boolean'
    || !object(v.upstream) || !nullable(v.upstream.ref) || !optionalCount(v.upstream.ahead) || !optionalCount(v.upstream.behind)
    || !object(v.base) || !['ref', 'source', 'mergeBase'].every(k => nullable(v.base[k])) || !optionalCount(v.base.ahead) || !optionalCount(v.base.behind)
    || !object(v.summary) || !gitKinds.every(k => count(v.summary[k]))
    || !Array.isArray(v.files) || !Array.isArray(v.notes) || v.notes.some(n => typeof n !== 'string')) return null;
  if (v.upstream.ref === null && (v.upstream.ahead !== null || v.upstream.behind !== null)) return null;
  if (v.base.ref === null && (v.base.ahead !== null || v.base.behind !== null || v.base.mergeBase !== null)) return null;
  const files = v.files.map(f => gitFile(f, true));
  if (files.some(f => !f) || new Set(files.map(f => f.id)).size !== files.length
    || gitKinds.some(k => files.filter(f => f.kind === k).length !== v.summary[k])) return null;
  return { instanceGitApi: 1, instance: v.instance, agent: v.agent, home: v.home, workMode: v.workMode, observation,
    recorded: { branch: v.recorded.branch, repo: v.recorded.repo, drift: v.recorded.drift },
    upstream: { ref: v.upstream.ref, ahead: v.upstream.ahead, behind: v.upstream.behind },
    base: { ref: v.base.ref, source: v.base.source, mergeBase: v.base.mergeBase, ahead: v.base.ahead, behind: v.base.behind },
    summary: Object.fromEntries(gitKinds.map(k => [k, v.summary[k]])), files, notes: [...v.notes] };
}
export function gitDiff(v, { fileId, revision, indexRevision, observation: expected, file: selected } = {}) {
  const observation = gitObservation(v?.observation), file = gitFile(v?.file);
  if (!object(v) || v.instanceGitApi !== 1 || !observation || !file
    || file.id !== fileId || observation.revision !== revision || observation.indexRevision !== indexRevision
    || (expected && observation.worktree !== expected.worktree)
    || (selected && ['id', 'path', 'origPath', 'kind', 'xy'].some(k => file[k] !== selected[k]))
    || (file.kind !== 'untracked' && revision === 'unborn')
    || v.against !== (file.kind === 'untracked' ? 'empty' : revision)
    || typeof v.binary !== 'boolean' || typeof v.truncated !== 'boolean' || typeof v.patch !== 'string'
    || !count(v.bytes) || v.limit !== INSTANCE_DIFF_LIMIT
    || v.readOnly?.helpers !== 'disabled' || v.readOnly?.optionalLocks !== 'off' || v.readOnly?.objectsWritten !== 0) return null;
  const length = new TextEncoder().encode(v.patch).length;
  if (length > v.limit || (v.binary && (length || v.bytes || v.truncated))
    || (!v.truncated && v.bytes !== length) || (v.truncated && v.bytes <= v.limit)) return null;
  return { instanceGitApi: 1, observation, file, against: v.against, binary: v.binary, bytes: v.bytes,
    truncated: v.truncated, limit: v.limit, patch: v.patch,
    readOnly: { helpers: 'disabled', optionalLocks: 'off', objectsWritten: 0 } };
}
