process.env.TZ = "UTC";
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, bindings, keyLabel } from "../lib/actions.mjs";
import { DETACH_KEY_FEATURE, DETAIL_WITHHELD, INSTANCE_VARIABLES, TERMS, cliReadsRemotes, sessionAttachArgv, cliRecord, deploymentState, identityMemory, observeIdentities, observedEntry, panelData, panelInstances, primaryDeployment, remoteRosterState, rosterRows } from "../lib/client.mjs";
import { effectiveConfig } from "../lib/config.mjs";
import { NO_TERMINAL, USAGE, main, noDeployment, noKernel, parseArgs } from "../lib/main.mjs";
import { shown, textOf as textShown } from "../lib/term/text.mjs";
import { ENTER, LEAVE, LEND_END_GRACE_MS } from "../lib/term/tty.mjs";
import { CLI, DEPLOYMENT, failed, fakeProcess, fakeStdin, fakeStdout, fakeTimers, instanceRow, modesOf, observed, readTerminalOutput, rosterOf } from "./helpers.mjs";

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
    hold() { did("hold"); },
    release() { did("release"); },
    /** The exec the loop hands the shared preflight: the test's fake prepareRemoteTerm only checks it is this one. */
    exec() { throw new Error("the fake reader starts nothing"); },
    stop() { did("stop"); },
    children: () => [],
    /** A served deployment's answer of a cycle, as lib/read.mjs gives it: every answer under a
     *  number of its own, as every cycle has. */
    answer(entry, id = DEPLOYMENT) { options.onEntry({ id, entry, number: ++number }); },
    /** A roster read begun, as lib/read.mjs says it. */
    collecting() { options.onRoster({ collecting: true }); },
    /** One outcome of the roster read, over what the loop holds of the other machines now. */
    roster(outcome) { options.onRoster(rosterEvent(options.getRoster(), outcome, options.clock())); },
  };
}
/** `oats tui` on a fake terminal: the run, its streams and what it wrote. Everything outside the
 *  terminal (the user's file, the deployment, the kernel, the reader) is the test's own. */
