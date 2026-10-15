process.env.TZ = "UTC";
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, bindings, keyLabel } from "../lib/actions.mjs";
import { DETACH_KEY_FEATURE, DETAIL_WITHHELD, INSTANCE_VARIABLES, TERMS, cliReadsRemotes, createSoulCatalog, sessionAttachArgv, cliRecord, deploymentState, heldHome, identityMemory, observeIdentities, observedEntry, panelData, panelInstances, primaryDeployment, remoteRosterState, rosterRows } from "../lib/client.mjs";
import { effectiveConfig } from "../lib/config.mjs";
import { NO_TERMINAL, USAGE, main, noDeployment, noKernel, parseArgs } from "../lib/main.mjs";
import { shown, textOf as textShown } from "../lib/term/text.mjs";
import { ENTER, LEAVE } from "../lib/term/tty.mjs";
import { CLI, DEPLOYMENT, lifecycleSession, lifecycleWork, failed, fakeProcess, fakeStdin, fakeStdout, fakeTimers, instanceRow, modesOf, observed, readTerminalOutput, rosterOf } from "./helpers.mjs";

/** One outcome of the roster read as an event for the store, made as lib/read.mjs `takeRoster`
 *  makes it: the shared rule over the roster held, then what it reported into the memory of
 *  identities, with the time of the cycle that began the read. */
function rosterEvent(held, outcome, at) {
  const state = remoteRosterState(held.remote, outcome, at);
  const identities = state.reported === null ? { memory: held.memory, notes: held.notes } : observeIdentities({ memory: held.memory, notes: held.notes }, state.reported, at);
  return { roster: { remote: { remoteGroups: state.remoteGroups, rosterAnswered: state.rosterAnswered, rosterFailure: state.rosterFailure }, memory: identities.memory, notes: identities.notes, at } };
}
/** The reader of a run, faked: what the loop asked of it, in order, and a way to answer. */
function fakeReader(log, options) {
  let number = 0;
  const did = (what, ...more) => { log.push(["reader", what, ...more]); };
  return {
    options, calls: [],
    start() { did("start"); return Promise.resolve(); },
    request(how) { did("request", how); return Promise.resolve(); },
    touch() { did("touch"); },
    voidInFlight() { did("void"); },
    /** The exec the loop hands the shared preflight: the test's fake prepareRemoteTerm only checks it is this one. */
    exec() { throw new Error("the fake reader starts nothing"); },
    /** A change (an apply, a start): recorded with its label, answered by the test through `changed`. */
    changeExec(bin, argv, options, callback) { did("change", [...argv], options.label); this.changed.push({ argv, options, callback }); return { pid: 4000 + this.changed.length }; },
    changed: [],
    /** The changes still running when the run ends, as lib/read.mjs answers after its stop. */
    running: [],
    changes() { return this.running; },
    stop() { did("stop"); },
    children: () => [],
    /** A served deployment's answer of a cycle, as lib/read.mjs gives it: every answer under a
     *  number of its own, as every cycle has. */
    answer(entry, id = DEPLOYMENT) { options.onEntry({ id, entry, number: ++number }); },
    /** The number of the last cycle begun, as lib/read.mjs `begun` answers: each answer and each
     *  `cycle()` begins one. */
    begun() { return number; },
    /** A cycle begun now, answered later (`read`): its number. */
    cycle() { return ++number; },
    /** An answer made from the kernel's (`read: true`), of a cycle begun earlier or now. */
    read(entry, at = ++number, id = DEPLOYMENT) { options.onEntry({ id, entry, number: at, read: true }); },
    /** A roster read begun, as lib/read.mjs says it. */
    collecting() { options.onRoster({ collecting: true }); },
    /** One outcome of the roster read, over what the loop holds of the other machines now. */
    roster(outcome) { options.onRoster(rosterEvent(options.getRoster(), outcome, options.clock())); },
  };
}
/** The run's panel (lib/panel.mjs), faked: what the loop asked of it, in order, under "panel" in
 *  the log; `opens`, every open with a way to answer it as the panel does (`made(id)`, `refuse(error)`);
 *  `screen` and `closed`, the panel's two callbacks, as it calls them. */
function fakePanel(log, options) {
  const did = (what, ...more) => { log.push(["panel", what, ...more]); };
  const p = {
    options, opens: [],
    screen: (id, text, cursor = { x: 0, y: 0, visible: true }, size = { cols: 40, rows: 10 }) => options.onScreen({ id, screen: options.capture(text, size), cursor }),
    closed: (id, status, stderr = "", asked = false) => options.onClosed({ id, status, stderr, asked }),
    activity: (id) => options.onActivity({ id }),
  };
  p.api = {
    open({ argv, cols, rows }) {
      did("open", [...argv], cols, rows);
      return new Promise((resolve, reject) => { p.opens.push({ argv, cols, rows, made: (id) => resolve({ id }), refuse: reject }); });
    },
    close(id) { did("close", ...(id === undefined ? [] : [id])); }, show(id) { did("show", id); }, resize(cols, rows) { did("resize", cols, rows); },
    input(bytes) { did("input", Buffer.from(bytes).toString("latin1")); }, paste(text) { did("paste", text); },
    setVisible(on) { did("visible", on); }, refresh() { did("refresh"); }, pause() { did("pause"); }, resume() { did("resume"); }, end() { did("end"); },
    get current() { return null; },
  };
  return p;
}
/** `oats tui` on a fake terminal: the run, its streams and what it wrote. Everything outside the
 *  terminal (the user's file, the deployment, the kernel, the reader) is the test's own. */
function run({ argv = [], env = { TERM: "xterm-256color", LANG: "en_US.UTF-8" }, columns = 80, rows = 24, stdinTTY = true, stdoutTTY = true, config = { ok: true, actions: ACTIONS, ascii: false }, deployment = { ok: true, deployment: DEPLOYMENT }, kernel = { ok: true, cli: CLI }, cwd = "/work/here", offered = { offered: [], limited: false }, admit = (path) => ({ ok: true, deployment: path }), prepare = null, confirm = null, start = null, tellable = () => false } = {}) {
  const log = [];
  const stdin = fakeStdin({ log, isTTY: stdinTTY }), stdout = fakeStdout({ log, columns, rows, isTTY: stdoutTTY }), proc = fakeProcess(), timers = fakeTimers();
  const kill = proc.kill;
  proc.kill = (pid, signal) => { log.push(["kill", pid, signal]); return kill(pid, signal); };
  const errors = [];
  const stderr = { write(text) { errors.push(text); log.push(["stderr", text]); return true; } };
  let clock = Date.parse("2026-10-11T10:00:30.000Z");
  // `offered`: what ~/Agents holds that the run does not serve; a test may put another answer there.
  // `panel`: the run's panel, faked (what the loop asked of it, and a way to answer as the panel
  // does); `preflights`: every preflight it began, each with what it was handed and a way to answer it.
  // `soulReads`: every `oats souls` the run's catalog asked for, with a way to answer it; `soulExec`
  // the exec the loop made the catalog with.
  // `spawn`: what the run made of the three shared spawn factories, faked: the preview's reads and
  // the transaction's submits and checks, each with a way to answer; what the boundary was made with.
  const r = { stdin, stdout, proc, timers, errors, log, offered, reader: null, panel: null, preflights: [], confirmations: [], starts: [], soulReads: [], soulExec: null, tick(ms) { clock += ms; },
    spawn: { preview: null, previewExec: null, reads: [], applyRead: null, applyExec: null, applyCalls: [], request: null, submits: [], checks: [] } };
  let up;
  r.up = new Promise((resolve) => { up = resolve; });
  const effects = {
    loadConfig(asked) { log.push(["effect", "config", { ...asked.env }]); return config; },
    findDeployment(start) { log.push(["effect", "deployment", start]); return deployment; },
    async probeKernel(asked) { log.push(["effect", "kernel", { ...asked.env }]); return kernel; },
    createReader(options) { r.reader = fakeReader(log, options); const start = r.reader.start; r.reader.start = () => { const answer = start(); queueMicrotask(up); return answer; }; return r.reader; },
    offeredDeployments(home, served) { log.push(["effect", "offered", home, [...served]]); return r.offered; },
    admitDeployment(path) { log.push(["effect", "admit", path]); return admit(path); },
    createPanel(options) { r.panel = fakePanel(log, options); return r.panel.api; },
    sweep(options) { log.push(["panel", "sweep", options.env === env]); return { removed: [] }; },
    runDir() { log.push(["panel", "dir"]); return "/tmp/oats-tui-fixture"; },
    removeDir(dir) { log.push(["panel", "remove", dir]); },
    prepareRemoteTerm(cli, target, options) {
      log.push(["preflight", target]);
      if (prepare) return prepare(cli, target, options);
      return new Promise((resolve, reject) => { r.preflights.push({ cli, target, options, resolve, reject }); });
    },
    // The acts: the shared confirmation is the real one unless the test gives its own (`confirm`);
    // a start is the test's (`start`), and so is whether stderr is a terminal or a file.
    ...(confirm ? { createLifecycleConfirmation(options) { const made = confirm(options); r.confirmations.push(made); return made; } } : {}),
    ...(start ? { startInstance(...args) { r.starts.push(args); return start(...args); } } : {}),
    tellable,
    // The souls: the shared catalog itself, over a kernel read the test answers.
    createSoulCatalog(options) {
      r.soulExec = options.exec;
      return createSoulCatalog({ ...options, invoke: (cli, asked) => new Promise((resolve) => { log.push(["souls", asked.action]); r.soulReads.push({ asked, answer: resolve }); }) });
    },
    // The spawn: the shared preview, apply boundary and transaction, faked.
    createSpawnPreview(options) {
      r.spawn.previewExec = options.exec;
      r.spawn.preview = {
        read: (request, getContext) => new Promise((resolve) => { log.push(["spawn", "preview"]); r.spawn.reads.push({ request, context: getContext(), answer: resolve }); }),
        prepareRead() { throw new Error("the fake preview prepares nothing"); },
        cache: { invalidate(id) { log.push(["spawn", "invalidate", id]); }, size: () => 0 },
      };
      return r.spawn.preview;
    },
    createSpawnApplyBoundary(options) {
      r.spawn.applyRead = options.read; r.spawn.applyExec = options.exec; r.spawn.applyTimer = options.applyTimer; r.spawn.answerTimer = options.timer;
      return (body, getContext, extra) => { r.spawn.applyCalls.push({ body, context: getContext(), settled: extra?.settled }); return Promise.resolve(null); };
    },
    createSpawnTransaction(options) {
      r.spawn.request = options.request; r.spawn.sleep = options.sleep;
      return {
        submit: (intent, call) => new Promise((resolve) => { log.push(["spawn", "submit"]); r.spawn.submits.push({ intent, call, answer: resolve }); }),
        check: (job, call) => new Promise((resolve) => { log.push(["spawn", "check"]); r.spawn.checks.push({ job, call, answer: resolve }); }),
        recover() { throw new Error("the TUI recovers nothing"); },
      };
    },
  };
  r.status = main({ argv, stdin, stdout, stderr, env, proc, now: () => clock, setTimer: timers.setTimer, clearTimer: timers.clearTimer, cwd: () => cwd, home: "/home/u", effects });
  r.status.then(up);
  return r;
}
/** A run that has taken its terminal and drawn its first frame. */
async function started(options) { const r = run(options); await r.up; return r; }
/** The text a run has on screen after its writes, read naively: enough to find a word. */
const textOf = (output) => readTerminalOutput(output).text;
const readerDid = (r) => r.log.filter(([what]) => what === "reader").map(([, ...rest]) => rest);
const ENTRY = observed([instanceRow("acme-expert", "acme-expert-tui"), instanceRow("acme-maintainer", "acme-maintainer-ops", { running: false, runtimeState: "stopped" })]);

// ── Other machines and the switcher: fixtures in the kernel's own forms. A workspace is the
// identity a kernel reports; a roster group's id is `<server>:<targetKey>` with a lower-case server
// name and no path in it; a remote row says whether it is addressable. A group in another form is
// never remembered, and a deployment that reports no identity is matched to no workspace.
const reportedWorkspace = (key = "git.example.com/acme-platform/agents", team = "aweb:acme-platform") => ({ reachable: true, key, ref: `git:${key}`, keyFrom: "workspace", standalone: false, defaultTeam: { label: "default", team }, teams: { default: team }, teamsFrom: "observed" });
/** An observed entry of the deployment at `root`, through the real `rosterRows`, `panelInstances`
 *  and `observedEntry`, as helpers.mjs `observed` makes one, with the workspace it reports. */
function observedAt(root, rows, { workspace = reportedWorkspace(), name = "acme-platform" } = {}) {
  const local = rows.map((row) => ({ ...row, home: `${root}/agents/${row.agent}/instances/${row.instance}`, repo: `${root}/oats` }));
  const base = rosterOf(local);
  const document = { ...base, root: `${root}/agents`, agents: base.agents.map((soul) => ({ ...soul, dir: `${root}/agents/${soul.name}` })), workspace };
  const listed = rosterRows(document, CLI);
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name } }, observedAt: "2026-10-11T09:59:00.000Z" }, panelInstances(listed, listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, tmux: row.tmux }))), "2026-10-11T10:00:00.000Z");
}
/** The fixture's deployment, reporting the workspace `garnet` reports too. */
const HOME_ENTRY = observedAt(DEPLOYMENT, [instanceRow("acme-expert", "acme-expert-tui"), instanceRow("acme-maintainer", "acme-maintainer-ops", { running: false, runtimeState: "stopped" })]);
const remoteRow = (name, root, more = {}) => ({ instance: name, agent: "dev", agentsRoot: `${root}/agents`, home: `${root}/agents/dev/instances/${name}`, running: true, savedRoute: false, addressable: true, missingRemotely: false, createdAt: null, identity: { alias: name, team: "aweb:acme-platform" }, ...more });
function group(id, root, rows, workspace = reportedWorkspace()) {
  const server = id.slice(0, id.indexOf(":"));
  return { id, server, label: server, registrationPresent: true, target: { sshHost: `${server}.example`, workspace: root }, probe: { ok: true }, agentsRoot: `${root}/agents`, workspace, souls: [], instances: rows, retireFailures: [] };
}
/** A machine in the fixture's workspace, and one that reports a workspace of its own. */
const garnet = () => group("garnet:t1", "/srv/acme-platform", [remoteRow("dev-far", "/srv/acme-platform"), remoteRow("dev-held", "/srv/acme-platform", { running: false, addressable: false })]);
const onyx = () => group("onyx:t2", "/home/builder/acme-atlas", [remoteRow("dev-east", "/home/builder/acme-atlas", { identity: { alias: "dev-east", team: "aweb:acme-atlas" } })], reportedWorkspace("git.example.com/acme-atlas/charts", "aweb:acme-atlas"));
/** What `oats server roster --json` prints for these groups. */
const rosterAnswer = (groups) => ({ schemaVersion: 1, ok: true, result: { groups } });
/** A kernel record that reads other machines, made by the shared `cliRecord` as the probe makes it. */
const REMOTE_CLI = cliRecord({ version: CLI.version, workspaceApi: CLI.workspaceApi, features: [...CLI.features], remote: ["roster"] }, { bin: CLI.bin, source: "tui" });
/** A folder of ~/Agents this run does not serve, as lib/read.mjs `offeredDeployments` answers. */
const LEDGER = "/home/u/Agents/acme-ledger";
const OFFERED = Object.freeze({ offered: Object.freeze([Object.freeze({ path: LEDGER, name: "acme-ledger" })]), limited: false });
/** What a run asked of the file system and the kernel, in order: the effects with their arguments
 *  (the user's file and the kernel are asked with the environment, which is not repeated here). */
