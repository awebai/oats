import { createWorkspaceMark } from "./identity-marks.mjs";
import { iconElement } from "./shell-icons.mjs";
import { deploymentMark } from "./view-deployments.mjs";
import { revealInScrollport } from "./reveal-in-scrollport.mjs";
import { pathTail } from "../../client/deployment-label.mjs";
import { workspaceStep } from "../../client/workspace-step.mjs";
import { requestDeploymentTab } from "./deployment-tabs.mjs";
// What the list says for a view (its name, its one line, its not-live count, its tooltip) is the shared
// home's: this module draws it. LOCAL_SECTION, the other-window and needs-input words, the new-window
// hint and adding a folder are its own.
import { isLocalPath, workspaceChoiceLabels, workspaceChoiceRows, UNMATCHED_SECTION } from "../../client/workspace-choices.mjs";

/* The workspace list (docs/desktop.md, "Workspaces"): always shown at the top of the sidebar, one row per
   workspace, in this order: the views this window can show (served, remote-only ones included; the views no
   workspace identity matched under UNMATCHED_SECTION), then this computer's deployments not served yet, under
   LOCAL_SECTION. The current row is `aria-current` and marked; a row another window shows says so, and picking
   it (a click, Enter or a move) takes it over into this window (#481 as changed: never focus the other window);
   a row of this computer's list that can't be opened says why and opens nothing; a
   row with an instance that needs input carries a dot (and the words, for assistive tech and as its tooltip).

   A list of buttons, not a listbox (the sidebar's plain keys stay live on it): one tab stop (the current row,
   else the row last focused), Up/Down/Home/End move, Enter opens, Right Arrow reaches a row's own button
   (Open in new window, or Remove) and Left Arrow or Esc comes back; ⌘Enter / Ctrl+Enter opens in a new
   window. `step(±1)` (the leader's ↑/↓) selects the previous / next row that can be opened, as a click does.

   This computer's rows are asked of main (`discoverSuggestions`) when the list starts, when the window gets
   focus, and then every LISTED_EVERY_MS (LISTED_BLURRED_MS while the window is in the background); main
   answers from what it holds, each row's `waiting` included (packages/client/listed-waiting.mjs runs there).
   Never while the Add dialog is looking: one window's latest ask is the only current one. */

/** The section this computer's deployments not served yet are listed under, to add with one click (#518). */
export const LOCAL_SECTION = "On this computer";
/** A row of this computer's deployments list that can't be opened, in words (#1390): the kernel's state. */
export const LISTED_STATE_TEXT = Object.freeze({
  missing: "Missing: the folder is gone, or its volume isn't mounted",
  "not-a-deployment": "Not a deployment any more: no oats-local.yaml",
  unreadable: "Can't be checked: OATS couldn't read this folder",
});
/** The same states in a word or two, the row's one visible line (the sentence is its tooltip and is said). */
export const LISTED_STATE_WORD = Object.freeze({ missing: "Missing", "not-a-deployment": "Not a deployment", unreadable: "Can't be checked" });
/** Below the list while rows are cut off below its bounded height (a sighted cue: every row is in the list). */
export const moreBelowText = (count) => `${count} more below`;
/** What the section says when this computer's list could not be read: its CLI has no list, or the read failed. */
export const LIST_UNSUPPORTED_TEXT = "This oats can't list this computer's deployments. Update oats.";
export const listFailedText = (message) => `Couldn't read this computer's deployments: ${message}`;
/** The keyboard route to a row's Remove, said once for every removable option. */
export const REMOVE_HINT = "Press Right Arrow, then Enter, to remove it from this computer's list.";
/** A workspace another window of this Desktop shows (#481): picking it moves it to this window. */
export const OTHER_WINDOW_TEXT = "In another window";
/** A workspace with an instance that needs input: the dot's words, in the row's name and as its tooltip. */
export const WAITING_NAME = ", needs input";
export const WAITING_TITLE = "An instance here needs input";
/** How often this computer's rows are asked of main again, the window in front and in the background. */
export const LISTED_EVERY_MS = 60_000;
export const LISTED_BLURRED_MS = 300_000;

const text = (value) => String(value || "");
const candidateId = (candidate) => text(candidate?.id || candidate?.path);
const candidateName = (candidate) => candidate?.name
  || candidateId(candidate).split("/").filter(Boolean).at(-1)
  || "Workspace";

/** The keyboard route to a workspace's Open in new window action (#481), said once for every option. */
export function openInNewWindowHint(mac) {
  return `Press ${mac ? "⌘Enter" : "Ctrl+Enter"}, or Right Arrow then Enter, to open this workspace in a new window.`;
}

