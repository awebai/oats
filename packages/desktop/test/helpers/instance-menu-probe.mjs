// What the roster row's actions menu is, as plain data: its trigger, its items in order, whether any
// path opens it, and what each item does. instance-acts-menu.test.mjs compares this against the capture
// taken with this same probe before the menu was rebuilt on packages/client/instance-acts.mjs.
import { JSDOM } from "jsdom";

// jsdom has no top-layer API. Model its open/close events: `beforetoggle` is cancelable, as in Chromium.
function menuDom() {
  const dom = new JSDOM("<body></body>", { pretendToBeVisual: true });
  for (const [method, newState] of [["showPopover", "open"], ["hidePopover", "closed"]]) {
    dom.window.HTMLElement.prototype[method] = function () {
      const event = new dom.window.Event("beforetoggle", { cancelable: true });
      Object.defineProperty(event, "newState", { value: newState });
      this.dispatchEvent(event);
      this.lastToggleRefused = event.defaultPrevented;
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

const LOCAL = { instance: "dev-one", agent: "dev", home: "/agents/dev/instances/dev-one", createdAt: "2026-10-01T00:00:00.000Z" };
const REMOTE = { ...LOCAL, home: "/remote/agents/dev/instances/dev-one", server: "host", repoName: "Build box" };
const HERDR = "E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend. (dev-one)";

/** One row per case the menu decides on, and the rows where two or three cases meet. */
export const ROWS = Object.freeze({
  "running": { ...LOCAL, running: true },
  "stopped": { ...LOCAL, running: false },
  "unknown (null)": { ...LOCAL, running: null },
  "unknown (absent)": { ...LOCAL },
  "remote, addressable, running": { ...REMOTE, addressable: true, running: true },
  "remote, a saved route on a kernel that reports none": { ...REMOTE, savedRoute: true, running: false },
  "unsupported session (the kernel says so)": { ...LOCAL, running: null, runtimeState: "unsupported", runtimeError: HERDR },
  "unsupported session (an older kernel, local)": { ...LOCAL, running: true, sessionTarget: "herdr:pane-1" },
  "unsupported session (an older kernel, remote)": { ...REMOTE, addressable: true, running: true, backend: "herdr" },
  "unaddressable": { ...REMOTE, addressable: false, running: true },
  "unaddressable (gone from the server)": { ...REMOTE, addressable: false, savedRoute: true, missingRemotely: true, running: false },
  "unaddressable (not reported)": { ...REMOTE, running: true },
  "unaddressable (server not reached)": { ...REMOTE, addressable: false, serverUnreached: true, runtimeError: "ssh: connect to host timed out", running: null },
  "held: spawning": { ...LOCAL, running: false, spawnInProgress: true },
  "held: spawn incomplete": { ...LOCAL, running: false, rollbackIncomplete: true },
  "held: retire incomplete": { ...LOCAL, running: true, retirePending: true },
  "held: a spawn that is gone wins over a live one": { ...LOCAL, running: false, rollbackIncomplete: true, spawnInProgress: true },
  "unaddressable and held: spawning": { ...REMOTE, addressable: false, running: false, spawnInProgress: true },
  "unaddressable and held: spawn incomplete": { ...REMOTE, addressable: false, running: false, rollbackIncomplete: true },
  "unaddressable and held: retire incomplete": { ...REMOTE, addressable: false, running: true, retirePending: true },
  "held: spawning, and an unsupported session": { ...LOCAL, running: null, spawnInProgress: true, runtimeState: "unsupported", runtimeError: HERDR },
  "held: spawn incomplete, and an unsupported session": { ...LOCAL, running: null, rollbackIncomplete: true, runtimeState: "unsupported", runtimeError: HERDR },
  "all three: unaddressable, held and an unsupported session": { ...REMOTE, addressable: false, running: true, retirePending: true, backend: "herdr" },
  "all three, spawning": { ...REMOTE, addressable: false, running: null, spawnInProgress: true, runtimeState: "unsupported", runtimeError: HERDR },
});

const settle = () => new Promise((done) => setImmediate(done));

/**
 * Build the menu for `row` with the two items the shell puts in front, and report it.
 * @returns {{ trigger: object, items: object[], opens: object, handedOut: number, acts: object }}
 *   opens: per way of opening, whether the menu ended open (and, for the popover's own toggle, whether it was refused);
 *   handedOut: how many times the menu gave its `run` (execute) to the shell, which it does only when it opens;
 *   acts: per item, what activating it did, by a click with the menu closed and through `run` with it open.
 */
export async function probeMenu(instanceActions, row) {
  const dom = menuDom(), doc = dom.window.document;
  const calls = [], states = [];
  const control = instanceActions(doc, row, {
    scope: "ws", owner: () => true,
    invoke: async (action) => { calls.push(`invoke ${action}`); return {}; },
    openLifecycle: (operation) => calls.push(`lifecycle ${operation}`),
    dispatch: (actionId) => calls.push(`dispatch ${actionId}`),
    report: (headline) => calls.push(`report ${headline}`),
    onMenuState: (state) => { if (state) states.push(state); },
    shortcut: (actionId) => (actionId === "instance.openSplit" ? "Ctrl+\\" : ""),
    extra: [
      { action: "open-split", actionId: "instance.openSplit", label: "Open in split", reason: () => (row.running === true ? "" : "No live terminal is reported.") },
      { action: "open-pr", actionId: "instance.openPullRequest", label: "Open pull request…", reason: row.server ? "Remote PR inspection is unavailable; no local fallback." : "" },
    ],
  });
  doc.body.append(control);
  const trigger = control.querySelector(".ctx-instance-actions"), menu = control.querySelector(".ctx-instance-menu");
  const itemsOf = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const describe = (item) => ({
    action: item.dataset.action, label: item.querySelector("span:not(.ctx-menu-icon)").textContent, disabled: item.disabled, title: item.title,
    note: item.querySelector("small") ? { text: item.querySelector("small").textContent, hidden: item.querySelector("small").hidden } : null,
    shortcut: item.querySelector("kbd") ? { text: item.querySelector("kbd").textContent, hidden: item.querySelector("kbd").hidden } : null,
    icon: item.querySelector(".ctx-menu-icon").childElementCount > 0, lifecycle: item.classList.contains("ctx-menu-lifecycle"), autofocus: item.autofocus,
  });
  const report = {
    trigger: { disabled: trigger.disabled, ariaDisabled: trigger.getAttribute("aria-disabled"), title: trigger.title,
      description: trigger.getAttribute("aria-description"), label: trigger.getAttribute("aria-label") },
    menuLabel: menu.getAttribute("aria-label"),
    items: itemsOf().map(describe),
  };
  const open = () => menu.dataset.instanceMenuOpen === "true";
  const close = () => { if (open()) menu.hidePopover(); };
  const key = (name) => trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  report.opens = {};
  for (const [way, act] of [["a click on the trigger", () => trigger.click()], ["openActionMenu", () => menu.openActionMenu()], ["ArrowDown on the trigger", () => key("ArrowDown")],
    ["ArrowUp on the trigger", () => key("ArrowUp")]]) { act(); report.opens[way] = open(); close(); }
  menu.showPopover(); report.opens["the popover's own toggle"] = { opened: open(), refused: menu.lastToggleRefused }; close();
  report.handedOut = states.length;
  // What each item does: clicked with the menu closed (the click handler), and run by the shell with it open (execute).
  report.acts = {};
  for (const { action } of report.items) {
    calls.length = 0;
    itemsOf().find((item) => item.dataset.action === action).click(); await settle();
    const clicked = [...calls];
    calls.length = 0; states.length = 0;
    menu.showPopover();
    if (states[0]) { await states[0].run(action); await settle(); }
    close();
    report.acts[action] = { clicked, run: states[0] ? [...calls] : null };
  }
  dom.window.close();
  return report;
}

export async function probeAll(instanceActions) {
  const out = {};
  for (const [name, row] of Object.entries(ROWS)) out[name] = await probeMenu(instanceActions, row);
  return out;
}
