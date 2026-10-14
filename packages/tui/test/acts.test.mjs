process.env.TZ = "UTC";
// Stopping, starting, restarting and retiring from the list (awebai/oats#855, PR 5): which key opens
// what for a row (from instanceActs alone), the act view and its buttons, the shared confirmation
// driven through every phase by a fake request, the start rule's answers, and what stays closed
// while a start of this run is still running. The rows are made by the shared reader (helpers.mjs
// `observed`, the roster's own functions for another machine). A lifecycle sentence is never written
// here as a literal: it is read from what the shared functions answer for the same input. Only the
// TUI's own words are literals.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TERMS, createLifecycleBoundary, createLifecycleConfirmation, displayLine, flagIgnoredNotice, instanceActs, instanceId, kernelLines, launchFlagIgnored, observeIdentities,
  observedEntry, originLead, panelInstances, shortPath, remoteRosterState, retainedStartMessage, rosterRows, startGate, startInstance,
} from "../lib/client.mjs";
import { effectiveConfig } from "../lib/config.mjs";
import { ACT_VERBS, ACT_WORDS, BUTTON_ORDER, actContext, actCwd, actDecision, buttonLabel, model, roster, startOutcome } from "../lib/model.mjs";
import { reduce } from "../lib/store.mjs";
import { ACT_RULES } from "../lib/views/help.mjs";
import { CLI, DEPLOYMENT, LIFECYCLE_INSTANCE as fixtureInstance, draw, envelope, instanceRow, lifecycleContext as boundaryContext, lifecycleTarget, observed, press, rosterOf, stateOf, stopPlan, stopReceipt } from "./helpers.mjs";

const size = (cols, rows) => ({ cols, rows });
const S80 = size(80, 24), S120 = size(120, 40);
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A kernel that starts and restarts sessions and plans stops and retires. */
const ACTS_CLI = Object.freeze({ ...CLI, lifecycleApi: 1, features: Object.freeze([...CLI.features, "session-start", "session-restart", "lifecycle-plans", "retire-retention", "retire-home"]) });
/** The words the TUI writes, as the screen shows them: a part from outside is given here as it is (the fixture's names are plain). */
const words = (parts) => parts.map((part) => part.own ?? part.shown).join("");

const RUN = "dev-run", STOPPED = "dev-stopped", UNKNOWN = "dev-unknown", HALF = "dev-half", SPAWNING = "dev-spawning", HERDR = "dev-herdr";
const HERE = () => [
  instanceRow("dev", RUN),
  instanceRow("dev", STOPPED, { running: false, runtimeState: "stopped" }),
  instanceRow("dev", UNKNOWN, { running: null, runtimeState: "unreachable", runtimeError: "tmux: no server running" }),
  instanceRow("dev", HALF, { running: false, runtimeState: "stopped", rollbackIncomplete: true }),
  instanceRow("dev", SPAWNING, { running: false, runtimeState: "stopped", spawnInProgress: true }),
  instanceRow("dev", HERDR, { running: null, runtimeState: "unsupported", runtimeError: "E_HERDR_REMOVED: Herdr is gone; tmux is the only session backend" }),
];
const here = (cli = ACTS_CLI, rows = HERE()) => stateOf(observed(rows, { cli }), { cli });
const rowOf = (state) => roster(state).instances.find((row) => instanceId(row) === state.selected);
/** The state with `name` selected. */
function on(state, name) {
  for (let i = 0; i < 30 && rowOf(state)?.instance !== name; i++) state = press(state, ["k"]).state;
  for (let i = 0; i < 30 && rowOf(state)?.instance !== name; i++) state = press(state, ["j"]).state;
  assert.equal(rowOf(state).instance, name, `${name} is selected`);
  return state;
}
/** The line above the panes as text: its parts, then each text under it. */
const lineOf = (state) => (state.outcome === null ? null : [words(state.outcome.said), ...state.outcome.under]);
/** A reason of the shared home's, as the line says it: after its speaker when it names one, as
 *  written when it carries no mark, and quoted when its mark names nobody. */
function spokenAs(reason) {
  const lead = originLead(reason.origin, TERMS), line = displayLine(reason.sentence);
  return lead !== null ? `${lead} ${line}` : reason.origin === undefined ? line : `"${line}"`;
}
const KEY = Object.freeze({ stop: "X", retire: "D", start: "S", restart: "R" });
/** The loop's effect of an opened confirmation, with the list's row it was opened on given as its home. */
const openedWith = (effects) => effects.map(({ act }) => ({ act: { ...act, row: act.row.home } }));

// ── Which key opens what ─────────────────────────────────────────────────────────────────────────

