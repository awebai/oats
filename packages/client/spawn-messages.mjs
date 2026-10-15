/** Plain-language wording for the Spawn dialog's problems.
 *
 * The preview/apply contracts carry a stable code and a technical message
 * (the kernel's own text for kernel refusals — paths, hashes, commands). The
 * dialog shows the operator one sentence about what happened and what to do;
 * the code and the technical message stay available behind "Details" for
 * troubleshooting. Wording only: no decision here depends on the text. */
import { displayLine } from './display-text.mjs';
import { ROLLED_BACK_CODES } from './spawn-apply-contract.mjs';
import { retainedSpawnMessage } from './launch-prompt-outcome.mjs';

const UNMATCHED = 'E_LAUNCH_PREFERENCE_UNMATCHED';

const COMMON = {
  E_BAD_ARGS: 'Some of these values can’t be used. Check the name and Developer settings.',
  E_BUSY: 'Another spawn is in progress. Try again in a moment.',
  E_FORBIDDEN_FRAME: 'This window can’t start a spawn.',
  E_PREVIEW_UNAVAILABLE: 'Spawning needs a newer OATS. Update OATS, then open this dialog again.',
  E_APPLY_UNAVAILABLE: 'Spawning needs a newer OATS. Update OATS, then open this dialog again.',
  E_WORKSPACE_UNKNOWN: 'This workspace isn’t available anymore. Choose it again from the workspace menu.',
  E_SOUL_UNKNOWN: 'This soul isn’t in the workspace anymore. Sync the workspace and try again.',
  E_SOUL_AMBIGUOUS: 'Two repositories declare a soul with this name, so it can’t be spawned until one is renamed.',
  E_UNSUPPORTED_MODE: 'This soul can’t be started on its own from here.',
  'unsupported-remote-operation': 'The execution server decides this soul’s defaults.',
  E_UNSUPPORTED_OPTION: 'One of the options you chose isn’t supported here. Set it back to the default and try again.',
  E_RELATIVE_AMBIGUOUS: 'The instance you picked for the relationship can’t be told apart from another one. Pick it again.',
  E_SESSION_UNKNOWN: 'The instance you picked for the relationship isn’t available anymore. Pick another one.',
  E_HOME_MISMATCH: 'The instance you picked for the relationship isn’t available anymore. Pick another one.',
  E_CHILD_SPAWNS_DISABLED: 'The parent you picked doesn’t allow child instances. Pick another one, or choose None.',
  E_BRANCH_EXISTS: 'That branch already exists. Choose another branch in Developer settings.',
  E_BASE_UNKNOWN: 'That base isn’t a branch, tag or commit in this soul’s repository. Check it in Developer settings.',
  E_CLONE_MISSING: 'This soul’s repository isn’t cloned on this machine yet. Clone it, then try again — Details shows how.',
  E_LAUNCH_ENV_MISSING: 'The chosen launch configuration can’t start on this machine. Choose another in Developer settings.',
  E_LAUNCH_EXECUTABLE: 'The chosen launch configuration can’t start on this machine. Choose another in Developer settings.',
  E_LAUNCH_PROBE_UNSUPPORTED: 'The chosen launch configuration can’t be checked safely. Choose another in Developer settings.',
  E_LAUNCH_CONFIG_UNKNOWN: 'That launch configuration no longer exists. Choose another in Developer settings.',
  // 0.52.0: the kernel refuses a spawn that names no launch configuration where the harness has several and
  // none is the default. The sentence names the dialog's own control; the kernel's message, which ends with
  // its command-line fix, stays in Details.
  E_LAUNCH_CONFIG_AMBIGUOUS: 'This machine has more than one launch configuration for this soul’s harness, and none is the default. Choose one under Launch configuration in Developer settings.',
  // 0.30 launch preferences: shown in the kernel's own words when it sends them (spawnProblem: the
  // message, then the reason's flat `fix`), which name the harness and where it was chosen; this is the fallback.
  E_HARNESS_UNAVAILABLE: 'The harness this soul would run isn’t installed on this machine. Install it, or pick another harness above.',
  // 0.53.0: the kernel refuses a spawn that names no launch while `souls.launch` holds a key that names no
  // soul. This sentence points at the controls above it and at Details, so it is read only where both are
  // there: at the preview, with the kernel's message and fix quoted under Details (spawnProblem's `kernel`
  // parts). Everywhere else the shorter one of SPAWN is read.
  [UNMATCHED]: 'This machine’s launch preferences name a soul this workspace doesn’t offer, so OATS won’t choose a launch for this soul. To spawn now, pick a harness above, or a launch configuration in Developer settings. To fix it for every spawn, correct the preference (Details).',
  E_MODEL_UNKNOWN: 'That model isn’t available for this harness. Pick another model, or keep the default.',
  E_INSTANCE_NAME_INVALID: 'Use lowercase letters, numbers and dashes, at most 64 characters, and don’t reuse a soul’s name.',
  E_INSTANCE_NAME_TAKEN: 'An instance with this name already exists. Choose another name.',
  E_PACKAGE_MISSING: 'A package this soul uses isn’t installed yet. Run Sync in the Workspace view.',
  E_PACKAGE_INTEGRITY: 'A package this soul uses no longer matches the lock. Run Sync in the Workspace view.',
  E_TARGET_CHANGED: 'The workspace changed while this was loading. Reading it again…',
  E_PLAN_CHANGED: 'The workspace changed while this was loading. Check the values and press Spawn again.',
};

