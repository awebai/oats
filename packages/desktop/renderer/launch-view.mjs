/** Soul launch preferences in words (feature `launch-preference`, OATS 0.30; the decoded Launch
 * from launch-contract.mjs). One vocabulary for the soul page, the soul side panel, the spawn
 * grid and the spawn dialog: the EFFECTIVE harness and model, where that choice came from, where
 * to change it, and the soul's own preference only when this computer runs something else. */
import { declaredIn } from './readiness-view.mjs';

const NAMES = Object.freeze({ pi: 'Pi', claude: 'Claude Code', codex: 'Codex' });
export const launchHarnessName = value => Object.hasOwn(NAMES, value) ? NAMES[value] : value;

/** Where the effective launch came from (Launch.from), in words. */
export const LAUNCH_FROM = Object.freeze({
  __proto__: null,
  flag: 'chosen for this spawn',
  local: 'set for this soul on this computer',
  'local-default': "this computer's default for every soul",
  soul: "the soul's preference",
  host: 'no preference set: the host default',
  recorded: 'recorded when it was spawned',
});
export const launchFromText = from => LAUNCH_FROM[from] ?? `from: ${from}`;

/** The feature gate: every launch view reads `launch` only from a kernel that declares it. */
export const launchFeature = cli => Array.isArray(cli?.features) && cli.features.includes('launch-preference');
/** The decoded Launch to show, or null (no feature, or none reported). */
export const shownLaunch = (launch, cli) => launchFeature(cli) && launch && typeof launch === 'object' && launch.effective ? launch : null;

/** A model in words: the id as sent, or the harness's own when null. */
export const launchModelText = ({ harness, model }) => model ?? `${launchHarnessName(harness)}'s default model`;
/** "Claude Code · claude-opus-5-5" for a preference or an effective launch. */
export const preferenceText = p => `${launchHarnessName(p.harness)} · ${launchModelText(p)}`;
/** True when the soul declares a preference and this computer runs something else. */
export const declaredDiffers = l => !!l.declared && (l.declared.harness !== l.effective.harness || l.declared.model !== l.effective.model);
/** "Set in …": where the deciding value lives (Launch.at), or null (a flag, the host default). */
export const launchAtText = at => typeof at === 'string' && at ? `Set in ${declaredIn(at)}` : null;
/** The soul's own preference, said beside an effective launch that differs from it. */
export const declaredText = l => declaredDiffers(l) ? `The soul prefers ${preferenceText(l.declared)}; this computer runs ${launchHarnessName(l.effective.harness)}${l.declared.harness === l.effective.harness ? ` with ${launchModelText(l.effective)}` : ''}.` : null;
