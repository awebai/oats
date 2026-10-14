/** The start rule's gate (#855, 5a-2): whether a row can be started, or restarted, now. Its own module, apart from
 * session-start.mjs (which re-exports it, and is where a client takes it from), because the Desktop's page decides
 * by it too and a page loads no Node builtin: this module imports none, and none of its imports does
 * (packages/desktop/test/inventory.test.mjs). Every sentence takes the client's `terms`. No state. */
import { canAddressRemote, unaddressableSentence } from './remote-address.mjs';
import { displayLine } from './display-text.mjs';
import { requireTerms } from './client-terms.mjs';

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