export function createWorkspaceSwitcher({
  document, selectWorkspace, discoverSuggestions, addWorkspace, pickWorkspace, onboardWorkspace = null, onboarded = null,
  // Remove a row of this computer's deployments list (#1390). Absent, no Remove.
  removeListed = null,
  // One window per workspace (#481): opens (or focuses) a workspace's own window. Absent, no action.
  openInNewWindow = null, mac = false,
  timers = document.defaultView ?? globalThis,
}) {
  const q = (id) => document.getElementById(id);
  const section = q("ws-list"), options = q("ws-options"), addOpen = q("ws-add-open");
  addOpen.replaceChildren(iconElement(document, 'plus', { size: 14 }));
  addOpen.setAttribute('aria-label', 'Add local workspace…'); addOpen.title = 'Add local workspace…';
  const empty = document.createElement('p'); empty.className = 'ws-menu-empty'; empty.setAttribute('role', 'status'); empty.hidden = true;
  options.after(empty);
  const more = document.createElement('p'); more.className = 'ws-more'; more.setAttribute('aria-hidden', 'true'); more.hidden = true;
  options.after(more);
  // What a one-click add from the list is doing, or why it failed (#518).
  const menuStatus = document.createElement('p'); menuStatus.className = 'ws-menu-status'; menuStatus.setAttribute('role', 'status'); menuStatus.tabIndex = -1;
  menuStatus.hidden = true;
  empty.after(menuStatus);
  // The options' description: how to reach Open in new window from the keyboard (one hidden element).
  const hint = document.createElement('p'); hint.id = 'ws-open-window-hint'; hint.hidden = true; hint.textContent = openInNewWindowHint(mac);
  if (openInNewWindow) empty.after(hint);
  const removeHint = document.createElement('p'); removeHint.id = 'ws-remove-hint'; removeHint.hidden = true; removeHint.textContent = REMOVE_HINT;
  if (removeListed) empty.after(removeHint);
  const modal = q("ws-modal"), dialog = modal.querySelector(".ws-dialog");
  const modalSearch = q("ws-suggestion-search"), suggestionsEl = q("ws-suggestions");
  const status = q("ws-dialog-status"), confirm = q("ws-confirm"), browse = q("ws-browse");
  const cancel = q("ws-cancel"), closeButton = q("ws-dialog-close");
  const title = q("ws-dialog-title"), intro = modal.querySelector(".ws-dialog-intro");
  const defaults = { title: title.textContent, intro: intro.textContent, confirm: confirm.textContent };
  // Onboarding (workspace model v2): a picked folder without oats-local.yaml.
  // The folder is the one main offered; the renderer supplies only the ref.
  const onboardEl = document.createElement("div"); onboardEl.className = "ws-onboard"; onboardEl.hidden = true;
  const onboardPath = document.createElement("p"); onboardPath.className = "ws-onboard-path";
  const refLabel = document.createElement("label"); refLabel.className = "ws-onboard-field";
  const refText = document.createElement("span"); refText.textContent = "Workspace repository";
  const refInput = document.createElement("input"); refInput.id = "ws-onboard-ref"; refInput.className = "field";
  refInput.type = "text"; refInput.autocomplete = "off"; refInput.spellcheck = false; refInput.placeholder = "github.com/org/agents";
  refLabel.append(refText, refInput);
  const onboardNote = document.createElement("p"); onboardNote.className = "ws-onboard-note";
  onboardNote.textContent = "Runs oats onboard in this folder: it writes oats-local.yaml and agents/, reads the workspace over Git and writes the lock. It installs nothing and spawns nothing.";
  onboardEl.append(onboardPath, refLabel, onboardNote);
  status.before(onboardEl);
  let onboarding = null; // { token, path } — the current single-use offer
  // A picked folder that is not a deployment (#461): refused before anything changes. Main says
  // where the deployment is when it can (one level down, or the deployment the folder is inside);
  // each choice goes through the normal add. With none, onboarding is the secondary action.
  const pickEl = document.createElement("div"); pickEl.className = "ws-pick"; pickEl.hidden = true;
  status.after(pickEl);
  let pickOffer = null; // the refused pick's onboarding offer, entered only on request
  let generation = 0, modalGeneration = 0, discoveryGeneration = 0;
  let activeId = "", workspaces = [], suggestions = [], selected = null, choosing = false;
  let adding = false, discoveryState = { message: "", error: false };
  // This computer's deployments not served (#1390): asked of main when the list starts, on focus and on a
  // slow timer; `localAdding` is the path a one-click add is adding (#518), `localRemoving` the row a Remove is
  // removing. `listNote` is what the section says when the list could not be read. `stopKey`: the row that is
  // the list's tab stop (the row last focused), else the current one.
  let local = [], localLooking = false, localGeneration = 0, localAdding = "", localAddGeneration = 0;
  let localRemoving = "", listNote = "", listedTimer = null, stopped = false, stopKey = "";
  // The workspace last picked here while its switch is still on its way (main may be taking it over from another
  // window), else "": the moves go on from it, and a pick of the current row supersedes it.
  let pickedId = "";

  const setStatus = (message = "", error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
  const rowKey = (button) => button?.dataset?.workspaceId || button?.dataset?.workspacePath || "";
  const menuItems = () => [...options.querySelectorAll(".ws-option:not([hidden])")];
  const rowOf = (key) => menuItems().find((button) => rowKey(button) === key) || null;
  /** Where focus goes in the list: its tab stop, else the current row, else the first row. */
  const focusTarget = () => rowOf(stopKey) || rowOf(activeId) || menuItems()[0] || addOpen;
  const openInWindow = (id) => { openInNewWindow(id); };
  /** Pick `id` (selectWorkspace: the shell's switch, which may answer `{ ok }`). It is the pending pick until the
   * switch lands here (reset) or is refused. */
  const pick = (id) => {
    pickedId = id;
    let answer;
    try { answer = selectWorkspace(id); } catch { answer = { ok: false }; }
    Promise.resolve(answer).then((r) => { if (pickedId === id && r?.ok === false) pickedId = ""; }, () => { if (pickedId === id) pickedId = ""; });
  };
  const setMenuStatus = (message = "") => { menuStatus.textContent = message; menuStatus.hidden = !message; };
  /** A newer choice in this window (a served workspace, an add or pick from the dialog) takes the pending
   * one-click add's say over this window away, at once: the add still completes in main, but its
   * outcome opens nothing here and shows nothing. A list poll is not a choice. */
  const supersedeLocalAdd = () => {
    if (!localAdding) return;
    localAddGeneration++;
    localAdding = "";
    setMenuStatus("");
  };
  /** This computer's rows not already a served choice: a view names the deployments it holds (#482). */
  const offeredLocally = () => {
    const served = new Set(workspaces.flatMap((workspace) => [workspace.id, ...(Array.isArray(workspace.deployments) ? workspace.deployments : [])]));
    return local.filter((candidate) => candidateId(candidate) && !served.has(candidateId(candidate)));
  };
  /** The dot (choice or row `waiting === true`): visible, and in the row's name and tooltip. Unknown is none. */
  const waitingMark = (button, waiting, tooltip) => {
    if (waiting !== true) return tooltip;
    const dot = document.createElement("span"); dot.className = "ws-waiting"; dot.setAttribute("aria-hidden", "true");
    const said = document.createElement("span"); said.className = "sr-only"; said.textContent = WAITING_NAME;
    button.querySelector(".ws-option-name").after(said);
    button.querySelector(".ws-option-line").append(dot);
    return tooltip ? `${tooltip}\n${WAITING_TITLE}` : WAITING_TITLE;
  };
  /** The rows as drawn, for the moves: `{ key, openable, open() }`, in order. A row that can't be opened and a
   * row busy with an add or a Remove are not openable; a row another window shows is (it is taken over). */
  let drawn = [];
  // Views first; unattached views (a deployment no workspace identity matched) after them, in their
  // own group under UNMATCHED_SECTION; then this computer's rows under LOCAL_SECTION. Every entry is its name
  // and ONE muted line (UI spec, #482): a view's machines (or that another window shows it), an unattached
  // view's machine and short reason, a listed row's folder or why it can't be opened.
  const unmatchedHeadingId = `ws-unmatched-${Math.random().toString(36).slice(2, 8)}`;
  const renderOptions = () => {
    const rows = workspaceChoiceRows(workspaces);
    const focused = options.contains(document.activeElement) ? document.activeElement : null;
    const focusedKey = focused?.classList?.contains("ws-option") ? rowKey(focused) : "";
    // Focus on a row's own button (Open in new window, #481, #521; Remove) comes back to that button.
    const focusedAction = focused?.classList?.contains("ws-open-window") ? focused.dataset.workspaceId : "";
    const focusedRemove = focused?.classList?.contains("ws-remove-listed") ? focused.dataset.workspacePath : "";
    options.replaceChildren();
    drawn = [];
    const list = document.createElement("ul"); list.className = "ws-group"; list.setAttribute("aria-label", "Workspaces");
    const unmatched = document.createElement("ul"); unmatched.className = "ws-group"; unmatched.setAttribute("aria-labelledby", unmatchedHeadingId);
    const unmatchedHead = document.createElement("div");
    unmatchedHead.className = "ws-option-section"; unmatchedHead.id = unmatchedHeadingId;
    unmatchedHead.textContent = UNMATCHED_SECTION;
    const unmatchedRows = [];
    workspaces.forEach((workspace, index) => {
      const said = rows[index];
      const current = workspace.id === activeId;
      const elsewhere = !current && workspace.shown === true;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ws-option";
      if (current) button.setAttribute("aria-current", "true");
      if (elsewhere) button.dataset.otherWindow = "true";
      button.dataset.workspaceId = workspace.id;
      button.tabIndex = -1;
      const check = document.createElement("span");
      check.className = "ws-check";
      check.setAttribute("aria-hidden", "true");
      // Another window's row says so in words alone: its Open in new window button is the one window icon.
      check.replaceChildren(...(current ? [iconElement(document, "check", { size: 14 })] : []));
      const copy = document.createElement("span");
      copy.className = "ws-option-copy";
      const line = document.createElement("span");
      line.className = "ws-option-line";
      const name = document.createElement("span");
      name.className = "ws-option-name";
      name.textContent = said.label;
      line.append(name);
      if (said.notLive) line.append(deploymentMark(document, said.notLiveText));
      const meta = document.createElement("span");
      meta.className = "ws-option-meta";
      meta.textContent = elsewhere ? OTHER_WINDOW_TEXT : said.place;
      meta.hidden = !meta.textContent;
      copy.append(line, meta);
      button.append(createWorkspaceMark(document, workspace), copy, check);
      const tooltip = waitingMark(button, workspace.waiting, said.tooltip);
      if (tooltip) button.title = tooltip;
      // Open in new window (#481): a trailing button beside the option, never inside it.
      const row = document.createElement("li");
      row.className = "ws-option-row";
      row.append(button);
      if (openInNewWindow) {
        button.setAttribute("aria-describedby", hint.id);
        const open = document.createElement("button");
        open.type = "button"; open.className = "ws-open-window"; open.tabIndex = -1;
        open.dataset.workspaceId = workspace.id;
        open.setAttribute("aria-label", `Open ${said.label} in a new window`);
        open.title = `Open ${said.label} in a new window`;
        open.append(iconElement(document, "newWindow", { size: 14 }));
        open.addEventListener("click", () => { if (open.isConnected && options.contains(open)) openInWindow(workspace.id); });
        row.append(open);
      }
      const choose = () => {
        supersedeLocalAdd();
        // Picked unless it is already what this window shows or is about to show: the current row while another
        // pick is on its way supersedes that pick (the latest pick wins).
        if (workspace.id !== (pickedId || activeId)) pick(workspace.id);
        // A deployment no workspace matched: the Deployments page opens on its tab, where the full
        // reason and its fix are.
        if (said.deployment) requestDeploymentTab(workspace.id, said.deployment);
      };
      button.addEventListener("click", () => { if (button.isConnected && options.contains(button)) choose(); });
      const entry = { key: workspace.id, openable: true, open: choose };
      if (said.unattached) { unmatched.append(row); unmatchedRows.push(entry); } else { list.append(row); drawn.push(entry); }
    });
    if (list.childElementCount) options.append(list);
    if (unmatched.childElementCount) { options.append(unmatchedHead, unmatched); drawn.push(...unmatchedRows); }
    const localGroup = renderLocalGroup(offeredLocally(), listNote);
    if (localGroup) options.append(...localGroup);
    empty.hidden = !!menuItems().length || !!listNote;
    empty.textContent = empty.hidden ? '' : localLooking ? 'Looking for workspaces on this computer…' : 'No workspace choices reported.';
    // The tab stop: the row last focused while it is still drawn, else the current row, else the first.
    if (!rowOf(stopKey)) stopKey = "";
    const stop = focusTarget();
    if (stop?.classList?.contains("ws-option")) stop.tabIndex = 0;
    if (focusedAction) ([...options.querySelectorAll(".ws-open-window")].find((button) => button.dataset.workspaceId === focusedAction) || focusTarget()).focus();
    else if (focusedRemove) ([...options.querySelectorAll(".ws-remove-listed")].find((button) => button.dataset.workspacePath === focusedRemove) || focusTarget()).focus();
    else if (focusedKey) (rowOf(focusedKey) || focusTarget()).focus();
    else if (focused) focusTarget().focus();
    revealInScrollport(options, rowOf(activeId));
    noteMore();
  };
  /** "N more below" while rows are cut off by the list's bounded height, at any scroll; none otherwise. */
  const noteMore = () => {
    const bottom = options.getBoundingClientRect().bottom;
    const below = menuItems().filter((button) => button.getBoundingClientRect().bottom > bottom + 0.5).length;
    more.hidden = !below;
    more.textContent = below ? moreBelowText(below) : "";
  };
  // This computer's deployments: each option adds its deployment and opens it in this window (the Add dialog's
  // add, from the list). A row of the list that can't be opened (missing, not a deployment any more,
  // unreadable) says so in words and opens nothing; each list row has Remove beside it (#1390). `note`, when the
  // list could not be read, is the section's one line. Null when there is nothing to show; else the heading and
  // the group (and the note).
  const localHeadingId = `ws-local-${Math.random().toString(36).slice(2, 8)}`;
  const renderLocalGroup = (candidates, note) => {
    if (!candidates.length && !note) return null;
    const busy = !!(localAdding || localRemoving);
    const head = document.createElement("div");
    head.className = "ws-option-section"; head.id = localHeadingId;
    head.textContent = LOCAL_SECTION;
    const out = [head];
    if (note) {
      const line = document.createElement("p"); line.className = "ws-local-note"; line.textContent = note;
      out.push(line);
    }
    const group = document.createElement("ul");
    group.className = "ws-group ws-local-group"; group.setAttribute("aria-labelledby", localHeadingId);
    group.setAttribute("aria-busy", String(busy));
    for (const candidate of candidates) {
      const path = candidateId(candidate), label = candidateName(candidate);
      const stale = Object.hasOwn(LISTED_STATE_TEXT, candidate.state) ? LISTED_STATE_TEXT[candidate.state] : "";
      const button = document.createElement("button");
      button.type = "button"; button.className = "ws-option ws-local-option"; button.tabIndex = -1;
      if (busy || stale) button.setAttribute("aria-disabled", "true");
      button.dataset.workspacePath = path;
      if (stale) button.dataset.listedState = candidate.state;
      const check = document.createElement("span"); check.className = "ws-check"; check.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span"); copy.className = "ws-option-copy";
      const line = document.createElement("span"); line.className = "ws-option-line";
      const name = document.createElement("span"); name.className = "ws-option-name"; name.textContent = label;
      line.append(name);
      // A row that can't be opened says so in a word on its one line (no mark: the triangle is a view's "not
      // live"); the sentence is its tooltip and what a screen reader hears.
      const meta = document.createElement("span"); meta.className = "ws-option-meta";
      meta.textContent = stale ? LISTED_STATE_WORD[candidate.state] : pathTail(path, 2);
      copy.append(line, meta);
      if (stale) {
        meta.classList.add("ws-listed-state"); meta.setAttribute("aria-hidden", "true");
        const said = document.createElement("span"); said.className = "sr-only"; said.textContent = `, ${stale}`;
        copy.append(said);
      }
      button.append(createWorkspaceMark(document, { id: path, name: label }), copy, check);
      // A row that can't be opened has no dot: its read is not the deployment's.
      button.title = stale ? `${path}\n${stale}` : waitingMark(button, candidate.waiting, path);
      const add = () => { void addFromMenu(path, label); };
      button.addEventListener("click", () => {
        if (stale || !button.isConnected || !options.contains(button)) return;
        add();
      });
      const row = document.createElement("li"); row.className = "ws-option-row";
      row.append(button);
      if (removeListed && candidate.removable) {
        button.setAttribute("aria-describedby", removeHint.id);
        const remove = document.createElement("button");
        remove.type = "button"; remove.className = "ws-remove-listed"; remove.tabIndex = -1;
        remove.dataset.workspacePath = path; remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${label} from this computer's list`);
        remove.title = `Remove ${label} from this computer's list. Nothing on disk changes.`;
        if (busy) remove.setAttribute("aria-disabled", "true");
        remove.addEventListener("click", () => {
          if (!remove.isConnected || !options.contains(remove)) return;
          void removeFromMenu(path, label);
        });
        row.append(remove);
      }
      group.append(row);
      drawn.push({ key: path, openable: !stale && !busy, open: add });
    }
    if (group.childElementCount) out.push(group);
    return out;
  };
  /** Ask main for this computer's rows not served; only the latest ask paints. Not while the Add dialog is
   * open: its own ask is the window's current one, and a newer one would leave it stale. */
  const lookLocally = async () => {
    if (!modal.hidden || stopped) return;
    const token = ++localGeneration;
    localLooking = true;
    let found = null, note = "";
    try {
      const result = await discoverSuggestions();
      if (!result?.stale) {
        found = Array.isArray(result) ? result : (result?.suggestions || []);
        note = result?.list?.state === "unsupported" ? LIST_UNSUPPORTED_TEXT
          : result?.list?.state === "failed" ? listFailedText(result.list.message || "the installed OATS CLI could not read it.") : "";
      }
    } catch { found = []; /* nothing found: the header still offers Add local workspace… */ }
    if (token !== localGeneration || stopped) return;
    localLooking = false;
    // A stale answer (a newer ask of this window superseded it) keeps what the list shows.
    if (found !== null) { local = found.filter((candidate) => candidateId(candidate)); listNote = note; }
    renderOptions();
  };
  /** The next ask of main, on the slow timer: LISTED_EVERY_MS with the window in front, LISTED_BLURRED_MS behind. */
  const scheduleListed = () => {
    if (stopped) return;
    timers.clearTimeout?.(listedTimer);
    const every = document.hasFocus?.() === false ? LISTED_BLURRED_MS : LISTED_EVERY_MS;
    listedTimer = timers.setTimeout(() => { void lookLocally().finally(scheduleListed); }, every);
  };
  /** One click: add the deployment (main validates and serves it) and open it in this window. A failure
   * stays in the list, with focus back on the same deployment; an add superseded by a choice made
   * meanwhile, or by another workspace shown here since, opens nothing here. */
  const addFromMenu = async (path, label) => {
    if (localAdding || localRemoving || adding) return;
    const token = ++localAddGeneration, startedOn = activeId;
    localAdding = path;
    setMenuStatus(`Adding ${label}…`);
    renderOptions();
    let result;
    try { result = await addWorkspace(path); }
    catch (error) { result = { ok: false, reason: error?.message || "Could not add that workspace." }; }
    if (token !== localAddGeneration) return;
    localAdding = "";
    if (activeId !== startedOn) { setMenuStatus(""); renderOptions(); return; }
    if (result?.ok && result.workspace) {
      setMenuStatus("");
      reconcileAddedWorkspace(result.workspace);
      return;
    }
    setMenuStatus(result?.code === "superseded" ? "" : mutationFailureMessage(result, "Could not add that workspace."));
    renderOptions();
    if (options.contains(document.activeElement) || document.activeElement === document.body) (rowOf(path) || focusTarget()).focus();
  };
  /** Remove one row from this computer's list (#1390). It touches nothing on disk, so it asks nothing; the
   * list says what happened and asks for the list again. Focus stays on the row's place: the next row, else
   * the list's tab stop. */
  const removeFromMenu = async (path, label) => {
    if (localAdding || localRemoving || adding) return;
    localRemoving = path;
    setMenuStatus(`Removing ${label}…`);
    renderOptions();
    let result;
    try { result = await removeListed(path); }
    catch (error) { result = { ok: false, reason: error?.message || "Could not remove it from this computer's list." }; }
    localRemoving = "";
    const inList = options.contains(document.activeElement);
    if (result?.ok) {
      const rows = menuItems(), at = rows.findIndex((button) => button.dataset.workspacePath === path);
      const after = rows.slice(at + 1).find((button) => button.dataset.workspacePath && button.dataset.workspacePath !== path)?.dataset.workspacePath || "";
      local = local.filter((candidate) => candidateId(candidate) !== path);
      setMenuStatus(`Removed ${label} from this computer's list.`);
      renderOptions();
      if (inList) (rowOf(after) || focusTarget()).focus();
      void lookLocally();
      return;
    }
    setMenuStatus(result?.reason || "Could not remove it from this computer's list.");
    renderOptions();
    if (inList) ([...options.querySelectorAll(".ws-remove-listed")].find((button) => button.dataset.workspacePath === path) || focusTarget()).focus();
  };

  const renderSuggestions = (focusId = "") => {
    const query = modalSearch.value.trim().toLocaleLowerCase();
    suggestionsEl.replaceChildren();
    const visible = suggestions.filter((candidate) => {
      const haystack = `${candidateName(candidate)} ${candidateId(candidate)} ${candidate.team?.name || ""} ${candidate.reason || ""}`.toLocaleLowerCase();
      return !query || haystack.includes(query);
    });
    let selectedId = candidateId(selected);
    const selectedIsVisible = visible.some((candidate) => candidateId(candidate) === selectedId);
    if (selected && !selectedIsVisible) {
      selected = null;
      selectedId = "";
      confirm.disabled = true;
    }
    visible.forEach((candidate, index) => {
      const id = candidateId(candidate);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ws-suggestion";
      button.dataset.workspaceId = id;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(selectedId === id));
      button.tabIndex = selectedId === id || (!selectedIsVisible && index === 0) ? 0 : -1;
      button.disabled = adding;
      button.title = id;
      const radio = document.createElement("span");
      radio.className = "ws-radio";
      radio.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      copy.className = "ws-suggestion-copy";
      const title = document.createElement("span");
      title.className = "ws-suggestion-title";
      title.textContent = candidateName(candidate);
      const meta = document.createElement("span");
      meta.className = "ws-suggestion-meta";
      meta.textContent = `${candidate.team?.name ? `${candidate.team.name} · ` : ""}${id}`;
      copy.append(title, meta);
      if (candidate.reason) {
        const reason = document.createElement("span");
        reason.className = "ws-suggestion-reason";
        reason.textContent = candidate.reason;
        copy.append(reason);
      }
      button.append(radio, copy);
      button.addEventListener("click", () => {
        if (adding) return;
        selected = candidate;
        confirm.disabled = false;
        renderSuggestions(id);
      });
      suggestionsEl.append(button);
    });
    if (focusId) {
      [...suggestionsEl.querySelectorAll(".ws-suggestion")]
        .find((button) => button.dataset.workspaceId === focusId)?.focus();
    }
    if (!visible.length && !status.textContent) setStatus("No matching OATS workspaces found.");
  };

  const paintDiscoveryState = () => {
    setStatus(discoveryState.message, discoveryState.error);
    renderSuggestions();
  };

  const clearPick = () => { pickOffer = null; pickEl.hidden = true; pickEl.replaceChildren(); };
  const renderPick = (result) => {
    pickEl.replaceChildren();
    pickOffer = result?.onboard?.token ? { token: result.onboard.token, path: result.onboard.path } : null;
    if (typeof result?.path === "string" && result.path) {
      const picked = document.createElement("p"); picked.className = "ws-pick-path"; picked.textContent = `Chosen: ${result.path}`;
      pickEl.append(picked);
    }
    const choices = Array.isArray(result?.choices) ? result.choices.filter((c) => typeof c?.path === "string" && c.path) : [];
    if (choices.length) {
      const list = document.createElement("div"); list.className = "ws-pick-choices";
      list.setAttribute("role", "group"); list.setAttribute("aria-label", "OATS deployments to add instead");
      for (const choice of choices) {
        const button = document.createElement("button"); button.type = "button"; button.className = "ws-pick-choice secondary";
        button.dataset.workspacePath = choice.path; button.disabled = adding; button.title = choice.path;
        if (choice.kind === "ancestor") button.textContent = `Add ${choice.path} (the deployment this folder is inside)`;
        else {
          const name = document.createElement("span"); name.className = "ws-pick-name"; name.textContent = `Add ${choice.name || choice.path}`;
          const path = document.createElement("span"); path.className = "ws-pick-meta"; path.textContent = choice.path;
          button.append(name, path);
        }
        button.addEventListener("click", () => { void runAdd(choice.path, choice.name || choice.path, button); });
        list.append(button);
      }
      pickEl.append(list);
    }
    const notes = [];
    if (result?.more > 0) notes.push(`and ${result.more} more`);
    if (result?.limited) notes.push(Number.isInteger(result.scanLimit) ? `Only the first ${result.scanLimit} entries of this folder were checked` : "Only the first entries of this folder were checked");
    if (notes.length) { const more = document.createElement("p"); more.className = "ws-pick-more"; more.textContent = `${notes.join(". ")}.`; pickEl.append(more); }
    if (pickOffer && typeof onboardWorkspace === "function") {
      const setup = document.createElement("button"); setup.type = "button"; setup.className = "ws-pick-setup secondary";
      setup.textContent = "Set up a new deployment here…"; setup.disabled = adding;
      setup.addEventListener("click", () => {
        if (adding || !pickOffer) return;
        const offer = pickOffer; clearPick(); setStatus(""); enterOnboarding(offer);
      });
      pickEl.append(setup);
    }
    pickEl.hidden = !pickEl.childElementCount;
  };
  const setAdding = (value) => {
    adding = value;
    dialog.setAttribute("aria-busy", String(value));
    browse.disabled = value;
    cancel.disabled = value;
    closeButton.disabled = value;
    modalSearch.disabled = value;
    refInput.disabled = value;
    for (const suggestion of suggestionsEl.querySelectorAll(".ws-suggestion")) suggestion.disabled = value;
    for (const button of pickEl.querySelectorAll("button")) button.disabled = value;
    confirm.disabled = value || (onboarding ? !refInput.value.trim() : !selected);
    if (value) status.focus();
  };
  const enterOnboarding = (offer) => {
    onboarding = { token: offer.token, path: offer.path };
    title.textContent = "Onboard workspace";
    intro.textContent = "This folder has no oats-local.yaml yet. Name the workspace repository to realize here.";
    onboardPath.textContent = offer.path;
    modalSearch.hidden = true; suggestionsEl.hidden = true; onboardEl.hidden = false;
    confirm.textContent = "Onboard";
    confirm.disabled = !refInput.value.trim();
    refInput.focus();
  };
  const leaveOnboarding = () => {
    onboarding = null;
    title.textContent = defaults.title; intro.textContent = defaults.intro; confirm.textContent = defaults.confirm;
    modalSearch.hidden = false; suggestionsEl.hidden = false; onboardEl.hidden = true;
    refInput.value = "";
  };
  const closeModal = (restore = true) => {
    if (adding) return false;
    leaveOnboarding(); clearPick();
    modalGeneration++;
    discoveryGeneration++;
    modal.hidden = true;
    selected = null;
    confirm.disabled = true;
    if (restore) (addOpen.isConnected ? addOpen : focusTarget())?.focus();
    return true;
  };
  const openModal = async () => {
    if (adding) return;
    modalGeneration++;
    const discoveryToken = ++discoveryGeneration;
    modal.hidden = false;
    modalSearch.value = "";
    leaveOnboarding(); clearPick();
    suggestions = [];
    selected = null;
    discoveryState = { message: "Finding OATS workspaces…", error: false };
    setAdding(false);
    paintDiscoveryState();
    modalSearch.focus();
    try {
      const result = await discoverSuggestions();
      if (discoveryToken !== discoveryGeneration || modal.hidden) return;
      if (result?.stale) {
        discoveryState = { message: "No current workspace suggestions.", error: false };
      } else {
        const found = Array.isArray(result) ? result : (result?.suggestions || []);
        // A deployment a view already holds is added too (#482): views name their deployments.
        const added = new Set(workspaces.flatMap((workspace) => [workspace.id, ...(Array.isArray(workspace.deployments) ? workspace.deployments : [])]));
        // Only what can be opened: a stale row of this computer's list is the menu's to show and remove (#1390).
        suggestions = found.filter((candidate) => candidateId(candidate) && !added.has(candidateId(candidate))
          && (candidate.state === undefined || candidate.state === "ok"));
        discoveryState = {
          message: suggestions.length ? `${suggestions.length} suggested workspace${suggestions.length === 1 ? "" : "s"}` : "No additional OATS workspaces were discovered.",
          error: false,
        };
      }
      if (!adding) paintDiscoveryState();
    } catch (error) {
      if (discoveryToken !== discoveryGeneration || modal.hidden) return;
      discoveryState = { message: error?.message || "Could not discover OATS workspaces.", error: true };
      if (!adding) paintDiscoveryState();
    }
  };

  const reconcileAddedWorkspace = (workspace) => {
    const list = [...workspaces.filter((candidate) => candidate.id !== workspace.id), workspace];
    render(workspace, list);
    closeModal(false);
    pick(candidateId(workspace));
    focusTarget()?.focus();
  };
  const resolvedMutation = (result) => {
    if (result?.ok && result.workspace) { reconcileAddedWorkspace(result.workspace); return true; }
    if (result?.code === "superseded") { setStatus(""); return true; }
    return false;
  };
  const mutationFailureMessage = (result, fallback) => result?.code === "not-suggested"
    ? `${result.reason || "That workspace is no longer suggested."} Use Browse… to choose it explicitly.`
    : result?.reason || fallback;
  const onBrowse = async () => {
    if (adding) return;
    supersedeLocalAdd();
    const token = ++modalGeneration;
    clearPick();
    setAdding(true);
    setStatus("Choose an OATS workspace folder…");
    try {
      const result = await pickWorkspace();
      if (token !== modalGeneration) return;
      setAdding(false);
      if (result?.code === "cancelled") { paintDiscoveryState(); browse.focus(); return; }
      if (resolvedMutation(result)) return;
      discoveryGeneration++;
      setStatus(mutationFailureMessage(result, "Could not use that folder."), true);
      // Nothing changed: the refusal says what was expected and, below it, where the deployment is.
      if (result?.code === "not-a-workspace") renderPick(result);
      (pickEl.querySelector("button") || browse).focus();
    } catch (error) {
      if (token !== modalGeneration) return;
      setAdding(false);
      discoveryGeneration++;
      setStatus(error?.message || "Could not use that folder.", true);
      browse.focus();
    }
  };
  const onOnboard = async () => {
    const ref = refInput.value.trim();
    if (!onboarding || adding || !ref) return;
    supersedeLocalAdd();
    const token = ++modalGeneration, offer = onboarding;
    setAdding(true);
    setStatus(`Onboarding ${offer.path}… reading the workspace over Git.`);
    try {
      const result = await onboardWorkspace(offer.token, ref);
      if (token !== modalGeneration) return;
      setAdding(false);
      if (result?.ok) {
        const added = result.added;
        if (added?.ok && added.workspace) { reconcileAddedWorkspace(added.workspace); onboarded?.(result); return; }
        // The deployment exists now; only its registration failed.
        onboarding = null;
        setStatus(`Onboarded ${offer.path}, but it could not be added: ${added?.reason || "unknown error"}. Use Browse… to add it.`, true);
        leaveOnboarding(); browse.focus(); return;
      }
      if (result?.retry) onboarding = { token: result.retry, path: offer.path };
      else if (result?.code !== "bad-ref" && result?.code !== "busy") onboarding = null;
      const note = result?.rolledBack ? " Nothing was left in the folder." : "";
      setStatus(`${result?.code ? `${result.code}: ` : ""}${result?.reason || "Could not onboard that folder."}${note}`, true);
      if (onboarding) refInput.focus(); else { leaveOnboarding(); browse.focus(); }
    } catch (error) {
      if (token !== modalGeneration) return;
      setAdding(false);
      onboarding = null; leaveOnboarding();
      setStatus(error?.message || "Could not onboard that folder.", true);
      browse.focus();
    }
  };
  // Every add from the dialog (a suggestion, a deployment offered beside a refused pick) is the
  // same main-validated add; `returnFocus` gets focus back when it fails.
  const runAdd = async (path, name, returnFocus) => {
    if (adding) return;
    supersedeLocalAdd();
    const token = ++modalGeneration;
    setAdding(true);
    setStatus(`Adding ${name}…`);
    try {
      const result = await addWorkspace(path);
      if (token !== modalGeneration) return;
      setAdding(false);
      if (resolvedMutation(result)) return;
      setStatus(mutationFailureMessage(result, "Could not add that workspace."), true);
      (returnFocus?.isConnected ? returnFocus : confirm).focus();
    } catch (error) {
      if (token !== modalGeneration) return;
      setAdding(false);
      setStatus(error?.message || "Could not add that workspace.", true);
      (returnFocus?.isConnected ? returnFocus : confirm).focus();
    }
  };
  const onConfirm = async () => {
    if (onboarding) return onOnboard();
    if (!selected || adding) return;
    return runAdd(selected.path, candidateName(selected), confirm);
  };

  const render = (workspace, list = []) => {
    activeId = workspace?.id || "";
    if (activeId && activeId === pickedId) pickedId = ""; // the pick has landed
    if (workspace) choosing = false; // a window showing a workspace is not choosing one
    workspaces = Array.isArray(list) ? [...list] : [];
    if (workspace && !workspaces.some((candidate) => candidate.id === activeId)) workspaces.unshift(workspace);
    const labels = workspaceChoiceLabels(workspaces);
    const activeIndex = workspaces.findIndex((candidate) => candidate.id === activeId);
    // A window with no workspace (#481) asks for one; otherwise, before the first answer, it is resolving.
    const current = workspace ? (labels[activeIndex] || candidateName(workspace)) : choosing ? "none chosen yet" : "resolving";
    section.setAttribute("aria-description", `Current workspace: ${activeId && isLocalPath(activeId) ? activeId : current}`);
    renderOptions();
  };

  const onListKey = (event) => {
    // Open in new window (#481): the button beside an option is reached with ArrowRight and left with
    // ArrowLeft or Escape; ⌘Enter (macOS) / Ctrl+Enter on the option opens it directly.
    // A list row's Remove (#1390) is reached and left the same way.
    const action = event.target?.closest?.(".ws-open-window, .ws-remove-listed");
    const optionOf = (el) => el?.parentElement?.querySelector(":scope > .ws-option");
    if (action && ["ArrowLeft", "Escape"].includes(event.key)) { event.preventDefault(); optionOf(action)?.focus(); return; }
    const focusedOption = event.target?.classList?.contains("ws-option") ? event.target : null;
    if (focusedOption && event.key === "ArrowRight") {
      const beside = focusedOption.parentElement.querySelector(":scope > .ws-open-window, :scope > .ws-remove-listed");
      if (beside) { event.preventDefault(); beside.focus(); }
      return;
    }
    if (openInNewWindow && focusedOption?.dataset.workspaceId && event.key === "Enter" && !event.shiftKey && !event.altKey
      && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) {
      event.preventDefault(); openInWindow(focusedOption.dataset.workspaceId); return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = menuItems();
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(action ? optionOf(action) : document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
    items[next].focus();
  };
  const onSuggestionKey = (event) => {
    if (adding || !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const target = event.target.closest?.(".ws-suggestion");
    if (!target) return;
    event.preventDefault();
    const items = [...suggestionsEl.querySelectorAll(".ws-suggestion")];
    const index = items.indexOf(target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : ["ArrowDown", "ArrowRight"].includes(event.key) ? (index + 1) % items.length
        : (index - 1 + items.length) % items.length;
    const id = items[next].dataset.workspaceId;
    selected = suggestions.find((candidate) => candidateId(candidate) === id) || selected;
    confirm.disabled = !selected;
    renderSuggestions(id);
  };
  const onDialogKey = (event) => {
    if (event.key === "Escape") { event.preventDefault(); if (closeModal()) void lookLocally(); return; }
    if (adding && event.key === "Tab") { event.preventDefault(); status.focus(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("button:not([disabled]), input:not([disabled])")]
      .filter((element) => !element.hidden && element.tabIndex >= 0);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  options.addEventListener("keydown", onListKey);
  options.addEventListener("scroll", () => noteMore());
  // The list's height changes with the window and the sidebar: what is cut off is measured again.
  const resized = typeof (document.defaultView ?? globalThis).ResizeObserver === "function"
    ? new (document.defaultView ?? globalThis).ResizeObserver(() => noteMore()) : null;
  resized?.observe(options);
  // The tab stop follows the row last focused (the roster's roving pattern).
  options.addEventListener("focusin", (event) => {
    const button = event.target?.closest?.(".ws-option");
    if (!button || !options.contains(button)) return;
    stopKey = rowKey(button);
    for (const each of menuItems()) each.tabIndex = each === button ? 0 : -1;
  });
  addOpen.addEventListener("click", openModal);
  modalSearch.addEventListener("input", renderSuggestions);
  refInput.addEventListener("input", () => { if (!adding) confirm.disabled = !refInput.value.trim(); });
  refInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void onOnboard(); } });
  suggestionsEl.addEventListener("keydown", onSuggestionKey);
  browse.addEventListener("click", onBrowse);
  confirm.addEventListener("click", onConfirm);
  cancel.addEventListener("click", () => { if (closeModal()) void lookLocally(); });
  closeButton.addEventListener("click", () => { if (closeModal()) void lookLocally(); });
  modal.addEventListener("mousedown", (event) => { if (event.target === modal && closeModal()) void lookLocally(); });
  dialog.addEventListener("keydown", onDialogKey);
  // The window coming to the front asks again, and the timer follows whether it is in front.
  const win = document.defaultView;
  const onFocus = () => { void lookLocally(); scheduleListed(); };
  const onBlur = () => scheduleListed();
  win?.addEventListener?.("focus", onFocus);
  win?.addEventListener?.("blur", onBlur);

  // The first ask is pending from the first draw: the list says it is looking, not that nothing was found.
  localLooking = true;
  render(null);
  void lookLocally();
  scheduleListed();
  return {
    begin() {
      const token = ++generation;
      return (workspace, list) => {
        if (token !== generation) return false;
        render(workspace, list);
        return true;
      };
    },
    /** A switch landed here (shell.mjs restoreWorkspaceTabs): an older roster answer may not paint any more, and
     * `current` (the workspace now selected) is marked current at once. The rows stay: the list never empties
     * while the new workspace's roster is read, or when that read fails. */
    reset(current = "") {
      generation++;
      choosing = false;
      if (pickedId === current) pickedId = "";
      const known = workspaces.find((candidate) => candidate.id === current) ?? null;
      render(known, workspaces);
      if (!known && current) { activeId = current; renderOptions(); }
    },
    /** This window has no workspace (#481): the served choices main gave it, none current. Called again
     * as main serves more (#521), it repaints the list in place. */
    choose(list) { generation++; choosing = true; render(null, list); },
    /** Focus the list's current row, else its tab stop (the `w` key, the leader's `o`, app.workspaces). */
    focusList() { const target = rowOf(activeId) || focusTarget(); target?.focus(); revealInScrollport(options, target); noteMore(); return !!target; },
    /** The leader's ↑/↓ (`step` -1 / 1): select the previous / next row that can be opened, as a click does,
     * passing over those that can't be opened (a row another window shows is taken over). False at an end. */
    step(delta) {
      // From the pick still on its way, else the current row: presses faster than a switch make as many moves.
      const key = workspaceStep(drawn.map(({ key, openable }) => ({ key, openable })), pickedId || activeId || null, delta);
      const row = key === null ? null : drawn.find((entry) => entry.key === key);
      if (!row) return false;
      row.open();
      return true;
    },
    /** Ask main for this computer's rows again now. */
    refreshListed: () => lookLocally(),
    openModal,
    dispose() {
      stopped = true;
      resized?.disconnect();
      timers.clearTimeout?.(listedTimer);
      win?.removeEventListener?.("focus", onFocus);
      win?.removeEventListener?.("blur", onBlur);
    },
  };
}
