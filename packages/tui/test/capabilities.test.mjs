process.env.TZ = "UTC";
// The Capabilities view in the store and the model (docs/tui.md, "The Capabilities view"; Spec 7,
// Done 1, 2, 3, 4 and 5): when its catalog is wanted, what the view holds of it, its sections and
// groups, the detail's facts and "Used by" in both of the kernel's forms, its keys, and the
// palette's capabilities. Every entry is made by the shared functions (helpers.mjs and
// lib/client.mjs); what the loop does with the catalog is main.test.mjs's, what the screen shows
// capabilities-view.test.mjs's.
import test from "node:test";
import assert from "node:assert/strict";
import { capabilitiesOf, model, paletteItems, soulsOf } from "../lib/model.mjs";
import { CAPABILITY_COPY, catalogFailure, observedEntry, panelInstances, rosterRows } from "../lib/client.mjs";
import { reduce } from "../lib/store.mjs";
import { CLI, DEPLOYMENT, catalogEntry, catalogSoul, instanceRow, rosterOf, soulsTold, stateOf } from "./helpers.mjs";

/** A kernel whose `oats souls` reports each soul's composed capabilities (souls-capabilities). */
const COMPOSED = Object.freeze({ ...CLI, features: Object.freeze([...CLI.features, "souls-capabilities"]) });
/** The geometry of the frame before each key: the store reads it for a move, never keeps it. */
const AT = Object.freeze({ page: 19, extent: 30, room: 19, cols: 38 });
const WHEN = "2026-10-11T10:00:30.000Z";
let reads = 0;
/** A key in a read of its own; a one-character id types itself. */
const key = (state, id, geometry = AT) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), read: ++reads, ...geometry });
/** Keys, each in a read of its own. -> the last step, with every effect on the way. */
function keys(state, ...ids) {
  let step = { state, effect: null };
  const effects = [];
  for (const id of ids) { step = key(step.state, id); if (step.effect) effects.push(step.effect); }
  return { ...step, effects };
}
/** The view's model, as the frame is handed it. */
const view = (state, page = 19) => model(state, { page, now: Date.parse(WHEN), at: WHEN, cols: 38 }).capabilities;

/** The workspace status the fixture's deployment reports: two members (the host's and a tools
 *  repository) and one locked package. */
const STATUS = Object.freeze({
  workspace: { name: "acme-platform", key: "acme/oats" },
  members: [{ key: "acme/oats", name: "oats" }, { key: "acme/tools", name: "tools" }],
  packages: [{ id: "acme-pack", version: "1.2.0", source: "catalog:acme-pack", integrity: `sha256-${"a".repeat(64)}` }],
});
/** dev (two instances here: dev-a carries aweb and notes, dev-b an older aweb), reviewer (one,
 *  carrying aweb), and a package soul's instance carrying the package's capability. */
const ROWS = () => [
  instanceRow("dev", "dev-a", { modules: { aweb: { status: "current" }, notes: { status: "current" } } }),
  instanceRow("dev", "dev-b", { running: false, runtimeState: "stopped", modules: { aweb: { status: "moved" } } }),
  instanceRow("reviewer", "reviewer-1", { modules: { aweb: { status: "current" } } }),
  instanceRow("acme-pack--keeper", "keeper-1", { modules: { "pack-tools": { status: "current" } } }),
];
/** The fixture's deployment observed with `rows`, through the real shared readers, its workspace
 *  status `STATUS`; the roster gives dev its colour sage and reviewer mauve (the roster carries a
 *  soul's colour, the catalog does not). */
function observedWith(rows, status = STATUS) {
  const document = rosterOf(rows), listed = rosterRows(document, CLI);
  const entry = observedEntry({ roster: document, workspaceStatus: status, observedAt: "2026-10-11T09:59:00.000Z" }, panelInstances(listed, listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, tmux: row.tmux }))), "2026-10-11T10:00:00.000Z");
  const colours = { dev: "sage", reviewer: "mauve" };
  return { ...entry, deployment: { ...entry.deployment, souls: entry.deployment.souls.map((soul) => (colours[soul.name] ? { ...soul, color: colours[soul.name] } : soul)) } };
}
const base = (cli = CLI, rows = ROWS()) => stateOf(observedWith(rows), { cli });

