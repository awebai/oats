// `oats tui` (preview): the loop. Events from the keyboard and from the reader go through one
// pure reduce(state, event); what only the loop can do comes back as an effect; the frame is
// drawn from the state. This version shows a workspace's instances, on this machine and on the
// machines registered here, follows them, opens an agent's terminal in a panel beside the list
// (the kernel's own viewer, in a pane of the run's private tmux server: lib/panel.mjs), and
// stops, starts, restarts and retires an instance after a confirmation, through the shared
// lifecycle boundary and start rule (docs/tui.md).
import { homedir } from "node:os";
import { resolve } from "node:path";
import { bindings } from "./actions.mjs";
import { TERMS, createLifecycleBoundary, createLifecycleConfirmation, createSoulCatalog, displayLine, heldHome, pendingEntry, prepareRemoteTerm, sessionAttachArgv, startInstance } from "./client.mjs";
import { loadConfig } from "./config.mjs";
import { ACT_WORDS, actContext, actCwd, localDeployments, model, roster } from "./model.mjs";
import { createPanel, sweep } from "./panel.mjs";
import { CHANGE_FILES, admitDeployment, createReader, findDeployment, leaveInstance, offeredDeployments, probeKernel, realpath, tellable } from "./read.mjs";
import { initialState, reduce } from "./store.mjs";
import { captureRows } from "./term/capture.mjs";
import { createKeyParser, keyId } from "./term/keys.mjs";
import { createScreen, glyphs } from "./term/screen.mjs";
import { colorEnabled } from "./term/style.mjs";
import { backKeySequences, createThrough } from "./term/through.mjs";
import { createGuard, isTerminal } from "./term/tty.mjs";
import { frame, layout } from "./views/frame.mjs";

export const USAGE = "oats tui [--dir <path>] [--ascii]";
const HELP = `Usage:
  ${USAGE}

The OATS terminal client (preview): a full-screen view of a workspace's instances,
on this machine and on the machines registered here. It follows them, opens an
agent's terminal beside the list with Enter, and stops, retires, starts or
restarts an instance (X, D, S, R) after a confirmation.
Keys: ? help, Enter open, w workspaces, q quit.
docs/tui.md has the rest.

  --dir <path>   the deployment, or a directory inside one (default: where you are)
  --ascii        draw rules and marks in ASCII, whatever the locale
`;
export const NO_TERMINAL = "oats: `oats tui` needs a terminal on stdin and stdout (E_NO_TERMINAL); `oats status` prints the instances once";
/** A path is echoed only when it is plain: these lines go to a terminal. */
const plainPath = (path) => (typeof path === "string" && /^[\x20-\x7e]{1,200}$/.test(path) ? path : "that directory");
export const noDeployment = (dir) => `oats: no OATS deployment at or above ${plainPath(dir)} (E_NO_DEPLOYMENT); name one with \`oats tui --dir <path>\``;
export const noKernel = (reason) => `oats: \`oats tui\` could not use its own kernel (E_TUI_KERNEL): ${displayLine(reason) ?? "it gave no reason"}`;

/** The arguments: `--ascii`, `--help`/`-h`, `--dir <path>` and `--dir=<path>`. Everything else is
 *  refused, `--server` included: a run names no machine, it reads every one registered here. */
export function parseArgs(argv) {
  const options = { ascii: false, help: false, dir: null };
  // The argument is echoed only when it is plain: this line goes to a terminal.
  const refused = (arg) => ({ error: `oats: \`oats tui\` takes no argument ${/^[\x21-\x7e]{1,40}$/.test(arg) ? arg : "like that one"} (E_BAD_ARGS); usage: ${USAGE}` });
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ascii") options.ascii = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dir" && typeof argv[i + 1] === "string" && argv[i + 1] !== "") options.dir = argv[++i];
    else if (arg.startsWith("--dir=") && arg.length > "--dir=".length) options.dir = arg.slice("--dir=".length);
    else if (arg === "--dir" || arg === "--dir=") return { error: `oats: \`oats tui --dir\` takes a path (E_BAD_ARGS); usage: ${USAGE}` };
    else return refused(arg);
  }
  return { options };
}