test("each act key opens a confirmation exactly when instanceActs lists its verb enabled, and otherwise says why on the line above the panes (Done 1)", () => {
  const cases = [
    // row, the verbs that open; every other verb says why
    [RUN, ["stop", "retire", "restart"]],
    [STOPPED, ["stop", "retire", "start"]],
    [UNKNOWN, ["stop", "retire"]],
    [HALF, ["retire"]],
    [SPAWNING, []],
    [HERDR, ["stop", "retire"]],
  ];
  for (const [name, opening] of cases) {
    const state = on(here(), name), row = rowOf(state), acts = instanceActs(row);
    for (const verb of ACT_VERBS) {
      const { state: after, effects } = press(state, [KEY[verb]]);
      const listed = acts.acts.find((act) => act.verb === verb);
      if (opening.includes(verb)) {
        assert.equal(listed?.enabled, true, `${name} ${verb}: premise, listed enabled`);
        assert.equal(after.view, "act", `${name} ${verb}: the act view`);
        assert.deepEqual([after.act.verb, after.act.id, after.act.focus, after.act.name], [verb, instanceId(row), "close", name], `${name} ${verb}: the focus on Cancel`);
        assert.equal(after.outcome, null);
        if (verb === "stop" || verb === "retire") assert.deepEqual(openedWith(effects), [{ act: { n: after.act.n, verb, id: instanceId(row), row: row.home, label: null } }], `${name} ${verb}: the loop makes the shared confirmation`);
        else assert.deepEqual([effects, after.act.kind, after.act.phase], [[], "start", "review"], `${name} ${verb}: the TUI's own confirmation, nothing asked yet`);
        continue;
      }
      assert.deepEqual([after.view, after.act, effects], ["instances", null, []], `${name} ${verb}: nothing opens`);
      const held = acts.blocked ?? acts.limited;
      const expected = listed ? ["", spokenAs(listed.reason)] : held ? ["", spokenAs(held)] : [words(ACT_WORDS.notHere(name, verb))];
      assert.deepEqual(lineOf(after), expected, `${name} ${verb}: why`);
    }
  }
  // The TUI's own words for a verb the row does not list, as the screen shows them.
  assert.equal(words(ACT_WORDS.notHere(RUN, "start")), `${RUN} can't be started here.`);
  assert.equal(words(ACT_WORDS.notHere(STOPPED, "restart")), `${STOPPED} can't be restarted here.`);
});

test("a start or restart the shared start gate refuses opens nothing, and its sentence is the line", () => {
  const old = Object.freeze({ ...ACTS_CLI, features: Object.freeze(ACTS_CLI.features.filter((f) => f !== "session-restart")) });
  const state = on(here(old), RUN), refused = startGate(old, rowOf(state), { restart: true }, TERMS);
  assert.ok(refused, "premise: the gate refuses a restart without session-restart");
  const { state: after, effects } = press(state, ["R"]);
  assert.deepEqual([after.view, effects, lineOf(after)], ["instances", [], ["", refused.sentence]]);
  // A kernel without session-start: start is listed and enabled by instanceActs, refused by the gate.
  const none = Object.freeze({ ...CLI });
  const stopped = on(here(none), STOPPED), gate = startGate(none, rowOf(stopped), {}, TERMS);
  assert.deepEqual(lineOf(press(stopped, ["S"]).state), ["", gate.sentence]);
});

test("the footer names the act keys the selected row opens now, in the order stop, retire, start, restart, after open; a key it leaves out still answers (Done 1)", () => {
  const footer = (state, sz = S120) => draw(state, sz).lines[sz.rows - 1];
  assert.match(footer(on(here(), RUN)), /^ X stop {3}D retire {3}R restart {3}\/ filter/);
  assert.match(footer(on(here(), STOPPED)), /^ X stop {3}D retire {3}S start {3}\/ filter/);
  assert.match(footer(on(here(), HALF)), /^ D retire {3}\/ filter/);
  assert.match(footer(on(here(), SPAWNING)), /^ \/ filter/);
  // From the same reading of instanceActs as the key: the model's `actable`.
  for (const name of [RUN, STOPPED, UNKNOWN, HALF, SPAWNING, HERDR]) {
    const state = on(here(), name), m = model(state, { page: 19, now: 0, at: new Date(0).toISOString(), cols: 57 });
    assert.deepEqual(m.actable, ACT_VERBS.filter((verb) => actDecision(state, rowOf(state), instanceActs(rowOf(state)), verb).open), name);
  }
  // At 60 columns the acts are given up first; a key whose hint is gone still opens.
  const narrow = on(here(), RUN);
  assert.equal(footer(narrow, size(60, 15)).includes("stop"), false);
  assert.equal(press(narrow, ["X"], size(60, 15)).state.view, "act");
});

test("a tui.json that rebinds the acts: the keys it gives open them, and the capitals it took away do nothing", () => {
  const config = effectiveConfig({ keys: { stop: ["f8"], retire: [], start: ["ctrl+s"], restart: ["f9"] } });
  assert.equal(config.ok, true);
  const state = on(stateOf(observed(HERE(), { cli: ACTS_CLI }), { cli: ACTS_CLI, actions: config.actions }), STOPPED);
  assert.equal(press(state, ["f8"]).state.act.verb, "stop");
  assert.equal(press(state, ["ctrl+s"]).state.act.verb, "start");
  for (const key of ["X", "D", "S", "R"]) assert.deepEqual([press(state, [key]).state.view, press(state, [key]).effects], ["instances", []], key);
  assert.match(draw(state, S120).lines[39], /^ F8 stop {3}Ctrl\+S start {3}\/ filter/, "the footer names the keys given, and no hint for an unbound act");
});

