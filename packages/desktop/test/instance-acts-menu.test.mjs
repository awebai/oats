// Decide, then build: the roster row's actions menu is drawn from packages/client/instance-acts.mjs, and it
// is the menu it was. The proof is a capture: fixtures/instance-menu/before-instance-acts.json is what
// helpers/instance-menu-probe.mjs reported for every row of its table on the code before the rebuild (the
// fixture names the commit). The same probe runs here on the menu as it is now.
//
// One difference, named below: a remote row the kernel does not report addressable used to carry items in a
// menu that no path could open; it now carries none. The capture proves they could not be reached before,
// and the probe proves the menu still cannot be opened.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { instanceActions } from "../renderer/instance-actions.mjs";
import { instanceActs } from "../../client/instance-acts.mjs";
import { ROWS, probeAll } from "./helpers/instance-menu-probe.mjs";

const before = JSON.parse(readFileSync(new URL("./fixtures/instance-menu/before-instance-acts.json", import.meta.url), "utf8"));
const after = await probeAll(instanceActions);

/** The rows whose menu used to hold items nobody could reach: every row that is not addressable, but for the two whose menu was already empty (a spawning home). */
const INERT_ITEMS_GONE = [
  "unaddressable",
  "unaddressable (gone from the server)",
  "unaddressable (not reported)",
  "unaddressable (server not reached)",
  "unaddressable and held: spawn incomplete",
  "unaddressable and held: retire incomplete",
  "all three: unaddressable, held and an unsupported session",
];
const NO_WAY_IN = { "a click on the trigger": false, openActionMenu: false, "ArrowDown on the trigger": false, "ArrowUp on the trigger": false,
  "the popover's own toggle": { opened: false, refused: true } };
/** A menu no path opens: the trigger is disabled, opening by any way leaves it closed (the popover's own toggle is refused), its `run` is never handed to the shell, and activating an item does nothing. */
function assertCannotOpen(report, name) {
  assert.equal(report.trigger.disabled, true, `${name}: the trigger is disabled`);
  assert.deepEqual(report.opens, NO_WAY_IN, `${name}: no way of opening it opens it`);
  assert.equal(report.handedOut, 0, `${name}: the menu never hands its execute to the shell`);
  for (const [action, did] of Object.entries(report.acts)) assert.deepEqual(did, { clicked: [], run: null }, `${name}: ${action} does nothing`);
}

test("the capture and the probe cover the same rows, and the capture is of a menu that worked", () => {
  assert.match(before.capturedFrom, /^packages\/desktop\/renderer\/instance-actions\.mjs at [0-9a-f]{40} /);
  assert.deepEqual(Object.keys(before.rows), Object.keys(ROWS));
  assert.deepEqual(Object.keys(after), Object.keys(ROWS));
  // Not a capture of an empty page: the ordinary rows open by every way and their items act.
  const stopped = before.rows.stopped;
  assert.deepEqual(stopped.items.map((item) => item.action), ["open-split", "open-pr", "inspect", "start", "stop", "retire"]);
  assert.deepEqual(stopped.opens, { "a click on the trigger": true, openActionMenu: true, "ArrowDown on the trigger": true, "ArrowUp on the trigger": true,
    "the popover's own toggle": { opened: true, refused: false } });
  assert.deepEqual(stopped.acts.start, { clicked: ["invoke start"], run: ["invoke start"] });
  assert.deepEqual(stopped.acts.retire, { clicked: ["lifecycle retire"], run: ["lifecycle retire"] });
});

for (const name of Object.keys(ROWS)) {
  if (INERT_ITEMS_GONE.includes(name)) continue;
  test(`the menu is what it was: ${name}`, () => {
    // Everything the probe reports: the trigger's state, title and description, each item's action, label, disabled
    // state, title, note, shortcut and icon in order, which ways open the menu, and what each item does.
    assert.deepEqual(after[name], before.rows[name]);
  });
}

for (const name of INERT_ITEMS_GONE) {
  test(`the one difference, items no path could reach are gone: ${name}`, () => {
    const was = before.rows[name], now = after[name];
    assert.equal(instanceActs(ROWS[name]).blocked?.code, "unaddressable", "the row the difference is about");
    // Before: a menu with items, which could not be opened and whose items did nothing.
    assert.ok(was.items.length > 0, "the capture has the items");
    assert.deepEqual(Object.keys(was.acts), was.items.map((item) => item.action));
    assertCannotOpen(was, `${name}, before`);
    // After: the same trigger, saying the same thing, on a menu with no items that still cannot be opened.
    assert.deepEqual(now.items, []);
    assert.deepEqual(now.acts, {});
    assertCannotOpen(now, `${name}, after`);
    assert.deepEqual({ ...now, items: was.items, acts: was.acts }, was, "nothing else differs: the trigger, its title and every way of opening");
  });
}

test("every row instanceActs blocks has a menu that cannot be opened, before and after, and says why on its trigger", () => {
  const blockedRows = Object.keys(ROWS).filter((name) => instanceActs(ROWS[name]).blocked);
  assert.ok(blockedRows.length >= INERT_ITEMS_GONE.length + 3, "the rows of the difference, and the spawning homes");
  for (const name of INERT_ITEMS_GONE) assert.ok(blockedRows.includes(name), name);
  for (const name of blockedRows) {
    assertCannotOpen(before.rows[name], `${name}, before`); assertCannotOpen(after[name], `${name}, after`);
    assert.equal(after[name].trigger.title, instanceActs(ROWS[name]).blocked.sentence, `${name}: the trigger's title is the reason's sentence`);
    assert.equal(after[name].trigger.title, before.rows[name].trigger.title);
  }
  // And only those: a row that is not blocked opens.
  for (const name of Object.keys(ROWS).filter((row) => !blockedRows.includes(row))) {
    assert.equal(after[name].trigger.disabled, false, name);
    assert.equal(after[name].opens.openActionMenu, true, name);
  }
});

test("a limited row gets none of the caller's own items; a row that offers everything gets them in front", () => {
  for (const [name, row] of Object.entries(ROWS)) {
    const { blocked, limited, acts } = instanceActs(row), items = after[name].items.map((item) => item.action);
    assert.deepEqual(items, [...(blocked || limited ? [] : ["open-split", "open-pr"]), ...acts.map((act) => act.verb)], name);
    for (const act of acts) {
      const item = after[name].items.find((entry) => entry.action === act.verb);
      assert.equal(item.disabled, !act.enabled, `${name}: ${act.verb}`);
      assert.equal(item.title, act.reason?.sentence ?? "", `${name}: ${act.verb} carries its reason`);
    }
  }
});

test("source pin: the menu decides nothing itself", () => {
  // The four helpers the menu used to decide with. If it needs one again, the decision has not fully moved.
  const source = readFileSync(new URL("../renderer/instance-actions.mjs", import.meta.url), "utf8");
  for (const name of ["heldHome", "unsupportedSession", "canAddressRemote", "rowReason"]) assert.ok(!source.includes(name), `instance-actions.mjs names ${name}`);
  assert.match(source, /import \{ instanceActs \} from "\.\.\/\.\.\/client\/instance-acts\.mjs";/);
  assert.ok(!/\.running\b/.test(source), "nor does it read the row's liveness");
});