const effectsOf = (r) => r.log.filter(([what]) => what === "effect").map(([, which, ...rest]) => (which === "config" || which === "kernel" ? [which] : [which, ...rest]));
/** The whole screen as the run draws it now. Ctrl+L redraws in full, so the text read does not
 *  depend on which cells the last frame left as they were. */
function screenOf(r) {
  r.stdout.take();
  r.stdin.type("\x0c");
  return textOf(r.stdout.take());
}
/** The reason the shared home gives for the fixture's deployment holding `entry`, asked directly. */
function sharedReason(entry) {
  const held = { ctxs: [DEPLOYMENT], snapshot: { byWs: new Map([[DEPLOYMENT, entry]]) }, remoteGroups: [], remembered: identityMemory({ memory: new Map(), notes: new Map() }), rosterAnswered: false, rosterFailure: null, cli: CLI, observing: new Set(), remoteCollecting: false, home: "/home/u", at: "2026-10-11T10:00:30.000Z" };
  return deploymentState(primaryDeployment(panelData(held, DEPLOYMENT, TERMS).deployments)).detail;
}
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
/** Every byte a run wrote to its terminal, from its first. */
const written = (r) => r.log.filter(([what]) => what === "write").map(([, bytes]) => bytes).join("");
/** A screen's text with every run of blanks as one: two screens that differ in a sentence's length compare by their words. */
const words = (text) => text.replace(/ +/g, " ");

test("the action table binds each key to one action, and a key bound twice is refused when the table is read", () => {
  assert.deepEqual(Object.fromEntries(bindings(ACTIONS)), {
    up: "up", k: "up", down: "down", j: "down", g: "top", home: "top", G: "bottom", end: "bottom", pageup: "page-up", pagedown: "page-down",
    left: "collapse", h: "collapse", right: "expand", l: "expand", tab: "detail", "/": "filter", r: "refresh", 1: "instances", 2: "souls", 3: "capabilities",
    w: "workspaces", enter: "open", i: "soul-instances", z: "zoom", c: "close-terminal", "[": "tab-previous", "]": "tab-next", X: "stop", D: "retire", S: "start", R: "restart", n: "spawn", N: "spawn-another", C: "spawn-check",
    "?": "help", escape: "close", q: "quit", "ctrl+c": "quit", "ctrl+z": "suspend", "ctrl+l": "redraw", "ctrl+k": "palette",
  });
  assert.throws(() => bindings([{ id: "a", keys: ["x"], label: "a" }, { id: "b", keys: ["x"], label: "b" }]), /key x is bound to a and to b/);
  assert.equal(Object.isFrozen(ACTIONS) && ACTIONS.every((a) => Object.isFrozen(a) && Object.isFrozen(a.keys)), true);
  assert.deepEqual(["?", "q", "escape", "ctrl+c", "shift+tab", "f5", "ctrl+alt+up", "space", "alt+x"].map(keyLabel), ["?", "q", "Esc", "Ctrl+C", "Shift+Tab", "F5", "Ctrl+Alt+Up", "Space", "Alt+X"]);
  // Enter opens the selected agent's terminal in the list and the selected workspace in the
  // switcher: one action. The capitals are the acts on an instance, G, another of the selected
  // instance's soul (N) and the check of a spawn's result (C): no act is a lower-case key (Enter is
  // cheap, a capital takes Shift). A spawn's own key is n: it opens a prompt, and spawns nothing.
  assert.equal(bindings(ACTIONS).get("enter"), "open");
  assert.deepEqual([...bindings(ACTIONS).keys()].filter((key) => /^[A-Z]$/.test(key)), ["G", "X", "D", "S", "R", "N", "C"]);
  for (const id of ["stop", "retire", "start", "restart"]) assert.equal(ACTIONS.find((action) => action.id === id).keys.every((key) => /^[A-Z]$/.test(key)), true, id);
});

test("the arguments are --ascii, --help and --dir with a path, in both spellings; anything else is refused with E_BAD_ARGS and the usage, --server included", () => {
  assert.deepEqual(parseArgs([]), { options: { ascii: false, help: false, dir: null } });
  assert.deepEqual(parseArgs(["--ascii"]).options, { ascii: true, help: false, dir: null });
  assert.equal(parseArgs(["-h"]).options.help, true);
  assert.deepEqual(parseArgs(["--ascii", "--help"]).options, { ascii: true, help: true, dir: null });
  assert.equal(parseArgs(["--dir", "/srv/deploy"]).options.dir, "/srv/deploy");
  assert.equal(parseArgs(["--dir=/srv/deploy", "--ascii"]).options.dir, "/srv/deploy");
  assert.equal(parseArgs(["--dir", "--ascii"]).options.dir, "--ascii", "what follows --dir is its path, whatever it looks like");
  assert.equal(parseArgs(["--dir=a=b"]).options.dir, "a=b");
  for (const argv of [["--dir"], ["--dir="], ["--ascii", "--dir"], ["--dir", ""]]) assert.equal(parseArgs(argv).error, `oats: \`oats tui --dir\` takes a path (E_BAD_ARGS); usage: ${USAGE}`, argv.join(" "));
  for (const argv of [["--server", "build"], ["--json"], ["instances"], ["--ascii", "--no"], ["--ascii=1"], ["--directory", "/x"]]) {
    const { error, options } = parseArgs(argv);
    assert.equal(options, undefined);
    assert.equal(error, `oats: \`oats tui\` takes no argument ${argv.find((a) => a !== "--ascii")} (E_BAD_ARGS); usage: ${USAGE}`);
  }
  const hostile = parseArgs(["\x1b[2J\x1b]0;owned\x07"]).error;
  assert.doesNotMatch(hostile, /[\x00-\x1f\x7f]/, "an argument is never echoed raw: this line goes to a terminal");
  assert.match(hostile, /E_BAD_ARGS/);
  assert.equal(USAGE, "oats tui [--dir <path>] [--ascii]");
});

test("without a terminal on stdin and stdout, or with TERM unset, empty or dumb, it exits 1 with one line on stderr, draws nothing and reads nothing", async () => {
  const cases = [
    { stdinTTY: false }, { stdoutTTY: false }, { stdinTTY: false, stdoutTTY: false },
    { env: { LANG: "en_US.UTF-8" } }, { env: { TERM: "" } }, { env: { TERM: "dumb" } },
  ];
  for (const options of cases) {
    const r = run(options);
    assert.equal(await r.status, 1, JSON.stringify(options));
    assert.deepEqual(r.errors, [`${NO_TERMINAL}\n`]);
    assert.deepEqual(r.stdout.written, [], "no byte, so no escape byte, on a stream that is not a terminal");
    assert.equal(r.stdin.raw, false);
    assert.deepEqual(r.proc.eventNames(), [], "and it listens for nothing");
    assert.deepEqual(r.log.filter(([what]) => what === "effect"), [], "the user's file, the deployment and the kernel are not looked at");
  }
  assert.equal(NO_TERMINAL, "oats: `oats tui` needs a terminal on stdin and stdout (E_NO_TERMINAL); `oats status` prints the instances once");
});

test("--help prints the usage and exits 0 with no terminal; a bad argument exits 1 before the terminal is looked at", async () => {
  const help = run({ argv: ["--help"], stdinTTY: false, stdoutTTY: false });
  assert.equal(await help.status, 0);
  assert.equal(help.stdout.written.join("").startsWith(`Usage:\n  ${USAGE}\n`), true);
  assert.match(help.stdout.written.join(""), /--dir <path>.*--ascii/s);
  assert.deepEqual(help.errors, []);
  const bad = run({ argv: ["--server", "build"] });
  assert.equal(await bad.status, 1);
  assert.deepEqual(bad.errors, [`oats: \`oats tui\` takes no argument --server (E_BAD_ARGS); usage: ${USAGE}\n`]);
  assert.deepEqual(bad.stdout.written, []);
});

test("the eight instance variables are removed from the process environment itself before anything is read or started, so the user's file, the kernel and every child see none", async () => {
  const env = { TERM: "xterm-256color", LANG: "en_US.UTF-8", KEEP: "this", ...Object.fromEntries(INSTANCE_VARIABLES.map((name) => [name, `/an/agent/${name}`])) };
  assert.equal(INSTANCE_VARIABLES.length, 8);
  const r = await started({ env });
  for (const name of INSTANCE_VARIABLES) assert.equal(name in env, false, name);
  assert.equal(env.KEEP, "this");
  for (const [, , seen] of r.log.filter(([what, which]) => what === "effect" && which !== "deployment")) assert.deepEqual(Object.keys(seen).filter((name) => INSTANCE_VARIABLES.includes(name)), []);
  assert.equal(r.reader.options.env, env, "the reader is given that same environment, the one its children inherit");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  // Also when the run then stops for want of a terminal: the removal comes before that check.
  const none = { ...Object.fromEntries(INSTANCE_VARIABLES.map((name) => [name, "x"])) };
  await run({ env: none }).status;
  assert.deepEqual(Object.keys(none), []);
});

test("before the alternate screen, in this order and each a line on stderr with status 1: the user's file, the deployment, the kernel", async () => {
  const lines = ["oats: `oats tui` cannot use /home/u/.config/oats/tui.json: quit has no key; give it one (E_TUI_CONFIG)", "oats: `oats tui` cannot use /home/u/.config/oats/tui.json: unknown action reload; the actions are up (E_TUI_CONFIG)"];
  const cases = [
    [{ config: { ok: false, lines } }, lines.map((line) => `${line}\n`).join(""), ["config"]],
    // No deployment where the user is, and none named: ~/Agents is looked at before the run gives up.
    [{ deployment: { ok: false, dir: "/work/here" } }, `${noDeployment("/work/here")}\n`, ["config", "deployment", "offered"]],
    [{ kernel: { ok: false, reason: "version 0.24.0 outside >=0.25.8 <0.53.0" } }, `${noKernel("version 0.24.0 outside >=0.25.8 <0.53.0")}\n`, ["config", "deployment", "kernel"]],
  ];
  for (const [options, said, asked] of cases) {
    const r = run(options);
    assert.equal(await r.status, 1);
    assert.equal(r.errors.join(""), said);
    assert.deepEqual(r.log.filter(([what]) => what === "effect").map(([, which]) => which), asked);
    assert.deepEqual(r.stdout.written, [], "nothing is drawn");
    assert.equal(r.stdin.raw, false);
    assert.equal(r.reader, null, "and nothing is read");
    assert.deepEqual(r.proc.eventNames(), []);
  }
  assert.equal(noDeployment("/work/here"), "oats: no OATS deployment at or above /work/here (E_NO_DEPLOYMENT); name one with `oats tui --dir <path>`");
  assert.equal(noKernel("version 0.24.0 outside >=0.25.8 <0.53.0"), "oats: `oats tui` could not use its own kernel (E_TUI_KERNEL): version 0.24.0 outside >=0.25.8 <0.53.0");
});

test("a path or a reason in those lines is never written raw: a path that is not plain reads `that directory`, and a reason goes through the display filter", () => {
  for (const dir of ["/tmp/\x1b[2J", "/tmp/café", `/${"d".repeat(200)}`, "", null]) {
    assert.equal(noDeployment(dir), "oats: no OATS deployment at or above that directory (E_NO_DEPLOYMENT); name one with `oats tui --dir <path>`", JSON.stringify(dir));
  }
  assert.equal(noDeployment("/srv/my deployments/one").includes("/srv/my deployments/one"), true, "a space is plain");
  assert.doesNotMatch(noKernel("not the oats CLI (name: \x1b]0;owned\x07)"), /[\x00-\x1f\x7f-\x9f]/);
  assert.match(noKernel("not the oats CLI (name: \x1b]0;owned\x07)"), /\(E_TUI_KERNEL\): \[withheld\]$/);
  assert.match(noKernel("two\nlines"), /: two lines$/);
  assert.match(noKernel(""), /: it gave no reason$/);
});

test("the deployment is looked for from --dir, a relative one from where the user is, else from where the user is", async () => {
  for (const [argv, from] of [[[], "/work/here"], [["--dir", "/srv/deploy/agents"], "/srv/deploy/agents"], [["--dir=../there"], "/work/there"], [["--dir", "."], "/work/here"]]) {
    const r = run({ argv, deployment: { ok: false, dir: from } });
    await r.status;
    assert.deepEqual(r.log.find(([what, which]) => what === "effect" && which === "deployment"), ["effect", "deployment", from], argv.join(" "));
  }
});

test("a run says it is reading, draws the instances when the reader answers, opens and closes the help, and q quits with status 0, the terminal restored and the reader stopped before the run is over", async () => {
  const r = await started();
  assert.deepEqual([r.reader.options.getServed(), r.reader.options.cli], [[DEPLOYMENT], CLI], "the reader reads the deployment that was found, with the kernel that was accepted");
  assert.equal(r.reader.options.getEntry(DEPLOYMENT).deployment.status, "pending", "and is told the entry the store holds");
  assert.match(textOf(r.stdout.take()), /^ deploy  Instances   Souls   Capabilities.*Reading the deployment\..*\? help.*q quit/s);
  r.reader.answer(ENTRY);
  assert.match(textOf(r.stdout.take()), /acme-platform.*1 running.*1 stopped.*● acme-expert-tui.*○ acme-maintainer-ops/s);
  assert.equal(r.reader.options.getEntry(DEPLOYMENT), ENTRY);
  r.stdin.type("?");
  // Enter has a line per view, and rows of its own under the first: at 24 rows its first page ends before Esc.
  assert.match(textOf(r.stdout.take()), /Keys.*w.*workspaces.*Enter.*open the selected agent's terminal.*more below/s);
  r.stdin.type("G");
  assert.match(textOf(r.stdout.take()), /Not in this version.*oats session attach --home <home>.*closes this help/s, "the movement keys scroll the help to its end");
  r.stdin.type("?");
  assert.match(textOf(r.stdout.take()), /acme-expert-tui/);
  r.log.length = 0;
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.stdout.take(), LEAVE);
  assert.equal(r.stdin.raw, false);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.log.filter(([what, which]) => (what === "write" || which === "stop")).map(([what, which]) => (what === "write" ? "leave" : which)), ["leave", "stop"], "the terminal first, then the reads");
  r.reader.answer(ENTRY);
  assert.equal(r.stdout.take(), "", "an answer that arrives after the end draws nothing");
});

