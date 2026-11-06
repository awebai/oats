/** A launch's `--instance <name>` (D3 of awebai/oats#1665): the window of the `--dir` deployment selects that
 * instance's roster row, as "show in roster" does (shell.mjs showInRoster: the row is revealed and takes keyboard
 * focus). It only selects: nothing starts, attaches or is written, and nothing is read beyond the roster reads the
 * window makes anyway.
 *
 * Main reads the argument (single-instance.mjs launchInstance) and sends the window `{ deployment, name }`, a name
 * the kernel's instance-name check takes, or `{ invalid: true }`, which never carries the value.
 * - The name counts only on rows of that deployment, on this computer (a home still being set up included):
 *   another deployment of the view, or a remote row, never matches and never makes a duplicate.
 * - One row: it is selected on the first roster read that lists it. Two or more: nothing is selected, and the window
 *   says so.
 * - None yet (a spawn still finishing): the request waits for the roster's next reads, up to
 *   LAUNCH_FOCUS_PENDING_MS, then the window says the name is not in this workspace.
 * - A person's choice wins: the request is dropped, silently, once the person selects anything (the shell's
 *   selection-ownership ticket, taken at the first roster read, when the window is bound to its workspace) or
 *   produces input or presses a pointer (spawn-follow.mjs watchOperator). A later launch's request replaces it.
 * Notices are text, and name only a validated name. DOM-free. */
import { validInstanceName } from '../../client/instance-name.mjs';

/** How long a name the roster does not list yet stays pending: a spawn still finishing. */
export const LAUNCH_FOCUS_PENDING_MS = 30_000;

const INVALID_NOTICE = 'The instance named at launch isn\'t a valid instance name.';
const noneNotice = (name) => `No instance ${name} in this workspace.`;
const manyNotice = (name) => `More than one instance in this workspace is named ${name}, so none was selected.`;

// TEMPORARY Step 1b probe; remove before hand-back. Records decisions without generating input.
const trace = (event, detail = {}) => {
  const events = globalThis.__oatsLaunchFocusTrace ??= [];
  events.push({ at: Date.now(), event, ...detail });
  if (events.length > 200) events.shift();
};

/** Main's message as a request: `{ deployment, name }` (an absolute deployment id and a valid name), `{ invalid:
 * true }`, or null for anything else. */
export function launchFocusRequest(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const keys = Object.keys(message).sort().join(',');
  if (keys === 'invalid') return message.invalid === true ? { invalid: true } : null;
  if (keys !== 'deployment,name') return null;
  const { deployment, name } = message;
  if (typeof deployment !== 'string' || !deployment.startsWith('/') || !validInstanceName(name)) return null;
  return { deployment, name };
}

/** The roster rows a request names: `{ row }` for exactly one, else `{ none: true }` or `{ many: true }`. */
export function launchFocusMatch(rows, { deployment, name }) {
  const matches = (Array.isArray(rows) ? rows : []).filter((i) => i && i.instance === name && !i.server && !i.remote
    && !i.pendingSpawn && i.deployment?.id === deployment);
  if (matches.length === 1) return { row: matches[0] };
  return matches.length ? { many: true } : { none: true };
}

/**
 * @param watch()  the shell's selection-ownership ticket: true while the person has selected nothing since it was taken
 * @param operator  watchOperator(document): { input(), pointer() }
 * @param select(row)  select the row as "show in roster" does; may be asynchronous
 * @param notify(text)  the window's notice
 * @param setTimer, clearTimer  the bound's clock
 */
export function createLaunchFocus({ watch, operator = { input: () => 0, pointer: () => 0 }, select, notify,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null; // { request, owns, input, pointer, timer }
  const drop = () => { if (pending) clearTimer(pending.timer); pending = null; };
  // Whether the person has not chosen since the request (since its ticket, once the first roster read took it).
  const quiet = (p) => {
    try {
      if (p.owns && !p.owns()) { trace('dropped', { why: 'ticket' }); return false; }
      if (operator.input() !== p.input) { trace('dropped', { why: 'operator input' }); return false; }
      if (operator.pointer() !== p.pointer) { trace('dropped', { why: 'operator pointer' }); return false; }
      return true;
    } catch { trace('dropped', { why: 'ownership check threw' }); return false; }
  };
  const expire = (p) => {
    if (pending !== p) return;
    pending = null;
    if (!quiet(p)) return;
    const text = p.request.invalid ? INVALID_NOTICE : noneNotice(p.request.name);
    trace('notified', { text });
    notify(text);
  };
  return {
    /** Main's message: a request replacing any pending one. A message that is not one changes nothing. */
    request(message) {
      const request = launchFocusRequest(message);
      if (!request) return;
      drop();
      const p = { request, owns: null, input: operator.input(), pointer: operator.pointer(), timer: null };
      p.timer = setTimer(() => expire(p), LAUNCH_FOCUS_PENDING_MS);
      pending = p;
      trace('pending', { request });
    },
    /** An observed roster read of the window's workspace, its rows painted. */
    observe(rows) {
      const p = pending;
      if (!p) return;
      if (!quiet(p)) { drop(); return; }
      if (!p.owns) { p.owns = watch(); trace('ticket taken'); }
      if (p.request.invalid) { drop(); trace('notified', { text: INVALID_NOTICE }); notify(INVALID_NOTICE); return; }
      const match = launchFocusMatch(rows, p.request);
      if (match.none) { trace('pending, no matching row'); return; }
      drop();
      if (match.many) { trace('notified', { text: manyNotice(p.request.name) }); notify(manyNotice(p.request.name)); return; }
      trace('matched', { name: match.row.instance });
      // A select that throws or rejects (the row went meanwhile) leaves nothing more to do.
      try {
        Promise.resolve(select(match.row)).then(result => trace('selected', { result }),
          () => trace('selection rejected'));
      } catch { trace('selection threw'); }
    },
    pending: () => pending !== null,
    dispose: drop,
  };
}