/** A row of `oats capabilities --json` as the shared reader hands it on (deployment-data.mjs capabilitiesData). */
const member = (name, repoKey, extra = {}) => ({ name, kind: "member", repoKey, origin: "member", ...extra });
const packaged = (name, extra = {}) => ({ name, kind: "package", package: "acme-pack", version: "1.2.0", origin: "package", ...extra });
const CAPS = () => [
  member("notes", "acme/tools", { skills: null }),
  member("aweb", "acme/oats", { layer: "messaging", description: "Messaging over aweb.", commit: "b".repeat(40), path: "capabilities/aweb", tree: "c".repeat(40), skills: ["oats-aweb", "aweb-messaging"], commands: [], hooks: ["SessionStart"] }),
  member("secret", "acme/oats", { private: true }),
  packaged("pack-tools", { layer: "knowledge", commit: "d".repeat(40) }),
];
/** What the shared capability catalog holds for a workspace (capability-catalog.mjs, its projected
 *  entry): the table (null: nothing read), the failure of the last read beside it, and when it was read. */
function capabilitiesEntry(rows, { reason = null, observedAt = "2026-10-11T09:59:30.000Z" } = {}) {
  return { key: "key", capabilities: rows === null ? null : { capabilitiesApi: 1, workspace: { name: "acme-platform" }, capabilities: rows, problems: [] }, reason, at: 0, observedAt, stale: false, refreshing: false };
}
/** The loop telling the store what it holds of the fixture's capabilities, as lib/main.mjs does. */
const told = (state, entry, { reading = false, id = DEPLOYMENT } = {}) => reduce(state, { capabilities: { id, entry, reading } }).state;
/** The souls of the fixture's catalog: with souls-capabilities, dev and reviewer compose aweb, and the package soul keeper composes pack-tools. */
const SOULS = () => [
  catalogSoul("dev", { capabilities: [{ name: "aweb", kind: "member", repoKey: "acme/oats", from: "soul" }, { name: "notes", kind: "member", repoKey: "acme/tools", from: "soul" }] }),
  catalogSoul("reviewer", { capabilities: [{ name: "aweb", kind: "member", repoKey: "acme/oats", from: "workspace" }] }),
  catalogSoul("keeper", { kind: "package", package: "acme-pack", qualifiedName: "acme-pack/keeper", key: "acme-pack/keeper", capabilities: [{ name: "pack-tools", kind: "package", package: "acme-pack", from: "soul" }] }),
];
/** The Capabilities view shown, its table held, and (unless `souls` is null) the souls catalog too. */
function shown({ cli = CLI, rows = CAPS(), souls = SOULS(), options = {} } = {}) {
  let state = told(key(base(cli), "3").state, capabilitiesEntry(rows, options));
  if (souls !== null) state = soulsTold(state, catalogEntry(souls));
  return state;
}
const names = (state) => view(state).list.map((item) => (item.section ?? (item.group !== undefined ? `${item.group} · ${item.note}` : item.name)));

