import { apiJson, postJson, ensureTheme, workspaceGeneration, wsQuery } from "./common.mjs";
import { wakeScheduleFields } from "../wake-schedule-fields.mjs";
import { createScheduleObservationView, scheduleObservationCSS } from "../schedule-observation-view.mjs";
import { scheduleEditReason } from "../schedule-read-data.mjs";
import { cliCard, cliKnownUnavailable, onCliChange } from "./cli-status.mjs";

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

export function createSchedulesView(el, ctx, readOptions = {}) {
  const doc = el.ownerDocument;
  ensureTheme(doc);
  el.innerHTML = `<style>${CSS}${scheduleObservationCSS}</style><section class="oats-view schedules-view">
    <header><h2>Schedules</h2><button class="act primary schedule-new">New schedule</button><button class="act schedule-refresh">Refresh</button></header>
    <div class="schedule-cli" hidden></div>
    <p>Schedules run on this workspace’s server, including while the GUI is closed.</p>
    <div class="schedule-status" role="status"></div>
    <div class="schedule-host-actions"></div>
    <p class="schedule-operation-result" role="status"></p>
    <p class="schedule-error" role="alert"></p>
    <form class="schedule-form" hidden>
      <h3 class="schedule-form-title">New schedule</h3>
      <label>Name<input class="field" name="id" required pattern="[a-z0-9][a-z0-9-]{0,39}" placeholder="daily-review"></label>
      <label>Action<select class="field" name="kind"><option value="wake">Wake an existing agent</option><option value="spawn">Launch a new agent</option><option value="operation">Run a provider operation</option></select></label>
      <label class="schedule-agent-field">Soul<select class="field" name="agent"></select></label>
      <label class="schedule-home-field">Agent home<select class="field" name="home"></select></label>
      <label class="schedule-provider-field" hidden>Provider operation<select class="field" name="providerOperation"></select><span class="schedule-provider-note schedule-hint"></span></label>
      <label class="schedule-task-field"><span class="schedule-task-label">Wake message</span><textarea class="field" name="task" placeholder="What should the agent do each time?"></textarea></label>
      <div class="schedule-spawn-options">
        <label>Purpose (optional instance name prefix)<input class="field" name="purpose"></label>
        <div class="schedule-pair">
          <label>Harness<select class="field" name="runtime"><option value="">Soul default</option><option>pi</option><option>claude</option><option>codex</option></select></label>
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
  const card = cliCard(doc, ctx); q('.schedule-cli').append(card.el);
  const syncCard = () => { q('.schedule-cli').hidden = !cliKnownUnavailable(); };
  const offCard = onCliChange(syncCard); syncCard();
  const nestedWake = wakeScheduleFields(doc);
  q(".schedule-spawn-options").append(nestedWake.el);
  let alive = true, busy = false, available = false, editing = null, formReady = false;
  let agents = [], instances = [], original = null, baseline = {}, originalWake = null, definition = null, definitionRevision = null;
  const definitionKey = job => JSON.stringify(['id', 'scope', 'kind', 'captured', 'createdAt', 'updatedAt', 'agent', 'home', 'operation', 'cron', 'tz', 'enabled'].map(k => job?.[k]));
  let operationRequest = 0, formOperation = 0, mutationOperation = 0, observation;
  const ownsForm = (token, lease) => alive && token === formOperation && observation?.owns(lease);
  const preserve = (name, key = name) => original && original.kind === field("kind").value && Object.hasOwn(original, key) && field(name).value === baseline[name] ? original[key] : field(name).value;
  const button = (label, action, disabled = false) => {
    const b = doc.createElement("button"); b.className = "act"; b.type = "button";
    b.textContent = label; b.disabled = disabled; b.addEventListener("click", () => { if (alive && b.isConnected && !b.disabled && observation?.canMutate()) action(); }); return b;
  };
  const error = message => { q(".schedule-error").textContent = message; };
  const fill = (select, rows, label, value) => {
    select.replaceChildren();
    for (const row of rows) { const o = doc.createElement("option"); o.value = value(row); o.textContent = label(row); select.append(o); }
  };
  function syncKind(preferred) {
    const kind = field("kind").value;
    q(".schedule-agent-field").hidden = kind !== "spawn";
    q(".schedule-home-field").hidden = kind === "spawn";
    q(".schedule-spawn-options").hidden = kind !== "spawn";
    q(".schedule-task-field").hidden = kind === "operation";
    q(".schedule-task-label").textContent = kind === "wake" ? "Wake message" : "Task";
    field("task").required = kind !== "operation";
    field("agent").required = kind === "spawn";
    field("home").required = kind !== "spawn";
    q(".schedule-provider-field").hidden = kind !== "operation";
    field("providerOperation").required = kind === "operation";
    void loadOperations(typeof preferred === "string" ? preferred : undefined);
  }
  async function loadOperations(preferred = field("providerOperation").value) {
    const token = ++operationRequest, formToken = formOperation, lease = observation.lease();
    if (field("kind").value !== "operation") return;
    field("providerOperation").replaceChildren();
    q(".schedule-provider-note").textContent = "Loading operations for this home…";
    try {
      const inspection = await postJson(ctx, `/api/capabilities${wsQuery()}`, { action: "inspect", selector: { home: field("home").value } });
      if (token !== operationRequest || !ownsForm(formToken, lease) || form.hidden) return;
      const operations = (inspection.capabilities || []).filter(cap => cap.layer).flatMap(cap =>
        (cap.operations || []).filter(op => op.kind === "action" && op.available && !op.args?.some(arg => arg.required)).map(op => ({ address: `${cap.layer}:${op.name}`, label: `${cap.layer}: ${op.name} — ${op.description || cap.id}` })));
      fill(field("providerOperation"), operations, op => op.label, op => op.address);
      if (operations.some(op => op.address === preferred)) field("providerOperation").value = preferred;
      q(".schedule-provider-note").textContent = operations.length ? "Resolved through this home's active provider at each run." : "No available provider actions for this home.";
    } catch (error) {
      if (token === operationRequest && ownsForm(formToken, lease) && !form.hidden) q(".schedule-provider-note").textContent = error.message;
    }
  }
  field("home").addEventListener("change", () => void loadOperations());
  async function openForm(job, soul, observedDefinition = null) {
    if (!observation?.canMutate() || busy) return;
    const token = ++formOperation, lease = observation.lease(); ++operationRequest;
    editing = job?.id || null; original = job ? structuredClone(job) : null; definition = observedDefinition; definitionRevision = observation.revision(); formReady = false; form.reset();
    q(".schedule-form-error").textContent = "";
    q(".schedule-form-title").textContent = editing ? `Edit ${editing}` : "New schedule";
    field("agent").replaceChildren(); field("home").replaceChildren();
    field("id").disabled = !!editing; field("id").value = editing || "";
    field("tz").value = job?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    field("cron").value = job?.cron || "*/15 * * * *";
    field("repeat").value = [...field("repeat").options].some(o => o.value === field("cron").value) ? field("cron").value : "custom";
    field("enabled").checked = job?.enabled ?? true;
    field("kind").value = job?.kind || (soul ? "spawn" : "wake");
    // Target options are filled by the owned roster read below, never inferred
    // from a history/session provenance address.
    field("task").value = job?.message || job?.task || "";
    field("purpose").value = job?.purpose || "";
    nestedWake.set(job?.wake);
    for (const name of ["runtime", "model", "backend"]) field(name).value = job?.[name] || "";
    field("yolo").value = job?.yolo === undefined ? "" : String(job.yolo);
    baseline = Object.fromEntries([...form.elements].filter(f => f.name).map(f => [f.name, f.value]));
    originalWake = job?.wake ? { ...nestedWake.read() } : null;
    form.hidden = false; field(editing ? "cron" : "id").focus(); render();
    try {
      const suffix = wsQuery();
      const [roster, panel] = await Promise.all([apiJson(ctx, `/api/agents${suffix}`), apiJson(ctx, `/api/panel${suffix}`)]);
      if (!ownsForm(token, lease) || form.hidden) return;
      agents = roster.agents || []; instances = panel.instances || [];
      fill(field("agent"), agents.filter(a => a.work !== "attached"), a => `${a.name} · ${a.agentsRoot}`, a => JSON.stringify([a.name, a.repo || null, a.agentsRoot]));
      fill(field("home"), instances, i => `${i.instance} · ${i.home}`, i => i.home);
      if (job?.agent || soul) field("agent").value = JSON.stringify([job?.agent || soul.name, job?.repo || soul?.repo || null, job?.agentsRoot || soul?.agentsRoot]);
      if (job?.home) field("home").value = job.home;
      baseline.agent = field("agent").value; baseline.home = field("home").value;
      formReady = true; syncKind(job?.operation); render();
    } catch {
      if (ownsForm(token, lease)) { q(".schedule-form-error").textContent = "Could not read targets for this form. Reopen it to retry."; render(); }
    }
  }
  async function editJob(job) {
    if (!observation.canMutate() || busy) return;
    const token = ++formOperation, lease = observation.lease(); ++operationRequest;
    try {
      const shown = await observation.show(job.id);
      if (!ownsForm(token, lease) || !shown) return;
      if (!shown.draft) { error(scheduleEditReason(shown.schedules[0].editReason) || "This schedule cannot be edited here."); return; }
      await openForm(shown.draft, null, shown.schedules[0]);
    } catch (e) { if (ownsForm(token, lease)) error(e.message); }
  }
  async function mutate(operation, id, spec) {
    if (busy || !available || !observation.canMutate()) return;
    const lease = observation.lease(), op = ++mutationOperation, formToken = formOperation;
    const owns = () => alive && op === mutationOperation && observation.owns(lease);
    busy = true; observation.setBusy(true); error(""); q(".schedule-operation-result").textContent = ""; render();
    q(".schedule-save").disabled = true;
    try {
      const result = await postJson(ctx, `/api/schedules${wsQuery()}`, { operation, id, ...(spec ? { spec } : {}) });
      if (!owns()) return;
      if ((operation === "add" || operation === "update") && formToken === formOperation) form.hidden = true;
      if (operation === "run" && result.run) q(".schedule-operation-result").textContent = scheduleOutcome(result.run);
      if (operation === "reconcile") q(".schedule-operation-result").textContent = [result.reconciled === "unknown" ? "Run state is still unknown." : `Run state: ${result.reconciled || "checked"}.`, result.remedy].filter(Boolean).join(" ");
      await refresh();
    } catch (e) {
      if (owns()) {
        error(e.message); if (!form.hidden && formToken === formOperation) q(".schedule-form-error").textContent = e.message;
      }
    } finally {
      if (owns()) { busy = false; observation.setBusy(false); render(); }
    }
  }
  function render() {
    q(".schedule-new").disabled = busy || !available;
    q(".schedule-save").disabled = busy || !available || !formReady;
    for (const control of form.querySelectorAll("input, select, textarea")) control.disabled = busy || (control.name === "id" && !!editing)
      || (!formReady && ["agent", "home", "providerOperation"].includes(control.name));
    q(".schedule-host-actions").querySelectorAll("button").forEach(b => { b.disabled = busy || !available; });
  }
  async function refresh() {
    const lease = observation.lease(), generation = workspaceGeneration();
    await observation.refresh();
    if (!alive || !observation.owns(lease)) return;
    if (preselection && form.hidden && observation.canMutate()) {
      const selected = preselection; preselection = null;
      if (selected.generation === generation) void openForm(null, selected.soul);
    }
  }
  field("kind").addEventListener("change", syncKind);
  field("repeat").addEventListener("change", () => { if (field("repeat").value !== "custom") field("cron").value = field("repeat").value; });
  field("cron").addEventListener("input", () => { field("repeat").value = "custom"; });
  form.addEventListener("submit", event => {
    event.preventDefault(); if (busy || !available || !formReady || !observation.canMutate() || form.hidden) return;
    const kind = field("kind").value;
    const spec = { kind, cron: preserve("cron"), tz: preserve("tz"), enabled: field("enabled").checked };
    if (kind === "spawn") {
      const [agent, repo, agentsRoot] = JSON.parse(field("agent").value || "[]"); Object.assign(spec, { agent, repo, agentsRoot, task: preserve("task", "task") });
      if (field("purpose").value) spec.purpose = preserve("purpose");
      try {
        const wake = nestedWake.read();
        if (wake) spec.wake = Object.fromEntries(['cron', 'tz', 'message'].map(key => [key,
          original?.wake && original.kind === kind && wake[key] === originalWake?.[key] ? original.wake[key] : wake[key]]));
      } catch (e) { q(".schedule-form-error").textContent = e.message; return; }
      for (const name of ["runtime", "model", "backend"]) if (field(name).value || original && Object.hasOwn(original, name)) spec[name] = preserve(name);
      if (field("yolo").value) spec.yolo = field("yolo").value === "true";
    } else {
      spec.home = field("home").value;
      if (kind === "wake") spec.message = preserve("task", "message");
      if (kind === "operation") {
        if (!field("providerOperation").value) { q(".schedule-form-error").textContent = "Select an available provider operation"; return; }
        spec.operation = field("providerOperation").value;
      }
    }
    void mutate(editing ? "update" : "add", field("id").value.trim(), spec);
  });
  q(".schedule-new").addEventListener("click", () => openForm());
  q(".schedule-refresh").addEventListener("click", refresh);
  q(".schedule-cancel").addEventListener("click", () => { ++formOperation; ++operationRequest; form.hidden = true; if (observation.owns(observation.lease())) q(".schedule-new").focus(); });
  observation = createScheduleObservationView(q(".schedule-list"), ctx, { ...readOptions, onEdit: editJob, onMutate: mutate,
    onControls(state) {
      available = state.canMutate;
      if (!form.hidden && editing && definitionRevision !== state.revision) {
        definitionRevision = state.revision;
        const current = state.data?.schedules.find(s => s.id === editing);
        if (!definition?.createdAt || !definition?.updatedAt || !current || definitionKey(current) !== definitionKey(definition)) {
          ++formOperation; ++operationRequest; formReady = false;
          q('.schedule-form-error').textContent = 'Definition observation changed or cannot be matched. Draft retained; reopen Edit before saving.';
        }
      }
      const host = state.scheduler;
      q(".schedule-status").textContent = !host ? "Scheduler status not observed."
        : host.installed === false ? "Scheduler is not installed on this host. Saved schedules will not run until it is enabled."
        : host.registered === false ? "This workspace is not registered with the host scheduler. Enable it to run these schedules."
        : host.active === false ? "Scheduler is installed but inactive."
        : host.installed === true && host.active === true && host.registered === true ? `Scheduler enabled · Last check: ${when(host.lastTick)} · Up to ${host.maxConcurrent ?? "unknown"} scheduled agent(s) at once`
        : "Scheduler state is not fully reported.";
      const actions = q(".schedule-host-actions");
      if (host && (host.installed === false || host.active === false || host.registered === false)) {
        if (!actions.firstChild) actions.append(button("Enable host scheduler", () => mutate("host-install"), !available));
      } else actions.replaceChildren();
      render();
    },
    onInvalidate(clear) {
      ++formOperation; ++operationRequest; ++mutationOperation; busy = false; available = false;
      if (clear) { form.hidden = true; formReady = false; agents = []; instances = []; editing = null; original = null;
        error(""); q(".schedule-operation-result").textContent = ""; q(".schedule-host-actions").replaceChildren(); }
      render();
    },
  });
  render(); void refresh();
  return { refresh, dispose() { alive = false; ++formOperation; ++operationRequest; ++mutationOperation; observation.dispose(); offCard(); card.dispose(); el.replaceChildren(); } };
}