const PREVIEW = {
  E_CLI_TIMEOUT: 'OATS took too long to work out this soul’s defaults. Try again.',
  E_CLI_OUTPUT_LIMIT: 'OATS couldn’t work out this soul’s defaults. Try again, or see Details.',
  E_CLI_PROTOCOL: 'OATS couldn’t work out this soul’s defaults. Try again, or see Details.',
  E_CLI_FAILED: 'OATS couldn’t work out this soul’s defaults. Try again, or see Details.',
};

const SPAWN = {
  E_PLAN_REQUIRED: 'Check the values and press Spawn to confirm.',
  E_DECISION_STALE: 'Something changed before the spawn went through. Nothing was created — check the updated values and press Spawn again.',
  E_IDEMPOTENCY_CONFLICT: 'Something changed before the spawn went through. Nothing was created — check the updated values and press Spawn again.',
  E_PLACEMENT_TAKEN: 'Another spawn just took this name. Nothing was created — check the new name and press Spawn again.',
  E_INTENT_EXPIRED: 'This spawn request expired. Check the instance list before spawning again.',
  E_PREFLIGHT_INCOMPLETE: 'OATS couldn’t finish checking this spawn. Try again.',
  E_BACKEND_UNAVAILABLE: 'That session backend isn’t installed on this machine. Choose another in Developer settings.',
  E_INSTANCE_GONE: 'The instance that was created isn’t there anymore. Check the instance list.',
  E_OUTCOME_UNKNOWN: 'We couldn’t confirm whether the instance was created. Use Check result before spawning again.',
  E_SPAWN_INCOMPLETE: 'The instance was created but didn’t finish starting. Open it from the instance list instead of spawning again.',
  E_INPUT_PREPARATION: 'The opening instruction couldn’t be prepared, so nothing was started. Try again.',
  E_CLI_TIMEOUT: 'OATS took too long to answer. The instance may already exist — use Check result before spawning again.',
  E_CLI_OUTPUT_LIMIT: 'OATS couldn’t confirm the spawn. Use Check result before spawning again.',
  E_CLI_PROTOCOL: 'OATS couldn’t complete the spawn. Try again, or see Details.',
  E_CLI_FAILED: 'OATS couldn’t complete the spawn. Try again, or see Details.',
  // An unmatched launch preference where nothing is above the sentence and Details hold no kernel text: the
  // notice after a press has left the dialog, and a preview whose reason carries no `fix`.
  [UNMATCHED]: 'This machine’s launch preferences name a soul this workspace doesn’t offer, so OATS won’t choose a launch for this soul. To spawn now, pick a harness or a launch configuration for this spawn. To fix it for every spawn, correct the preference.',
};

/** The act that follows a problem or an outcome, where the sentence a client shows names one (#855, 6b-2): the
 * client says it in its own words, naming its own controls. Closed and frozen: a new code is a SURFACE change,
 * with the TUI's lead told.
 *   change-options    change an option of this spawn
 *   review-again      look at the values again and confirm again
 *   check-result      read the outcome again before spawning again
 *   update-oats       update OATS, then try again
 *   choose-workspace  choose the workspace again
 *   sync-workspace    sync the workspace
 *   details           the kernel's detail says more
 *   retire            retire the instance to finish its cleanup
 *   view-schedules    open the schedules
 *   open-from-list    open the instance from the instance list */
export const SPAWN_NEXT = Object.freeze(['change-options', 'review-again', 'check-result', 'update-oats', 'choose-workspace',
  'sync-workspace', 'details', 'retire', 'view-schedules', 'open-from-list']);

/** The shared fact of each code, and its `next` where the sentence goes on to name an act. What every client
 * says alike stays in the fact: the instance list, syncing the workspace, "Try again.", "Pick it again.". */