test("the catalog is wanted only once the Capabilities view is shown: 3, the leader then 3, and the palette's Capabilities each show it and ask the loop to settle it and the souls catalog its Used by reads; no other key asks for it", () => {
  const start = base();
  assert.equal(start.capabilities.wanted, false);
  const quiet = keys(start, "j", "k", "/", "d", "enter", "escape", "2", "escape", "?", "escape", "w", "1");
  assert.deepEqual(quiet.effects.filter((effect) => effect.capabilities !== undefined), [], "no key but the view's asks for the table");
  assert.equal(quiet.state.capabilities.wanted, false);
  const three = key(start, "3");
  assert.deepEqual([three.state.view, three.state.capabilities.wanted, three.state.souls.wanted, three.effect], ["capabilities", true, true, { souls: "settle", capabilities: "settle" }]);
  const led = key(key(start, start.leaderKey).state, "3");
  assert.deepEqual([led.state.view, led.effect], ["capabilities", { souls: "settle", capabilities: "settle" }], "the leader then 3");
  let palette = key(start, "ctrl+k").state;
  for (const ch of "capab") palette = key(palette, ch).state;
  const ran = key(palette, "enter");
  assert.deepEqual([ran.state.view, ran.state.palette, ran.effect], ["capabilities", null, { souls: "settle", capabilities: "settle" }], "the palette's Capabilities");
  // Shown again: settled again, which reads nothing while the workspace is as it was (the shared keys).
  assert.deepEqual(keys(three.state, "1", "3").effects, [{ souls: "settle", capabilities: "settle" }]);
});

test("what the loop holds of the table decides what the view says: reading before anything is held, the failure when the first read failed, none, the rows, and over a failed re-read the rows it kept under a heading with the failure and the time of the last good read, and no word of its own (the accordion's row above it names the view)", () => {
  const opened = key(base(), "3").state;
  assert.equal(view(opened).state, "reading", "before the loop said anything");
  assert.equal(view(told(opened, null, { reading: true })).state, "reading", "the first read in flight");
  const reason = { code: "E_CLI_FAILED", message: "oats capabilities exited 1" };
  const failed = view(told(opened, capabilitiesEntry(null, { reason })));
  assert.deepEqual([failed.state, failed.failure, failed.list], ["failed", "Couldn't read this workspace's capabilities: oats capabilities exited 1", []]);
  assert.equal(catalogFailure("capabilities", { code: "E_CLI_FAILED", message: "" }), "Couldn't read this workspace's capabilities.", "no message: the sentence ends in a full stop");
  assert.equal(view(told(opened, capabilitiesEntry(null, { reason }), { reading: true })).state, "reading", "a retry in flight after a failure");
  assert.equal(view(told(opened, capabilitiesEntry([]))).state, "none");
  const rows = view(shown());
  assert.deepEqual([rows.state, rows.heading], ["rows", null]);
  const kept = view(shown({ options: { reason } }));
  assert.deepEqual([kept.state, kept.heading], ["rows", { label: "", path: null, state: null, short: "Couldn't read this workspace's capabilities: oats capabilities exited 1", readAt: "09:59:30" }]);
  assert.equal(kept.detail.failure, kept.heading.short, "the selected capability's detail holds the sentence whole");
});

test("the list is the shared sections in the Desktop's order, Workspace owned, Repo owned, Packages, each with its repository's or package's groups (`name · note`), the host's repository first; one row per capability with its layer's label", () => {
  assert.deepEqual(names(shown()), [
    "workspace", "oats · member repo · host", "aweb", "tools · member repo", "notes",
    "repo", "oats · member repo · host", "secret",
    "packages", "acme-pack · package · v1.2.0", "pack-tools",
  ]);
  const list = view(shown()).list;
  assert.deepEqual(list.find((item) => item.name === "aweb"), { name: "aweb", layer: "Messaging", selected: true }, "the first capability is selected");
  assert.deepEqual(list.find((item) => item.name === "pack-tools"), { name: "pack-tools", layer: "Knowledge", selected: false });
  assert.equal(list.find((item) => item.name === "notes").layer, null, "no layer: no label");
  // Repo owned stands only when the catalog lists a private capability.
  assert.deepEqual(names(shown({ rows: CAPS().filter((row) => row.private !== true) })).filter((name) => ["workspace", "repo", "packages"].includes(name)), ["workspace", "packages"]);
  assert.deepEqual(names(shown({ rows: [packaged("pack-tools")] })), ["packages", "acme-pack · package · v1.2.0", "pack-tools"], "a section with no row is not drawn");
});