test("every key press tells the reader the user is there; r asks for a live read, at once", async () => {
  const r = await started();
  r.log.length = 0;
  r.stdin.type("j");
  r.stdin.type("r");
  assert.deepEqual(readerDid(r), [["touch"], ["touch"], ["request", { live: true }]]);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("the modes a whole run switches are exactly the list: four on at the start, the same four off and on again at Ctrl+L, the four back at the end, and nothing else, with the view drawn, filtered and scrolled", async () => {
  const r = await started({ offered: OFFERED });
  r.reader.answer(ENTRY);
  r.stdin.type("?");
  r.stdout.resize(100, 30);
  r.stdout.resize(40, 10);
  r.stdin.type("\x0c"); // Ctrl+L
  r.stdin.type("?");
  r.stdin.type("j\t/");
  r.stdin.type("\x1b[200~pasted q\nand a second line\x1b[201~");
  r.stdin.type("\r");
  r.reader.answer(failed(ENTRY, { code: "E_NEW_CODE", message: "a refusal with \x1b[2J in it" }));
  // The same refusal as the kernel's own (the reader marks it): the shared sentence names the speaker.
  r.reader.answer(failed(ENTRY, { code: "E_NEW_CODE", message: "a refusal with \x1b[2J in it", origin: "kernel" }));
  // And with the switcher drawn, over a machine's roster and a folder of ~/Agents.
  r.reader.collecting();
  r.reader.roster({ envelope: rosterAnswer([garnet(), onyx()]) });
  r.stdin.type("w");
  r.stdin.type("j/");
  r.stdin.type("\x1b[200~onyx\x1b]0;owned\x07\x1b[201~");
  r.stdin.type("\r");
  r.stdin.type("\x03"); // Ctrl+C
  assert.equal(await r.status, 0);
  const output = r.stdout.written.join("");
  const on = ["?1049h", "?25l", "?7l", "?2004h"], off = ["?2004l", "?7h", "?25h", "?1049l"];
  assert.deepEqual(modesOf(output), [...on, ...off, ...on, ...off]);
  assert.deepEqual([...new Set(modesOf(output))].sort(), [...on, ...off].sort(), "the set of mode sequences is the list, and only it");
  const { sequences, foreign, text } = readTerminalOutput(output);
  assert.deepEqual(foreign, [], "no mouse or focus reporting, no keyboard protocol, no keypad mode, no title, no clipboard, no query");
  assert.deepEqual([...new Set(sequences.map((s) => s.kind))].sort(), ["erase", "mode", "position", "sgr", "sync"]);
  const sync = sequences.filter((s) => s.kind === "sync").map((s) => s.body);
  assert.equal(sync.length > 0 && sync.every((body, i) => body === (i % 2 === 0 ? "?2026h" : "?2026l")), true, "every frame is begun and ended within itself: no synchronized update is left open");
  assert.doesNotMatch(text, /[\x00-\x1f\x7f-\x9f]/, "no bell, no other control byte");
  assert.equal(output.startsWith(ENTER) && output.endsWith(LEAVE), true);
});

test("Esc alone closes the help once nothing has followed it for 50 ms, and not before", async () => {
  const r = await started();
  r.stdin.type("?");
  r.stdout.take();
  r.stdin.type("\x1b");
  assert.equal(r.stdout.take(), "", "a lone ESC may be the start of a key");
  assert.deepEqual(r.timers.delays(), [50]);
  r.tick(50);
  r.timers.fire();
  assert.match(textOf(r.stdout.take()), /Reading the deployment\./);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.timers.count, 0, "no timer outlives the run");
});

test("a paste into the list is dropped whole: a pasted q, a pasted Ctrl+C and a pasted ? do nothing; into the filter field its first line is text", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdout.take();
  r.stdin.type("\x1b[200~q\x03?\x1a\x1b[201~");
  assert.equal(r.stdout.take(), "", "nothing changed, so nothing was written");
  assert.equal(r.log.some(([what]) => what === "kill"), false, "it was not suspended");
  r.stdin.type("/");
  r.stdout.take();
  r.stdin.type("\x1b[200~maintainer\nq\x1b[201~");
  const filtered = textOf(r.stdout.take());
  assert.match(filtered, /maintainer/);
  assert.doesNotMatch(filtered, /acme-expert-tui/, "the row that does not match is gone");
  r.stdin.type("q");
  assert.match(textOf(r.stdout.take()), /No instance matches the filter\./, "q is text in the field");
  r.stdin.type("\x03");
  assert.equal(await r.status, 0, "Ctrl+C still quits from the field");
});

