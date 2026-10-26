// tmux attach-target construction for the desktop terminal — extracted from
// main.mjs so the exact-match anchoring is unit-testable.
//
// tmux `-t` targets are PREFIX-matched by default (the reviewer-death
// incident: `kill-window -t s:reviewer-1` matched `reviewer-15c...`). For
// the attach path the same hazard means: with a stale roster and the exact
// window gone, an unanchored `session:window` attaches to a similarly named
// live window and the user's keystrokes go to the WRONG agent's session.
// `=` anchors each component to an exact match — tmux then errors out
// ("can't find window") instead of silently prefix-matching, which the
// renderer surfaces as its "could not attach" state.

/**
 * @param {string} session  tmux session name (no ':' — it's the separator;
 *                          no leading '=' games; conservative charset)
 * @param {string|number} [window]  window name or index (optional)
 * @returns {string} an exact-match anchored target: "=session" or
 *                   "=session:=window"
 * @throws on invalid session/window values
 */
export function tmuxAttachTarget(session, window) {
  if (typeof session !== "string" || !/^[\w@%.-]+$/.test(session)) {
    throw new Error("term:open: bad session name");
  }
  if (window === undefined || window === null) return `=${session}`;
  const win = String(window);
  if (!/^[\w@%.-]+$/.test(win)) throw new Error("term:open: bad window name");
  return `=${session}:=${win}`;
}

/**
 * The term:open sequence — target anchoring, preflight, pty spawn — with
 * injectable dependencies so the ORDER is testable (review tmuxtgt2: a
 * preflight only proven by an isolated tmux test is unprotected; deleting
 * it left the suite green).
 *
 * node-pty's spawn succeeds once the tmux BINARY starts; a bad -t target
 * only surfaces as an async exit AFTER term:open resolved with an id — the
 * renderer's open-error path then never fires (a 'session ended' banner at
 * best, or a blank tab when the exit races the listener install). The
 * preflight verifies the exact target NOW and throws BEFORE any pty exists,
 * so a missing target reliably rejects term:open → the renderer's
 * 'could not attach' banner.
 *
 * @param {{ session: string, window?: string|number, cols?: number, rows?: number }} spec
 * @param {{ preflight: (target: string) => void,   // throws if target absent
 *           spawnPty: (target: string, cols: number, rows: number) => any }} io
 * @returns {{ target: string, pty: any }}
 */
/** Viewer-session name prefix: unique per app process so the orphan sweep
 * (app start/quit) is exact and can never touch foreign sessions. */
export function viewerPrefix(pid) {
  return `oatsdesk-${pid}-`;
}

/**
 * The term:open sequence with a per-tab LINKED-WINDOW viewer session —
 * target anchoring, preflight, viewer creation, pty spawn — with injectable
 * dependencies so the ORDER and the cleanup contract are testable.
 *
 * WHY a linked window (not session grouping): grouping isolates the
 * current-window SELECTION but shares window MEMBERSHIP — when the selected
 * source window dies (routine retire!), tmux auto-selects a sibling in the
 * viewer, and viewer-side key bindings can navigate to sibling windows;
 * both silently steer the tab to ANOTHER AGENT under a stale label. The
 * viewer is therefore an independent ephemeral session containing ONLY a
 * link to the exact requested window:
 *   1. create placeholder session (unique unpredictable oatsdesk- name);
 *   2. link-window the =-anchored exact source window in;
 *   3. kill the placeholder window — the link is the sole window;
 *   4. lock the viewer: prefix/prefix2 None + a dedicated key-table —
 *      PROVISIONED with exactly the safe wheel bindings (see
 *      LOCKED_TABLE_BINDINGS) and nothing else, so no tmux
 *      window-management key can leave the linked window while wheel
 *      scrollback (tmux-owned history!) keeps working. Normal pane
 *      interaction is raw input to the pty and unaffected.
 * Destroying the source window then TERMINATES the viewer (its only window
 * is gone → pty exits → the tab shows "session ended") — verified
 * empirically; it can never activate a sibling. The pty exit rests on the
 * viewer's own detach-on-destroy on: with a global `detach-on-destroy off`
 * tmux would otherwise move the client to another session (often another
 * viewer) and the tab would show another agent under the old name (#1237).
 *
 * Cleanup contract: kill ONLY the viewer session (=-anchored, unique name);
 * killing the viewer never kills the linked source window (link refcount).
 *
 * @param {{ session: string, window?: string|number, cols?: number, rows?: number }} spec
 * @param {object} io
 * @param {(target: string) => void} io.preflight   throws if the exact source target is absent
 * @param {(args: string[]) => void} io.tmux        run a tmux command (throws on failure)
 * @param {(args: string[]) => string} io.tmuxOut    run a tmux command, return trimmed stdout
 * @param {(target: string, cols: number, rows: number) => any} io.spawnPty
 * @param {() => boolean} [io.forwardsBoundKey]     this tmux sends a bound key on (3.3+): the C-b table; absent: none
 * @param {() => string} [io.uniqueName]            viewer session name (default: prefix+pid+counter+random)
 * @returns {{ target: string, viewer: string, pty: any,
 *             killViewer: () => void }}
 */