test("the cursor stands on capabilities only: the list's keys pass over the headings, the first capability brings its headings into the pane, and with nothing further to go the list scrolls", () => {
  const start = shown();
  const at = (state) => capabilitiesOf(state).row.name;
  assert.equal(at(start), "aweb");
  const walk = [];
  let state = start;
  for (let i = 0; i < 4; i++) { state = key(state, "j").state; walk.push(at(state)); }
  assert.deepEqual(walk, ["notes", "secret", "pack-tools", "pack-tools"], "down passes over every heading, and stays on the last");
  assert.equal(at(keys(start, "G", "k").state), "secret");
  assert.equal(at(keys(start, "G", "g").state), "aweb");
  // In a pane of four rows the window follows the selection; the first capability takes the headings above it back in.
  const small = { page: 4, extent: 0, room: 4, cols: 38 };
  let low = start;
  for (let i = 0; i < 3; i++) low = key(low, "j", small).state;
  assert.equal(at(low), "pack-tools");
  assert.equal(view(low, 4).list.some((item) => item.section === "workspace"), false, "scrolled down");
  const back = key(low, "g", small).state;
  assert.deepEqual(view(back, 4).list.slice(0, 3).map((item) => item.section ?? item.group ?? item.name), ["workspace", "oats", "aweb"]);
  // At the last capability, Down scrolls instead, and the selection stays.
  const below = key(low, "j", small).state;
  assert.equal(at(below), "pack-tools");
});

test("/ filters the capabilities by name (the shared search); a group or a section left empty is hidden, and none matching says so", () => {
  const typed = keys(shown(), "/", "t", "o", "o", "l").state;
  assert.deepEqual([typed.capabilities.filter, names(typed)], [{ editing: true, query: "tool" }, ["packages", "acme-pack · package · v1.2.0", "pack-tools"]]);
  assert.equal(capabilitiesOf(typed).row.name, "pack-tools", "the selection goes to the first capability the filter keeps");
  const kept = key(typed, "enter").state;
  assert.deepEqual([kept.capabilities.filter, view(kept).state], [{ editing: false, query: "tool" }, "rows"]);
  assert.deepEqual(names(keys(shown(), "/", "T").state), ["workspace", "tools · member repo", "notes", "repo", "oats · member repo · host", "secret", "packages", "acme-pack · package · v1.2.0", "pack-tools"], "case-insensitive; the group of oats in Workspace owned is left empty and hidden");
  assert.equal(view(keys(shown(), "/", "z", "z", "z").state).state, "nomatch");
});

test("the detail is the selected capability's: its name, layer and description; Comes from in the shared facts; Provides, each kind only when reported, null as could not list and [] as none, in the shared words", () => {
  const d = view(shown()).detail;
  assert.deepEqual({ ...d, used: undefined }, {
    name: "aweb", layer: "Messaging", description: "Messaging over aweb.", failure: null, used: undefined,
    words: { comesFrom: CAPABILITY_COPY.comesFrom, provides: CAPABILITY_COPY.provides, usedBy: CAPABILITY_COPY.usedBy },
    comesFrom: [{ label: "Repository", value: "oats" }, { label: "Latest", value: "bbbbbbb" }, { label: "Path", value: "capabilities/aweb" }, { label: "Fingerprint", value: "ccccccc" }],
    provides: [{ label: "Skills", names: ["oats-aweb", "aweb-messaging"], said: null }, { label: "Commands", names: [], said: CAPABILITY_COPY.none }, { label: "Hooks", names: ["SessionStart"], said: null }],
  });
  const notes = view(key(shown(), "j").state).detail;
  assert.deepEqual([notes.name, notes.layer, notes.description, notes.provides], ["notes", null, "", [{ label: "Skills", names: [], said: CAPABILITY_COPY.unlistable }]], "skills null: could not list; commands and hooks not reported: no row");
  const secret = view(keys(shown(), "j", "j").state).detail;
  assert.deepEqual([secret.comesFrom.at(-1), secret.provides], [{ label: "Owned", value: "this repo's souls only" }, []]);
  const pack = view(keys(shown(), "G").state).detail;
  assert.deepEqual(pack.comesFrom, [{ label: "Package", value: "acme-pack" }, { label: "Pinned", value: "1.2.0 · official catalog" }, { label: "Commit", value: "ddddddd" }, { label: "Fingerprint", value: "sha256:aaaa…aaaa" }]);
});

