// The sidebar's width (sidebar-width.mjs): its bounds, the clamp on a window resize, its storage, the
// handle's keys, drag, double-click and ARIA, and the PTY-resize holds it takes while it moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  createSidebarWidth, readSidebarWidth, sidebarMax, clampSidebarWidth, SIDEBAR_WIDTH_KEY, SIDEBAR_KEY_SETTLE_MS,
} from "../renderer/sidebar-width.mjs";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}

function rig(t, { width = 1400, storage = memoryStorage() } = {}) {
  const dom = new JSDOM('<div id="app"><aside id="sidebar"><div id="nav-foot"></div></aside><div id="workbench"></div></div>');
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document;
  Object.defineProperty(win, "innerWidth", { value: width, configurable: true, writable: true });
  const frames = [];
  win.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  const timers = new Map(); let nextTimer = 1;
  const clock = { setTimeout: (fn, ms) => { timers.set(nextTimer, { fn, ms }); return nextTimer++; }, clearTimeout: id => timers.delete(id) };
  const holds = { taken: 0, released: 0 };
  const hold = () => { holds.taken++; let done = false; return () => { if (!done) { done = true; holds.released++; } }; };
  const sw = createSidebarWidth({ doc, win, storage, hold, clock });
  const h = sw.handle; h.setPointerCapture = () => {};
  const key = (k, init = {}) => { const e = new win.KeyboardEvent("keydown", { key: k, cancelable: true, bubbles: true, ...init }); h.dispatchEvent(e); return e; };
  const pointer = (type, x, id = 1) => { const e = new win.Event(type, { cancelable: true, bubbles: true }); Object.assign(e, { button: 0, pointerId: id, clientX: x, clientY: 0 }); h.dispatchEvent(e); return e; };
  const runFrames = () => { for (const fn of frames.splice(0)) fn(); };
  const runTimers = () => { for (const [id, { fn }] of [...timers]) { timers.delete(id); fn(); } };
  const resizeWindow = w => { win.innerWidth = w; win.dispatchEvent(new win.Event("resize")); };
  const cssWidth = () => doc.getElementById("app").style.getPropertyValue("--sidebar-w");
  const aria = () => ["aria-valuenow", "aria-valuemin", "aria-valuemax"].map(a => h.getAttribute(a));
  return { win, doc, sw, h, storage, holds, timers, frames, key, pointer, runFrames, runTimers, resizeWindow, cssWidth, aria };
}

test("bounds: 240px to min(480px, 45% of the window), and the minimum wins in a window under 534px", () => {
  assert.equal(sidebarMax(1400), 480);
  assert.equal(sidebarMax(1000), 450);
  assert.equal(sidebarMax(600), 270);
  assert.equal(sidebarMax(500), 240, "45% of 500 is 225: the minimum wins");
  assert.equal(clampSidebarWidth(100, 1400), 240);
  assert.equal(clampSidebarWidth(900, 1400), 480);
  assert.equal(clampSidebarWidth(300.6, 1400), 301, "whole px");
});

test("storage: a missing, invalid or out-of-bounds value, or storage that throws, means 288", () => {
  assert.equal(readSidebarWidth(memoryStorage()), 288);
  assert.equal(readSidebarWidth(null), 288);
  for (const bad of ["", "wide", "300px", "-300", "3e2", "300.5", " 300", "239", "481", "99999"]) {
    assert.equal(readSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_KEY]: bad })), 288, JSON.stringify(bad));
  }
  assert.equal(readSidebarWidth({ getItem: () => { throw new Error("denied"); } }), 288);
  assert.equal(readSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_KEY]: "352" })), 352);
  assert.equal(readSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_KEY]: "240" })), 240);
  assert.equal(readSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_KEY]: "480" })), 480);
});

test("the handle: the resizer's class and orientation, a vertical separator labelled Sidebar width, in px", t => {
  const r = rig(t);
  assert.equal(r.h.parentElement, r.doc.getElementById("sidebar"), "on the sidebar's edge");
  assert.equal(r.h.className, "split-resizer");
  assert.equal(r.h.dataset.orientation, "row");
  assert.equal(r.h.id, "sidebar-resizer");
  assert.equal(r.h.tabIndex, 0, "a Tab stop");
  assert.deepEqual(["role", "aria-orientation", "aria-label", "aria-controls"].map(a => r.h.getAttribute(a)),
    ["separator", "vertical", "Sidebar width", "sidebar"]);
  assert.deepEqual(r.aria(), ["288", "240", "480"]);
  assert.equal(r.cssWidth(), "288px");
  assert.equal(r.doc.querySelectorAll(".split-resizer").length, 1);
});

