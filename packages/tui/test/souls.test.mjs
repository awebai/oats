process.env.TZ = "UTC";
// The Souls view in the store and the model (docs/tui.md, "The Souls view"; Spec 6-view, Done 1, 2,
// 4 and 5): when its catalog is wanted, what the view holds of it, its keys, the exact soul filter
// it sets on the Instances view, and the palette's souls. Every entry is made by the shared
// functions (helpers.mjs); what the loop does with the catalog is main.test.mjs's.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS } from "../lib/actions.mjs";
import { model, paletteItems, roster, soulsOf } from "../lib/model.mjs";
import { soulCatalogFailure } from "../lib/client.mjs";
import { reduce } from "../lib/store.mjs";
import { CLI, DEPLOYMENT, catalogEntry, catalogSoul, instanceRow, observed, soulsTold, stateOf } from "./helpers.mjs";

/** A kernel that reports whether a soul's spawn would be refused here (desktop-facts). */
const FACTS_CLI = Object.freeze({ ...CLI, features: Object.freeze([...CLI.features, "desktop-facts"]) });
/** The geometry of the frame before each key: the store reads it for a move, never keeps it. */
const AT = Object.freeze({ page: 19, extent: 30, room: 19, cols: 38 });
const WHEN = "2026-10-11T10:00:30.000Z";
let reads = 0;
/** A key in a read of its own; a one-character id types itself. */
const key = (state, id) => reduce(state, { key: id, ...(id === "space" ? { text: " " } : id.length === 1 ? { text: id } : {}), read: ++reads, ...AT });
/** Keys, each in a read of its own. -> the last step, with every effect on the way. */
function keys(state, ...ids) {
  let step = { state, effect: null };
  const effects = [];
  for (const id of ids) { step = key(step.state, id); if (step.effect) effects.push(step.effect); }
  return { ...step, effects };
}
/** The view's model, as the frame is handed it. */
const view = (state) => model(state, { page: 19, now: Date.parse(WHEN), at: WHEN, cols: 38 }).souls;

/** dev (two instances here, one a child), reviewer (one), and ops (none): the roster's colours
 *  are dev's sage and reviewer's an unknown name. */
const ROWS = [instanceRow("dev", "dev-a"), instanceRow("dev", "dev-b", { running: false, runtimeState: "stopped" }), instanceRow("reviewer", "reviewer-of-dev")];
const SOULS = [catalogSoul("reviewer"), catalogSoul("ops", { description: "Keeps the lights on.", spawnable: false, problem: { message: "No launch configuration matches." } }), catalogSoul("dev")];
function base(cli = FACTS_CLI) {
  const entry = observed(ROWS, { cli });
  const souls = entry.deployment.souls.map((soul) => (soul.name === "dev" ? { ...soul, color: "Sage" } : soul.name === "reviewer" ? { ...soul, color: "teal" } : soul));
  return stateOf({ ...entry, deployment: { ...entry.deployment, souls } }, { cli });
}
/** The Souls view shown, its catalog held. */
const shown = (souls = SOULS, options = {}) => soulsTold(key(base(), "2").state, catalogEntry(souls, options));

test("the catalog is wanted only once the Souls view is shown: 2, the leader then 2, and the palette's Souls each show it and ask the loop to settle it; 3 too, whose Used by reads it; no other key does", () => {
  const start = base();
  assert.equal(start.souls.wanted, false);
  const quiet = keys(start, "j", "k", "/", "d", "enter", "escape", "?", "escape", "w", "1");
  assert.deepEqual(quiet.effects.filter((effect) => effect.souls !== undefined), [], "no key but the views' asks for the catalog");
  assert.equal(quiet.state.souls.wanted, false);
  // The Capabilities view wants it too: its Used by names the souls (capabilities.test.mjs has the rest).
  const three = key(start, "3");
  assert.deepEqual([three.state.view, three.state.souls.wanted, three.effect], ["capabilities", true, { souls: "settle", capabilities: "settle" }]);
  const two = key(start, "2");
  assert.deepEqual([two.state.view, two.state.souls.wanted, two.effect], ["souls", true, { souls: "settle" }]);
  const led = key(key(start, start.leaderKey).state, "2");
  assert.deepEqual([led.state.view, led.effect], ["souls", { souls: "settle" }], "the leader then 2");
  let palette = key(start, "ctrl+k").state;
  for (const ch of "souls") palette = key(palette, ch).state;
  const ran = key(palette, "enter");
  assert.deepEqual([ran.state.view, ran.state.palette, ran.effect], ["souls", null, { souls: "settle" }], "the palette's Souls");
  // Shown again: settled again, which reads nothing while the workspace is as it was (the shared key).
  assert.deepEqual(keys(two.state, "1", "2").effects, [{ souls: "settle" }]);
});

