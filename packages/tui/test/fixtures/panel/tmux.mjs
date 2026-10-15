// The fake tmux of panel.test.mjs. The test writes a small shell wrapper that runs this file with
// FAKE_TMUX_HOME set to a temp directory of its own; everything this fake keeps is there:
//   calls.jsonl   one JSON line per invocation ({ pid, pgid, argv, env, commands }) and per
//                 command a control client was sent ({ pid, control })
//   plan.json     what to do (optional): { version, newSession: { fail }, attach: "fail",
//                 attachDelayMs, holdCapture, screen: [lines], cursor,
//                 window: { status, stderr, closeAtOnce }, killPaneSilent }
//   state.json    the window counter, shared by the invocations of one test
//   inject.txt    lines the test appends for the control client: `emit <line>` prints the line,
//                 `release` answers the captures held, `exit` prints %exit and exits, `die` exits
//                 without a word; each line done is appended to emitted.txt
// It reads its arguments as tmux does in the one way that matters here: an argument that ends in
// `;` ends a command (a trailing `\;` is an escaped `;`), so a test can see that a hostile argument
// reaches new-window's command intact. It never runs a real tmux.
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const home = process.env.FAKE_TMUX_HOME;
const argv = process.argv.slice(2);
/** The plan as it is now: the control client reads it again at every command, so a test can change it. */
function current() { return existsSync(join(home, "plan.json")) ? JSON.parse(readFileSync(join(home, "plan.json"), "utf8")) : {}; }
const plan = current();
const note = (record) => appendFileSync(join(home, "calls.jsonl"), `${JSON.stringify({ pid: process.pid, ...record })}\n`);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function pgid() {
  try { const stat = readFileSync("/proc/self/stat", "utf8"); return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]); } catch { return null; }
}

// The client's own flags, as tmux takes them before the command.
let at = 0, socket = null, control = false, version = false;
const flags = [];
while (at < argv.length && argv[at].startsWith("-")) {
  const flag = argv[at++];
  flags.push(flag);
  if (flag === "-S" || flag === "-f") flags.push(argv[at++]);
  if (flag === "-S") socket = flags[flags.length - 1];
  if (flag === "-C") control = true;
  if (flag === "-V") version = true;
}
/** The commands of the rest, split as tmux's cmd_parse_from_arguments splits them. */
const commands = [[]];
for (const raw of argv.slice(at)) {
  let arg = raw, end = false;
  if (arg.endsWith(";")) {
    arg = arg.slice(0, -1);
    if (arg.endsWith("\\")) arg = `${arg.slice(0, -1)};`;
    else end = true;
  }
  if (!end || arg !== "") commands[commands.length - 1].push(arg);
  if (end) commands.push([]);
}
const parsed = commands.filter((command) => command.length > 0);
note({ pgid: pgid(), argv, flags, commands: parsed, env: { TMUX: "TMUX" in process.env, TMUX_PANE: "TMUX_PANE" in process.env, PATH: "PATH" in process.env } });

if (version) { process.stdout.write(`${plan.version ?? "tmux 3.4"}\n`); process.exit(0); }
if (control) await controlMode();
else await commandMode();

function readState() { return existsSync(join(home, "state.json")) ? JSON.parse(readFileSync(join(home, "state.json"), "utf8")) : { windows: 0 }; }
function writeState(state) { writeFileSync(join(home, "state.json"), JSON.stringify(state)); }
function inject(line) { appendFileSync(join(home, "inject.txt"), `${line}\n`); }
function emitted() { return existsSync(join(home, "emitted.txt")) ? readFileSync(join(home, "emitted.txt"), "utf8") : ""; }

