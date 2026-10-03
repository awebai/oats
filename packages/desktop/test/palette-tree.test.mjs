// Spec F: the command palette lists instances like the sidebar roster (same
// relation groups, order and depth, from the sidebar's own builders), keeps
// tree order under a query with non-matching ancestors as disabled context
// rows, and cycles its rows with its own chord (⌘K / Ctrl+Shift+P) while open.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { paletteRows, createPalette, PALETTE_COMMAND_CAP } from "../renderer/palette.mjs";
import { rosterGroups } from "../renderer/instance-tree.mjs";
import { rosterSections } from "../renderer/view-deployments.mjs";
import { pickerCycleDirection, setBinding, resetBinding, DEFAULT_KEYMAP } from "../renderer/keybindings.mjs";

const at = (instance, extra = {}) => ({ instance, agent: "dev", home: `/w/${instance}`, agentsRoot: "/w", running: true, ...extra });
// Two relation clusters and two unrelated instances, deliberately out of order.
const ROSTER = [
  at("solo-y", { running: false }),
  at("grandchild", { parentInstance: "child-a" }),
  at("lead"),
  at("child-b", { parentInstance: "lead", running: false }),
  at("alpha", { running: false }),
  at("solo-x"),
  at("child-a", { parentInstance: "lead" }),
  at("alpha-kid", { parentInstance: "alpha" }),
];
const COMMANDS = [{ label: "Theme: toggle", detail: "", run: () => {} }, { label: "Split: terminal right", detail: () => "⌘\\", run: () => {} }];
const instanceRows = rows => rows.filter(row => row.group);

test("an empty query lists every instance in the sidebar's groups, order and depth, then the commands", () => {
  const rows = paletteRows(ROSTER, COMMANDS, "", { openTerminal() {} });
  assert.deepEqual(instanceRows(rows).map(r => [r.group.label, r.label, r.depth, r.under || null]), [
    ["alpha", "alpha", 0, null], ["alpha", "alpha-kid", 1, "under alpha"],
    ["lead", "lead", 0, null], ["lead", "child-a", 1, "under lead"], ["lead", "grandchild", 2, "under child-a"], ["lead", "child-b", 1, "under lead"],
    ["independent", "solo-x", 0, null], ["independent", "solo-y", 0, null],
  ]);
  // Parity: the sidebar's own builder over the same roster gives the same sequence.
  const sidebar = rosterGroups(ROSTER, ROSTER).flatMap(g => g.clusters.flatMap(c => c.instances.map(i => [g.key, i.instance, i.depth])));
  assert.deepEqual(instanceRows(rows).map(r => [r.group.key, r.label, r.depth]), sidebar);
  assert.deepEqual(rows.slice(ROSTER.length).map(r => r.label), ["Theme: toggle", "Split: terminal right"], "commands follow");
  assert.equal(rows.at(-1).detail, "⌘\\", "live chord details still evaluate");
  assert.ok(rows.every(r => !r.context && typeof r.run === "function"), "no query: every row opens");
  assert.equal(rows.length, ROSTER.length + COMMANDS.length, "no instance is capped or hidden");
});

test("collapsed sidebar state is ignored and every instance is listed, however many", () => {
  const many = Array.from({ length: 40 }, (_, i) => at(`inst-${String(i).padStart(2, "0")}`));
  const rows = paletteRows(many, [], "", { openTerminal() {} });
  assert.equal(rows.length, 40, "the old 12-row cap no longer cuts instances");
});

test("a query keeps tree order: matches at their depth, their non-matching ancestors as context rows", () => {
  const opened = [];
  const rows = paletteRows(ROSTER, COMMANDS, "grand", { openTerminal: ref => opened.push(ref) });
  assert.deepEqual(rows.map(r => [r.label, r.depth, !!r.context]), [["lead", 0, true], ["child-a", 1, true], ["grandchild", 2, false]]);
  assert.ok(rows.filter(r => r.context).every(r => r.run === undefined), "a context row cannot open anything");
  rows[2].run();
  assert.deepEqual(opened, [{ instance: "grandchild", home: "/w/grandchild", agentsRoot: "/w" }]);
  // Two matches in one cluster: tree order, not score order; the shared ancestor appears once.
  const both = paletteRows(ROSTER, [], "child", { openTerminal() {} });
  assert.deepEqual(both.map(r => [r.label, !!r.context]), [["lead", true], ["child-a", false], ["grandchild", false], ["child-b", false]]);
});