test("the help lists the four acts with their keys, in the instances view, and the rules of a confirmation under them", () => {
  const lines = draw(press(here(), ["?"]).state, size(100, 90)).lines.map((line) => line.trim());
  for (const [key, said] of [["X", "stop the selected agent, after a confirmation"], ["D", "retire the selected agent, after a confirmation"], ["S", "start the selected agent as it was last launched, after a confirmation"], ["R", "restart the selected agent as it was last launched, after a confirmation"]]) {
    assert.equal(lines.some((line) => line.startsWith(`${key} `) && line.endsWith(said)), true, `${key} ${said}`);
  }
  const at = lines.findIndex((line) => line.startsWith("R ") && line.includes("restart")), open = lines.findIndex((line) => line.startsWith("Enter ") && line.includes("agent's terminal"));
  assert.equal(open < at && lines.findIndex((line) => line.startsWith("X ")) > open, true, "after open, in the order stop, retire, start, restart");
  assert.equal(lines.slice(at + 1, at + 6).join(" ").includes(ACT_RULES[0].split(":")[0]), true, "the rules under the last act");
  assert.equal(lines.some((line) => line.includes("oats instance stop") || line.includes("oats retire <instance>")), false, "no longer listed as missing");
  assert.equal(lines.some((line) => line.includes("oats session start --home <home>")), true, "another harness or model: the kernel's command");
});

// ── Another machine ──────────────────────────────────────────────────────────────────────────────

const IDENTITY = Object.freeze({ key: "github.com/acme/platform", ref: "main", keyFrom: "workspace", standalone: false, defaultTeam: Object.freeze({ label: "eng", team: "team-1" }), teams: Object.freeze({ eng: "team-1" }), teamsFrom: "observed" });
const REMOTE_CLI = Object.freeze({ ...ACTS_CLI, remote: Object.freeze(["roster", "lifecycle-plans", "session-start"]) });
const FAR = "/home/dev/Agents/acme", FAR_A = "acme-far-a", FAR_B = "acme-far-b", GARNET = "remote:garnet:acme-1";
const farRow = (name, extra = {}) => ({ instance: name, agent: "acme-dev", home: `${FAR}/agents/acme-dev/instances/${name}`, agentsRoot: `${FAR}/agents`, work: "worktree", harness: "claude", running: true, runtimeState: "running", addressable: true, ...extra });
const group = () => ({ id: "garnet:acme-1", server: "garnet", label: "garnet", registrationPresent: true, target: { workspace: FAR, sshHost: "garnet.example" }, probe: { ok: true },
  workspace: IDENTITY, agentsRoot: `${FAR}/agents`, souls: [], instances: [farRow(FAR_A), farRow(FAR_B, { addressable: false, running: false, runtimeState: "stopped" })] });
function heard(state, outcome, at) {
  const next = remoteRosterState(state.remote, outcome, at);
  const kept = next.reported === null ? { memory: state.memory, notes: state.notes } : observeIdentities({ memory: state.memory, notes: state.notes }, next.reported, at);
  return reduce(state, { roster: { remote: { remoteGroups: next.remoteGroups, rosterAnswered: next.rosterAnswered, rosterFailure: next.rosterFailure }, memory: kept.memory, notes: kept.notes, at } }).state;
}
function reporting(rows) {
  const document = { ...rosterOf(rows), workspace: { reachable: true, ...IDENTITY } }, listed = rosterRows(document, REMOTE_CLI);
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name: "acme-platform" } }, observedAt: "2026-10-11T09:59:00.000Z" },
    panelInstances(listed, listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, tmux: row.tmux }))), "2026-10-11T10:00:00.000Z");
}
const NEAR = () => [instanceRow("dev", RUN)];
const reached = () => heard(stateOf(reporting(NEAR()), { cli: REMOTE_CLI }), { envelope: { ok: true, result: { groups: [group()] } } }, "2026-10-11T10:00:10.000Z");
const lost = () => heard(reached(), { envelope: { ok: false, error: { code: "E_CLI_TIMEOUT", message: "garnet did not answer" } } }, "2026-10-11T10:00:25.000Z");

test("a row of a machine that did not answer keeps stop and retire as instanceActs answers: they open, with the machine's label, and the plan is the reachability check; a row it does not report addressable opens nothing", () => {
  const state = on(lost(), FAR_A), row = rowOf(state);
  assert.equal(row.serverUnreached, true, "premise: the machine did not answer");
  for (const verb of ["stop", "retire"]) {
    const { state: after, effects } = press(state, [KEY[verb]]);
    assert.deepEqual(openedWith(effects), [{ act: { n: after.act.n, verb, id: instanceId(row), row: row.home, label: "garnet" } }], verb);
    assert.equal(after.act.machine, "garnet");
  }
  for (const verb of ["start", "restart"]) assert.equal(press(state, [KEY[verb]]).state.view, "instances", `${verb}: not listed for a row whose state is not known`);
  const held = on(lost(), FAR_B), acts = instanceActs(rowOf(held));
  assert.ok(acts.blocked, "premise: blocked");
  assert.deepEqual(lineOf(press(held, ["X"]).state), ["", spokenAs(acts.blocked)]);
});

