process.env.TZ = "UTC";
// Spawning an agent in the store and the model (docs/tui.md, "Spawning an agent"; Spec 6-spawn):
// the keys that open the prompt and from where, the picker, the preview's focus ring and fields,
// the paste guard, one spawn at a time, each outcome's line and what follows it, and the open of
// the new row's terminal. What the loop does with the shared preview, apply and transaction is
// main.test.mjs's; how the prompt is drawn is spawn-view.test.mjs's.
import test from "node:test";
import assert from "node:assert/strict";
import { SPAWN_NEXT, defaultSpawnChoices, instanceId, observeIdentities, observedEntry, panelInstances, remoteRosterState, rosterRows } from "../lib/client.mjs";
import { SPAWN_NEXT_WORDS, SPAWN_WORDS, model, outcomeOf, paletteItems, roster, soulsOf, spawnContext, spawnLine } from "../lib/model.mjs";
import { keyLabel } from "../lib/actions.mjs";
import { reduce } from "../lib/store.mjs";
import { CLI, DEPLOYMENT, catalogEntry, catalogSoul, instanceRow, observed, rosterOf, soulsTold, stateOf, took } from "./helpers.mjs";

/** A kernel that reports whether a soul's spawn would be refused here (desktop-facts). */
const FACTS_CLI = Object.freeze({ ...CLI, features: Object.freeze([...CLI.features, "desktop-facts"]) });
const AT = Object.freeze({ page: 19, extent: 40, room: 19, cols: 38 });
const WHEN = "2026-10-11T10:00:30.000Z";
let reads = 0;
/** A key in a read of its own (or in `read`); a one-character id types itself. */
const key = (state, id, read = ++reads) => reduce(state, { key: id, ...(id === "space" ? { text: " " } : [...id].length === 1 ? { text: id } : {}), read, ...AT });
/** Keys, each in a read of its own, or all in one (`{ read }`). -> the last step, with every effect. */
function keys(state, ids, { read = null } = {}) {
  let step = { state, effect: null };
  const effects = [];
  for (const id of ids) { step = key(step.state, id, read ?? ++reads); if (step.effect) effects.push(step.effect); }
  return { ...step, effects };
}
const typing = (text) => [...text];
/** What the frame is handed. */
const view = (state) => model(state, { page: 19, now: Date.parse(WHEN), at: WHEN, cols: 38 });
const ownText = (parts) => parts.map((part) => part.own ?? part.shown ?? "").join("");

const ROWS = [instanceRow("dev", "dev-a"), instanceRow("reviewer", "reviewer-a")];
const SOULS = [catalogSoul("dev"), catalogSoul("reviewer"), catalogSoul("ops", { spawnable: false, problem: { message: "No launch configuration matches." } })];
/** The workspace read, its catalog held, nothing selected. */
const base = () => soulsTold(stateOf(observed(ROWS, { cli: FACTS_CLI }), { cli: FACTS_CLI }), catalogEntry(SOULS));
/** The same, with `name` selected in the list. */
const on = (state, name) => ({ ...state, selected: instanceId(roster(state).instances.find((row) => row.instance === name)) });

const DECISION = Object.freeze({ spawnDecisionApi: 1, digest: "d".repeat(64) });
/** A preview the shared preview answered (spawn-preview.mjs `read`): `data` as previewData gives it. */
const previewData = (extra = {}) => ({
  instance: "dev-2", home: `${DEPLOYMENT}/agents/dev/instances/dev-2`, work: "worktree", branch: "agents/dev-2", harness: "claude", model: "claude-opus-5-5", modelSource: "soul",
  teams: [{ label: "eng" }], defaultTeam: { label: "eng" }, warnings: ["The okf capability is new here."], modules: [{ name: "oats.okf", layer: "knowledge", from: { kind: "package" }, composedFrom: "soul" }],
  launchPromptAnswers: { awebDevelopmentChannel: false }, decision: DECISION, ...extra,
});
const available = (data = previewData()) => ({ spawnPreviewViewApi: 1, status: "available", target: null, data, reason: null });
/** The loop's answer to the preview read the prompt asked last, without a frame written since. */
const landed = (state, answer = available()) => reduce(state, { spawnRead: { n: state.spawn.n, answer } }).state;
/** The same answer, and a frame that shows it written after read `read` (the loop's `spawnDrawn`,
 *  told only when the frame drew the ready Spawn button). */
const answered = (state, answer = available(), read = reads) => {
  const after = landed(state, answer);
  return after.spawn?.status === "shown" ? reduce(after, { spawnDrawn: { n: after.spawn.n, read } }).state : after;
};
/** n, the soul's name typed, Enter, and the preview answered: each in a read of its own. */
function previewOf(state = base(), soul = "dev") {
  const step = keys(state, ["n", ...typing(soul), "enter"]);
  return answered(step.state);
}