const said = (fact, next = null) => Object.freeze({ fact, next });
const COMMON_FACTS = {
  E_BAD_ARGS: said('Some of these values can’t be used.', 'change-options'),
  E_BUSY: said('Another spawn is in progress. Try again in a moment.'),
  E_PREVIEW_UNAVAILABLE: said('Spawning needs a newer OATS.', 'update-oats'),
  E_APPLY_UNAVAILABLE: said('Spawning needs a newer OATS.', 'update-oats'),
  E_WORKSPACE_UNKNOWN: said('This workspace isn’t available anymore.', 'choose-workspace'),
  E_SOUL_UNKNOWN: said('This soul isn’t in the workspace anymore. Sync the workspace and try again.'),
  E_SOUL_AMBIGUOUS: said('Two repositories declare a soul with this name, so it can’t be spawned until one is renamed.'),
  E_UNSUPPORTED_MODE: said('This soul can’t be started on its own from here.'),
  'unsupported-remote-operation': said('The execution server decides this soul’s defaults.'),
  E_UNSUPPORTED_OPTION: said('One of the options you chose isn’t supported here. Set it back to the default and try again.'),
  E_RELATIVE_AMBIGUOUS: said('The instance you picked for the relationship can’t be told apart from another one. Pick it again.'),
  E_SESSION_UNKNOWN: said('The instance you picked for the relationship isn’t available anymore. Pick another one.'),
  E_HOME_MISMATCH: said('The instance you picked for the relationship isn’t available anymore. Pick another one.'),
  E_CHILD_SPAWNS_DISABLED: said('The parent you picked doesn’t allow child instances.', 'change-options'),
  E_BRANCH_EXISTS: said('That branch already exists.', 'change-options'),
  E_BASE_UNKNOWN: said('That base isn’t a branch, tag or commit in this soul’s repository.', 'change-options'),
  E_CLONE_MISSING: said('This soul’s repository isn’t cloned on this machine yet. Clone it, then try again.', 'details'),
  E_LAUNCH_ENV_MISSING: said('The chosen launch configuration can’t start on this machine.', 'change-options'),
  E_LAUNCH_EXECUTABLE: said('The chosen launch configuration can’t start on this machine.', 'change-options'),
  E_LAUNCH_PROBE_UNSUPPORTED: said('The chosen launch configuration can’t be checked safely.', 'change-options'),
  E_LAUNCH_CONFIG_UNKNOWN: said('That launch configuration no longer exists.', 'change-options'),
  E_LAUNCH_CONFIG_AMBIGUOUS: said('This machine has more than one launch configuration for this soul’s harness, and none is the default.', 'change-options'),
  // The fallback, where the kernel sent no words of its own (spawnProblem quotes them, with no `next`).
  E_HARNESS_UNAVAILABLE: said('The harness this soul would run isn’t installed on this machine.', 'change-options'),
  // At the preview, with the kernel's message and fix as `kernel` parts: the client names its own controls.
  [UNMATCHED]: said('This machine’s launch preferences name a soul this workspace doesn’t offer, so OATS won’t choose a launch for this soul.', 'change-options'),
  E_MODEL_UNKNOWN: said('That model isn’t available for this harness. Pick another model, or keep the default.'),
  E_INSTANCE_NAME_INVALID: said('Use lowercase letters, numbers and dashes, at most 64 characters, and don’t reuse a soul’s name.'),
  E_INSTANCE_NAME_TAKEN: said('An instance with this name already exists. Choose another name.'),
  E_PACKAGE_MISSING: said('A package this soul uses isn’t installed yet.', 'sync-workspace'),
  E_PACKAGE_INTEGRITY: said('A package this soul uses no longer matches the lock.', 'sync-workspace'),
  E_TARGET_CHANGED: said('The workspace changed while this was loading. Reading it again…'),
  E_PLAN_CHANGED: said('The workspace changed while this was loading.', 'review-again'),
};
const PREVIEW_FACTS = {
  E_CLI_TIMEOUT: said('OATS took too long to work out this soul’s defaults. Try again.'),
  E_CLI_OUTPUT_LIMIT: said('OATS couldn’t work out this soul’s defaults.', 'details'),
  E_CLI_PROTOCOL: said('OATS couldn’t work out this soul’s defaults.', 'details'),
  E_CLI_FAILED: said('OATS couldn’t work out this soul’s defaults.', 'details'),
};
const SPAWN_FACTS = {
  E_DECISION_STALE: said('Something changed before the spawn went through. Nothing was created.', 'review-again'),
  E_IDEMPOTENCY_CONFLICT: said('Something changed before the spawn went through. Nothing was created.', 'review-again'),
  E_PLACEMENT_TAKEN: said('Another spawn just took this name. Nothing was created.', 'review-again'),
  E_INTENT_EXPIRED: said('This spawn request expired. Check the instance list before spawning again.'),
  E_PREFLIGHT_INCOMPLETE: said('OATS couldn’t finish checking this spawn. Try again.'),
  E_BACKEND_UNAVAILABLE: said('That session backend isn’t installed on this machine.', 'change-options'),
  E_INSTANCE_GONE: said('The instance that was created isn’t there anymore. Check the instance list.'),
  E_OUTCOME_UNKNOWN: said('We couldn’t confirm whether the instance was created.', 'check-result'),
  E_SPAWN_INCOMPLETE: said('The instance was created but didn’t finish starting. Open it from the instance list instead of spawning again.'),
  E_INPUT_PREPARATION: said('The opening instruction couldn’t be prepared, so nothing was started. Try again.'),
  E_CLI_TIMEOUT: said('OATS took too long to answer. The instance may already exist.', 'check-result'),
  E_CLI_OUTPUT_LIMIT: said('OATS couldn’t confirm the spawn.', 'check-result'),
  E_CLI_PROTOCOL: said('OATS couldn’t complete the spawn.', 'details'),
  E_CLI_FAILED: said('OATS couldn’t complete the spawn.', 'details'),
  // Wherever nothing is above the sentence and Details hold no kernel text: the whole of it is shared.
  [UNMATCHED]: said('This machine’s launch preferences name a soul this workspace doesn’t offer, so OATS won’t choose a launch for this soul. To spawn now, pick a harness or a launch configuration for this spawn. To fix it for every spawn, correct the preference.'),
};

