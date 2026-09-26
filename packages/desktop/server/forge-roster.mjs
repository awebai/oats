/** forge-roster targets: which LOCAL instances have a pull request to read, and where.
 * The kernel names the repository (#217 `workspace status` `clones[]`: member key + this
 * computer's clone path); the Desktop derives no remote. An instance maps to the member
 * whose clone contains its recorded repo, compared after realpath on both sides, the
 * LONGEST containing clone winning. Only `github.com/<owner>/<repo>` keys are read, and
 * only instances with a branch: anything else gets no fact, never a guess. No I/O except
 * the injected realpath. */
import { isAbsolute, sep } from 'node:path';
import { repoPath, branchName } from '../renderer/forge-contract.mjs';

const GITHUB_KEY = /^github\.com\/([^/]+\/[^/]+)$/;
export const ROSTER_LIMIT = 20;

function real(path, realpath) {
  if (typeof path !== 'string' || !isAbsolute(path)) return null;
  try { return realpath(path); } catch { return null; }
}
const contains = (parent, child) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** → [{ home, host, path, branch }] in instance order, at most ROSTER_LIMIT distinct (path, branch). */
export function rosterTargets({ instances = [], clones = [], realpath }) {
  const members = [];
  for (const clone of Array.isArray(clones) ? clones : []) {
    const match = typeof clone?.key === 'string' ? GITHUB_KEY.exec(clone.key) : null;
    const path = clone?.path == null ? null : real(clone.path, realpath);
    // A clone that is not a github.com member still claims its paths, so an instance inside
    // it never falls through to a shorter (github) clone that contains it.
    if (path) members.push({ path, repo: match && repoPath(match[1]) ? match[1] : null });
  }
  const targets = [], seen = new Set();
  for (const instance of Array.isArray(instances) ? instances : []) {
    if (!branchName(instance?.branch) || typeof instance.home !== 'string' || !isAbsolute(instance.home)) continue;
    const repo = real(instance.repo, realpath);
    if (!repo) continue;
    let best = null;
    for (const m of members) if (contains(m.path, repo) && (!best || m.path.length > best.path.length)) best = m;
    if (!best?.repo) continue;
    const key = JSON.stringify([best.repo, instance.branch]);
    if (!seen.has(key)) { if (seen.size >= ROSTER_LIMIT) continue; seen.add(key); }
    targets.push({ home: instance.home, host: 'github.com', path: best.repo, branch: instance.branch });
  }
  return targets;
}