test("n in the list opens the soul picker over it and wants the catalog; the picker filters with the palette's score, moves, and Enter picks a soul: its preview is read with the shared defaults", () => {
  const opened = key(base(), "n");
  assert.deepEqual([opened.state.spawn.step, opened.state.souls.wanted, opened.effect], ["picker", true, { souls: "settle" }]);
  assert.deepEqual(view(opened.state).spawn.rows.map((row) => row.name), ["dev", "ops", "reviewer"], "the shared rows' order");
  const filtered = keys(opened.state, typing("rv"));
  assert.deepEqual(view(filtered.state).spawn.rows.map((row) => row.name), ["reviewer"], "a subsequence of the name");
  const moved = keys(opened.state, ["down", "down"]);
  assert.equal(view(moved.state).spawn.rows.find((row) => row.selected).name, "reviewer");
  const picked = key(moved.state, "enter");
  assert.equal(picked.state.spawn.step, "preview");
  assert.deepEqual(picked.effect, { spawnPreview: { n: 1, workspace: DEPLOYMENT, request: { action: "preview", selector: { soul: "reviewer", agentsRoot: `${DEPLOYMENT}/agents` }, choices: defaultSpawnChoices() } } });
  assert.deepEqual([view(picked.state).spawn.status, view(picked.state).spawn.enter], ["reading", null], "nothing to spawn while it is read");
});

test("a soul whose spawn would be refused is listed with its refusal and is not picked; a catalog not read yet says so and lists nothing", () => {
  const opened = keys(base(), ["n", ...typing("ops")]);
  const row = view(opened.state).spawn.rows[0];
  assert.deepEqual([row.name, row.refused], ["ops", true]);
  assert.match(row.refusal, /No launch configuration matches/);
  assert.deepEqual([key(opened.state, "enter").state.spawn.step, key(opened.state, "enter").effect], ["picker", null], "Enter picks nothing");
  const unread = key(stateOf(observed(ROWS)), "n").state;
  assert.deepEqual([view(unread).spawn.state, view(unread).spawn.rows], ["reading", []]);
  assert.equal(key(unread, "enter").state.spawn.step, "picker");
});

test("the paste guard: n, a soul's name, Enter and Enter in one read open the picker and stop there; read by read, an Enter before the preview landed, or in the read it landed in, spawns nothing", () => {
  const pasted = keys(base(), ["n", ...typing("dev"), "enter", "enter"], { read: ++reads });
  assert.deepEqual([pasted.state.spawn.step, pasted.state.spawn.query], ["picker", "dev"], "the Enters came in the read that opened it");
  assert.deepEqual(pasted.effects, [{ souls: "settle" }]);
  // Read by read: Enter picks, and the next Enter, while the preview is read, does nothing.
  const picked = keys(base(), ["n", ...typing("dev"), "enter"]);
  const early = key(picked.state, "enter");
  assert.deepEqual([early.effect, early.state.spawn.status], [null, "reading"], "an Enter while it is read");
  // The answer landed, and no frame showing it was written (the output was blocked): Spawn is not
  // armed, in any later read.
  const unseen = landed(picked.state);
  assert.deepEqual([unseen.spawn.status, key(unseen, "enter").effect], ["shown", null], "an answer not yet drawn arms nothing");
  // The frame that shows it is written after read R; an Enter in R itself is ignored.
  const shown = reduce(unseen, { spawnDrawn: { n: unseen.spawn.n, read: reads } }).state;
  assert.equal(key(shown, "enter", reads).effect, null, "an Enter of the read the preview was drawn in");
  assert.deepEqual(Object.keys(key(shown, "enter").effect), ["spawn"], "an Enter of a later read spawns");
  assert.equal(reduce(shown, { key: "enter", ...AT }).effect, null, "an Enter of no numbered read spawns nothing");
  // A frame of another read's preview, or of a preview that is not ready, arms nothing.
  assert.equal(reduce(unseen, { spawnDrawn: { n: unseen.spawn.n - 1, read: reads } }).state.spawn.shownIn, null);
  assert.equal(reduce(picked.state, { spawnDrawn: { n: picked.state.spawn.n, read: reads } }).state.spawn.shownIn, null, "still read");
  // A paste is never an Enter, and goes nowhere but a field.
  assert.equal(reduce(shown, { paste: "\n\n", read: ++reads }).effect, null);
});

