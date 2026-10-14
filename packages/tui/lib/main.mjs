// `oats tui` (preview): the loop. Events from the keyboard and from the reader go through one
// pure reduce(state, event); what only the loop can do comes back as an effect; the frame is
// drawn from the state. This version shows a workspace's instances, on this machine and on the
// machines registered here, follows them, and opens an agent's terminal with the kernel's own
// viewer; it changes nothing in a deployment (docs/tui.md).
import { homedir } from "node:os";
import { resolve } from "node:path";
import { bindings } from "./actions.mjs";
import { displayLine, pendingEntry, prepareRemoteTerm, sessionAttachArgv } from "./client.mjs";
import { loadConfig } from "./config.mjs";
import { model, roster } from "./model.mjs";
import { startViewer } from "./open.mjs";
import { admitDeployment, createReader, findDeployment, leaveInstance, offeredDeployments, probeKernel } from "./read.mjs";
import { initialState, reduce } from "./store.mjs";
import { createKeyParser, keyId } from "./term/keys.mjs";
import { createScreen, glyphs } from "./term/screen.mjs";
import { colorEnabled } from "./term/style.mjs";
import { createGuard, isTerminal } from "./term/tty.mjs";
import { frame, layout } from "./views/frame.mjs";

export const USAGE = "oats tui [--dir <path>] [--ascii]";
const HELP = `Usage:
  ${USAGE}

The OATS terminal client (preview): a full-screen view of a workspace's instances,
on this machine and on the machines registered here. It follows them, opens an
agent's terminal with Enter, and changes nothing in a deployment.
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

/** What the loop does outside the terminal, each replaceable by a test. */
const EFFECTS = Object.freeze({ loadConfig, findDeployment, probeKernel, createReader, offeredDeployments, admitDeployment, prepareRemoteTerm, startViewer });

/** Run. Resolves with the exit status; never calls process.exit, so what was written drains.
 *  Before the alternate screen, in this order, each failure one line on stderr and status 1:
 *  the arguments; the instance variables removed from the environment (a TUI started in an
 *  agent's pane must read the deployment it was asked about, and so must every child it starts);
 *  the terminal; the user's tui.json; the deployment; the kernel it shipped with. */
export async function main({ argv, stdin, stdout, stderr, env, proc = process, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, cwd = () => process.cwd(), home = homedir(), effects = EFFECTS }) {
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
  if (offered) state = reduce(state, { offered }, keymap).state;
  // What the last frame drew, for the store: how tall the list pane is and how far the other
  // pane scrolls. The store holds no size of its own.
  let drawn = { page: 1, extent: 0, room: 1, cols: 1 };
  let full = true, escTimer = null, ended = false;
  /** The preflight of another machine's agent under way: `{ id, controller, prepared }`, where
   *  `prepared` is what it answered (`{ binary, args }`) once it has; or null. */
  let preflight = null;

  // What the reader reads for, it asks of the state at that moment: the served deployments, the
  // entry a failed read keeps, and the roster and the memory the next outcome is made from.
  const reader = effects.createReader({
    cli: probe.cli, env, clock, now,
    getServed: () => state.ctxs,
    getEntry: (id) => state.entries.get(id) ?? null,
    getRoster: () => ({ remote: state.remote, memory: state.memory, notes: state.notes }),
    onEntry: heard, onRoster: heard,
  });
  /** What the reader gave, into the state, and the screen after it. */
  function heard(event) { if (!ended) guard.attempt(() => { if (!took(reduce(state, event, keymap))) guard.draw(); }); }
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
    if (effect.open) open(effect.open);
    if (effect.lend !== undefined) {
      const ready = preflight;
      preflight = null;
      if (ready?.id === effect.lend && ready.prepared) lendTo(effect.lend, ready.prepared.binary, ready.prepared.args);
    }
    if (effect.refresh) refresh(effect.refresh);
    return false;
  }

  /** Open the agent the store decided on (lib/model.mjs openDecision). On this machine the
   *  terminal is lent at once. On another, the shared preflight runs first over the reader's exec
   *  (a read like any other, ended on every way out), and what it prepared waits for the store's
   *  `lend`, which comes only if the open was not given up and the row is still there. */
  function open(decision) {
    if (!decision.routed) {
      let args;
      // A target the shared home refuses (no absolute home) starts nothing; the line after says
      // the viewer ended without saying why.
      try { args = sessionAttachArgv(probe.cli, decision.target, { detachKey: state.detachKey }); } catch { return void heard({ returned: { id: decision.id, status: null, stderr: "" } }); }
      return lendTo(decision.id, probe.cli.bin, args);
    }
    giveUpPreflight();
    const mine = preflight = { id: decision.id, controller: new AbortController(), prepared: null };
    Promise.resolve()
      .then(() => effects.prepareRemoteTerm(probe.cli, decision.target, { exec: reader.exec, signal: mine.controller.signal, detachKey: state.detachKey }))
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
  /** Lend the terminal to the kernel's viewer (lib/open.mjs) and take it back when it closes.
   *  Before: every read in flight is void and none starts while it has the terminal, as at a
   *  stop. After: reads begin again, and the store says what happened and asks for a live read. */
  function lendTo(id, bin, args) {
    dropReads();
    reader.hold();
    let viewer = null;
    guard.lend(() => { viewer = effects.startViewer(bin, args, { env }); return viewer.closed; }, { end: () => viewer?.end(), release: () => viewer?.release() }).then((outcome) => {
      // The keys are read anew: what was typed before the viewer started (behind the Enter, in the
      // same chunk) and a sequence begun then are gone, so none of it acts or joins a later key.
      if (escTimer !== null) { clearTimer(escTimer); escTimer = null; }
      parser = createKeyParser({ now });
      reader.release();
      const { status = null, stderr = "" } = outcome.value ?? {};
      heard({ returned: { id, status, stderr } });
    });
  }
  const guard = createGuard({
    stdin, stdout, proc, setTimer, clearTimer,
    frame() {
      const size = guard.size(), at = clock();
      // The layout first: the model's window is as tall, and its sentences as wide, as the list
      // pane it gives. The switcher takes the whole body and has no notice of a deployment.
      const listing = (state.view === "help" ? state.back : state.view) === "switcher";
      const r = listing ? { notice: null, note: null, observed: true } : roster(state, at);
      const g = layout(r.notice, size, { observed: r.observed, note: r.note, ascii: state.ascii, outcome: listing ? null : state.outcome });
      const made = frame(model(state, { page: g.page, now: now(), at, cols: g.listCols }), size);
      drawn = { page: made.page, extent: made.extent, room: made.room, cols: g.listCols };
      const bytes = screen.render(made.rows, size, { full });
      full = false;
      return bytes;
    },
    onInput(bytes) { if (guard.lent) return; reader.touch(); act(parser.feed(bytes)); watchEscape(); },
    onResize() { full = true; guard.draw(); },
    onRedraw() { full = true; guard.draw(); },
    // A cycle in flight when the process stops is no evidence about the deployment (lib/read.mjs):
    // it is dropped before the stop, and again after a stop nobody here asked for; the return
    // reads at once.
    // A preflight is given up first, by the TUI itself: ended as a read it would answer as a
    // timeout. The person opens the agent again.
    onStop() { stopPreflight(); dropReads(); },
    onResume(asked) { if (!asked) { stopPreflight(); dropReads(); } refresh({ live: true }); },
    onEnd() { ended = true; reader.stop(); },
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
  /** The events of one batch of input, in order. Once one of them lent the terminal, the rest are
   *  dropped: they were typed before the viewer started, and none may act while it has the
   *  terminal (a `q` behind the Enter would end the run under a live viewer). */
  function act(events) {
    for (const event of events) {
      if (guard.lent) return;
      if (took(reduce(state, "paste" in event ? { paste: event.paste } : { key: keyId(event), ...(typeof event.text === "string" && !event.alt ? { text: event.text } : {}), ...drawn }, keymap))) return;
    }
    guard.draw();
  }
  /** A lone ESC is the Esc key once nothing has followed it for the parser's timeout. */
  function watchEscape() {
    if (escTimer !== null) { clearTimer(escTimer); escTimer = null; }
    const due = parser.timeoutAt();
    if (due !== null) escTimer = setTimer(() => { escTimer = null; if (!guard.lent) guard.attempt(() => { act(parser.expire()); watchEscape(); }); }, Math.max(0, due - now()));
  }

  guard.start();
  guard.attempt(() => { if (!ended) Promise.resolve(reader.start()).catch(() => {}); });
  guard.attempt(() => guard.draw());
  const end = await guard.done;
  if (escTimer !== null) clearTimer(escTimer);
  // After the alternate screen is left, so the message stays on the screen the user returns to.
  if (end.error !== undefined) stderr.write(`oats: \`oats tui\` stopped on an internal error; the terminal was restored\n${errorLines(end.error).map((line) => `  ${line}\n`).join("")}`);
  return end.status;
}