/** { text, fact, next, code, detail } for a { code, message } reason. `stage` is 'preview'
 * (reading defaults) or 'spawn' (after the operator pressed Spawn).
 *
 * For an unmatched launch preference whose reason carries the kernel's `fix`, the answer also has
 * `kernel: { message, fix }`: the kernel's two texts, the strings as they came, for the client to quote
 * under the kernel's name (the lead is the client's, `originLead` with its terms). `detail` is then the
 * code alone, so that no reader of `detail` shows a kernel text without its speaker. A `fix` decides it
 * because `previewFailure` keeps one only beside the kernel's own message, never beside a table's sentence:
 * a reason without one (a press, a kernel that sent none, a message that did not travel) reads
 * `code · message` as every other code does.
 *
 * `fact` is what happened, in words every client shows alike, and `next` the act that follows (SPAWN_NEXT),
 * or null where the fact says all: the client puts its own words for `next` after the fact. A code the
 * tables do not know reads the stage's E_CLI_FAILED fact, with its own code. `text` is the Desktop's
 * sentence. */
export function spawnProblem(reason, stage = 'preview') {
  const code = typeof reason?.code === 'string' ? reason.code : 'E_CLI_FAILED';
  const own = stage === 'spawn' ? SPAWN : PREVIEW;
  const message = typeof reason?.message === 'string' ? reason.message.trim() : '';
  // A missing harness is said as the kernel words it, with its fix (launch preferences, 0.30).
  const fix = typeof reason?.fix === 'string' ? reason.fix.trim() : '';
  if (code === UNMATCHED) {
    const kernel = fix ? { message: typeof reason.message === 'string' ? reason.message : '', fix: reason.fix } : null;
    // The sentence that says "above" and "(Details)" is read only where Details hold the kernel's texts.
    if (kernel) return { text: stage === 'preview' ? COMMON[UNMATCHED] : SPAWN[UNMATCHED], ...(stage === 'preview' ? COMMON_FACTS : SPAWN_FACTS)[UNMATCHED], code, detail: code, kernel };
    return { text: SPAWN[UNMATCHED], ...SPAWN_FACTS[UNMATCHED], code, detail: message ? `${code} · ${message}` : code };
  }
  // The kernel's message usually already ends with its fix: said once.
  const kernelWords = code === 'E_HARNESS_UNAVAILABLE' && message ? (fix && !message.includes(fix) ? `${message.replace(/[.\s]+$/, '')}: ${fix}` : message) : null;
  const text = kernelWords ?? own[code] ?? COMMON[code] ?? (stage === 'spawn' ? SPAWN.E_CLI_FAILED : PREVIEW.E_CLI_FAILED);
  const facts = stage === 'spawn' ? SPAWN_FACTS : PREVIEW_FACTS;
  const words = kernelWords ? said(kernelWords) : facts[code] ?? COMMON_FACTS[code] ?? facts.E_CLI_FAILED;
  return { text, fact: words.fact, next: words.next, code, detail: message ? `${code} · ${message}` : code };
}