test("Enter on Spawn closes the prompt and asks the loop to spawn the decision on screen, with the prepare body the TUI builds; the line says Spawning <name>… until the outcome", () => {
  const step = key(previewOf(), "enter");
  const selector = { soul: "dev", agentsRoot: `${DEPLOYMENT}/agents` };
  assert.deepEqual(step.effect, { spawn: { workspace: DEPLOYMENT, selector, input: { action: "prepare", selector, choices: defaultSpawnChoices(), task: "" }, decision: DECISION, name: "dev-2" } });
  assert.notEqual(step.effect.spawn.decision, DECISION, "a copy of the decision: nothing of the store's goes out");
  assert.deepEqual([step.state.spawn, step.state.spawning.name, step.state.spawning.phase], [null, "dev-2", "submitting"]);
  assert.equal(ownText(outcomeOf(step.state).said), "Spawning dev-2…");
  const submitted = reduce(step.state, { spawnProgress: { event: "submitted" } }).state;
  assert.deepEqual([submitted.spawning.phase, ownText(view(submitted).outcome.said)], ["spawning", "Spawning dev-2…"]);
});

test("one spawn at a time: while one is under way n and N say so on the line and open nothing; the TUI goes on working meanwhile", () => {
  const spawning = key(previewOf(), "enter").state;
  for (const id of ["n", "N"]) {
    const step = key(on(spawning, "dev-a"), id);
    assert.deepEqual([step.state.spawn, step.effect], [null, null], id);
    assert.deepEqual(step.state.outcome.said, SPAWN_WORDS.busy("dev-2"), id);
  }
  assert.equal(key(spawning, "j").state.selected !== null, true, "the list still moves");
});

test("N on a selected instance opens the preview of its soul, with Esc back to the list; in the Souls view n and N start from the selected soul; the leader's n from a terminal's focus opens the picker and leaves the terminal", () => {
  const another = key(on(base(), "reviewer-a"), "N");
  assert.deepEqual([another.state.spawn.step, another.state.spawn.soul.name, another.state.spawn.back], ["preview", "reviewer", "list"]);
  assert.deepEqual(another.effect.spawnPreview.request.selector, { soul: "reviewer", agentsRoot: `${DEPLOYMENT}/agents` });
  assert.equal(another.effect.souls, "settle");
  assert.equal(key(another.state, "escape").state.spawn, null, "Esc on Spawn: back to the list");
  // The Souls view: both from its selected soul.
  const souls = keys(base(), ["2", "j", "j"]).state;
  for (const id of ["n", "N"]) {
    const step = key(souls, id);
    assert.deepEqual([step.state.spawn.step, step.state.spawn.soul.name, step.state.spawn.back, step.state.view], ["preview", "reviewer", "list", "souls"], id);
  }
  // A terminal with the focus: the leader, then n in a later read.
  const opened = key(on(base(), "dev-a"), "enter").state;
  assert.equal(opened.terminal.focus, "terminal");
  const lead = reduce(opened, { back: true, read: ++reads, rest: false }).state;
  const led = key(lead, "n");
  assert.deepEqual([led.state.spawn.step, led.state.terminal.focus], ["picker", "list"]);
  // And N from there: another of the open terminal's soul.
  const ledN = key(reduce(opened, { back: true, read: ++reads, rest: false }).state, "N");
  assert.equal(ledN.state.spawn.soul.name, "dev");
});

test("the leader's n and N from the Souls view start from its selected soul, not the list's selection: from its list, its filter and its detail", () => {
  // dev-a selected in the list; reviewer in the Souls view.
  const souls = keys(on(base(), "dev-a"), ["2", "j", "j"]).state;
  assert.equal(soulsOf(souls).selected.name, "reviewer");
  const led = (state, id) => key(key(state, state.leaderKey).state, id);
  const from = {
    list: souls,
    filter: keys(souls, ["/", ...typing("rev")]).state,
    detail: keys(souls, ["tab"]).state,
  };
  for (const [where, state] of Object.entries(from)) {
    for (const id of ["n", "N"]) {
      const step = led(state, id);
      assert.deepEqual([step.state.spawn?.step, step.state.spawn?.soul?.name, step.state.spawn?.back], ["preview", "reviewer", "list"], `${where}, the leader then ${id}`);
      assert.deepEqual(step.effect.spawnPreview.request.selector, { soul: "reviewer", agentsRoot: `${DEPLOYMENT}/agents` }, `${where}, ${id}`);
    }
  }
});

test("an answer to a prompt closed since is never taken by the next one: preview reads are numbered in the run", () => {
  // N of reviewer-a, closed with Esc while its preview is read; then n, dev picked.
  const first = key(on(base(), "reviewer-a"), "N");
  const asked = first.effect.spawnPreview.n;
  const closed = key(first.state, "escape").state;
  assert.equal(closed.spawn, null);
  const second = keys(closed, ["n", ...typing("dev"), "enter"]);
  const now = second.state.spawn;
  assert.deepEqual([now.soul.name, now.status], ["dev", "reading"]);
  assert.notEqual(now.n, asked, "a number of its own");
  // The first prompt's answer lands: the dev prompt does not take it, and Spawn stays off.
  const late = reduce(second.state, { spawnRead: { n: asked, answer: available(previewData({ instance: "reviewer-2", home: `${DEPLOYMENT}/agents/reviewer/instances/reviewer-2` })) } }).state;
  assert.deepEqual([late.spawn.status, late.spawn.data, view(late).spawn.ready], ["reading", null, false]);
  // Its own answer is taken.
  assert.equal(answered(late).spawn.data.instance, "dev-2");
});