let viewerSeq = 0;

/** The locked key table's COMPLETE binding set — wheel scrollback, drag-to-select and Shift+PgUp.
 * An inert (nonexistent) table blocked window escape but also killed wheel
 * handling entirely: pi runs on the alternate screen, so scrollback history
 * belongs to tmux and the renderer cannot recover it — scrolling died.
 * WheelUpPane ports tmux's root behavior with ONE deliberate difference:
 * the stock root binding passes through on alternate_on (send-keys -M →
 * arrow translation), which is exactly the dead case for pi — here the
 * wheel passes through only when the app grabbed the mouse or a mode is
 * already active, and otherwise enters copy-mode exit-at-bottom and
 * forwards the wheel (copy-mode's own WheelUp/WheelDownPane then do 5-line
 * scrolling until -e exits at the bottom). NO window-management bindings
 * (next/last/new/select-window...) exist here — that is the lock.
 * The kernel's viewer binds the same (lib/session-viewer.mjs VIEWER_BINDINGS), which a test pins.
 * Exported so tests can assert the exact provisioned set. */
export const LOCKED_TABLE_BINDINGS = [
  // argv tail for: tmux bind-key -T <viewer> <key> <command...>
  ["WheelUpPane", "if-shell", "-F", "#{||:#{pane_in_mode},#{mouse_any_flag}}", "send-keys -M", "copy-mode -e; send-keys -M"],
  // tmux's root drag behavior (#520): copy mode's own drag-end binding copies the selection and tmux sends it as
  // OSC 52 (set-clipboard external, its default); an app that grabbed the mouse gets the drag. It serves the CLI
  // viewer (lib/session-viewer.mjs binds the same) and the renderer's far-side fallback only: a Desktop tab keeps
  // the mouse buttons for xterm's own selection (renderer/terminal-mouse.mjs, #672), so no drag reaches tmux there.
  ["MouseDrag1Pane", "if-shell", "-F", "#{||:#{pane_in_mode},#{mouse_any_flag}}", "send-keys -M", "copy-mode -M"],
  // Shift+PgUp (#1476, #1502): copy mode, a page up. The renderer's key path sends tmux the key (CSI 5;2 ~),
  // which xterm.js would otherwise keep to scroll its own, empty, viewport.
  ["S-PageUp", "copy-mode -u"],
];
/** The viewer's C-b table (#1502), where this tmux sends a bound key on (3.3 and later,
 * local-tmux-io.mjs tmuxForwardsBoundKey). The viewer's locked table binds PREFIX_KEY to the one
 * `switch-client` it holds, `-T <viewer>-prefix`: a key-table switch, never a session switch. The
 * client reads its next key there, and tmux takes it back to the locked table after that key, with no
 * timeout. `[` enters copy mode; the wheel, the drag and Shift+PgUp send the C-b on, then do what the
 * locked table does; and any other key (`Any`) sends the C-b, then the key itself (`send-keys` with no
 * key sends the key it is bound to), so C-b n or C-b C-b reaches the agent as typed. Nothing here
 * manages a window or a session. The bindings are the kernel viewer's
 * (lib/session-viewer.mjs LOCKED_PREFIX_BINDINGS), which a test pins. */
export const PREFIX_KEY = "C-b";
export const LOCKED_PREFIX_BINDINGS = [
  ["[", "copy-mode"],
  ["WheelUpPane", "send-keys C-b ; if-shell -F '#{||:#{pane_in_mode},#{mouse_any_flag}}' 'send-keys -M' 'copy-mode -e; send-keys -M'"],
  ["MouseDrag1Pane", "send-keys C-b ; if-shell -F '#{||:#{pane_in_mode},#{mouse_any_flag}}' 'send-keys -M' 'copy-mode -M'"],
  ["S-PageUp", "send-keys C-b ; copy-mode -u"],
  ["Any", "send-keys C-b ; if-shell -F '#{!=:#{mouse_x},}' 'send-keys -M' 'send-keys'"],
];
/** What a viewer's C-b table adds to its name: the kernel's (lib/session-viewer.mjs PREFIX_TABLE_SUFFIX),
 * which a test pins. */
