import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createWorkspaceSwitcher } from "../renderer/workspace-switcher.mjs";
import { workspaceChoiceLabels } from "../../client/workspace-choices.mjs";
import { createAddExecutor } from "../workspace-registry.mjs";

const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
const deferred = () => {
  let resolve;
  const promise = new Promise((ok) => { resolve = ok; });
  return { promise, resolve };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// The list's slow re-read never fires here (its cadence is workspace-list.test.mjs).
const INERT = { setTimeout: () => 0, clearTimeout() {} };
const setup = (overrides = {}) => {
  const dom = new JSDOM(html, { url: "file:///renderer/index.html" });
  const selected = [];
  const controller = createWorkspaceSwitcher({
    document: dom.window.document,
    selectWorkspace: (id) => selected.push(id),
    discoverSuggestions: async () => [],
    addWorkspace: async (path) => ({ ok: true, workspace: { id: path, path, name: "workspace" } }),
    pickWorkspace: async () => ({ ok: false, code: "cancelled", reason: "cancelled" }),
    timers: INERT,
    ...overrides,
  });
  return { dom, document: dom.window.document, selected, controller };
};

const A = { id: "/org-a/oats", path: "/org-a/oats", name: "oats", team: { name: "alpha" } };
const B = { id: "/org-b/oats", path: "/org-b/oats", name: "oats", team: { name: "beta" } };

test("workspace choice labels disambiguate duplicate names with team and the folder's last segments, never a full path (#482)", () => {
  assert.deepEqual(workspaceChoiceLabels([A, B, { id: "/docs", name: "docs" }]), [
    "oats — alpha · org-a/oats", "oats — beta · org-b/oats", "docs",
  ]);
});

// The list says which workspace is current: the row's aria-current and, for the whole list, its description.
const current = (document) => document.querySelector('.ws-option[aria-current="true"]')?.dataset.workspaceId ?? null;
const said = (document) => document.getElementById("ws-list").getAttribute("aria-description");

test("workspace switcher: deferred A completing after B cannot overwrite B", async () => {
  const { dom, document, controller } = setup();
  const aGate = deferred(), bGate = deferred();
  const commitA = controller.begin();
  const a = aGate.promise.then((workspace) => commitA(workspace, [workspace]));
  const commitB = controller.begin();
  const b = bGate.promise.then((workspace) => commitB(workspace, [workspace]));
  bGate.resolve(B);
  assert.equal(await b, true);
  assert.equal(current(document), B.id);
  assert.equal(document.querySelector(".ws-option .ws-option-name").textContent, "oats");
  assert.equal(said(document), "Current workspace: /org-b/oats");
  aGate.resolve(A);
  assert.equal(await a, false);
  assert.equal(current(document), B.id);
  assert.equal(said(document), "Current workspace: /org-b/oats");
  controller.dispose(); dom.window.close();
});

test("the workspace list is disambiguated, keeps the focused row across a repaint, and switches explicitly", () => {
  const { dom, document, selected, controller } = setup();
  controller.begin()(B, [A, B]);
  const options = [...document.querySelectorAll(".ws-option")];
  assert.deepEqual(options.map((option) => option.querySelector(".ws-option-name").textContent), [
    "oats — alpha · org-a/oats", "oats — beta · org-b/oats",
  ]);
  assert.equal(said(document), "Current workspace: /org-b/oats");
  assert.deepEqual(options.map((option) => option.getAttribute("aria-current")), [null, "true"]);
  options[0].focus();
  controller.begin()(B, [A, B]);
  assert.equal(document.activeElement.dataset.workspaceId, "/org-a/oats",
    "roster refresh preserves the focused workspace option identity");
  document.activeElement.click();
  assert.deepEqual(selected, ["/org-a/oats"]);
  assert.equal(document.activeElement.dataset.workspaceId, "/org-a/oats", "the list stays where it is: there is no menu to close");
  document.querySelector('.ws-option[aria-current="true"]').click();
  assert.deepEqual(selected, ["/org-a/oats"], "the current workspace is not selected again");
  controller.dispose(); dom.window.close();
});

test("workspace choice notice says nothing is reported without creating a selectable option; a repainted-away row selects nothing", async () => {
  const { dom, document, controller, selected } = setup();
  controller.choose([]); await settle();
  const note = document.querySelector('.ws-menu-empty'), list = document.getElementById('ws-options');
  assert.equal(note.getAttribute('role'), 'status'); assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'No workspace choices reported.'); assert.equal(list.contains(note), false);
  assert.equal(document.querySelector('.ws-option'), null);
  controller.begin()(A, [A, B]); assert.equal(note.hidden, true); assert.equal(note.textContent, '');
  const old = document.querySelectorAll('.ws-option')[1];
  controller.begin()(A, [A, B]);
  assert.equal(old.isConnected, false, "the repaint drew new rows");
  old.dispatchEvent(new dom.window.Event('click')); assert.deepEqual(selected, [], 'a removed row cannot select');
  assert.equal(document.querySelectorAll('.ws-option').length, 2);
  controller.dispose(); dom.window.close();
});