test("a stored width applies at start; a throwing storage leaves the default and never throws on write", t => {
  assert.equal(rig(t, { storage: memoryStorage({ [SIDEBAR_WIDTH_KEY]: "400" }) }).cssWidth(), "400px");
  const throwing = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
  const r = rig(t, { storage: throwing });
  assert.equal(r.cssWidth(), "288px");
  r.key("ArrowRight");
  assert.equal(r.cssWidth(), "296px", "the width still moves");
});

test("keys: ←/→ by 8px, Shift by 32px, Home and End to the bounds, Enter back to 288; each stored", t => {
  const r = rig(t);
  const e = r.key("ArrowRight");
  assert.equal(e.defaultPrevented, true);
  assert.equal(r.cssWidth(), "296px"); assert.equal(r.aria()[0], "296");
  assert.equal(r.storage.map.get(SIDEBAR_WIDTH_KEY), "296");
  r.key("ArrowLeft"); r.key("ArrowLeft"); assert.equal(r.cssWidth(), "280px");
  r.key("ArrowRight", { shiftKey: true }); assert.equal(r.cssWidth(), "312px");
  r.key("ArrowLeft", { shiftKey: true }); assert.equal(r.cssWidth(), "280px");
  r.key("End"); assert.equal(r.cssWidth(), "480px");
  r.key("ArrowRight"); assert.equal(r.cssWidth(), "480px", "never past the maximum");
  r.key("Home"); assert.equal(r.cssWidth(), "240px");
  r.key("ArrowLeft", { shiftKey: true }); assert.equal(r.cssWidth(), "240px", "never under the minimum");
  r.key("Enter"); assert.equal(r.cssWidth(), "288px");
  assert.equal(r.storage.map.get(SIDEBAR_WIDTH_KEY), "288");
  for (const k of ["ArrowUp", "ArrowDown", "a"]) assert.equal(r.key(k).defaultPrevented, false, `${k} is not the handle's`);
  for (const mod of ["ctrlKey", "metaKey", "altKey"]) {
    assert.equal(r.key("ArrowRight", { [mod]: true }).defaultPrevented, false, `${mod}+→ is left to the shortcuts`);
  }
  assert.equal(r.cssWidth(), "288px");
});

test("a double-click and the reset (the palette's Sidebar: reset width) go back to 288px", t => {
  const r = rig(t, { storage: memoryStorage({ [SIDEBAR_WIDTH_KEY]: "400" }) });
  r.h.dispatchEvent(new r.win.MouseEvent("dblclick", { bubbles: true }));
  assert.equal(r.cssWidth(), "288px");
  assert.equal(r.storage.map.get(SIDEBAR_WIDTH_KEY), "288");
  r.key("End");
  r.sw.reset();
  assert.deepEqual([r.cssWidth(), r.sw.width, r.aria()[0], r.storage.map.get(SIDEBAR_WIDTH_KEY)], ["288px", 288, "288", "288"]);
});

test("drag: pointer capture, at most one write a frame, the last written as it lets go, then stored", t => {
  const r = rig(t);
  let captured = null; r.h.setPointerCapture = id => { captured = id; };
  const down = r.pointer("pointerdown", 288);
  assert.equal(down.defaultPrevented, true); assert.equal(captured, 1);
  assert.equal(r.doc.activeElement, r.h, "the handle takes focus");
  r.pointer("pointermove", 300); r.pointer("pointermove", 320);
  assert.equal(r.frames.length, 1, "one frame for both moves");
  assert.equal(r.cssWidth(), "288px", "nothing written before the frame");
  r.runFrames();
  assert.equal(r.cssWidth(), "320px", "the frame writes the latest");
  r.pointer("pointermove", 400, 2); r.runFrames();
  assert.equal(r.cssWidth(), "320px", "another pointer's move is not the drag's");
  r.pointer("pointermove", 350);
  assert.equal(r.storage.map.has(SIDEBAR_WIDTH_KEY), false, "not stored mid-drag");
  r.pointer("pointerup", 350);
  assert.equal(r.cssWidth(), "350px", "the pending move is written as the drag ends");
  assert.equal(r.storage.map.get(SIDEBAR_WIDTH_KEY), "350");
  r.runFrames();
  assert.equal(r.cssWidth(), "350px", "a frame after the end writes nothing");
  r.pointer("pointerdown", 350); r.pointer("pointermove", 9999); r.pointer("lostpointercapture", 9999);
  assert.equal(r.cssWidth(), "480px", "clamped to the maximum; a lost capture ends the drag too");
  r.pointer("pointerdown", 480); r.pointer("pointermove", -500); r.pointer("pointercancel", -500);
  assert.equal(r.cssWidth(), "240px");
  const right = new r.win.Event("pointerdown", { cancelable: true }); Object.assign(right, { button: 2, pointerId: 1, clientX: 0 });
  r.h.dispatchEvent(right); r.pointer("pointermove", 400); r.runFrames();
  assert.equal(r.cssWidth(), "240px", "a secondary button does not drag");
});

