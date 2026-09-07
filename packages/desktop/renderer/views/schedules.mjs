import { apiJson, postJson, ensureTheme, onWorkspaceChange, workspaceGeneration, wsQuery } from "./common.mjs";
import { wakeScheduleFields } from "../wake-schedule-fields.mjs";

let mounted;
let preselection;
export function preselectSchedule(soul) { preselection = { soul, generation: workspaceGeneration() }; }
export function mount(el, ctx) { mounted = createSchedulesView(el, ctx); }
export function unmount() { mounted?.dispose(); mounted = null; }

const when = value => value ? new Date(value).toLocaleString() : "—";
export function scheduleOutcome(run) {
  if (!run) return "Not run yet";
  const labels = { launched: "Agent launched", active: "Agent active", running: "Agent active", ended: "Run ended", stopped: "Agent stopped — needs attention", unknown: "Launch state unknown — needs attention", "launch-failed": "Launch failed", skipped: "Skipped", delivered: "Wake message delivered" };
  return [labels[run.outcome] || run.outcome || "Attempt recorded", run.error?.message || run.error, run.reason].filter(Boolean).join(" · ");
}
const CSS = `
.schedules-view { display:block; height:100%; overflow:auto; padding:20px; background:var(--bg); color:var(--fg); }
.schedules-view header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.schedules-view h2 { margin:0; flex:1; font-size:18px; }
.schedules-view .schedule-status { color:var(--muted); margin:12px 0; }
.schedules-view .schedule-error { color:var(--danger); }
.schedules-view .schedule-list { display:grid; gap:12px; margin-top:16px; }
.schedule-card, .schedule-form { border:1px solid var(--border); border-radius:10px; padding:16px; background:var(--surface); }
.schedule-card h3 { margin:0 0 8px; font-size:15px; }
.schedule-card p { margin:6px 0; overflow-wrap:anywhere; }
.schedule-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.schedule-form { max-width:680px; margin-top:16px; display:grid; gap:12px; }
.schedule-form[hidden], .schedule-form [hidden] { display:none; }
.schedule-form h3 { margin:0; }
.schedule-form label { display:grid; gap:5px; }
.schedule-form .schedule-check { display:flex; align-items:center; gap:8px; }
.schedule-form .schedule-pair { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.schedule-form fieldset { border:1px solid var(--border); border-radius:8px; margin:12px 0 0; padding:12px; }
.schedule-form textarea { resize:vertical; min-height:90px; }
.schedule-form .schedule-hint { color:var(--muted); font-size:12px; margin:0; }
@media(max-width:650px) { .schedule-form .schedule-pair { grid-template-columns:1fr; } }
`;