/** An error as lines fit for a terminal: its stack, each line through the display filter. */
function errorLines(error) {
  const text = error instanceof Error ? error.stack || error.message : String(error);
  return String(text).split("\n", 12).map((line) => displayLine(line)).filter(Boolean);
}

/** What the loop does outside the terminal, each replaceable by a test. `realpath` is the one the
 *  shared start rule checks a local home with; `startInstance` and `createLifecycleConfirmation`
 *  are the shared home's, replaceable so a test can drive the loop's wiring. `runDir` makes the
 *  run's private directory (the reader's change output and the panel's tmux server share it), and
 *  `removeDir` removes it on the way out once both have removed their files; `sweep` removes what
 *  runs that are gone left of theirs (lib/panel.mjs). `createSoulCatalog` is the shared home's
 *  catalog of a workspace's souls, replaceable so a test can count its reads. */
const EFFECTS = Object.freeze({ loadConfig, findDeployment, probeKernel, createReader, offeredDeployments, admitDeployment, prepareRemoteTerm, createPanel, sweep,
  runDir: CHANGE_FILES.dir, removeDir: CHANGE_FILES.remove, realpath, tellable, startInstance, createLifecycleConfirmation, createLifecycleBoundary, createSoulCatalog });

/** Run. Resolves with the exit status; never calls process.exit, so what was written drains.
 *  Before the alternate screen, in this order, each failure one line on stderr and status 1:
 *  the arguments; the instance variables removed from the environment (a TUI started in an
 *  agent's pane must read the deployment it was asked about, and so must every child it starts);
 *  the terminal; the user's tui.json; the deployment; the kernel it shipped with. */
