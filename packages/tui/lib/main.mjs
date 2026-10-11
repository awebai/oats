// `oats tui` (preview): the loop. Events from the keyboard and from the reader go through one
// pure reduce(state, event); what only the loop can do comes back as an effect; the frame is
// drawn from the state. This version shows one deployment's instances on this machine and
// follows them; it changes nothing (docs/tui.md).
import { homedir } from "node:os";
import { resolve } from "node:path";
import { bindings } from "./actions.mjs";
import { displayLine, pendingEntry } from "./client.mjs";
import { loadConfig } from "./config.mjs";
import { model, roster } from "./model.mjs";
import { createReader, findDeployment, leaveInstance, probeKernel } from "./read.mjs";
import { initialState, reduce } from "./store.mjs";
import { createKeyParser, keyId } from "./term/keys.mjs";
import { createScreen, glyphs } from "./term/screen.mjs";
import { colorEnabled } from "./term/style.mjs";
import { createGuard, isTerminal } from "./term/tty.mjs";
import { frame, layout } from "./views/frame.mjs";

export const USAGE = "oats tui [--dir <path>] [--ascii]";
const HELP = `Usage:
  ${USAGE}

The OATS terminal client (preview): a full-screen view of a deployment's instances
on this machine. It follows them and changes nothing. Keys: ? help, q quit.
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
 *  refused, `--server` included: this version reads this machine only. */
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
const EFFECTS = Object.freeze({ loadConfig, findDeployment, probeKernel, createReader });

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
  if (!found.ok) { stderr.write(`${noDeployment(found.dir)}\n`); return 1; }
  // The kernel is asked once: an upgrade under a running TUI is met by starting it again.
  const probe = await effects.probeKernel({ env });
  if (!probe.ok) { stderr.write(`${noKernel(probe.reason)}\n`); return 1; }

  const clock = () => new Date(now()).toISOString();
  const look = glyphs(env, { ascii: options.ascii || config.ascii });
  const screen = createScreen({ ...look, color: colorEnabled(env) });
  const parser = createKeyParser({ now });
  let state = initialState({ deployment: found.deployment, cli: probe.cli, home, entry: pendingEntry(null, clock()), actions: config.actions, ascii: look.ascii });
  const keymap = bindings(state.actions);
  // What the last frame drew, for the store: how tall the list pane is and how far the other
  // pane scrolls. The store holds no size of its own.
  let drawn = { page: 1, extent: 0, room: 1 };
  let full = true, escTimer = null, ended = false;

  const reader = effects.createReader({
    deployment: found.deployment, cli: probe.cli, env, clock,
    getEntry: () => state.entry,
    onEntry(event) { if (!ended) guard.attempt(() => { state = reduce(state, event, keymap).state; guard.draw(); }); },
  });
  const guard = createGuard({
    stdin, stdout, proc, setTimer, clearTimer,
    frame() {
      const size = guard.size(), at = clock();
      const r = roster(state, at);
      const page = layout(r.notice, size, { observed: r.status === "observed", ascii: state.ascii }).page;
      const made = frame(model(state, { page, now: now(), at }), size);
      drawn = { page: made.page, extent: made.extent, room: made.room };
      const bytes = screen.render(made.rows, size, { full });
      full = false;
      return bytes;
    },
    onInput(bytes) { reader.touch(); act(parser.feed(bytes)); watchEscape(); },
    onResize() { full = true; guard.draw(); },
    onRedraw() { full = true; guard.draw(); },
    // A cycle in flight when the process stops is no evidence about the deployment (lib/read.mjs):
    // it is dropped before the stop, and again after a stop nobody here asked for; the return
    // reads at once.
    onStop() { reader.voidInFlight(); },
    onResume(asked) { if (!asked) reader.voidInFlight(); refresh({ live: true }); },
    onEnd() { ended = true; reader.stop(); },
  });
  function refresh(how) { Promise.resolve(reader.request(how)).catch(() => {}); }
  function act(events) {
    for (const event of events) {
      const next = reduce(state, "paste" in event ? { paste: event.paste } : { key: keyId(event), ...(typeof event.text === "string" && !event.alt ? { text: event.text } : {}), ...drawn }, keymap);
      state = next.state;
      if (next.effect === "quit") return guard.finish(0);
      if (next.effect === "suspend") guard.suspend();
      if (next.effect === "redraw") guard.reassert(); // the modes again, then the whole screen
      if (next.effect?.refresh) refresh(next.effect.refresh);
    }
    guard.draw();
  }
  /** A lone ESC is the Esc key once nothing has followed it for the parser's timeout. */
  function watchEscape() {
    if (escTimer !== null) { clearTimer(escTimer); escTimer = null; }
    const due = parser.timeoutAt();
    if (due !== null) escTimer = setTimer(() => { escTimer = null; guard.attempt(() => { act(parser.expire()); watchEscape(); }); }, Math.max(0, due - now()));
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