test("what the loop holds of the catalog decides what the view says: reading before anything is held, the failure and r when the first read failed, none, the rows, and over a failed re-read the rows it kept under a heading with the failure and the time of the last good read, and no word of its own (the accordion's row above it names the view)", () => {
  const opened = key(base(), "2").state;
  assert.equal(view(opened).state, "reading", "before the loop said anything");
  assert.equal(view(soulsTold(opened, null, { reading: true })).state, "reading", "the first read in flight");
  const reason = { code: "E_CLI_FAILED", message: "oats souls exited 1" };
  const failed = view(soulsTold(opened, catalogEntry(null, { reason })));
  assert.deepEqual([failed.state, failed.failure, failed.list], ["failed", "Couldn't read this workspace's souls: oats souls exited 1", []]);
  assert.equal(soulCatalogFailure({ code: "E_CLI_FAILED", message: "" }), "Couldn't read this workspace's souls.");
  assert.equal(view(soulsTold(opened, catalogEntry(null, { reason }), { reading: true })).state, "reading", "a retry in flight after a failure");
  assert.equal(view(soulsTold(opened, catalogEntry([]))).state, "none");
  const rows = view(shown());
  assert.deepEqual([rows.state, rows.heading, rows.list.map((row) => row.name)], ["rows", null, ["dev", "ops", "reviewer"]], "sorted as the shared rows are");
  const kept = view(shown(SOULS, { reason }));
  assert.deepEqual([kept.state, kept.list.length, kept.heading], ["rows", 3, { label: "", path: null, state: null, short: "Couldn't read this workspace's souls: oats souls exited 1", readAt: "09:59:30" }]);
});

test("a row is the soul's name, its colour from the TUI's table (none for a name outside the palette), the count of its instances on this machine, and whether a spawn of it here would be refused, as the shared facts say", () => {
  const list = view(shown()).list;
  assert.deepEqual(list, [
    { name: "dev", color: "green", count: 2, refused: false, selected: true },
    { name: "ops", color: null, count: 0, refused: true, selected: false },
    { name: "reviewer", color: null, count: 1, refused: false, selected: false },
  ]);
  // A kernel that does not report the facts refuses nothing the view could know of.
  const older = soulsTold(key(base(CLI), "2").state, catalogEntry(SOULS));
  assert.equal(view(older).list.find((row) => row.name === "ops").refused, false);
});

test("the detail is the selected soul's, from its row and the shared facts: where it comes from, where it works, the refusal, the harness, its teams default first, its capabilities, and its instances here, eight at most and then a count", () => {
  const teams = [{ label: "ops", team: null, mapped: false, default: false, from: "soul" }, { label: "core", team: "aweb:core", mapped: true, default: true, from: "deployment" }];
  const capabilities = [{ name: "oats.core", kind: "package", package: "oats.framework", from: "soul" }, { name: "acme.deploy", kind: "member", repoKey: "acme/oats", from: "soul" }];
  const pkg = catalogSoul("dev", { kind: "package", package: "acme.souls", version: "1.2.0", qualifiedName: "acme.souls/dev", key: "acme.souls/dev", teams, capabilities });
  const detail = view(shown([pkg])).detail;
  assert.deepEqual({ ...detail, harness: undefined }, {
    name: "dev", failure: null, description: "The dev soul.", from: "package acme.souls 1.2.0", works: "works in its own worktree", refusal: null, harness: undefined,
    teams: [{ label: "core", default: true }, { label: "ops", default: false }],
    capabilities: ["oats.core", "acme.deploy"],
    instances: { shown: [{ name: "dev-a", mark: "running" }, { name: "dev-b", mark: "stopped" }], more: 0 },
  });
  assert.deepEqual(detail.harness, { rows: [], notes: ["No default harness: you choose one when you launch it."], problem: null }, "no launch reported: the shared facts' note");
  const refused = view(keys(shown(), "j").state).detail;
  assert.deepEqual([refused.name, refused.refusal, refused.teams, refused.capabilities, refused.instances], ["ops", "Can't spawn here · No launch configuration matches.", null, null, { shown: [], more: 0 }]);
  // Ten instances: eight named, two counted.
  const many = Array.from({ length: 10 }, (_, i) => instanceRow("dev", `dev-${i}`));
  const crowded = soulsTold(key(stateOf(observed(many)), "2").state, catalogEntry([catalogSoul("dev")]));
  assert.deepEqual([view(crowded).detail.instances.shown.length, view(crowded).detail.instances.more], [8, 2]);
});

