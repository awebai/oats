#!/usr/bin/env node
/**
 * oats-core: the oats.core capability's lifecycle hook (spawn and launch).
 *
 * For a Claude Code instance it manages oats.core's own entries in the
 * instance's project settings, <home>/.claude/settings.json: Claude Code hooks
 * that report, through `oats instance waiting set|clear --producer oats.core`,
 * when the session waits on a permission prompt or a question for the human.
 * Every entry runs claude-waiting.sh (beside this file), which never affects
 * the Claude session: it exits 0, writes nothing to stdout and bounds the CLI.
 *
 * Why the project settings file and not `--settings`: Claude Code honours only
 * the LAST `--settings` flag on a command line (the last file replaces earlier
 * ones wholesale), while the project `.claude/settings.json` composes with the
 * user's settings and with a `--settings`. So oats.core owns its entries in
 * that file, marked by the absolute path of its claude-waiting.sh, and leaves
 * every other key and entry alone (docs/capabilities.md, oats.core).
 *
 * Hook contract (docs/capabilities.md, Commands and hooks): run with cwd = the
 * home and OATS_EVENT, OATS_INSTANCE_HOME, OATS_HARNESS, OATS_CLI_BIN and, for a
 * launch preview, OATS_LAUNCH_PREVIEW=1. The manifest declares `launchPreview:
 * true`: a preview writes nothing, and every pass answers the same contribution
 * (`{}`, never launch args or env), apart from a warning. The hooks are
 * advisory (string form): this script never throws and always exits 0 with a
 * JSON last line.
 *
 * The spawn hook writes the file for `oats spawn` (which runs no launch hook);
 * the launch hook rewrites it at every `oats session start|restart`, so the
 * baked node and CLI paths follow the kernel the home now runs with.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WAITING_SCRIPT = "claude-waiting.sh";
/** Claude Code's per-hook timeout, in seconds. The script bounds the CLI at ~3 s. */
export const HOOK_TIMEOUT_SECONDS = 5;
/** Claude Code's matcher for every tool. */
const ALL_TOOLS = "*";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** POSIX single-quoting: every path in a command goes through this. */
export function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** One hook command: the script through /bin/sh (its executable bit is never relied on),
 *  stdout and stderr detached, and `exit 0` whatever happens. Stdin (Claude's JSON input)
 *  reaches the script, which reads it only for a tool clear, bounded. `marker` is the
 *  debounce marker's path ('' for none). */
export function waitingCommand({ script, node, cli, marker = "" }, args) {
  return `/bin/sh ${shq(script)} ${args.join(" ")} ${shq(node)} ${shq(cli)} ${shq(marker || "")} >/dev/null 2>&1; exit 0`;
}

/** Where the emitter's per-user debounce directory goes: `$XDG_RUNTIME_DIR/oats-waiting`
 *  when that is set and absolute, else `$TMPDIR/oats-waiting-<uid>` when TMPDIR is
 *  absolute, else `/tmp/oats-waiting-<uid>`. A relative value never resolves against the
 *  hook's cwd. */
export function markerDirPath(env, uid) {
  const xdg = env.XDG_RUNTIME_DIR, tmp = env.TMPDIR;
  if (typeof xdg === "string" && isAbsolute(xdg)) return join(xdg, "oats-waiting");
  return join(typeof tmp === "string" && isAbsolute(tmp) ? tmp : "/tmp", `oats-waiting-${uid}`);
}

/** The emitter's debounce directory (markerDirPath), vetted here, at spawn and
 *  launch, so the hot path (claude-waiting.sh, on every tool call) needs no `ls` or hash:
 *  created 0700 when missing, and used only when it is a real directory (not a symlink)
 *  owned by this user, mode exactly 0700, with no ACL. Returns the directory, or null for
 *  "no debounce". An existing directory is never changed. */
export function markerDir(env = process.env) {
  if (typeof process.getuid !== "function") return null;
  const uid = process.getuid();
  const dir = markerDirPath(env, uid);
  try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== "EEXIST") return null; }
  let st;
  try { st = lstatSync(dir); } catch { return null; }
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || (st.mode & 0o7777) !== 0o700) return null;
  return hasAcl(dir) ? null : dir;
}

/** Whether `ls` shows an ACL on a directory (true when it cannot tell). "+" marks an ACL
 *  and "." an SELinux context; macOS shows "@" (xattrs) INSTEAD of "+" when both are
 *  present, so an "@" directory counts as ACL-free only when `ls -lde` lists no entry. */
