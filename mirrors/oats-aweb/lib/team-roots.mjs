// Deployment selection and current minting authority for explicit wider-team joins.
// Lifecycle hooks deliberately continue to use their captured provider settings.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { querySelectedKernel } from './session-readiness.mjs';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = path => {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('an absolute directory is required');
  return realpathSync(path);
};
export function selectedDeployment(env = process.env, explicitDir) {
  const selected = env.OATS_TEAM_SCOPE || env.OATS_WORKSPACE;
  try {
    const deployment = canonical(selected);
    if (!statSync(deployment).isDirectory()) throw new Error();
    for (const path of [env.OATS_TEAM_SCOPE, env.OATS_WORKSPACE, explicitDir]) {
      if (path !== undefined && canonical(path) !== deployment) throw new Error();
    }
    // Exact deployment file: never search ancestors of a minting root.
    readFileSync(join(deployment, 'oats-local.yaml'), 'utf8');
    return resolve(selected);
  } catch {
    throw new Error('selected deployment is missing, unreadable or inconsistent; run oats aweb setup --dir <deployment> --soul <soul> from the deployment with its existing oats-local.yaml; no root was created');
  }
}

export function currentJoinRoot(team, home, { env = process.env, query = querySelectedKernel, membership } = {}) {
  const fail = cause => { throw new Error(`cannot join team ${team}: ${cause}; check settings.oats.aweb.roots[${JSON.stringify(team)}] in the selected deployment and run oats aweb setup --join <label> --invite-stdin --dir <deployment> --soul <soul> there with an appropriate owner invite`); };
  let deployment, selectedHome;
  try { deployment = selectedDeployment(env); selectedHome = canonical(home); }
  catch { fail('selected deployment or instance home is unavailable or inconsistent'); }
  const inspect = args => {
    let doc;
    try { doc = query(['inspect', ...args, '--dir', deployment, '--json'], { env, cwd: deployment }); }
    catch { fail('current root query unavailable'); }
    if (!object(doc) || doc.schemaVersion !== 1 || doc.ok !== true || !object(doc.result)) fail('current root query returned an invalid envelope');
    try { if (canonical(doc.result.workspace?.deployment) !== canonical(deployment)) throw new Error(); }
    catch { fail('current root query selected a different deployment'); }
    return doc.result;
  };
  // Old dispatchers inherit OATS_AGENT. The public home subject supplies the
  // recorded soul name; neither ambient OATS_AGENT nor OATS_SOUL_ID is authority.
  const recorded = inspect(['--home', selectedHome]);
  const soul = recorded.subject?.soul;
  try {
    if (recorded.subject?.kind !== 'instance' || canonical(recorded.subject.home) !== selectedHome || typeof soul !== 'string' || !soul.trim()) throw new Error();
  } catch { fail('recorded home soul is missing or ambiguous'); }
  const current = inspect(['--soul', soul]);
  if (current.subject?.kind !== 'soul' || current.subject.soul !== soul || current.teamsSource !== 'live') fail('current soul query is mismatched or stale');
  if (!Array.isArray(current.problems) || current.problems.some(p => !object(p) || !p.capability || p.capability === 'oats.aweb')) fail('current soul has unresolved configuration problems');
  const rows = Array.isArray(current.capabilities) ? current.capabilities.filter(c => c?.id === 'oats.aweb') : [];
  if (rows.length !== 1 || rows[0].layer !== 'messaging' || current.layers?.messaging?.id !== 'oats.aweb' || rows[0].compatibility?.ok !== true || !object(rows[0].settings)) fail('current oats.aweb settings or compatibility unavailable');
  const settings = rows[0].settings;
  if (Object.hasOwn(settings, 'roots') && !object(settings.roots)) fail('current roots setting is invalid');
  const root = object(settings.roots) && Object.hasOwn(settings.roots, team) ? settings.roots[team] : settings.root;
  let selectedRoot;
  try {
    selectedRoot = canonical(root);
    if (!statSync(join(selectedRoot, '.aw')).isDirectory()) throw new Error();
  } catch { fail('current team root is missing, invalid or unreadable'); }
  let member = false;
  try { member = membership(selectedRoot, team) === true; } catch { /* no native output in the error */ }
  if (!member) fail(`current root ${selectedRoot} cannot prove membership in this exact team`);
  return selectedRoot;
}