test("a resize redraws in full; below 60x15 the screen is the too-small line, and back above it the view returns as it was", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdin.type("j");
  r.stdout.take();
  r.stdout.resize(60, 15);
  let out = r.stdout.take();
  assert.equal(out.startsWith("\x1b[?2026h\x1b[0m\x1b[2J"), true, "a resize clears first, inside the frame's synchronized update");
  assert.match(textOf(out), /^ acme-platform.*acme-maintainer-ops.*\? help/s);
  r.stdout.resize(59, 14);
  out = r.stdout.take();
  assert.equal(textOf(out), "Terminal too small: 59x14, oats tui needs 60x15.");
  r.stdout.resize(80, 24);
  assert.match(textOf(r.stdout.take()), />.*acme-maintainer-ops.*soul.*acme-maintainer/s, "the selection is where it was");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("a resize while a frame is being written makes no second write until the first has drained, then one frame at the newest size", async () => {
  const r = await started();
  r.stdout.take();
  r.stdout.accepts = false;
  r.stdin.type("?");
  assert.equal(r.stdout.written.length, 1, "the help frame is being written");
  r.stdout.resize(100, 30);
  r.stdout.resize(59, 14);
  r.reader.answer(ENTRY);
  r.stdout.resize(120, 40);
  assert.equal(r.stdout.written.length, 1, "nothing is queued behind it, an answer of the reader included");
  r.stdout.take();
  r.stdout.accepts = true;
  r.stdout.emit("drain");
  assert.equal(r.stdout.written.length, 1, "one frame for three resizes and an answer");
  const out = r.stdout.take();
  assert.equal(out.startsWith("\x1b[?2026h\x1b[0m\x1b[2J"), true);
  assert.match(out, /\x1b\[40;1H/, "drawn for the 40 rows the terminal has now");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Ctrl+L sets the terminal's modes again and redraws in full; Ctrl+\\ in the list is the leader, whose hint takes the footer's row until a second Ctrl+\\ puts the footer back and does nothing else", async () => {
  const r = await started();
  const first = r.stdout.take();
  assert.equal(first.startsWith(ENTER), true);
  r.log.length = 0;
  r.stdin.type("\x1c");
  const hint = r.stdout.take();
  assert.equal(hint.includes("\x1b[24;1H") && !/\x1b\[(?!24;)\d+;\d+H/.test(hint), true, "only the footer's row is written");
  assert.equal(textOf(hint), "C-\\   k palette   1-3 views   Up/Down instance   X/R/S/D acts   Esc the list");
  r.stdin.type("\x1c");
  assert.match(textOf(r.stdout.take()), /^C-\\ commands   \/ filter/);
  assert.deepEqual(readerDid(r), [["touch"], ["touch"]], "the leader reads nothing");
  r.log.length = 0;
  r.stdin.type("\x0c");
  assert.equal(r.stdout.take(), LEAVE + first, "the terminal left, then the same bytes as the start: the modes, then the frame cleared and drawn whole");
  assert.deepEqual(r.log.filter(([what]) => what === "raw"), [["raw", false], ["raw", true]], "raw mode is set again too");
  assert.deepEqual(readerDid(r), [["touch"]], "a redraw reads nothing and drops nothing");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("the bytes Ctrl+L writes, in order: raw mode off and on, then the leave and the enter sequence in ONE write, then the frame; three in a row write that three times, and q then leaves once", async () => {
  const r = await started();
  const frame = r.stdout.take().replace(ENTER, "");
  assert.equal(frame.startsWith("\x1b[?2026h") && frame.endsWith("\x1b[?2026l"), true, "the frame is one synchronized update");
  assert.equal(frame.replace(/\x1b\[\?2026[hl]/g, "").includes("\x1b[?"), false, "the frame itself switches no mode, but the update it begins and ends");
  r.log.length = 0;
  r.stdin.type("\x0c");
  // One write for the pair: a terminal never shows the shell's screen between the two halves, and
  // no other write of the program can land between them.
  const acts = r.log.filter(([what]) => what !== "reader");
  assert.deepEqual(acts.slice(0, 3), [["raw", false], ["raw", true], ["write", LEAVE + ENTER]]);
  assert.equal(acts.slice(3).every(([what]) => what === "write"), true);
  assert.equal(acts.slice(3).map(([, bytes]) => bytes).join(""), frame, "then the frame, cleared and drawn whole");
  assert.equal(r.stdout.take(), LEAVE + ENTER + frame);

  r.stdin.type("\x0c");
  r.stdin.type("\x0c");
  assert.equal(r.stdout.take(), (LEAVE + ENTER + frame).repeat(2));
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.stdout.take(), LEAVE, "after any number of Ctrl+L the end is one leave: every entry was matched by a leave before it");
  assert.equal(r.stdin.raw, false);
});

test("Ctrl+Z hands the terminal back, drops the reads in flight and only then stops the process group; SIGCONT brings the frame back in full and reads at once", async () => {
  const r = await started();
  const first = r.stdout.take().replace(ENTER, "");
  r.log.length = 0;
  r.stdin.type("\x1a");
  assert.equal(r.stdout.take(), LEAVE);
  // A cycle in flight when the process stops is no evidence about the deployment: it is dropped
  // BEFORE the signal, while the process can still do it.
  assert.deepEqual(r.log.filter(([what]) => what !== "raw"), [["reader", "touch"], ["write", LEAVE], ["reader", "void"], ["kill", 0, "SIGTSTP"]]);
  assert.equal(r.stdin.raw, false);
  r.log.length = 0;
  r.proc.emit("SIGCONT", "SIGCONT");
  assert.equal(r.stdout.take(), ENTER + first);
  assert.equal(r.stdin.raw, true);
  assert.deepEqual(readerDid(r), [["request", { live: true }]], "the return reads at once, and has nothing more to drop");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("stopped and continued from outside, which it could not prepare for: the reads in flight are dropped on the return, the modes are set again and it reads at once", async () => {
  const r = await started();
  const first = r.stdout.take().replace(ENTER, "");
  r.log.length = 0;
  r.proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(readerDid(r), [["void"], ["request", { live: true }]]);
  assert.equal(r.stdout.take(), LEAVE + ENTER + first);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("with --ascii, the user's file saying ascii, or a locale that is not UTF-8, the rules are hyphens and no byte outside ASCII is written", async () => {
  for (const options of [{ argv: ["--ascii"] }, { config: { ok: true, actions: ACTIONS, ascii: true } }, { env: { TERM: "xterm", LANG: "C" } }, { env: { TERM: "xterm", LC_ALL: "POSIX", LANG: "en_US.UTF-8" } }]) {
    const r = await started(options);
    r.reader.answer(ENTRY);
    r.stdin.type("?");
    r.stdin.type("q");
    assert.equal(await r.status, 0);
    const output = r.stdout.written.join("");
    assert.doesNotMatch(output, /[^\x00-\x7f]/, JSON.stringify(options.argv ?? options.env ?? "tui.json"));
    assert.match(textOf(output), /-{80}/);
    assert.match(textOf(output), /\+-{41}/, "the joint of the two panes is a plus");
  }
  const utf8 = await started();
  utf8.stdin.type("q");
  await utf8.status;
  assert.match(textOf(utf8.stdout.written.join("")), /─{80}/);
});

test("the keys are the effective table's: with the user's file giving quit to x, x quits and q does nothing, and the footer says so", async () => {
  const config = effectiveConfig({ keys: { quit: ["x"] } });
  const r = await started({ config: { ...config, path: "/home/u/.config/oats/tui.json" } });
  assert.match(textOf(r.stdout.take()), /x quit/);
  r.stdin.type("q");
  assert.equal(r.stdout.take(), "");
  r.stdin.type("x");
  assert.equal(await r.status, 0);
});

test("each signal ends the run with its status, the terminal restored and the reader stopped; the message of an uncaught error is printed after the alternate screen is left", async () => {
  for (const [signal, status] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129], ["SIGQUIT", 131]]) {
    const r = await started();
    r.stdout.take();
    r.log.length = 0;
    r.proc.emit(signal, signal);
    assert.equal(await r.status, status, signal);
    assert.equal(r.stdout.take(), LEAVE);
    assert.deepEqual(readerDid(r), [["stop"]], signal);
    assert.deepEqual(r.errors, []);
  }
  const r = await started();
  r.proc.emit("uncaughtException", new Error("the view broke"));
  assert.equal(await r.status, 1);
  const order = r.log.map(([what, bytes]) => (what === "write" && bytes === LEAVE ? "leave" : what === "reader" ? bytes : what)).filter((what) => ["leave", "stop", "stderr"].includes(what));
  assert.deepEqual(order, ["leave", "stop", "stderr"]);
  assert.match(r.errors.join(""), /^oats: `oats tui` stopped on an internal error; the terminal was restored\n {2}Error: the view broke\n/);
});

test("an error's text is never written raw: a control sequence in its message is withheld from the terminal", async () => {
  const r = await started();
  r.proc.emit("uncaughtException", new Error("name \x1b]0;owned\x07\x1b[2J"));
  assert.equal(await r.status, 1);
  assert.doesNotMatch(r.errors.join(""), /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
  const thrown = await started();
  thrown.proc.emit("unhandledRejection", "a string, not an error");
  assert.equal(await thrown.status, 1);
  assert.match(thrown.errors.join(""), /\n {2}a string, not an error\n$/);
});

test("a reader that throws when asked ends the run as an internal error, with the terminal restored", async () => {
  const r = await started();
  r.reader.request = () => { throw new Error("the reader broke"); };
  r.stdin.type("r");
  assert.equal(await r.status, 1);
  assert.match(r.errors.join(""), /stopped on an internal error.*the reader broke/s);
  assert.equal(r.stdin.raw, false);
});

// ── Other machines and the workspace switcher ────────────────────────────────

test("started outside every deployment with a folder of ~/Agents to offer, it opens on the switcher: the folder is listed, nothing is served, and the reader is started, which reads the roster of other machines", async () => {
  const r = await started({ deployment: { ok: false, dir: "/work/here" }, offered: OFFERED, kernel: { ok: true, cli: REMOTE_CLI } });
  assert.deepEqual(r.errors, [], "there is something to list, so no line that there is no deployment");
  assert.deepEqual(effectsOf(r), [["config"], ["deployment", "/work/here"], ["offered", "/home/u", []], ["kernel"]], "~/Agents is looked at for what a run that serves nothing can offer, before the kernel is asked");
  assert.deepEqual(r.reader.options.getServed(), [], "nothing is served");
  assert.deepEqual(r.reader.options.getRoster(), { remote: { remoteGroups: [], rosterAnswered: false, rosterFailure: null }, memory: new Map(), notes: new Map() });
  assert.deepEqual(readerDid(r), [["start"]], "the reader is started all the same: its cycles read the other machines");
  const first = textOf(r.stdout.take());
  assert.match(first, /^ workspaces.*On this machine, not opened.*acme-ledger\s+~\/Agents\/acme-ledger.*Enter open.*\/ filter.*r refresh.*\? help.*q quit/s);
  assert.doesNotMatch(first, /Reading the deployment|Esc close/, "no deployment is being read, and there is no view to close the switcher onto");
  // What the reader's first cycle found of the other machines is listed too.
  r.reader.collecting();
  r.reader.roster({ envelope: rosterAnswer([garnet()]) });
  assert.match(screenOf(r), /^ workspaces.*garnet.*On this machine, not opened.*acme-ledger/s);
  assert.deepEqual(r.reader.options.getServed(), []);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("started outside every deployment with nothing in ~/Agents to offer, it exits 1 with the E_NO_DEPLOYMENT line and no byte on stdout; a --dir that is in no deployment exits the same way, and ~/Agents is not looked at for it", async () => {
  const none = run({ deployment: { ok: false, dir: "/work/here" } });
  assert.equal(await none.status, 1);
  assert.deepEqual(effectsOf(none), [["config"], ["deployment", "/work/here"], ["offered", "/home/u", []]], "~/Agents was looked at, and the kernel is not asked for a run that has nothing to show");
  assert.deepEqual(none.errors, [`${noDeployment("/work/here")}\n`]);
  assert.deepEqual(none.stdout.written, [], "no byte, so no escape byte");
  assert.deepEqual([none.reader, none.stdin.raw, none.proc.eventNames()], [null, false, []]);

  // What was asked for is not there: a folder of ~/Agents is no answer to a path that was named.
  for (const argv of [["--dir", "/srv/nowhere"], ["--dir=/srv/nowhere"], ["--ascii", "--dir", "/srv/nowhere"]]) {
    const named = run({ argv, deployment: { ok: false, dir: "/srv/nowhere" }, offered: OFFERED });
    // A run that took the terminal instead would wait for a key and never end, and this file with
    // it: such a run is seen as soon as it has started, and is ended here before it is judged.
    const how = await Promise.race([named.status, named.up.then(() => "it took the terminal")]);
    if (how !== 1) { named.stdin.type("q"); await named.status; }
    assert.equal(how, 1, argv.join(" "));
    assert.deepEqual(effectsOf(named), [["config"], ["deployment", "/srv/nowhere"]], argv.join(" "));
    assert.deepEqual(named.errors, [`${noDeployment("/srv/nowhere")}\n`]);
    assert.deepEqual(named.stdout.written, []);
    assert.deepEqual([named.reader, named.stdin.raw, named.proc.eventNames()], [null, false, []]);
  }
});

test("w opens the switcher: ~/Agents is looked at for the folders this run does not serve and they are listed under the workspaces; r there looks again and asks for a live read", async () => {
  const r = await started({ offered: OFFERED });
  r.reader.answer(HOME_ENTRY);
  assert.deepEqual(effectsOf(r).filter(([which]) => which === "offered"), [], "a run started in a deployment does not look at ~/Agents until it is asked to");
  r.stdout.take();
  r.log.length = 0;
  // In the list of instances Enter opens the selected agent in the panel, here with a kernel record
  // that has no detach key (the viewer is given none); the leader twice gives the list back, and c
  // closes it. None of it is an effect on the file system or a read.
  r.stdin.type("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([effectsOf(r), readerDid(r)], [[], [["touch"]]]);
  assert.equal(r.panel.opens.length, 1);
  leaderTwice(r);
  r.stdin.type("c");
  r.log.length = 0;
  r.stdin.type("w");
  assert.deepEqual(effectsOf(r), [["offered", "/home/u", [DEPLOYMENT]]], "asked with the deployments the run serves, which it leaves out");
  assert.deepEqual(readerDid(r), [["touch"]], "opening the switcher reads no deployment");
  assert.notEqual(r.stdout.take(), "");
  const listed = screenOf(r);
  assert.match(listed, /^ workspaces.*> \* acme-platform\s+This machine.*On this machine, not opened.*acme-ledger\s+~\/Agents\/acme-ledger.*Enter open.*\/ filter.*r refresh.*Esc close.*\? help.*q quit/s);
  assert.doesNotMatch(listed, /acme-expert-tui|More folders/);

  // Another folder appeared, and ~/Agents now holds more than a look reads.
  r.offered = { offered: [...OFFERED.offered, { path: "/home/u/Agents/acme-ledger-archive", name: "acme-ledger-archive" }], limited: true };
  r.log.length = 0;
  r.stdin.type("r");
  assert.deepEqual(effectsOf(r), [["offered", "/home/u", [DEPLOYMENT]]]);
  assert.deepEqual(readerDid(r), [["touch"], ["request", { live: true }]]);
  assert.notEqual(r.stdout.take(), "");
  assert.match(screenOf(r), /acme-ledger\s+~\/Agents\/acme-ledger.*acme-ledger-archive\s+~\/Agents\/acme-ledger-archive.*More folders than are listed here\./s);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Enter on a folder of ~/Agents asks whether it is a deployment now; admitted, it is served from then on under the path it was admitted as, its Instances view is shown and a live read is asked for", async () => {
  // The folder is a link: what is admitted is where it leads.
  const r = await started({ offered: OFFERED, admit: () => ({ ok: true, deployment: "/srv/acme-ledger" }) });
  r.reader.answer(HOME_ENTRY);
  r.stdin.type("w");
  r.stdin.type("j"); // from the workspace that is open to the folder under it
  assert.match(screenOf(r), /\* acme-platform.*>\s+acme-ledger\s+~\/Agents\/acme-ledger/s);
  r.stdout.take();
  r.log.length = 0;
  r.stdin.type("\r");
  assert.deepEqual(effectsOf(r), [["admit", LEDGER]]);
  assert.deepEqual(r.reader.options.getServed(), [DEPLOYMENT, "/srv/acme-ledger"], "served after the one the run started in");
  assert.equal(r.reader.options.getEntry("/srv/acme-ledger").deployment.status, "pending", "not read yet");
  assert.equal(r.reader.options.getEntry(DEPLOYMENT), HOME_ENTRY, "and the first deployment is held as it was");
  assert.deepEqual(readerDid(r), [["touch"], ["request", { live: true }]], "it is read at once");
  assert.notEqual(r.stdout.take(), "");
  const opened = screenOf(r);
  assert.match(opened, /^ acme-ledger.*Instances   Souls   Capabilities.*Reading the deployment\..*C-\\ commands {3}\/ filter.*\? help.*q quit/s);
  assert.doesNotMatch(opened, /acme-expert-tui|On this machine, not opened/, "the switcher is closed, and the view is the new deployment's");
  // From then on: the reader's answer for it is taken and drawn.
  r.reader.answer(observedAt("/srv/acme-ledger", [instanceRow("acme-clerk", "acme-clerk-books")], { workspace: reportedWorkspace("git.example.com/acme-ledger/books", "aweb:acme-ledger"), name: "acme-ledger" }), "/srv/acme-ledger");
  assert.match(textOf(r.stdout.take()), /acme-clerk-books/);
  assert.match(screenOf(r), /^ acme-ledger\s+1 running.*acme-clerk-books/s);
  // And the switcher no longer offers it: the next look is told that it is served.
  r.offered = { offered: [], limited: false };
  r.log.length = 0;
  r.stdin.type("w");
  assert.deepEqual(effectsOf(r), [["offered", "/home/u", [DEPLOYMENT, "/srv/acme-ledger"]]]);
  assert.doesNotMatch(screenOf(r), /On this machine, not opened/);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Enter on a folder of ~/Agents that is no deployment any more: its row says so, and nothing else changed", async () => {
  const r = await started({ offered: OFFERED, admit: () => ({ ok: false }) });
  r.reader.answer(HOME_ENTRY);
  r.stdin.type("w");
  r.stdin.type("j");
  const before = screenOf(r);
  r.stdout.take();
  r.log.length = 0;
  r.stdin.type("\r");
  assert.deepEqual(effectsOf(r), [["admit", LEDGER]]);
  assert.deepEqual(readerDid(r), [["touch"]], "nothing is read for it");
  assert.deepEqual(r.reader.options.getServed(), [DEPLOYMENT]);
  assert.equal(r.reader.options.getEntry(LEDGER), null);
  assert.notEqual(r.stdout.take(), "");
  const after = screenOf(r);
  assert.match(after, /^ workspaces.*\* acme-platform\s+This machine.*On this machine, not opened.*>\s+acme-ledger\s+Not an OATS deployment any more\..*Enter open.*Esc close/s);
  assert.equal(words(after), words(before).replace("~/Agents/acme-ledger", "Not an OATS deployment any more."), "the switcher as it was, but for what that row says");
  // The view the switcher was opened over is still there to go back to.
  r.stdin.type("\x1b");
  r.tick(50);
  r.timers.fire();
  assert.match(screenOf(r), /^ acme-platform.*acme-expert-tui.*acme-maintainer-ops/s);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Enter on a workspace opens its view and asks for a live read", async () => {
  const r = await started({ kernel: { ok: true, cli: REMOTE_CLI } });
  r.reader.answer(HOME_ENTRY);
  r.reader.collecting();
  r.reader.roster({ envelope: rosterAnswer([onyx()]) }); // a machine that reports a workspace of its own
  r.stdin.type("w");
  const two = screenOf(r);
  assert.match(two, /\* acme-platform\s+This machine/, "the open workspace is marked");
  assert.match(two, / {2}charts\s+onyx/, "and the machine's own workspace is listed beside it, unmarked");
  // Whatever order the shared home lists them in, the filter leaves the one that is wanted.
  r.stdin.type("/");
  r.stdin.type("onyx");
  r.stdin.type("\r"); // keeps the filter
  assert.deepEqual(readerDid(r).filter(([what]) => what !== "touch" && what !== "start"), [], "Enter in the open field opens nothing");
  r.stdout.take();
  r.log.length = 0;
  r.stdin.type("\r");
  assert.deepEqual(readerDid(r), [["touch"], ["request", { live: true }]]);
  assert.deepEqual(effectsOf(r), [], "a workspace is not a folder: nothing is asked of the file system");
  assert.notEqual(r.stdout.take(), "");
  const opened = screenOf(r);
  assert.match(opened, /^ charts.*Instances   Souls   Capabilities.*read 10:00:30.*dev-east.*Enter open {3}\/ filter.*q quit/s, "the machine's view, with the time of the roster read it is drawn from");
  assert.doesNotMatch(opened, /acme-expert-tui/);
  assert.deepEqual(r.reader.options.getServed(), [DEPLOYMENT], "a machine's workspace is no deployment this run serves");
  r.stdin.type("w");
  const back = screenOf(r);
  assert.match(back, /\* charts\s+onyx/, "and it is the open one now");
  assert.match(back, / {2}acme-platform\s+This machine/);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("the roster of other machines: a read that began changes nothing on the screen, and its answer lists the machine's instances under a heading that names the machine and the time of that read", async () => {
  const r = await started({ kernel: { ok: true, cli: REMOTE_CLI } });
  assert.equal(cliReadsRemotes(REMOTE_CLI), true);
  r.reader.answer(HOME_ENTRY);
  assert.doesNotMatch(screenOf(r), /machine|garnet/, "one deployment: no heading");
  r.reader.collecting();
  assert.equal(r.stdout.take(), "");
  r.tick(15_000);
  const held = r.reader.options.getRoster();
  r.reader.roster({ envelope: rosterAnswer([garnet()]) });
  assert.notEqual(r.stdout.take(), "", "the answer is drawn when it arrives");
  assert.match(screenOf(r), /^ acme-platform\s+\+1 machine\s+2 running\s+2 stopped.*This machine.*acme-expert-tui.*acme-maintainer-ops.*garnet\s+read 10:00:45.*● dev-far.*○ dev-he…/s);
  // What the loop holds is what the shared rule made of the answer, and the reader is told it.
  const now = r.reader.options.getRoster(), made = rosterEvent(held, { envelope: rosterAnswer([garnet()]) }, "2026-10-11T10:00:45.000Z").roster;
  assert.deepEqual(now, { remote: made.remote, memory: made.memory, notes: made.notes });
  assert.deepEqual([now.remote.rosterAnswered, now.remote.remoteGroups.map((g) => g.id), [...now.memory.keys()]], [true, ["garnet:t1"], ["garnet:t1"]], "the fixture has the kernel's forms: the machine is remembered");

  // The next read throws: the machine keeps its heading, says it was not reached, and nothing of it
  // reads as stopped: each of its rows has the unknown mark and the shared label of its reason.
  r.reader.collecting();
  r.reader.roster({ thrown: "spawn EMFILE" });
  const lost = screenOf(r);
  assert.match(lost, /\+1 machine.*1 running\s+1 stopped\s+2 unknown.*This machine.*garnet\s+remembered\s+Not reached.*\? dev-far\s+garnet not reached.*\? dev-held\s+garnet not reached/s);
  assert.doesNotMatch(lost, /garnet\s+read /, "a heading that is not live carries no time");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Ctrl+Z with a roster read in flight: every read is made void before the process group is stopped, the return asks for a live read, and the answer of the read it begins is taken", async () => {
  const r = await started({ kernel: { ok: true, cli: REMOTE_CLI } });
  r.reader.answer(HOME_ENTRY);
  r.reader.collecting();
  r.stdout.take();
  r.log.length = 0;
  r.stdin.type("\x1a");
  assert.deepEqual(r.log.filter(([what]) => what !== "raw"), [["reader", "touch"], ["write", LEAVE], ["reader", "void"], ["kill", 0, "SIGTSTP"]]);
  r.log.length = 0;
  r.proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(readerDid(r), [["request", { live: true }]], "the return reads at once, and has nothing more to drop");
  // The read that was in flight answers nothing (lib/read.mjs); the one the return began does.
  r.stdout.take();
  r.reader.collecting();
  r.reader.roster({ envelope: rosterAnswer([garnet()]) });
  assert.match(screenOf(r), /\+1 machine.*garnet\s+read 10:00:30.*dev-far/s);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("what the reader gives after the run ended is dropped: an entry, the start of a roster read and its answer change nothing the loop holds, and nothing is written", async () => {
  const r = await started({ kernel: { ok: true, cli: REMOTE_CLI } });
  r.reader.answer(HOME_ENTRY);
  const held = r.reader.options.getRoster();
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  r.stdout.take();
  r.reader.answer(observedAt(DEPLOYMENT, [instanceRow("acme-expert", "acme-expert-late")]));
  r.reader.collecting();
  r.reader.roster({ envelope: rosterAnswer([garnet()]) });
  r.reader.roster({ thrown: "spawn EMFILE" });
  assert.equal(r.reader.options.getEntry(DEPLOYMENT), HOME_ENTRY);
  const now = r.reader.options.getRoster();
  for (const part of ["remote", "memory", "notes"]) assert.equal(now[part], held[part], part);
  assert.deepEqual([now.remote.rosterAnswered, now.remote.remoteGroups, now.memory.size], [false, [], 0]);
  assert.equal(r.stdout.take(), "");
  assert.deepEqual(r.errors, []);
});

test("a deployment that could not be observed says why in the shared sentence: the kernel's refusal in each of its three forms (with its message, with a message withheld, with none), and the reader's own failure as it is", async () => {
  const hostile = "a refusal with \x1b[2J in it";
  const cases = [
    [{ code: "E_NEW_CODE", message: "the workspace is locked", origin: "kernel" }, "OATS answered with an error (E_NEW_CODE). It says: the workspace is locked"],
    [{ code: "E_NEW_CODE", message: hostile, origin: "kernel" }, `OATS answered with an error (E_NEW_CODE). ${DETAIL_WITHHELD}`],
    [{ code: "E_NEW_CODE", message: "", origin: "kernel" }, "OATS answered with an error (E_NEW_CODE)."],
    // Without the reader's mark the reason is one the reader made itself: no speaker is named.
    [{ code: "E_NEW_CODE", message: "the workspace is locked" }, "E_NEW_CODE: the workspace is locked"],
  ];
  for (const [reason, sentence] of cases) {
    const entry = failed(null, reason), label = JSON.stringify(reason);
    assert.equal(sharedReason(entry), sentence, `the shared home's sentence for ${label}`);
    const r = await started();
    r.stdout.take();
    r.reader.answer(entry);
    assert.notEqual(r.stdout.take(), "", label);
    const text = screenOf(r);
    assert.equal(text.split(sentence).length, 2, `drawn once, whole: ${label}`);
    assert.match(text, /not observed/, label);
    assert.equal(/It says:/.test(text), sentence.includes("It says:"), `a message that is withheld or absent is not introduced: ${label}`);
    assert.equal(text.includes(DETAIL_WITHHELD), sentence.includes(DETAIL_WITHHELD), label);
    assert.doesNotMatch(text, /Reading the deployment/, label);
    r.stdin.type("q");
    assert.equal(await r.status, 0);
    const all = readTerminalOutput(written(r));
    assert.deepEqual(all.foreign, [], label);
    assert.doesNotMatch(all.text, CONTROL, label);
  }
  // The hand-made reason of this file, unmarked and with the kernel's message withheld by the TUI's own filter.
  const unmarked = failed(null, { code: "E_NEW_CODE", message: hostile });
  assert.doesNotMatch(textShown(shown(hostile)), CONTROL, "the TUI's own filter leaves no control character of the message as it came");
  const r = await started();
  r.reader.answer(unmarked);
  const text = screenOf(r);
  assert.match(text, /not observed/);
  assert.doesNotMatch(text, /2J in it|OATS answered/);
  assert.doesNotMatch(text, CONTROL);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.deepEqual(readTerminalOutput(written(r)).foreign, []);
});

// ── Opening an agent's terminal: the panel (T1) ───────────────────────────────────────────────────

/** A kernel record that opens agents here and on other machines. It lists no detach key: the
 *  viewer is given none. */
const KEYED = cliRecord({ version: CLI.version, workspaceApi: CLI.workspaceApi, features: [...CLI.features], remote: ["roster", "session"] }, { bin: CLI.bin, source: "tui" });
/** The agents' socket the kernel records for this machine's rows: the TUI names it nowhere. */
const AGENTS_SOCKET = "/tmp/oats-tmux-1000/agents";
const OPEN_ENTRY = observedAt(DEPLOYMENT, [instanceRow("acme-expert", "acme-expert-tui", { tmux: { session: "oats-agents", window: "acme-expert-tui", socket: AGENTS_SOCKET } })]);
const KEY_CONFIG = { ok: true, actions: ACTIONS, ascii: false, detachKey: "C-\\" };
/** A run on a deployment whose one agent runs. */
async function opening(options = {}) {
  const r = await started({ kernel: { ok: true, cli: KEYED }, config: KEY_CONFIG, ...options });
  r.reader.answer(OPEN_ENTRY);
  r.stdout.take();
  r.log.length = 0;
  return r;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const HOME = `${DEPLOYMENT}/agents/acme-expert/instances/acme-expert-tui`;
/** What the loop asked of the panel since the log was last emptied. */
const panelDid = (r) => r.log.filter(([what]) => what === "panel").map(([, ...rest]) => rest);
/** The whole screen as the run draws it now, by a way that types nothing into a terminal that has
 *  the focus: a resize to the same size redraws in full. */
function wholeScreen(r) {
  r.stdout.take();
  r.stdout.resize(r.stdout.columns, r.stdout.rows);
  return textOf(r.stdout.take());
}
/** The leader typed twice, each in a read of its own, as a person types it: from the terminal's
 *  focus the first is the back key the scanner finds in the bytes, and the second the TUI reads as
 *  its own key; the focus goes to the list (docs/tui.md, "The leader"). */
function leaderTwice(r) {
  r.stdin.type("\x1c");
  r.stdin.type("\x1c");
}
/** A run with the agent's terminal open in the panel (window `@1`), the focus in it. */
async function viewing(options) {
  const r = await opening(options);
  r.stdin.type("\r");
  await settle();
  r.panel.opens[0].made("@1");
  await settle();
  r.log.length = 0;
  return r;
}

test("Enter on a running agent of this machine: the kernel's viewer starts in the panel beside the list, at the panel's size, with the shared home's arguments and no key; the TUI keeps its terminal and its reads, and the footer names the back key", async () => {
  const r = await opening();
  r.stdin.type("\r");
  await settle();
  const [asked] = r.panel.opens;
  assert.deepEqual(asked.argv, [process.execPath, KEYED.bin, ...sessionAttachArgv(KEYED, { home: HOME })], "node, the kernel's own binary, the shared home's arguments");
  assert.equal(asked.argv.includes("--detach-key"), false);
  assert.deepEqual([asked.cols, asked.rows], [49, 19], "80 columns: the 30 columns the list keeps beside a terminal, its bar, and 49 to the right edge; the body's rows but the title");
  assert.deepEqual(r.log.filter(([what, which]) => (what === "write" && (which === LEAVE || which === ENTER)) || what === "raw" || (what === "reader" && ["void", "hold"].includes(which))), [], "nothing is lent: no leave, no cooked mode, no read made void");
  assert.equal(r.stdin.paused, false);
  asked.made("@1");
  await settle();
  r.panel.screen("@1", "$ marker-of-the-agent", { x: 2, y: 0, visible: true }, { cols: 49, rows: 19 });
  const screen = wholeScreen(r);
  assert.match(screen, /acme-expert-tui[\s\S]*marker-of-the-agent/, "the list and the agent's screen");
  assert.match(screen, /C-\\ commands {3}C-\\ C-\\ back to the list/);
  // A capture of a window that is not the open one is not drawn.
  r.stdout.take();
  r.panel.screen("@9", "$ not-this-one");
  assert.doesNotMatch(r.stdout.take(), /not-this-one/);
  leaderTwice(r);
  assert.match(wholeScreen(r), /C-\\ commands {3}Enter focus terminal {3}z zoom {3}\/ filter/);
  r.log.length = 0;
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  const order = r.log.filter(([what, which]) => (what === "panel" && which === "end") || (what === "reader" && which === "stop")).map(([what]) => what);
  assert.deepEqual(order, ["panel", "reader"], "the private server is ended on the way out, before the reads");
});

test("while the terminal has the focus every byte but the leader goes to the agent as typed, q, Ctrl+C, Ctrl+Z, Ctrl+L, Esc and ? among them, and a bracketed paste goes as a paste; what comes in the leader's own read is nobody's and cancels it, and the leader then a key in a later read is the TUI's", async () => {
  const r = await viewing();
  r.stdin.type("q\x03\x1a\x0c\x1b?");
  r.stdin.type("\x1b[200~one\x1ctwo\x1b[201~");
  assert.deepEqual(panelDid(r), [["input", "q\x03\x1a\x0c\x1b?"], ["paste", "one\x1ctwo"]]);
  r.log.length = 0;
  let over = false;
  r.status.then(() => { over = true; });
  // The leader with keys after it in one read (a paste, with bracketed paste off): the bytes before
  // it are the agent's, the ones after it are dropped, and the leader waits for nothing.
  r.stdin.type("ab\x1c?");
  r.stdin.type("x");
  await settle();
  assert.deepEqual(panelDid(r).filter(([what]) => what === "input"), [["input", "ab"], ["input", "x"]], "the ? was dropped, and the next key is the agent's again");
  assert.doesNotMatch(wholeScreen(r), /Keys/, "nothing opened the help");
  r.log.length = 0;
  r.stdin.type("\x1c");
  r.stdin.type("?");
  await settle();
  assert.deepEqual(panelDid(r).filter(([what]) => what === "input"), [], "the leader and its key are not the agent's");
  assert.equal(over, false, "a view that draws no terminal (the help) leaves the panel hidden, and the run goes on");
  assert.match(wholeScreen(r), /Keys/, "the leader then ? opened the help");
  r.stdin.type("\x1b");
  r.tick(50);
  r.timers.fire();
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

// ── The leader and the palette from a terminal's focus (Spec T1b): the leader is the one key the
// TUI takes from the agent, and what follows it in a later read is the TUI's.
const LEDGER_HOME = `${DEPLOYMENT}/agents/acme-ledger/instances/acme-ledger-dev`;
const TWO_ENTRY = observedAt(DEPLOYMENT, [
  instanceRow("acme-expert", "acme-expert-tui", { tmux: { session: "oats-agents", window: "acme-expert-tui", socket: AGENTS_SOCKET } }),
  instanceRow("acme-ledger", "acme-ledger-dev", { tmux: { session: "oats-agents", window: "acme-ledger-dev", socket: AGENTS_SOCKET } }),
]);
/** A run with two running agents of this machine, the first one's terminal open with the focus in it. */
async function viewingFirstOfTwo() {
  const r = await started({ kernel: { ok: true, cli: KEYED }, config: KEY_CONFIG });
  r.reader.answer(TWO_ENTRY);
  r.stdout.take();
  r.stdin.type("\r");
  await settle();
  assert.deepEqual(r.panel.opens[0].argv, [process.execPath, KEYED.bin, ...sessionAttachArgv(KEYED, { home: HOME })], "the first agent's terminal");
  r.panel.opens[0].made("@1");
  await settle();
  r.log.length = 0;
  return r;
}

test("with a terminal focused, the leader, k, a few letters and Enter, each in a read of its own, open the palette, find the other agent and open it as a tab of its own, the focus in the new terminal: no byte of it reaches the agent (Spec T1b; T2)", async () => {
  const r = await viewingFirstOfTwo();
  r.stdin.type("\x1c");
  r.stdin.type("k");
  assert.match(wholeScreen(r), /acme-expert-tui +instance[\s\S]*acme-ledger-dev +instance/, "the palette, the agents first");
  r.stdin.type("ledg");
  const found = wholeScreen(r);
  assert.match(found, /> ledg/);
  assert.match(found, /acme-ledger-dev +instance/);
  assert.doesNotMatch(found, /acme-expert-tui +instance/, "the query keeps the one it matches");
  r.stdin.type("\r");
  await settle();
  assert.deepEqual(panelDid(r).filter(([what]) => what === "input" || what === "paste"), [], "nothing typed reached the agent");
  assert.deepEqual(panelDid(r).filter(([what]) => what === "close" || what === "open").map(([what]) => what), ["open"], "a tab of its own: the open one stays (T2)");
  assert.deepEqual(r.panel.opens[1].argv, [process.execPath, KEYED.bin, ...sessionAttachArgv(KEYED, { home: LEDGER_HOME })], "the chosen agent's terminal");
  r.panel.opens[1].made("@2");
  await settle();
  r.log.length = 0;
  r.stdin.type("typed");
  assert.deepEqual(panelDid(r).filter(([what]) => what === "input"), [["input", "typed"]], "the focus is in the new terminal");
  leaderTwice(r);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

/** The first of two agents viewed, then the second opened beside it with the leader then Down:
 *  `@1` is hidden and `@2` shown, the focus in it. */
async function viewingTwoTabs(options = {}) {
  const r = await started({ kernel: { ok: true, cli: KEYED }, config: KEY_CONFIG, ...options });
  r.reader.answer(TWO_ENTRY);
  r.stdin.type("\r");
  await settle();
  r.panel.opens[0].made("@1");
  await settle();
  r.stdin.type("\x1c");
  r.stdin.type("\x1b[B");
  await settle();
  r.panel.opens[1].made("@2");
  await settle();
  r.log.length = 0;
  return r;
}

test("a hidden tab's output marks it on the strip and draws nothing of its screen; the shown tab's screen is drawn (T2)", async () => {
  const r = await viewingTwoTabs();
  assert.match(wholeScreen(r), /│ acme-expert-tui {2}acme-ledger-dev/, "the strip: both tabs, no mark");
  r.panel.activity("@1");
  r.panel.screen("@1", "hidden words");
  await settle();
  const marked = wholeScreen(r);
  assert.match(marked, /│ acme-expert-tui\u2022 {2}acme-ledger-dev/, "the hidden tab is marked");
  assert.doesNotMatch(marked, /hidden words/, "a hidden tab's screen is not drawn");
  r.panel.activity("@2");
  r.panel.screen("@2", "shown words");
  await settle();
  const shown = wholeScreen(r);
  assert.match(shown, /shown words/);
  assert.match(shown, /│ acme-expert-tui\u2022 {2}acme-ledger-dev(?!\u2022)/, "the shown tab is never marked");
  leaderTwice(r);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("on the last tab the leader then Right does nothing: the terminal keeps the focus, and q then reaches the agent (T2, round 1 of the review)", async () => {
  const r = await viewingTwoTabs();
  r.stdin.type("\x1c");
  r.stdin.type("\x1b[C");
  await settle();
  r.stdin.type("q");
  assert.deepEqual(panelDid(r).filter(([what]) => what !== "refresh" && what !== "visible" && what !== "resize"), [["input", "q"]]);
  leaderTwice(r);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("with two tabs open, another workspace opened closes each tab's viewer by its window id, and no terminal is left (T2)", async () => {
  const r = await viewingTwoTabs({ offered: OFFERED, admit: () => ({ ok: true, deployment: "/srv/acme-ledger" }) });
  leaderTwice(r);
  r.stdin.type("w");
  r.stdin.type("j");
  r.log.length = 0;
  r.stdin.type("\r");
  await settle();
  assert.deepEqual(effectsOf(r), [["admit", LEDGER]]);
  assert.deepEqual(panelDid(r).filter(([what]) => what === "close"), [["close", "@1"], ["close", "@2"]]);
  r.log.length = 0;
  r.stdin.type("typed");
  assert.deepEqual(panelDid(r).filter(([what]) => what === "input"), [], "no terminal has the focus");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("with a terminal focused, the leader then Down opens the next agent's terminal as a tab with the focus in it, and then Up shows the one before, a tab already; nothing reaches the agent (Spec T1b; T2)", async () => {
  const r = await viewingFirstOfTwo();
  r.stdin.type("\x1c");
  r.stdin.type("\x1b[B");
  await settle();
  assert.deepEqual(panelDid(r).filter(([what]) => what === "input" || what === "paste"), []);
  assert.deepEqual(r.panel.opens[1].argv, [process.execPath, KEYED.bin, ...sessionAttachArgv(KEYED, { home: LEDGER_HOME })], "the next agent");
  r.panel.opens[1].made("@2");
  await settle();
  r.log.length = 0;
  r.stdin.type("\x1c");
  r.stdin.type("\x1b[A");
  await settle();
  assert.deepEqual(panelDid(r).filter(([what]) => what === "open" || what === "show"), [["show", "@1"]], "the agent before is a tab: shown, not opened again");
  // At the first agent, Up again goes nowhere: no wrap.
  r.log.length = 0;
  r.stdin.type("\x1c");
  r.stdin.type("\x1b[A");
  await settle();
  assert.deepEqual(panelDid(r).filter(([what]) => what === "open" || what === "close" || what === "input"), [], "no wrap, and nothing typed");
  leaderTwice(r);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("a paste that holds the leader's byte and a command key runs nothing: with bracketed paste off, the bytes before the leader are the agent's and the rest of that read is dropped; inside a bracketed paste the byte is pasted text; in the list, the leader and a key in one read open nothing (Spec T1b)", async () => {
  const r = await viewingFirstOfTwo();
  for (const pasted of ["x\x1cX", "x\x1ck", "x\x1c\x1c", "x\x1cw"]) {
    r.log.length = 0;
    r.stdin.type(pasted);
    await settle();
    assert.deepEqual(panelDid(r).filter(([what]) => what !== "visible" && what !== "refresh"), [["input", "x"]], `${JSON.stringify(pasted)}: the x alone, nothing closed or opened`);
    r.log.length = 0;
    r.stdin.type("y");
    assert.deepEqual(panelDid(r), [["input", "y"]], `${JSON.stringify(pasted)}: the leader was cancelled, and the terminal keeps the focus`);
  }
  r.log.length = 0;
  r.stdin.type("\x1b[200~\x1cX\x1b[201~");
  assert.deepEqual(panelDid(r), [["paste", "\x1cX"]], "a bracketed paste goes to the agent as a paste, its leader byte with it");
  assert.doesNotMatch(wholeScreen(r), /Cancel| instance\b/, "no confirmation and no palette");
  leaderTwice(r);
  // In the list's focus: the leader with k, or X, in the same read opens nothing.
  for (const pasted of ["\x1ck", "\x1cX", "\x1c?"]) {
    r.stdin.type(pasted);
    assert.doesNotMatch(wholeScreen(r), /Cancel|Keys| instance\b/, JSON.stringify(pasted));
  }
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("keys that came in one chunk with the Enter that opened the terminal are dropped: neither the list nor the agent has them (round 1 of PR 4's review, kept)", async () => {
  for (const behind of ["q", "\x03", "?", "w", "\x1b"]) {
    const r = await opening();
    let over = false;
    r.status.then(() => { over = true; });
    r.stdin.type(`\r${behind}`);
    r.tick(50);
    r.timers.fire();
    await settle();
    assert.equal(r.panel.opens.length, 1, JSON.stringify(behind));
    assert.equal(over, false, `${JSON.stringify(behind)}: the run goes on`);
    assert.deepEqual(panelDid(r).filter(([what]) => what === "input" || what === "close"), [], `${JSON.stringify(behind)}: nothing typed, nothing closed`);
    const screen = wholeScreen(r);
    assert.doesNotMatch(screen, /^ workspaces|Keys/, `${JSON.stringify(behind)}: no other view was opened`);
    assert.match(screen, /C-\\ commands {3}C-\\ C-\\ back to the list/, JSON.stringify(behind));
    leaderTwice(r);
    r.stdin.type("q");
    assert.equal(await r.status, 0, JSON.stringify(behind));
  }
});

test("a viewer that ends on its own closes the terminal: the line says what it printed, a live read is asked, and it is never opened again on its own; one the person closed says nothing", async () => {
  const r = await viewing();
  r.panel.closed("@1", 1, "can't find session: acme-expert-tui\n");
  await settle();
  const screen = wholeScreen(r);
  assert.match(screen, /acme-expert-tui could not be opened\.[\s\S]*"can't find session: acme-expert-tui"/);
  assert.doesNotMatch(screen, /back to the list/);
  assert.deepEqual(readerDid(r).filter(([what]) => what === "request"), [["request", { live: true }]]);
  r.tick(60_000);
  r.timers.fire();
  await settle();
  assert.equal(r.panel.opens.length, 1, "not reopened");
  // Enter opens it again; c closes it, and its end, reported later, says nothing.
  r.stdin.type("\r");
  await settle();
  r.panel.opens[1].made("@2");
  await settle();
  leaderTwice(r);
  r.log.length = 0;
  r.stdin.type("c");
  assert.deepEqual(panelDid(r).filter(([what]) => what === "close"), [["close", "@2"]], "the shown tab, by its window");
  r.panel.closed("@2", null, "", true);
  await settle();
  assert.doesNotMatch(wholeScreen(r), /could not|ended|back to the list|focus terminal/);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("no argument the TUI hands the panel is tmux or the agents' socket: the panel runs the kernel's viewer, and the viewer reaches the agent", async () => {
  const r = await opening();
  r.stdin.type("\r");
  await settle();
  for (const arg of r.panel.opens[0].argv) {
    assert.equal(/(^|\/)tmux$/.test(arg), false, arg);
    assert.equal(arg.includes(AGENTS_SOCKET), false, arg);
  }
  leaderTwice(r);
  r.stdin.type("q");
  await r.status;
});

test("the panel is told what the frame gives the terminal: zoom and back resize its window, Tab hides it and shows it again, a resize of the terminal resizes it, and under 80 columns the list's focus hides it", async () => {
  const r = await viewing();
  leaderTwice(r);
  r.log.length = 0;
  r.stdin.type("z");
  assert.deepEqual(panelDid(r), [["resize", 80, 19]], "zoomed: the whole body");
  r.log.length = 0;
  leaderTwice(r);
  assert.deepEqual(panelDid(r), [["resize", 49, 19]]);
  r.log.length = 0;
  r.stdin.type("\t");
  assert.deepEqual(panelDid(r), [["visible", false]], "the detail in the terminal's place: no capture runs");
  r.log.length = 0;
  r.stdin.type("\t");
  assert.deepEqual(panelDid(r), [["visible", true]], "shown again: one fresh capture (the panel's)");
  r.log.length = 0;
  r.stdout.resize(120, 40);
  assert.deepEqual(panelDid(r), [["resize", 89, 35]], "120 columns: the list keeps 30 beside the terminal");
  r.log.length = 0;
  r.stdout.resize(70, 30);
  assert.deepEqual(panelDid(r), [["visible", false]], "under 80 columns, the list alone");
  r.log.length = 0;
  r.stdin.type("\r");
  assert.deepEqual(panelDid(r), [["visible", true], ["resize", 70, 25]], "Enter: the terminal, zoomed");
  leaderTwice(r);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("the panel is told the size and the sight its new window needs: a resize while the window was being made reaches it once the window exists, and a terminal closed hidden leaves the next one shown", async () => {
  const r = await opening();
  r.stdin.type("\r");
  await settle();
  r.stdout.resize(120, 40);
  r.log.length = 0;
  r.panel.opens[0].made("@1");
  await settle();
  assert.deepEqual(panelDid(r).filter(([what]) => what === "resize"), [["resize", 89, 35]], "the size the frame gives now, once the window exists");
  // Closed behind the detail: the next open shows its window again.
  leaderTwice(r);
  r.stdin.type("\t");
  r.stdin.type("c");
  assert.deepEqual(panelDid(r).filter(([what]) => what === "visible" || what === "close"), [["visible", false], ["close", "@1"]]);
  r.stdin.type("\t");
  r.log.length = 0;
  r.stdin.type("\r");
  await settle();
  assert.deepEqual(panelDid(r).filter(([what]) => what === "visible" || what === "open").map(([what, more]) => (what === "open" ? what : [what, more])), [["visible", true], "open"]);
  leaderTwice(r);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("SIGTERM with a terminal open ends the run at once with 143, the private server ended on the way out; a stop from the list pauses the panel and the return resumes it", async () => {
  const r = await viewing();
  leaderTwice(r);
  r.log.length = 0;
  r.stdin.type("\x1a");
  assert.deepEqual(panelDid(r), [["pause"]]);
  r.log.length = 0;
  r.proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(panelDid(r).slice(0, 1), [["resume"]]);
  r.stdin.type("\r");
  r.log.length = 0;
  r.proc.emit("SIGTERM", "SIGTERM");
  assert.equal(await r.status, 143);
  assert.deepEqual(panelDid(r), [["end"]]);
  assert.equal(r.timers.delays().length === 0 || !r.timers.delays().some((ms) => ms > 1000), true, "no grace: nothing is waited for");
});

test("the sweep runs once a run, after the first frame, with the run's environment; the run directory is made only when something needs it, and removed on the way out after the panel and the reader", async () => {
  const r = run({ kernel: { ok: true, cli: KEYED }, config: KEY_CONFIG });
  await r.up;
  assert.deepEqual(r.log.filter(([what]) => what === "panel").map(([, ...rest]) => rest), [["sweep", true]]);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.log.some(([what, which]) => what === "panel" && (which === "dir" || which === "remove")), false, "never made: nothing to remove");
  // A run whose panel asked for the directory removes it last.
  const s = await viewing();
  r.log.length = 0;
  s.panel.options.dir();
  s.log.length = 0;
  leaderTwice(s);
  s.stdin.type("q");
  assert.equal(await s.status, 0);
  assert.deepEqual(s.log.filter(([what, which]) => (what === "panel" && (which === "end" || which === "remove")) || (what === "reader" && which === "stop")).map(([what, which, more]) => [what, which, ...(more ? [more] : [])]), [["panel", "end"], ["reader", "stop"], ["panel", "remove", "/tmp/oats-tui-fixture"]]);
});

test("a panel that cannot start a viewer says so in the TUI's words: no tmux, or one too old, is named; another refusal is a failed open with tmux's words under it", async () => {
  const r = await opening();
  r.stdin.type("\r");
  await settle();
  r.panel.opens[0].refuse(Object.assign(new Error("tmux is not installed"), { code: "E_PANEL_TMUX" }));
  await settle();
  assert.match(wholeScreen(r), /acme-expert-tui could not be opened: the terminal panel needs tmux 3\.2 or later on this machine\./);
  r.stdin.type("\r");
  await settle();
  r.panel.opens[1].refuse(Object.assign(new Error("the panel's tmux server did not start"), { code: "E_PANEL_START", detail: "error connecting to /tmp/x/tmux (File name too long)" }));
  await settle();
  assert.match(words(wholeScreen(r)), /acme-expert-tui could not be opened\.[\s\S]*"error connecting to \/tmp\/x\/tmux \(File name too long\)"/);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

/** The fixture's deployment and garnet, with garnet's row selected. */
async function elsewhere(options = {}) {
  const r = await started({ kernel: { ok: true, cli: KEYED }, config: KEY_CONFIG, ...options });
  r.reader.answer(HOME_ENTRY);
  r.reader.roster({ envelope: rosterAnswer([garnet()]) });
  for (let i = 0; i < 6 && !/> +\S+ dev-far/.test(screenOf(r)); i++) r.stdin.type("j");
  assert.match(screenOf(r), /> +\S+ dev-far/, "garnet's running row is selected");
  r.stdout.take();
  r.log.length = 0;
  return r;
}

test("Enter on a running agent of another machine: the shared preflight over the reader's exec, with a signal and no key; what it prepared starts in the panel; a link that ends is said; a failure is said and nothing starts", async () => {
  const r = await elsewhere();
  r.stdin.type("\r");
  await settle();
  const [asked] = r.preflights;
  assert.deepEqual([asked.cli, asked.target, asked.options.exec, "detachKey" in asked.options, asked.options.signal.aborted], [KEYED, { serverId: "garnet", instance: "dev-far", home: "/srv/acme-platform/agents/dev/instances/dev-far" }, r.reader.exec, false, false]);
  assert.match(screenOf(r), /Esc stop opening/);
  r.stdin.type("\r");
  await settle();
  assert.equal(r.preflights.length, 1, "a second Enter does nothing");
  asked.resolve({ binary: KEYED.bin, args: ["session", "attach", "--server", "garnet", "--home", asked.target.home] });
  await settle();
  assert.deepEqual(r.panel.opens.map((o) => o.argv.slice(0, 6)), [[process.execPath, KEYED.bin, "session", "attach", "--server", "garnet"]]);
  r.panel.opens[0].made("@1");
  await settle();
  r.panel.closed("@1", 255, "Connection to garnet.example closed by remote host.\n");
  await settle();
  assert.match(wholeScreen(r), /The connection to garnet ended\.[\s\S]*"Connection to garnet\.example closed by remote host\."/);

  r.stdin.type("\r");
  await settle();
  r.preflights[1].reject(Object.assign(new Error("remote session inspection timed out"), { code: "E_TERM_PREPARE_TIMEOUT" }));
  await settle();
  assert.equal(r.panel.opens.length, 1, "nothing starts");
  assert.match(textOf(r.stdout.take()), /Terminal preparation timed out\./);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Esc during a preflight gives it up through its signal, and what it answers afterwards is dropped; a suspend gives it up first, with nothing said", async () => {
  const r = await elsewhere();
  r.stdin.type("\r");
  await settle();
  r.stdin.type("\x1b");
  r.tick(50); // the parser's wait for what may follow ESC
  r.timers.fire();
  await settle();
  assert.equal(r.preflights[0].options.signal.aborted, true);
  r.preflights[0].resolve({ binary: KEYED.bin, args: [] });
  await settle();
  assert.deepEqual(r.panel.opens, [], "given up: nothing starts");
  assert.doesNotMatch(screenOf(r), /Esc stop opening/);

  r.stdin.type("\r");
  await settle();
  r.log.length = 0;
  r.stdin.type("\x1a"); // Ctrl+Z
  assert.equal(r.preflights[1].options.signal.aborted, true, "aborted before the reads are dropped and the process stops");
  assert.deepEqual(r.log.filter(([what, which]) => what === "reader" && which === "void" || what === "kill").map(([what]) => what), ["reader", "kill"]);
  r.proc.emit("SIGCONT", "SIGCONT");
  const failure = Object.assign(new Error("Terminal context changed"), { code: "E_TERM_CONTEXT_CHANGED" });
  r.preflights[1].reject(failure);
  await settle();
  const screen = screenOf(r);
  assert.doesNotMatch(screen, /Esc stop opening|could not|timed out/, "nothing is said");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

// ── The acts (awebai/oats#855, PR 5): what the loop does with the store's effects ─────────────────

/** A kernel record that plans stops and retires and starts sessions. */
const ACTS_CLI = Object.freeze({ ...CLI, lifecycleApi: 1, features: Object.freeze([...CLI.features, "lifecycle-plans", "retire-retention", "retire-home", "session-start", "session-restart"]) });
/** A confirmation of the shared home's shape, already in review with `offers`: what it was asked, in order. */
function reviewing(offers = ["apply", "refresh", "close"]) {
  return (options) => {
    const made = {
      options, calls: [], closed: 0,
      state: () => ({ phase: "review", outcome: null, notice: null, offers, running: null }),
      view: () => ({ question: `Stop ${options.target.instance}?`, happening: [], state: { rows: [], notes: [] }, warning: null, choices: [], notice: null }),
      apply() { made.calls.push("apply"); }, refresh() { made.calls.push("refresh"); }, checkAgain() { made.calls.push("check-again"); },
      setChoice(...args) { made.calls.push(["setChoice", ...args]); }, close() { made.closed++; },
    };
    options.onChange(); // told inside the constructor, as the shared one tells it
    return made;
  };
}
/** A run of the fixture's deployment with its first agent (running) selected and the acts readable. */
async function acting(options = {}) {
  const r = await started({ kernel: { ok: true, cli: ACTS_CLI }, confirm: reviewing(), ...options });
  r.reader.answer(ENTRY);
  await settle();
  return r;
}

test("keys that came in one read with the key that opened a confirmation never press its act: X⏎ and Xl⏎ and Dl⏎ cancel, X⇥⏎ and D⇥⏎ review again, X⇥⇥⏎ is ignored; Enter in a read of its own presses it (Done 2)", async () => {
  for (const [typed, calls, closed, verb] of [["X\r", [], 1, "stop"], ["Xl\r", [], 1, "stop"], ["Dl\r", [], 1, "retire"], ["X\t\r", ["refresh"], 0, "stop"], ["D\t\r", ["refresh"], 0, "retire"], ["X\t\t\r", [], 0, "stop"]]) {
    const r = await acting();
    r.stdin.type(typed);
    await settle();
    const [made] = r.confirmations;
    assert.equal(r.confirmations.length, 1, JSON.stringify(typed));
    assert.deepEqual([made.options.operation, made.options.target.instance, made.calls, made.closed], [verb, "acme-expert-tui", calls, closed], JSON.stringify(typed));
    if (typed === "X\t\t\r") {
      r.stdin.type("\r");
      assert.deepEqual(made.calls, ["apply"], "Enter in a read of its own presses the act");
    }
    r.stdin.type("q");
    assert.equal(await r.status, 0, JSON.stringify(typed));
    assert.equal(made.closed, 1, "closed once: by Cancel, or on the way out");
  }
});

test("Esc closes the open confirmation, and what it tells afterwards changes nothing on the screen; a settled answer asks for one live read", async () => {
  const r = await acting();
  r.stdin.type("X");
  const [made] = r.confirmations;
  assert.match(screenOf(r), /Stop acme-expert-tui\?/);
  r.stdin.type("\x1b");
  r.tick(50);
  r.timers.fire();
  await settle();
  assert.equal(made.closed, 1);
  const after = screenOf(r);
  assert.doesNotMatch(after, /Stop acme-expert-tui\?/);
  r.stdout.take();
  made.options.onChange();
  assert.equal(r.stdout.take(), "", "told after close: nothing drawn");
  const before = readerDid(r).filter(([what]) => what === "request").length;
  made.options.onSettled();
  assert.deepEqual(readerDid(r).filter(([what]) => what === "request").slice(before), [["request", { live: true }]]);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("the shared boundary runs a plan read through the reader's exec as a read, and the apply through its changeExec as a change of this run labelled with the act and the agent", async () => {
  const r = await started({ kernel: { ok: true, cli: ACTS_CLI } });
  r.reader.answer(ENTRY);
  await settle();
  const home = `${DEPLOYMENT}/agents/acme-expert/instances/acme-expert-tui`, plan = { lifecycleApi: 1, action: "stop", instance: "acme-expert-tui", home, recursive: true, at: "2026-10-11T10:00:00Z", planRevision: "a".repeat(24), notes: [], skipped: [], ambiguous: [],
    targets: [{ instance: "acme-expert-tui", agent: "acme-expert", agentsRoot: `${DEPLOYMENT}/agents`, home, depth: 0, session: lifecycleSession(), work: lifecycleWork(), workMode: "worktree", launched: true, retiring: false, stopPending: false, midTask: false }] };
  const reads = [];
  r.reader.exec = (bin, argv, options, callback) => { reads.push({ argv: [...argv], options }); setImmediate(() => callback(null, JSON.stringify({ schemaVersion: 1, ok: true, result: plan }), "")); return { pid: 3000 }; };
  r.stdin.type("X");
  await settle(); await settle();
  assert.equal(reads.length, 1, "the plan read");
  assert.deepEqual(reads[0].argv.slice(0, 4), ["instance", "stop", "acme-expert-tui", "--plan"]);
  assert.equal(reads[0].options.detached, undefined, "a read: no session of its own");
  assert.match(screenOf(r), /Stop acme-expert-tui\?/);
  r.stdin.type("\t");
  r.stdin.type("\t");
  r.stdin.type("\r");
  await settle();
  const [change] = r.reader.changed;
  assert.ok(change, "the apply ran as a change");
  assert.deepEqual([change.argv.slice(0, 4), change.options.label], [["instance", "stop", "acme-expert-tui", "--apply"], { verb: "stop", name: "acme-expert-tui" }]);
  assert.equal(change.options.detached, undefined, "changeExec is always a session of its own: the mark is not passed on");
  const at = (flag) => change.argv[change.argv.indexOf(flag) + 1];
  const receipt = { lifecycleApi: 1, action: "stop", instance: "acme-expert-tui", home, planRevision: at("--plan-revision"), idempotencyKey: at("--idempotency-key"), at: "2026-10-11T10:01:00Z", replayed: false, ok: true,
    retained: ["home", "work", "transcript", "launch"], results: [{ instance: "acme-expert-tui", home, ok: true, stopped: true, alreadyIdle: false, state: "stopped" }] };
  const before = readerDid(r).filter(([what]) => what === "request").length;
  change.callback(null, JSON.stringify({ schemaVersion: 1, ok: true, result: receipt }), "");
  await settle(); await settle();
  assert.deepEqual(readerDid(r).filter(([what]) => what === "request").slice(before), [["request", { live: true }]], "settled: one live read");
  assert.match(screenOf(r), /\[ Close \]|> Close </);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("a start runs the shared start rule once, over a change of this run: while its child runs the row opens no act, and its answer is said and asks for a live read", async () => {
  let answer;
  const r = await acting({ start: (cli, row, choices, options) => new Promise((resolve) => { answer = resolve; options.exec("/opt/oats/bin/oats.mjs", ["session", "start"], { timeout: 0, detached: true }, () => {}); }) });
  r.stdin.type("j");
  r.stdin.type("S");
  assert.match(screenOf(r), /Start acme-maintainer-ops\?/);
  r.stdin.type("\t");
  r.stdin.type("\r");
  await settle();
  assert.equal(r.starts.length, 1);
  const [cli, row, choices, options] = r.starts[0];
  assert.deepEqual([cli, row.instance, choices, options.restart, options.localCwd], [ACTS_CLI, "acme-maintainer-ops", {}, false, DEPLOYMENT]);
  assert.deepEqual(r.reader.changed[0].options.label, { verb: "start", name: "acme-maintainer-ops" });
  assert.match(screenOf(r), /Starting acme-maintainer-ops/);
  r.stdin.type("\x1b"); r.tick(50); r.timers.fire(); await settle();
  r.stdout.take();
  r.stdin.type("X");
  assert.match(textOf(r.stdout.take()), /The start of acme-maintainer-ops is still running\./, "the line, until the next key");
  const before = readerDid(r).filter(([what]) => what === "request").length;
  r.reader.changed[0].callback(null, "", "");
  answer({ ok: true, result: { started: true } });
  await settle(); await settle();
  assert.deepEqual(readerDid(r).filter(([what]) => what === "request").slice(before), [["request", { live: true }], ["request", { live: true }]], "the child's close and the answer: each asks");
  r.stdin.type("X");
  assert.equal(r.confirmations.length, 1, "the row opens its acts again");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("a change still running when the run ends is named after the screen is left, only to a terminal or a file; the status never depends on it", async () => {
  for (const [tell, lines] of [[true, ["oats: the stop of acme-expert-tui is still running; `oats status` shows its result.\n"]], [false, []]]) {
    const r = await acting({ tellable: () => tell });
    r.reader.running = [{ pid: 4242, label: { verb: "stop", name: "acme-expert-tui" } }];
    r.stdin.type("q");
    assert.equal(await r.status, 0, String(tell));
    assert.deepEqual(r.errors, lines, String(tell));
  }
});

// ── The Souls view's catalog (docs/tui.md, "The Souls view"; Spec 6-view, Done 1 and 4) ──────────

/** `oats souls --json` answering `names`, as the kernel prints it. */
const soulsDocument = (names) => ({ ok: true, document: { schemaVersion: 1, ok: true, result: { soulsApi: 1, workspace: { name: "acme-platform" }, problems: [], souls: names.map((name) => ({ name, origin: "member", kind: "member", repoKey: "acme/oats", work: "worktree", description: `The ${name} soul.` })) } } });
/** The entry of the fixture's deployment with its workspace at `commit`: a move of the catalog's key. */
const atCommit = (entry, commit) => ({ ...entry, deployment: { ...entry.deployment, workspaceStatus: { ...entry.deployment.workspaceStatus, workspace: { ...entry.deployment.workspaceStatus.workspace, commit } } } });

test("a run that never shows the Souls view never runs `oats souls`, however many reads of the workspace it takes", async () => {
  const r = await started();
  for (let i = 0; i < 3; i++) r.reader.answer(atCommit(ENTRY, `c${i}`));
  r.stdin.type("3"); r.stdin.type("1"); await settle();
  assert.deepEqual(r.soulReads.length, 0);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("the first show of the Souls view reads the catalog once, over the reader's own exec; it says Reading souls… until the read lands, then lists them; reads of the workspace as it was read nothing, one that moved its key reads once", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdin.type("2"); await settle();
  assert.equal(r.soulReads.length, 1, "one read at the first show");
  assert.equal(r.soulExec, r.reader.exec, "the reader's exec: a read of kind \"read\", ended on every way out");
  assert.match(textOf(written(r)), /Reading souls…/);
  r.soulReads[0].answer(soulsDocument(["dev", "ops"])); await settle();
  assert.match(screenOf(r), /\bops\b/);
  r.reader.answer(ENTRY); r.reader.answer(ENTRY); r.stdin.type("1"); r.stdin.type("2"); await settle();
  assert.equal(r.soulReads.length, 1, "the workspace as it was: nothing read");
  r.reader.answer(atCommit(ENTRY, "b2")); await settle();
  assert.equal(r.soulReads.length, 2, "its key moved: one read");
  r.reader.answer(atCommit(ENTRY, "b2")); await settle();
  assert.equal(r.soulReads.length, 2);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.deepEqual(readerDid(r).at(-1), ["stop"], "the reader is stopped on the way out, the catalog's read with it");
});

test("a read of the catalog that a newer key replaced is never shown: the newer read lands first, the older after it, and the screen keeps the newer souls", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdin.type("2"); await settle();
  assert.equal(r.soulReads.length, 1, "the read at key A");
  r.reader.answer(atCommit(ENTRY, "b2")); await settle();
  assert.equal(r.soulReads.length, 2, "the read at key B");
  r.soulReads[1].answer(soulsDocument(["new-catalog-soul"])); await settle();
  assert.match(screenOf(r), /new-catalog-soul/);
  r.soulReads[0].answer(soulsDocument(["old-catalog-soul"])); await settle();
  assert.match(screenOf(r), /new-catalog-soul/, "the newer catalog stays");
  assert.doesNotMatch(screenOf(r), /old-catalog-soul/, "the replaced read is not shown");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("the Souls view shown before the workspace was read waits for its first read; r reads the catalog again, once, and never while a read is in flight", async () => {
  const r = await started();
  r.stdin.type("2"); await settle();
  assert.equal(r.soulReads.length, 0, "no workspace status yet: nothing to settle with");
  r.reader.answer(ENTRY); await settle();
  assert.equal(r.soulReads.length, 1, "its first read settles the catalog");
  r.stdin.type("r"); r.stdin.type("r"); await settle();
  assert.equal(r.soulReads.length, 1, "r while the read is in flight starts nothing");
  r.soulReads[0].answer(soulsDocument(["dev"])); await settle();
  r.stdin.type("r"); await settle();
  assert.equal(r.soulReads.length, 2, "r after it landed: one read");
  r.stdin.type("r"); await settle();
  assert.equal(r.soulReads.length, 2, "and none beside it");
  assert.equal(readerDid(r).filter(([what]) => what === "request").length, 0, "r in the Souls view asks no read of the workspace");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

// ── This run's retires in flight (#1247): the loop's one tracker, its marks and what lets a row go ──

/** The word of a retiring row, as the shared home gives it, and whether the screen shows one now. */
const RETIRING = heldHome({ instance: "any", retireInFlight: true }).state;
const retiringShown = (r) => screenOf(r).includes(RETIRING);
/** The retire confirmation of the selected row, opened and closed again (what it sent would go on):
 *  what the loop handed it. */
async function retireOpened(r) {
  r.stdin.type("D");
  const made = r.confirmations.at(-1);
  assert.equal(made.options.operation, "retire");
  r.stdin.type("\x1b"); r.tick(50); r.timers.fire(); await settle();
  return made.options;
}

test("a retire this run sends reads Retiring… from its send, before any read is asked for; a refusal or a changed plan lets the row go at once", async () => {
  const r = await acting();
  const { retires, target } = await retireOpened(r);
  assert.ok(retires, "the run's tracker is handed to the confirmation");
  assert.equal(target.instance, "acme-expert-tui");
  assert.equal(retiringShown(r), false);
  const requests = () => readerDid(r).filter(([what]) => what === "request").length, asked = requests();
  for (const kind of ["refused", "stale"]) {
    const own = retires.begin(target);
    assert.equal(retiringShown(r), true, `${kind}: from the send`);
    assert.equal(requests(), asked, `${kind}: no read was needed for it`);
    own.settle(kind);
    assert.equal(retiringShown(r), false, `${kind}: let go at once, the row as it was read`);
  }
  assert.equal((await retireOpened(r)).retires, retires, "one tracker for the whole run");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("an answered retire of this machine's row is let go only by a read of its deployment begun after the answer: not one begun before, not a failed one, not the roster", async () => {
  const r = await acting();
  const { retires, target } = await retireOpened(r);
  const own = retires.begin(target);
  const running = r.reader.cycle(); // a cycle begun while the retire runs
  own.settle("complete");
  assert.equal(retiringShown(r), true, "answered: still held until a read says what it left");
  r.reader.read(ENTRY, running);
  assert.equal(retiringShown(r), true, "a read begun before the answer");
  r.reader.answer(failed(ENTRY, { code: "E_DEPLOYMENT_BUSY", message: "busy" }));
  assert.equal(retiringShown(r), true, "a read that failed, whatever entry it kept");
  r.reader.cycle();
  r.reader.collecting();
  r.reader.roster({ envelope: rosterAnswer([garnet()]) });
  assert.equal(retiringShown(r), true, "a roster outcome covers no row of this machine");
  r.reader.read(ENTRY);
  assert.equal(retiringShown(r), false, "read after the answer: the row as the kernel reports it");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("an answered retire of another machine's row is let go only by a roster read begun after the answer that reached that machine: not this machine's reads, not one begun before, not one that failed", async () => {
  const r = await elsewhere({ confirm: reviewing() });
  const { retires, target } = await retireOpened(r);
  assert.deepEqual([target.instance, target.server], ["dev-far", "garnet"]);
  const own = retires.begin(target);
  assert.equal(retiringShown(r), true, "from the send");
  r.reader.cycle();
  r.reader.collecting(); // a roster read begun while the retire runs
  own.settle("partial");
  r.reader.roster({ envelope: rosterAnswer([garnet()]) });
  assert.equal(retiringShown(r), true, "a roster read begun before the answer");
  r.reader.read(HOME_ENTRY);
  assert.equal(retiringShown(r), true, "this machine's read covers no row of another");
  r.reader.cycle();
  r.reader.collecting();
  r.reader.roster({ thrown: "the read timed out" });
  assert.equal(retiringShown(r), true, "a roster read that failed reached no machine");
  r.reader.cycle();
  r.reader.collecting();
  r.reader.roster({ envelope: rosterAnswer([garnet()]) });
  assert.equal(retiringShown(r), false, "read after the answer, garnet reached: the row as garnet reports it");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

// ── Spawning an agent (docs/tui.md, "Spawning an agent"; Spec 6-spawn) ─────────────────────────────

const SPAWN_DATA = Object.freeze({ instance: "acme-expert-2", home: `${DEPLOYMENT}/agents/acme-expert/instances/acme-expert-2`, work: "worktree", harness: "claude", model: "claude-opus-5-5", modelSource: "soul",
  warnings: [], decision: Object.freeze({ spawnDecisionApi: 1, digest: "d".repeat(64) }) });
const SPAWN_SELECTOR = Object.freeze({ soul: "acme-expert", agentsRoot: `${DEPLOYMENT}/agents` });
/** A run with the workspace read and its catalog held, the spawn picker opened with n, the soul's
 *  name typed and picked, and its preview answered: each key a read of its own. */
async function previewing() {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdin.type("n"); await settle();
  r.soulReads[0].answer(soulsDocument(["acme-expert", "acme-maintainer"])); await settle();
  for (const ch of "expert") r.stdin.type(ch);
  r.stdin.type("\r"); await settle();
  r.spawn.reads.at(-1).answer({ spawnPreviewViewApi: 1, status: "available", target: null, data: SPAWN_DATA, reason: null }); await settle();
  return r;
}

test("a spawn through the loop: n reads the catalog, the preview is read once per choice over the shared preview made with the reader's exec, Enter submits the decision on screen, and the new row's terminal opens with the focus", async () => {
  const r = await previewing();
  assert.equal(r.spawn.previewExec, r.reader.exec, "the preview's kernel reads are reads");
  assert.equal(r.spawn.applyRead, r.spawn.preview.prepareRead, "the apply prepares through the same preview");
  const [read] = r.spawn.reads;
  assert.deepEqual(read.request, { action: "preview", selector: SPAWN_SELECTOR, choices: { model: { kind: "inherit" }, relation: { kind: "unrelated" } } });
  assert.deepEqual([read.context.workspace.id, read.context.cli, read.context.agents.map((a) => a.name), read.context.instances.length], [DEPLOYMENT, CLI, ["acme-expert", "acme-maintainer"], 2]);
  r.stdin.type("\r"); await settle();
  const [submit] = r.spawn.submits;
  assert.deepEqual(submit.intent, { address: DEPLOYMENT, selector: SPAWN_SELECTOR, input: { action: "prepare", selector: SPAWN_SELECTOR, choices: read.request.choices, task: "" }, decision: SPAWN_DATA.decision });
  assert.equal(submit.call.alive(), true);
  submit.call.progress("submitted", { address: DEPLOYMENT, spawnRef: "a".repeat(64) }); await settle();
  assert.match(screenOf(r), /Spawning acme-expert-2…/);
  const asked = readerDid(r).filter(([what]) => what === "request").length;
  submit.answer({ kind: "created", view: { status: "complete", receipt: { instance: "acme-expert-2", agent: "acme-expert", home: SPAWN_DATA.home, launched: true } }, reason: null, job: {} }); await settle();
  assert.equal(readerDid(r).filter(([what]) => what === "request").length, asked + 1, "the instances read at once");
  assert.doesNotMatch(screenOf(r), /Spawning/);
  r.reader.answer(observed([instanceRow("acme-expert", "acme-expert-tui"), instanceRow("acme-maintainer", "acme-maintainer-ops", { running: false, runtimeState: "stopped" }), instanceRow("acme-expert", "acme-expert-2")])); await settle();
  assert.equal(r.panel.opens.length, 1, "its terminal, in the panel");
  assert.equal(r.panel.opens[0].argv.some((arg) => String(arg).endsWith("/acme-expert-2")), true);
  r.stdin.type("q"); await settle();
  assert.equal(r.log.some(([what, bytes]) => what === "panel" && bytes === "input"), true, "the q went to the agent: the terminal has the focus");
});

test("a paste of n, a soul's name and two Enters in one read opens the picker and spawns nothing: no preview is read, nothing submitted", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdin.type("nexpert\r\r"); await settle();
  assert.deepEqual([r.spawn.reads.length, r.spawn.submits.length], [0, 0]);
  r.soulReads[0].answer(soulsDocument(["acme-expert"])); await settle();
  assert.deepEqual([r.spawn.reads.length, r.spawn.submits.length], [0, 0]);
});

test("the apply is a change of the run, labelled for the line after leaving; its deadline goes to changeExec as given; held previews go before an apply and when a pending one settles, which reads the rows again", async () => {
  const r = await previewing();
  r.stdin.type("\r"); await settle();
  const child = r.spawn.applyExec("/opt/oats/bin/oats.mjs", ["spawn", "--apply"], { detached: true, timeout: 70000, cwd: "/srv/deploy" }, () => {});
  const [change] = r.reader.changed;
  assert.deepEqual([change.options.label, change.options.timeout, change.options.detached, child.pid], [{ verb: "spawn", name: "acme-expert-2" }, 70000, undefined, 4001]);
  assert.throws(() => r.spawn.applyExec("/opt/oats/bin/oats.mjs", ["spawn", "--result"], { cwd: "/srv/deploy" }, () => {}), /starts nothing/, "anything else is a read");
  const before = r.log.length;
  await r.spawn.request({ action: "prepare" }, { address: DEPLOYMENT });
  assert.deepEqual(r.log.slice(before).filter(([what]) => what === "spawn"), [], "a prepare forgets nothing");
  await r.spawn.request({ action: "apply", spawnRef: "a".repeat(64) }, { address: DEPLOYMENT });
  assert.deepEqual(r.log.slice(before).filter(([what]) => what === "spawn"), [["spawn", "invalidate", DEPLOYMENT]]);
  const apply = r.spawn.applyCalls.at(-1);
  assert.equal(apply.context.workspace.id, DEPLOYMENT, "admitted against the job's workspace as it is now");
  const asked = readerDid(r).filter(([what]) => what === "request").length;
  apply.settled();
  assert.deepEqual(r.log.filter(([what]) => what === "spawn").at(-1), ["spawn", "invalidate", DEPLOYMENT]);
  assert.equal(readerDid(r).filter(([what]) => what === "request").length, asked + 1);
});

test("Spawn is armed by the frame that shows the ready preview, not by the answer: while the output is blocked an answer that landed spawns nothing, and once it is drawn an Enter of a later read does", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdin.type("n"); await settle();
  r.soulReads[0].answer(soulsDocument(["acme-expert"])); await settle();
  for (const ch of "expert") r.stdin.type(ch);
  // The terminal stops taking frames: the one that says the preview is read blocks the next. The
  // answer lands meanwhile, and no frame shows it.
  r.stdout.accepts = false;
  r.stdin.type("\r"); await settle();
  assert.match(textOf(r.stdout.take()), /Reading the preview/);
  r.stdout.accepts = true;
  r.spawn.reads.at(-1).answer({ spawnPreviewViewApi: 1, status: "available", target: null, data: SPAWN_DATA, reason: null }); await settle();
  assert.equal(r.stdout.take(), "", "no frame was written: the output is blocked");
  r.stdin.type("\r"); await settle();
  assert.equal(r.spawn.submits.length, 0, "an Enter on a preview not drawn spawns nothing");
  // It drains: the frame shows the preview ready, and an Enter of a later read spawns.
  r.stdout.emit("drain"); await settle();
  assert.match(textOf(r.stdout.take()), /\[ Spawn \]|> Spawn </);
  r.stdin.type("\r"); await settle();
  assert.equal(r.spawn.submits.length, 1);
});

test("quitting with a spawn under way clears the timer the shared apply arms its deadline and grace on (the boundary's applyTimer): neither then signals the spawn let go, and no timer outlives the run", async () => {
  /** A run, and a deadline armed on its applyTimer as the shared apply arms it on a worktree-event
   *  kernel (test/client-spawn-apply-timer.test.mjs pins that it does): SIGTERM at 60 s, then the
   *  grace's SIGKILL 20 s later. */
  async function applying() {
    const r = await started();
    r.reader.answer(ENTRY); await settle();
    const signals = [];
    r.spawn.applyTimer(() => { signals.push("SIGTERM"); r.spawn.applyTimer(() => signals.push("SIGKILL"), 20000); }, 60000);
    assert.equal(r.timers.delays().includes(60000), true, "the deadline is on the run's timers");
    return { r, signals };
  }
  // Quit before the deadline: it goes with the run.
  const a = await applying();
  a.r.stdin.type("q");
  assert.equal(await a.r.status, 0);
  assert.equal(a.r.timers.delays().includes(60000), false, "the deadline went with the run");
  a.r.timers.fire();
  assert.deepEqual(a.signals, [], "a TUI that has gone signals no spawn");
  // The deadline passes while the run goes on: SIGTERM; quit in the grace, and SIGKILL never comes.
  const b = await applying();
  b.r.timers.fire();
  assert.deepEqual(b.signals, ["SIGTERM"]);
  assert.equal(b.r.timers.delays().includes(20000), true, "the grace is armed");
  b.r.stdin.type("q");
  assert.equal(await b.r.status, 0);
  b.r.timers.fire();
  assert.deepEqual(b.signals, ["SIGTERM"], "no SIGKILL after the TUI has gone");
  assert.equal(b.r.timers.count, 0, "no timer outlives the run");
});

test("the transaction's polls and the boundary's wait for an answer are on the run's timers too, and end with it", async () => {
  const r = await started();
  r.reader.answer(ENTRY); await settle();
  let slept = false, waited = false;
  void r.spawn.sleep(5000).then(() => { slept = true; });
  r.spawn.answerTimer(() => { waited = true; }, 50000);
  assert.deepEqual([r.timers.delays().includes(5000), r.timers.delays().includes(50000)], [true, true]);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  r.timers.fire(); await settle();
  assert.deepEqual([slept, waited, r.timers.count], [false, false, 0]);
});

test("a workspace whose catalog key moved forgets the previews held for it", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdin.type("n"); await settle();
  r.reader.answer(ENTRY); await settle();
  assert.equal(r.log.some(([what, how]) => what === "spawn" && how === "invalidate"), false, "the workspace as it was");
  r.reader.answer(atCommit(ENTRY, "b2")); await settle();
  assert.deepEqual(r.log.filter(([what]) => what === "spawn"), [["spawn", "invalidate", DEPLOYMENT]]);
});

test("an outcome not known offers C, which checks the submitted job once; quitting with a spawn under way lets it go, its call's owner gone, and the line after leaving names it with `oats status`", async () => {
  const r = await previewing();
  r.stdin.type("\r"); await settle();
  const [submit] = r.spawn.submits, job = { address: DEPLOYMENT, spawnRef: "b".repeat(64) };
  submit.call.progress("submitted", job);
  submit.answer({ kind: "unknown", view: null, reason: { code: "E_OUTCOME_UNKNOWN" }, job }); await settle();
  // What was written: screenOf's Ctrl+L is a key bound to an action, which puts the line away.
  assert.match(textOf(written(r)), /Press C to check before spawning again\./);
  r.stdin.type("C"); await settle();
  assert.deepEqual([r.spawn.checks.length, r.spawn.checks[0].job], [1, job]);
  assert.match(screenOf(r), /Checking the spawn of acme-expert-2…/);
  r.reader.running = [{ label: { verb: "spawn", name: "acme-expert-2" } }];
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.spawn.checks[0].call.alive(), false, "nothing is reported to a TUI that has gone");
});

test("the line after leaving names a spawn still running", async () => {
  const r = await started({ tellable: () => true });
  r.reader.answer(ENTRY);
  r.reader.running = [{ label: { verb: "spawn", name: "acme-expert-2" } }];
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.deepEqual(r.errors, ["oats: the spawn of acme-expert-2 is still running; `oats status` shows its result.\n"]);
});
