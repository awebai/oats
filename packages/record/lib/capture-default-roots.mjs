// Private, serializable caller selection. Constructing this plan performs no
// filesystem work. Only an admitted discovery worker resolves default roots;
// the caller need not widen the child's inherited environment to convey them.
import { isAbsolute } from "node:path";
import { SESSION_FORMATS } from "./formats.mjs";
import { defaultCommLogDir } from "./capture-aw.mjs";

const formats = ["cc", "pi", "codex", "aw"];
const locations = ["CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "CODEX_HOME"];
const absolute = value => typeof value === "string" && isAbsolute(value) && !value.includes("\0");

export function captureDefaultRootPlan({ home, cwd, env = {}, sources = formats } = {}) {
  if (!absolute(home) || !absolute(cwd) || !env || typeof env !== "object" || Array.isArray(env) ||
      !Array.isArray(sources) || sources.some(source => !formats.includes(source)) || new Set(sources).size !== sources.length)
    throw new Error("invalid capture default-root selection");
  const selected = {};
  for (const key of locations) if (env[key] !== undefined) {
    if (typeof env[key] !== "string" || env[key].includes("\0")) throw new Error("invalid capture root environment");
    selected[key] = env[key];
  }
  return { kind: "default-roots", home, cwd, env: selected, sources: formats.filter(source => sources.includes(source)) };
}

export function resolveCaptureDefaultRoots(plan, source) {
  if (!plan.sources.includes(source)) throw new Error("capture default-root source is not selected");
  // Keep the public selectors' configured/optional absence, tilde, relative
  // path and profile ordering contracts. In particular AW does not use XDG.
  return source === "aw" ? [defaultCommLogDir(plan.home)] :
    SESSION_FORMATS[source].defaultRoots(plan.home, plan.env, { cwd: plan.cwd });
}
