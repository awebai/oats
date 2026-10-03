import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fail } from "./errors.mjs";
import { isSlug } from "./args.mjs";

// Who is invoking: an instance (the kernel resolved OATS_INSTANCE and
// OATS_INSTANCE_HOME) or the operator from a deployment directory. Inputs come
// only from these variables, OATS_SETTINGS and OATS_CLI_BIN, never from other
// ambient state.

export const DEFAULT_BRIEF_MAX = 49152;

export function readSettings(env = process.env) {
  let settings;
  try { settings = JSON.parse(env.OATS_SETTINGS || "{}"); }
  catch { fail("E_CLONE_CONTEXT", "OATS_SETTINGS is not JSON"); }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) fail("E_CLONE_CONTEXT", "OATS_SETTINGS is not an object");
  const cloner = settings.cloner;
  if (cloner !== undefined && (typeof cloner !== "string" || !/^(?:[a-z0-9][a-z0-9._-]*\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cloner))) fail("E_CLONE_CONTEXT", "settings.cloner must name a soul (<package>/<soul> or <soul>)");
  let max = settings["brief-max-bytes"];
  if (max === undefined) max = DEFAULT_BRIEF_MAX;
  if (typeof max === "string" && /^\d+$/.test(max)) max = Number(max);
  if (!Number.isInteger(max) || max < 1024 || max > 1024 * 1024) fail("E_CLONE_CONTEXT", "settings.brief-max-bytes must be an integer between 1024 and 1048576");
  return { cloner: cloner ?? null, briefMaxBytes: max };
}

/** A home is recognisable as an instance home: it holds instance.json and sits
 *  in <agents>/<soul>/instances/<name>. */
function enclosingHome(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, "instance.json")) && basename(dirname(d)) === "instances") return d;
    if (dirname(d) === d) return null;
  }
}

/** { kind: "instance" | "operator", problem? } without throwing, so each
 *  command picks its own refusal code. */
export function detectInvocation(env = process.env, cwd = process.cwd()) {
  const home = env.OATS_INSTANCE_HOME, name = env.OATS_INSTANCE;
  if (home !== undefined || name !== undefined) {
    if (!home || !name) return { kind: "instance", problem: "OATS_INSTANCE and OATS_INSTANCE_HOME must both be set" };
    if (!isAbsolute(home)) return { kind: "instance", problem: "OATS_INSTANCE_HOME must be absolute" };
    if (!isSlug(name)) return { kind: "instance", problem: "OATS_INSTANCE is not an instance name" };
    let meta, real;
    try { real = realpathSync(home); meta = JSON.parse(readFileSync(join(real, "instance.json"), "utf8")); }
    catch { return { kind: "instance", problem: `no readable instance.json in ${home}` }; }
    if (meta?.instance !== name) return { kind: "instance", problem: `${home} is not the home of ${name}` };
    return { kind: "instance", instance: name, home: real, meta };
  }
  for (const legacy of ["PI_AGENT_HOME", "OATS_HOME", "PI_AGENT_INSTANCE"]) {
    if (env[legacy]) return { kind: "instance", problem: `${legacy} is set without OATS_INSTANCE_HOME` };
  }
  const enclosing = enclosingHome(cwd);
  if (enclosing) return { kind: "instance", problem: `run from inside instance home ${enclosing} without OATS_INSTANCE_HOME` };
  return { kind: "operator", instance: null, home: null, meta: null };
}

/** The cloner's own home: dossier and spawn run only there. */
export function requireInstance(env = process.env, cwd = process.cwd()) {
  const inv = detectInvocation(env, cwd);
  if (inv.kind !== "instance") fail("E_CLONE_CONTEXT", "this command runs inside an instance home (the cloner's), through `oats cloning …`");
  if (inv.problem) fail("E_CLONE_CONTEXT", inv.problem);
  return inv;
}