test("a drag holds the terminals' PTY resizes from its start until it lets go", t => {
  const r = rig(t);
  r.pointer("pointerdown", 288);
  assert.deepEqual([r.holds.taken, r.holds.released], [1, 0]);
  r.pointer("pointermove", 330); r.runFrames(); r.pointer("pointermove", 360); r.runFrames();
  assert.deepEqual([r.holds.taken, r.holds.released], [1, 0], "one hold for the whole drag");
  r.pointer("pointerup", 360);
  assert.deepEqual([r.holds.taken, r.holds.released], [1, 1], "released as it ends");
  assert.equal(r.timers.size, 0, "a drag waits for no timer");
});

test("key steps hold the PTY resizes until the keys rest", t => {
  const r = rig(t);
  r.key("ArrowRight"); r.key("ArrowRight"); r.key("ArrowRight", { shiftKey: true });
  assert.deepEqual([r.holds.taken, r.holds.released], [1, 0], "one hold across a run of steps");
  assert.equal(r.timers.size, 1, "one timer, restarted by each step");
  assert.equal([...r.timers.values()][0].ms, SIDEBAR_KEY_SETTLE_MS);
  r.runTimers();
  assert.deepEqual([r.holds.taken, r.holds.released], [1, 1]);
  r.sw.reset(); r.runTimers();
  assert.deepEqual([r.holds.taken, r.holds.released], [2, 2], "the reset too");
});

test("a window resize clamps the applied width and keeps the chosen one for when it grows again", t => {
  const r = rig(t, { storage: memoryStorage({ [SIDEBAR_WIDTH_KEY]: "460" }) });
  assert.equal(r.cssWidth(), "460px");
  r.resizeWindow(800);
  assert.deepEqual([r.cssWidth(), ...r.aria()], ["360px", "360", "240", "360"], "45% of 800");
  r.resizeWindow(400);
  assert.deepEqual([r.cssWidth(), ...r.aria()], ["240px", "240", "240", "240"], "the minimum holds");
  assert.equal(r.storage.map.get(SIDEBAR_WIDTH_KEY), "460", "the stored width is kept");
  r.resizeWindow(1400);
  assert.equal(r.cssWidth(), "460px", "and comes back");
  r.resizeWindow(800); r.key("ArrowLeft");
  assert.equal(r.cssWidth(), "352px", "a step starts from the width applied now");
  r.resizeWindow(1400);
  assert.equal(r.cssWidth(), "352px", "and is the new choice");
});

test("hiding the sidebar keeps its width", t => {
  const r = rig(t);
  r.key("End");
  const app = r.doc.getElementById("app");
  for (const cls of ["sidebar-hidden", "focus-mode"]) {
    app.classList.add(cls); assert.equal(r.cssWidth(), "480px", cls);
    app.classList.remove(cls); assert.equal(r.cssWidth(), "480px", cls);
  }
});

test("every reset chooses 288 even in a window too narrow to show it, and the width comes back as it grows", t => {
  const resets = {
    Enter: r => r.key("Enter"),
    "double-click": r => r.h.dispatchEvent(new r.win.MouseEvent("dblclick", { bubbles: true })),
    "Sidebar: reset width": r => r.sw.reset(),
  };
  for (const [name, reset] of Object.entries(resets)) {
    const storage = memoryStorage({ [SIDEBAR_WIDTH_KEY]: "400" });
    const r = rig(t, { width: 600, storage });
    assert.equal(r.cssWidth(), "270px", `${name}: 45% of 600`);
    reset(r);
    assert.equal(r.cssWidth(), "270px", `${name}: still the most the window allows`);
    assert.equal(storage.map.get(SIDEBAR_WIDTH_KEY), "288", `${name}: the default is stored`);
    r.resizeWindow(1400);
    assert.equal(r.cssWidth(), "288px", `${name}: and shown once the window grows`);
  }
});
