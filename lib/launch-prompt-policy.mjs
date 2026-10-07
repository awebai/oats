/** Host-local launch consent. Never merge this policy with recipes or provider settings. */
import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { oatsError } from "./errors.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const pointer = (value) => value.replace(/~/g, "~0").replace(/\//g, "~1");
const root = "/launchPromptAnswers";

/** Validate, rather than silently normalize, an exact home. Missing suffixes are
 * allowed for preview; dangling symlinks and inaccessible ancestors fail closed. */
export function canonicalLaunchPromptHome(home) {
  if (typeof home !== "string" || !isAbsolute(home) || home.includes("\0") || /[*?\[\]{}]/u.test(home) || resolve(home) !== home) {
    throw new Error("use an absolute canonical instance-home path without wildcards, dot segments or a trailing separator");
  }
  let ancestor = home;
  const suffix = [];
  while (true) {
    try {
      lstatSync(ancestor);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
  if (!statSync(ancestor).isDirectory()) throw new Error("the instance home and its existing ancestor must be directories");
  const canonical = join(realpathSync(ancestor), ...suffix);
  if (canonical !== home) throw new Error(`use the canonical instance-home path ${JSON.stringify(canonical)} instead of a symlink alias`);
  return canonical;
}

/** Complete policy validation, also usable without loading a workspace. */
export function launchPromptPolicyProblems(policy) {
  const problems = [];
  const issue = (path, message, reason) => problems.push({ path, message, ...(reason ? { reason } : {}) });
  if (!object(policy)) return [{ path: root, message: "must be an object" }];
  for (const key of Object.keys(policy)) if (key !== "homes") issue(`${root}/${pointer(key)}`, "unknown property");
  if (!Object.hasOwn(policy, "homes")) return problems;
  if (!object(policy.homes)) { issue(`${root}/homes`, "must be an object"); return problems; }
  for (const [home, consent] of Object.entries(policy.homes)) {
    const path = `${root}/homes/${pointer(home)}`;
    try { canonicalLaunchPromptHome(home); } catch (error) { issue(path, error.message, "noncanonical-home"); }
    if (!object(consent)) { issue(path, "must be an object"); continue; }
    for (const [key, value] of Object.entries(consent)) {
      if (key === "workspaceTrust") issue(`${path}/${key}`, "workspaceTrust is not supported: remove this key and handle folder trust with the harness; folder-trust automation is tracked separately in oats#712. awebDevelopmentChannel authorizes only the aweb development-channel confirmation", "unsupported-launch-prompt");
      else if (key !== "awebDevelopmentChannel") issue(`${path}/${pointer(key)}`, "unknown property");
      else if (typeof value !== "boolean") issue(`${path}/${key}`, "must be a boolean");
    }
  }
  return problems;
}

/** Exact-home consent + config JSON-pointer provenance for previews/controllers.
 * Call again after home creation; the controller must separately retain and
 * recheck directory identity before each input. No captured policy is authority. */
export function effectiveLaunchPromptPolicy(local, home, source) {
  const disabled = { awebDevelopmentChannel: false, consentSource: null };
  if (!object(local) || !Object.hasOwn(local, "launchPromptAnswers")) return disabled;
  const problems = launchPromptPolicyProblems(local.launchPromptAnswers);
  if (problems.length) throw oatsError("E_WORKSPACE_SCHEMA", `invalid launchPromptAnswers: ${problems.map((p) => `${p.path}: ${p.message}`).join("; ")}`, { problems });
  try { canonicalLaunchPromptHome(home); } catch { return disabled; }
  const homes = local.launchPromptAnswers.homes;
  if (!homes || !Object.hasOwn(homes, home)) return disabled;
  const consent = homes[home];
  return {
    awebDevelopmentChannel: consent.awebDevelopmentChannel === true,
    consentSource: typeof source === "string" && source.length ? `${source}#${root}/homes/${pointer(home)}` : null,
  };
}