test("the boundary's context is the row's deployment, found by its id and never by the view that is open: a machine's entry with its group and its rows, unfiltered", () => {
  const state = on(reached(), FAR_A), id = rowOf(state).deployment.id, at = "2026-10-11T10:00:30.000Z";
  assert.equal(id, GARNET);
  const context = actContext(state, id, at);
  assert.deepEqual([context.workspace.id, context.workspace.remote, context.workspace.group.id, context.cli, context.localCwd], [GARNET, true, "garnet:acme-1", REMOTE_CLI, DEPLOYMENT]);
  assert.deepEqual(context.instances.map((row) => row.instance).sort(), [FAR_A, FAR_B], "garnet's rows, and only them");
  // A filter that hides the row, and a view opened elsewhere since the plan was read: the same answer.
  const filtered = press(state, ["/", "z", "z", "enter"]).state;
  assert.deepEqual(actContext(filtered, id, at).instances.map((row) => row.instance).sort(), [FAR_A, FAR_B]);
  const elsewhere = Object.freeze({ ...state, open: "remote:nowhere:1" });
  assert.deepEqual(actContext(elsewhere, id, at).instances.map((row) => row.instance).sort(), [FAR_A, FAR_B], "not read from state.open");
  assert.equal(actCwd(elsewhere), DEPLOYMENT, "a routed command runs from this machine's deployment");
  const local = actContext(state, DEPLOYMENT, at);
  assert.deepEqual([local.workspace.id, local.workspace.remote ?? false, local.instances.map((row) => row.instance)], [DEPLOYMENT, false, [RUN]]);
  // The real boundary admits a plan of garnet's row against it, whatever view is open when it asks.
  const selector = { instance: FAR_A, agent: "acme-dev", agentsRoot: `${FAR}/agents`, server: "garnet" };
  const asked = [];
  const boundary = createLifecycleBoundary({ terms: TERMS, invoke: async (_bin, args) => { asked.push(args); return { schemaVersion: 1, ok: false, origin: "kernel", error: { code: "E_SSH", message: "garnet: Connection timed out" } }; } });
  return boundary({ action: "plan", operation: "stop", selector, options: { recursive: true } }, () => actContext(elsewhere, id, at)).then((answer) => {
    assert.equal(asked.length, 1, "admitted: the plan read ran, with garnet's server");
    assert.equal(asked[0].server, "garnet");
    assert.equal(answer.status, "unavailable", "an unreached host answers the plan read with no plan");
  });
});

// ── The act view ─────────────────────────────────────────────────────────────────────────────────

/** A confirmation of the shared home, its request the real boundary over a fake CLI (`answer(args)`
 *  answers the apply), and the state of the TUI that opened it, told every step as the loop tells it. */
function driven(answer, { plan = (args) => envelope(stopPlan(args.choices?.recursive !== false)), operation = "stop" } = {}) {
  const ctx = boundaryContext();
  const boundary = createLifecycleBoundary({ terms: TERMS, invoke: async (_bin, args) => (args.phase === "plan" ? plan(args) : answer(args)) });
  const opened = press(on(here(), RUN), [operation === "stop" ? "X" : "D"]).state;
  const t = { state: opened, settled: 0, made: null };
  const tell = () => { if (t.made) t.state = reduce(t.state, { acted: { n: opened.act.n, confirmation: { ...t.made.state(), view: t.made.view() } } }).state; };
  t.made = createLifecycleConfirmation({ request: (body) => boundary(body, () => ctx), target: lifecycleTarget(), operation, terms: TERMS, onChange: tell, onSettled: () => { t.settled++; } });
  tell();
  return t;
}
const buttonsOf = (state) => model(state, { page: 19, now: 0, at: new Date(0).toISOString(), cols: 57 }).act.buttons;
const expectedButtons = (made, verb = "stop") => BUTTON_ORDER.filter((offer) => made.state().offers.includes(offer)).map((offer) => buttonLabel(offer, verb, made.state().phase));
const failure = (code, more = {}) => ({ schemaVersion: 1, ok: false, origin: "kernel", error: { code, message: `the kernel's ${code}`, ...more } });

