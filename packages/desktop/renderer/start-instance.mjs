import { apiJson, postJson, instanceApiPath, currentWorkspace, workspaceGeneration, onWorkspaceChange, wsQuery } from "./views/common.mjs";
import { instanceId } from "./instance-tree.mjs";
import { waitForInstanceInPanel } from "./views/spawn.mjs";

/** Existing homes are started, never scaffolded again. One dialog owns a launch. */
export function createInstanceStarter(doc, ctx, { waitForReady = waitForInstanceInPanel } = {}) {
  let active;
  const pending = new Set();
  return function openStart(instance) {
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
      <label>Model for this start<input class="field start-model" list="instance-start-models" autocomplete="off"></label>
      <datalist id="instance-start-models"></datalist>
      <p class="start-model-help"></p>
      <p class="start-status" role="status" aria-live="polite"></p>
      <div class="start-buttons"><button class="act start-submit" type="submit" disabled>Start</button>
        <button class="act start-retry" type="button">Refresh status</button>
        <button class="act start-cancel" type="button">Cancel</button></div>
    </form>`;
    const form = modal.querySelector("form"), model = modal.querySelector(".start-model");
    const submit = modal.querySelector(".start-submit"), status = modal.querySelector(".start-status");
    const retry = modal.querySelector(".start-retry");
    modal.querySelector("h2").textContent = `Start ${instance.instance}`;
    modal.querySelector(".start-context").textContent = `${instance.runtime || "pi"} · ${instance.server || "This machine"} · ${instance.home}`;
    model.placeholder = instance.model || "Runtime default";
    modal.querySelector(".start-model-help").textContent = `Leave blank to keep ${instance.model || "the runtime default"}. Choosing a model here changes this instance’s next launch.`;
    let closed = false, starting = false, started = false, live = false, canStart = false, refreshGeneration = 0;
    const owns = () => !closed && ws === currentWorkspace() && generation === workspaceGeneration();
    const close = () => {
      if (closed) return;
      closed = true; offWorkspace(); modal.remove(); active = null;
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
        submit.textContent = live ? "Open terminal" : "Start";
        model.disabled = live;
        if (live) { submit.disabled = false; status.textContent = "This instance is already running."; return; }
        if (!found) throw new Error("This instance is no longer in this workspace. Refresh the workspace roster.");
        if (found.running !== false) throw new Error(found.runtimeError || "Could not verify whether this instance is running. Refresh its status before starting.");
        if (instance.server && !found.savedRoute) throw new Error("This remote instance has no saved route. Check the server registration.");
        if (!cli.ok || !cli.features?.includes("session-start")) throw new Error(`Starting an existing instance needs an updated OATS CLI. ${cli.install || "Update OATS and retry."}`);
        if (instance.server && !cli.remote?.includes("session-start")) throw new Error("Update the OATS CLI to enable starting instances on a server.");
        canStart = true; submit.disabled = pending.has(key);
        status.textContent = pending.has(key) ? "A start is already in progress for this instance." : "Ready to start.";
      } catch (e) { if (owns() && request === refreshGeneration) status.textContent = e.message; }
    };
    retry.addEventListener("click", refresh);
    modal.querySelector(".start-cancel").addEventListener("click", close);
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key !== "Tab") return;
      const items = [...form.querySelectorAll("input:not(:disabled), button:not(:disabled)")];
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first?.focus(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!owns() || submit.disabled || starting || started) return;
      if (live) { close(); await ctx.openTerminal(instance, { quiet: true }); return; }
      if (!canStart || pending.has(key)) return;
      const chosen = model.value.trim();
      if (chosen.startsWith("-") || chosen.includes("\0")) { status.textContent = "Enter a model name, not a command-line option."; return; }
      const path = instanceApiPath("start", instance);
      starting = true; pending.add(key); submit.disabled = true; model.disabled = true; retry.disabled = true;
      status.textContent = "Starting…";
      try {
        await postJson(ctx, path, chosen ? { model: chosen } : {});
        started = true;
        if (!owns()) return;
        status.textContent = "Started. Waiting for the terminal…";
        const ready = await waitForReady({ ctx }, instance, owns);
        if (!owns()) return;
        if (ready) { close(); await ctx.openTerminal(instance, { quiet: true }); }
        else { status.textContent = "Started; the roster is still updating. Open its terminal from the sidebar when it appears."; }
      } catch (error) {
        if (!owns()) return;
        status.textContent = started ? `Started, but the terminal could not open: ${error.message}` : error.message;
        // A timeout may have happened after launch. Recheck before offering another start.
        canStart = false;
      } finally {
        starting = false; pending.delete(key);
        if (owns()) { model.disabled = started; retry.disabled = started; }
      }
    });
    doc.body.append(modal); model.focus(); void refresh();
    // Catalogs are advisory; remote model availability is determined by that host.
    if (!instance.server) void postJson(ctx, "/api/models", { runtime: instance.runtime || "pi" }).then((d) => {
      if (!owns()) return;
      for (const m of d.models || []) {
        const option = doc.createElement("option"); option.value = m.id;
        if (m.label) option.label = m.label;
        modal.querySelector("datalist").append(option);
      }
    }).catch(() => {});
    return modal;
  };
}