test("'>' restricts to commands, and commands keep their own cap after the instances", () => {
  const commands = Array.from({ length: 20 }, (_, i) => ({ label: `Command ${i}`, run() {} }));
  const all = paletteRows(ROSTER, commands, "", { openTerminal() {} });
  assert.equal(all.length, ROSTER.length + PALETTE_COMMAND_CAP);
  const onlyCommands = paletteRows(ROSTER, commands, ">", { openTerminal() {} });
  assert.equal(onlyCommands.length, PALETTE_COMMAND_CAP);
  assert.ok(onlyCommands.every(r => !r.group));
  assert.deepEqual(paletteRows(ROSTER, COMMANDS, ">theme").map(r => r.label), ["Theme: toggle"]);
});

test("the palette's chord cycles: Mod+K down, Shift down to up; Ctrl+Shift+P has no Shift form; rebinds follow", t => {
  t.after(() => resetBinding("app.palette"));
  const ev = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
  assert.deepEqual(DEFAULT_KEYMAP["app.palette"], { mac: "Mod+K", other: "Ctrl+Shift+P" });
  assert.equal(pickerCycleDirection(ev("k", { metaKey: true }), "app.palette", true), 1);
  assert.equal(pickerCycleDirection(ev("K", { metaKey: true, shiftKey: true }), "app.palette", true), -1);
  assert.equal(pickerCycleDirection(ev("j", { metaKey: true }), "app.palette", true), 0);
  assert.equal(pickerCycleDirection(ev("k", { ctrlKey: true }), "app.palette", true), 0, "⌃K is not ⌘K on macOS");
  assert.equal(pickerCycleDirection(ev("P", { ctrlKey: true, shiftKey: true }), "app.palette", false), 1);
  assert.equal(pickerCycleDirection(ev("p", { ctrlKey: true }), "app.palette", false), 0, "no reverse chord: ArrowUp moves up");
  setBinding("app.palette", "Mod+J");
  assert.equal(pickerCycleDirection(ev("k", { metaKey: true }), "app.palette", true), 0);
  assert.equal(pickerCycleDirection(ev("j", { metaKey: true }), "app.palette", true), 1);
  assert.equal(pickerCycleDirection(ev("j", { metaKey: true, shiftKey: true }), "app.palette", true), -1);
  setBinding("app.palette", null);
  assert.equal(pickerCycleDirection(ev("k", { metaKey: true }), "app.palette", true), 0, "unbound: nothing cycles");
  setBinding("app.palette", "K");
  assert.equal(pickerCycleDirection(ev("k"), "app.palette", true), 0, "a plain chord never steals typing");
});

function palette(t, roster = ROSTER) {
  const dom = new JSDOM('<!doctype html><body><button id="opener">Open</button></body>', { url: "http://localhost" });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const opened = [], reachedShell = [];
  // The keymap engine listens on window: a consumed cycle chord must never reach it.
  dom.window.addEventListener("keydown", e => reachedShell.push(e.key));
  const picker = createPalette({
    loadInstances: async () => roster, openTerminal: ref => opened.push(ref.instance),
    commands: COMMANDS.map(c => ({ ...c, run: () => opened.push(c.label) })),
    cycleKey: e => pickerCycleDirection(e, "app.palette", true), doc,
  });
  t.after(() => picker.close());
  doc.getElementById("opener").focus();
  const key = (key, mods = {}, type = "keydown") => {
    const event = new dom.window.KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...mods });
    doc.activeElement.dispatchEvent(event);
    return event;
  };
  const input = () => doc.querySelector(".palette-input");
  const active = () => doc.getElementById(input().getAttribute("aria-activedescendant"))?.querySelector(".plabel").textContent;
  const filter = value => { input().value = value; input().dispatchEvent(new dom.window.Event("input", { bubbles: true })); };
  return { dom, doc, picker, opened, reachedShell, key, input, active, filter };
}

