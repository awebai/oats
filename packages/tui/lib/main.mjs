// `oats tui` (preview): the loop. State, a pure reduce(state, event), render, write.
// This version draws the frame, answers help and quit, and reads nothing from the kernel:
// what it delivers is the terminal layer the views will stand on (docs/tui.md).
import { ACTIONS, bindings } from "./actions.mjs";
import { displayLine } from "./client.mjs";
import { createKeyParser, keyId } from "./term/keys.mjs";
import { createScreen, glyphs } from "./term/screen.mjs";
import { colorEnabled } from "./term/style.mjs";
import { createGuard, isTerminal } from "./term/tty.mjs";
import { frame } from "./views/frame.mjs";

export const USAGE = "oats tui [--ascii]";
const HELP = `Usage:
  ${USAGE}

The OATS terminal client (preview): a full-screen view of a deployment's agents.
This version draws the frame only. Keys: ? help, q quit. docs/tui.md has the rest.

  --ascii   draw rules and marks in ASCII, whatever the locale
`;
export const NO_TERMINAL = "oats: `oats tui` needs a terminal on stdin and stdout (E_NO_TERMINAL); `oats status` prints the instances once";

/** The arguments of this version: `--ascii`, `--help`/`-h`. Everything else is refused, `--dir`
 *  and `--server` included: it reads no deployment yet. */
export function parseArgs(argv) {
  const options = { ascii: false, help: false };
  for (const arg of argv) {
    if (arg === "--ascii") options.ascii = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    // The argument is echoed only when it is plain: this line goes to a terminal.
    else return { error: `oats: \`oats tui\` takes no argument ${/^[\x21-\x7e]{1,40}$/.test(arg) ? arg : "like that one"} (E_BAD_ARGS); usage: ${USAGE}` };
  }
  return { options };
}

export const initialState = ({ ascii = false, actions = ACTIONS } = {}) => Object.freeze({ view: "frame", ascii, actions });

/** (state, event) -> { state, effect }. Pure. An event is `{ key: <key id> }` or `{ paste }`;
 *  an effect is something only the loop can do: "quit", "suspend", "redraw", or null.
 *  A paste is dropped whole: nothing in it is a key. */
export function reduce(state, event, keymap = bindings(state.actions)) {
  const stay = { state, effect: null };
  if (typeof event.key !== "string") return stay;
  switch (keymap.get(event.key)) {
    case "help": return { state: Object.freeze({ ...state, view: state.view === "help" ? "frame" : "help" }), effect: null };
    case "close": return state.view === "help" ? { state: Object.freeze({ ...state, view: "frame" }), effect: null } : stay;
    case "quit": return { state, effect: "quit" };
    case "suspend": return { state, effect: "suspend" };
    case "redraw": return { state, effect: "redraw" };
    default: return stay;
  }
}

/** An error as lines fit for a terminal: its stack, each line through the display filter. */
function errorLines(error) {
  const text = error instanceof Error ? error.stack || error.message : String(error);
  return String(text).split("\n", 12).map((line) => displayLine(line)).filter(Boolean);
}

/** Run. Resolves with the exit status; never calls process.exit, so what was written drains. */
export async function main({ argv, stdin, stdout, stderr, env, proc = process, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const { options, error } = parseArgs(argv);
  if (error) { stderr.write(`${error}\n`); return 1; }
  if (options.help) { stdout.write(HELP); return 0; }
  if (!isTerminal({ stdin, stdout, env })) { stderr.write(`${NO_TERMINAL}\n`); return 1; }

  const look = glyphs(env, { ascii: options.ascii });
  const screen = createScreen({ ...look, color: colorEnabled(env) });
  const parser = createKeyParser({ now });
  let state = initialState({ ascii: look.ascii });
  const keymap = bindings(state.actions);
  let full = true, escTimer = null;

  const guard = createGuard({
    stdin, stdout, proc, setTimer, clearTimer,
    frame() { const bytes = screen.render(frame(state, guard.size()), guard.size(), { full }); full = false; return bytes; },
    onInput(bytes) { act(parser.feed(bytes)); watchEscape(); },
    onResize() { full = true; guard.draw(); },
    onRedraw() { full = true; guard.draw(); },
  });
  function act(events) {
    for (const event of events) {
      const next = reduce(state, "paste" in event ? { paste: true } : { key: keyId(event) }, keymap);
      state = next.state;
      if (next.effect === "quit") return guard.finish(0);
      if (next.effect === "suspend") guard.suspend();
      if (next.effect === "redraw") guard.reassert(); // the modes again, then the whole screen
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
  guard.attempt(() => guard.draw());
  const end = await guard.done;
  if (escTimer !== null) clearTimer(escTimer);
  // After the alternate screen is left, so the message stays on the screen the user returns to.
  if (end.error !== undefined) stderr.write(`oats: \`oats tui\` stopped on an internal error; the terminal was restored\n${errorLines(end.error).map((line) => `  ${line}\n`).join("")}`);
  return end.status;
}