test("add workspace modal discovers, filters, selects and confirms a suggestion", async () => {
  const calls = [];
  const C = { id: "/org-c/tools", path: "/org-c/tools", name: "tools", team: { name: "gamma" }, reason: "Team-scope sibling" };
  const { dom, document, selected, controller } = setup({
    discoverSuggestions: async () => ({ suggestions: [A, C] }),
    addWorkspace: async (path) => { calls.push(path); return { ok: true, workspace: C }; },
  });
  controller.begin()(B, [B]);
  const addOpen = document.getElementById("ws-add-open");
  assert.equal(addOpen.getAttribute("aria-label"), "Add local workspace…", "the list's header button");
  assert.equal(addOpen.title, "Add local workspace…");
  addOpen.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const modal = document.getElementById("ws-modal");
  assert.equal(modal.hidden, false);
  assert.equal(document.activeElement, document.getElementById("ws-suggestion-search"));
  assert.deepEqual([...document.querySelectorAll(".ws-suggestion-title")].map((node) => node.textContent), ["oats", "tools"]);
  let choices = [...document.querySelectorAll(".ws-suggestion")];
  assert.deepEqual(choices.map((choice) => choice.tabIndex), [0, -1]);
  choices[0].focus();
  choices[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  choices = [...document.querySelectorAll(".ws-suggestion")];
  assert.equal(document.activeElement.dataset.workspaceId, "/org-c/tools");
  assert.equal(choices[1].getAttribute("aria-checked"), "true");
  assert.deepEqual(choices.map((choice) => choice.tabIndex), [-1, 0]);
  assert.equal(document.getElementById("ws-confirm").disabled, false);
  document.getElementById("ws-confirm").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["/org-c/tools"]);
  assert.deepEqual(selected, ["/org-c/tools"]);
  assert.equal(modal.hidden, true);
  assert.equal(document.activeElement.dataset.workspaceId, "/org-c/tools", "focus on the added workspace's row");
  assert.equal(document.activeElement.getAttribute("aria-current"), "true");
  dom.window.close();
});

test("filtering out the selected suggestion clears it and prevents hidden submission", async () => {
  const C = { id: "/org-c/tools", path: "/org-c/tools", name: "tools" };
  const mutations = [];
  const { dom, document, controller } = setup({
    discoverSuggestions: async () => ({ stale: false, suggestions: [A, C] }),
    addWorkspace: async (path) => { mutations.push(path); return { ok: true, workspace: A }; },
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.querySelector('.ws-suggestion[data-workspace-id="/org-a/oats"]').click();
  assert.equal(document.getElementById("ws-confirm").disabled, false);
  const search = document.getElementById("ws-suggestion-search");
  search.value = "tools";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".ws-suggestion").length, 1);
  assert.equal(document.querySelector(".ws-suggestion").dataset.workspaceId, "/org-c/tools");
  assert.equal(document.querySelector('.ws-suggestion[aria-checked="true"]'), null);
  assert.equal(document.getElementById("ws-confirm").disabled, true);
  document.getElementById("ws-confirm").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(mutations, []);
  dom.window.close();
});

