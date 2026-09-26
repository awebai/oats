/** Forge boundary DTOs and display policy. No IO, credentials or command text. */
export const FORGE_API = 1;
export const GH_RANGE = '>=2.81.0 <3';
export const GH_INSTALL_HINT = 'Install GitHub CLI >=2.81.0';
export const AUTH_PANE_LABEL = 'GitHub CLI sign-in · live terminal output from `gh`';
export const PR_FIELDS = 'number,title,state,isDraft,baseRefName,headRefName,url,reviewDecision,statusCheckRollup,updatedAt';
export const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const ref = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const hostName = v => typeof v === 'string' && v.length <= 253 && v === v.toLowerCase()
  && v.split('.').every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p));
export const loginName = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(v) && !credentialLike(v);
export const repoPath = v => typeof v === 'string' && v.split('/').length === 2
  && v.split('/').every(p => /^[A-Za-z0-9_.-]{1,100}$/.test(p) && !['.', '..'].includes(p));
export const branchName = v => typeof v === 'string' && v.length > 0 && v.length <= 1024 && !/[\x00-\x20\x7f]/.test(v);
export const credentialLike = v => /(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})/.test(v);
const messages = {
  E_BAD_ARGS: 'The forge request is invalid.', E_GH_MISSING: GH_INSTALL_HINT,
  E_GH_VERSION: `GitHub CLI ${GH_RANGE} is required. ${GH_INSTALL_HINT}.`,
  E_GH_AUTH: 'Connect GitHub to read pull requests.', E_GH_TIMEOUT: 'GitHub CLI did not answer in time.',
  E_GH_PROTOCOL: 'GitHub CLI returned an unsupported response.', E_GH_FAILED: 'GitHub CLI is unavailable.',
  E_FORGE_BUSY: 'A forge operation is already in progress. Retry after it finishes.',
  E_FORGE_LIMIT: 'The forge response exceeded a safety limit.',
  E_REMOTE_NOT_REPORTED: 'The installed OATS CLI does not report a remote. Update OATS and refresh Git.',
  E_UNSUPPORTED_FORGE: 'This remote is not an admitted GitHub host.', E_NO_REMOTE: 'No remote reported.',
  E_NO_BRANCH: 'No branch reported for this observation.', E_OBSERVATION_CHANGED: 'The Git observation changed. Refresh Git.',
  E_CONNECTION_CHANGED: 'The connection changed. Refresh Connections before trying again.',
  E_FORBIDDEN_FRAME: 'This window cannot access the sign-in session.', E_AUTH_CANCELLED: 'Sign-in cancelled.',
  E_AUTH_EXPIRED: 'The sign-in session expired.',
  E_GH_UNAVAILABLE: 'Pull requests need GitHub CLI installed and signed in on this computer.',
  E_WORKSPACE_UNKNOWN: 'Select a known workspace.', 'unsupported-remote-operation': 'Remote forge inspection is unavailable. No local fallback was used.',
};
export function forgeReason(code) { return { code: Object.hasOwn(messages, code) ? code : 'E_GH_FAILED', message: messages[code] || messages.E_GH_FAILED }; }
export function forgeFailure(code, extra = {}) {
  return { forgeApi: FORGE_API, status: code === 'E_GH_MISSING' ? 'cli-not-installed' : code === 'E_GH_AUTH' ? 'not-connected'
    : code === 'E_NO_REMOTE' ? 'no-remote' : code === 'E_UNSUPPORTED_FORGE' ? 'unsupported-forge' : 'unavailable',
  data: null, reason: forgeReason(code), ...extra };
}
const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(v) && !credentialLike(v);
const pending = new Set(['EXPECTED', 'IN_PROGRESS', 'PENDING', 'QUEUED', 'REQUESTED', 'WAITING']);
const failed = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STALE', 'STARTUP_FAILURE']);
export function reportedCheck(v) {
  if (!object(v)) return null;
  if (v.__typename === 'CheckRun' && text(v.name, 512) && typeof v.status === 'string') {
    if (pending.has(v.status) && (v.conclusion === '' || v.conclusion === null)) return { name: v.name, conclusion: v.status, outcome: 'pending' };
    if (v.status !== 'COMPLETED' || typeof v.conclusion !== 'string') return null;
    const outcome = v.conclusion === 'SUCCESS' ? 'pass' : failed.has(v.conclusion) ? 'fail'
      : ['NEUTRAL', 'SKIPPED'].includes(v.conclusion) ? 'neutral' : null;
    return outcome && { name: v.name, conclusion: v.conclusion, outcome };
  }
  if (v.__typename === 'StatusContext' && text(v.context, 512)) {
    const outcome = v.state === 'SUCCESS' ? 'pass' : ['FAILURE', 'ERROR'].includes(v.state) ? 'fail'
      : ['PENDING', 'EXPECTED'].includes(v.state) ? 'pending' : null;
    return outcome && { name: v.context, conclusion: v.state, outcome };
  }
  return null;
}
export function projectedPullRequest(v, route) {
  if (!object(v) || (v.checks !== null && (!Array.isArray(v.checks) || v.checks.length > 1000))) return null;
  const checks = v.checks?.map(c => {
    if (!object(c) || !text(c.name, 512) || !text(c.conclusion, 64)) return null;
    const raw = c.conclusion === 'ERROR' ? { __typename: 'StatusContext', context: c.name, state: c.conclusion }
      : { __typename: 'CheckRun', name: c.name, status: pending.has(c.conclusion) ? c.conclusion : 'COMPLETED',
        conclusion: pending.has(c.conclusion) ? null : c.conclusion };
    return reportedCheck(raw)?.outcome === c.outcome ? raw : null;
  });
  if (checks?.some(c => !c)) return null;
  return pullRequest({ ...v, statusCheckRollup: checks ?? null }, route);
}
export function pullRequest(v, { host, path, branch }) {
  if (!object(v) || !hostName(host) || !repoPath(path) || !branchName(branch)
    || !Number.isSafeInteger(v.number) || v.number <= 0 || !text(v.title, 4096)
    || !['OPEN', 'CLOSED', 'MERGED'].includes(v.state) || typeof v.isDraft !== 'boolean'
    || !branchName(v.baseRefName) || v.headRefName !== branch
    || ![null, '', 'APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(v.reviewDecision)
    || typeof v.updatedAt !== 'string' || !Number.isFinite(Date.parse(v.updatedAt))) return null;
  let url;
  try { url = new URL(v.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash
    || url.pathname.toLowerCase() !== `/${path}/pull/${v.number}`.toLowerCase()) return null;
  if (v.statusCheckRollup !== null && (!Array.isArray(v.statusCheckRollup) || v.statusCheckRollup.length > 1000)) return null;
  const checks = v.statusCheckRollup === null ? null : v.statusCheckRollup.map(reportedCheck);
  if (checks?.some(c => !c)) return null;
  return { number: v.number, title: v.title, state: v.state, isDraft: v.isDraft, baseRefName: v.baseRefName,
    headRefName: v.headRefName, url: url.href, reviewDecision: v.reviewDecision || null, updatedAt: v.updatedAt, checks };
}
