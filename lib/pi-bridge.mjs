/** The pi bridge (`@awebai/oats-pi`) in every pi folder a launch of a deployment uses: which
 *  folders those are, the bridge found in each, and what `oats update` does there
 *  (awebai/oats#991, #852). `oats doctor` warns from the same list.
 *
 *  This module only reads: the environment it is given, the launch configurations it is given
 *  and each folder's bridge `package.json`. Nothing here runs `pi` or `npm`; `oats update`
 *  (bin/oats.mjs) runs the steps the plan names.
 *
 *  A pi folder of the deployment is the default (`~/.pi/agent`), this process's own
 *  `PI_CODING_AGENT_DIR`, and the `PI_CODING_AGENT_DIR` of each launch configuration whose
 *  harness is pi: "the ambient one and each launch configuration's", as `trustTargets`
 *  (harness-trust-write.mjs) lists the claude and codex configuration files. Homes' recorded
 *  launches are not read: a home keeps a launch its configuration no longer has, and the list
 *  would then depend on every home.
 *
 *  The move is one `pi install` over the installed bridge, never an uninstall first: pi
 *  replaces the settings entry and the files of the same package, and an install that fails
 *  leaves the old ones in place (established with pi 1.0.2). The folder's version is read
 *  back after each step, so a pi that behaves otherwise is a named failure, not a silent one. */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

export const PI_BRIDGE = "@awebai/oats-pi";
/** The variable that moves pi's folder. */
export const PI_FOLDER_VAR = "PI_CODING_AGENT_DIR";

const real = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
const userHome = (env) => env.HOME || homedir();
/** A leading `~` is the user's home, as the kernel reads it for pi's resource folder (core.mjs). */
const expandHome = (p, env) => p.replace(/^~(?=$|\/)/, () => userHome(env));
/** One shell word: as is when it needs no quoting, else single-quoted. */
const shellWord = (value) => /^[A-Za-z0-9_\/.,:@%+=-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\"'\"'") + "'";
const bridgeSpec = (target) => `npm:${PI_BRIDGE}@${target}`;

/** The pi folder a launch configuration's `env` names: `{dir}` from a literal or a {fromEnv}
 *  resolved from the host `base`; `{problem}` when the reference is not set on this host or the
 *  path is not absolute; null when the configuration leaves it to the host. The rule and the
 *  wording of `launchConfigDir` (harness-trust.mjs), which is keyed by the harnesses that have
 *  folder trust and so cannot name pi. */
export function launchConfigPiFolder(configEnv = {}, base = process.env) {
  if (!Object.hasOwn(configEnv || {}, PI_FOLDER_VAR)) return null;
  const v = configEnv[PI_FOLDER_VAR];
  const named = typeof v === "string" ? v : base[v?.fromEnv];
  if (named === undefined) return { problem: `${PI_FOLDER_VAR} references ${v?.fromEnv}, not set on this host`, fromEnv: v?.fromEnv };
  const dir = expandHome(named, base);
  return isAbsolute(dir) ? { dir } : { problem: `${PI_FOLDER_VAR} ${JSON.stringify(named)} is not an absolute path` };
}

/** The pi folders of a deployment, in a fixed order: the default, this process's own, then each
 *  pi launch configuration's in name order. Folders are deduplicated by real path; one keeps
 *  every reason it is listed for, and the path it was first named by. A folder that cannot be
 *  resolved is listed with its `problem` and no `dir`, never dropped.
 *  → [{ dir, real, reasons: [{ kind: "default" | "shell" | "launch-config", name?, executable? }], problem? }] */
export function piFolders({ env = process.env, launchConfigs = {} } = {}) {
  const folders = [], byReal = new Map();
  const add = (dir, reason) => {
    const key = real(dir);
    if (byReal.has(key)) { byReal.get(key).reasons.push(reason); return; }
    const folder = { dir, real: key, reasons: [reason] };
    byReal.set(key, folder);
    folders.push(folder);
  };
  const unresolved = (reason, found) => folders.push({ dir: null, real: null, reasons: [reason], problem: found.problem, ...(found.fromEnv ? { fromEnv: found.fromEnv } : {}) });
  add(join(userHome(env), ".pi", "agent"), { kind: "default" });
  // An empty value is not set, as core.mjs reads it (piAgentDir).
  if (env[PI_FOLDER_VAR]) {
    const found = launchConfigPiFolder({ [PI_FOLDER_VAR]: env[PI_FOLDER_VAR] }, env);
    if (found.problem) unresolved({ kind: "shell" }, found); else add(found.dir, { kind: "shell" });
  }
  for (const config of Object.values(launchConfigs).filter((c) => c.harness === "pi").sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const found = launchConfigPiFolder(config.env, env);
    if (!found) continue;
    // A relative executable is a path against the deployment directory, as a launch resolves it.
    const executable = config.executable?.includes("/") && !isAbsolute(config.executable) && config.source ? resolve(config.source, config.executable) : config.executable;
    const reason = { kind: "launch-config", name: config.name, ...(executable !== undefined ? { executable } : {}) };
    if (found.problem) unresolved(reason, found); else add(found.dir, reason);
  }
  return folders;
}