test("picker success uses its completed add result and picker cancellation is silent", async () => {
  const C = { id: "/org-c/tools", path: "/org-c/tools", name: "tools", team: { name: "gamma" } };
  let pickResult = { ok: false, code: "cancelled", reason: "not rendered" };
  const { dom, document, selected, controller } = setup({
    discoverSuggestions: async () => ({ stale: false, suggestions: [A] }),
    pickWorkspace: async () => pickResult,
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  const before = document.getElementById("ws-dialog-status").textContent;
  document.getElementById("ws-browse").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("ws-modal").hidden, false);
  assert.equal(document.getElementById("ws-dialog-status").textContent, before);
  assert.deepEqual(selected, []);

  pickResult = { ok: true, workspace: C };
  document.getElementById("ws-browse").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("ws-modal").hidden, true);
  assert.deepEqual(selected, ["/org-c/tools"]);
  dom.window.close();
});

test("picker cancellation does not orphan an in-flight discovery loading state", async () => {
  const discovery = deferred();
  const { dom, document, controller } = setup({
    discoverSuggestions: () => discovery.promise,
    pickWorkspace: async () => ({ ok: false, code: "cancelled", reason: "not rendered" }),
  });
  controller.begin()(B, [B]);
  const opening = controller.openModal();
  document.getElementById("ws-browse").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelector(".ws-dialog").getAttribute("aria-busy"), "false");
  assert.equal(document.getElementById("ws-dialog-status").textContent, "Finding OATS workspaces…",
    "loading remains truthful while the still-owned discovery is pending");
  discovery.resolve({ stale: false, suggestions: [A] });
  await opening;
  assert.equal(document.getElementById("ws-dialog-status").textContent, "1 suggested workspace");
  assert.equal(document.querySelector(".ws-suggestion").dataset.workspaceId, "/org-a/oats");
  dom.window.close();
});