test("the buttons are exactly the confirmation's offers in every phase, Cancel or Close first with the focus, then Review again, Check again, and the act (Done 3)", async () => {
  const outcomes = [
    ["complete", (args) => envelope(stopReceipt(args))],
    ["partial", (args) => envelope({ ...stopReceipt(args), ok: false, results: [{ instance: fixtureInstance.instance, home: fixtureInstance.home, ok: false, stopped: false, alreadyIdle: false, state: "running", stillRunning: [4242] }] })],
    ["refused", () => failure("E_SESSION_UNKNOWN")],
    ["unknown", () => failure("E_SOMETHING_ELSE")],
  ];
  for (const [kind, answer] of outcomes) {
    const t = driven(answer);
    assert.deepEqual([t.made.state().phase, t.state.act.phase, buttonsOf(t.state).map((b) => b.label)], ["reading", "reading", ["Cancel"]], `${kind}: reading`);
    await tick(); await tick();
    assert.equal(t.made.state().phase, "review");
    assert.deepEqual(buttonsOf(t.state).map((b) => b.label), expectedButtons(t.made), `${kind}: review`);
    assert.deepEqual(buttonsOf(t.state).map((b) => b.label), ["Cancel", "Review again", "Stop"]);
    assert.equal(buttonsOf(t.state)[0].focused, true, "the focus on Cancel");
    t.made.apply();
    assert.deepEqual(buttonsOf(t.state).map((b) => b.label), ["Close (the stop goes on)"], `${kind}: applying`);
    await tick(); await tick(); await tick();
    assert.deepEqual([t.made.state().outcome, t.state.act.outcome], [kind, kind]);
    assert.deepEqual(buttonsOf(t.state).map((b) => b.label), expectedButtons(t.made), `${kind}: settled`);
    assert.equal(buttonsOf(t.state).filter((b) => b.focused).map((b) => b.label)[0], "Close", `${kind}: the focus back on the first`);
    assert.equal(t.settled, 1, `${kind}: onSettled once`);
    // The settled view's headline is drawn as the shared home words it.
    const screen = draw(t.state, S120).lines.join("\n");
    assert.equal(screen.includes(displayLine(t.made.view().status.headline)), true, `${kind}: ${t.made.view().status.headline}`);
    assert.equal(screen.includes(displayLine(t.made.view().title)), true, `${kind}: the title`);
  }
  // A stale plan: back to review with the fresh plan and the notice; no apply.
  const stale = driven(() => failure("E_PLAN_STALE", { details: { plan: stopPlan() } }));
  await tick(); await tick(); stale.made.apply(); await tick(); await tick(); await tick();
  assert.deepEqual([stale.made.state().phase, stale.state.act.phase, buttonsOf(stale.state).map((b) => b.label)], ["review", "review", ["Cancel", "Review again", "Stop"]]);
  assert.equal(draw(stale.state, S120).lines.join("\n").includes(stale.made.state().notice.sentence), true, "the notice of a plan that changed");
  assert.equal(stale.settled, 0, "a return to review is not a settled answer");
  // A plan that could not be read: Review again and Close.
  const unavailable = driven(() => null, { plan: () => failure("E_SESSION_UNKNOWN") });
  await tick(); await tick();
  assert.deepEqual([unavailable.made.state().outcome, buttonsOf(unavailable.state).map((b) => b.label)], ["unavailable", ["Close", "Review again"]]);
  assert.equal(draw(unavailable.state, S120).lines.join("\n").includes(displayLine(unavailable.made.view().title)), true);
  // An answer that does not read: Check again and Close, never a second apply.
  const ctx = boundaryContext(), boundary = createLifecycleBoundary({ terms: TERMS, invoke: async () => envelope(stopPlan()) });
  const opened = press(on(here(), RUN), ["X"]).state;
  let state = opened, made = null;
  const tell = () => { if (made) state = reduce(state, { acted: { n: opened.act.n, confirmation: { ...made.state(), view: made.view() } } }).state; };
  made = createLifecycleConfirmation({ request: (body) => (body.action === "apply" ? Promise.resolve({ nonsense: true }) : boundary(body, () => ctx)), target: lifecycleTarget(), operation: "stop", terms: TERMS, onChange: tell });
  await tick(); await tick(); made.apply(); await tick(); await tick();
  assert.deepEqual([made.state().outcome, buttonsOf(state).map((b) => b.label)], ["invalid", ["Close", "Check again"]]);
});

test("the act view draws the plan as the shared planView gives it: the question, what will happen, the state rows, the choice; while a plan is read, the reading line and how to stop waiting", async () => {
  const t = driven((args) => envelope(stopReceipt(args)));
  let lines = draw(t.state, S120).lines.join("\n");
  assert.equal(lines.includes(displayLine(t.made.view().message)), true, "the reading line");
  assert.equal(lines.includes("Esc stops waiting."), true);
  assert.match(draw(t.state, S120).lines[39], /^ Esc Cancel {3}Enter press {3}q quit$/, "one button: no move hint");
  await tick(); await tick();
  const view = t.made.view();
  lines = draw(t.state, S120).lines.join("\n");
  for (const text of [view.question, ...view.happening.map((h) => h.text), ...view.state.rows.flatMap((r) => [r.label, r.value])]) assert.equal(lines.includes(displayLine(text)), true, text);
  const choice = view.choices.find((c) => c.offered);
  assert.equal(lines.includes(`[x] ${choice.sentence}`), true, "the choice, set");
  assert.match(lines, /> Cancel < {3}\[ Review again \] {3}\[ Stop \]/);
  assert.match(draw(t.state, S120).lines[39], /^ Esc Cancel {3}Left\/Right move {3}Enter press {3}q quit$/);
});