/** Why a folder is looked at: "the default", "this shell's PI_CODING_AGENT_DIR", "launch configurations a, b". */
export function whyLookedAt(folder) {
  const configs = folder.reasons.filter((r) => r.kind === "launch-config").map((r) => r.name);
  return [
    ...(folder.reasons.some((r) => r.kind === "default") ? ["the default"] : []),
    ...(folder.reasons.some((r) => r.kind === "shell") ? [`this shell's ${PI_FOLDER_VAR}`] : []),
    ...(configs.length ? [`launch configuration${configs.length > 1 ? "s" : ""} ${configs.join(", ")}`] : []),
  ].join(", ");
}

/** The bridge in a pi folder, read where pi installs it:
 *  → { status: "no-folder" | "no-bridge" | "installed" | "unreadable", file, version?, problem? } */
export function piBridgeState(dir) {
  const file = join(dir, "npm", "node_modules", ...PI_BRIDGE.split("/"), "package.json");
  if (!existsSync(dir)) return { status: "no-folder", file };
  if (!existsSync(file)) return { status: "no-bridge", file };
  let version;
  try { version = JSON.parse(readFileSync(file, "utf8")).version; } catch { return { status: "unreadable", file, problem: `${file} cannot be read as JSON` }; }
  if (typeof version !== "string" || !version) return { status: "unreadable", file, problem: `${file} names no version` };
  return { status: "installed", file, version };
}

/** `piFolders`, each resolved one with the `bridge` found in it. */
export function piBridgeFolders(options) {
  return piFolders(options).map((folder) => folder.dir ? { ...folder, bridge: piBridgeState(folder.dir) } : folder);
}

/** `oats doctor`'s warnings: one per folder whose bridge is not the kernel's version, and one per
 *  folder that could not be looked at. A folder that does not exist or holds no bridge is not a skew. */
export function piBridgeSkewWarnings(folders, kernelVersion) {
  const warnings = [];
  for (const folder of folders) {
    const why = whyLookedAt(folder);
    if (folder.problem) warnings.push(`pi bridge not checked — ${why}: ${folder.problem}, so its pi folder could not be looked at; \`oats update\` says what to run there`);
    else if (folder.bridge.status === "unreadable") warnings.push(`pi bridge not checked in ${folder.dir} (${why}) — ${folder.bridge.problem}; \`oats update\` says what to run there`);
    else if (folder.bridge.status === "installed" && folder.bridge.version !== kernelVersion) warnings.push(`version skew — kernel ${kernelVersion}, pi bridge ${folder.bridge.version} in ${folder.dir} (${why}); run \`oats update\` (they publish in lockstep)`);
  }
  return warnings;
}

/** What `oats update` does in each folder to bring its bridge to `target`:
 *  - `move`: the bridge is at another version; `step` is the one command, as arguments.
 *  - `leave`: already at `target`.
 *  - `none`: no folder, or no bridge in it. `oats update` installs no first bridge.
 *  - `skip`: not touched, with the `detail` and, where there is one, the `command` to run there:
 *    a folder that does not resolve, a bridge that cannot be read, or a folder named only by
 *    launch configurations that run their own executable (update never runs a wrapper).
 *  The step runs the plain `pi` on PATH with PI_CODING_AGENT_DIR set to the folder, except for
 *  the default folder when `env` sets none, and with pi's npm told to revalidate its cache.
 *  `detail` is the plan's line for the folder: what was found there, then what happens.
 *  → the folders, each with { action, detail, command?, step?: { argv, env, display } } */
