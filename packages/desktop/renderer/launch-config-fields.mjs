import { postJson, currentWorkspace, workspaceGeneration } from "./views/common.mjs";

/** Shared launch configuration selector/editor. The kernel resolves every preview. */
export function launchConfigFields(el, { ctx, selector, choices, owns = () => true, changed = () => {} }) {
  const doc = el.ownerDocument, ws = currentWorkspace(), generation = workspaceGeneration();
  let listRequest = 0, previewRequest = 0, disposed = false, busy = false, disabled = false, loading = false, reload = false, configurations = [], context;
  const current = () => !disposed && owns() && ws === currentWorkspace() && generation === workspaceGeneration();
  const api = body => postJson(ctx, `/api/launch-configs?ws=${encodeURIComponent(ws)}`, body);
  el.classList.add("launch-config-fields");
  el.innerHTML = `<label>Launch configuration<select class="field launch-config-select"><option value="">Keep defaults</option></select></label>
    <p class="launch-config-source"></p>
    <button type="button" class="act launch-preview">Preview invocation</button>
    <pre class="launch-preview-output" hidden></pre>
    <details class="launch-config-editor"><summary>Manage launch configurations</summary>
      <p class="launch-config-scope"></p>
      <p>Save a reusable configuration for this scope. Select it explicitly to apply it to an existing instance.</p>
      <label>Name<input class="field lc-name" autocomplete="off" placeholder="codex-personal"></label>
      <label>Harness<select class="field lc-runtime"><option>codex</option><option>claude</option><option>pi</option></select></label>
      <label>Executable or wrapper<input class="field lc-executable" autocomplete="off" placeholder="Use the harness on PATH"></label>
      <label>Arguments (JSON array)<textarea class="field lc-args" rows="3" spellcheck="false">[]</textarea></label>
      <label>Environment (JSON object)<textarea class="field lc-env" rows="3" spellcheck="false">{}</textarea></label>
      <label class="lc-keep-env-label" hidden><span><input type="checkbox" class="lc-keep-env"> Preserve the saved environment</span></label>
      <p>Use native configuration flags or environment variables. Reference credentials with {"fromEnv":"VARIABLE_NAME"}; they must exist on the execution host.</p>
      <label>Default model<input class="field lc-model" autocomplete="off" placeholder="Harness default"></label>
      <label>Permissions<select class="field lc-yolo"><option value="">Use defaults</option><option value="true">YOLO — skip permission prompts</option><option value="false">Use native permission policy</option></select></label>
      <div class="start-buttons"><button class="act lc-new" type="button">New</button><button class="act lc-save" type="button">Save configuration</button><button class="act lc-remove" type="button" disabled>Remove from this scope</button></div>
    </details><p class="launch-config-status" role="status" aria-live="polite"></p>`;
  const select = el.querySelector(".launch-config-select"), status = el.querySelector(".launch-config-status");
  const output = el.querySelector(".launch-preview-output"), editor = el.querySelector(".launch-config-editor");
  editor.addEventListener("keydown", event => {
    // These fields edit a configuration inside a start/spawn dialog. Enter
    // must not submit the enclosing launch form while editing a definition.
    if (event.key === "Enter" && event.target.tagName === "INPUT") event.preventDefault();
  });
  const field = name => el.querySelector(`.lc-${name}`);
  const selected = () => configurations.find(c => c.name === select.value);
  const invalidate = () => { previewRequest++; output.hidden = true; output.textContent = ""; };
  const removable = () => selected()?.source === context && !!context && field("name").value.trim() === selected()?.name;
  const updateControls = () => {
    for (const control of el.querySelectorAll("input,select,textarea,button")) control.disabled = disabled || busy;
    field("remove").disabled ||= !removable();
    field("env").disabled ||= field("keep-env").checked;
  };
  const fillEditor = row => {
    const def = row?.definition || row || {};
    field("name").value = row?.name || "";
    field("runtime").value = def.runtime || "codex";
    field("executable").value = def.executable || "";
    field("args").value = JSON.stringify(def.args || [], null, 2);
    field("env").value = JSON.stringify(def.env || {}, null, 2);
    const redacted = Object.values(def.env || {}).some(v => v?.redacted === true);
    field("keep-env-label").hidden = !redacted;
    field("keep-env").checked = redacted;
    field("keep-env").disabled = false;
    field("env").disabled = field("keep-env").checked;
    field("model").value = def.model || "";
    field("yolo").value = def.yolo == null ? "" : String(def.yolo);
    updateControls();
  };
  const selectionChanged = (notify = true) => {
    invalidate(); const row = selected();
    el.querySelector(".launch-config-source").textContent = row ? `${row.runtime} · ${row.source || "Selected scope"}` : "Use the recorded launch for this home, or the soul defaults for a new instance.";
    fillEditor(row); if (notify) changed(row);
  };
  select.addEventListener("change", () => selectionChanged());
  field("name").addEventListener("input", updateControls);
  field("keep-env").addEventListener("change", () => {
    field("env").disabled = field("keep-env").checked;
    if (!field("keep-env").checked) field("env").value = "{}";
  });
  const load = async (prefer = select.value) => {
    const id = ++listRequest; loading = true; reload = false; status.textContent = "Loading launch configurations…";
    try {
      const data = await api({ action: "list", selector: selector() });
      if (!current() || id !== listRequest) return;
      const previous = selected();
      configurations = data.configurations || []; context = data.context || data.scope?.context;
      select.replaceChildren();
      const option = doc.createElement("option"); option.value = ""; option.textContent = "Keep recorded / soul defaults"; select.append(option);
      for (const row of configurations) { const option = doc.createElement("option"); option.value = row.name; option.textContent = `${row.name} (${row.runtime})`; select.append(option); }
      select.value = configurations.some(c => c.name === prefer) ? prefer : "";
      editor.hidden = !context;
      el.querySelector(".launch-config-scope").textContent = context ? `Configuration scope: ${context}` : "";
      status.textContent = configurations.length ? "" : "No named configurations in this scope yet.";
      selectionChanged(!!previous || !!selected());
    } catch (e) { if (current() && id === listRequest) status.textContent = e.message; }
    finally { if (id === listRequest) loading = false; }
  };
  el.querySelector(".launch-preview").addEventListener("click", async () => {
    const id = ++previewRequest; status.textContent = "Checking invocation…";
    try {
      const preview = await api({ action: "preview", selector: selector(), choices: { ...choices(), ...(select.value ? { launchConfig: select.value } : {}) } });
      if (!current() || id !== previewRequest) return;
      const checks = Array.isArray(preview.preflight) ? preview.preflight : [];
      const command = typeof preview.command === "string" ? preview.command : JSON.stringify(preview, null, 2);
      output.textContent = [command, ...checks.map(c => `${c.ok === false ? "Needs attention" : "Check"}: ${c.check || "launch"}${c.detail ? ` — ${c.detail}` : ""}`)].join("\n");
      output.hidden = false;
      status.textContent = preview.ok === false || checks.some(c => c.ok === false)
        ? "This launch is not ready. Resolve the failed checks above. No agent was started or stopped."
        : "Preview only. No agent was started or stopped.";
    } catch (e) { if (current() && id === previewRequest) { output.hidden = true; status.textContent = e.message; } }
  });
  field("new").addEventListener("click", () => { fillEditor(); field("name").focus(); });
  const save = async action => {
    if (!current() || busy || disabled || !context || (action === "remove" && !removable())) return;
    const name = field("name").value.trim(); let definition;
    try {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw Error("Enter a configuration name using letters, numbers, dots, underscores or hyphens.");
      if (action === "set") {
        const keepEnv = field("keep-env").checked;
        if (keepEnv && name !== selected()?.name) throw Error("To save under a new name, enter the complete environment instead of preserving another configuration’s environment.");
        const args = JSON.parse(field("args").value), env = keepEnv ? undefined : JSON.parse(field("env").value);
        if (!Array.isArray(args) || args.some(a => typeof a !== "string")) throw Error("Arguments must be a JSON array of strings.");
        if (!keepEnv && (!env || typeof env !== "object" || Array.isArray(env))) throw Error("Environment must be a JSON object.");
        if (env && Object.values(env).some(v => v?.redacted === true)) throw Error("Replace redacted values with complete environment references, or preserve the saved environment.");
        definition = { runtime: field("runtime").value, args, ...(env ? { env } : {}) };
        for (const key of ["executable", "model"]) if (field(key).value.trim()) definition[key] = field(key).value.trim();
        if (field("yolo").value !== "") definition.yolo = field("yolo").value === "true";
      }
      busy = true; invalidate(); updateControls();
      status.textContent = action === "set" ? "Saving…" : "Removing configuration…";
      await api({ action, selector: { context }, name, ...(definition ? { definition, keepEnv: field("keep-env").checked } : {}) });
      if (current()) await load(action === "set" ? name : "");
    } catch (e) { if (current()) status.textContent = e.message; }
    finally { busy = false; if (current()) updateControls(); }
  };
  field("save").addEventListener("click", () => void save("set"));
  field("remove").addEventListener("click", () => void save("remove"));
  return { load, invalidate, busy: () => busy, value: () => select.value || undefined, dispose: () => { disposed = true; listRequest++; previewRequest++; }, disabled(value) {
    disabled = value;
    if (value) { invalidate(); if (loading) { listRequest++; loading = false; reload = true; } }
    updateControls();
    if (!value && reload) void load();
  } };
}