test("the focus moves with Left/Right and Tab/Shift+Tab only; h, l and every other printable key move nothing; Enter on Cancel closes; the act's own button takes a move and a press (Done 2)", async () => {
  const t = driven((args) => envelope(stopReceipt(args)));
  await tick(); await tick();
  let s = t.state;
  for (const key of ["h", "l", "j", "k", "x", "X", "D", "q"].filter((k) => k !== "q")) assert.equal(press(s, [key]).state.act.focus, "close", `${key} moves nothing`);
  assert.equal(press(s, ["right"]).state.act.focus, "refresh");
  assert.equal(press(s, ["tab", "tab"]).state.act.focus, "apply");
  assert.equal(press(s, ["tab", "tab", "shift+tab"]).state.act.focus, "refresh");
  assert.equal(press(s, ["right", "right", "right", "left", "left", "left"]).state.act.focus, "close", "it stops at the ends");
  // Enter on the act's button, pressed in a read of its own: the loop is asked to apply.
  const moved = reduce(reduce(s, { key: "tab", read: 1 }).state, { key: "tab", read: 1 }).state;
  assert.equal(moved.act.focus, "apply");
  assert.deepEqual(reduce(moved, { key: "enter", read: 1 }).effect, null, "a press in the same read as the move to the act: ignored");
  assert.deepEqual(reduce(moved, { key: "enter", read: 2 }).effect, { call: { n: moved.act.n, method: "apply" } }, "in the next read: pressed");
  assert.deepEqual(reduce(reduce(s, { key: "right", read: 3 }).state, { key: "enter", read: 3 }).effect, { call: { n: s.act.n, method: "refresh" } }, "Review again is no act: no guard");
  // Enter on Cancel, and Esc: the view closes and the loop closes the confirmation.
  for (const key of ["enter", "escape"]) {
    const { state: closed, effect } = reduce(s, { key, read: 4 });
    assert.deepEqual([closed.view, closed.act, effect], ["instances", null, { dismiss: s.act.n }], key);
  }
  // q still quits from the act view, and Ctrl+Z suspends.
  assert.equal(reduce(s, { key: "q" }).effect, "quit");
  assert.equal(reduce(s, { key: "ctrl+z" }).effect, "suspend");
  s = press(s, ["?"]).state;
  assert.equal(s.view, "act", "no help over a confirmation");
});

test("Space sets the plan's choice through the confirmation, which reads a new plan for it", async () => {
  const t = driven((args) => envelope(stopReceipt(args)));
  await tick(); await tick();
  const { effects } = press(t.state, ["space"]);
  assert.deepEqual(effects, [{ call: { n: t.state.act.n, method: "setChoice", args: ["recursive", false] } }]);
  t.made[effects[0].call.method](...effects[0].call.args);
  assert.equal(t.made.state().phase, "reading");
  assert.equal(t.state.act.plan !== null, true, "the plan on screen stays while the new one is read");
  await tick(); await tick();
  assert.equal(t.made.state().phase, "review");
  assert.equal(t.made.view().choices.find((c) => c.id === "recursive").value, false);
  assert.equal(draw(t.state, S120).lines.join("\n").includes(`[ ] ${t.made.view().choices[0].sentence}`), true);
});

test("Esc while applying closes the view: the apply goes on, and its answer, when it comes, changes nothing on screen", async () => {
  let release;
  const t = driven((args) => new Promise((resolve) => { release = () => resolve(envelope(stopReceipt(args))); }));
  await tick(); await tick();
  t.made.apply(); await tick();
  assert.equal(t.made.state().phase, "applying");
  const { state: closed, effect } = reduce(t.state, { key: "escape" });
  assert.deepEqual([closed.view, closed.act, effect], ["instances", null, { dismiss: t.state.act.n }]);
  t.made.close();
  t.state = closed;
  release(); await tick(); await tick(); await tick();
  assert.equal(t.state, closed, "nothing told after close");
  assert.equal(t.settled, 0);
  // An answer of a closed confirmation that still reached the store: dropped.
  assert.equal(reduce(closed, { acted: { n: 1, confirmation: { phase: "settled", outcome: "complete", offers: ["close"], view: {} } } }).state, closed);
});

test("a settled answer's blocks are drawn: the details with the kernel's line through kernelLines, a running apply's start time, the TUI's own next step", () => {
  const state = press(on(here(), RUN), ["D"]).state, n = state.act.n;
  const view = { kind: "refused", title: "t", status: { headline: "the headline", more: [{ quote: "the kernel's quote" }], next: "retire-with-force", code: "E_LIFECYCLE_BUSY" },
    blocks: [{ type: "details", reason: { code: "E_LIFECYCLE_BUSY", detail: "held by pid 4242" }, bare: false }, { type: "lines", lines: [{ text: "Recovery copy saved at", path: "/home/u/rec" }] }], uncertain: false };
  const since = Date.parse("2026-10-11T09:41:00.000Z");
  const settled = reduce(state, { acted: { n, confirmation: { phase: "settled", outcome: "refused", offers: ["refresh", "close"], notice: null, running: { target: { instance: RUN }, operation: "retire", since }, view } } }).state;
  const lines = draw(settled, S120).lines.map((line) => line.trim());
  for (const line of [...kernelLines("the kernel's quote", undefined, TERMS), "Details: E_LIFECYCLE_BUSY", ...kernelLines("held by pid 4242", undefined, TERMS), "Recovery copy saved at ~/rec",
    `Check the process it names, then retire it with \`oats retire ${RUN} --force\`.`, "Started at 09:41."]) assert.equal(lines.includes(line), true, line);
});