test("same-generation stale discovery settles to a neutral idle state", async () => {
  const { dom, document, controller } = setup({
    discoverSuggestions: async () => ({ stale: true, suggestions: [] }),
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  assert.equal(document.getElementById("ws-dialog-status").textContent, "No current workspace suggestions.");
  assert.equal(document.getElementById("ws-dialog-status").classList.contains("error"), false);
  assert.equal(document.querySelector(".ws-dialog").getAttribute("aria-busy"), "false");
  dom.window.close();
});

test("resolved add domain failure renders prose and never switches", async () => {
  const { dom, document, selected, controller } = setup({
    discoverSuggestions: async () => ({ stale: false, suggestions: [A] }),
    addWorkspace: async () => ({ ok: false, code: "foreign-server", reason: "This server is managed outside the app." }),
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.querySelector(".ws-suggestion").click();
  document.getElementById("ws-confirm").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("ws-modal").hidden, false);
  assert.equal(document.querySelector(".ws-dialog").getAttribute("aria-busy"), "false");
  assert.equal(document.getElementById("ws-dialog-status").textContent, "This server is managed outside the app.");
  assert.equal(document.activeElement, document.getElementById("ws-confirm"));
  assert.deepEqual(selected, []);
  dom.window.close();
});

test("production add executor server-error renders reason and never switches", async () => {
  let dirs = [B.path];
  const executor = createAddExecutor({
    getDirs: () => dirs,
    commitDirs: (next) => { dirs = next; },
    replaceServer: async () => {},
    probeVersion: async () => { throw new Error("probe exploded"); },
    isCompatible: () => true,
    advertises: async () => true,
    refreshAdvertised: async () => true,
    delay: async () => {},
    attempts: 1,
  });
  const { dom, document, selected, controller } = setup({
    discoverSuggestions: async () => ({ stale: false, suggestions: [A] }),
    addWorkspace: async () => executor(A, () => true),
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.querySelector(".ws-suggestion").click();
  document.getElementById("ws-confirm").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("ws-dialog-status").textContent,
    "readiness check failed: probe exploded");
  assert.equal(document.activeElement, document.getElementById("ws-confirm"));
  assert.deepEqual(selected, []);
  assert.deepEqual(dirs, [B.path]);
  dom.window.close();
});

test("picker domain and transport failures restore Browse focus", async () => {
  let rejectTransport = false;
  const { dom, document, controller } = setup({
    discoverSuggestions: async () => ({ stale: false, suggestions: [A] }),
    pickWorkspace: async () => {
      if (rejectTransport) throw new Error("Picker transport failed.");
      return { ok: false, code: "foreign-server", reason: "This server is managed outside the app." };
    },
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.getElementById("ws-browse").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("ws-dialog-status").textContent, "This server is managed outside the app.");
  assert.equal(document.activeElement, document.getElementById("ws-browse"));

  document.getElementById("ws-cancel").click();
  rejectTransport = true;
  await controller.openModal();
  document.getElementById("ws-browse").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("ws-dialog-status").textContent, "Picker transport failed.");
  assert.equal(document.activeElement, document.getElementById("ws-browse"));
  dom.window.close();
});

test("not-suggested failure explicitly points to the picker", async () => {
  const { dom, document, controller } = setup({
    discoverSuggestions: async () => ({ stale: false, suggestions: [A] }),
    addWorkspace: async () => ({ ok: false, code: "not-suggested", reason: "This suggestion expired." }),
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.querySelector(".ws-suggestion").click();
  document.getElementById("ws-confirm").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("ws-dialog-status").textContent,
    "This suggestion expired. Use Browse… to choose it explicitly.");
  assert.equal(document.getElementById("ws-modal").hidden, false);
  dom.window.close();
});

test("pending add is single-flight, cannot be dismissed, and always reconciles", async () => {
  const addGate = deferred();
  const C = { id: "/org-c/tools", path: "/org-c/tools", name: "tools" };
  const mutationCalls = [];
  const { dom, document, selected, controller } = setup({
    discoverSuggestions: async () => ({ stale: false, suggestions: [A, C] }),
    addWorkspace: (path) => { mutationCalls.push(path); return addGate.promise; },
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.querySelector(".ws-suggestion").click();
  document.getElementById("ws-confirm").click();
  const modal = document.getElementById("ws-modal");
  const dialog = document.querySelector(".ws-dialog");
  assert.equal(dialog.getAttribute("aria-busy"), "true");
  assert.equal(document.getElementById("ws-cancel").disabled, true);
  assert.equal(document.getElementById("ws-dialog-close").disabled, true);
  assert.equal(document.getElementById("ws-suggestion-search").disabled, true);
  const busyStatus = document.getElementById("ws-dialog-status");
  assert.equal(document.activeElement, busyStatus, "add parks focus on the status inside the modal");
  busyStatus.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(document.activeElement, busyStatus, "Tab cannot escape while every action is disabled");
  const suggestionButtons = [...document.querySelectorAll(".ws-suggestion")];
  assert.deepEqual(suggestionButtons.map((button) => button.disabled), [true, true]);
  suggestionButtons[1].click();
  suggestionButtons[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  document.getElementById("ws-confirm").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(mutationCalls, ["/org-a/oats"], "busy UI and handler guard enforce one mutation");
  assert.equal(document.querySelector('.ws-suggestion[aria-checked="true"]').dataset.workspaceId, "/org-a/oats");
  dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  modal.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  assert.equal(modal.hidden, false, "Escape and backdrop cannot abandon an in-flight mutation");
  addGate.resolve({ ok: true, workspace: A });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(modal.hidden, true);
  assert.deepEqual(selected, ["/org-a/oats"]);
  assert.equal(said(document), "Current workspace: /org-a/oats");
  assert.equal(current(document), "/org-a/oats");
  dom.window.close();
});

test("pending native picker parks focus inside the modal and restores Browse on cancel", async () => {
  const picker = deferred();
  const { dom, document, controller } = setup({
    discoverSuggestions: async () => ({ stale: false, suggestions: [A] }),
    pickWorkspace: () => picker.promise,
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.getElementById("ws-browse").click();
  const busyStatus = document.getElementById("ws-dialog-status");
  assert.equal(document.activeElement, busyStatus);
  busyStatus.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(document.activeElement, busyStatus);
  picker.resolve({ ok: false, code: "cancelled", reason: "not rendered" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement, document.getElementById("ws-browse"));
  assert.equal(document.getElementById("ws-modal").hidden, false);
  dom.window.close();
});

test("stale suggestion discovery cannot repaint a reopened modal", async () => {
  // Every ask is held until the test answers it: the list's own first ask, then each opening of the dialog.
  const asks = [];
  const { dom, document, controller } = setup({
    discoverSuggestions: () => { const ask = deferred(); asks.push(ask); return ask.promise; },
  });
  controller.begin()(B, [B]);
  asks[0].resolve([]);
  const one = controller.openModal(), first = asks.at(-1);
  document.querySelector(".ws-dialog").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const two = controller.openModal(), second = asks.at(-1);
  assert.notEqual(first, second, "each opening asks again");
  second.resolve({ suggestions: [{ id: "/new", name: "new" }] });
  await two;
  assert.equal(document.querySelector(".ws-suggestion-title").textContent, "new");
  first.resolve({ suggestions: [{ id: "/stale", name: "stale" }] });
  await one;
  assert.equal(document.querySelector(".ws-suggestion-title").textContent, "new");
  controller.dispose(); dom.window.close();
});

// The list's keys (a list of buttons, the roster's pattern): Up/Down/Home/End move between rows and stop at
// the ends; a modified arrow is not the list's (the chords and the leader keep theirs).
test("keyboard: Up/Down/Home/End move through the rows and stop at either end; modified arrows are left alone", () => {
  const { dom, document, controller } = setup();
  const C = { id: "/org-c/tools", path: "/org-c/tools", name: "tools" };
  controller.begin()(A, [A, B, C]);
  const key = (k, init = {}) => {
    const event = new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
    document.activeElement.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const at = () => document.activeElement.dataset.workspaceId;
  assert.equal(controller.focusList(), true);
  assert.equal(at(), A.id, "the list's tab stop: the current row");
  assert.equal(key("ArrowUp"), true); assert.equal(at(), A.id, "Up from the first row stays: no wrap");
  key("ArrowDown"); assert.equal(at(), B.id);
  key("End"); assert.equal(at(), C.id);
  key("ArrowDown"); assert.equal(at(), C.id, "Down from the last row stays: no wrap");
  key("Home"); assert.equal(at(), A.id);
  for (const init of [{ altKey: true, shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    assert.equal(key("ArrowDown", init), false, JSON.stringify(init));
    assert.equal(at(), A.id);
  }
  controller.dispose(); dom.window.close();
});

/* ── #461: a picked folder that is not a deployment ── */
const REFUSAL = "This folder isn't an OATS deployment: it has no oats-local.yaml. Choose the deployment folder itself, the one that contains oats-local.yaml.";

test("a parent folder is refused with the explanation and its deployments as one-click adds; nothing is added until one is chosen", async () => {
  const added = [];
  const { dom, document, selected, controller } = setup({
    pickWorkspace: async () => ({ ok: false, code: "not-a-workspace", reason: REFUSAL, path: "/home/Agents",
      choices: [{ path: "/home/Agents/aweb", name: "aweb", kind: "inside" }, { path: "/home/Agents/zeta", name: "zeta", kind: "inside" }], more: 3, limited: true, scanLimit: 200 }),
    addWorkspace: async (path) => { added.push(path); return { ok: true, workspace: { id: path, path, name: path.split("/").pop() } }; },
    onboardWorkspace: async () => assert.fail("no onboarding for a folder with deployments in it"),
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.getElementById("ws-browse").click();
  await settle();
  const status = document.getElementById("ws-dialog-status");
  assert.equal(status.textContent, REFUSAL); assert.ok(status.classList.contains("error"));
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(document.querySelector(".ws-pick-path").textContent, "Chosen: /home/Agents");
  const choices = [...document.querySelectorAll(".ws-pick-choice")];
  assert.deepEqual(choices.map((b) => b.dataset.workspacePath), ["/home/Agents/aweb", "/home/Agents/zeta"]);
  assert.equal(choices[0].querySelector(".ws-pick-name").textContent, "Add aweb");
  assert.equal(document.querySelector(".ws-pick-more").textContent, "and 3 more. Only the first 200 entries of this folder were checked.");
  assert.equal(document.querySelector(".ws-pick-setup"), null, "onboarding is not offered beside deployments");
  assert.equal(document.getElementById("ws-dialog-title").textContent, "Add workspace", "not the onboarding dialog");
  assert.equal(document.activeElement, choices[0], "focus lands on the first choice");
  assert.deepEqual(added, []); assert.deepEqual(selected, []);
  choices[1].click();
  await settle();
  assert.deepEqual(added, ["/home/Agents/zeta"], "the choice goes through the normal add");
  assert.deepEqual(selected, ["/home/Agents/zeta"]);
  assert.equal(document.getElementById("ws-modal").hidden, true);
  dom.window.close();
});

test("a folder inside a deployment offers that deployment by path", async () => {
  const { dom, document, controller } = setup({
    pickWorkspace: async () => ({ ok: false, code: "not-a-workspace", reason: REFUSAL, path: "/home/OATS/agents",
      choices: [{ path: "/home/OATS", name: "OATS", kind: "ancestor" }], more: 0, limited: false }),
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.getElementById("ws-browse").click();
  await settle();
  assert.equal(document.querySelector(".ws-pick-choice").textContent, "Add /home/OATS (the deployment this folder is inside)");
  assert.equal(document.querySelector(".ws-pick-more"), null);
  dom.window.close();
});

test("a folder with no deployment near it is refused, with onboarding only as the secondary action", async () => {
  const { dom, document, controller } = setup({
    pickWorkspace: async () => ({ ok: false, code: "not-a-workspace", reason: REFUSAL, path: "/home/empty", choices: [], more: 0, limited: false,
      onboard: { token: "t1", path: "/home/empty" } }),
    onboardWorkspace: async () => ({ ok: false, code: "bad-ref", reason: "fixture" }),
  });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.getElementById("ws-browse").click();
  await settle();
  assert.equal(document.getElementById("ws-dialog-status").textContent, REFUSAL);
  assert.equal(document.getElementById("ws-dialog-title").textContent, "Add workspace", "the refusal stands; onboarding is not entered on its own");
  const setupButton = document.querySelector(".ws-pick-setup");
  assert.equal(setupButton.textContent, "Set up a new deployment here…");
  assert.equal(document.activeElement, setupButton);
  setupButton.click();
  assert.equal(document.getElementById("ws-dialog-title").textContent, "Onboard workspace");
  assert.equal(document.querySelector(".ws-onboard-path").textContent, "/home/empty");
  assert.equal(document.querySelector(".ws-pick").hidden, true);
  dom.window.close();
});

test("a new Browse or reopening the dialog clears the previous refusal's choices", async () => {
  let answer = { ok: false, code: "not-a-workspace", reason: REFUSAL, path: "/p", choices: [{ path: "/p/a", name: "a", kind: "inside" }] };
  const { dom, document, controller } = setup({ pickWorkspace: async () => answer });
  controller.begin()(B, [B]);
  await controller.openModal();
  document.getElementById("ws-browse").click(); await settle();
  assert.equal(document.querySelectorAll(".ws-pick-choice").length, 1);
  answer = { ok: false, code: "cancelled", reason: "cancelled" };
  document.getElementById("ws-browse").click(); await settle();
  assert.equal(document.querySelectorAll(".ws-pick-choice").length, 0); assert.equal(document.querySelector(".ws-pick").hidden, true);
  answer = { ok: false, code: "not-a-workspace", reason: REFUSAL, path: "/p", choices: [{ path: "/p/a", name: "a", kind: "inside" }] };
  document.getElementById("ws-browse").click(); await settle();
  document.getElementById("ws-cancel").click();
  await controller.openModal();
  assert.equal(document.querySelectorAll(".ws-pick-choice").length, 0);
  dom.window.close();
});