export const PREFIX_TABLE_SUFFIX = "-prefix";
/** A viewer's own two key tables (#1502), named after its session: its locked table and its C-b
 * table. Key tables are server-global; tables of its own are bound once, as the viewer is made, so
 * no other viewer, older app or user config shares them, and nothing need be cleared or kept. They
 * are emptied when the viewer closes (killViewer), and a viewer that dies another way (with its
 * source window, with a crashed app) leaves them to sweepViewers. tmux resets every client's key
 * table whenever any session's key-table option is set, so a C-b pending at the instant another
 * viewer opens is dropped: press it again. */
export const viewerTables = (viewer) => [viewer, `${viewer}${PREFIX_TABLE_SUFFIX}`];
/** A table of a Desktop viewer: its session's name (oatsdesk-<pid>-<seq>-<random>), or that and
 * `-prefix`. An older Desktop's shared oatsdesk-locked table, which may still be in use, is not one. */
const VIEWER_TABLE = new RegExp(`^oatsdesk-\\d+-\\d+-[0-9a-z]+(?:${PREFIX_TABLE_SUFFIX})?$`);
/** The key tables a `tmux list-keys` names, once each, in the order it lists them. */
export function listedTables(listing) {
  const tables = new Set();
  for (const line of String(listing).split("\n")) {
    const match = /\s-T\s+(\S+)\s/.exec(line);
    if (match) tables.add(match[1]);
  }
  return [...tables];
}

