import { createWorkspaceMark } from "./identity-marks.mjs";
import { iconElement } from "./shell-icons.mjs";
import { deploymentMark } from "./view-deployments.mjs";
import { pathTail } from "./deployment-label.mjs";
import { requestDeploymentTab } from "./deployment-tabs.mjs";

// A choice id that is this computer's folder (a deployment from an older server, an unattached
// one): its path may be a tooltip. Any other id (a view's `ws:…`, a remote's `remote:…`) is never
// shown (#482).
const isLocalPath = (id) => typeof id === "string" && id.startsWith("/");
const short = (value, max = 256) => typeof value === "string" && value.length > 0 && value.length <= max ? value : "";

const machinesOf = (choice) => Array.isArray(choice?.machines) ? choice.machines.filter((m) => short(m)) : [];

/** The machines a choice's deployments are on, as one line (UI spec, #482): "This Mac · altair", from
 * the server's `machines`. Never a path or an id: without `machines` (an older server), nothing. */
export function workspaceChoicePlace(choice) {
  return machinesOf(choice).join(" · ");
}

export function workspaceChoiceLabels(choices) {
  const base = choices.map((choice) => choice.name
    || (isLocalPath(choice.id) ? String(choice.id).split("/").filter(Boolean).at(-1) : "")
    || "Workspace");
  const counts = new Map();
  for (const name of base) counts.set(name, (counts.get(name) || 0) + 1);
  return choices.map((choice, index) => {
    if (counts.get(base[index]) === 1) return base[index];
    // Two choices of one name: their workspace keys tell them apart, else a folder's last two
    // segments or the machines; never a ws: or remote: id, never a full path.
    const which = short(choice.key, 512) || (isLocalPath(choice.id) ? pathTail(choice.id, 2) : workspaceChoicePlace(choice));
    const suffix = [short(choice.team?.name), which].filter(Boolean).join(" · ");
    return suffix ? `${base[index]} — ${suffix}` : base[index];
  });
}

/** The tooltip of a choice: its deployments' labels (machine and short path) when the server sends
 * them, else a local folder's path; never an id. */
function choiceTooltip(choice) {
  const deployments = Array.isArray(choice?.deployments) ? choice.deployments : [];
  const labels = Array.isArray(choice?.deploymentLabels) && choice.deploymentLabels.length === deployments.length
    && choice.deploymentLabels.every((l) => short(l, 512)) ? choice.deploymentLabels : [];
  return labels.join(", ") || (isLocalPath(choice?.id) ? choice.id : "");
}