test("Used by, with souls-capabilities: the souls whose composition includes the capability, each its colour, its instances here that carry it and those on an older version; before the souls are read it says so, never that no soul includes it", () => {
  const used = (state) => view(state).detail.used;
  const aweb = used(shown({ cli: COMPOSED }));
  assert.deepEqual(aweb, { state: "known", failure: null, count: CAPABILITY_COPY.souls(2), empty: null, more: 0, shown: [
    { name: "dev", color: "green", count: 2, behind: CAPABILITY_COPY.behind(1), soul: "dev" },
    { name: "reviewer", color: "magenta", count: 1, behind: null, soul: "reviewer" },
  ] });
  // The package soul's instances carry its roster name, `<package>--<soul>`.
  assert.deepEqual(used(keys(shown({ cli: COMPOSED }), "G").state).shown, [{ name: "keeper", color: null, count: 1, behind: null, soul: "keeper" }]);
  const secret = used(keys(shown({ cli: COMPOSED }), "j", "j").state);
  assert.deepEqual([secret.shown, secret.empty, secret.count], [[], CAPABILITY_COPY.noSoul, CAPABILITY_COPY.souls(0)]);
  const before = used(shown({ cli: COMPOSED, souls: null }));
  assert.deepEqual([before.state, before.shown, before.empty, before.count], ["reading", [], null, null]);
  const failed = used(soulsTold(shown({ cli: COMPOSED, souls: null }), catalogEntry(null, { reason: { code: "E_CLI_FAILED", message: "oats souls exited 1" } })));
  assert.deepEqual([failed.state, failed.failure, failed.empty], ["failed", "Couldn't read this workspace's souls: oats souls exited 1", null]);
});

test("Used by, before souls-capabilities: the souls whose instances here carry the capability, named and coloured by their catalog row; one the catalog does not list stands under its agent's name, uncoloured, and shows no soul", () => {
  const used = (state) => view(state).detail.used;
  assert.deepEqual(used(shown()), { state: "known", failure: null, count: CAPABILITY_COPY.souls(2), empty: null, more: 0, shown: [
    { name: "dev", color: "green", count: 2, behind: CAPABILITY_COPY.behind(1), soul: "dev" },
    { name: "reviewer", color: "magenta", count: 1, behind: null, soul: "reviewer" },
  ] });
  // The package soul's instances carry `<package>--<soul>`: its catalog row is found by that name.
  assert.deepEqual(used(keys(shown(), "G").state).shown, [{ name: "keeper", color: null, count: 1, behind: null, soul: "keeper" }]);
  const unread = used(keys(shown({ souls: null }), "G").state);
  assert.deepEqual([unread.state, unread.shown], ["known", [{ name: "acme-pack--keeper", color: null, count: 1, behind: null, soul: null }]], "no catalog row: the agent's name, and nothing to show");
  const secret = used(keys(shown(), "j", "j").state);
  assert.deepEqual([secret.empty, secret.count], [CAPABILITY_COPY.noInstance, CAPABILITY_COPY.souls(0)]);
});