function hasAcl(dir) {
  try {
    const mode = execFileSync("ls", ["-ld", dir], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(" ")[0];
    if (mode === "drwx------" || mode === "drwx------.") return false;
    if (mode === "drwx------@") return execFileSync("ls", ["-lde", dir], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").length !== 1;
    return true;
  } catch { return true; }
}

/** A home's marker in a vetted directory: the first 16 hex of sha256(home). */
export const markerPath = (home, dir) => join(dir, `${createHash("sha256").update(home).digest("hex").slice(0, 16)}.claude`);

/** A new session starts with no claim (the kernel's session boundary voids them), so the
 *  marker state an earlier session left (intent, applied, a lock) is forgotten. */
export function resetMarker(marker) {
  for (const f of [marker, `${marker}.applied`, `${marker}.force`, join(`${marker}.lock`, "pid")]) { try { unlinkSync(f); } catch { /* absent */ } }
  for (const d of [`${marker}.lock`, `${marker}.lock.reap`]) { try { rmdirSync(d); } catch { /* absent */ } }
}

/** oats.core's Claude Code settings: only `hooks`, keyed by Claude Code event. */
export function claudeWaitingSettings({ script, node, cli, marker = "" }) {
  const entry = (...args) => ({ type: "command", command: waitingCommand({ script, node, cli, marker }, args), timeout: HOOK_TIMEOUT_SECONDS });
  const group = (matcher, ...args) => ({ ...(matcher === undefined ? {} : { matcher }), hooks: [entry(...args)] });
  return {
    hooks: {
      Notification: [group("permission_prompt", "set", "permission"), group("elicitation_dialog", "set", "question")],
      // Tool clears are `clear-tool`: skipped when a subagent made the call.
      PreToolUse: [group("AskUserQuestion", "set", "question"), group("^(?!AskUserQuestion$).*", "clear-tool")],
      PostToolUse: [group(ALL_TOOLS, "clear-tool")],
      // A granted tool that failed: no PostToolUse follows it. (A tool the human refused at
      // the prompt fires no hook at all in Claude Code 2.1.288; the next prompt clears.)
      PostToolUseFailure: [group(ALL_TOOLS, "clear-tool")],
      UserPromptSubmit: [group(undefined, "clear")],
      Stop: [group(undefined, "clear")],
      SessionEnd: [group(undefined, "clear")],
    },
  };
}

/** Whether a hook entry is oats.core's: its command names our script by absolute path. */
function isOurs(hook, scriptPath) {
  return isObject(hook) && typeof hook.command === "string" && (hook.command.includes(scriptPath) || hook.command.includes(shq(scriptPath)));
}

/** Merge oats.core's settings into a parsed settings document, by marker: remove only
 *  the hook entries whose command names `scriptPath`, drop the matcher groups and
 *  event arrays that this removal empties, then append ours. Every other key, group
 *  and entry stays, in order. Returns { ok: true, settings } or { ok: false, problem }
 *  when the document is not one this merge may touch. */
export function mergeSettings(existing, ours, scriptPath) {
  if (!isObject(existing)) return { ok: false, problem: "is not a JSON object" };
  if (existing.hooks !== undefined && !isObject(existing.hooks)) return { ok: false, problem: "has a `hooks` value that is not an object" };
  const hooks = {};
  for (const [event, groups] of Object.entries(existing.hooks || {})) {
    if (!Array.isArray(groups)) return { ok: false, problem: `has a \`hooks.${event}\` value that is not an array` };
    const kept = [];
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) { kept.push(group); continue; }
      const entries = group.hooks.filter((hook) => !isOurs(hook, scriptPath));
      if (entries.length === group.hooks.length) kept.push(group);
      else if (entries.length) kept.push({ ...group, hooks: entries });
    }
    if (kept.length || !groups.length) hooks[event] = kept;
  }
  for (const [event, groups] of Object.entries(ours.hooks)) hooks[event] = [...(hooks[event] || []), ...groups];
  return { ok: true, settings: { ...existing, hooks } };
}

export const serialize = (settings) => `${JSON.stringify(settings, null, 2)}\n`;