test("N of an instance whose soul the catalog has not been read for waits for it, then reads its preview; a catalog without it says the shared words", () => {
  const unread = stateOf(observed(ROWS, { cli: FACTS_CLI }), { cli: FACTS_CLI });
  const waiting = key(on(unread, "dev-a"), "N");
  assert.deepEqual([waiting.state.spawn.soul, waiting.state.spawn.status, waiting.effect], [null, "souls", { souls: "settle" }]);
  const heard = reduce(waiting.state, { souls: { id: DEPLOYMENT, entry: catalogEntry(SOULS), reading: false } });
  assert.deepEqual([heard.state.spawn.soul.name, heard.effect.spawnPreview.request.selector.soul], ["dev", "dev"]);
  const without = reduce(waiting.state, { souls: { id: DEPLOYMENT, entry: catalogEntry([catalogSoul("reviewer")]), reading: false } }).state;
  assert.equal(without.spawn.status, "failed");
  assert.equal(ownText(view(without).spawn.problem.said), "The soul dev isn't in this workspace's catalog: there is nothing to spawn.");
  assert.deepEqual([view(without).spawn.enter, key(without, "enter").effect], [null, null], "nothing to read again");
});

test("the focus ring: Tab moves Spawn, name, child of, each fold, and back to Spawn; Shift+Tab goes back; Esc on a field gives the focus to Spawn, and Esc on Spawn goes back to the picker", () => {
  const preview = previewOf(on(base(), "dev-a"));
  const ring = [];
  let state = preview;
  for (let i = 0; i < 6; i++) { ring.push(view(state).spawn.focus); state = key(state, "tab").state; }
  assert.deepEqual(ring, ["spawn", "name", "child", "fold:prompts", "fold:warnings", "fold:modules"]);
  assert.equal(view(state).spawn.focus, "spawn", "and round");
  assert.equal(view(key(preview, "shift+tab").state).spawn.focus, "fold:modules");
  const enter = (s) => view(s).spawn.enter;
  assert.deepEqual([enter(preview), enter(keys(preview, ["tab"]).state), enter(keys(preview, ["tab", "tab"]).state), enter(keys(preview, ["tab", "tab", "tab"]).state)], ["spawn", "keep the name", "child of", "open"]);
  const onFold = keys(preview, ["tab", "tab", "tab", "tab"]).state;
  const opened = key(onFold, "enter").state;
  assert.deepEqual([opened.spawn.folds, enter(opened), view(opened).spawn.folds.find((f) => f.key === "warnings").open], [["warnings"], "close", true]);
  assert.equal(key(opened, "escape").state.spawn.focus, "spawn", "Esc on a fold");
  const back = key(preview, "escape").state;
  assert.deepEqual([back.spawn.step, back.spawn.query], ["picker", "dev"], "Esc on Spawn: the picker, as it was left");
  // Without a selected instance of this machine there is no parent to offer.
  const alone = previewOf({ ...base(), selected: null });
  assert.equal(alone.spawn.anchor, null);
  assert.equal(view(keys(alone, ["tab", "tab"]).state).spawn.focus, "fold:prompts");
});

test("the name: typed on its field, the characters of an instance name only; Enter keeps it and reads the preview again with it as the purpose, and Spawn is not ready until that read lands; Esc puts back the name it was read with", () => {
  const preview = previewOf();
  const typed = keys(preview, ["tab", ...typing("api x/Z"), "backspace"]).state;
  assert.equal(typed.spawn.name, "apixZ".slice(0, -1), "a space and a slash are not taken");
  assert.equal(key(typed, "q").state.spawn.name, "apixq", "q is the name's, not quit");
  const kept = key(typed, "enter");
  assert.deepEqual(kept.effect.spawnPreview.request.choices, { ...defaultSpawnChoices(), purpose: "apix" });
  assert.deepEqual([kept.state.spawn.focus, view(kept.state).spawn.ready, view(kept.state).spawn.enter], ["spawn", false, null]);
  assert.equal(key(kept.state, "enter").effect, null, "not ready: the preview on screen was read for another name");
  const landed = answered(kept.state, available(previewData({ instance: "dev-apix" })));
  assert.deepEqual([view(landed).spawn.ready, view(landed).spawn.facts.identity[0].text], [true, "apix"]);
  assert.equal(key(landed, "enter").effect.spawn.input.choices.purpose, "apix");
  const reverted = keys(landed, ["tab", "z", "z", "escape"]).state;
  assert.deepEqual([reverted.spawn.name, reverted.spawn.focus, view(reverted).spawn.ready], ["apix", "spawn", true]);
  // Leaving the field by Tab keeps a changed name, and reads it.
  assert.equal(keys(landed, ["tab", "z", "tab"]).effects.at(-1).spawnPreview.request.choices.purpose, "apixz");
  // A paste on the field: its first line, when it is a name.
  assert.equal(reduce(key(preview, "tab").state, { paste: "lead\nmore", read: ++reads }).state.spawn.name, "lead");
});

