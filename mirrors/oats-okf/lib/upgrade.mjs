// The upgrade hook (#106). OATS 0.68's `oats instance upgrade` moves a stopped
// home's oats.okf module to this version only when this hook adopts the home:
// `plan` answers {adopt:true} or {adopt:false,reason,remedy}, `apply` answers
// {meta}. Both phases only read the home: no write, no kernel or host call.
// 5.x keeps no custody and records no meta; its spawn writes working memory and
// the spawn policy (okf-harvest-policy.json, from 5.2.0), so:
// - a service home, and a home with a valid policy, adopt untouched;
// - a 5.0/5.1 home without a policy adopts and stays `unknown`, as it already is;
// - an invalid policy is refused, as `oats okf status` refuses it;
// - a home spawned by 4.x is refused. Only a spawn writes the policy, 5.x never
//   processes a 4.x source and has no retire hook to take its final capture.
//   Refused, the home keeps its 4.x modules, so retiring it runs its own 4.x
//   hooks; a respawn then makes it a 5.x home.
import { fs, join, fail } from './io.mjs';
import { service } from './sources.mjs';
import { harvestPolicy } from './harvest-policy.mjs';

/** Files only an okf 4.x spawn or source leaves in a home. */
const OKF4_FILES = ['.okf-source.json', '.okf-instance.json', '.okf-harvest-record.json', '.okf-harvest-record.next.json'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const respawn = () => `respawn the instance: oats retire ${process.env.OATS_INSTANCE || '<instance>'} (its own hooks run), then oats spawn`;
const refuse = reason => ({ adopt: false, reason, remedy: respawn() });

/** OATS_META as the kernel recorded it, or the reason it is unusable (never its content). */
function recordedMeta() {
  let meta;
  try { meta = JSON.parse(process.env.OATS_META || ''); } catch { return { reason: 'OATS_META must be valid JSON' }; }
  return object(meta) ? { meta } : { reason: 'OATS_META must be an object' };
}

/** Whether this version adopts the home at `home` whose recorded meta is `meta`. */
function adoption(home, meta) {
  const okf4 = OKF4_FILES.filter(p => fs.existsSync(join(home, p)));
  if (okf4.length || Object.keys(meta).length) return refuse(`the home was spawned by oats.okf 4.x (${okf4.length ? okf4.join(', ') : 'it records 4.x meta'}): 5.x has no spawn policy for it, never processes a 4.x source and has no retire hook for its final capture`);
  try {
    if (!service(home)) harvestPolicy(home);
  } catch (e) { return refuse(e.message); }
  return { adopt: true };
}

/** plan → {adopt:true} | {adopt:false,reason,remedy}. */
export function upgradePlan(home) {
  const { meta, reason } = recordedMeta();
  return reason ? refuse(reason) : adoption(home, meta);
}

/** apply → {meta}: the meta as recorded ({} for a 5.x home). A home that no
 *  longer adopts fails (E_UPGRADE_REFUSED). */
export function upgradeApply(home) {
  const { meta, reason } = recordedMeta();
  if (reason) fail('E_UPGRADE_REFUSED', reason);
  const found = adoption(home, meta);
  if (!found.adopt) fail('E_UPGRADE_REFUSED', `${found.reason}; ${found.remedy}`);
  return { meta };
}
