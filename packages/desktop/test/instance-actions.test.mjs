import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { cliRetire, parseRetireEnvelope } from "../cli-adapter.mjs";

// jsdom has no top-layer API. Model only its open/close events here; native
// light-dismiss and rendering are Chromium's behavior, not this test's claim.
function menuDom() {
  const dom = new JSDOM("<body></body>", { pretendToBeVisual: true });
  for (const [method, newState] of [["showPopover", "open"], ["hidePopover", "closed"]]) {
    dom.window.HTMLElement.prototype[method] = function () {
      const event = new dom.window.Event("beforetoggle");
      Object.defineProperty(event, "newState", { value: newState });
      this.dispatchEvent(event);
      if (newState === "open") this.querySelector("[autofocus]")?.focus();
    };
  }
  const click = dom.window.HTMLButtonElement.prototype.click;
  dom.window.HTMLButtonElement.prototype.click = function () {
    click.call(this);
    const target = this.popoverTargetElement;
    if (!this.disabled && target) target[target.dataset.instanceMenuOpen === "true" ? "hidePopover" : "showPopover"]();
  };
  return dom;
}
const triggerOf = (control) => control.querySelector(".ctx-instance-actions");
const choose = async (control, action) => {
  control.querySelector(`[data-action="${action}"]`).click();
  await new Promise((r) => setImmediate(r));
};

test("instance actions keep the full host reference and confirm retirement before dispatch", async () => {
  const dom = menuDom();
  const instance = { instance: "dev-one", home: "/remote/home", server: "host", savedRoute: true };
  const calls = []; let confirmed = false;
  const select = instanceActions(dom.window.document, instance, {
    invoke: async (...args) => { calls.push(args); return {}; },
    confirmRetire: () => confirmed, done: () => {}, report: (m) => assert.fail(m),
  });
  dom.window.document.body.append(select);
  await choose(select, "retire"); assert.equal(calls.length, 0);
  await choose(select, "inspect"); assert.deepEqual(calls[0], ["inspect", instance]);
  confirmed = true; await choose(select, "retire"); assert.deepEqual(calls[1], ["retire", instance]);
  assert.equal(triggerOf(select).disabled, false);
  assert.equal(triggerOf(instanceActions(dom.window.document, { ...instance, savedRoute: false }, {})).disabled, true);
  dom.window.close();
});

test("retire adapter preserves incomplete local results and routes remote by saved identity", async () => {
  assert.equal(parseRetireEnvelope('{"retired":"dev-one","removedDir":true}').ok, true);
  const partial = parseRetireEnvelope('{"retired":"dev-one","removedDir":false,"rollbackIncomplete":["cleanup"]}');
  assert.equal(partial.ok, false); assert.equal(partial.error.code, "E_RETIRE_INCOMPLETE");
  assert.equal(parseRetireEnvelope(JSON.stringify({ schemaVersion: 1, ok: true, result: partial.result })).ok, false);
  let call;
  const env = await cliRetire("/installed/oats", { instance: "dev-one", home: "/remote/selected", workspaceDir: "/local", server: "host" }, {
    exec: (bin, argv, opts, cb) => { call = { bin, argv, opts }; cb(null, '{"schemaVersion":1,"ok":true,"result":{"retired":"dev-one"}}'); },
  });
  assert.equal(env.ok, true);
  assert.deepEqual(call.argv, ["retire", "dev-one", "--home", "/remote/selected", "--server", "host", "--json"]);
  assert.equal(call.opts.cwd, "/local");
});

test("roster rebuilds cannot submit a second lifecycle action while one is pending", async () => {
  const dom = menuDom();
  let finish; let calls = 0;
  const instance = { instance: "dev-pending", home: "/home/dev-pending" };
  const options = { invoke: () => { calls++; return new Promise((r) => { finish = r; }); },
    confirmRetire: () => true, done() {}, report: assert.fail };
  const first = instanceActions(dom.window.document, instance, options);
  dom.window.document.body.append(first);
  first.querySelector('[data-action="inspect"]').click();
  const replacement = instanceActions(dom.window.document, instance, options);
  assert.equal(triggerOf(replacement).disabled, true);
  replacement.querySelector('[data-action="retire"]').click();
  assert.equal(calls, 1);
  finish({}); await new Promise((r) => setImmediate(r));
  assert.equal(triggerOf(replacement).disabled, false, "the currently displayed control re-enables without another poll");
  assert.equal(triggerOf(instanceActions(dom.window.document, instance, options)).disabled, false);
  dom.window.close();
});


test("actions are app buttons with keyboard navigation, dismissal and refresh restoration", () => {
  const dom = menuDom(), doc = dom.window.document;
  const instance = { instance: "menu-worker", home: "/menu/worker" };
  const options = { invoke: assert.fail, confirmRetire: assert.fail, done() {}, report: assert.fail };
  let control = instanceActions(doc, instance, options); doc.body.append(control);
  assert.equal(control.querySelector("select"), null, "no OS-formatted select or native dropdown arrow");
  let trigger = triggerOf(control), menu = control.querySelector('[role="menu"]');
  assert.equal(trigger.tagName, "BUTTON");
  const key = (element, value) => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement.dataset.action, "inspect");
  key(doc.activeElement, "ArrowDown");
  assert.equal(doc.activeElement.dataset.action, "retire");
  const restore = captureInstanceActionMenu(doc.body);
  control.remove(); control = instanceActions(doc, instance, options); doc.body.append(control); restore();
  trigger = triggerOf(control); menu = control.querySelector('[role="menu"]');
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement.dataset.action, "retire", "refresh keeps the selected action");
  key(doc.activeElement, "Home"); assert.equal(doc.activeElement.dataset.action, "inspect");
  key(doc.activeElement, "End"); assert.equal(doc.activeElement.dataset.action, "retire");
  key(doc.activeElement, "Escape");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, trigger);
  key(trigger, "ArrowUp"); assert.equal(doc.activeElement.dataset.action, "retire");
  key(doc.activeElement, "Tab"); assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, trigger, "Tab continues from the trigger, not a hidden menu item");
  trigger.click(); menu.hidePopover(); // the browser's light-dismiss path
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  dom.window.close();
});
