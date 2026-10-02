// Application menu policy regression (review befe75b important 1): role
// menus on Linux/Windows register Ctrl accelerators (Ctrl+C/A/Z/R/W …) that
// fire before web content and steal xterm's terminal control chords — the
// menu must exist ONLY on macOS, where its Cmd accelerators cannot collide
// with Ctrl-based terminal keys and are required for clipboard shortcuts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appMenuTemplate } from "../app-menu.mjs";

test("app menu: macOS gets the full role menu including editMenu", () => {
  const t = appMenuTemplate("darwin", { newWindow() {} });
  assert.ok(Array.isArray(t), "darwin gets a template");
  const roles = t.map((i) => i.role);
  assert.ok(roles.includes("editMenu"), "editMenu present (Cmd+C/V/X/A live)");
  assert.ok(roles.includes("appMenu"), "standard macOS app menu present");
  // ⌘` cycles standard windows through the standard Window menu (#481).
  assert.ok(roles.includes("windowMenu"), "windowMenu present");
  // role-only entries: no custom accelerators or click handlers to audit,
  // except exactly File → New Window ⌘⇧N (#481)
  for (const item of t) {
    if (item.label === "File") continue;
    assert.deepEqual(Object.keys(item), ["role"], `role-only menu item (got ${JSON.stringify(item)})`);
  }
});

test("app menu: macOS File holds exactly New Window ⌘⇧N, then the standard Close Window", () => {
  const opened = [];
  const t = appMenuTemplate("darwin", { newWindow: () => opened.push("new") });
  const files = t.filter((i) => i.label === "File");
  assert.equal(files.length, 1); assert.equal(t.indexOf(files[0]), 1, "where fileMenu stood");
  assert.ok(!t.some((i) => i.role === "fileMenu"), "replaces the fileMenu role");
  const [item, separator, close, ...rest] = files[0].submenu;
  assert.deepEqual(Object.keys(item).sort(), ["accelerator", "click", "label"]);
  assert.equal(item.label, "New Window"); assert.equal(item.accelerator, "CmdOrCtrl+Shift+N");
  item.click(); assert.deepEqual(opened, ["new"]);
  assert.deepEqual(separator, { type: "separator" }); assert.deepEqual(close, { role: "close" }); assert.deepEqual(rest, []);
});

test("app menu: Linux and Windows get NO menu — terminal Ctrl chords stay with xterm", () => {
  // New Window there is a palette command and the switcher action, with no chord (#481).
  assert.equal(appMenuTemplate("linux", { newWindow() {} }), null);
  assert.equal(appMenuTemplate("win32", { newWindow() {} }), null);
  assert.equal(appMenuTemplate("freebsd", { newWindow() {} }), null);
});