// ── Start and restart ────────────────────────────────────────────────────────────────────────────

test("a start opens the TUI's own confirmation: its question and line, the machine and home; the press after a move asks the loop to start, and the view then says it is starting with Close (the start goes on) (Done 4)", () => {
  const state = on(here(), STOPPED), row = rowOf(state);
  const open = press(state, ["S"]).state;
  let lines = draw(open, S120).lines.map((line) => line.trim());
  for (const line of [`Start ${STOPPED}?`, ACT_WORDS.what("start"), `home  ${shortPath(row.home, { home: open.home })}`]) assert.equal(lines.includes(line), true, `${line}\n${lines.join("\n")}`);
  assert.match(lines.join("\n"), /> Cancel < {3}\[ Start \]/);
  assert.equal(draw(press(on(here(), RUN), ["R"]).state, S120).lines.some((l) => l.trim() === "Its session is ended and started again: what it is doing is interrupted. Save any work in progress first."), true, "the restart's line");
  const pressed = reduce(reduce(open, { key: "right", read: 1 }).state, { key: "enter", read: 2 });
  assert.deepEqual(pressed.effect, { start: { n: open.act.n, verb: "start", id: instanceId(row), row } });
  lines = draw(pressed.state, S120).lines.map((line) => line.trim());
  assert.equal(lines.includes(`Starting ${STOPPED}…`), true);
  assert.match(lines.join("\n"), /> Close \(the start goes on\) </);
  // The answer settles it with Close only, and asks for a live read; one for a closed view asks the read and changes nothing else.
  const answered = reduce(pressed.state, { acted: { n: open.act.n, answer: { ok: true, result: {} } } });
  assert.deepEqual([answered.state.act.phase, answered.state.act.offers, answered.effect], ["settled", ["close"], { refresh: { live: true } }]);
  assert.equal(draw(answered.state, S120).lines.some((l) => l.trim() === `${STOPPED} started.`), true);
  const closed = reduce(pressed.state, { key: "escape" }).state, late = reduce(closed, { acted: { n: open.act.n, answer: { ok: true, result: {} } } });
  assert.deepEqual([late.state.act, late.effect], [null, { refresh: { live: true } }]);
});

/** The real startInstance over a fake CLI: `exec` answers with `printed` (an envelope, or a function of the argv). */
async function started(printed, { restart = false, wait } = {}) {
  const row = rowOf(on(here(), restart ? RUN : STOPPED));
  const exec = (bin, argv, options, callback) => { if (printed !== null) setImmediate(() => callback(null, JSON.stringify(typeof printed === "function" ? printed(argv) : printed), "")); return { pid: 1 }; };
  return { row, answer: await startInstance(ACTS_CLI, row, {}, { restart, verifyHome: () => row.home, exec, terms: TERMS, ...(wait !== undefined ? { wait, after: (ms, fn) => { setImmediate(fn); return () => {}; } } : {}) }) };
}
const shownLines = (lines) => lines.map((line) => (line.said ? words(line.said) : line.text));