export async function main({ argv, stdin, stdout, stderr, env, proc = process, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, cwd = () => process.cwd(), home = homedir(), effects: given = EFFECTS }) {
  const effects = given === EFFECTS ? EFFECTS : { ...EFFECTS, ...given };
  const { options, error } = parseArgs(argv);
  if (error) { stderr.write(`${error}\n`); return 1; }
  if (options.help) { stdout.write(HELP); return 0; }
  leaveInstance(env);
  if (!isTerminal({ stdin, stdout, env })) { stderr.write(`${NO_TERMINAL}\n`); return 1; }
  const config = effects.loadConfig({ env, home });
  if (!config.ok) { stderr.write(config.lines.map((line) => `${line}\n`).join("")); return 1; }
  const found = effects.findDeployment(resolve(cwd(), options.dir ?? "."));
  // Outside every deployment, and with none named: the switcher, when ~/Agents holds a deployment
  // to offer. A `--dir` that is in no deployment is refused as it is: what was asked for is not there.
  const offered = found.ok || options.dir !== null ? null : effects.offeredDeployments(home, []);
  if (!found.ok && !offered?.offered.length) { stderr.write(`${noDeployment(found.dir)}\n`); return 1; }
  // The kernel is asked once: an upgrade under a running TUI is met by starting it again.
  const probe = await effects.probeKernel({ env });
  if (!probe.ok) { stderr.write(`${noKernel(probe.reason)}\n`); return 1; }

  const clock = () => new Date(now()).toISOString();
  const look = glyphs(env, { ascii: options.ascii || config.ascii });
  const screen = createScreen({ ...look, color: colorEnabled(env) });
  let parser = createKeyParser({ now });
  let state = initialState({ deployment: found.ok ? found.deployment : null, cli: probe.cli, home, entry: found.ok ? pendingEntry(null, clock()) : null, actions: config.actions, ascii: look.ascii, detachKey: config.detachKey });
  const keymap = bindings(state.actions);
  // While a terminal has the focus the bytes typed go to the agent: this scanner takes from them
  // only the back key and a bracketed paste (term/through.mjs). A new one each time the terminal
  // takes the focus, so nothing held from before is typed into it.
  const backKey = backKeySequences(state.detachKey);
  let through = createThrough({ sequences: backKey, now }), throughTimer = null;
  if (offered) state = reduce(state, { offered }, keymap).state;
  // What the last frame drew, for the store: how tall the list pane is and how far the other
  // pane scrolls. The store holds no size of its own.
  let drawn = { page: 1, extent: 0, room: 1, cols: 1 };
  let full = true, escTimer = null, ended = false, reads = 0;
  /** The preflight of another machine's agent under way: `{ id, controller, prepared }`, where
   *  `prepared` is what it answered (`{ binary, args }`) once it has; or null. */
  let preflight = null;
  /** The run's private directory, made at the first change or the first open (lib/read.mjs
   *  CHANGE_FILES): the reader writes a change's output there, and the panel keeps its tmux
   *  server's socket there. */
  let dir = null;
  const runDir = () => (dir ??= effects.runDir());

  // What the reader reads for, it asks of the state at that moment: the served deployments, the
  // entry a failed read keeps, and the roster and the memory the next outcome is made from.
  const reader = effects.createReader({
    cli: probe.cli, env, clock, now,
    getServed: () => state.ctxs,
    getEntry: (id) => state.entries.get(id) ?? null,
    getRoster: () => ({ remote: state.remote, memory: state.memory, notes: state.notes }),
    onEntry: heard, onRoster: heard,
    files: { ...CHANGE_FILES, dir: runDir },
  });
  // THE OPEN TERMINAL (docs/tui.md, "Open an agent's terminal"): one at a time, in the panel.
  // `viewing` is its viewer, `{ id, panel }` (the row's instanceId, and the panel's own id once
  // the window exists, null before); `screenNow` the last capture (`{ lines, cursor }`), drawn
  // until the next; `panelSize` and `panelShown` what the panel was last told.
  let viewing = null, screenNow = null, panelSize = null, panelShown = true;
  const panel = effects.createPanel({
    dir: runDir, env, capture: captureRows,
    onScreen: ({ id, screen: lines, cursor }) => { if (!ended && viewing !== null && viewing.panel === id) { screenNow = { lines, cursor }; guard.attempt(() => guard.draw()); } },
    // The viewer ended. The store is told, whatever ended it; a terminal the person closed is no
    // longer `viewing`, and the store says nothing of it.
    onClosed: ({ id, status = null, stderr = "", asked = false }) => {
      if (viewing === null || viewing.panel !== id) return;
      const row = viewing.id;
      viewing = null; screenNow = null;
      heard({ returned: { id: row, status, stderr, asked } });
    },
  });
  // THE ACTS (docs/tui.md, "Stopping, starting, restarting and retiring"). One lifecycle boundary
  // per run: its plans, its kept answers and its one apply at a time are this run's. Its exec runs
  // a plan read as a read the loop asked for (kind "read", ended on every way out) and an apply
  // (`detached: true`, cliLifecycle's own mark of a change) as a change, which the TUI never ends.
  // `applying` is the label of the apply this run's confirmation just sent: only one confirmation
  // is open at a time, and the boundary calls its exec in the same turn as the request.
  let applying = null;
  const boundary = effects.createLifecycleBoundary({ terms: TERMS, exec: (bin, argv, { detached, ...options }, callback) => (detached
    ? reader.changeExec(bin, argv, { ...options, label: applying }, callback)
    : reader.exec(bin, argv, options, callback)) });
  /** The confirmation open now: `{ n, made }`, `made` the shared confirmation; or null. */
  let confirmation = null;

  // THE SOULS (docs/tui.md, "The Souls view"): one catalog per run, the shared home's, over the
  // reader's exec: its `oats souls` is a read like any other (kind "read", the reader's time limit,
  // ended on every way out). It is settled for the open workspace with that workspace's own
  // `workspace status`, so it is read only when nothing is held for the workspace as it is now
  // (the shared key), and never before the Souls view was first shown.
  const souls = effects.createSoulCatalog({ terms: TERMS, exec: reader.exec });
  /** The catalog of workspace `id` settled now, and the store told what is held and whether a read
   *  is in flight; once that read lands, told again. Nothing for a workspace not read yet: its
   *  first observed entry settles it. */
  function settleSouls(id) {
    const deployment = state.entries.get(id)?.deployment;
    if (ended || deployment?.status !== "observed") return;
    let settled;
    try { settled = souls.settle(id, probe.cli, deployment.workspaceStatus); } catch { return; } // the reader has stopped
    const { entry, pending } = settled;
    heard({ souls: { id, entry, reading: pending !== null } });
    if (pending) pending.then((landed) => heard({ souls: { id, entry: landed, reading: souls.refreshing(id) } }), () => {});
  }
  /** `r` in the Souls view: what is held for the workspace is forgotten and settled again, so one
   *  read starts; never a second while one is in flight. */
  function rereadSouls(id) {
    if (souls.refreshing(id)) return;
    souls.forget(id);
    settleSouls(id);
  }

  /** What the reader gave, into the state, and the screen after it. A read of the open workspace,
   *  once the Souls view was shown, settles its catalog: read again only when the workspace moved. */
  function heard(event) {
    if (ended) return;
    guard.attempt(() => {
      if (took(reduce(state, event, keymap))) return;
      if (event.entry !== undefined && event.id === state.open && state.souls.wanted) settleSouls(event.id);
      guard.draw();
    });
  }
  /** One step of the reducer taken: the state, then what only the loop can do. True once the
   *  TUI is leaving. Listing ~/Agents and asking whether a picked folder is a deployment read the
   *  file system (lib/read.mjs); what they find is an event of its own. */
  function took(step) {
    state = step.state;
    const effect = step.effect;
    if (effect === "quit") { guard.finish(0); return true; }
    if (effect === "suspend") guard.suspend();
    if (effect === "redraw") guard.reassert(); // the modes again, then the whole screen
    if (effect === null || typeof effect !== "object") return false;
    if (effect.offer) took(reduce(state, { offered: effects.offeredDeployments(home, state.ctxs) }, keymap));
    if (effect.admit !== undefined) {
      const admitted = effects.admitDeployment(effect.admit);
      took(reduce(state, admitted.ok ? { admitted: admitted.deployment, at: clock() } : { refused: effect.admit }, keymap));
    }
    if (effect.abandon) giveUpPreflight();
    if (effect.close !== undefined) closeTerminal();
    if (effect.open) open(effect.open);
    if (effect.panel !== undefined) {
      const ready = preflight;
      preflight = null;
      if (ready?.id === effect.panel && ready.prepared) view(effect.panel, ready.prepared.binary, ready.prepared.args);
    }
    if (effect.dismiss !== undefined) dismiss(effect.dismiss);
    if (effect.act) openConfirmation(effect.act);
    if (effect.call) callConfirmation(effect.call);
    if (effect.start) startAct(effect.start);
    if (effect.refresh) refresh(effect.refresh);
    if (effect.souls === "settle" && state.open !== null) settleSouls(state.open);
    if (effect.souls === "reread" && state.open !== null) rereadSouls(state.open);
    return false;
  }

  /** What the boundary admits a request of deployment `id` against, read at every admission. */
  const contextOf = (id) => actContext(state, id, clock());
  /** Open the shared confirmation of a stop or a retire the store decided on (`{ n, verb, row,
   *  label }`). Every step it tells goes to the store as `{ acted }`; an answer that settles asks
   *  for a live read of the rows (onSettled), and nothing else after an apply does. */
  function openConfirmation({ n, verb, row, label }) {
    dismiss(confirmation?.n);
    const id = row.deployment?.id, name = row.instance;
    const target = { workspace: id, instance: name, agent: row.agent, agentsRoot: row.agentsRoot, home: row.home, server: row.server ?? null };
    const mine = { n, made: null };
    const tell = () => { if (mine.made && confirmation === mine) heard({ acted: { n, confirmation: { ...mine.made.state(), view: mine.made.view() } } }); };
    confirmation = mine;
    mine.made = effects.createLifecycleConfirmation({
      request: (body) => { if (body?.action === "apply") applying = { verb, name }; return boundary(body, () => contextOf(id)); },
      target, operation: verb, terms: TERMS, label, leftover: heldHome(row)?.kind === "spawn-incomplete",
      onChange: tell, onSettled: () => refresh({ live: true }),
    });
    tell();
  }
  /** A button pressed in the confirmation: its call, when it is still the open one. */
  function callConfirmation({ n, method, args = [] }) {
    if (confirmation?.n === n) confirmation.made[method](...args);
  }
  /** The confirmation closed: what it sent goes on, and what it answers is no longer told. */
  function dismiss(n) {
    if (confirmation === null || confirmation.n !== n) return;
    const { made } = confirmation;
    confirmation = null;
    made?.close();
  }
  /** Start or restart the row (`{ n, verb, id, row }`) through the shared start rule, once, with no
   *  launch choice. Its child is a change of this run: the store hears when it is spawned and when
   *  it closes (`starting`), and the answer, whatever it is, asks for a live read. */
  function startAct({ n, verb, id, row }) {
    const label = { verb, name: row?.instance ?? "" };
    const exec = (bin, argv, options, callback) => {
      const child = reader.changeExec(bin, argv, { ...options, label }, (...answer) => { heard({ acted: { closed: id } }); callback(...answer); });
      heard({ acted: { spawned: { id, verb }, at: now() } });
      return child;
    };
    Promise.resolve()
      .then(() => effects.startInstance(probe.cli, row, {}, { restart: verb === "restart", deployments: localDeployments(state, clock()), realpath: effects.realpath, localCwd: actCwd(state), exec, terms: TERMS }))
      .then((answer) => heard({ acted: { n, answer } }), () => heard({ acted: { n, answer: null } }));
  }

  /** Open the agent the store decided on (lib/model.mjs openDecision). On this machine the viewer
   *  starts in the panel at once. On another, the shared preflight runs first over the reader's
   *  exec (a read like any other, ended on every way out), and what it prepared waits for the
   *  store's `panel`, which comes only if the open was not given up and the row is still there.
   *  The viewer is given no key of its own: the TUI takes the back key before the pane sees it. */
  function open(decision) {
    if (!decision.routed) {
      let args;
      // A target the shared home refuses (no absolute home) starts nothing; the line after says
      // the viewer ended without saying why.
      try { args = sessionAttachArgv(probe.cli, decision.target); } catch { return void heard({ returned: { id: decision.id, status: null, stderr: "" } }); }
      return view(decision.id, probe.cli.bin, args);
    }
    giveUpPreflight();
    const mine = preflight = { id: decision.id, controller: new AbortController(), prepared: null };
    Promise.resolve()
      .then(() => effects.prepareRemoteTerm(probe.cli, decision.target, { exec: reader.exec, signal: mine.controller.signal }))
      .then((prepared) => { if (preflight === mine) { mine.prepared = prepared; heard({ prepared: { id: mine.id } }); } },
        (error) => { if (preflight === mine) { preflight = null; heard({ prepared: { id: mine.id, error } }); } });
  }
  /** The preflight under way, given up: its child is ended through the signal, and whatever it
   *  answers is dropped. */
  function giveUpPreflight() {
    if (preflight === null) return;
    preflight.controller.abort();
    preflight = null;
  }
  /** Start the viewer of row `id` (`node <bin> <args…>`) in the panel, at the size the frame gives
   *  the terminal, and tell the store when its window exists. One the panel could not start is a
   *  viewer that ended, with the panel's refusal: no tmux (or one too old), or tmux's own words.
   *  Nothing is lent: the reads and the screen go on. */
  function view(id, bin, args) {
    const mine = viewing = { id, panel: null };
    const size = guard.size(), area = composed().made.terminal ?? { cols: size.cols, rows: Math.max(1, size.rows - 6) };
    panelSize = { cols: area.cols, rows: area.rows };
    // Shown: the panel keeps hidden or shown across its viewers, and the last one may have been
    // closed hidden (behind the detail, or the list alone under 80 columns).
    if (!panelShown) panel.setVisible(true);
    panelShown = true;
    Promise.resolve()
      .then(() => panel.open({ argv: [process.execPath, bin, ...args], cols: area.cols, rows: area.rows }))
      .then(({ id: made }) => {
        if (viewing !== mine) return;
        mine.panel = made;
        // A frame of another size while the window was being made told a panel with no window yet.
        if (panelSize.cols !== area.cols || panelSize.rows !== area.rows) panel.resize(panelSize.cols, panelSize.rows);
        heard({ shown: { id } });
      },
        (error) => { if (viewing === mine) { viewing = null; heard({ returned: { id, status: null, stderr: typeof error?.detail === "string" ? error.detail : "", refused: error?.code === "E_PANEL_TMUX" ? "tmux" : "start" } }); } });
  }
  /** Close the open terminal's viewer (also one whose window is still being made): the agent keeps
   *  running, and the panel reports the end as asked for, which nobody waits for. */
  function closeTerminal() {
    if (viewing === null) return;
    viewing = null; screenNow = null;
    panel.close();
  }
  /** The panel told what the frame gives the terminal: shown or not (no capture runs while it is
   *  hidden, and one runs when it shows again), and its size (the viewer's window follows it). */
  function fitPanel(given) {
    // A view that draws no terminal (the help, the switcher, a confirmation) gives none.
    const area = given ?? null;
    if (viewing === null) return;
    if ((area !== null) !== panelShown) { panelShown = area !== null; panel.setVisible(panelShown); }
    if (area !== null && (area.cols !== panelSize.cols || area.rows !== panelSize.rows)) { panelSize = { cols: area.cols, rows: area.rows }; panel.resize(area.cols, area.rows); }
  }
  /** The frame for the state now, with what the loop needs of it: the layout first, because the
   *  model's window is as tall, and its sentences as wide, as the list pane it gives. The switcher
   *  takes the whole body and has no notice of a deployment. The last capture of the open
   *  terminal goes with the model: it is the panel's, not the store's. */
  function composed() {
    const size = guard.size(), at = clock();
    const listing = (state.view === "help" ? state.back : state.view) === "switcher";
    const r = listing ? { notice: null, note: null, observed: true } : roster(state, at);
    const g = layout(r.notice, size, { observed: r.observed, note: r.note, ascii: state.ascii, outcome: listing ? null : state.outcome, terminal: state.terminal !== null });
    const m = { ...model(state, { page: g.page, now: now(), at, cols: g.listCols }), screen: screenNow };
    return { size, g, made: frame(m, size) };
  }
  /** Whether what is typed goes to the agent: the open terminal has the focus, and the leader
   *  does not wait for its key (docs/tui.md, "The leader"). */
  const typing = () => state.terminal?.focus === "terminal" && state.view === "instances" && state.leader?.waiting !== true && state.palette === null;
  /** Bytes typed while the terminal has the focus: to the agent as they came, a paste as a paste,
   *  and the leader to the store, which waits for the key after it: from the next read on, the
   *  bytes are read as keys, by a parser that starts afresh. What came after the leader in its own
   *  read is dropped: it cancels the leader (a paste), and it is not the agent's either. */
  function typed(events) {
    for (const event of events) {
      if (event.input) panel.input(event.input);
      else if (event.paste !== undefined) panel.paste(event.paste);
      else if (event.back) {
        parser = createKeyParser({ now });
        if (took(reduce(state, { back: true, read: ++reads, rest: event.rest.length > 0 }, keymap))) return;
        guard.draw();
      }
    }
    watchThrough();
  }
  /** A beginning of the back key that nothing has followed for the parser's timeout is the agent's. */
  function watchThrough() {
    if (throughTimer !== null) { clearTimer(throughTimer); throughTimer = null; }
    const due = through.timeoutAt();
    if (due !== null) throughTimer = setTimer(() => { throughTimer = null; guard.attempt(() => { if (typing()) typed(through.expire()); }); }, Math.max(0, due - now()));
  }
  const guard = createGuard({
    stdin, stdout, proc, setTimer, clearTimer,
    frame() {
      const { size, g, made } = composed();
      drawn = { page: made.page, extent: made.extent, room: made.room, cols: g.listCols };
      fitPanel(made.terminal);
      const bytes = screen.render(made.rows, size, { full, cursor: made.cursor });
      full = false;
      return bytes;
    },
    onInput(bytes) {
      reader.touch();
      if (typing()) return typed(through.feed(bytes));
      act(parser.feed(bytes)); watchEscape();
    },
    onResize() { full = true; guard.draw(); },
    // Ctrl+L and the return from a stop: the whole screen, and the open terminal captured afresh.
    onRedraw() { full = true; if (viewing !== null) panel.refresh(); guard.draw(); },
    // A cycle in flight when the process stops is no evidence about the deployment (lib/read.mjs):
    // it is dropped before the stop, and again after a stop nobody here asked for; the return
    // reads at once.
    // A preflight is given up first, by the TUI itself: ended as a read it would answer as a
    // timeout. The person opens the agent again.
    // The open terminal's server and viewer live on through a stop; the panel stops sending output
    // while nothing reads it, and captures afresh on the way back.
    onStop() { stopPreflight(); dropReads(); if (viewing !== null) panel.pause(); },
    onResume(asked) { if (!asked) { stopPreflight(); dropReads(); } if (viewing !== null) panel.resume(); refresh({ live: true }); },
    // On the way out the confirmation is closed, the private tmux server is ended (its viewer with
    // it) and the reads end; a change in flight is let go, never signalled (lib/read.mjs
    // changeExec), and named after the screen is left.
    // The run's directory goes last, made for whichever of the two needed it first: the reader
    // removes it only when it wrote a change there, and one it cannot remove (a change still
    // writing) stays.
    onEnd() { ended = true; dismiss(confirmation?.n); panel.end(); reader.stop(); if (dir !== null) { try { effects.removeDir(dir); } catch { /* not empty, or gone */ } } },
  });
  function refresh(how) { Promise.resolve(reader.request(how)).catch(() => {}); }
  /** A preflight under way when the process stops: given up, and the store told. */
  function stopPreflight() {
    if (preflight === null) return;
    giveUpPreflight();
    state = reduce(state, { given: true }, keymap).state;
  }
  /** Every read in flight is void (lib/read.mjs), the roster's with them: the reader says nothing
   *  for a void read, so the state is told here that none is in flight. */
  function dropReads() { reader.voidInFlight(); state = reduce(state, { collecting: false }, keymap).state; }
  /** The events of one batch of input, in order. Once one of them gave the terminal the focus,
   *  the rest are dropped: they were typed before it had it, and neither the list nor the agent
   *  is to have them (a `q` behind the Enter would end the run). Each batch is one read of input,
   *  numbered (`read`): a confirmation ignores the press of its act in the read that moved the
   *  focus onto it, so a paste cannot both move and press. */
  function act(events) {
    const read = ++reads;
    for (const event of events) {
      if (took(reduce(state, "paste" in event ? { paste: event.paste, read } : { key: keyId(event), ...(typeof event.text === "string" && !event.alt ? { text: event.text } : {}), read, ...drawn }, keymap))) return;
      if (typing()) {
        if (escTimer !== null) { clearTimer(escTimer); escTimer = null; }
        through = createThrough({ sequences: backKey, now });
        break;
      }
    }
    guard.draw();
  }
  /** A lone ESC is the Esc key once nothing has followed it for the parser's timeout. */
  function watchEscape() {
    if (escTimer !== null) { clearTimer(escTimer); escTimer = null; }
    const due = parser.timeoutAt();
    if (due !== null) escTimer = setTimer(() => { escTimer = null; if (!typing()) guard.attempt(() => { act(parser.expire()); watchEscape(); }); }, Math.max(0, due - now()));
  }

  guard.start();
  guard.attempt(() => { if (!ended) Promise.resolve(reader.start()).catch(() => {}); });
  guard.attempt(() => guard.draw());
  // Once a run, after the first frame: what runs that are gone left of their private servers
  // (lib/panel.mjs sweep, which signals nothing and removes only what it can prove is dead).
  guard.attempt(() => { if (!ended) { try { effects.sweep({ env }); } catch { /* nothing swept */ } } });
  const end = await guard.done;
  if (escTimer !== null) clearTimer(escTimer);
  if (throughTimer !== null) clearTimer(throughTimer);
  // After the alternate screen is left, so the message stays on the screen the user returns to.
  // One line per change still running, to a terminal or a file only; the status never depends on it.
  const running = reader.changes?.() ?? [];
  if (running.length && effects.tellable(stderr)) {
    try { stderr.write(running.map(({ label }) => `${ACT_WORDS.leaving(label?.verb ?? "change", displayLine(label?.name) ?? "an instance")}\n`).join("")); } catch { /* nothing to tell it to */ }
  }
  if (end.error !== undefined) stderr.write(`oats: \`oats tui\` stopped on an internal error; the terminal was restored\n${errorLines(end.error).map((line) => `  ${line}\n`).join("")}`);
  return end.status;
}