/** The temp file of an atomic write: `.settings.json.oats-core-<pid>-<ms>.tmp`. */
const TMP_RE = /^\.settings\.json\.oats-core-(\d+)-\d+\.tmp$/;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/** Remove what an interrupted write left in `.claude`: our temp files whose writer is gone
 *  (a live writer's is left alone). Only names of our own pattern; unlink never follows a
 *  symlink. Best effort: a failure is not a warning. */
function removeStaleTemps(claudeDir) {
  let names;
  try { names = readdirSync(claudeDir); } catch { return; }
  for (const name of names) {
    const m = TMP_RE.exec(name);
    if (!m || alive(Number(m[1]))) continue;
    try { unlinkSync(join(claudeDir, name)); } catch { /* gone, or not ours to remove */ }
  }
}

/** The real pass: bring <home>/.claude/settings.json to the merged state. Returns a warning or null. */
export function writeClaudeSettings({ home, script, node, cli, marker = "" }) {
  const lose = "this Claude session will not report when it waits for input";
  const claudeDir = join(home, ".claude");
  const file = join(claudeDir, "settings.json");
  let dirStat;
  try { dirStat = lstatSync(claudeDir); } catch (e) { if (e.code !== "ENOENT") return `oats.core: cannot read ${claudeDir} (${e.code || e.message}); ${lose}`; }
  if (!dirStat) {
    try { mkdirSync(claudeDir, { mode: 0o755 }); } catch (e) { return `oats.core: cannot create ${claudeDir} (${e.code || e.message}); ${lose}`; }
  } else if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    return `oats.core: ${claudeDir} is not a directory (a symlink or a file); left it alone, so ${lose}`;
  }
  removeStaleTemps(claudeDir);
  let existing = {};
  let before = null;
  let fileStat;
  try { fileStat = lstatSync(file); } catch (e) { if (e.code !== "ENOENT") return `oats.core: cannot read ${file} (${e.code || e.message}); ${lose}`; }
  if (fileStat) {
    if (!fileStat.isFile()) return `oats.core: ${file} is not a regular file (a symlink or another kind); left it alone, so ${lose}`;
    let text;
    try { text = readFileSync(file, "utf8"); } catch (e) { return `oats.core: cannot read ${file} (${e.code || e.message}); ${lose}`; }
    try { existing = JSON.parse(text); } catch { return `oats.core: ${file} is not valid JSON; left it alone, so ${lose}`; }
    before = existing;
  }
  const merged = mergeSettings(existing, claudeWaitingSettings({ script, node, cli, marker }), script);
  if (!merged.ok) return `oats.core: ${file} ${merged.problem}; left it alone, so ${lose}`;
  const content = serialize(merged.settings);
  if (before !== null && content === serialize(before)) return null;
  const tmp = join(claudeDir, `.settings.json.oats-core-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* not created */ }
    return `oats.core: cannot write ${file} (${e.code || e.message}); ${lose}`;
  }
  return null;
}

/** The hook's answer for one event, given its environment. Never throws. */
export function runHook(event, env = process.env) {
  if (event !== "spawn" && event !== "launch") return {};
  if (env.OATS_HARNESS !== "claude") return {};
  if (env.OATS_LAUNCH_PREVIEW === "1") return {};
  const home = env.OATS_INSTANCE_HOME;
  if (typeof home !== "string" || !isAbsolute(home)) return { warning: "oats.core: OATS_INSTANCE_HOME is not an absolute path; the Claude Code waiting hooks were not written" };
  const cli = env.OATS_CLI_BIN;
  if (typeof cli !== "string" || !isAbsolute(cli)) return { warning: "oats.core: OATS_CLI_BIN is not an absolute path; the Claude Code waiting hooks were not written" };
  let script;
  try { script = realpathSync(join(dirname(realpathSync(fileURLToPath(import.meta.url))), WAITING_SCRIPT)); } catch (e) {
    return { warning: `oats.core: ${WAITING_SCRIPT} is missing from the module copy (${e.code || e.message}); the Claude Code waiting hooks were not written` };
  }
  const dir = markerDir(env);
  const marker = dir ? markerPath(home, dir) : "";
  if (marker) resetMarker(marker);
  const warning = writeClaudeSettings({ home, script, node: process.execPath, cli, marker });
  return warning ? { warning } : {};
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let answer;
  try { answer = runHook(process.argv[2]); } catch (e) { answer = { warning: `oats.core: ${process.argv[2]} hook failed: ${String(e?.message || e).slice(0, 200)}` }; }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
  process.exitCode = 0;
}