test("every answer of the start rule, from the real startInstance over a fake CLI, is shown as the table says (Done 4)", async () => {
  // ok
  let { row, answer } = await started({ schemaVersion: 1, ok: true, result: { started: true } });
  assert.deepEqual(shownLines(startOutcome(row.instance, "start", answer)), [`${row.instance} started.`]);
  ({ row, answer } = await started({ schemaVersion: 1, ok: true, result: { started: true } }, { restart: true }));
  assert.deepEqual(shownLines(startOutcome(row.instance, "restart", answer)), [`${row.instance} restarted.`]);
  // ok, the channel option ignored: the shared notice.
  const ignored = { started: true, launchPrompts: { status: "flag-ignored", reason: "channels-unavailable" }, warnings: ["claude: --dangerously-load-development-channels ignored"] };
  ({ row, answer } = await started({ schemaVersion: 1, ok: true, result: ignored }));
  const notice = flagIgnoredNotice(row.instance, launchFlagIgnored(answer.result));
  assert.deepEqual(shownLines(startOutcome(row.instance, "start", answer)), [notice.headline, ...notice.detail.split("\n")]);
  // refused: the kernel's busy lock, with its message under its speaker.
  ({ row, answer } = await started({ schemaVersion: 1, ok: false, error: { code: "E_SESSION_START_BUSY", message: "the start lock is held" } }));
  assert.equal(answer.outcome, "refused");
  assert.deepEqual(shownLines(startOutcome(row.instance, "start", answer)), [answer.sentence, ...kernelLines(answer.detail, undefined, TERMS)]);
  // the wait ended: the TUI's words.
  ({ row, answer } = await started(null, { wait: 1 }));
  assert.equal(answer.code, "E_START_UNCONFIRMED");
  assert.deepEqual(shownLines(startOutcome(row.instance, "start", answer)), [`OATS didn't confirm the start of ${row.instance}. It may still be running: the list shows it when it is.`]);
  // stopped at a launch prompt: the shared retained-start message.
  const details = { instance: STOPPED, home: rowOf(on(here(), STOPPED)).home, launched: false, launchPrompts: { status: "blocked", reason: "blocked: unexpected prompt", answers: [], receipt: [] } };
  ({ row, answer } = await started({ schemaVersion: 1, ok: false, error: { code: "E_SPAWN_INCOMPLETE", message: "retained", details } }));
  assert.ok(answer.incomplete, "premise: incomplete");
  assert.deepEqual(shownLines(startOutcome(row.instance, "start", answer)), [retainedStartMessage(row.instance, answer.incomplete), ...kernelLines(answer.detail, undefined, TERMS)]);
  // any other uncertain answer: its code, and the kernel's message.
  ({ row, answer } = await started({ schemaVersion: 1, ok: false, error: { code: "E_SOMETHING", message: "it broke" } }));
  assert.deepEqual([answer.outcome, answer.sentence], ["uncertain", null]);
  assert.deepEqual(shownLines(startOutcome(row.instance, "start", answer)), ["E_SOMETHING", ...kernelLines("it broke", undefined, TERMS)]);
  // a refusal before the CLI ran (the row changed: running now) carries the gate's sentence.
  const running = rowOf(on(here(), RUN));
  answer = await startInstance(ACTS_CLI, running, {}, { verifyHome: () => running.home, exec: () => { throw new Error("never"); }, terms: TERMS });
  assert.deepEqual(shownLines(startOutcome(running.instance, "start", answer)), [startGate(ACTS_CLI, running, {}, TERMS).sentence]);
  // no answer at all (the call was refused by the loop): no more than unconfirmed.
  assert.deepEqual(shownLines(startOutcome("x", "start", null)), [words(ACT_WORDS.unconfirmed("x"))]);
});

test("while a start of this run is running, no act of that row opens, whether or not the TUI still waits; when its child closes the row is read again and its acts open (Done 7)", () => {
  const state = on(here(), STOPPED), id = instanceId(rowOf(state));
  const spawned = reduce(state, { acted: { spawned: { id, verb: "start" }, at: 1 } }).state;
  for (const key of ["X", "D", "S", "R"]) {
    const { state: after, effects } = press(spawned, [key]);
    assert.deepEqual([after.view, effects, lineOf(after)], ["instances", [], [`The start of ${STOPPED} is still running.`]], key);
  }
  assert.deepEqual(model(spawned, { page: 19, now: 0, at: new Date(0).toISOString(), cols: 57 }).actable, [], "and the footer names none");
  const other = on(spawned, RUN);
  assert.equal(press(other, ["X"]).state.view, "act", "another row is not held");
  const closed = reduce(spawned, { acted: { closed: id } });
  assert.deepEqual(closed.effect, { refresh: { live: true } });
  assert.equal(press(closed.state, ["S"]).state.view, "act");
  const restarting = reduce(state, { acted: { spawned: { id, verb: "restart" }, at: 1 } }).state;
  assert.deepEqual(lineOf(press(restarting, ["X"]).state), [`The restart of ${STOPPED} is still running.`]);
});

test("a view that goes away under an open confirmation closes it: the loop is told to close the confirmation, and what it sent goes on", () => {
  // garnet serves another workspace: its rows are a view of their own.
  const ledger = { ...group(), workspace: { ...IDENTITY, key: "github.com/acme/ledger" } };
  const read = heard(stateOf(reporting(NEAR()), { cli: REMOTE_CLI }), { envelope: { ok: true, result: { groups: [ledger] } } }, "2026-10-11T10:00:10.000Z");
  const there = on(press(read, ["w", "j", "enter"]).state, FAR_A);
  assert.equal(there.open, GARNET);
  const opened = press(there, ["X"]).state;
  assert.equal(opened.view, "act");
  // An answer that no longer lists garnet: no view holds what was open.
  const next = remoteRosterState(opened.remote, { envelope: { ok: true, result: { groups: [] } } }, "2026-10-11T10:00:40.000Z");
  const gone = reduce(opened, { roster: { remote: { remoteGroups: next.remoteGroups, rosterAnswered: next.rosterAnswered, rosterFailure: next.rosterFailure }, memory: opened.memory, notes: opened.notes, at: "2026-10-11T10:00:40.000Z" } });
  assert.deepEqual([gone.state.view, gone.state.act, gone.state.open, gone.effect], ["switcher", null, null, { offer: true, dismiss: opened.act.n }]);
});