export function openTerm(spec, io) {
  const target = tmuxAttachTarget(spec.session, spec.window);
  try {
    io.preflight(target);
  } catch {
    throw new Error(`term:open: no tmux target ${target}`);
  }
  const viewer = io.uniqueName ? io.uniqueName()
    : `${viewerPrefix(process.pid)}${++viewerSeq}-${Math.random().toString(36).slice(2, 8)}`;
  // 1. placeholder session — exists only to receive the link. Capture the
  //    placeholder's window ID: fixed indices (0/9) break under a custom
  //    base-index (review linkview — base-index 1 made kill-window :0 fail
  //    and every open reject); window IDs are index-agnostic.
  let cleaned = false, cleaning = null;
  const killViewer = () => {
    if (cleaned) return;
    if (io.cleanupViewer) {
      if (!cleaning) cleaning = Promise.resolve().then(() => io.cleanupViewer(viewer))
        .then(() => { cleaned = true; }).finally(() => { cleaning = null; });
      return cleaning;
    }
    try { io.tmux(["kill-session", "-t", `=${viewer}`]); }
    catch (error) {
      // Source death may already have removed its linked-only viewer. Only a
      // successful inventory proving this exact name absent confirms cleanup;
      // an inaccessible/unresponsive server is uncertainty, not absence.
      const names = io.tmuxOut(["list-sessions", "-F", "#{session_name}"]).split('\n');
      if (names.includes(viewer)) throw error;
    }
    // Then its own tables, once no client can be reading them. A table left behind is the sweep's.
    for (const table of viewerTables(viewer)) {
      try { io.tmux(["unbind-key", "-a", "-q", "-T", table]); } catch { /* sweepViewers empties it */ }
    }
    cleaned = true;
  };
  try {
    const placeholderId = io.tmuxOut(["new-session", "-d", "-s", viewer, "-P", "-F", "#{window_id}"]);
    if (!/^@\d+$/.test(placeholderId)) throw new Error(`unexpected window id "${placeholderId}"`);
    // 2. link the EXACT source window (anchored); bare "viewer:" lets tmux
    //    pick a free index regardless of base-index
    io.tmux(["link-window", "-s", target, "-t", `=${viewer}:`]);
    // 3. drop the placeholder BY ID — the linked window is now the ONLY window
    io.tmux(["kill-window", "-t", placeholderId]);
    // 4. lock the viewer's key handling: no prefix → no window-management
    //    bindings can run; the viewer's own key-table (viewerTables, #1502),
    //    named after it, carries ONLY the provisioned scrollback bindings (the
    //    wheel, the drag, Shift+PgUp and, on tmux 3.3+, C-b into its own C-b
    //    table: scrollback stays alive — tmux owns the history). Its name is
    //    fresh, so its tables hold nothing before these bindings.
    //    (set-option/bind-key targets don't accept '=' — the unique random name
    //    cannot prefix-collide.)
    const [table, prefixTable] = viewerTables(viewer);
    io.tmux(["set-option", "-t", viewer, "prefix", "None"]);
    io.tmux(["set-option", "-t", viewer, "prefix2", "None"]);
    io.tmux(["set-option", "-t", viewer, "key-table", table]);
    for (const binding of LOCKED_TABLE_BINDINGS) {
      io.tmux(["bind-key", "-T", table, ...binding]);
    }
    // C-b [ scrolls back where tmux sends a bound key on; below that there is no C-b binding and no
    // C-b table, and C-b reaches the agent as before.
    if (io.forwardsBoundKey?.()) {
      io.tmux(["bind-key", "-T", table, PREFIX_KEY, `switch-client -T ${prefixTable}`]);
      for (const binding of LOCKED_PREFIX_BINDINGS) io.tmux(["bind-key", "-T", prefixTable, ...binding]);
    }
    // wheel needs tmux mouse handling in the viewer
    io.tmux(["set-option", "-t", viewer, "mouse", "on"]);
    // The Desktop already labels this terminal. Hide only its viewer's
    // status bar; the durable agent session keeps the operator's settings.
    io.tmux(["set-option", "-t", viewer, "status", "off"]);
    // When the source window dies the viewer is destroyed; this makes tmux
    // DETACH its client (pty exits → "session ended") instead of moving it
    // to another session, whatever the operator's global detach-on-destroy
    // (#1237). Viewer-scoped only, never -g: the operator's global and own
    // sessions are untouched.
    io.tmux(["set-option", "-t", viewer, "detach-on-destroy", "on"]);
    const pty = io.spawnPty(`=${viewer}`, Math.max(20, Number(spec.cols) || 80), Math.max(5, Number(spec.rows) || 24));
    return { target, viewer, pty, killViewer };
  } catch (e) {
    // Creation can have taken effect even if its response failed. The broker
    // must keep a slot for unconfirmed cleanup, not orphan it by deleting a key.
    let pending = false;
    try {
      const work = killViewer();
      if (work && typeof work.then === 'function') { work.catch(() => {}); pending = true; }
    } catch { pending = true; }
    if (pending) {
      const uncertain = new Error('term:open: viewer cleanup not confirmed', { cause: e });
      uncertain.terminalCleanup = killViewer;
      throw uncertain;
    }
    throw e;
  }
}

/**
 * Sweep orphaned viewer sessions (crashed app instances). Safe and exact:
 * only sessions whose name starts with the oatsdesk- prefix are killed —
 * optionally scoped to a specific pid's prefix, else any oatsdesk- session
 * whose pid is no longer alive. Then empty every viewer table (viewerTables,
 * #1502) whose session is gone: a crashed app's, and a viewer's that died with
 * its source window. The tables are listed before the sessions, and a viewer
 * makes its session before its tables, so a viewer made meanwhile is seen live.
 *
 * @param {object} io
 * @param {() => string[]} [io.listTables]        tmux key-table names (listedTables)
 * @param {() => string[]} io.listSessions        tmux session names
 * @param {(name: string) => void} io.killSession =-anchored kill
 * @param {(pid: number) => boolean} io.pidAlive
 * @param {(table: string) => void} [io.emptyTable] unbind-key -a -q -T <table>
 * @returns {string[]} the sessions swept
 */
export function sweepViewers(io) {
  const tables = io.listTables?.() ?? [];
  const sessions = io.listSessions();
  const swept = [];
  for (const name of sessions) {
    const m = name.match(/^oatsdesk-(\d+)-/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;      // our own live viewers
    if (io.pidAlive(pid)) continue;         // another live desktop's viewers
    try { io.killSession(name); swept.push(name); } catch { /* raced its owner */ }
  }
  const live = new Set(sessions.filter((name) => !swept.includes(name)));
  for (const table of tables) {
    if (!VIEWER_TABLE.test(table) || live.has(table)
      || (table.endsWith(PREFIX_TABLE_SUFFIX) && live.has(table.slice(0, -PREFIX_TABLE_SUFFIX.length)))) continue;
    try { io.emptyTable(table); } catch { /* another sweep emptied it first */ }
  }
  return swept;
}