/** The section the switcher lists unattached views under (#482, expert decision Q4). */
export const UNMATCHED_SECTION = "Not matched to a workspace";

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
  // One window per workspace (#481): opens (or focuses) a workspace's own window. Absent, no action.
  openInNewWindow = null, mac = false,
}) {
  const q = (id) => document.getElementById(id);
  const trigger = q("ws-trigger"), currentName = q("ws-name"), menu = q("ws-menu");
  const menuSearch = q("ws-menu-search"), options = q("ws-options"), addOpen = q("ws-add-open");
  addOpen.replaceChildren(iconElement(document, 'plus', { size: 13 }), document.createTextNode('Add local workspace…')); addOpen.setAttribute('aria-label', 'Add local workspace…');
  const empty = document.createElement('p'); empty.className = 'ws-menu-empty'; empty.setAttribute('role', 'status'); empty.hidden = true;
  options.after(empty);
  // The options' description: how to reach Open in new window from the keyboard (one hidden element).
  const hint = document.createElement('p'); hint.id = 'ws-open-window-hint'; hint.hidden = true; hint.textContent = openInNewWindowHint(mac);
  if (openInNewWindow) empty.after(hint);
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

  const setStatus = (message = "", error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
  const closeMenu = (restore = false) => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restore) trigger.focus();
  };
  const menuItems = () => [...options.querySelectorAll(".ws-option:not([hidden])")];
  const openInWindow = (id) => { closeMenu(true); openInNewWindow(id); };
  // Views first; unattached views (a deployment no workspace identity matched) after them, in their
  // own group under UNMATCHED_SECTION. Every entry is its name and ONE muted line (UI spec, #482): a
  // view's machines, an unattached view's machine and short reason. A view with a deployment that is
  // not live carries a status mark. Filtering and Arrow/Home/End run across both (menuItems() is
  // every shown option).
  const unmatchedHeadingId = `ws-unmatched-${Math.random().toString(36).slice(2, 8)}`;
  const renderOptions = () => {
    const query = menuSearch.value.trim().toLocaleLowerCase();
    const labels = workspaceChoiceLabels(workspaces);
    const focusedId = document.activeElement?.classList?.contains("ws-option")
      ? document.activeElement.dataset.workspaceId : "";
    options.replaceChildren();
    const unmatched = document.createElement("div");
    unmatched.className = "ws-option-group"; unmatched.setAttribute("role", "group"); unmatched.setAttribute("aria-labelledby", unmatchedHeadingId);
    const unmatchedHead = document.createElement("div");
    unmatchedHead.className = "ws-option-section"; unmatchedHead.id = unmatchedHeadingId; unmatchedHead.setAttribute("role", "presentation");
    unmatchedHead.textContent = UNMATCHED_SECTION;
    unmatched.append(unmatchedHead);
    workspaces.forEach((workspace, index) => {
      const place = workspace.unattached
        // The machine, unless the entry is already named by it (a remote group is named by its server).
        ? [machinesOf(workspace)[0] === labels[index] ? "" : machinesOf(workspace)[0] || "", short(workspace.short)].filter(Boolean).join(" · ")
        : workspaceChoicePlace(workspace);
      const notLive = !workspace.unattached && Number.isInteger(workspace.notLive) && workspace.notLive > 0 ? workspace.notLive : 0;
      const haystack = `${labels[index]} ${place}`.toLocaleLowerCase();
      if (query && !haystack.includes(query)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ws-option";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(workspace.id === activeId));
      button.dataset.workspaceId = workspace.id;
      const tooltip = choiceTooltip(workspace);
      if (tooltip) button.title = tooltip;
      const check = document.createElement("span");
      check.className = "ws-check";
      check.setAttribute("aria-hidden", "true");
      check.replaceChildren(...(workspace.id === activeId ? [iconElement(document, "check", { size: 14 })] : []));
      const copy = document.createElement("span");
      copy.className = "ws-option-copy";
      const line = document.createElement("span");
      line.className = "ws-option-line";
      const name = document.createElement("span");
      name.className = "ws-option-name";
      name.textContent = labels[index];
      line.append(name);
      if (notLive) line.append(deploymentMark(document, `${notLive} ${notLive === 1 ? "deployment" : "deployments"} not live`));
      const meta = document.createElement("span");
      meta.className = "ws-option-meta";
      meta.textContent = place;
      meta.hidden = !place;
      copy.append(line, meta);
      button.append(createWorkspaceMark(document, workspace), copy, check);
      // Open in new window (#481): a trailing button beside the option, never inside it.
      const row = document.createElement("div");
      row.className = "ws-option-row"; row.setAttribute("role", "none");
      row.append(button);
      if (openInNewWindow) {
        button.setAttribute("aria-describedby", hint.id);
        const open = document.createElement("button");
        open.type = "button"; open.className = "ws-open-window"; open.tabIndex = -1;
        open.dataset.workspaceId = workspace.id;
        open.setAttribute("aria-label", `Open ${labels[index]} in a new window`);
        open.title = `Open ${labels[index]} in a new window`;
        open.append(iconElement(document, "newWindow", { size: 14 }));
        open.addEventListener("click", () => {
          if (menu.hidden || !open.isConnected || !options.contains(open)) return;
          openInWindow(workspace.id);
        });
        row.append(open);
      }
      button.addEventListener("click", () => {
        if (menu.hidden || !button.isConnected || !options.contains(button)) return;
        closeMenu(true);
        if (workspace.id !== activeId) selectWorkspace(workspace.id);
        // A deployment no workspace matched: the Deployments page opens on its tab, where the full
        // reason and its fix are.
        const deployment = workspace.unattached && Array.isArray(workspace.deployments) ? workspace.deployments[0] : null;
        if (deployment) requestDeploymentTab(workspace.id, deployment);
      });
      (workspace.unattached ? unmatched : options).append(row);
    });
    if (unmatched.querySelector(".ws-option")) options.append(unmatched);
    empty.hidden = options.childElementCount > 0;
    empty.textContent = empty.hidden ? '' : workspaces.length ? 'No workspaces match this filter.' : 'No workspace choices reported.';
    if (focusedId && !menu.hidden) {
      (menuItems().find((button) => button.dataset.workspaceId === focusedId) || menuSearch).focus();
    }
  };
  const openMenu = () => {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    menuSearch.value = "";
    renderOptions();
    menuSearch.focus();
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
    if (restore) trigger.focus();
    return true;
  };
  const openModal = async () => {
    if (adding) return;
    closeMenu();
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
        suggestions = found.filter((candidate) => candidateId(candidate) && !added.has(candidateId(candidate)));
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
    selectWorkspace(candidateId(workspace));
    trigger.focus();
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
    workspaces = Array.isArray(list) ? [...list] : [];
    if (workspace && !workspaces.some((candidate) => candidate.id === activeId)) workspaces.unshift(workspace);
    const labels = workspaceChoiceLabels(workspaces);
    const activeIndex = workspaces.findIndex((candidate) => candidate.id === activeId);
    // A window with no workspace (#481) asks for one; otherwise, before the first answer, it is resolving.
    currentName.textContent = workspace ? (labels[activeIndex] || candidateName(workspace)) : choosing ? "Choose a workspace" : "Resolving…";
    trigger.title = activeId ? `Active workspace: ${isLocalPath(activeId) ? activeId : currentName.textContent}`
      : choosing ? "This window has no workspace yet" : "Resolving active workspace";
    renderOptions();
  };

  const onTrigger = () => menu.hidden ? openMenu() : closeMenu(true);
  const onDocumentPointer = (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) closeMenu();
  };
  const onMenuKey = (event) => {
    // Open in new window (#481): the button beside an option is reached with ArrowRight and left with
    // ArrowLeft or Escape; ⌘Enter (macOS) / Ctrl+Enter on the option opens it directly.
    const action = event.target?.closest?.(".ws-open-window");
    const optionOf = (el) => el?.parentElement?.querySelector(":scope > .ws-option");
    if (openInNewWindow && action && ["ArrowLeft", "Escape"].includes(event.key)) { event.preventDefault(); optionOf(action)?.focus(); return; }
    const focusedOption = event.target?.classList?.contains("ws-option") ? event.target : null;
    if (openInNewWindow && focusedOption && event.key === "ArrowRight") {
      event.preventDefault(); focusedOption.parentElement.querySelector(":scope > .ws-open-window")?.focus(); return;
    }
    if (openInNewWindow && focusedOption && event.key === "Enter" && !event.shiftKey && !event.altKey
      && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) {
      event.preventDefault(); openInWindow(focusedOption.dataset.workspaceId); return;
    }
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    // Home/End in the search field move its caret.
    if (event.target === menuSearch && ["Home", "End"].includes(event.key)) return;
    const items = menuItems();
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(action ? optionOf(action) : document.activeElement);
    // Up from the first option goes back to the search field (spec F).
    if (event.key === "ArrowUp" && index === 0) { menuSearch.focus(); return; }
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
    if (event.key === "Escape") { event.preventDefault(); closeModal(); return; }
    if (adding && event.key === "Tab") { event.preventDefault(); status.focus(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("button:not([disabled]), input:not([disabled])")]
      .filter((element) => !element.hidden && element.tabIndex >= 0);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  trigger.addEventListener("click", onTrigger);
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "Enter", " "].includes(event.key) && menu.hidden) { event.preventDefault(); openMenu(); }
  });
  menuSearch.addEventListener("input", renderOptions);
  menu.addEventListener("keydown", onMenuKey);
  // Tabbing out of the open menu closes it, like a click elsewhere (spec F).
  menu.addEventListener("focusout", (event) => {
    if (!menu.hidden && event.relatedTarget && !menu.contains(event.relatedTarget) && !trigger.contains(event.relatedTarget)) closeMenu();
  });
  addOpen.addEventListener("click", openModal);
  modalSearch.addEventListener("input", renderSuggestions);
  refInput.addEventListener("input", () => { if (!adding) confirm.disabled = !refInput.value.trim(); });
  refInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void onOnboard(); } });
  suggestionsEl.addEventListener("keydown", onSuggestionKey);
  browse.addEventListener("click", onBrowse);
  confirm.addEventListener("click", onConfirm);
  cancel.addEventListener("click", () => closeModal());
  closeButton.addEventListener("click", () => closeModal());
  modal.addEventListener("mousedown", (event) => { if (event.target === modal) closeModal(); });
  dialog.addEventListener("keydown", onDialogKey);
  document.addEventListener("mousedown", onDocumentPointer);

  render(null);
  return {
    begin() {
      const token = ++generation;
      return (workspace, list) => {
        if (token !== generation) return false;
        render(workspace, list);
        return true;
      };
    },
    reset() { generation++; choosing = false; render(null); },
    /** This window has no workspace (#481): the served choices main gave it, none selected. */
    choose(list) { generation++; choosing = true; render(null, list); },
    openMenu,
    openModal,
  };
}