test("child of: Enter on it toggles between none and the instance selected when the prompt opened, and reads the preview again with the shared relation", () => {
  const preview = previewOf(on(base(), "dev-a"));
  const child = keys(preview, ["tab", "tab", "enter"]);
  assert.deepEqual(child.effect.spawnPreview.request.choices.relation, { kind: "child", anchor: { instance: "dev-a", agent: "dev", agentsRoot: `${DEPLOYMENT}/agents`, server: null } });
  assert.deepEqual([view(child.state).spawn.fields.child.on, view(child.state).spawn.fields.child.label, view(child.state).spawn.enter], [true, "dev-a", "no parent"]);
  const none = key(child.state, "enter");
  assert.deepEqual(none.effect.spawnPreview.request.choices.relation, { kind: "unrelated" });
});

test("a preview read that failed says the shared fact and the TUI's words for what follows; Enter on Spawn reads it again; a workspace that moved under the read is read again at once", () => {
  const picked = keys(base(), ["n", ...typing("dev"), "enter"]).state;
  const failed = answered(picked, { status: "unavailable", target: null, data: null, reason: { code: "E_PREVIEW_UNAVAILABLE", message: "too old" } });
  const v = view(failed).spawn;
  assert.deepEqual([v.status, v.ready, v.enter], ["failed", false, "read again"]);
  assert.match(ownText(v.problem.said), /^Spawning needs a newer OATS\. Update OATS with `oats update`, then try again\.$/);
  assert.equal(key(failed, "enter").effect.spawnPreview.n, failed.spawn.n + 1);
  const moved = reduce(picked, { spawnRead: { n: picked.spawn.n, answer: { status: "unavailable", reason: { code: "E_TARGET_CHANGED" } }, read: reads } });
  assert.deepEqual([moved.state.spawn.status, moved.effect.spawnPreview.n], ["reading", picked.spawn.n + 1]);
  // An answer to an earlier read is not taken.
  assert.equal(reduce(moved.state, { spawnRead: { n: picked.spawn.n, answer: available(), read: reads } }).state.spawn.status, "reading");
});

/** The spawn pressed, and the transaction's outcome told. */
const pressed = (state = previewOf()) => key(state, "enter").state;
const done = (state, outcome) => reduce(state, { spawnDone: outcome });
const createdView = (extra = {}) => ({ status: "complete", receipt: { instance: "dev-2", agent: "dev", home: `${DEPLOYMENT}/agents/dev/instances/dev-2`, launched: true }, reason: null, ...extra });
const CREATED = Object.freeze({ kind: "created", view: createdView(), reason: null, instance: "dev-2", home: `${DEPLOYMENT}/agents/dev/instances/dev-2` });

test("created and launched: the instances are read at once; when the new row appears it is selected and its terminal opens with the focus, in the Instances view, as the palette's open does", () => {
  const step = done(pressed(), CREATED);
  assert.deepEqual([step.state.spawning, step.state.arriving.instance, step.effect], [null, "dev-2", { refresh: { live: true } }]);
  assert.equal(outcomeOf(step.state), null, "nothing to say yet: the row says it");
  const arrived = reduce(step.state, { id: DEPLOYMENT, entry: observed([...ROWS, instanceRow("dev", "dev-2")], { cli: FACTS_CLI }), number: 2 });
  const row = roster(arrived.state).instances.find((each) => each.instance === "dev-2");
  assert.deepEqual([arrived.state.selected, arrived.state.terminal.id, arrived.state.terminal.focus, arrived.state.arriving], [instanceId(row), instanceId(row), "terminal", null]);
  assert.equal(arrived.effect.open.id, instanceId(row));
  // From the Souls view too: the Instances view, then the open.
  const fromSouls = done(pressed(previewOf(keys(base(), ["2"]).state)), CREATED).state;
  assert.equal(fromSouls.view, "souls");
  const there = reduce(fromSouls, { id: DEPLOYMENT, entry: observed([...ROWS, instanceRow("dev", "dev-2")], { cli: FACTS_CLI }), number: 2 }).state;
  assert.deepEqual([there.view, there.terminal?.focus], ["instances", "terminal"]);
});