test("⌘K while open moves down and wraps, ⇧⌘K moves up; releasing commits nothing; Enter opens; Esc closes", async t => {
  const p = palette(t);
  await p.picker.open();
  assert.equal(p.active(), "alpha");
  for (const expected of ["alpha-kid", "lead", "child-a"]) {
    const event = p.key("k", { metaKey: true });
    assert.equal(event.defaultPrevented, true);
    assert.equal(p.active(), expected);
  }
  p.key("Meta", {}, "keyup"); p.key("k", {}, "keyup");
  assert.deepEqual(p.opened, [], "releasing the chord does not commit");
  p.key("k", { metaKey: true, shiftKey: true });
  assert.equal(p.active(), "lead");
  assert.deepEqual(p.reachedShell, [], "the chord never reaches the shell's keymap (no close, no reopen)");
  for (let i = 0; i < 2; i++) p.key("k", { metaKey: true, shiftKey: true });
  assert.equal(p.active(), "alpha");
  p.key("k", { metaKey: true, shiftKey: true });
  assert.equal(p.active(), "Split: terminal right", "up from the first row wraps to the last");
  p.key("k", { metaKey: true });
  assert.equal(p.active(), "alpha", "down from the last row wraps to the first");
  p.picker.toggle(); // the same action from anywhere else agrees: it cycles, it does not close
  assert.ok(p.doc.querySelector(".palette-overlay")); assert.equal(p.active(), "alpha-kid");
  p.key("Enter");
  assert.deepEqual(p.opened, ["alpha-kid"]);
  assert.equal(p.doc.querySelector(".palette-overlay"), null);
  p.doc.getElementById("opener").focus();
  await p.picker.open();
  assert.ok(p.key("Escape").defaultPrevented);
  assert.equal(p.doc.querySelector(".palette-overlay"), null, "Esc closes");
  assert.equal(p.doc.activeElement.id, "opener", "and returns focus");
  assert.deepEqual(p.opened, ["alpha-kid"]);
});

