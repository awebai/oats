/** The capability manifest's kernel contract, shared by every reader: workspace
 *  discovery (member capabilities, E_WORKSPACE_SCHEMA), package manifests
 *  (E_PACKAGE_MANIFEST), the resolver (payload values) and the kernel's own
 *  manifest loader. One rule set, so a manifest a workspace accepts is one the
 *  kernel can run.
 *
 *  Covers what the kernel enforces when it RUNS a capability, checked where the
 *  manifest is READ instead: the launch environment a capability may declare
 *  (names, namespaces), its hooks (approved events, declaration shape, `required`
 *  only on spawn, the script inside the capability), and a provider payload's
 *  value against the manifest's `settings.<key>.values`. Dependency-free. */

export const APPROVED_HOOKS = new Set(["soul-scaffold", "spawn", "retire", "launch"]);
export const PORTABLE_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const CAPABILITY_ENV_ID_RE = /^[a-z][a-z0-9]*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export const CORE_LAUNCH_ENV = new Set(["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME"]);
export const PROCESS_BOOTSTRAP_ENV = new Set([
  "PATH", "HOME", "SHELL", "TMPDIR", "TMP", "TEMP", "PWD", "OLDPWD", "SHLVL", "_",
  "ENV", "BASH_ENV", "BASHOPTS", "SHELLOPTS", "CDPATH", "IFS", "PROMPT_COMMAND", "PS4", "ZDOTDIR",
  "NODE_OPTIONS", "NODE_PATH", "_JAVA_OPTIONS", "GCONV_PATH", "GLIBC_TUNABLES", "ELECTRON_RUN_AS_NODE",
]);
export const PROCESS_BOOTSTRAP_PREFIXES = [
  "NODE_", "LD_", "DYLD_", "PYTHON", "PERL", "RUBY", "JAVA_", "JDK_JAVA_",
  "DOTNET_", "COMPlus_", "COREHOST_", "LUA_", "PHP_", "ELECTRON_", "GLIBC_",
];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const pointerKey = (k) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");

/** A hook's script, the first word of its command: relative to the capability root and inside it. */
export function hookScriptEscapes(command) {
  const script = String(command).trim().split(/\s+/)[0] || "";
  return script.startsWith("/") || script.startsWith("~") || /^[A-Za-z]:[\\/]/.test(script) || script.split(/[\\/]/).includes("..");
}

/** Every contract problem of one manifest → [{ pointer, message }] (empty when it is sound).
 *  Messages name the capability; `pointer` is the JSON pointer inside oats.json. */