test("created, and the row not there after two reads (or there and not running): the line says it is not visible yet, and nothing opens later on its own", () => {
  const step = done(pressed(), CREATED).state;
  const one = took(step, observed(ROWS, { cli: FACTS_CLI }), 2);
  assert.deepEqual([one.arriving.reads, one.outcome], [1, null]);
  const two = took(one, observed([...ROWS, instanceRow("dev", "dev-2", { running: false, runtimeState: "stopped", tmux: null })], { cli: FACTS_CLI }), 3);
  assert.equal(two.arriving, null);
  assert.equal(ownText(two.outcome.said), "Created dev-2 — not yet visible as a running session. Open it from the list with Enter.");
  assert.equal(took(two, observed([...ROWS, instanceRow("dev", "dev-2")], { cli: FACTS_CLI }), 4).terminal, null);
});

test("created while the person is busy elsewhere (the palette open): nothing opens over it, and the line says it was created and how to open it", () => {
  const step = done(pressed(), CREATED).state;
  const busy = key(step, "ctrl+k").state;
  const arrived = took(busy, observed([...ROWS, instanceRow("dev", "dev-2")], { cli: FACTS_CLI }), 2);
  assert.deepEqual([arrived.terminal, arrived.palette !== null, arrived.arriving], [null, true, null]);
  assert.equal(ownText(arrived.outcome.said), "Created dev-2. Open it from the list with Enter.");
});

test("created and launched with every tab taken (Settled 7 of T2): when the row appears, the created line and then the cap's sentence; nothing opens and no tab closes", () => {
  const more = ["dev-x", "dev-y"].map((name) => instanceRow("dev", name));
  // The first read after the spawn has the others but not dev-2 yet: four tabs are opened from it.
  let s = took(done(pressed(), CREATED).state, observed([...ROWS, ...more], { cli: FACTS_CLI }), 2);
  for (const name of ["dev-a", "reviewer-a", "dev-x", "dev-y"]) {
    const id = instanceId(roster(s).instances.find((each) => each.instance === name));
    s = reduce(key(Object.freeze({ ...s, selected: id }), "enter").state, { shown: { id } }).state;
    s = reduce(s, { back: true, read: ++reads }).state;
    s = key(s, s.leaderKey).state;
  }
  assert.deepEqual([s.tabs.length, s.arriving?.instance], [4, "dev-2"]);
  const arrived = reduce(s, { id: DEPLOYMENT, entry: observed([...ROWS, ...more, instanceRow("dev", "dev-2")], { cli: FACTS_CLI }), number: 3 });
  assert.deepEqual([arrived.state.tabs.map((tab) => tab.name), arrived.state.terminal.name, arrived.state.arriving], [["dev-a", "reviewer-a", "dev-x", "dev-y"], "dev-y", null]);
  assert.equal(arrived.effect?.open, undefined, "nothing opens");
  assert.equal(arrived.effect?.close, undefined, "nothing closes");
  assert.equal(ownText(arrived.state.outcome.said), "Created dev-2. 4 terminals are open; close one with C-\\ w.");
});

test("created but partial, incomplete or not launched: the shared words and the TUI's for what follows; nothing opens", () => {
  const cases = [
    [{ ...CREATED, view: createdView({ status: "partial", reason: { code: "E_WAKE_OUTCOME_UNKNOWN", message: "x" } }) }, "Agent created; wake outcome unavailable. `oats schedule list` shows its schedules."],
    [{ ...CREATED, view: createdView({ receipt: { ...createdView().receipt, launched: false } }) }, "Created dev-2 — not launched. Open it from the list with Enter."],
  ];
  for (const [outcome, line] of cases) {
    const after = done(pressed(), outcome);
    assert.deepEqual([after.state.arriving, after.effect], [null, { refresh: { live: true } }]);
    assert.equal(ownText(after.state.outcome.said), line);
  }
});

test("unknown and pending-expired: the shared fact and `press C to check`; C is offered (spawn-check), reads the result once, and its outcome is taken as any; cleanup-owed names the retire", () => {
  const unknown = done(pressed(), { kind: "unknown", view: null, reason: { code: "E_OUTCOME_UNKNOWN" }, instance: null });
  assert.equal(ownText(unknown.state.outcome.said), "We couldn’t confirm whether the instance was created. Press C to check before spawning again.");
  assert.equal(unknown.state.spawnCheck.name, "dev-2");
  const check = key(unknown.state, "C");
  assert.deepEqual([check.effect, check.state.spawning.phase, check.state.spawnCheck], [{ spawnCheck: true }, "checking", null]);
  assert.equal(ownText(outcomeOf(check.state).said), "Checking the spawn of dev-2…");
  assert.equal(key(check.state, "C").effect, null, "once");
  const created = done(check.state, CREATED);
  assert.equal(created.state.arriving.instance, "dev-2", "a check that finds it created waits for its row");
  const expired = done(pressed(), { kind: "pending-expired", view: null, reason: null, instance: "dev-2" }).state;
  assert.deepEqual([ownText(expired.outcome.said), expired.spawnCheck !== null], ["The spawn is still running. Press C to check before spawning again.", true]);
  const owed = done(pressed(), { kind: "cleanup-owed", view: { reason: { code: "E_INTERRUPTED", message: "stopped" } }, reason: { code: "E_INTERRUPTED" }, instance: "dev-2" }).state;
  assert.deepEqual([ownText(owed.outcome.said), owed.spawnCheck], ["The spawn of dev-2 was stopped, but its cleanup didn’t finish. Retire dev-2 with D to finish its cleanup.", null]);
  assert.equal(key(base(), "C").effect, null, "C with nothing to check does nothing");
});