export function createSchedulesView(el, ctx, { pollMs = 30000 } = {}) {
  const doc = el.ownerDocument;
  ensureTheme(doc);
  el.innerHTML = `<style>${CSS}</style><section class="oats-view schedules-view">
    <header><h2>Schedules</h2><button class="act schedule-new">New schedule</button><button class="act schedule-refresh">Refresh</button></header>
    <p>Schedules run on this workspace’s server, including while the GUI is closed.</p>
    <div class="schedule-status" role="status"></div>
    <div class="schedule-host-actions"></div>
    <p class="schedule-operation-result" role="status"></p>
    <p class="schedule-error" role="alert"></p>
    <form class="schedule-form" hidden>
      <h3 class="schedule-form-title">New schedule</h3>
      <label>Name<input class="field" name="id" required pattern="[a-z0-9][a-z0-9-]{0,39}" placeholder="daily-review"></label>
      <label>Action<select class="field" name="kind"><option value="wake">Wake an existing agent</option><option value="spawn">Launch a new agent</option><option value="harvest">Harvest knowledge</option></select></label>
      <label class="schedule-agent-field">Soul<select class="field" name="agent"></select></label>
      <label class="schedule-home-field">Agent home<select class="field" name="home"></select></label>
      <label class="schedule-task-field"><span class="schedule-task-label">Wake message</span><textarea class="field" name="task" placeholder="What should the agent do each time?"></textarea></label>
      <div class="schedule-spawn-options">
        <label>Purpose (optional instance name prefix)<input class="field" name="purpose"></label>
        <div class="schedule-pair">
          <label>Runtime<select class="field" name="runtime"><option value="">Soul default</option><option>pi</option><option>claude</option><option>codex</option></select></label>
          <label>Model<input class="field" name="model" placeholder="Soul default"></label>
        </div>
        <div class="schedule-pair">
          <label>Session backend<select class="field" name="backend"><option value="">Soul default</option><option value="tmux">tmux</option><option value="herdr">Herdr</option></select></label>
          <label>Permissions<select class="field" name="yolo"><option value="">Soul / scope setting</option><option value="true">YOLO — skip permission prompts</option><option value="false">Native permission policy</option></select></label>
        </div>
      </div>
      <label>Repeat<select class="field" name="repeat"><option value="*/15 * * * *">Every 15 minutes</option><option value="*/5 * * * *">Every 5 minutes</option><option value="*/30 * * * *">Every 30 minutes</option><option value="0 * * * *">Every hour</option><option value="0 9 * * *">Daily at 09:00</option><option value="0 9 * * 1-5">Weekdays at 09:00</option><option value="custom">Custom cron</option></select></label>
      <div class="schedule-pair">
        <label>Cron expression<input class="field" name="cron" required value="*/15 * * * *" aria-describedby="schedule-cron-hint"></label>
        <label>Time zone<input class="field" name="tz" required placeholder="America/Toronto"></label>
      </div>
      <p class="schedule-hint" id="schedule-cron-hint">Minute, hour, day of month, month, day of week. Missed times are skipped. Wake messages use the agent’s terminal; no interrupts are sent.</p>
      <label class="schedule-check"><input type="checkbox" name="enabled" checked>Enabled</label>
      <div class="schedule-actions"><button class="act schedule-save" type="submit">Save schedule</button><button class="act schedule-cancel" type="button">Cancel</button></div>
      <p class="schedule-form-error schedule-error" role="alert"></p>
    </form><div class="schedule-list"></div></section>`;
  const q = selector => el.querySelector(selector);
  const form = q("form"), field = name => form.elements.namedItem(name);
  const nestedWake = wakeScheduleFields(doc);
  q(".schedule-spawn-options").append(nestedWake.el);
  let alive = true, request = 0, busy = false, available = false, editing = null;
  let schedules = [], agents = [], instances = [];
  const button = (label, action, disabled = false) => {
    const b = doc.createElement("button"); b.className = "act"; b.type = "button";
    b.textContent = label; b.disabled = disabled; b.addEventListener("click", action); return b;
  };
  const error = message => { q(".schedule-error").textContent = message; };
  const fill = (select, rows, label, value) => {
    select.replaceChildren();
    for (const row of rows) { const o = doc.createElement("option"); o.value = value(row); o.textContent = label(row); select.append(o); }
  };
  function syncKind() {
    const kind = field("kind").value;
    q(".schedule-agent-field").hidden = kind !== "spawn";
    q(".schedule-home-field").hidden = kind === "spawn";
    q(".schedule-spawn-options").hidden = kind !== "spawn";
    q(".schedule-task-field").hidden = kind === "harvest";
    q(".schedule-task-label").textContent = kind === "wake" ? "Wake message" : "Task";
    field("task").required = kind !== "harvest";
    field("agent").required = kind === "spawn";
    field("home").required = kind !== "spawn";
  }
  function openForm(job, soul) {
    editing = job?.id || null; form.reset();
    q(".schedule-form-error").textContent = "";
    q(".schedule-form-title").textContent = editing ? `Edit ${editing}` : "New schedule";
    fill(field("agent"), agents.filter(a => a.work !== "attached"), a => `${a.name} · ${a.agentsRoot}`, a => JSON.stringify([a.name, a.repo || null, a.agentsRoot]));
    fill(field("home"), instances, i => `${i.instance} · ${i.home}`, i => i.home);
    field("id").disabled = !!editing; field("id").value = editing || "";
    field("tz").value = job?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    field("cron").value = job?.cron || "*/15 * * * *";
    field("repeat").value = [...field("repeat").options].some(o => o.value === field("cron").value) ? field("cron").value : "custom";
    field("enabled").checked = job?.enabled ?? true;
    field("kind").value = job?.kind === "command" ? "harvest" : job?.kind || (soul ? "spawn" : "wake");
    if (job?.agent || soul) field("agent").value = JSON.stringify([job?.agent || soul.name, job?.repo || soul?.repo || null, job?.agentsRoot || soul?.agentsRoot]);
    if (job?.home || job?.cwd) field("home").value = job.home || job.cwd;
    field("task").value = job?.message || job?.task || "";
    field("purpose").value = job?.purpose || "";
    nestedWake.set(job?.wake);
    for (const name of ["runtime", "model", "backend"]) field(name).value = job?.[name] || "";
    field("yolo").value = job?.yolo === undefined ? "" : String(job.yolo);
    syncKind(); form.hidden = false; field(editing ? "cron" : "id").focus();
  }
  async function mutate(operation, id, spec) {
    if (busy || !available) return;
    const generation = workspaceGeneration(); busy = true; error(""); q(".schedule-operation-result").textContent = ""; render();
    q(".schedule-save").disabled = true;
    try {
      const result = await postJson(ctx, `/api/schedules${wsQuery()}`, { operation, id, ...(spec ? { spec } : {}) });
      if (!alive || generation !== workspaceGeneration()) return;
      if (operation === "add" || operation === "update") form.hidden = true;
      if (operation === "run" && result.run) q(".schedule-operation-result").textContent = scheduleOutcome(result.run);
      if (operation === "reconcile") q(".schedule-operation-result").textContent = [result.reconciled === "unknown" ? "Run state is still unknown." : `Run state: ${result.reconciled || "checked"}.`, result.remedy].filter(Boolean).join(" ");
      await refresh();
    } catch (e) {
      if (alive && generation === workspaceGeneration()) {
        error(e.message); if (!form.hidden) q(".schedule-form-error").textContent = e.message;
      }
    } finally {
      if (alive && generation === workspaceGeneration()) { busy = false; q(".schedule-save").disabled = false; render(); }
    }
  }
  function render() {
    q(".schedule-new").disabled = busy || !available;
    q(".schedule-save").disabled = busy || !available;
    for (const control of form.querySelectorAll("input, select, textarea")) control.disabled = busy || (control.name === "id" && !!editing);
    q(".schedule-host-actions").querySelectorAll("button").forEach(b => { b.disabled = busy || !available; });
    const list = q(".schedule-list");
    const focused = doc.activeElement?.closest?.("[data-schedule-id]");
    const focusId = focused?.dataset.scheduleId, focusLabel = focused && doc.activeElement.textContent;
    list.replaceChildren();
    if (!schedules.length) { const p = doc.createElement("p"); p.textContent = available ? "No schedules in this workspace." : "Schedules unavailable."; list.append(p); }
    for (const job of schedules) {
      const card = doc.createElement("article"); card.className = "schedule-card"; card.dataset.scheduleId = job.id;
      const title = doc.createElement("h3"); title.textContent = `${job.id} · ${job.enabled ? "Enabled" : "Paused"}`; card.append(title);
      const target = job.kind === "spawn" ? `Launch ${job.agent}` : job.kind === "wake" ? `Wake ${job.home}` : `Command: ${(job.argv || []).join(" ")}`;
      for (const text of [target, `${job.cron} · ${job.tz}`, `Next: ${when(job.nextRun)}`, `Last: ${when(job.lastRun?.startedAt)} · ${scheduleOutcome(job.lastRun)}`]) {
        const p = doc.createElement("p"); p.textContent = text; card.append(p);
      }
      const actions = doc.createElement("div"); actions.className = "schedule-actions";
      const editable = job.kind !== "command" || JSON.stringify(job.argv) === JSON.stringify(["oats", "okf", "harvest", "--json"]);
      actions.append(button("Edit", () => openForm(job), busy || !available || !editable));
      actions.append(button(job.enabled ? "Pause" : "Enable", () => mutate(job.enabled ? "disable" : "enable", job.id), busy || !available));
      actions.append(button("Run now", () => mutate("run", job.id), busy || !available || !job.enabled));
      if (job.lastRun?.outcome === "unknown") actions.append(button("Check run state", () => mutate("reconcile", job.id), busy || !available));
      actions.append(button("Delete", () => {
        // Two explicit clicks; no native modal and no interruption of agents.
        actions.replaceChildren(button("Confirm deletion", () => mutate("remove", job.id)), button("Cancel", render));
      }, busy || !available));
      card.append(actions); list.append(card);
      if (focusId === job.id) [...actions.children].find(b => b.textContent === focusLabel)?.focus();
    }
  }
  async function refresh() {
    const serial = ++request, generation = workspaceGeneration();
    const suffix = wsQuery();
    try {
      const [data, roster, panel] = await Promise.all([
        apiJson(ctx, `/api/schedules${suffix}`), apiJson(ctx, `/api/agents${suffix}`), apiJson(ctx, `/api/panel${suffix}`),
      ]);
      if (!alive || serial !== request || generation !== workspaceGeneration()) return;
      available = true; schedules = data.schedules || []; agents = roster.agents || []; instances = panel.instances || [];
      const host = data.scheduler || {};
      q(".schedule-status").textContent = !host.installed ? "Scheduler is not installed on this host. Saved schedules will not run until it is enabled."
        : host.registered === false ? "This workspace is not registered with the host scheduler. Enable it to run these schedules."
        : !host.active ? "Scheduler is installed but inactive."
          : `Scheduler enabled · Last check: ${when(host.lastTick)} · Up to ${host.maxConcurrent || 1} scheduled agent(s) at once`;
      q(".schedule-host-actions").replaceChildren(...(!host.installed || !host.active || host.registered === false
        ? [button("Enable host scheduler", () => mutate("host-install"), busy)] : []));
      render();
      if (preselection) {
        const selected = preselection; preselection = null;
        if (selected.generation === generation) openForm(null, selected.soul);
      }
    } catch (e) {
      if (!alive || serial !== request || generation !== workspaceGeneration()) return;
      available = false; error(e.message); q(".schedule-status").textContent = "Could not read schedule status.";
      q(".schedule-save").disabled = true; render();
    }
  }
  field("kind").addEventListener("change", syncKind);
  field("repeat").addEventListener("change", () => { if (field("repeat").value !== "custom") field("cron").value = field("repeat").value; });
  field("cron").addEventListener("input", () => { field("repeat").value = "custom"; });
  form.addEventListener("submit", event => {
    event.preventDefault(); if (busy || !available) return;
    const kind = field("kind").value;
    const spec = { kind, cron: field("cron").value.trim(), tz: field("tz").value.trim(), enabled: field("enabled").checked };
    if (kind === "spawn") {
      const [agent, repo, agentsRoot] = JSON.parse(field("agent").value || "[]"); Object.assign(spec, { agent, repo, agentsRoot, task: field("task").value });
      if (field("purpose").value.trim()) spec.purpose = field("purpose").value.trim();
      try { const wake = nestedWake.read(); if (wake) spec.wake = wake; }
      catch (e) { q(".schedule-form-error").textContent = e.message; return; }
      for (const name of ["runtime", "model", "backend"]) if (field(name).value) spec[name] = field(name).value;
      if (field("yolo").value) spec.yolo = field("yolo").value === "true";
    } else {
      spec.home = field("home").value;
      if (kind === "wake") spec.message = field("task").value;
    }
    void mutate(editing ? "update" : "add", field("id").value.trim(), spec);
  });
  q(".schedule-new").addEventListener("click", () => openForm());
  q(".schedule-refresh").addEventListener("click", refresh);
  q(".schedule-cancel").addEventListener("click", () => { form.hidden = true; q(".schedule-new").focus(); });
  const unsubscribe = onWorkspaceChange(() => {
    form.hidden = true; busy = false; available = false; schedules = []; agents = []; instances = []; editing = null;
    error(""); q(".schedule-operation-result").textContent = ""; q(".schedule-host-actions").replaceChildren(); render(); void refresh();
  });
  render(); void refresh();
  const timer = pollMs > 0 ? setInterval(refresh, pollMs) : null;
  return { refresh, dispose() { alive = false; ++request; unsubscribe(); if (timer) clearInterval(timer); el.replaceChildren(); } };
}
