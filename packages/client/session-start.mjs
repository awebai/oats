/** The start and restart rule of an existing instance (#855, 5a-2): whether a row can be started now
 * (`startGate`), the home a local start launches in (`verifiedLocalHome`), and the start itself
 * (`startInstance`). A client decides through these and words nothing of its own for them, except the codes
 * the rule leaves to it (below). Every function that words a sentence takes the client's `terms`
 * (client-terms.mjs) and refuses a call without them. No state.
 *
 * A failed start is one of two outcomes, and the words are "nothing was started", never "nothing happened"
 * (a restart that lost the race has already run its own stop):
 *   refused    this request started nothing: every refusal of the gate and of the home check, and the
 *              kernel's STARTED_NOTHING_CODES;
 *   uncertain  anything else: no envelope, any other code, and E_START_UNCONFIRMED, the end of the wait
 *              for a start that goes on (cli-adapter.mjs cliStart: no deadline, START_WAIT_MS). That code
 *              carries no sentence: each client words it (the Desktop: renderer/start-unconfirmed.mjs).
 * After any failed start, refused or uncertain, the client reads the row again before it offers anything. */
import { basename, dirname, sep } from 'node:path';
import { cliStart } from './cli-adapter.mjs';
import { harnessFlag } from './harness-names.mjs';
import { canAddressRemote, unaddressableSentence } from './remote-address.mjs';
import { retainedSpawnDetails } from './launch-prompt-outcome.mjs';
import { displayLine } from './display-text.mjs';
import { requireTerms } from './client-terms.mjs';

/** The kernel's codes for a start that started nothing: the home's start lock is held, or an earlier start's
 * pane is still a shell without its completion marker (E_SESSION_START_BUSY); the instance was seen running
 * before the start did anything, or its window appeared during the start (E_SESSION_RUNNING). A code joins
 * only when the kernel confirms it refuses before any effect. */
export const STARTED_NOTHING_CODES = Object.freeze(['E_SESSION_START_BUSY', 'E_SESSION_RUNNING']);

/** The two kernel codes' own sentences, for a client that words by code. The kernel's message is the
 * answer's `detail`, through the display filter. */
const STARTED_NOTHING = Object.freeze({
  E_SESSION_START_BUSY: 'Another start of this instance is still running. Nothing was started.',
  E_SESSION_RUNNING: 'This instance is already running. Nothing was started.',
});
const STATE_UNKNOWN = 'Could not verify whether this instance is running. Refresh its status before starting.';
const has = (list, name) => Array.isArray(list) && list.includes(name);

/** Why this row cannot be started (or restarted) now, or null. The first rule that applies, in this order:
 *   1 `not-in-roster`   the caller holds no such row (it passes the current row, or null);
 *   2 `already-running` running, and not a restart (a client offers its terminal instead);
 *   3 `state-unknown`   its state is not known stopped, and this is not a restart of a running row: unknown is
 *                       not stopped. `detail` is the row's own runtime error through the display filter, when
 *                       it has one, for the client to show with its speaker;
 *   4 E_SNAPSHOT_UNKNOWN a server's row the kernel does not report addressable;
 *   5 `cli-unavailable` / `unsupported-start-option` / `unsupported-remote-operation`  no accepted CLI, no
 *                       session-start, or (a server's row) no remote session-start;
 *   6 `unsupported-start-option`  a restart without session-restart (a server's row: also remote);
 *   7 `unsupported-start-option`  a launch choice (launchConfig, harness, yolo) without launch-config (a
 *                       server's row: also remote). The word that selects no configuration is a choice like
 *                       any other: no refusal of its own.
 * -> null | { code, sentence, detail? } */
export function startGate(cli, row, { restart = false, choices = {} } = {}, terms) {
  requireTerms(terms, 'startGate');
  const refused = (code, sentence, more = {}) => ({ code, sentence, ...more });
  if (!row) return refused('not-in-roster', 'This instance is no longer in this workspace. Refresh the workspace roster.');
  const running = row.running === true, remote = !!row.server;
  if (running && !restart) return refused('already-running', 'This instance is already running.');
  if (row.running !== false && !(restart && running)) {
    const detail = displayLine(row.runtimeError);
    return refused('state-unknown', STATE_UNKNOWN, detail ? { detail } : {});
  }
  if (!canAddressRemote(row)) return refused('E_SNAPSHOT_UNKNOWN', unaddressableSentence(row));
  if (cli?.ok !== true || !has(cli.features, 'session-start'))
    return refused(cli?.ok === true ? 'unsupported-start-option' : 'cli-unavailable', `Starting an existing instance needs an updated OATS CLI. ${displayLine(cli?.install) || 'Update OATS and retry.'}`);
  if (remote && !has(cli.remote, 'session-start')) return refused('unsupported-remote-operation', 'Update the OATS CLI to enable starting instances on a server.');
  if (restart && (!has(cli.features, 'session-restart') || (remote && !has(cli.remote, 'session-restart'))))
    return refused('unsupported-start-option', 'Update OATS to restart with another harness or configuration.');
  if ([choices?.launchConfig, choices?.harness, choices?.yolo].some(v => v !== undefined)
    && (!has(cli.features, 'launch-config') || (remote && !has(cli.remote, 'launch-config'))))
    return refused('unsupported-start-option', 'Update OATS to change the launch configuration.');
  return null;
}