test("in the Souls view the list's keys move among the souls, / filters them by name, description or where they come from, Enter gives the detail the focus and the movement keys then scroll it, and Esc closes the detail, then clears a kept filter, then goes back to the instances", () => {
  const start = shown();
  assert.equal(soulsOf(keys(start, "j", "j").state).selected.name, "reviewer");
  assert.equal(soulsOf(keys(start, "j", "j", "j").state).selected.name, "reviewer", "the last row stays the last");
  assert.equal(soulsOf(keys(start, "G", "k").state).selected.name, "ops");
  const lights = keys(start, "/", "l", "i", "g", "h", "t", "s");
  assert.deepEqual([lights.state.souls.filter, view(lights.state).list.map((row) => row.name)], [{ editing: true, query: "lights" }, ["ops"]], "the description matches");
  const kept = key(lights.state, "enter").state;
  assert.deepEqual([kept.souls.filter, view(kept).state], [{ editing: false, query: "lights" }, "rows"]);
  assert.equal(view(keys(start, "/", "z", "z", "z").state).state, "nomatch");
  const focused = key(start, "enter").state;
  assert.equal(focused.souls.focus, "detail");
  assert.equal(key(focused, "j").state.souls.detailTop, 1, "Down scrolls the detail");
  assert.equal(key(focused, "j").state.souls.selected, focused.souls.selected, "the selection stays");
  const out = keys(kept, "enter", "escape");
  assert.deepEqual([out.state.view, out.state.souls.focus, out.state.souls.filter.query], ["souls", "list", "lights"], "Esc first closes the detail");
  const cleared = key(out.state, "escape").state;
  assert.deepEqual([cleared.view, cleared.souls.filter.query], ["souls", ""], "then clears the filter");
  assert.equal(key(cleared, "escape").state.view, "instances", "then goes back to the instances");
  assert.equal(key(start, "1").state.view, "instances");
});

test("r in the Souls view asks the loop to read the catalog again; with no workspace of this machine open it asks nothing", () => {
  assert.deepEqual(key(shown(), "r").effect, { souls: "reread" });
  const none = key(stateOf(null, { deployment: null, cli: FACTS_CLI }), "2");
  assert.equal(none.state.view, "souls");
  assert.equal(view(none.state).local, false);
  assert.equal(key(none.state, "r").effect, null);
});

test("i, or Enter in the detail, shows the selected soul's instances in the Instances view with the exact soul filter: an instance of another soul whose name holds the soul's name is not listed; Esc clears it and / replaces it with a text filter", () => {
  const listed = (state) => roster(state).rows.map((item) => item.row.instance);
  const fromList = key(shown(), "i").state;
  assert.deepEqual([fromList.view, fromList.filter.soul?.name, fromList.filter.query], ["instances", "dev", ""]);
  assert.deepEqual(listed(fromList), ["dev-a", "dev-b"], "reviewer-of-dev holds dev in its name and is not dev's");
  assert.deepEqual(listed(keys(shown(), "enter", "enter").state), ["dev-a", "dev-b"], "Enter in the detail does what i does");
  const typed = keys(base(), "/", "d", "e", "v").state;
  assert.deepEqual(listed(typed).sort(), ["dev-a", "dev-b", "reviewer-of-dev"], "the text filter matches by substring");
  const cleared = key(fromList, "escape").state;
  assert.deepEqual([cleared.filter, listed(cleared).length], [{ editing: false, query: "" }, 3]);
  const replaced = key(fromList, "/").state;
  assert.deepEqual(replaced.filter, { editing: true, query: "" });
  // A package soul's instances carry its name in the roster, `<package>--<soul>` (the agent
  // directory its instances are made under), or on an older kernel its qualified name.
  const pkg = shown([catalogSoul("dev", { kind: "package", package: "acme.souls", qualifiedName: "acme.souls/dev", key: "acme.souls/dev" })]);
  assert.deepEqual(key(pkg, "i").state.filter.soul.names, ["dev", "acme.souls/dev", "acme-souls--dev"]);
  const packaged = soulsTold(key(stateOf(observed([instanceRow("acme-souls--dev", "dev-p")]), { cli: FACTS_CLI }), "2").state, catalogEntry([catalogSoul("dev", { kind: "package", package: "acme.souls", qualifiedName: "acme.souls/dev", key: "acme.souls/dev" })]));
  assert.deepEqual([view(packaged).list[0].count, roster(key(packaged, "i").state).rows.map((item) => item.row.instance)], [1, ["dev-p"]], "its instances here are counted and listed");
});

