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
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
 *  every stream detached, and `exit 0` whatever happens. */
export function waitingCommand({ script, node, cli }, args) {
  return `/bin/sh ${shq(script)} ${args.join(" ")} ${shq(node)} ${shq(cli)} >/dev/null 2>&1 </dev/null; exit 0`;
}

/** oats.core's Claude Code settings: only `hooks`, keyed by Claude Code event. */
export function claudeWaitingSettings({ script, node, cli }) {
  const entry = (...args) => ({ type: "command", command: waitingCommand({ script, node, cli }, args), timeout: HOOK_TIMEOUT_SECONDS });
  const group = (matcher, ...args) => ({ ...(matcher === undefined ? {} : { matcher }), hooks: [entry(...args)] });
  return {
    hooks: {
      Notification: [group("permission_prompt", "set", "permission"), group("elicitation_dialog", "set", "question")],
      PreToolUse: [group("AskUserQuestion", "set", "question"), group("^(?!AskUserQuestion$).*", "clear")],
      PostToolUse: [group(ALL_TOOLS, "clear")],
      // A granted tool that failed: no PostToolUse follows it. (A tool the human refused at
      // the prompt fires no hook at all in Claude Code 2.1.288; the next prompt clears.)
      PostToolUseFailure: [group(ALL_TOOLS, "clear")],
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

/** The real pass: bring <home>/.claude/settings.json to the merged state. Returns a warning or null. */
export function writeClaudeSettings({ home, script, node, cli }) {
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
  const merged = mergeSettings(existing, claudeWaitingSettings({ script, node, cli }), script);
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
  const warning = writeClaudeSettings({ home, script, node: process.execPath, cli });
  return warning ? { warning } : {};
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let answer;
  try { answer = runHook(process.argv[2]); } catch (e) { answer = { warning: `oats.core: ${process.argv[2]} hook failed: ${String(e?.message || e).slice(0, 200)}` }; }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
  process.exitCode = 0;
}