test("refused, drifted, rolled back or never submitted: the preview again, read again with the choices as they were, and the shared words in it; Enter applies what it shows", () => {
  const named = answered(key(keys(previewOf(), ["tab", ...typing("api")]).state, "enter").state, available(previewData({ instance: "dev-api" })));
  for (const [outcome, said] of [
    [{ kind: "refused", reason: { code: "E_INSTANCE_NAME_TAKEN" } }, /^An instance with this name already exists\. Choose another name\.$/],
    [{ kind: "drifted", view: {}, reason: null }, /^These values changed since you last looked\. Check the preview and press Enter again\.$/],
    [{ kind: "never-submitted", view: {}, reason: null }, /^That spawn was never submitted\. Check the preview and press Enter again\.$/],
  ]) {
    const back = done(pressed(named), { view: null, instance: "dev-api", ...outcome });
    assert.deepEqual([back.state.spawn.step, back.state.spawn.name, back.state.spawn.status, back.state.spawning], ["preview", "api", "reading", null], outcome.kind);
    assert.deepEqual(back.effect.spawnPreview.request.choices.purpose, "api");
    assert.match(ownText(view(back.state).spawn.problem.said), said, outcome.kind);
    assert.deepEqual(back.effect.refresh, { live: true });
    const landed = answered(back.state, available(previewData({ instance: "dev-api" })));
    assert.equal(key(landed, "enter").effect.spawn.name, "dev-api", `${outcome.kind}: Enter spawns what is shown`);
  }
  // Busy elsewhere: the line alone.
  const busy = key(pressed(named), "ctrl+k").state;
  const line = done(busy, { kind: "refused", reason: { code: "E_BUSY" }, view: null, instance: "dev-api" }).state;
  assert.deepEqual([line.spawn, ownText(line.outcome.said)], [null, "Another spawn is in progress. Try again in a moment."]);
});

test("on another machine: n with its workspace open, and N on its row, say spawning there is not offered here and name `oats spawn`; nothing opens", () => {
  const remote = { ...base(), open: "remote:garnet:acme-1" };
  const step = key({ ...remote, view: "instances" }, "n");
  assert.deepEqual([step.state.spawn, ownText(step.state.outcome.said)], [null, "Spawning on another machine is not offered here; `oats spawn` there makes one."]);
  const far = reached(), row = roster(far).instances.find((each) => each.instance === "acme-far-a");
  const N = key({ ...far, selected: instanceId(row) }, "N");
  assert.deepEqual([N.state.spawn, N.state.outcome.said], [null, SPAWN_WORDS.remote()]);
  // n on that row too (Settled 9: a remote row or workspace), from its key, the leader and the
  // palette's Spawn an agent: no local catalog is read, no picker opens.
  const onFar = { ...far, selected: instanceId(row) };
  const viaLeader = key(key(onFar, onFar.leaderKey).state, "n");
  let typed = key(onFar, "ctrl+k").state;
  for (const ch of "spawn an agent") typed = key(typed, ch === " " ? "space" : ch).state;
  for (const [how, step] of [["n", key(onFar, "n")], ["the leader's n", viaLeader], ["the palette", key(typed, "enter")]]) {
    assert.deepEqual([step.state.spawn, step.state.outcome?.said, step.effect?.souls], [null, SPAWN_WORDS.remote(), undefined], how);
  }
});

test("the palette lists Spawn an agent, and Spawn another <soul> for its instance once the catalog lists that soul; each opens the prompt as its key does", () => {
  const palette = key(on(base(), "reviewer-a"), "ctrl+k").state;
  const items = paletteItems(palette).items;
  assert.equal(items.some((item) => item.kind === "command" && item.does === "spawn" && item.label === "Spawn an agent"), true);
  const another = items.find((item) => item.does === "spawn-another");
  assert.deepEqual([another.kind, another.label, another.name], ["act", "Spawn another", "reviewer"]);
  let typed = palette;
  for (const ch of "spawn another") typed = key(typed, ch === " " ? "space" : ch).state;
  const ran = key(typed, "enter");
  assert.deepEqual([ran.state.palette, ran.state.spawn.step, ran.state.spawn.soul.name], [null, "preview", "reviewer"]);
  const noCatalog = key(on(stateOf(observed(ROWS)), "reviewer-a"), "ctrl+k").state;
  assert.equal(paletteItems(noCatalog).items.some((item) => item.does === "spawn-another"), false, "no soul to name");
});