test("context rows are disabled options the arrows, the chord and the pointer skip", async t => {
  const p = palette(t);
  await p.picker.open();
  p.filter("grand");
  const options = [...p.doc.querySelectorAll('[role="option"]')];
  assert.deepEqual(options.map(o => o.getAttribute("aria-disabled")), ["true", "true", null]);
  assert.equal(p.active(), "grandchild", "the first selectable row is active, not its ancestor");
  p.key("ArrowUp"); assert.equal(p.active(), "grandchild");
  p.key("k", { metaKey: true }); assert.equal(p.active(), "grandchild", "cycling with one selectable row stays on it");
  p.key("k", { metaKey: true, shiftKey: true }); assert.equal(p.active(), "grandchild");
  options[0].dispatchEvent(new p.dom.window.MouseEvent("mousemove", { bubbles: true }));
  assert.equal(p.active(), "grandchild");
  options[0].dispatchEvent(new p.dom.window.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(p.opened, [], "a context row never runs");
  assert.ok(options.slice(0, 2).every(o => o.getAttribute("aria-selected") === "false" && o.classList.contains("context")));
  p.filter("child");
  assert.equal(p.active(), "child-a");
  p.key("ArrowDown"); assert.equal(p.active(), "grandchild");
  p.key("ArrowDown"); assert.equal(p.active(), "child-b");
  p.key("ArrowDown"); assert.equal(p.active(), "child-b", "the arrows still clamp");
  p.key("k", { metaKey: true }); assert.equal(p.active(), "child-a", "the chord wraps past the context row");
});

test("each relation group is one named role=group in the listbox; depth is indentation plus words", async t => {
  const p = palette(t);
  await p.picker.open();
  const list = p.doc.querySelector('[role="listbox"]');
  const groups = [...list.querySelectorAll(':scope > [role="group"]')];
  assert.deepEqual(groups.map(g => g.getAttribute("aria-label")), ["alpha", "lead", "independent"], "named once, on entry");
  assert.deepEqual(groups.map(g => [...g.children].map(o => o.querySelector(".plabel").textContent)),
    [["alpha", "alpha-kid"], ["lead", "child-a", "grandchild", "child-b"], ["solo-x", "solo-y"]]);
  assert.ok(groups.every(g => [...g.children].every(o => o.getAttribute("role") === "option" && !o.hasAttribute("aria-label"))),
    "options keep their content name; the group's name is not repeated per row");
  const commands = [...list.querySelectorAll(':scope > [role="option"]')];
  assert.deepEqual(commands.map(o => o.querySelector(".plabel").textContent), ["Theme: toggle", "Split: terminal right"], "commands follow, ungrouped");
  const grandchild = [...list.querySelectorAll('[role="option"]')].find(o => o.querySelector(".plabel").textContent === "grandchild");
  assert.equal(grandchild.style.getPropertyValue("--depth"), "2");
  assert.equal(grandchild.querySelector(".sr-only").textContent, ", under child-a", "read with the option, visually hidden");
  assert.equal(grandchild.hasAttribute("aria-level"), false, "aria-level is not an option's attribute");
  assert.equal(list.querySelector('[aria-level]'), null);
  const ids = [...list.querySelectorAll('[role="option"]')].map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(p.input().getAttribute("aria-activedescendant"), ids[0]);
});

test("the shell wires the cycle to the live app.palette chord; Quick Open (⌘P) keeps its plain toggle", async () => {
  const { readFileSync } = await import("node:fs");
  const shell = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
  assert.match(shell, /cycleKey: \(e\) => pickerCycleDirection\(e, "app\.palette", isMac\)/);
  assert.match(shell, /registerAction\(\{ id: "app\.palette", [^\n]*palette\.toggle\(\)/, "the action still opens it; open, it cycles");
  const quickOpen = readFileSync(new URL("../renderer/quick-open.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(quickOpen, /cycleKey/, "a second ⌘P still closes Quick Open");
});

test("filterInstanceTree takes the palette's matcher and keeps the sidebar's default; rosterGroups is the sidebar's grouping", async () => {
  const { filterInstanceTree, instanceMatchesFilter } = await import("../renderer/instance-tree.mjs");
  const names = list => list.map(i => i.instance);
  // Default (sidebar): substring over name/soul/repo/task, with ancestor paths, in source order.
  assert.deepEqual(names(filterInstanceTree(ROSTER, "grandchild")), ["grandchild", "lead", "child-a"]);
  assert.deepEqual(names(filterInstanceTree(ROSTER, "grandchild")), names(ROSTER.filter(i => ["grandchild", "lead", "child-a"].includes(i.instance))));
  assert.equal(filterInstanceTree(ROSTER, "  "), ROSTER, "no query: the roster itself");
  assert.ok(ROSTER.filter(i => instanceMatchesFilter(i, "kid")).every(i => i.instance === "alpha-kid"));
  // A predicate decides the matches; the identity-aware ancestor walk is the same.
  assert.deepEqual(names(filterInstanceTree(ROSTER, "x", i => i.instance === "alpha-kid")), ["alpha", "alpha-kid"]);
  // Groups: multi-member clusters by name, then "independent"; projected to what is visible.
  const visible = ROSTER.filter(i => ["solo-x", "alpha-kid"].includes(i.instance));
  assert.deepEqual(rosterGroups(ROSTER, visible).map(g => [g.key, g.label, g.clusters.flatMap(c => names(c.instances))]),
    [["independent", "independent", ["alpha-kid", "solo-x"]]], "a cluster with one visible member reads as independent, as in the sidebar");
  assert.deepEqual(rosterGroups([], []), []);
});

test("two relation groups whose roots share a name (two agents roots) stay two named groups", async t => {
  const run = (instance, root, extra = {}) => ({ instance, agent: "dev", home: `${root}/${instance}`, agentsRoot: root, running: true, ...extra });
  const roster = [
    run("lead", "/a"), run("child-a", "/a", { parentInstance: "lead" }),
    run("lead", "/b"), run("child-b", "/b", { parentInstance: "lead" }),
  ];
  const groups = rosterGroups(roster, roster);
  assert.deepEqual(groups.map(g => g.label), ["lead", "lead"], "the sidebar's two clusters, each under its root's name");
  assert.equal(new Set(groups.map(g => g.key)).size, 2, "distinct keys: the picker's group boundary");
  const p = palette(t, roster);
  await p.picker.open();
  const rendered = [...p.doc.querySelectorAll('[role="listbox"] > [role="group"]')];
  assert.deepEqual(rendered.map(g => [g.getAttribute("aria-label"), [...g.children].map(o => o.querySelector(".plabel").textContent)]),
    groups.map(g => ["lead", g.clusters[0].instances.map(i => i.instance)]), "one role=group per cluster, in the sidebar's order");
});

// #482 (the Deployments page, merged with spec F): with several deployments the sidebar
// sections the roster by deployment, each clustered on its own. The palette lists the
// same sections in the same order, and a relation or a query's context never crosses one.
const D1 = { id: "/a", machine: "This Mac", path: "/a", label: "~/a", local: true, reachable: true, primary: true };
const D2 = { id: "remote:altair:b", machine: "altair", path: "/b", label: "~/b", local: false, reachable: true, primary: false };
const inD = (d, instance, extra = {}) => ({ instance, agent: "dev", home: `${d.path}/agents/dev/instances/${instance}`, agentsRoot: `${d.path}/agents`,
  running: true, deployment: { id: d.id }, ...extra });

test("several deployments: the palette lists the sidebar's sections in its order, each group named by its deployment (review, merge of #489)", () => {
  const roster = { instances: [inD(D2, "alpha"), inD(D1, "zeta"), inD(D1, "lead"), inD(D1, "kid", { parentInstance: "lead" })], deployments: [D1, D2] };
  const rows = instanceRows(paletteRows(roster, [], "", { openTerminal() {} }));
  assert.deepEqual(rows.map(r => r.label), ["lead", "kid", "zeta", "alpha"], "D1's groups first, as the panel lists the deployments: not alphabetical across them");
  const sidebar = rosterSections(roster.instances, roster.instances, roster.deployments)
    .flatMap(sec => sec.groups.flatMap(g => g.clusters.flatMap(c => c.instances.map(i => [`${sec.deployment.id}|${g.key}`, `${sec.label} · ${g.label}`, i.instance, i.depth]))));
  assert.deepEqual(rows.map(r => [r.group.key, r.group.label, r.label, r.depth]), sidebar, "the sidebar's own sections, groups and depth");
  const independents = [...new Set(rows.filter(r => r.group.label.endsWith("independent")).map(r => r.group.key))];
  assert.equal(independents.length, 2, "each deployment's independent group stays its own group");
  assert.deepEqual(paletteRows({ instances: ROSTER, deployments: [D1] }, [], "", {}).map(r => [r.group.key, r.label]),
    paletteRows(ROSTER, [], "", {}).map(r => [r.group.key, r.label]), "one deployment: exactly the single-roster rows");
});

test("several deployments: a parent name in another deployment is not a parent, and a query brings no context across", () => {
  const roster = { instances: [inD(D1, "lead"), inD(D2, "child", { parentInstance: "lead" })], deployments: [D1, D2] };
  const all = instanceRows(paletteRows(roster, [], "", { openTerminal() {} }));
  assert.deepEqual(all.map(r => [r.label, r.depth, r.under || null]), [["lead", 0, null], ["child", 0, null]], "D2's child is a root, as in the sidebar");
  const queried = instanceRows(paletteRows(roster, [], "child", { openTerminal() {} }));
  assert.deepEqual(queried.map(r => [r.label, !!r.context]), [["child", false]], "D1's lead is not shown as context");
});