test("Used by lists eight souls at most and counts the rest; only this machine's instances of the open workspace are counted", () => {
  const many = Array.from({ length: 11 }, (_, i) => instanceRow(`soul-${String(i).padStart(2, "0")}`, `inst-${i}`, { modules: { aweb: { status: "current" } } }));
  const state = soulsTold(told(key(base(CLI, many), "3").state, capabilitiesEntry(CAPS())), catalogEntry(many.map((row) => catalogSoul(row.agent))));
  const used = view(state).detail.used;
  assert.deepEqual([used.shown.length, used.more, used.count], [8, 3, CAPABILITY_COPY.souls(11)]);
});

test("in the detail Enter marks the first soul of Used by, Up and Down move the mark, past either end the detail scrolls; Enter shows the marked soul in the Souls view, with it selected; Esc closes the detail, then clears a kept filter, then goes back", () => {
  const start = shown();
  const focused = key(start, "enter").state;
  assert.deepEqual([focused.capabilities.focus, focused.capabilities.mark, view(focused).mark], ["detail", 0, 0]);
  const second = key(focused, "j").state;
  assert.deepEqual([second.capabilities.mark, second.capabilities.detailLoose], [1, false]);
  const past = key(second, "j").state;
  assert.deepEqual([past.capabilities.mark, past.capabilities.detailTop, past.capabilities.detailLoose], [1, 1, true], "past the last soul the detail scrolls");
  assert.equal(key(focused, "k").state.capabilities.detailLoose, true, "past the first too");
  assert.equal(key(focused, "pagedown").state.capabilities.detailTop > 0, true, "PageDown scrolls");
  assert.equal(capabilitiesOf(second).row.name, "aweb", "the selection stays");
  const souls = key(second, "enter");
  assert.deepEqual([souls.state.view, soulsOf(souls.state).selected.name, souls.effect], ["souls", "reviewer", { souls: "settle" }]);
  // A Souls filter that hides the soul is cleared, as the palette's soul does.
  const hidden = keys(souls.state, "/", "d", "e", "v", "enter", "3").state;
  const again = keys(hidden, "enter", "j", "enter").state;
  assert.deepEqual([again.view, soulsOf(again).selected.name, again.souls.filter.query], ["souls", "reviewer", ""]);
  // A soul no catalog row stands for, and a capability no soul uses: Enter in the detail does nothing.
  const unread = keys(shown({ souls: null }), "G", "enter").state;
  assert.equal(key(unread, "enter").state, unread);
  const unused = keys(shown(), "j", "j", "enter");
  assert.deepEqual([unused.state.capabilities.focus, view(unused.state).mark], ["detail", -1]);
  assert.equal(key(unused.state, "enter").state, unused.state);
  assert.equal(key(unused.state, "j").state.capabilities.detailTop, 1, "with no soul listed, Down scrolls");
  // Esc: the detail, then the kept filter, then back to the instances.
  const filtered = keys(shown(), "/", "a", "w", "enter", "enter");
  const steps = [];
  let state = filtered.state;
  for (let i = 0; i < 3; i++) { state = key(state, "escape").state; steps.push([state.view, state.capabilities.focus, state.capabilities.filter.query]); }
  assert.deepEqual(steps, [["capabilities", "list", "aw"], ["capabilities", "list", ""], ["instances", "list", ""]]);
  assert.equal(key(shown(), "1").state.view, "instances");
  assert.deepEqual(keys(shown(), "tab").state.capabilities.focus, "detail", "Tab gives the detail the focus too");
});

test("r in the Capabilities view asks the loop to read the table again, and nothing else; with no workspace of this machine open it asks nothing", () => {
  assert.deepEqual(key(shown(), "r").effect, { capabilities: "reread" });
  const none = key(stateOf(null, { deployment: null, cli: CLI }), "3");
  assert.deepEqual([none.state.view, view(none.state).local, view(none.state).state], ["capabilities", false, "none"]);
  assert.equal(key(none.state, "r").effect, null);
  assert.equal(key(none.state, "/").state.capabilities.filter.editing, false);
});