async function commandMode() {
  for (const [name, ...args] of parsed) {
    if (name === "new-session") {
      if (plan.newSession?.fail) { process.stderr.write("fake: the server did not start\n"); process.exit(1); }
      // A real socket file, left behind as tmux leaves its own: this process exits without closing it.
      if (socket && !existsSync(socket)) await new Promise((resolve) => { const server = createServer(); server.on("error", resolve); server.listen(socket, resolve); });
      writeState({ ...readState(), server: true });
    } else if (name === "new-window") {
      const state = readState(), n = state.windows = (state.windows ?? 0) + 1;
      writeState(state);
      const e = {};
      let i = 0;
      const seen = {};
      for (; i < args.length && args[i].startsWith("-"); i++) {
        if (["-P", "-d"].includes(args[i])) continue;
        const value = args[++i];
        if (args[i - 1] === "-e") { const [key, ...rest] = value.split("="); e[key] = rest.join("="); }
        else seen[args[i - 1]] = value;
      }
      const files = Object.fromEntries(Object.entries(e).map(([key, path]) => [key, existsSync(path) ? { mode: statSync(path).mode & 0o777, size: statSync(path).size } : null]));
      note({ window: n, e, files, target: seen["-t"], format: seen["-F"], command: args.slice(i) });
      const step = plan.window ?? {};
      if (step.stderr !== undefined && e.E) writeFileSync(e.E, step.stderr);
      if (step.status !== undefined && e.S) writeFileSync(e.S, step.status);
      if (step.closeAtOnce) {
        const line = `%unlinked-window-close @${n}`;
        inject(`emit ${line}`);
        for (let waited = 0; !emitted().includes(line) && waited < 3000; waited += 5) sleepSync(5);
      }
      process.stdout.write(`@${n} %${n}\n`);
    } else if (name === "kill-server") {
      inject("exit");
    } else if (name === "list-sessions") {
      process.exit(existsSync(`${socket}.answers`) ? 0 : 1);
    }
  }
  process.exit(0);
}

async function controlMode() {
  const now = () => Math.floor(Date.now() / 1000);
  const out = (text) => process.stdout.write(text);
  if (plan.attach === "fail") {
    out(`%begin ${now()} 1 0\ncan't find session: oats-tui\n%error ${now()} 1 0\n%exit\n`);
    process.exit(1);
  }
  let number = 1, captures = 0, attached = false;
  const held = [], early = [];
  // As tmux: the attach is answered first, and a command that came before it waits for it.
  setTimeout(() => {
    note({ attached: true });
    out(`%begin ${now()} 1 0\n%end ${now()} 1 0\n%session-changed $0 oats-tui\n`);
    attached = true;
    for (const line of early.splice(0)) take(line);
  }, plan.attachDelayMs ?? 0);
  function take(line) {
    if (current().holdCapture && line.startsWith("capture-pane")) held.push(line);
    else if (held.length) held.push(line); // answers stay in order behind a held one
    else answer(line);
  }
  function answer(line) {
    const n = ++number, t = now();
    let lines = [];
    const step = current();
    if (line.startsWith("capture-pane")) lines = step.screen ?? [`screen ${++captures}`, "%end 1 2 1", "last"];
    else if (line.startsWith("display")) lines = [step.cursor ?? "3 4 1"];
    out(`%begin ${t} ${n} 1\n${lines.map((l) => `${l}\n`).join("")}%end ${t} ${n} 1\n`);
    const killed = /^kill-pane -t %(\d+)$/.exec(line);
    if (killed && !current().killPaneSilent) out(`%unlinked-window-close @${killed[1]}\n`);
  }
  let rest = "";
  process.stdin.on("data", (chunk) => {
    rest += chunk;
    let i;
    while ((i = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, i);
      rest = rest.slice(i + 1);
      note({ control: line });
      if (!attached) early.push(line);
      else take(line);
    }
  });
  process.stdin.on("end", () => process.exit(0));
  // The test's lines, read from where the file was when this client started.
  const path = join(home, "inject.txt");
  let offset = existsSync(path) ? statSync(path).size : 0;
  setInterval(() => {
    if (!existsSync(path)) return;
    const text = readFileSync(path);
    if (text.length <= offset) return;
    const fresh = text.subarray(offset).toString("utf8");
    const last = fresh.lastIndexOf("\n");
    if (last < 0) return;
    offset += Buffer.byteLength(fresh.slice(0, last + 1));
    for (const line of fresh.slice(0, last).split("\n")) {
      if (line.startsWith("emit ")) out(`${line.slice(5)}\n`);
      else if (line === "release") for (const waiting of held.splice(0)) answer(waiting);
      else if (line === "exit") { out("%exit\n"); appendFileSync(join(home, "emitted.txt"), `${line}\n`); process.exit(0); }
      else if (line === "die") process.exit(1);
      appendFileSync(join(home, "emitted.txt"), `${line.startsWith("emit ") ? line.slice(5) : line}\n`);
    }
  }, 5);
}