function run({ argv = [], env = { TERM: "xterm-256color", LANG: "en_US.UTF-8" }, columns = 80, rows = 24, stdinTTY = true, stdoutTTY = true, config = { ok: true, actions: ACTIONS, ascii: false }, deployment = { ok: true, deployment: DEPLOYMENT }, kernel = { ok: true, cli: CLI }, cwd = "/work/here", offered = { offered: [], limited: false }, admit = (path) => ({ ok: true, deployment: path }), prepare = null } = {}) {
  const log = [];
  const stdin = fakeStdin({ log, isTTY: stdinTTY }), stdout = fakeStdout({ log, columns, rows, isTTY: stdoutTTY }), proc = fakeProcess(), timers = fakeTimers();
  const kill = proc.kill;
  proc.kill = (pid, signal) => { log.push(["kill", pid, signal]); return kill(pid, signal); };
  const errors = [];
  const stderr = { write(text) { errors.push(text); log.push(["stderr", text]); return true; } };
  let clock = Date.parse("2026-10-11T10:00:30.000Z");
  // `offered`: what ~/Agents holds that the run does not serve; a test may put another answer there.
  // `viewers`: every viewer the run started, each with a way to close it; `preflights`: every
  // preflight it began, each with what it was handed and a way to answer it.
  const r = { stdin, stdout, proc, timers, errors, log, offered, reader: null, viewers: [], preflights: [], tick(ms) { clock += ms; } };
  let up;
  r.up = new Promise((resolve) => { up = resolve; });
  const effects = {
    loadConfig(asked) { log.push(["effect", "config", { ...asked.env }]); return config; },
    findDeployment(start) { log.push(["effect", "deployment", start]); return deployment; },
    async probeKernel(asked) { log.push(["effect", "kernel", { ...asked.env }]); return kernel; },
    createReader(options) { r.reader = fakeReader(log, options); const start = r.reader.start; r.reader.start = () => { const answer = start(); queueMicrotask(up); return answer; }; return r.reader; },
    offeredDeployments(home, served) { log.push(["effect", "offered", home, [...served]]); return r.offered; },
    admitDeployment(path) { log.push(["effect", "admit", path]); return admit(path); },
    startViewer(bin, args, options) {
      log.push(["viewer", "start", bin, [...args]]);
      let close;
      const viewer = { bin, args, options, ended: 0, closed: new Promise((resolve) => { close = resolve; }) };
      viewer.close = (status, stderr = "") => { log.push(["viewer", "closed", status]); close({ status, stderr }); };
      viewer.end = () => { viewer.ended++; log.push(["viewer", "end"]); };
      r.viewers.push(viewer);
      return { closed: viewer.closed, end: viewer.end };
    },
    prepareRemoteTerm(cli, target, options) {
      log.push(["preflight", target]);
      if (prepare) return prepare(cli, target, options);
      return new Promise((resolve, reject) => { r.preflights.push({ cli, target, options, resolve, reject }); });
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
    left: "collapse", h: "collapse", right: "expand", l: "expand", tab: "detail", "/": "filter", r: "refresh", 1: "instances",
    w: "workspaces", enter: "open",
    "?": "help", escape: "close", q: "quit", "ctrl+c": "quit", "ctrl+z": "suspend", "ctrl+l": "redraw",
  });
  assert.throws(() => bindings([{ id: "a", keys: ["x"], label: "a" }, { id: "b", keys: ["x"], label: "b" }]), /key x is bound to a and to b/);
  assert.equal(Object.isFrozen(ACTIONS) && ACTIONS.every((a) => Object.isFrozen(a) && Object.isFrozen(a.keys)), true);
  assert.deepEqual(["?", "q", "escape", "ctrl+c", "shift+tab", "f5", "ctrl+alt+up", "space", "alt+x"].map(keyLabel), ["?", "q", "Esc", "Ctrl+C", "Shift+Tab", "F5", "Ctrl+Alt+Up", "Space", "Alt+X"]);
  // Enter opens the selected agent's terminal in the list and the selected workspace in the
  // switcher: one action. The capitals are a later version's acts: none is bound, but for G.
  assert.equal(bindings(ACTIONS).get("enter"), "open");
  assert.deepEqual([...bindings(ACTIONS).keys()].filter((key) => /^[A-Z]$/.test(key)), ["G"]);
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
  assert.match(noKernel("not the oats CLI (name: \x1b]0;owned\x07)"), /\(E_TUI_KERNEL\): \[Detail withheld\]$/);
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
  assert.match(textOf(r.stdout.take()), /oats.*1 Instances.*2 Souls.*3 Capabilities.*Reading the deployment\..*\? help.*q quit/s);
  r.reader.answer(ENTRY);
  assert.match(textOf(r.stdout.take()), /acme-platform.*1 running.*1 stopped.*acme-expert-tui.*claude.*acme-maintainer-ops.*stopped/s);
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
  assert.deepEqual([...new Set(sequences.map((s) => s.kind))].sort(), ["erase", "mode", "position", "sgr"]);
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
  assert.equal(out.startsWith("\x1b[0m\x1b[2J"), true, "a resize clears first");
  assert.match(textOf(out), /oats.*acme-maintainer-ops.*\? help/s);
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
  assert.equal(out.startsWith("\x1b[0m\x1b[2J"), true);
  assert.match(out, /\x1b\[40;1H/, "drawn for the 40 rows the terminal has now");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Ctrl+L sets the terminal's modes again and redraws in full, and Ctrl+\\ does nothing", async () => {
  const r = await started();
  const first = r.stdout.take();
  assert.equal(first.startsWith(ENTER), true);
  r.stdin.type("\x1c");
  assert.equal(r.stdout.take(), "");
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
  assert.equal(frame.includes("\x1b[?"), false, "the frame itself switches no mode");
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
  assert.match(first, /oats\s+workspaces.*On this machine, not opened.*acme-ledger\s+~\/Agents\/acme-ledger.*Enter open.*\/ filter.*r refresh.*\? help.*q quit/s);
  assert.doesNotMatch(first, /Reading the deployment|Esc close/, "no deployment is being read, and there is no view to close the switcher onto");
  // What the reader's first cycle found of the other machines is listed too.
  r.reader.collecting();
  r.reader.roster({ envelope: rosterAnswer([garnet()]) });
  assert.match(screenOf(r), /oats\s+workspaces.*garnet.*On this machine, not opened.*acme-ledger/s);
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
  // In the list of instances Enter opens the selected agent, here with a kernel record that has no
  // detach key: it says why not, and starts nothing.
  r.stdin.type("\r");
  assert.deepEqual([effectsOf(r), readerDid(r)], [[], [["touch"]]]);
  assert.match(textOf(r.stdout.take()), /This machine's OATS has no key to leave a viewer/);
  assert.doesNotMatch(screenOf(r), /no key to leave a viewer/, "the next key bound to an action (Ctrl+L) takes the line away");
  r.log.length = 0;
  r.stdin.type("w");
  assert.deepEqual(effectsOf(r), [["offered", "/home/u", [DEPLOYMENT]]], "asked with the deployments the run serves, which it leaves out");
  assert.deepEqual(readerDid(r), [["touch"]], "opening the switcher reads no deployment");
  assert.notEqual(r.stdout.take(), "");
  const listed = screenOf(r);
  assert.match(listed, /oats\s+workspaces.*> \* acme-platform\s+This machine.*On this machine, not opened.*acme-ledger\s+~\/Agents\/acme-ledger.*Enter open.*\/ filter.*r refresh.*Esc close.*\? help.*q quit/s);
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
  assert.match(opened, /oats\s+acme-ledger.*1 Instances.*Reading the deployment\..*\/ filter.*w workspaces.*\? help.*q quit/s);
  assert.doesNotMatch(opened, /acme-expert-tui|On this machine, not opened/, "the switcher is closed, and the view is the new deployment's");
  // From then on: the reader's answer for it is taken and drawn.
  r.reader.answer(observedAt("/srv/acme-ledger", [instanceRow("acme-clerk", "acme-clerk-books")], { workspace: reportedWorkspace("git.example.com/acme-ledger/books", "aweb:acme-ledger"), name: "acme-ledger" }), "/srv/acme-ledger");
  assert.match(textOf(r.stdout.take()), /acme-clerk-books/);
  assert.match(screenOf(r), /oats\s+acme-ledger\s+1 running.*acme-clerk-books/s);
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
  assert.match(after, /oats\s+workspaces.*\* acme-platform\s+This machine.*On this machine, not opened.*>\s+acme-ledger\s+Not an OATS deployment any more\..*Enter open.*Esc close/s);
  assert.equal(words(after), words(before).replace("~/Agents/acme-ledger", "Not an OATS deployment any more."), "the switcher as it was, but for what that row says");
  // The view the switcher was opened over is still there to go back to.
  r.stdin.type("\x1b");
  r.tick(50);
  r.timers.fire();
  assert.match(screenOf(r), /oats\s+acme-platform.*acme-expert-tui.*acme-maintainer-ops/s);
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
  assert.match(opened, /oats\s+charts.*1 Instances.*read 10:00:30.*dev-east.*\/ filter.*w workspaces/s, "the machine's view, with the time of the roster read it is drawn from");
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
  assert.match(screenOf(r), /oats\s+acme-platform\s+\+1 machine\s+2 running\s+2 stopped.*This machine.*acme-expert-tui.*acme-maintainer-ops.*garnet\s+read 10:00:45.*dev-far.*dev-held/s);
  // What the loop holds is what the shared rule made of the answer, and the reader is told it.
  const now = r.reader.options.getRoster(), made = rosterEvent(held, { envelope: rosterAnswer([garnet()]) }, "2026-10-11T10:00:45.000Z").roster;
  assert.deepEqual(now, { remote: made.remote, memory: made.memory, notes: made.notes });
  assert.deepEqual([now.remote.rosterAnswered, now.remote.remoteGroups.map((g) => g.id), [...now.memory.keys()]], [true, ["garnet:t1"], ["garnet:t1"]], "the fixture has the kernel's forms: the machine is remembered");

  // The next read throws: the machine keeps its heading, says it was not reached, and nothing of it reads as stopped.
  r.reader.collecting();
  r.reader.roster({ thrown: "spawn EMFILE" });
  const lost = screenOf(r);
  assert.match(lost, /\+1 machine.*1 running\s+1 stopped\s+2 unknown.*This machine.*garnet\s+remembered\s+Not reached.*dev-far\s+unknown.*dev-held\s+unknown/s);
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

// ── Opening an agent's terminal ─────────────────────────────────────────────────────────────────────

/** A kernel record that opens agents with a detach key, here and on other machines. */
const KEYED = cliRecord({ version: CLI.version, workspaceApi: CLI.workspaceApi, features: [...CLI.features, DETACH_KEY_FEATURE, "server-probe-features"], remote: ["roster", "session"] }, { bin: CLI.bin, source: "tui" });
/** The agents' socket the kernel records for this machine's rows: the TUI names it nowhere. */
const AGENTS_SOCKET = "/tmp/oats-tmux-1000/agents";
const OPEN_ENTRY = observedAt(DEPLOYMENT, [instanceRow("acme-expert", "acme-expert-tui", { tmux: { session: "oats-agents", window: "acme-expert-tui", socket: AGENTS_SOCKET } })]);
const KEY_CONFIG = { ok: true, actions: ACTIONS, ascii: false, detachKey: "C-\\" };
/** A run on a deployment whose one agent runs, with a kernel that has the detach key. */
async function opening(options = {}) {
  const r = await started({ kernel: { ok: true, cli: KEYED }, config: KEY_CONFIG, ...options });
  r.reader.answer(OPEN_ENTRY);
  r.stdout.take();
  r.log.length = 0;
  return r;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const HOME = `${DEPLOYMENT}/agents/acme-expert/instances/acme-expert-tui`;

test("Enter on a running agent of this machine: the reads in flight are void and none starts, the terminal is lent to the kernel's viewer, and at its close reads begin again, a live read is asked and one line says what happened", async () => {
  const r = await opening();
  r.stdin.type("\r");
  const [viewer] = r.viewers;
  assert.deepEqual(viewer && [viewer.bin, viewer.args], [KEYED.bin, sessionAttachArgv(KEYED, { home: HOME }, { detachKey: "C-\\" })], "the kernel's own binary, the shared home's arguments");
  assert.deepEqual(r.log.filter(([what]) => ["reader", "write", "raw", "viewer"].includes(what)).map(([what, which]) => [what, which === LEAVE ? "LEAVE" : which === ENTER ? "ENTER" : which]), [
    ["reader", "touch"], ["reader", "void"], ["reader", "hold"], ["write", "LEAVE"], ["raw", false], ["viewer", "start"],
  ], "reads made void and held before the terminal is handed over; nothing drawn after the leave");
  assert.equal(r.stdin.paused, true, "the TUI does not read the terminal while the viewer has it");
  r.log.length = 0;
  r.stdout.take();
  r.stdout.resize(100, 30);
  r.stdin.type("x");
  assert.deepEqual(r.stdout.take(), "", "nothing is drawn while the viewer has the terminal, a resize included");
  viewer.close(20);
  await settle();
  assert.deepEqual(r.log.filter(([what]) => ["reader", "raw"].includes(what)).map(([what, which, how]) => [what, which, ...(how ? [how] : [])]), [["raw", true], ["reader", "release"], ["reader", "request", { live: true }]]);
  const after = textOf(r.stdout.take());
  assert.match(after, /You left acme-expert-tui\. It keeps running\./);
  assert.equal(r.stdin.paused, false);
  // The next key bound to an action takes the line away (screenOf presses Ctrl+L).
  assert.doesNotMatch(screenOf(r), /You left/);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("a stray detach key with oats tui in front does nothing and is not shown: the line after the return stays", async () => {
  const r = await opening();
  r.stdin.type("\r");
  r.viewers[0].close(20);
  await settle();
  r.stdout.take();
  r.log.length = 0;
  r.stdin.type("\x1c\x1c");
  assert.deepEqual(r.log.filter(([what]) => what === "viewer" || what === "preflight"), [], "nothing is opened");
  assert.equal(r.stdout.take().includes("\x1c"), false, "not shown");
  // The whole screen again, by a way that is no key: SIGCONT redraws in full.
  r.proc.emit("SIGCONT", "SIGCONT");
  assert.match(textOf(r.stdout.take()), /You left acme-expert-tui\. It keeps running\./, "the line is still there");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("no child the TUI starts for an open is tmux, and the agents' socket is in no argument it builds", async () => {
  const r = await opening();
  r.stdin.type("\r");
  const [viewer] = r.viewers;
  assert.equal(viewer.bin, KEYED.bin, "the kernel the TUI shipped with");
  for (const arg of [viewer.bin, ...viewer.args]) {
    assert.equal(/(^|\/)tmux$/.test(arg) || arg === "tmux", false, arg);
    assert.equal(arg.includes(AGENTS_SOCKET), false, arg);
  }
  viewer.close(20);
  await settle();
  r.stdin.type("q");
  await r.status;
});

test("SIGTERM while the viewer has the terminal ends the viewer first, then the run once it has closed, with 143; SIGQUIT changes nothing and the key still returns", async () => {
  const r = await opening();
  r.stdin.type("\r");
  r.proc.emit("SIGQUIT", "SIGQUIT");
  await settle();
  assert.equal(r.viewers[0].ended, 0, "the viewer handles its own QUIT");
  r.viewers[0].close(20);
  await settle();
  assert.match(textOf(r.stdout.take()), /You left acme-expert-tui/);
  r.stdin.type("\r");
  const viewer = r.viewers[1];
  r.log.length = 0;
  r.proc.emit("SIGTERM", "SIGTERM");
  assert.equal(viewer.ended, 1);
  let over = false;
  r.status.then(() => { over = true; });
  await settle();
  assert.equal(over, false, "the run waits for the viewer");
  viewer.close(0);
  assert.equal(await r.status, 143);
  assert.deepEqual(r.log.filter(([what]) => what === "write" || what === "raw"), [], "nothing more is written to a terminal already restored");
  assert.equal(readerDid(r).some(([what]) => what === "stop"), true);
  // A viewer that does not close: the run ends LEND_END_GRACE_MS later.
  const s = await opening();
  s.stdin.type("\r");
  s.proc.emit("SIGHUP", "SIGHUP");
  assert.equal(s.timers.delays().includes(LEND_END_GRACE_MS), true);
  s.timers.fire();
  assert.equal(await s.status, 129);
});

/** The fixture's deployment and garnet, whose OATS lists the detach key, with garnet's row selected. */
async function elsewhere(options = {}) {
  const far = { ...garnet(), probe: { ok: true, features: [DETACH_KEY_FEATURE] } };
  const r = await started({ kernel: { ok: true, cli: KEYED }, config: KEY_CONFIG, ...options });
  r.reader.answer(HOME_ENTRY);
  r.reader.roster({ envelope: rosterAnswer([far]) });
  for (let i = 0; i < 6 && !/> +\S+ dev-far/.test(screenOf(r)); i++) r.stdin.type("j");
  assert.match(screenOf(r), /> +\S+ dev-far/, "garnet's running row is selected");
  r.stdout.take();
  r.log.length = 0;
  return r;
}

test("Enter on a running agent of another machine: the shared preflight over the reader's exec, with a signal and the key; what it prepared is lent; a failure is said and nothing is lent", async () => {
  const r = await elsewhere();
  r.stdin.type("\r");
  await settle();
  const [asked] = r.preflights;
  assert.deepEqual([asked.cli, asked.target, asked.options.exec, asked.options.detachKey, asked.options.signal.aborted], [KEYED, { serverId: "garnet", instance: "dev-far", home: "/srv/acme-platform/agents/dev/instances/dev-far" }, r.reader.exec, "C-\\", false]);
  assert.match(screenOf(r), /Esc stop opening/);
  r.stdin.type("\r");
  await settle();
  assert.equal(r.preflights.length, 1, "a second Enter does nothing");
  asked.resolve({ binary: KEYED.bin, args: ["session", "attach", "--server", "garnet", "--home", asked.target.home, "--detach-key", "C-\\"] });
  await settle();
  assert.deepEqual(r.viewers.map((v) => [v.bin, v.args.slice(0, 4)]), [[KEYED.bin, ["session", "attach", "--server", "garnet"]]]);
  r.viewers[0].close(255, "Connection to garnet.example closed by remote host.\n");
  await settle();
  assert.match(textOf(r.stdout.take()), /The connection to garnet ended\.[\s\S]*"Connection to garnet\.example closed by remote host\."/);

  r.stdin.type("\r");
  await settle();
  r.preflights[1].reject(Object.assign(new Error("remote session inspection timed out"), { code: "E_TERM_PREPARE_TIMEOUT" }));
  await settle();
  assert.equal(r.viewers.length, 1, "nothing is lent");
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
  assert.deepEqual(r.viewers, [], "given up: nothing lent");
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