test("the drawn top of the detail, told by the loop, is the store's: the detail scrolls on from what is on the screen", () => {
  const focused = key(shown(), "enter").state;
  const drawn = reduce(focused, { capabilitiesTop: 4 }).state;
  assert.equal(drawn.capabilities.detailTop, 4);
  assert.equal(reduce(focused, { capabilitiesTop: -1 }).state, focused, "not a row");
  assert.equal(reduce(key(focused, "1").state, { capabilitiesTop: 4 }).state.capabilities.detailTop, 0, "another view: nothing");
});

test("the selected capability and the filter are kept when the view is left and shown again, for the run; the view comes back with its list focused", () => {
  const left = keys(shown(), "/", "e", "enter", "j", "enter", "1").state;
  assert.equal(left.view, "instances");
  const again = key(left, "3").state;
  assert.deepEqual([capabilitiesOf(again).row.name, again.capabilities.filter.query, again.capabilities.focus], ["notes", "e", "list"], "aweb, notes and secret hold an e: the second kept");
});

test("the palette lists the capabilities once their table was read, each with where it comes from; choosing one shows the view with it selected, clearing a kept filter that hides it; before the view was shown it lists none", () => {
  const never = key(base(), "ctrl+k").state;
  assert.equal(paletteItems(never).items.some((item) => item.kind === "capability"), false);
  const choose = (state, query, name) => {
    let palette = key(key(state, "1").state, "ctrl+k").state;
    for (const ch of query) palette = key(palette, ch).state;
    const items = paletteItems(palette).items, at = items.findIndex((item) => item.kind === "capability" && item.name === name);
    for (let i = 0; i < at; i++) palette = key(palette, "down").state;
    return key(palette, "enter");
  };
  const listed = paletteItems(key(key(shown(), "1").state, "ctrl+k").state).items;
  const kinds = listed.map((item) => item.kind);
  assert.equal(kinds.lastIndexOf("soul") < kinds.indexOf("capability") && kinds.lastIndexOf("capability") < kinds.indexOf("view"), true, "after the souls, before the views");
  assert.deepEqual(listed.filter((item) => item.kind === "capability").map((item) => [item.label, item.source]), [["notes", "tools"], ["aweb", "oats"], ["secret", "oats"], ["pack-tools", "acme-pack"]]);
  const kept = keys(shown(), "/", "a", "w", "enter").state;
  const ran = choose(kept, "pack", "pack-tools");
  assert.deepEqual([ran.state.view, capabilitiesOf(ran.state).row.name, ran.state.capabilities.filter.query, ran.state.palette, ran.effect], ["capabilities", "pack-tools", "", null, { souls: "settle", capabilities: "settle" }]);
  const visible = choose(kept, "aweb", "aweb").state;
  assert.deepEqual([capabilitiesOf(visible).row.name, visible.capabilities.filter.query], ["aweb", "aw"], "a filter that shows it is kept");
});

test("two capabilities of one name, a member's and a package's, are two rows: the selection and the palette tell them apart by where they come from", () => {
  const twins = shown({ rows: [member("tools", "acme/oats"), packaged("tools")] });
  assert.deepEqual(names(twins), ["workspace", "oats · member repo · host", "tools", "packages", "acme-pack · package · v1.2.0", "tools"]);
  const second = key(twins, "j").state;
  assert.deepEqual([capabilitiesOf(second).row.kind, view(second).list.filter((item) => item.selected).length], ["package", 1]);
  const palette = paletteItems(key(key(twins, "1").state, "ctrl+k").state).items.filter((item) => item.kind === "capability");
  assert.equal(new Set(palette.map((item) => item.key)).size, 2);
});

test("what the loop holds is kept per workspace, and only for a served one", () => {
  const start = shown();
  assert.equal(told(start, capabilitiesEntry([]), { id: "/elsewhere" }).capabilities, start.capabilities, "a workspace that is not served is not kept");
  assert.equal(start.capabilities.held.get(DEPLOYMENT).entry.capabilities.capabilities.length, 4);
});