/** The home a local start launches in, or null. It is DERIVED and VERIFIED, never trusted from roster data
 * alone: the exact home the kernel's status reported for this row in one of `deployments` (`[{ id, remote,
 * instances }]`: a deployment's directory and the rows it reported), canonicalizing to …/instances/<name>
 * inside that deployment's canonical directory. `realpath` is the caller's; this reads no file system of its
 * own. A server's row has no local home. */
export function verifiedLocalHome(row, deployments, realpath) {
  if (!row?.home || typeof row.home !== 'string' || row.server) return null;
  let real;
  try { real = realpath(row.home); } catch { return null; }
  if (basename(real) !== String(row.instance) || basename(dirname(real)) !== 'instances') return null;
  for (const w of deployments || []) {
    if (w.remote) continue;
    if (!(w.instances || []).some(i => !i.server && i.instance === row.instance && i.home === row.home)) continue;
    let scope;
    try { scope = realpath(w.id); } catch { continue; }
    if (real.startsWith(scope.endsWith(sep) ? scope : scope + sep)) return real;
  }
  return null;
}

/** Start or restart one row.
 *   choices   { model, launchConfig, harness, yolo }: the launch choices, each one argv value
 *   restart   a restart (the kernel's one call, never a stop then a start)
 *   localCwd  where a server's start runs from (this machine's own directory)
 *   verifyHome(row) -> canonical home | null   the caller's local home check; default verifiedLocalHome over
 *             `deployments` and `realpath`
 *   start     the CLI call (cli-adapter.mjs cliStart, with its own session and its wait); `exec`, `after` and
 *             `wait` pass to it
 * -> { ok: true, result } | { ok: false, outcome, code, sentence, detail, ran, incomplete? }
 * `ran`: whether the CLI was called. `sentence` is null for a code the client words (E_START_UNCONFIRMED) and
 * for one it does not know: it then shows `detail`, the kernel's message through the display filter.
 * `incomplete`: a start that stopped at a launch prompt (E_SPAWN_INCOMPLETE) and names this row, decoded. */
export async function startInstance(cli, row, choices = {}, { restart = false, deployments = [], realpath, localCwd, verifyHome, start = cliStart, exec, after, wait, terms } = {}) {
  requireTerms(terms, 'startInstance');
  const refused = (code, sentence, more = {}) => ({ ok: false, outcome: 'refused', code, sentence, detail: null, ran: false, ...more });
  const gate = startGate(cli, row, { restart, choices }, terms);
  if (gate) return refused(gate.code, gate.sentence, gate.detail ? { detail: gate.detail } : {});
  const local = !row.server;
  if (local && !(verifyHome ? verifyHome(row) : verifiedLocalHome(row, deployments, realpath)))
    return refused('E_HOME_UNVERIFIED', 'Instance home is outside the workspace instances layout');
  const envelope = await start(cli.bin, { home: row.home, model: choices.model, launchConfig: choices.launchConfig, harness: choices.harness,
    harnessFlag: harnessFlag(cli), yolo: choices.yolo, restart, workspaceDir: local ? dirname(row.agentsRoot) : localCwd, server: row.server },
  { ...(exec ? { exec } : {}), ...(after ? { after } : {}), ...(wait !== undefined ? { wait } : {}) });
  if (envelope?.ok === true) return { ok: true, result: envelope.result };
  const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : 'E_CLI_PROTOCOL';
  const detail = displayLine(envelope?.error?.message);
  const kept = code === 'E_SPAWN_INCOMPLETE' ? retainedSpawnDetails(envelope.error.details) : null;
  return { ok: false, outcome: STARTED_NOTHING_CODES.includes(code) ? 'refused' : 'uncertain', code,
    sentence: Object.hasOwn(STARTED_NOTHING, code) ? STARTED_NOTHING[code] : null, detail, ran: true,
    ...(kept?.launchPrompts && kept.instance === row.instance ? { incomplete: kept } : {}) };
}