export function manifestContractProblems(m) {
  const problems = [];
  const id = m?.capability;
  const bad = (pointer, message) => problems.push({ pointer, message: `capability ${id} ${message}` });

  if (m.environmentNamespaces !== undefined && (!Array.isArray(m.environmentNamespaces) || m.environmentNamespaces.some((ns) => typeof ns !== "string"))) {
    bad("/environmentNamespaces", "manifest environmentNamespaces must be an array of prefixes");
  }
  if (m.environment !== undefined) {
    if (!Array.isArray(m.environment) || m.environment.some((name) => typeof name !== "string")) {
      bad("/environment", "manifest environment must be an array of exact variable names");
    } else if (new Set(m.environment).size !== m.environment.length) {
      bad("/environment", "manifest environment contains duplicate names");
    } else if (m.environment.length) {
      const vendor = CAPABILITY_ENV_ID_RE.test(id) ? id.match(/^([a-z][a-z0-9]*)\./)?.[1] : undefined;
      if (!vendor) bad("/capability", "must use a lowercase dotted ID (vendor.name) without package or path syntax to declare launch environment");
      else {
        const extra = Array.isArray(m.environmentNamespaces) ? m.environmentNamespaces.filter((ns) => typeof ns === "string") : [];
        extra.forEach((ns, i) => {
          if (!/^[A-Z][A-Z0-9]*_$/.test(ns)) bad(`/environmentNamespaces/${i}`, `manifest environmentNamespaces entry ${JSON.stringify(ns)} must be an uppercase prefix ending in an underscore`);
          else if (ns === "OATS_" || ns === "PI_AGENT_" || PROCESS_BOOTSTRAP_PREFIXES.some((reserved) => ns.startsWith(reserved) || reserved.startsWith(ns))) bad(`/environmentNamespaces/${i}`, `manifest environmentNamespaces entry ${ns} is a reserved namespace`);
        });
        const allowed = [`${vendor.toUpperCase()}_`, ...extra];
        m.environment.forEach((name, i) => {
          const at = `/environment/${i}`;
          if (!PORTABLE_ENV_NAME_RE.test(name)) bad(at, `manifest environment name ${JSON.stringify(name)} is invalid`);
          else if (CORE_LAUNCH_ENV.has(name) || name.startsWith("OATS_") || name.startsWith("PI_AGENT_")) bad(at, `manifest environment name ${name} collides with a reserved core variable`);
          else if (PROCESS_BOOTSTRAP_ENV.has(name) || PROCESS_BOOTSTRAP_PREFIXES.some((reserved) => name.startsWith(reserved))) bad(at, `manifest environment name ${name} collides with a reserved process bootstrap variable`);
          else if (!allowed.some((ns) => name.startsWith(ns))) bad(at, `manifest environment name ${name} is outside its ${allowed.join(", ")} namespace${allowed.length > 1 ? "s" : ""} (declare another in environmentNamespaces)`);
        });
      }
    }
  }

  if (m.hooks !== undefined && !isObject(m.hooks)) bad("/hooks", "manifest hooks must be an object of event → command");
  const hooks = isObject(m.hooks) ? Object.entries(m.hooks) : [];
  // A hook's launch environment is claimed under the capability's dotted vendor
  // component; an undotted id has none, so its hooks cannot run.
  if (hooks.length && !/^[a-z][a-z0-9]*\./.test(String(id))) bad("/hooks", "declares hooks but its id has no dotted lowercase vendor component (e.g. acme.tool); only a dotted id can carry hooks");
  for (const [event, value] of hooks) {
    const at = `/hooks/${pointerKey(event)}`;
    if (!APPROVED_HOOKS.has(event)) { bad(at, `declares unsupported hook "${event}" (${[...APPROVED_HOOKS].join(", ")})`); continue; }
    const extraKeys = isObject(value) ? Object.keys(value).filter((k) => !["command", "required", "inputs"].includes(k)) : [];
    const command = typeof value === "string" ? value : isObject(value) && typeof value.command === "string" ? value.command : undefined;
    if (command === undefined || !command.trim() || extraKeys.length) { bad(at, `hook "${event}" must be a command string or { command, required, inputs }${extraKeys.length ? ` (unknown: ${extraKeys.join(", ")})` : ""}`); continue; }
    if (isObject(value) && value.required !== undefined && typeof value.required !== "boolean") bad(`${at}/required`, `hook "${event}": "required" must be a boolean`);
    // Only a spawn hook can fail a spawn; marking others required would promise
    // an enforcement that has no defined moment to act.
    else if (isObject(value) && value.required === true && event !== "spawn") bad(`${at}/required`, `hook "${event}" cannot be required — only the spawn hook is enforced (retire, launch and soul-scaffold run outside a spawn transaction)`);
    if (hookScriptEscapes(command)) bad(isObject(value) ? `${at}/command` : at, `hook "${event}" script ${JSON.stringify(command.trim().split(/\s+/)[0])} escapes the capability directory; a hook script is a path inside it`);
  }
  return problems;
}

/** Top-level payload keys whose value is outside the manifest's `settings.<key>.values`
 *  → [{ key, value, values }]. A conditional `requires` row reads these values, so a
 *  misspelled one would silently skip every row instead of failing. */
export function settingValueProblems(manifest, payload) {
  const out = [];
  if (!isObject(manifest?.settings) || !isObject(payload)) return out;
  for (const [key, decl] of Object.entries(manifest.settings)) {
    if (!isObject(decl) || !Array.isArray(decl.values) || !Object.hasOwn(payload, key) || payload[key] === undefined) continue;
    if (!decl.values.some((v) => String(v) === String(payload[key]))) out.push({ key, value: payload[key], values: decl.values });
  }
  return out;
}
