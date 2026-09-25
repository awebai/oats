// Explicit observer-time fallback only; managed capture uses native-history.
// Resolve only transcript-location inputs. Never execute recorded launch
// commands or disclose unrelated environment values (which may be secrets).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const LOCATION_ENV = ["HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "CODEX_HOME"];

export function sourceSessionEnvironment(home, base = process.env) {
  const env = { ...base };
  let meta;
  try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); }
  catch (err) {
    if (err.code !== "ENOENT") throw new Error(`cannot resolve source transcript roots from instance.json (${err.code || "invalid JSON"})`);
  }
  const recipe = meta?.launch;
  if (recipe !== undefined) {
    // Version 1 (a 0.26.0 home) names the harness `runtime`; version 2 `harness`.
    const harness = recipe?.version === 2 ? recipe.harness : recipe?.version === 1 ? recipe.runtime : undefined;
    if (!recipe || !["claude", "pi", "codex"].includes(harness)) {
      throw new Error("cannot resolve source transcript roots: unsupported recorded launch recipe");
    }
    for (const layer of [recipe.hooks?.env, recipe.env]) {
      if (layer === undefined) continue;
      if (!layer || typeof layer !== "object" || Array.isArray(layer)) throw new Error("cannot resolve source transcript roots: invalid launch environment");
      for (const name of LOCATION_ENV) {
        if (!Object.hasOwn(layer, name)) continue;
        const value = layer[name];
        if (typeof value === "string") env[name] = value;
        else if (value && typeof value.fromEnv === "string" && typeof base[value.fromEnv] === "string") env[name] = base[value.fromEnv];
        else throw new Error(`cannot resolve source transcript roots: unresolved recorded ${name}`);
      }
    }
    // Pi also supports a direct session-directory override. Do not certify
    // default roots when native options direct evidence somewhere else.
    if (harness === "pi") {
      const args = recipe.args ?? [];
      if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) throw new Error("cannot resolve source transcript roots: invalid launch arguments");
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--session-dir" || args[i].startsWith("--session-dir=")) {
          const value = args[i] === "--session-dir" ? args[++i] : args[i].slice("--session-dir=".length);
          if (!value || value.startsWith("--")) throw new Error("cannot resolve source transcript roots: invalid --session-dir");
          env.PI_CODING_AGENT_SESSION_DIR = value;
        } else if (args[i] === "--session" || args[i].startsWith("--session=")) {
          throw new Error("cannot certify transcript roots for a recorded explicit --session; capture its source directory explicitly");
        }
      }
      if (/--session(?:-dir)?(?:[=\s]|$)/.test(recipe.hooks?.launch?.pi ?? "")) {
        throw new Error("cannot resolve source transcript roots from shell-form session options in launch hooks");
      }
    }
  } else if (typeof meta?.command === "string" && /(?:^|\s)(?:CLAUDE_CONFIG_DIR|PI_CODING_AGENT_(?:SESSION_)?DIR|CODEX_HOME|HOME)=|--session(?:-dir)?(?:[=\s]|$)/.test(meta.command)) {
    // Old command strings cannot safely be interpreted as environment maps.
    throw new Error("cannot resolve source transcript roots from a legacy launch command; a recorded launch environment is required");
  }
  const userHome = env.HOME ?? homedir();
  if (!userHome || !isAbsolute(userHome)) throw new Error("cannot resolve source transcript roots: HOME must be absolute");
  return { env, home: userHome };
}

export function nativeDirectory(value, { home = homedir(), cwd = process.cwd(), tilde = false } = {}) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("cannot resolve native transcript directory");
  if (value.startsWith("~")) {
    if (!tilde || !(value === "~" || value.startsWith("~/"))) throw new Error("cannot resolve unexpanded native transcript directory");
    value = join(home, value.slice(2));
  }
  return resolve(cwd, value);
}

/** Native execution-side locations, without existence filtering. Unlike a
 * background observer scan, Claude's native default is exactly ~/.claude,
 * not every .claude* profile found under an observer's HOME. */
export function nativeLaunchLocations(harness, { cwd, env = process.env, args = [] } = {}) {
  const home = env.HOME || homedir();
  if (!isAbsolute(home)) throw new Error("native launch HOME must be absolute");
  if (!Array.isArray(args) || args.some(a => typeof a !== "string")) throw new Error("invalid native launch arguments");
  if (harness === "claude") return [join(nativeDirectory(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), { home, cwd }), "projects")];
  if (harness === "codex") return [join(nativeDirectory(env.CODEX_HOME || join(home, ".codex"), { home, cwd }), "sessions")];
  if (harness !== "pi") throw new Error("unsupported native record harness");
  let sessionDir = env.PI_CODING_AGENT_SESSION_DIR;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--session" || arg.startsWith("--session=")) throw new Error("explicit Pi --session has no supported directory custody; capture explicit roots instead");
    if (arg === "--session-dir" || arg.startsWith("--session-dir=")) {
      sessionDir = arg === "--session-dir" ? args[++i] : arg.slice("--session-dir=".length);
      if (!sessionDir || sessionDir.startsWith("--")) throw new Error("invalid native --session-dir");
    }
  }
  return [sessionDir ? nativeDirectory(sessionDir, { home, cwd, tilde: true })
    : join(nativeDirectory(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), { home, cwd, tilde: true }), "sessions")];
}
