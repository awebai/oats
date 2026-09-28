/**
 * Soul launch preferences (0.30, feature `launch-preference`; docs/design/2026-09-28-soul-launch-preference.md,
 * docs/desktop-cli-api.md "Launch preferences"). PURE: no I/O. A soul may declare `launch: {harness, model?}`;
 * a machine overrides it in oats-local.yaml `souls.launch` (a soul key or "*" → a launch configuration's name
 * or an inline {harness, model?}). For a NEW selection the first layer with a value decides: the flags, then
 * souls.launch.<key>, souls.launch."*", the soul's launch, the host default. A home's recorded launch stays
 * frozen: a plain start/restart never re-reads these layers (only --reselect-launch or a respawn does).
 */
import { oatsError } from "./errors.mjs";

export const LOCAL_FILE = "oats-local.yaml";
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** A coded error whose details also sit on `details` (the CLI boundary renders them). */
function fail(code, message, details) { const e = oatsError(code, message, details); e.details = details; return e; }
const pointerKey = (k) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");

/** A preference value as `{harness, model}` (`model` null when absent); anything else → null. */
export function preferenceOf(v) {
  return isObject(v) && typeof v.harness === "string" ? { harness: v.harness, model: typeof v.model === "string" && v.model ? v.model : null } : null;
}

/** Where a soul's own `launch` lives: `<repoKey>:<path>/soul.yaml#/launch`, or `package:<id>:<path>/…` for a package soul. */
export function soulLaunchAt(entry) {
  const file = `${entry?.path ? `${entry.path}/` : ""}soul.yaml#/launch`;
  const pkg = typeof entry?.package === "string" ? entry.package : entry?.package?.id;
  return pkg ? `package:${pkg}:${file}` : `${entry?.repoKey ?? "?"}:${file}`;
}

/**
 * The layers a new selection reads, without flags: `declared` (the soul's own launch, or null) and `layer`
 * — the deciding one, `{ from: "local" | "local-default" | "soul", at, value }` (`value` a launch
 * configuration's name or `{harness, model}`) — or null (the host default).
 * `definition` is the soul.yaml content; `key` its soul key (soulKeyOf); `local` the oats-local.yaml value.
 */
export function launchLayers({ definition, entry, key, local }) {
  const declared = preferenceOf(definition?.launch);
  const byKey = isObject(local?.souls?.launch) ? local.souls.launch : {};
  const pick = (k, from) => {
    if (!Object.hasOwn(byKey, k)) return null;
    const v = byKey[k];
    return { from, at: `${LOCAL_FILE}#/souls/launch/${pointerKey(k)}`, value: typeof v === "string" ? v : preferenceOf(v) };
  };
  const layer = (key !== undefined && key !== "*" ? pick(key, "local") : null) ?? pick("*", "local-default")
    ?? (declared ? { from: "soul", at: soulLaunchAt(entry), value: declared } : null);
  return { declared, layer };
}

/**
 * The selection a NEW launch makes from the flags and the layers: `{ selection, preference, from, at }` for
 * resolveLaunchSelection. `--launch-config` or `--harness` decides (`from: "flag"`); otherwise the layer does
 * (a name selects that configuration; an inline or soul preference is `preference`), and `--model` alone
 * replaces only the model. No layer: the host default (`from: "host"`).
 */
export function selectionFrom({ flags = {}, layers }) {
  const selection = { launchConfig: flags.launchConfig, harness: flags.harness, model: flags.model };
  if (flags.launchConfig !== undefined || flags.harness !== undefined) return { selection, preference: null, from: "flag", at: null };
  const layer = layers?.layer;
  if (!layer) return { selection, preference: null, from: "host", at: null };
  if (typeof layer.value === "string") return { selection: { ...selection, launchConfig: layer.value }, preference: null, from: layer.from, at: layer.at };
  return { selection: { ...selection, launchConfig: "none" }, preference: { ...layer.value, from: layer.from }, from: layer.from, at: layer.at };
}

/** A launch configuration the layer names but this oats-local.yaml does not declare. */
export function launchConfigUnknown({ name, from, at }) {
  return fail("E_LAUNCH_CONFIG_UNKNOWN", `${at ?? "the launch preference"} names launch configuration ${JSON.stringify(name)}, which ${LOCAL_FILE} does not declare (launch-configs:); oats launch-config list shows what is`, { name, from, at });
}

/** The fix for a missing harness, by the layer that chose it. */
export function harnessFix(harness, from) {
  if (from === "flag") return `install ${harness}, or choose another --harness / --launch-config`;
  if (from === "local" || from === "local-default") return `install ${harness}, or change ${LOCAL_FILE} souls.launch`;
  return `install ${harness}, or override it on this machine in ${LOCAL_FILE} souls.launch`;
}
/** E_HARNESS_UNAVAILABLE: the chosen harness has no executable here. Never a fallback to another harness. */
export function harnessUnavailable({ harness, from, at, why }) {
  const source = from === "flag" ? "the spawn flags" : from === "host" ? "the host default" : at ?? from;
  const fix = harnessFix(harness, from);
  return fail("E_HARNESS_UNAVAILABLE", `${harness} is not installed on this machine (${why}); ${source} chose it — ${fix}`, { harness, from, at: at ?? null, fix });
}

/** The closed `Launch` report: `{declared, effective: {harness, model, launchConfig}, from, at, problem}`. */
export function launchReport({ declared = null, harness, model = null, launchConfig = null, from, at = null, problem = null }) {
  return { declared: declared ? { harness: declared.harness, model: declared.model ?? null } : null, effective: { harness, model: model || null, launchConfig: launchConfig || null }, from, at: at ?? null, problem };
}

/** `modelFrom` for a model a preference layer supplied. */
export const MODEL_SOURCE = { soul: "soul preference", local: "local preference", "local-default": "local-default preference" };