export function planPiBridges(folders, target, { env = process.env } = {}) {
  return folders.map((folder) => {
    const wrapped = folder.reasons.every((r) => r.kind === "launch-config" && r.executable !== undefined);
    const program = wrapped ? folder.reasons[0].executable : "pi";
    const install = (folderWord) => `${PI_FOLDER_VAR}=${folderWord} ${shellWord(program)} install ${bridgeSpec(target)}`;
    if (folder.problem) {
      return { ...folder, action: "skip", detail: `not touched: ${folder.problem}`, ...(folder.fromEnv ? { command: install(`"$${folder.fromEnv}"`), commandWhere: `where ${folder.fromEnv} is set` } : {}) };
    }
    const { bridge } = folder;
    if (bridge.status === "no-folder") return { ...folder, action: "none", detail: "no bridge (the folder does not exist): not touched" };
    if (bridge.status === "no-bridge") return { ...folder, action: "none", detail: "no bridge: not touched" };
    if (bridge.status === "unreadable") return { ...folder, action: "skip", detail: `bridge not read: not touched: ${bridge.problem}`, command: install(shellWord(folder.dir)) };
    if (bridge.version === target) return { ...folder, action: "leave", detail: `bridge ${bridge.version}: left alone, already at ${target}` };
    if (wrapped) {
      const names = folder.reasons.map((r) => r.name);
      return { ...folder, action: "skip", detail: `bridge ${bridge.version}: not touched: launch configuration${names.length > 1 ? "s" : ""} ${names.join(", ")} run${names.length > 1 ? " their" : "s its"} own executable, and \`oats update\` runs no wrapper`, command: install(shellWord(folder.dir)) };
    }
    const setsFolder = !(folder.reasons.some((r) => r.kind === "default") && !env[PI_FOLDER_VAR]);
    const stepEnv = { ...(setsFolder ? { [PI_FOLDER_VAR]: folder.dir } : {}), npm_config_prefer_online: "true" };
    const argv = ["pi", "install", bridgeSpec(target)];
    const display = [...Object.entries(stepEnv).map(([name, value]) => `${name}=${shellWord(value)}`), ...argv.map(shellWord)].join(" ");
    return { ...folder, action: "move", detail: `bridge ${bridge.version}: move to ${target}`, step: { argv, env: stepEnv, display } };
  });
}

/** The plan's lines, two or three per folder: the folder and why it is looked at, what happens
 *  there, and the command to run where update does not. */
export function piBridgePlanLines(plan) {
  const lines = [];
  for (const entry of plan) {
    lines.push(`  ${entry.dir ?? "(not resolved)"}  (${whyLookedAt(entry)})`);
    lines.push(`    ${entry.detail}`);
    if (entry.command) lines.push(`    run there${entry.commandWhere ? `, ${entry.commandWhere}` : ""}: ${entry.command}`);
  }
  return lines;
}

/** Why a bridge step did not do its work, or null when the folder is now at `target`: the run's
 *  own failure (`problem`), or a run that ended well with another version in the folder. */
export function piBridgeStepProblem(entry, target, problem) {
  if (problem) return problem;
  const now = piBridgeState(entry.dir);
  return now.status === "installed" && now.version === target ? null : `pi ended without an error, but the bridge there is not ${target}`;
}

/** The message of a step that failed: the folder and the exact step to run again, what the
 *  folder holds now (read from it, not assumed), and the folders not reached. `entry` is the
 *  folder of the failed step, absent when the step was not a folder's (the CLI's own). */
export function piBridgeFailure({ entry, display, problem, notReached = [] }) {
  const lines = [];
  if (entry) {
    const now = piBridgeState(entry.dir), before = entry.bridge.version;
    const holds = now.status === "installed" ? (now.version === before ? `the bridge there is still ${before}` : `the bridge there is now ${now.version}`)
      : now.status === "unreadable" ? `the bridge there cannot be read (${now.problem})`
      : "the bridge is now ABSENT there: a pi session started with this folder has no OATS extension until the step succeeds";
    lines.push(`step failed in ${entry.dir} (${whyLookedAt(entry)}): ${problem}`, `  ${holds}`, `  run it again: ${display}`);
  } else lines.push(`step failed: ${display}: ${problem}`, "  no pi folder was touched");
  if (notReached.length) lines.push(`  not reached (run \`oats update\` again for ${notReached.length > 1 ? "them" : "it"}):`, ...notReached.map((e) => `    ${e.dir}  (${whyLookedAt(e)})`));
  return lines.join("\n");
}