test("the TUI words what follows a spawn's fact once per SPAWN_NEXT code, each naming a key of the table or an `oats` command; a code the table lacks fails here", () => {
  assert.deepEqual(Object.keys(SPAWN_NEXT_WORDS).sort(), [...SPAWN_NEXT].sort());
  const actions = base().actions;
  const labels = new Set([...actions.flatMap((a) => a.keys.map(keyLabel)), "Tab"]);
  for (const code of SPAWN_NEXT) {
    const parts = SPAWN_NEXT_WORDS[code]("dev-2", actions), text = ownText(parts);
    assert.equal(Array.isArray(parts) && parts.length > 0, true, code);
    // `details` points at what stands under the line: the shared detail (spawnLine).
    if (code === "details") continue;
    const names = /`oats [a-z ]+`/.test(text) || text.split(/[\s.,;:]+/).some((word) => labels.has(word));
    assert.equal(names, true, `${code}: names a key or a command: ${text}`);
  }
  const line = spawnLine({ fact: "OATS couldn’t complete the spawn.", next: "details", detail: "E_CLI_FAILED · boom" }, "dev-2", actions);
  assert.deepEqual(line.under, ["E_CLI_FAILED · boom"], "details: the detail under the line");
});

test("the boundaries admit a spawn against the workspace as the state holds it: its deployment, the kernel record, its souls and its rows", () => {
  const context = spawnContext(base(), DEPLOYMENT, WHEN);
  assert.deepEqual([context.workspace.id, context.cli, context.agents.map((row) => row.name), context.instances.map((row) => row.instance)], [DEPLOYMENT, FACTS_CLI, ["dev", "ops", "reviewer"], ["dev-a", "reviewer-a"]]);
});

// ── Another machine, as acts.test.mjs builds it: this machine's row and garnet's, in one view.
const IDENTITY = Object.freeze({ key: "github.com/acme/platform", ref: "main", keyFrom: "workspace", standalone: false, defaultTeam: Object.freeze({ label: "eng", team: "team-1" }), teams: Object.freeze({ eng: "team-1" }), teamsFrom: "observed" });
const REMOTE_CLI = Object.freeze({ ...FACTS_CLI, remote: Object.freeze(["roster"]) });
const FAR = "/home/dev/Agents/acme";
function reached() {
  const document = { ...rosterOf(ROWS), workspace: { reachable: true, ...IDENTITY } }, listed = rosterRows(document, REMOTE_CLI);
  const entry = observedEntry({ roster: document, workspaceStatus: { workspace: { name: "acme-platform" } }, observedAt: "2026-10-11T09:59:00.000Z" }, panelInstances(listed, listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, tmux: row.tmux }))), "2026-10-11T10:00:00.000Z");
  const state = stateOf(entry, { cli: REMOTE_CLI });
  const group = { id: "garnet:acme-1", server: "garnet", label: "garnet", registrationPresent: true, target: { workspace: FAR, sshHost: "garnet.example" }, probe: { ok: true }, workspace: IDENTITY, agentsRoot: `${FAR}/agents`, souls: [],
    instances: [{ instance: "acme-far-a", agent: "dev", home: `${FAR}/agents/dev/instances/acme-far-a`, agentsRoot: `${FAR}/agents`, work: "worktree", harness: "claude", running: true, runtimeState: "running", addressable: true }] };
  const at = "2026-10-11T10:00:10.000Z", next = remoteRosterState(state.remote, { envelope: { ok: true, result: { groups: [group] } } }, at);
  const kept = observeIdentities({ memory: state.memory, notes: state.notes }, next.reported, at);
  return reduce(state, { roster: { remote: { remoteGroups: next.remoteGroups, rosterAnswered: next.rosterAnswered, rosterFailure: next.rosterFailure }, memory: kept.memory, notes: kept.notes, at } }).state;
}

test("the preview scrolls from the window the frame drew (`drawnTop`), which keeps a focused fold in sight: a movement key moves one row from it, never back to the model's `top`", () => {
  const s = previewOf();
  assert.equal(s.spawn.top, 0);
  const from = (drawnTop) => reduce(s, { key: "down", read: ++reads, ...AT, ...(drawnTop === undefined ? {} : { drawnTop }) }).state.spawn.top;
  assert.equal(from(12), 13, "one row down from the window drawn");
  assert.equal(from(undefined), 1, "with no window drawn, from top");
  assert.equal(reduce(s, { key: "up", read: ++reads, ...AT, drawnTop: 12 }).state.spawn.top, 11);
});