test("the selected soul and the filter are kept when the view is left and shown again, for the run; the view comes back with its list focused", () => {
  const left = keys(shown(), "j", "/", "o", "enter", "enter", "1").state;
  assert.equal(left.view, "instances");
  const again = key(left, "2").state;
  assert.deepEqual([soulsOf(again).selected.name, again.souls.filter.query, again.souls.focus], ["ops", "o", "list"]);
});

test("the palette lists the souls once their catalog was read, under the views' kind of their own; choosing one shows the Souls view with it selected; before the view was shown it lists none and reads nothing", () => {
  const never = key(base(), "ctrl+k").state;
  assert.equal(paletteItems(never).items.some((item) => item.kind === "soul"), false);
  let palette = key(key(shown(), "1").state, "ctrl+k").state;
  assert.deepEqual(paletteItems(palette).items.filter((item) => item.kind === "soul").map((item) => item.label), ["dev", "ops", "reviewer"]);
  for (const ch of "revi") palette = key(palette, ch).state;
  // The instance whose name matches stands first, under its group's label row: the instances'
  // groups come before the souls'. Down moves among the rows that can be selected, which no label row is.
  const items = paletteItems(palette).items, at = items.findIndex((item) => item.kind === "soul");
  assert.deepEqual([items[0].kind, items[1].kind, items[at]], ["group", "instance", { key: "soul\u0000reviewer", kind: "soul", label: "reviewer", name: "reviewer", text: "reviewer" }]);
  const steps = items.filter((item) => item.kind !== "group").indexOf(items[at]);
  for (let i = 0; i < steps; i++) palette = key(palette, "down").state;
  const ran = key(palette, "enter");
  assert.deepEqual([ran.state.view, soulsOf(ran.state).selected.name, ran.state.palette, ran.effect], ["souls", "reviewer", null, { souls: "settle" }]);
});

test("a soul chosen in the palette is the one shown, even where the Souls view kept a filter that hides it: that filter is cleared; one that shows it is kept", () => {
  const choose = (state, name) => {
    let palette = key(key(state, "1").state, "ctrl+k").state;
    for (const ch of name) palette = key(palette, ch).state;
    // Down moves among the rows that can be selected: a group's label row is not one.
    const items = paletteItems(palette).items.filter((item) => item.kind !== "group"), at = items.findIndex((item) => item.kind === "soul" && item.name === name);
    for (let i = 0; i < at; i++) palette = key(palette, "down").state;
    return key(palette, "enter").state;
  };
  const kept = keys(shown(), "/", "d", "e", "v", "enter").state;
  assert.equal(soulsOf(kept).selected.name, "dev");
  const hidden = choose(kept, "reviewer");
  assert.deepEqual([hidden.view, soulsOf(hidden).selected.name, view(hidden).detail.name, hidden.souls.filter], ["souls", "reviewer", "reviewer", { editing: false, query: "" }]);
  assert.deepEqual(key(hidden, "i").state.filter.soul.name, "reviewer", "i acts on the soul shown");
  const visible = choose(kept, "dev");
  assert.deepEqual([soulsOf(visible).selected.name, visible.souls.filter], ["dev", { editing: false, query: "dev" }]);
});

test("the leader's views leave the Souls view's open field kept, as Enter keeps it: the leader then 1, the leader then 2, and i is the action again", () => {
  const typing = keys(shown(), "/", "d", "e", "v", " ").state;
  assert.deepEqual(typing.souls.filter, { editing: true, query: "dev " });
  const away = keys(typing, typing.leaderKey, "1").state;
  assert.equal(away.view, "instances");
  assert.deepEqual(away.souls.filter, { editing: false, query: "dev" }, "kept, trimmed, the field closed");
  const back = keys(away, away.leaderKey, "2").state;
  assert.deepEqual([back.view, back.souls.filter], ["souls", { editing: false, query: "dev" }]);
  const i = key(back, "i").state;
  assert.deepEqual([i.view, i.filter.soul?.name], ["instances", "dev"], "i shows dev's instances");
});

test("what the loop holds is kept per workspace, and only for a served one; the action table has soul-instances on i", () => {
  const start = shown();
  assert.equal(soulsTold(start, catalogEntry([]), { id: "/elsewhere" }).souls, start.souls, "a workspace that is not served is not kept");
  assert.equal(start.souls.held.get(DEPLOYMENT).entry.souls.length, 3);
  assert.deepEqual(ACTIONS.find((action) => action.id === "soul-instances")?.keys, ["i"]);
});
