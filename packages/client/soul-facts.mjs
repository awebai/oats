/** What a client says about one soul, from its row (soul-rows.mjs, or a remote roster's) and its inspection
 * (inspect-contract.mjs `inspectData` of an inspect-boundary.mjs answer), as plain data: no DOM, no state.
 * The Desktop's soul inspector and soul grid draw from it, and so does any other client, so a soul reads the
 * same wherever it is shown.
 *
 *   soulFacts(row, inspected, cli, terms) -> {
 *     work         where it works, in words ("works in its own worktree"), or null when the row names no mode
 *     refusal      why a spawn of it here would be refused (spawnRefusal), or null
 *     refusalLine  "Can't spawn here · <refusal>", or null
 *     launch       the decoded Launch a spawn here would use (launch-view.mjs shownLaunch), or null: a kernel
 *                  without launch-preference, or none reported
 *     rows         the harness card, [label, value] each: with a launch Harness, Model, Launch configuration
 *                  (when set), Chosen by, The soul prefers (when it differs); a kernel before 0.30 its Default
 *                  harness and Default model; neither, none
 *     notes        what is said beside the rows: with a launch, where its deciding value is set ("Set in …",
 *                  when reported); with neither a launch nor a declared harness, that there is no default
 *     problem      a launch problem, in its parts: { lead, lines, code }: the client's own line, the kernel's
 *                  message and fix under its name (kernel-lines.mjs, with the client's terms), and its code
 *   }
 *
 * `inspected` may be null (a soul not inspected yet, the grid): the launch is then the row's. `terms` are the
 * client's (client-terms.mjs); a call without them throws, also where no line would name the client. */
import { requireTerms } from './client-terms.mjs';
import { kernelLines } from './kernel-lines.mjs';
import { harnessOf } from './harness-names.mjs';
import { shownLaunch, launchHarnessName, launchModelText, launchFromText, launchAtText, preferenceText, declaredDiffers } from './launch-view.mjs';

/** Where a soul works, by its declared work mode. */
export const WORK_TEXT = Object.freeze({ worktree: 'works in its own worktree', checkout: 'works in the repo checkout', attached: 'attaches to an owning instance' });
/** A work mode in words, or null for none. */
export const workText = work => typeof work === 'string' && work ? WORK_TEXT[work] || `works in ${work}` : null;

/** Kernel #217's Desktop facts (`spawnable`, `problem`, `file`) are read only from a CLI that reports the feature. */
export const desktopFacts = cli => Array.isArray(cli?.features) && cli.features.includes('desktop-facts');

/** Kernel #217 (desktop-facts): the reason a spawn of this soul here would refuse, as the kernel
 * reports it (`spawnable: false` + `problem`), else null. */
export function spawnRefusal(agent, cli) {
  return desktopFacts(cli) && agent?.spawnable === false ? (typeof agent.problem?.message === "string" && agent.problem.message ? agent.problem.message : "A spawn of this soul would be refused here.") : null;
}
/** The line a soul a spawn here would refuse carries, beside its disabled Spawn. */
export const cantSpawnLine = refusal => `Can't spawn here · ${refusal}`;
/** Whether a soul row matches a client's soul filter: its name, its description or where it comes from
 * (`repoName`) contains the query, case aside. An empty query matches every row; whether to trim it is the
 * client's. */
export function soulMatches(row, query) {
  const needle = String(query).toLowerCase();
  return [row.name, row.description, row.repoName].some((value) => String(value || '').toLowerCase().includes(needle));
}

/** What a launch problem of a soul's report means, in the client's words: the report is the launch a spawn
 * that names none would get, and each problem is what the kernel reports of that spawn: why it would be
 * refused, in the report's own message and fix. */
export const LAUNCH_REFUSED_HERE = 'A spawn of this soul with no launch chosen would be refused here.';
/** A launch problem's parts: the client's own line, then the kernel's message and fix, each a line of its own
 * under the kernel's name and through the display filter, and the code. One rule for every problem, keyed on
 * no code: the kernel computes the report for a spawn that names no launch and sets a problem only where it
 * would refuse that spawn. */
export function launchProblemParts(problem, terms) {
  return { lead: LAUNCH_REFUSED_HERE, lines: kernelLines(problem.message, problem.fix, terms), code: problem.code };
}

/** Said when a soul has neither a launch report nor a declared harness. */
export const NO_DEFAULT_HARNESS = 'No default harness: you choose one when you launch it.';

export function soulFacts(row, inspected, cli, terms) {
  requireTerms(terms, 'soulFacts');
  // 0.30 launch preferences: `inspect --soul`'s own, else the row's; null without the feature.
  const launch = shownLaunch(inspected?.launch ?? row?.launch, cli);
  const refusal = spawnRefusal(row, cli);
  return { work: workText(row?.work), refusal, refusalLine: refusal === null ? null : cantSpawnLine(refusal), launch, ...harness(launch, inspected?.souls?.[0] ?? null, terms) };
}

/** The harness card: what a spawn here runs, where that choice came from and where to change it (0.30), else
 * the harness the soul declares by default and the model within it (a kernel before 0.30), else none. */
function harness(launch, soul, terms) {
  if (launch) {
    const at = launchAtText(launch.at);
    return {
      rows: [['Harness', launchHarnessName(launch.effective.harness)], ['Model', launchModelText(launch.effective)],
        ...(launch.effective.launchConfig ? [['Launch configuration', launch.effective.launchConfig]] : []), ['Chosen by', launchFromText(launch.from)],
        ...(declaredDiffers(launch) ? [['The soul prefers', preferenceText(launch.declared)]] : [])],
      notes: at ? [at] : [],
      problem: launch.problem ? launchProblemParts(launch.problem, terms) : null,
    };
  }
  const declared = harnessOf(soul);
  if (typeof declared === 'string' && declared) {
    return { rows: [['Default harness', launchHarnessName(declared)], ...(typeof soul.model === 'string' && soul.model ? [['Default model', soul.model]] : [])], notes: [], problem: null };
  }
  return { rows: [], notes: [NO_DEFAULT_HARNESS], problem: null };
}
