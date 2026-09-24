/** Plain-language wording for the Spawn dialog's problems.
 *
 * The preview/apply contracts carry a stable code and a technical message
 * (the kernel's own text for kernel refusals — paths, hashes, commands). The
 * dialog shows the operator one sentence about what happened and what to do;
 * the code and the technical message stay available behind "Details" for
 * troubleshooting. Wording only: no decision here depends on the text. */

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
  E_REQUIREMENT_INACTIVE: 'Something this soul needs isn’t set up yet. Check the soul in the Workspace view.',
  E_LAUNCH_ENV_MISSING: 'The chosen launch configuration can’t start on this machine. Choose another in Developer settings.',
  E_LAUNCH_EXECUTABLE: 'The chosen launch configuration can’t start on this machine. Choose another in Developer settings.',
  E_LAUNCH_PROBE_UNSUPPORTED: 'The chosen launch configuration can’t be checked safely. Choose another in Developer settings.',
  E_LAUNCH_CONFIG_UNKNOWN: 'That launch configuration no longer exists. Choose another in Developer settings.',
  E_MODEL_UNKNOWN: 'That model isn’t available for this runtime. Pick another model, or keep the default.',
  E_INSTANCE_NAME_INVALID: 'Use lowercase letters, numbers and dashes, and don’t reuse a soul’s name.',
  E_INSTANCE_NAME_TAKEN: 'An instance with this name already exists. Choose another name.',
  E_PACKAGE_MISSING: 'A package this soul uses isn’t installed yet. Run Sync in the Workspace view.',
  E_PACKAGE_INTEGRITY: 'A package this soul uses changed since it was approved. Run Sync in the Workspace view.',
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
};

/** { text, detail } for a { code, message } reason. `stage` is 'preview'
 * (reading defaults) or 'spawn' (after the operator pressed Spawn). */
export function spawnProblem(reason, stage = 'preview') {
  const code = typeof reason?.code === 'string' ? reason.code : 'E_CLI_FAILED';
  const own = stage === 'spawn' ? SPAWN : PREVIEW;
  const text = own[code] ?? COMMON[code] ?? (stage === 'spawn' ? SPAWN.E_CLI_FAILED : PREVIEW.E_CLI_FAILED);
  const message = typeof reason?.message === 'string' ? reason.message.trim() : '';
  return { text, code, detail: message ? `${code} · ${message}` : code };
}

/** The spawn catalog's state, for the soul chooser. */
export function catalogProblem(catalog) {
  if (!catalog) return '';
  const parts = [];
  if (catalog.reason) parts.push('OATS couldn’t load this workspace’s souls, so the list may be out of date. Sync the workspace and try again.');
  if (catalog.ambiguous?.length) parts.push(`Not offered because two repositories declare the same name: ${catalog.ambiguous.join(', ')}.`);
  return parts.join(' ');
}