/** The spawn catalog's state, for the soul chooser. */
export function catalogProblem(catalog) {
  if (!catalog) return '';
  const parts = [];
  if (catalog.reason) parts.push('OATS couldn’t load this workspace’s souls, so the list may be out of date. Sync the workspace and try again.');
  if (catalog.ambiguous?.length) parts.push(`Not offered because two repositories declare the same name: ${catalog.ambiguous.join(', ')}.`);
  return parts.join(' ');
}

/** Feature worktree-event (#802): the kernel rolled the spawn back (E_INTERRUPTED,
 * E_REQUIRED_HOOK_FAILED, E_HOOK_ENVIRONMENT_CONTRACT without `unconfirmed`), so nothing
 * was created; or its cleanup is owed (the same codes with it). The kernel's message names
 * the capability and its log: it goes under Details, through displayLine. */
export function rolledBackProblem(reason, instance) {
  const code = reason?.code;
  if (!ROLLED_BACK_CODES.includes(code)) return null;
  const text = code === 'E_INTERRUPTED'
    ? `The spawn of ${instance} was interrupted while its worktree was being set up, and was rolled back. Nothing was created.`
    : `A capability couldn’t set up the worktree for ${instance}, so the spawn was rolled back. Nothing was created.`;
  return { text, fact: text, next: null, code, detail: kernelDetail(code, reason.message) };
}
/** `instance` travels with the answer: the client names it in its words for `next` (retire). */
export function cleanupOwedProblem(reason, instance) {
  if (!ROLLED_BACK_CODES.includes(reason?.code)) return null;
  return { text: `The spawn of ${instance} was stopped, but its cleanup didn’t finish. Retire ${instance} from the roster to complete it.`,
    fact: `The spawn of ${instance} was stopped, but its cleanup didn’t finish.`, next: 'retire', instance,
    code: reason.code, detail: kernelDetail(reason.code, reason.message) };
}

/** A spawn transaction's outcome in shared words (spawn-transaction.mjs `kind`), as { fact, next } for the
 * client to say with its own words for `next`; `instance` is the name the spawn was given. null for a kind whose
 * words are its reason's (unknown, refused: spawnProblem(outcome.reason, 'spawn')).
 *   created          complete: "Created <i>." (launched), "Created <i> — not launched." (open-from-list);
 *                    partial: the reason's message (view-schedules), or, for a wake whose outcome is unknown,
 *                    "Agent created; wake outcome unavailable." (the boundary's message names the Desktop's
 *                    Schedules: that act is view-schedules); incomplete: the retained spawn's sentence
 *   not-yet-visible  created, and not in the instance list as a running session in time (open-from-list)
 *   pending-expired  still running at the deadline (check-result)
 *   cleanup-owed     cleanupOwedProblem's (retire); rolled-back: rolledBackProblem's
 *   never-submitted  prepared, never applied (review-again)
 *   drifted          the values changed since they were confirmed (review-again) */
export function outcomeWords(kind, view, instance) {
  if (kind === 'created') {
    if (view?.status === 'incomplete') return said(retainedSpawnMessage(view.incomplete));
    if (view?.status === 'partial' && view.reason?.code === 'E_WAKE_OUTCOME_UNKNOWN') return said('Agent created; wake outcome unavailable.', 'view-schedules');
    if (view?.status === 'partial') return said(view.reason?.message || `Created ${instance}.`, 'view-schedules');
    return view?.receipt?.launched === false ? said(`Created ${instance} — not launched.`, 'open-from-list') : said(`Created ${instance}.`);
  }
  if (kind === 'not-yet-visible') return said(`Created ${instance} — not yet visible as a running session.`, 'open-from-list');
  if (kind === 'pending-expired') return said('The spawn is still running.', 'check-result');
  if (kind === 'cleanup-owed' || kind === 'rolled-back') {
    const problem = (kind === 'cleanup-owed' ? cleanupOwedProblem : rolledBackProblem)(view?.reason, instance);
    return problem ? said(problem.fact, problem.next) : null;
  }
  if (kind === 'never-submitted') return said('That spawn was never submitted.', 'review-again');
  if (kind === 'drifted') return said('These values changed since you last looked.', 'review-again');
  return null;
}
function kernelDetail(code, message) {
  const line = displayLine(message);
  return line ? `${code} · ${line}` : code;
}
