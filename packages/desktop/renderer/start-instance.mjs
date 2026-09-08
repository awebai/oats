import { apiJson, postJson, instanceApiPath, currentWorkspace, workspaceGeneration, onWorkspaceChange, wsQuery } from "./views/common.mjs";
import { instanceId } from "./instance-tree.mjs";
import { waitForInstanceInPanel } from "./views/spawn.mjs";
import { launchConfigFields } from "./launch-config-fields.mjs";

/** Existing homes are started, never scaffolded again. One dialog owns a launch. */
export function createInstanceStarter(doc, ctx, { waitForReady = waitForInstanceInPanel } = {}) {
  let active;
  const pending = new Set();
  return function openStart(instance, { restart = false } = {}) {
    if (active) { active.focus(); return; }
    const key = instanceId(instance);
    const ws = currentWorkspace(), generation = workspaceGeneration();
    const opener = doc.activeElement;
    const modal = doc.createElement("div"); modal.className = "oats-view instance-start-modal";
    modal.innerHTML = `<form class="instance-start-dialog" role="dialog" aria-modal="true" aria-labelledby="instance-start-title">
      <h2 id="instance-start-title"></h2>
      <p class="start-context"></p>
      <p>Continue in this instance’s existing home, with its identity, work and notes.</p>
      <p>This starts a new conversation using the saved briefing and state.</p>
      <div class="start-launch-controls" hidden>
        <label>Harness<select class="field start-runtime"><option value="">Keep recorded harness</option><option value="codex">codex</option><option value="claude">claude</option><option value="pi">pi</option></select></label>
        <label>Permissions<select class="field start-yolo"><option value="">Keep defaults</option><option value="true">YOLO — skip permission prompts</option><option value="false">Use native permission policy</option></select></label>
      </div>
      <label>Model for this start<input class="field start-model" list="instance-start-models" autocomplete="off"></label>
      <datalist id="instance-start-models"></datalist>
      <p class="start-model-help"></p>
      <div class="start-configurations" hidden></div>
      <p class="start-status" role="status" aria-live="polite"></p>
      <div class="start-buttons"><button class="act start-submit" type="submit" disabled>Start</button>
        <button class="act start-retry" type="button">Refresh status</button>
        <button class="act start-cancel" type="button">Cancel</button></div>
    </form>`;
    const form = modal.querySelector("form"), model = modal.querySelector(".start-model");
    const submit = modal.querySelector(".start-submit"), status = modal.querySelector(".start-status");
    const retry = modal.querySelector(".start-retry");
    modal.querySelector("h2").textContent = `${restart ? "Restart" : "Start"} ${instance.instance}`;
    modal.querySelector(".start-context").textContent = `${instance.runtime || "pi"} · ${instance.server || "This machine"} · ${instance.home}`;
    model.placeholder = instance.model || "Runtime default";
    modal.querySelector(".start-model-help").textContent = `Leave blank to keep ${instance.model || "the runtime default"}. Choosing a model here changes this instance’s next launch.`;
    let closed = false, starting = false, started = false, live = false, canStart = false, refreshGeneration = 0, hasLaunchConfig = false, configsLoaded = false;
    const owns = () => !closed && ws === currentWorkspace() && generation === workspaceGeneration();
    const runtime = modal.querySelector(".start-runtime"), yolo = modal.querySelector(".start-yolo");
    let chosenConfig, modelRequest = 0;
    const updateModelHelp = () => {
      const effectiveRuntime = chosenConfig?.runtime || runtime.value || instance.runtime || "pi";
      const defaultModel = chosenConfig?.model || (effectiveRuntime === instance.runtime ? instance.model : null);
      model.placeholder = defaultModel || "Harness default";
      modal.querySelector(".start-model-help").textContent = `Leave blank to use ${defaultModel || "the selected harness’s default model"}. This choice is saved for later starts of this instance.`;
    };
    const fillModels = async () => {
      const id = ++modelRequest, list = modal.querySelector("datalist"); list.replaceChildren();
      if (instance.server || chosenConfig) return; // A named wrapper may have a different model catalog.
      try {
        const data = await postJson(ctx, "/api/models", { runtime: runtime.value || instance.runtime || "pi" });
        if (!owns() || id !== modelRequest) return;
        for (const m of data.models || []) { const option = doc.createElement("option"); option.value = m.id; if (m.label) option.label = m.label; list.append(option); }
      } catch { /* Models can always be entered explicitly. */ }
    };
    const choices = () => ({ ...(model.value.trim() ? { model: model.value.trim() } : {}), ...(hasLaunchConfig && runtime.value ? { runtime: runtime.value } : {}), ...(hasLaunchConfig && yolo.value !== "" ? { yolo: yolo.value === "true" } : {}) });
    const launchFields = launchConfigFields(modal.querySelector(".start-configurations"), { ctx, selector: () => ({ home: instance.home }), choices, owns,
      changed: row => { chosenConfig = row; runtime.value = ""; runtime.disabled = !!row; runtime.querySelector("option").textContent = row ? `Configuration harness (${row.runtime})` : `Recorded harness (${instance.runtime || "pi"})`; updateModelHelp(); void fillModels(); },
    });
    for (const input of [runtime, model, yolo]) input.addEventListener("input", () => launchFields.invalidate());
    runtime.addEventListener("change", () => { updateModelHelp(); void fillModels(); });
    const close = () => {
      if (closed) return;
      closed = true; launchFields.dispose(); offWorkspace(); modal.remove(); active = null;
      if (opener?.isConnected) opener.focus();
    };
    const offWorkspace = onWorkspaceChange(close);
    active = { focus: () => model.focus() };
    const refresh = async () => {
      if (starting || started) return;
      const request = ++refreshGeneration;
      submit.disabled = true; canStart = false; status.textContent = "Checking instance…";
      try {
        const [cli, panel] = await Promise.all([apiJson(ctx, "/api/cli"), apiJson(ctx, `/api/panel${wsQuery()}`)]);
        if (!owns() || request !== refreshGeneration) return;
        const found = panel.instances?.find((i) => instanceId(i) === key);
        live = found?.running === true;
        hasLaunchConfig = !!cli.ok && cli.features?.includes("launch-config") && (!instance.server || cli.remote?.includes("launch-config"));
        modal.querySelector(".start-launch-controls").hidden = modal.querySelector(".start-configurations").hidden = !hasLaunchConfig;
        if (hasLaunchConfig && !configsLoaded) { configsLoaded = true; void launchFields.load(); }
        submit.textContent = restart ? "Restart" : live ? "Open terminal" : "Start";
        model.disabled = live && !restart;
        if (live && !restart) { submit.disabled = false; status.textContent = "This instance is already running."; return; }
        if (!found) throw new Error("This instance is no longer in this workspace. Refresh the workspace roster.");
        if (found.running !== false && !(restart && live)) throw new Error(found.runtimeError || "Could not verify whether this instance is running. Refresh its status before starting.");
        if (instance.server && !found.savedRoute) throw new Error("This remote instance has no saved route. Check the server registration.");
        if (!cli.ok || !cli.features?.includes("session-start")) throw new Error(`Starting an existing instance needs an updated OATS CLI. ${cli.install || "Update OATS and retry."}`);
        if (instance.server && !cli.remote?.includes("session-start")) throw new Error("Update the OATS CLI to enable starting instances on a server.");
        if (restart && (!cli.features?.includes("session-restart") || (instance.server && !cli.remote?.includes("session-restart")))) throw new Error("Update OATS to restart with another harness or configuration.");
        canStart = true; submit.disabled = pending.has(key);
        status.textContent = pending.has(key) ? "A start is already in progress for this instance." : restart && live ? "Restart stops the current harness after checking the new configuration. Save any in-progress work before continuing." : "Ready to start.";
      } catch (e) { if (owns() && request === refreshGeneration) status.textContent = e.message; }
    };
    retry.addEventListener("click", refresh);
    modal.querySelector(".start-cancel").addEventListener("click", close);
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key !== "Tab") return;
      const items = [...form.querySelectorAll("input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), summary")].filter(el => !el.closest("[hidden]") && (!el.closest("details") || el.tagName === "SUMMARY" || el.closest("details").open));
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first?.focus(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!owns() || submit.disabled || starting || started) return;
      if (live && !restart) { close(); await ctx.openTerminal(instance, { quiet: true }); return; }
      if (!canStart || pending.has(key)) return;
      if (launchFields.busy()) { status.textContent = "Wait for the launch configuration to finish saving."; return; }
      const chosen = model.value.trim();
      if (chosen.startsWith("-") || chosen.includes("\0")) { status.textContent = "Enter a model name, not a command-line option."; return; }
      const path = instanceApiPath(restart ? "restart" : "start", instance);
      starting = true; pending.add(key); submit.disabled = true; model.disabled = true; retry.disabled = true;
      const body = { ...choices(), ...(hasLaunchConfig && launchFields.value() ? { launchConfig: launchFields.value() } : {}) };
      launchFields.invalidate();
      runtime.disabled = yolo.disabled = true; launchFields.disabled(true);
      status.textContent = restart ? "Checking configuration and restarting…" : "Starting…";
      try {
        await postJson(ctx, path, body);
        started = true;
        if (!owns()) return;
        status.textContent = "Started. Waiting for the terminal…";
        const ready = await waitForReady({ ctx }, instance, owns);
        if (!owns()) return;
        if (ready) { close(); await ctx.openTerminal(instance, { quiet: true }); }
        else {
          // Launch acceptance is not proof that the harness stayed alive.
          // Permit another attempt only after a fresh status check.
          started = false; canStart = false;
          status.textContent = "The launch returned, but no running harness was observed. It may have exited. Refresh status before retrying.";
        }
      } catch (error) {
        if (!owns()) return;
        status.textContent = started ? `Started, but the terminal could not open: ${error.message}` : error.message;
        // A timeout may have happened after launch. Recheck before offering another start.
        canStart = false;
      } finally {
        starting = false; pending.delete(key);
        if (owns()) { model.disabled = yolo.disabled = started; runtime.disabled = started || !!launchFields.value(); retry.disabled = started; launchFields.disabled(started); }
      }
    });
    doc.body.append(modal); model.focus(); void refresh();
    void fillModels();
    return modal;
  };
}
