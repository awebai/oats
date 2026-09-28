#!/usr/bin/env node
/**
 * oats-aweb — OATS messaging-provider hooks for aweb.
 *
 * Invoked by the OATS kernel at instance lifecycle events (hook contract):
 *   oats-aweb spawn    mint a team-scoped aweb identity for the instance
 *   oats-aweb retire   gracefully self-delete it (BEFORE the home dir is removed)
 *   oats-aweb roster   list the aweb team's members — the cross-machine directory
 *                     of live instances (alias = instance name) and humans
 *   oats-aweb setup    guided onboarding: check the aw CLI, initialize the
 *                     messaging root with aw init / aw team join, verify team
 *
 * Env contract (set by the kernel):
 *   OATS_EVENT     spawn|retire
 *   OATS_INSTANCE  instance name (used as the aweb alias)
 *   OATS_HOME      instance home dir (cwd is also set to it)
 *   OATS_CONTEXT   resolution context dir (the soul's repo / agents root parent)
 *   OATS_WORKSPACE the agents root's parent — the team boundary
 *   OATS_SETTINGS  JSON of the provider's `settings:` block
 *   OATS_DEFAULT_TEAM/OATS_DEFAULT_TEAM_ID/OATS_DEFAULT_TEAM_FROM default team facts
 *   OATS_TEAMS     JSON rows {label, team, default, from} for mapped eligible teams
 *   OATS_META      JSON persisted from this hook's previous spawn output (retire only)
 *
 * Output (spawn, stdout JSON):
 *   { "meta": {...persisted to instance.json + OATS_META at retire},
 *     "brief": "one-line TASK.md briefing line", "warning": "non-fatal problem" }
 *
 * EXIT CODE IS THE CONTRACT for the spawn hook. This capability declares
 * `spawn` as required (oats.json), so a nonzero exit fails the spawn and rolls it
 * back. Messaging is the whole point of the capability: an instance whose
 * identity was never minted believes it can be woken by mail and cannot, which
 * is worse than not starting. So identity failures exit nonzero, while genuinely
 * advisory problems (the Claude channel plugin, a team-name mismatch) stay
 * warnings on exit 0.
 *
 * On a fatal path, ALWAYS emit any metadata gathered so far before exiting: the
 * kernel feeds it to the retire hook to compensate partial state, and an
 * identity joined moments before the failure must still be deletable.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join, dirname, resolve, delimiter, isAbsolute, relative } from "node:path";
import { loadCapturedAwebExecution, requireCapturedAwebAction } from "../lib/captured-execution.mjs";
import { assessCapturedSessionReadiness, querySelectedKernel } from "../lib/session-readiness.mjs";
import { runCapturedNative } from "../lib/captured-native.mjs";
import { AW_MIN, grantYamlCustodySocket, parseBindingJson } from "../lib/binding-wire.mjs";
import { custodyPreflight } from "../lib/grant-custody.mjs";
import { runtimeDeliveryFor, wakeRegistration } from "../lib/wake-receive.mjs";

/** Run a command as ARGV — never a shell string. Team ids, aliases, instance
 * names and invite tokens all flow through here; quoting them correctly is a
 * property of one helper staying correct forever, while argv removes the class.
 * This hook is a REQUIRED spawn hook, so it gates every spawn, which is reason
 * enough not to rely on quoting. */
const run = (argv, cwd, timeout = 45000, { secrets = [], secretSafe = false, env: extraEnv, unsetEnv = [], input } = {}) => {
  try {
    // An inherited AWEB_IDENTITY_HOME (every aweb instance session carries its
    // own) is never this hook's identity: aw would act as the CALLER — refusing
    // cwd-rooted commands such as team invite/list, or deleting the caller's
    // workspace when a lead retires a worker. Only an explicit env sets one.
    const childEnv = { ...process.env, ...(extraEnv || {}) };
    if (!extraEnv || !Object.hasOwn(extraEnv, "AWEB_IDENTITY_HOME")) delete childEnv.AWEB_IDENTITY_HOME;
    for (const name of unsetEnv) delete childEnv[name];
    return execFileSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], ...(input === undefined ? {} : { input }), timeout, env: childEnv }).trim();
  } catch (e) {
    // execFileSync puts the WHOLE ARGV in e.message ("Command failed: aw team
    // join <token> …"). This hook's failures are reported by the kernel and land
    // in CLI/Desktop logs, so a failed join disclosed a still-valid team invite
    // token to anyone reading them (reviewer-aggregate2). Rebuild the error from
    // the command name and the status — never the argv.
    //
    // secretSafe drops the child's OUTPUT as well. Scrubbing known strings is not
    // enough for a command that MINTS a secret: `aw team invite` can print a
    // freshly-created token to stderr while failing, and at that point the caller
    // has no value to scrub because the token is exactly what it never received
    // (reviewer-1a6e82e). For those commands, status plus fixed context is all
    // the diagnosis anyone gets.
    const scrub = (t) => secrets.filter(Boolean).reduce((acc, sec) => acc.split(sec).join("<redacted>"), String(t ?? ""));
    const where = [argv[0], argv[1], argv[2]].filter((a) => a && !secrets.includes(a) && !a.startsWith("-")).join(" ");
    const why = secretSafe ? "" : (scrub(e.stderr).trim() || (e.status === undefined ? String(e.code || "failed") : ""));
    const err = new Error(`${where} failed${e.status === undefined ? "" : ` (exit ${e.status})`}${why ? `: ${why}` : ""}${secretSafe ? " (output withheld: this command handles credentials)" : ""}`);
    err.status = e.status;
    err.stdout = scrub(e.stdout).trim();
    err.stderr = scrub(e.stderr).trim();
    // A classification, never the text: the caller may name a KNOWN failure
    // class (an alias that still holds a certificate) without any output of a
    // credential-handling command reaching a log.
    err.aliasConflict = /already|exists|conflict|422|active certificate/i.test(String(e.stderr ?? "") + String(e.stdout ?? ""));
    throw err;
  }
};
/** JSON.parse whose failure never quotes the input. Node includes an excerpt of
 * the malformed text in a SyntaxError, which for these commands IS the credential
 * (reviewer-1a6e82e). */
const parseSecretJson = (text, what) => {
  try { return JSON.parse(text); }
  catch { throw new Error(`${what} returned output that is not valid JSON (withheld: this command handles credentials)`); }
};
/** Is a command on PATH? Resolved in-process rather than by running
 * `command -v`, which is a SHELL BUILTIN — spawning it as a program depends on
 * a /usr/bin/command binary that many systems do not ship, and its absence
 * would read as "aw is missing" on every such host. */
/** The installed aw version from `aw version`, or undefined when it cannot be read. */
function awVersionTriple() {
  try { return /aw\s+v?(\d+)\.(\d+)\.(\d+)/.exec(run(["aw", "version"], undefined, 10000)); } catch { return undefined; }
}
function semverAtLeast(version, floor) {
  const a = version.split(".").map(Number), b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return true;
}
function awVersionLabel() {
  const v = awVersionTriple();
  return v ? v.slice(1, 4).join(".") : undefined;
}

function onPath(cmd) {
  for (const dir of String(process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    try { const st = statSync(join(dir, cmd)); if (st.isFile() && (st.mode & 0o111)) return true; } catch { /* keep looking */ }
  }
  return false;
}
// Kernel home operations (`oats operation run messaging:teams|join|leave`, run
// with OATS_OPERATION and --json) read stdout as EXACTLY ONE JSON-v1 envelope
// whose `ok` agrees with the exit status (oats bin/oats.mjs finishOperation):
// {schemaVersion:1, ok:true, result} with exit 0, or {schemaVersion:1, ok:false,
// error:{code, message}} with a nonzero exit. Under OATS_OPERATION every other
// stdout write goes to stderr and every way out answers one envelope. Without
// it (`oats aweb teams --json` from a shell) the bare document is unchanged.
const OPERATION_COMMANDS = ["teams", "join", "leave"];
const operation = process.env.OATS_OPERATION && OPERATION_COMMANDS.includes(process.env.OATS_EVENT || process.argv[2]) ? process.env.OATS_OPERATION : undefined;
let operationAnswered = false;
let lastStderr = "";
const operationEnvelopeFailure = (code, message, details) => ({ schemaVersion: 1, ok: false, error: { code: code || "E_OPERATION_FAILED", message: String(message || "failed").slice(0, 1000), ...(details ? { details } : {}) } });
function answerOperation(envelope, exitCode) {
  operationAnswered = true;
  writeSync(1, JSON.stringify(envelope) + "\n");
  process.exit(exitCode);
}
const operationOk = (result) => answerOperation({ schemaVersion: 1, ok: true, result }, 0);
const operationFail = (code, message, details) => answerOperation(operationEnvelopeFailure(code, message, details), 1);
if (operation) {
  const toStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { if (String(chunk).trim()) lastStderr = String(chunk).trim(); return toStderr(chunk, ...rest); };
  process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);
  // Any exit that did not answer (a refusal printed to stderr, an uncaught
  // error) still answers one failure envelope, and never exits 0.
  process.on("exit", (code) => {
    if (operationAnswered) return;
    operationAnswered = true;
    writeSync(1, JSON.stringify(operationEnvelopeFailure("E_OPERATION_FAILED", lastStderr || `oats-aweb ${operation} exited ${code} without an answer`)) + "\n");
    if (!code) process.exitCode = 1;
  });
}
const out = (o, code = 0) => {
  if (operation) operationFail("E_OPERATION_FAILED", String(o?.warning || o?.problems?.[0]?.message || "failed").replace(/^oats-aweb: /, ""));
  process.stdout.write(JSON.stringify(o) + "\n");
  process.exit(code);
};
const warn = (m) => out({ warning: `oats-aweb: ${String(m).slice(0, 300)}` });
/** Fatal for a REQUIRED spawn hook: emit metadata for compensation, then exit
 * nonzero so the kernel rolls the spawn back. `meta` carries whatever external
 * state already exists (e.g. a joined identity) so retire can undo it. */
const fatal = (m, meta) => out({ ...(meta ? { meta } : {}), warning: `oats-aweb: ${String(m).slice(0, 300)}` }, 1);
const parseAwJson = (text, what) => {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error(`${what} returned no JSON result`);
  try { return JSON.parse(trimmed); } catch { /* may have progress before JSON */ }
  const lines = trimmed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith("{")) continue;
    try { return JSON.parse(lines.slice(i).join("\n")); } catch { /* keep looking */ }
  }
  throw new Error(`${what} returned no JSON result`);
};

// Any selected snapshot enters the captured consumer BEFORE legacy settings,
// root discovery or identity handling. Invalid-present never falls back.
try {
  const loaded = loadCapturedAwebExecution();
  if (loaded.kind === "captured") {
    const event = process.argv[2] || process.env.OATS_EVENT;
    if ((process.env.OATS_EVENT && process.env.OATS_EVENT !== event) || process.argv.slice(3).some(arg => arg !== "--json")) throw new Error("captured entrypoint arguments differ from the selected action");
    const manifest = JSON.parse(readFileSync(new URL("../oats.json", import.meta.url), "utf8"));
    const selected = requireCapturedAwebAction(loaded, event, manifest);
    const settings = parseBindingJson(Buffer.from(process.env.OATS_SETTINGS || "{}"));
    if (!settings || typeof settings !== "object" || Array.isArray(settings) || Object.keys(settings).some(k => !["delivery", "root", "roots"].includes(k))) throw new Error("captured settings support delivery/root readiness only; no identity copying or ambient fallback");
    const checked = assessCapturedSessionReadiness({ binding: selected.binding, invocation: selected.context, settings }, {
      query(args, options) { selected.assertCurrent(); const result = querySelectedKernel(args, options); selected.assertCurrent(); return result; },
    });
    if (checked.status !== "ready") out({ ...checked, warning: `oats-aweb: ${checked.problems[0].message}` }, 1);
    const result = runCapturedNative({ selected, event, settings, run });
    out(result.output, result.exitCode);
  }
} catch (error) {
  out({ status: "needs-configuration", problems: [{ code: "invalid-binding", message: "invalid or changed captured aweb execution input" }], warning: "oats-aweb: invalid or changed captured aweb execution input; no legacy fallback was used" }, 1);
}

const event = process.env.OATS_EVENT || process.argv[2];
const instance = process.env.OATS_INSTANCE;
let home = process.env.OATS_HOME || process.cwd();
const AWEB_ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const AWEB_ALIAS_RULE = "invalid alias: aweb aliases must be 1-64 characters, start with a letter or digit, and then contain only letters, digits, '-' or '_'";
const ALIAS_REUSE_REMEDY = "spawn with a different --name (kernels 0.26.0+) or a different --purpose";
const CLASSIC_REFUSAL = "oats.aweb 1.14 needs OATS 0.26.0 or newer (workspace model); on an older kernel pin oats.aweb v1.13.x";
const hasWorkspaceV2Facts = () => !!(process.env.OATS_WORKSPACE_KEY || process.env.OATS_WORKSPACE_NAME || process.env.OATS_DEFAULT_TEAM);
const isClassicEnvironment = () => !!process.env.OATS_TEAM_SCOPE && !hasWorkspaceV2Facts();
// Effective capability settings, injected by kernel dispatch (OATS_SETTINGS).
// delivery: "channel" (default) keeps the native channel packages waking the
// instance; "session" hands delivery to the host wake broker (aweb-abil):
// AWEB_DELIVERY=session goes into the launch environment, the Claude channel
// flag is omitted, and nothing wakes the instance until the broker exists.
let settings = {};
try { settings = JSON.parse(process.env.OATS_SETTINGS || "{}"); } catch { settings = {}; }
const TEAM_SETTING_MESSAGE = "teams are not a setting since oats.aweb 1.17 / OATS 0.30: use oats teams / oats soul teams";
const hasStaleTeamSetting = settings && typeof settings === "object" && !Array.isArray(settings) && Object.hasOwn(settings, "team");
if (hasStaleTeamSetting && ["spawn", "launch", "setup", "teams", "join", "leave", "roster"].includes(event)) fatal(TEAM_SETTING_MESSAGE);
const deliveryMode = (() => {
  const v = settings.delivery === undefined || settings.delivery === null || settings.delivery === "" ? "channel" : String(settings.delivery);
  return v === "session" ? "session" : "channel";
})();
const identitySettings = settings.identity && typeof settings.identity === "object" && !Array.isArray(settings.identity) ? settings.identity : {};
const identityMode = identitySettings.mode === undefined || identitySettings.mode === null || identitySettings.mode === "" ? "local" : String(identitySettings.mode);
if (isClassicEnvironment() && ["spawn", "setup"].includes(event)) {
  if (event === "setup") { console.error(CLASSIC_REFUSAL); process.exit(1); }
  fatal(CLASSIC_REFUSAL);
}
if (!["local", "global"].includes(identityMode) && ["spawn"].includes(event)) fatal(`identity.mode must be either "local" or "global" (got ${JSON.stringify(identitySettings.mode)})`);
if (event === "spawn" && identityMode === "local" && !identitySettings.source && (!instance || !AWEB_ALIAS_RE.test(instance))) fatal(`${AWEB_ALIAS_RULE}; OATS_INSTANCE is ${instance ? "not valid" : "missing"}, so no identity could be minted`);
const NO_TEAMS_MESSAGE = "no teams configured: run `oats aweb setup`";
const unmappedDefaultMessage = (label = defaultTeamLabel()) => `the default team ${label} has no provider id yet: its owner runs oats aweb setup, then commits the id, or choose another default with oats teams default`;
const defaultTeamLabel = () => typeof process.env.OATS_DEFAULT_TEAM === "string" && process.env.OATS_DEFAULT_TEAM.trim() ? process.env.OATS_DEFAULT_TEAM.trim() : undefined;
const defaultTeamId = () => typeof process.env.OATS_DEFAULT_TEAM_ID === "string" && process.env.OATS_DEFAULT_TEAM_ID.trim() ? process.env.OATS_DEFAULT_TEAM_ID.trim() : undefined;
const defaultTeamFromEnv = () => process.env.OATS_DEFAULT_TEAM_FROM === "soul" ? "soul" : "deployment";
const identityMeta = ({ mode = "local", alias, team, address = null, resident = null, grant }) => ({ mode, alias, team, address: address || null, resident: resident || null, ...(grant ? { grant } : {}) });
const teamConfigRemedy = () => defaultTeamLabel() && !defaultTeamId() ? unmappedDefaultMessage() : NO_TEAMS_MESSAGE;
function declaredRootCandidate(team = defaultTeamId()) {
  const roots = settings.roots && typeof settings.roots === "object" && !Array.isArray(settings.roots) ? settings.roots : {};
  if (team && typeof roots[team] === "string" && roots[team].trim()) return { root: roots[team].trim(), key: `settings.oats.aweb.roots[${JSON.stringify(team)}]`, declared: true };
  if (typeof settings.root === "string" && settings.root.trim()) return { root: settings.root.trim(), key: "settings.oats.aweb.root", declared: true };
  return undefined;
}
function rootSettingCandidate(team = defaultTeamId()) {
  const declared = declaredRootCandidate(team);
  if (declared) return declared;
  const fallback = process.env.OATS_WORKSPACE || process.cwd();
  return fallback ? { root: fallback, key: "settings.oats.aweb.root", declared: false } : undefined;
}
function awebRootProblem(candidate) {
  if (!candidate?.root) return `no messaging root at ${process.cwd()}: run oats aweb setup there or set settings.oats.aweb.root`;
  if (!isAbsolute(candidate.root)) return `${candidate.key} must be an absolute directory whose .aw is the aweb minting root`;
  return `no messaging root at ${resolve(candidate.root)}: run oats aweb setup there or set ${candidate.key}`;
}
function resolveAwebRoot() {
  const declared = declaredRootCandidate();
  if (declared && isAbsolute(declared.root) && existsSync(join(resolve(declared.root), ".aw"))) return resolve(declared.root);
  if (declared?.declared) return undefined;
  const candidate = rootSettingCandidate();
  if (candidate && isAbsolute(candidate.root) && existsSync(join(resolve(candidate.root), ".aw"))) return resolve(candidate.root);
  return undefined;
}
function awebRoot() { return resolveAwebRoot(); }

/** Team memberships from `aw team list --json`. The current CLI returns
 * `memberships`; older output used `teams`. Spawn resolution and `oats aweb
 * setup` MUST read this the same way — they drifted once, and because spawn
 * treats "no matching membership" as fatal, the stale reader turned every
 * name-only team config into a blocked spawn (reviewer-602627c). */
const teamMemberships = (listed) => listed?.memberships || listed?.teams || [];
const teamIdsOf = (listed) => teamMemberships(listed).map((m) => m.team_id || m.id || m);
function normalizeAwebTeamName(label) {
  const normalized = String(label || "").toLowerCase().replace(/[_.]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(normalized) || normalized.length > 128) throw new Error(`team label ${JSON.stringify(label)} does not normalize to a valid aweb team name`);
  return normalized;
}
const AWEB_TEAM_ID_MESSAGE = "aweb team ids must have shape <name>:<namespace> (name matches ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$; namespace is a hostname)";
function validHostname(value) { const s = String(value || ""); return s.length <= 253 && s.split(".").every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)); }
function validAwebTeamId(value) { const m = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127}):([^:]+)$/.exec(String(value || "")); return !!m && validHostname(m[2]); }
function invalidAwebTeamId(env = process.env) {
  const id = defaultTeamId();
  if (id && !validAwebTeamId(id)) return id;
  try { const rows = JSON.parse(env.OATS_TEAMS || "[]"); if (Array.isArray(rows)) for (const r of rows) if (r && typeof r.team === "string" && r.team.trim() && !validAwebTeamId(r.team.trim())) return r.team.trim(); } catch { /* malformed OATS_TEAMS is handled as no eligible teams */ }
  return null;
}
const flagEq = (name, value) => `${name}=${String(value)}`;
function assertNotFlag(value, what) {
  if (String(value || "").startsWith("-")) throw new Error(`${what} must not start with '-'`);
}
const yamlQuote = (value) => JSON.stringify(String(value));
function findOatsLocal(start = process.env.OATS_WORKSPACE || process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    const file = join(dir, "oats-local.yaml");
    if (existsSync(file)) return file;
    const parent = dirname(dir);
    if (parent === dir) return join(resolve(start), "oats-local.yaml");
    dir = parent;
  }
}
function blockEnd(lines, start, indent) {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].trim() && !lines[i].startsWith(" ".repeat(indent + 1))) { end = i; break; }
  return end;
}
function ensureYamlBlock(lines, parentStart, parentEnd, indent, header) {
  const row = `${" ".repeat(indent)}${header}:`;
  for (let i = parentStart + 1; i < parentEnd; i++) if (lines[i].trimEnd() === row) return i;
  lines.splice(parentEnd, 0, row);
  return parentEnd;
}
function atomicWrite(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basenameForTemp(file)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}
function basenameForTemp(file) { return file.split(/[\\/]/).pop() || "oats-local.yaml"; }
function unsupportedLocalYaml(file, detail, team, rootDir) {
  throw new Error(`${file}: cannot safely update settings.oats.aweb.roots automatically (${detail}); add this line by hand under block-style settings.oats.aweb.roots: ${yamlQuote(team)}: ${yamlQuote(rootDir)}`);
}
function findBlockHeader(lines, start, end, indent, names) {
  const pad = " ".repeat(indent);
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!line.startsWith(pad) || line.startsWith(pad + " ")) continue;
    const trimmed = line.slice(indent).trimEnd();
    for (const name of names) if (trimmed === `${name}:`) return i;
    for (const name of names) if (trimmed.startsWith(`${name}:`)) return { unsupported: i, line };
  }
  return -1;
}
function assertAwebRootSettingRecordable(team, rootDir, { start = process.env.OATS_WORKSPACE || process.cwd() } = {}) {
  const file = findOatsLocal(start);
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let settings = findBlockHeader(lines, 0, lines.length, 0, ["settings"]);
  if (typeof settings === "object") unsupportedLocalYaml(file, `line ${settings.unsupported + 1} is not a block-style settings: mapping`, team, rootDir);
  if (settings < 0) return;
  const settingsEnd = blockEnd(lines, settings, 0);
  let aweb = findBlockHeader(lines, settings + 1, settingsEnd, 2, ["oats.aweb", '"oats.aweb"', "'oats.aweb'"]);
  if (typeof aweb === "object") unsupportedLocalYaml(file, `line ${aweb.unsupported + 1} is not a block-style oats.aweb: mapping`, team, rootDir);
  if (aweb < 0) return;
  const awebEnd = blockEnd(lines, aweb, 2);
  const roots = findBlockHeader(lines, aweb + 1, awebEnd, 4, ["roots"]);
  if (typeof roots === "object") unsupportedLocalYaml(file, `line ${roots.unsupported + 1} is not a block-style roots: mapping`, team, rootDir);
}
function recordAwebRootSetting(team, rootDir, { start = process.env.OATS_WORKSPACE || process.cwd() } = {}) {
  const file = findOatsLocal(start);
  const existed = existsSync(file);
  const lines = existed ? readFileSync(file, "utf8").split(/\r?\n/) : ["schemaVersion: 2", "workspace: local"];
  while (lines.length && lines.at(-1) === "") lines.pop();
  let settings = findBlockHeader(lines, 0, lines.length, 0, ["settings"]);
  if (typeof settings === "object") unsupportedLocalYaml(file, `line ${settings.unsupported + 1} is not a block-style settings: mapping`, team, rootDir);
  if (settings < 0) { lines.push("settings:"); settings = lines.length - 1; }
  let settingsEnd = blockEnd(lines, settings, 0);
  let aweb = findBlockHeader(lines, settings + 1, settingsEnd, 2, ["oats.aweb", '"oats.aweb"', "'oats.aweb'"]);
  if (typeof aweb === "object") unsupportedLocalYaml(file, `line ${aweb.unsupported + 1} is not a block-style oats.aweb: mapping`, team, rootDir);
  if (aweb < 0) { aweb = ensureYamlBlock(lines, settings, settingsEnd, 2, "oats.aweb"); settingsEnd++; }
  let awebEnd = blockEnd(lines, aweb, 2);
  let roots = findBlockHeader(lines, aweb + 1, awebEnd, 4, ["roots"]);
  if (typeof roots === "object") unsupportedLocalYaml(file, `line ${roots.unsupported + 1} is not a block-style roots: mapping`, team, rootDir);
  if (roots < 0) { roots = ensureYamlBlock(lines, aweb, awebEnd, 4, "roots"); awebEnd++; }
  const rootsEnd = blockEnd(lines, roots, 4);
  const key = yamlQuote(team), value = yamlQuote(rootDir), row = `      ${key}: ${value}`;
  const existing = lines.findIndex((l, i) => i > roots && i < rootsEnd && l.trimStart().startsWith(`${key}:`));
  if (existing >= 0) lines[existing] = row; else lines.splice(rootsEnd, 0, row);
  atomicWrite(file, `${lines.join("\n")}\n`);
}
function perTeamRoot(base, label) { return join(resolve(base), ".aweb-roots", normalizeAwebTeamName(label)); }

function awFloorProblem() {
  if (!onPath("aw")) return `aw CLI not on PATH; install aw >= ${AW_MIN}`;
  const version = awVersionLabel();
  if (!version) return `aw version could not be read; install aw >= ${AW_MIN}`;
  if (semverAtLeast(version, AW_MIN)) return undefined;
  return `aw ${version} is older than required ${AW_MIN}; install aw >= ${AW_MIN}`;
}

const AW_INSTALL = "install the aw CLI first — see https://aweb.ai/docs (or `oats aweb setup` for guided onboarding)";
const isCommand = ["roster", "setup", "teams", "join", "leave"].includes(event);
const invalidConfiguredTeamId = invalidAwebTeamId();
if (invalidConfiguredTeamId && (isCommand || ["spawn", "launch"].includes(event))) {
  if (isCommand) { console.error(`oats aweb ${event}: ${AWEB_TEAM_ID_MESSAGE}`); process.exit(1); }
  fatal(AWEB_TEAM_ID_MESSAGE);
}
if (!onPath("aw")) {
  if (isCommand) { console.error(`oats aweb ${event}: aw CLI not on PATH — ${AW_INSTALL}`); process.exit(1); }
  if (event === "spawn") fatal(`aw CLI not on PATH, so no identity could be minted and this instance would have no messaging — ${AW_INSTALL}`);
  warn(`aw CLI not on PATH — no identity minted; ${AW_INSTALL}`);
}
if (isCommand || event === "spawn") {
  const floorProblem = awFloorProblem();
  if (floorProblem) {
    if (isCommand) { console.error(`oats aweb ${event}: ${floorProblem}`); process.exit(1); }
    fatal(`${floorProblem}, so no identity could be minted and this instance would not meet the messaging contract`);
  }
}

// ---------------------------------------------------------------------------
// Retained identity (explicit per-soul opt-in): a standing seat keeps its
// did:aw and address when re-seated as an OATS instance. Per aweb's contract
// (2026-09-05): copy exactly the identity-authority files from the source
// .aw into the home's .aw, reconnect the coordination binding with
// `aw workspace connect`, verify online, heartbeat and status show the new
// path, and hold a lock BESIDE the source so no second seat can take it.
// Never copy workspace.yaml, caches or locks; never delete the source; never
// team-join (that is the mint path, which would try to create the alias
// again). Retire releases the lock and leaves the identity alone.
const IDENTITY_AUTHORITY = ["signing.key", "identity.yaml", "teams.yaml", "team-certs", "encryption.yaml", "encryption-keys"];
// Session delivery registers the home with the host wake broker (aweb-abil:
// `aw wake register --home <abs> --identity-home <abs> --delivery session
// [--backend tmux|herdr]`, durable even when the daemon is down). An aw
// without `aw wake` cannot deliver in session mode: refuse, never silently
// turn a working channel into a poll-only instance.
// Throws, never exits: both callers run it inside a try whose catch performs
// the rollback (the seat path restores the binding; the mint path hands the
// minted identity to compensation).
function wakeRegister(instanceHome, identityHome) {
  const backend = process.env.OATS_BACKEND;
  try {
    run(["aw", "wake", "register", "--home", instanceHome, "--identity-home", identityHome, "--delivery", "session", ...(backend ? ["--backend", backend] : [])], instanceHome, 60000);
  } catch (e) {
    throw new Error(`delivery: session needs an aw with the wake broker CLI (aw wake register), which this aw does not provide (${e.message || e}); install the aweb release that ships aw wake, or use delivery: channel`);
  }
}
function wakeDeregister(instanceHome) {
  try { run(["aw", "wake", "deregister", "--home", instanceHome], instanceHome, 60000); return true; } catch { return false; }
}
const NORMAL_GRANT_SCOPES = ["mail.read", "mail.send", "chat.read", "chat.send", "events.read", "coord.read", "coord.write", "presence.write", "contacts.read", "contacts.write"];
const REVIEWER_GRANT_SCOPES = ["mail.read", "chat.read", "events.read", "coord.read", "presence.write"];
const residentKeyHint = (name) => `oats-local.yaml settings.oats.aweb.residents.${name || "<name>"}`;
const grantProfile = () => identitySettings.profile === undefined || identitySettings.profile === null || identitySettings.profile === "" ? "normal" : String(identitySettings.profile);
function grantScopes() {
  if (Array.isArray(identitySettings.scopes) && identitySettings.scopes.length) return identitySettings.scopes.map(String);
  const profile = grantProfile();
  if (profile === "normal") return [...NORMAL_GRANT_SCOPES];
  if (profile === "reviewer") return [...REVIEWER_GRANT_SCOPES];
  fatal(`identity.profile must be one of "normal" or "reviewer" (got ${JSON.stringify(identitySettings.profile)})`);
}
const grantE2eeRequired = () => identitySettings.e2ee !== false;
const grantRenewMode = () => identitySettings.renew === undefined || identitySettings.renew === null || identitySettings.renew === "" ? "off" : String(identitySettings.renew);
function resolveResidentCustody(name) {
  if (!name) fatal(`identity.mode "global" requires identity.resident; set ${residentKeyHint("<name>")} to the absolute custody directory for that resident identity`);
  const residents = settings.residents && typeof settings.residents === "object" && !Array.isArray(settings.residents) ? settings.residents : {};
  const custody = residents[name];
  if (typeof custody !== "string" || !isAbsolute(custody) || !existsSync(join(custody, ".aw", "identity.yaml"))) {
    fatal(`identity.mode "global" resident ${JSON.stringify(name)} is not resolvable; set ${residentKeyHint(name)} to an absolute custody directory whose .aw/identity.yaml exists`);
  }
  return custody;
}
function grantShow(custody, grantId) {
  const raw = run(["aw", "id", "grant", "show", grantId, "--json"], custody, 60000, { unsetEnv: ["AWEB_IDENTITY_HOME"] });
  return parseAwJson(raw, "aw id grant show");
}
const revokeMaybeApplied = (error) => /may have applied|context deadline exceeded|timed out|timeout/i.test(String(error?.message || error));
function revokeGrant(custody, grantId) {
  try {
    const raw = run(["aw", "id", "grant", "revoke", grantId, "--json"], custody, 60000, { unsetEnv: ["AWEB_IDENTITY_HOME"] });
    return parseAwJson(raw, "aw id grant revoke");
  } catch (e) {
    if (revokeMaybeApplied(e)) {
      try {
        const shown = grantShow(custody, grantId);
        const status = String(shown.status || shown.grant?.status || "").toLowerCase();
        if (status === "revoked" || shown.revoked === true) return { grant_id: grantId, status: "revoked", verifiedByShow: true };
      } catch { /* fall through to original revoke error */ }
    }
    throw e;
  }
}
function grantYamlNestedScalar(text, sectionName, key) {
  const lines = String(text ?? "").split(/\r?\n/);
  let inSection = false, baseIndent = 0;
  for (const line of lines) {
    const section = new RegExp(`^(\\s*)${sectionName}:\\s*(?:#.*)?$`).exec(line);
    if (section) { inSection = true; baseIndent = section[1].length; continue; }
    if (inSection) {
      const ind = /^(\s*)/.exec(line)?.[1].length || 0;
      if (line.trim() && ind <= baseIndent) inSection = false;
      const value = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)["']?\\s*$`).exec(line);
      if (value) return value[1].trim();
    }
  }
  return undefined;
}
function recoverGrantHome(grantHome) {
  try {
    const text = readFileSync(join(grantHome, "grant.yaml"), "utf8");
    const scalar = (key) => {
      const m = text.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)["']?\\s*$`, "m"));
      return m ? m[1].trim() : undefined;
    };
    return { grantId: scalar("grant_id"), team: scalar("team_id"), expiresAt: scalar("expires_at"), subjectAlias: grantYamlNestedScalar(text, "subject", "alias"), custodySocket: grantYamlCustodySocket(text) };
  } catch { return {}; }
}
function readGrantYamlCustodySocket(grantHome) {
  const text = readFileSync(join(grantHome, "grant.yaml"), "utf8");
  return grantYamlCustodySocket(text);
}
function verifyGrantCustodyAttachment({ grantHome, custodySocket, alias, team }) {
  const recorded = readGrantYamlCustodySocket(grantHome);
  if (!recorded) throw new Error(`grant.yaml custody.socket_path is missing`);
  if (recorded !== custodySocket) throw new Error(`grant.yaml custody.socket_path ${recorded} differs from preflight ${custodySocket}`);
  const raw = run(["aw", "custody", "status", "--json"], grantHome, 20000, { env: { AWEB_IDENTITY_HOME: grantHome }, secretSafe: true });
  const status = parseAwJson(raw, "aw custody status");
  if (String(status.status || "") !== "running") throw new Error(`grant custody status is ${status.status || "unknown"}, not running`);
  if (status.socket_path !== custodySocket) throw new Error(`grant custody status socket_path ${status.socket_path || "<missing>"} differs from preflight ${custodySocket}`);
  if (status.resident?.alias !== alias) throw new Error(`grant custody resident alias ${status.resident?.alias || "<missing>"} differs from ${alias}`);
  const teamRow = (Array.isArray(status.teams) ? status.teams : []).find((t) => t && (t.team_id || t.id) === team);
  if (!teamRow || teamRow.ready !== true) throw new Error(`grant custody team ${team} is not ready`);
  return status;
}
function preflightCustodySocket(preflight) {
  return typeof preflight.status?.socket_path === "string" && preflight.status.socket_path.trim() ? preflight.status.socket_path.trim() : undefined;
}
function requirePreflightCustodySocket(preflight) {
  const socket = preflightCustodySocket(preflight);
  if (!socket) fatal("custody preflight reported no socket_path, so the grant cannot be attached to custody");
  return socket;
}
function grantHomeDirs() {
  try {
    return readdirSync(home)
      .filter((name) => name === ".aweb-identity" || /^\.aweb-identity-\d+$/.test(name))
      .map((name) => join(home, name))
      .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
  } catch { return []; }
}
function removeGrantHomes() { for (const p of grantHomeDirs()) { try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } } }
function newestGrantHome() {
  const dirs = grantHomeDirs().map((p) => {
    try { return { path: p, mtime: statSync(p).mtimeMs }; } catch { return { path: p, mtime: 0 }; }
  }).sort((a, b) => b.mtime - a.mtime || b.path.localeCompare(a.path));
  return dirs[0]?.path || join(home, ".aweb-identity");
}
const priorGrantHome = (meta = {}) => typeof meta.identity?.grant?.home === "string" && meta.identity.grant.home ? meta.identity.grant.home : newestGrantHome();
function retainedLaunchOutput(meta = {}, identityHome = priorGrantHome(meta)) {
  const delivery = meta.delivery || deliveryMode;
  const env = {};
  if (delivery === "session") env.AWEB_DELIVERY = "session";
  if (meta.identity?.mode === "global" && meta.identity?.grant?.id) env.AWEB_IDENTITY_HOME = identityHome;
  const launch = (process.env.OATS_RUNTIME || "") === "claude" && delivery === "channel" ? { claude: "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace" } : undefined;
  return { ...(Object.keys(env).length ? { env } : {}), ...(launch ? { launch } : {}) };
}
function grantMintArgv({ team, scopes, ttl, grantHome, custodySocket }) {
  return ["aw", "id", "grant", "mint", flagEq("--team", team), flagEq("--scope", scopes.join(",")), flagEq("--ttl", ttl), flagEq("--label", `oats:${instance}`), flagEq("--out", grantHome), flagEq("--custody-socket", custodySocket), "--json"];
}
function validateMintedGrant(minted, grantHome) {
  const grantId = typeof minted.grant_id === "string" ? minted.grant_id : undefined;
  const expiresAt = typeof minted.expires_at === "string" ? minted.expires_at : undefined;
  const mintedTeam = typeof minted.team_id === "string" ? minted.team_id : undefined;
  const mintedOut = typeof minted.out === "string" ? minted.out : undefined;
  if (!grantId || !expiresAt || !mintedTeam || !mintedOut) throw new Error("aw id grant mint JSON lacked grant_id, expires_at, team_id, or out");
  if (resolve(mintedOut) !== resolve(grantHome)) throw new Error(`aw id grant mint wrote ${mintedOut}, not ${grantHome}`);
  return { minted, grantId, expiresAt, mintedTeam, alias: typeof minted.alias === "string" && minted.alias ? minted.alias : undefined, address: typeof minted.address === "string" && minted.address ? minted.address : null };
}
function parseMintedGrant(raw, grantHome) { return validateMintedGrant(parseAwJson(raw, "aw id grant mint"), grantHome); }
function globalGrantRenew() {
  const mode = grantRenewMode();
  const oldMeta = JSON.parse(process.env.OATS_META || "{}");
  if (mode === "off") out(retainedLaunchOutput(oldMeta));
  if (mode !== "launch") fatal(`identity.renew must be "off" or "launch" (got ${JSON.stringify(identitySettings.renew)})`);
  if (oldMeta.identity?.mode !== "global" || !oldMeta.identity?.grant?.id) out(retainedLaunchOutput(oldMeta));
  const resident = String(identitySettings.resident || oldMeta.identity.resident || "");
  const custody = resolveResidentCustody(resident);
  const team = defaultTeamId() || oldMeta.identity.team;
  if (!team) fatal(teamConfigRemedy());
  const scopes = grantScopes();
  const ttl = identitySettings.ttl === undefined || identitySettings.ttl === null || identitySettings.ttl === "" ? "8h" : String(identitySettings.ttl);
  const oldHome = priorGrantHome(oldMeta);
  let preflight;
  try { preflight = custodyPreflight({ custody, resident, team, e2eeRequired: grantE2eeRequired(), fatalOnError: false, runAw: (argv, cwd, options) => run(argv, cwd, 60000, options), fatal }); }
  catch (e) { out({ meta: oldMeta, ...retainedLaunchOutput(oldMeta, oldHome), warning: `oats-aweb: renewal custody preflight failed (${e.message || e}); keeping previous grant ${oldMeta.identity.grant.id}` }); }
  const custodySocket = preflightCustodySocket(preflight);
  if (!custodySocket) out({ meta: oldMeta, ...retainedLaunchOutput(oldMeta, oldHome), warning: `oats-aweb: renewal custody preflight reported no socket_path, so the grant cannot be attached to custody; keeping previous grant ${oldMeta.identity.grant.id}` });
  let stamp = Math.floor(Date.now() / 1000);
  let grantHome = join(home, `.aweb-identity-${stamp}`);
  while (existsSync(grantHome)) grantHome = join(home, `.aweb-identity-${++stamp}`);
  let parsed;
  try {
    parsed = parseMintedGrant(run(grantMintArgv({ team, scopes, ttl, grantHome, custodySocket }), custody, 60000, { unsetEnv: ["AWEB_IDENTITY_HOME"] }), grantHome);
  } catch (e) {
    try { rmSync(grantHome, { recursive: true, force: true }); } catch { /* best effort */ }
    out({ meta: oldMeta, ...retainedLaunchOutput(oldMeta, oldHome), warning: `oats-aweb: renewal mint failed (${e.message || e}); keeping previous grant ${oldMeta.identity.grant.id}` });
  }
  const { grantId, expiresAt, mintedTeam, alias: mintedAlias, address } = parsed;
  const recovered = recoverGrantHome(grantHome);
  const alias = recovered.subjectAlias || mintedAlias || oldMeta.identity.alias || resident;
  const newMeta = { ...oldMeta, delivery: oldMeta.delivery || deliveryMode, identity: identityMeta({ mode: "global", alias, team: mintedTeam, address: address || oldMeta.identity.address || null, resident, grant: { id: grantId, expiresAt, scopes, home: grantHome } }) };
  if (mintedTeam !== team) {
    try { revokeGrant(custody, grantId); } catch { /* minted mismatch expires by TTL if revoke fails */ }
    try { rmSync(grantHome, { recursive: true, force: true }); } catch { /* best effort */ }
    out({ meta: oldMeta, ...retainedLaunchOutput(oldMeta, oldHome), warning: `oats-aweb: renewal minted grant team ${mintedTeam} differs from ${team}; keeping previous grant ${oldMeta.identity.grant.id}` });
  }
  try { verifyGrantCustodyAttachment({ grantHome, custodySocket, alias: newMeta.identity.alias, team: mintedTeam }); }
  catch (e) {
    try { revokeGrant(custody, grantId); } catch { /* new grant expires by TTL if revoke fails */ }
    try { rmSync(grantHome, { recursive: true, force: true }); } catch { /* best effort */ }
    out({ meta: oldMeta, ...retainedLaunchOutput(oldMeta, oldHome), warning: `oats-aweb: renewal grant ${grantId} custody attachment failed (${e.message || e}); keeping previous grant ${oldMeta.identity.grant.id}` });
  }
  let warning;
  try { revokeGrant(custody, oldMeta.identity.grant.id); }
  catch (e) { warning = `oats-aweb: previous grant ${oldMeta.identity.grant.id} was not revoked (${e.message || e}); new grant ${grantId} is kept and the previous grant still expires at ${oldMeta.identity.grant.expiresAt || "its TTL"}`; }
  out({ meta: newMeta, ...retainedLaunchOutput(newMeta, grantHome), ...(warning ? { warning } : {}) });
}
function globalGrantSpawn() {
  const resident = String(identitySettings.resident || "");
  const custody = resolveResidentCustody(resident);
  let team = defaultTeamId();
  const teamWarnings = [];
  if (!team) fatal(teamConfigRemedy());
  const grantHome = join(home, ".aweb-identity");
  if (existsSync(grantHome)) fatal(`${grantHome} already exists; refusing to overwrite an existing aweb session grant home`);
  const scopes = grantScopes();
  const ttl = identitySettings.ttl === undefined || identitySettings.ttl === null || identitySettings.ttl === "" ? "8h" : String(identitySettings.ttl);
  const preflight = custodyPreflight({ custody, resident, team, e2eeRequired: grantE2eeRequired(), runAw: (argv, cwd, options) => run(argv, cwd, 60000, options), fatal });
  const custodySocket = requirePreflightCustodySocket(preflight);
  let meta;
  const cleanup = () => { try { rmSync(grantHome, { recursive: true, force: true }); } catch { /* best effort */ } };
  const failAfterMint = (message, code = 1) => { cleanup(); out({ ...(meta ? { meta } : {}), warning: `oats-aweb: ${String(message).slice(0, 300)}` }, code); };
  try {
    const raw = run(grantMintArgv({ team, scopes, ttl, grantHome, custodySocket }), custody, 60000, { unsetEnv: ["AWEB_IDENTITY_HOME"] });
    let minted;
    try { minted = parseMintedGrant(raw, grantHome).minted; }
    catch (parseError) {
      const recovered = recoverGrantHome(grantHome);
      if (recovered.grantId) {
        meta = { delivery: deliveryMode, identity: identityMeta({ mode: "global", alias: resident, team: recovered.team || team, resident, grant: { id: recovered.grantId, expiresAt: recovered.expiresAt || "unknown", scopes, home: grantHome } }) };
        try { revokeGrant(custody, recovered.grantId); failAfterMint(`${parseError.message}; recovered grant ${recovered.grantId} from grant.yaml, revoked it, and removed the grant home`); }
        catch (revokeError) { failAfterMint(`${parseError.message}; recovered grant ${recovered.grantId} from grant.yaml, but revoke failed: ${revokeError.message || revokeError}`); }
      }
      throw parseError;
    }
    const { grantId, expiresAt, mintedTeam, alias: mintedAlias, address } = validateMintedGrant(minted, grantHome);
    const recovered = recoverGrantHome(grantHome);
    const alias = recovered.subjectAlias || mintedAlias || resident;
    meta = { delivery: deliveryMode, defaultTeam: { label: defaultTeamLabel(), team: mintedTeam, from: defaultTeamFromEnv() }, identity: identityMeta({ mode: "global", alias, team: mintedTeam, address, resident, grant: { id: grantId, expiresAt, scopes, home: grantHome } }) };
    if (mintedTeam !== team) {
      try { revokeGrant(custody, grantId); failAfterMint(`minted grant team ${mintedTeam} differs from ${team}; the grant was revoked and nothing was kept`); }
      catch (e) { failAfterMint(`minted grant team ${mintedTeam} differs from ${team}; revoke failed: ${e.message || e}`); }
    }
    try { verifyGrantCustodyAttachment({ grantHome, custodySocket, alias, team: mintedTeam }); }
    catch (e) {
      try { revokeGrant(custody, grantId); failAfterMint(`minted grant ${grantId} custody attachment failed: ${e.message || e}; the grant was revoked and nothing was kept`); }
      catch (revokeError) { failAfterMint(`minted grant ${grantId} custody attachment failed: ${e.message || e}; revoke failed: ${revokeError.message || revokeError}`); }
    }
    const launch = (process.env.OATS_RUNTIME || "") === "claude" && deliveryMode === "channel"
      ? { claude: "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace" }
      : undefined;
    const env = { ...(deliveryMode === "session" ? { AWEB_DELIVERY: "session" } : {}), AWEB_IDENTITY_HOME: grantHome };
    if (deliveryMode === "session") {
      try { wakeRegister(home, grantHome); }
      catch (e) {
        try { revokeGrant(custody, grantId); failAfterMint(`session delivery registration failed for minted grant ${grantId}: ${e.message || e}; grant revoked and grant home removed`); }
        catch (revokeError) { failAfterMint(`session delivery registration failed for minted grant ${grantId}: ${e.message || e}; revoke failed: ${revokeError.message || revokeError}`); }
      }
    }
    const warnings = [...teamWarnings, ...preflight.warnings];
    const e2eeBrief = preflight.warnings.length ? ` Warning: ${preflight.warnings.join(" ")}` : "";
    const deliveryBrief = deliveryMode === "session"
      ? ` Notification delivery: external (AWEB_DELIVERY=session): the host wake broker (aw wake) is registered for this home and nudges you when mail or chat arrives; the native aweb channel is not running. If you have waited long with nothing arriving, check \`aw mail inbox\` and \`aw chat pending\` yourself at task boundaries.`
      : "";
    out({
      meta,
      env,
      brief: `Comms: you act as resident aweb identity "${alias}" on team ${mintedTeam} through a session grant for ${resident}; scopes: ${scopes.join(", ")}; expires: ${expiresAt}. Root keys are not in this home, and identity lifecycle commands are not yours to run; your grant home is attached to the resident's custody service. If a message you sent shows unverified at the receiver, report it, do not retry.${e2eeBrief}${deliveryBrief} Use \`aw mail\`/\`aw chat\` for messaging (see the aweb-messaging skill); coordination stays in your deployment's task layer.`,
      ...(launch ? { launch } : {}),
      ...(warnings.length ? { warning: warnings.join(" | ") } : {}),
    });
  } catch (e) {
    if (meta?.identity?.grant?.id) { try { revokeGrant(custody, meta.identity.grant.id); } catch { /* retire compensation gets meta */ } cleanup(); }
    fatal(`identity grant minting failed: ${e.message || e}`, meta);
  }
}
function globalGrantRetire(meta) {
  if (meta.delivery === "session") { if (!wakeDeregister(home)) process.stderr.write("oats-aweb: aw wake deregister failed; the broker treats a retired home as inactive on its own\n"); }
  const id = meta.identity?.grant?.id;
  if (!id) out({ meta: { retired: false, reason: "nothing-to-revoke" } });
  const resident = meta.identity?.resident;
  const custody = resolveResidentCustody(resident);
  try {
    revokeGrant(custody, id);
    removeGrantHomes();
    out({ meta: { retired: true, identityRevoked: true, grant: id } });
  } catch (e) {
    removeGrantHomes();
    out({ meta: { retired: false, reason: "grant-revoke-failed", grant: id }, warning: `oats-aweb: grant ${id} was not revoked (${e.message || e}); it still expires at ${meta.identity?.grant?.expiresAt || "its TTL"}` }, 1);
  }
}
const seatLockPath = (source) => join(dirname(source), ".aw-retained-seat.json");
/** The alias a home's .aw/workspace.yaml records under memberships (indented),
 *  or undefined. Read only when the hook has no alias of its own. */
const workspaceAliasOf = (homeDir) => {
  try { const m = readFileSync(join(homeDir, ".aw", "workspace.yaml"), "utf8").match(/^\s*alias:\s*["']?([a-z0-9][a-z0-9_-]{0,63})["']?\s*$/mi); return m ? m[1] : undefined; }
  catch { return undefined; }
};
/** A join that the CLI reported as failed (or that this hook killed on
 *  timeout) may still have completed server-side: the home then holds a
 *  signing key, a team certificate and a workspace binding. */
const joinedLate = (homeDir) => existsSync(join(homeDir, ".aw", "signing.key")) && existsSync(join(homeDir, ".aw", "team-certs")) && !!workspaceAliasOf(homeDir);
const JOIN_TIMEOUT_MS = Number(process.env.OATS_AWEB_JOIN_TIMEOUT_MS) > 0 ? Number(process.env.OATS_AWEB_JOIN_TIMEOUT_MS) : 120000;
const yamlScalar = (text, key) => {
  const m = String(text).match(new RegExp(`^${key}:\\s*["']?([^"'\\n#]+)["']?\\s*$`, "m"));
  return m ? m[1].trim() : undefined;
};
function activeTeamAt(root) {
  try {
    const text = readFileSync(join(resolve(root), ".aw", "teams.yaml"), "utf8");
    return yamlScalar(text, "active_team") || yamlScalar(text, "active");
  } catch { return undefined; }
}
function retainedSeatSpawn(source, takeOver) {
  if (typeof source !== "string" || !source.startsWith("/")) fatal("identity.source must be the absolute path of the legacy .aw directory to retain");
  if (!existsSync(join(source, "signing.key"))) fatal(`identity.source ${source} holds no signing.key, so there is no identity to retain`);
  const lockPath = seatLockPath(source);
  let takenOver;
  if (existsSync(lockPath)) {
    let held; try { held = JSON.parse(readFileSync(lockPath, "utf8")); } catch { held = {}; }
    const holderHome = held.home;
    // Held means the holder's home still exists: retire removes both the lock
    // and the home, so a home that is there is a seat that was never retired.
    // No process liveness is inferred (the spawner's pid says nothing about the
    // runtime). The only escape is the explicit, warned take-over for a seat
    // whose runtime is known to be dead.
    if (holderHome && existsSync(holderHome)) {
      if (takeOver !== true) fatal(`identity at ${source} is already held by ${holderHome} (${lockPath}); a seat is never taken from a holder whose home exists — retire that instance first, or set identity.takeOver: true only if you know its runtime is dead`);
      takenOver = holderHome;
    }
  }
  const srcWorkspace = existsSync(join(source, "workspace.yaml")) ? readFileSync(join(source, "workspace.yaml"), "utf8") : "";
  const service = process.env.OATS_AWEB_URL || yamlScalar(srcWorkspace, "aweb_url");
  if (!service) fatal(`cannot determine the aweb service for ${source} (no aweb_url in its workspace.yaml)`);
  const role = yamlScalar(srcWorkspace, "role_name");
  let team = defaultTeamId();
  if (!team && existsSync(join(source, "teams.yaml"))) team = yamlScalar(readFileSync(join(source, "teams.yaml"), "utf8"), "active_team") || yamlScalar(readFileSync(join(source, "teams.yaml"), "utf8"), "active");
  if (!team || !team.includes(":")) fatal(`cannot determine the team for the retained identity (${teamConfigRemedy()}, or keep an active team in ${join(source, "teams.yaml")})`);
  const dest = join(home, ".aw");
  const legacyHome = dirname(source);
  // The lock is taken FIRST: a concurrent second spawn must see it before any
  // byte of the identity is copied.
  // Exclusive creation (wx): two concurrent spawns cannot both pass the
  // existence check and overwrite each other; the loser fails here having
  // copied nothing. A take-over replaces the stale lock first, deliberately.
  if (takenOver) { try { rmSync(lockPath, { force: true }); } catch { /* replaced below */ } }
  try {
    writeFileSync(lockPath, JSON.stringify({ home, instance, team, takenAt: new Date().toISOString(), host: hostname(), ...(takenOver ? { tookOverFrom: takenOver } : {}) }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  } catch (e) {
    fatal(`identity at ${source} was taken by another spawn a moment ago (${lockPath} exists); nothing copied`);
  }
  let connected = false;
  const rollback = () => {
    // After `aw workspace connect` the server binding points at the new home;
    // deleting the copy alone would leave the identity bound to nothing. Put
    // the binding back where it was, from the legacy home, then remove the
    // copy; if the restore fails, KEEP the copy so the seat stays recoverable.
    let restored = !connected;
    if (connected) {
      try { run(["aw", "workspace", "connect", flagEq("--service", service), flagEq("--team", team), ...(role ? [flagEq("--role", role)] : [])], legacyHome, 60000); restored = true; }
      catch { restored = false; }
    }
    if (restored) { try { rmSync(dest, { recursive: true, force: true }); } catch { /* best effort */ } try { rmSync(lockPath, { force: true }); } catch { /* best effort */ } }
    return restored;
  };
  try {
    mkdirSync(dest, { recursive: true, mode: 0o700 });
    chmodSync(dest, 0o700);
    for (const name of IDENTITY_AUTHORITY) {
      const from = join(source, name);
      if (!existsSync(from)) continue; // encryption material may be absent on an identity that never had it
      const to = join(dest, name);
      if (statSync(from).isDirectory()) {
        cpSync(from, to, { recursive: true }); chmodSync(to, 0o700);
        for (const f of readdirSync(to)) { const p = join(to, f); if (statSync(p).isFile()) chmodSync(p, 0o600); } // private keys inside, whatever the source modes were
      } else { copyFileSync(from, to); chmodSync(to, 0o600); }
    }
    for (const forbidden of ["workspace.yaml", "context", "interaction-log.jsonl", "channel-delivered-ids.json", "chat-delivered-ids.json"]) {
      if (existsSync(join(dest, forbidden))) rmSync(join(dest, forbidden), { recursive: true, force: true });
    }
    run(["aw", "workspace", "connect", flagEq("--service", service), flagEq("--team", team), ...(role ? [flagEq("--role", role)] : [])], home, 60000);
    connected = true;
    run(["aw", "check", "--online"], home, 60000);
    run(["aw", "heartbeat"], home, 60000);
    const status = run(["aw", "workspace", "status", "--json"], home, 60000);
    // Thrown, not fatal: the catch below rolls the copy and the lock back first.
    // Verified by parsing: the workspace row's path must be this home. The
    // hostname the row records is whatever the binding stored (on hosted
    // teams it need not equal this OS hostname), so it is reported, not judged.
    let st; try { st = JSON.parse(String(status)); } catch { throw new Error(`aw workspace status from ${home} answered no JSON, so the seat is not connected; nothing is briefed`); }
    const ws = st.workspace && typeof st.workspace === "object" ? st.workspace : st;
    const shownPath = String(ws.workspace_path || ws.path || "");
    const same = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return resolve(a) === resolve(b); } };
    if (!shownPath || !same(shownPath, home)) throw new Error(`aw workspace status from ${home} shows workspace_path ${JSON.stringify(shownPath)} not this home, so the seat is not connected; nothing is briefed`);
    const hostNote = ws.hostname && ws.hostname !== hostname() && ws.hostname.split(".")[0] !== hostname().split(".")[0] ? ` (workspace row hostname ${ws.hostname}, this host ${hostname()})` : "";
    const identityText = readFileSync(join(dest, "identity.yaml"), "utf8");
    const expectedDid = yamlScalar(identityText, "did");
    const expectedAddress = yamlScalar(identityText, "address");
    // The same-identity check the contract is for: `aw whoami --json` from the
    // new home reports the did and address the CLI now acts as (workspace
    // status carries no did); both must equal the copied identity.yaml.
    let who; try { who = JSON.parse(String(run(["aw", "whoami", "--json"], home, 60000))); } catch (e) { throw new Error(`aw whoami from ${home} answered no JSON (${e.message || e}); the seat is not verified`); }
    const shownDid = who.did || who.identity?.did;
    const shownAddress = who.address || who.identity?.address;
    if (expectedDid && shownDid !== expectedDid) throw new Error(`aw whoami shows did ${shownDid || "(none)"}, not the retained identity's ${expectedDid}; the seat is not the same identity`);
    if (expectedAddress && shownAddress !== expectedAddress) throw new Error(`aw whoami shows address ${shownAddress || "(none)"}, not the retained identity's ${expectedAddress}; the seat is not the same identity`);
    const aliasRaw = String(ws.alias || st.alias || (expectedAddress || "").split("/").pop() || instance);
    if (!AWEB_ALIAS_RE.test(aliasRaw)) throw new Error(`aw workspace status reports an alias that is not a plausible alias; the seat is not briefed`);
    const alias = aliasRaw;
    if (expectedAddress && !expectedAddress.endsWith(`/${alias}`)) throw new Error(`aw workspace status shows alias ${alias}, not the retained identity's address ${expectedAddress}; the seat is not the same identity`);
    writeFileSync(lockPath, JSON.stringify({ home, instance, alias, team, takenAt: new Date().toISOString(), host: hostname(), ...(takenOver ? { tookOverFrom: takenOver } : {}) }, null, 2) + "\n", { mode: 0o600 });
    const launch = (process.env.OATS_RUNTIME || "") === "claude" && deliveryMode === "channel"
      ? { claude: "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace" }
      : undefined;
    const env = { ...(deliveryMode === "session" ? { AWEB_DELIVERY: "session" } : {}), AWEB_IDENTITY_HOME: dest };
    const deliveryBrief = deliveryMode === "session"
      ? ` Notification delivery: external (AWEB_DELIVERY=session); until the host wake broker registers this instance NOTHING wakes you: check \`aw mail inbox\` and \`aw chat pending\` at every task boundary.`
      : "";
    if (deliveryMode === "session") wakeRegister(home, dest);
    const warnings = [];
    if (takenOver) warnings.push(`oats-aweb: took over the retained identity from ${takenOver} on identity.takeOver: true; if that runtime was still alive there are now two seats with one key — stop the old one`);
    if (hostNote) warnings.push(`oats-aweb: seated${hostNote}`);
    out({
      meta: { team, alias, retained: true, source, lock: lockPath, delivery: deliveryMode, identity: identityMeta({ mode: "global", alias, team, address: shownAddress || expectedAddress || null }), ...(takenOver ? { tookOverFrom: takenOver } : {}) },
      env,
      brief: `Comms: you are the retained seat of the existing aweb identity "${alias}" on team ${team} (same did and address as the seat you replace; its contacts, routes and conversations are yours).${deliveryBrief} Use \`aw mail\`/\`aw chat\` for messaging (see the aweb-messaging skill).`,
      ...(launch ? { launch } : {}),
      ...(warnings.length ? { warning: warnings.join(" | ") } : {}),
    });
  } catch (e) {
    const restored = rollback();
    fatal(`retained identity could not be seated from ${source}: ${e.message || e}${connected ? (restored ? " (the server binding was restored to the legacy home and the copy removed)" : ` (the server binding still points at ${home} and the copy was KEPT there so the seat is recoverable: run aw workspace connect from ${legacyHome} to restore it, or retry the spawn)`) : ""}`);
  }
}

const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function parseOatsTeams(env = process.env) {
  try {
    const rows = JSON.parse(env.OATS_TEAMS || "[]");
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object").map((r) => ({
      label: String(r.label || ""),
      team: typeof r.team === "string" ? r.team : null,
      default: r.default === true,
      from: r.from === "shared" ? "shared" : "local",
    })) : [];
  } catch { return []; }
}
function eligibleTeams() { return parseOatsTeams().filter((t) => !t.default && t.label && t.team); }
function labelsCsv(text) { return String(text || "").split(",").map((s) => s.trim()).filter(Boolean); }
function primaryTeamLabel() { return defaultTeamLabel() || null; }
function requestedJoinLabels() { return labelsCsv(settings.join); }
function validateJoinLabels(labels, { action = "join" } = {}) {
  const eligible = eligibleTeams();
  const byLabel = new Map(eligible.map((t) => [t.label, t]));
  for (const label of labels) {
    if (action === "leave" && label === defaultTeamLabel()) {
      const error = new Error(`E_TEAM_DEFAULT: ${label} is the default team and cannot be left`);
      error.code = "E_TEAM_DEFAULT";
      throw error;
    }
    if (!LABEL_RE.test(label) || !byLabel.has(label)) {
      const choices = eligible.map((t) => t.label).join(", ") || "(none)";
      const error = new Error(`E_TEAM_NOT_ELIGIBLE: ${label} is not an eligible team label for this instance (eligible: ${choices})`);
      error.code = "E_TEAM_NOT_ELIGIBLE";
      throw error;
    }
  }
  return labels.map((label) => byLabel.get(label));
}
const joinedTeamsOf = (meta = {}) => Array.isArray(meta.joinedTeams) ? meta.joinedTeams.filter((j) => j && typeof j === "object" && j.label && j.team && j.identityHome) : [];
const leftTeamsOf = (meta = {}) => Array.isArray(meta.left) ? meta.left.filter((j) => j && typeof j === "object" && j.label && j.team && j.at && j.reason).slice(-20) : [];
const providerStateDir = () => join(home, ".oats-aweb");
const providerTeamsFile = () => join(providerStateDir(), "teams.json");
function readProviderTeamsState(meta = {}) {
  try {
    const doc = JSON.parse(readFileSync(providerTeamsFile(), "utf8"));
    return { joinedTeams: joinedTeamsOf(doc), wakeJoined: doc.wakeJoined === true, left: leftTeamsOf(doc) };
  } catch { return { joinedTeams: joinedTeamsOf(meta), wakeJoined: meta.wakeJoined === true, left: leftTeamsOf(meta) }; }
}
function writeProviderTeamsState(meta) {
  mkdirSync(providerStateDir(), { recursive: true, mode: 0o700 });
  writeFileSync(providerTeamsFile(), JSON.stringify({ joinedTeams: joinedTeamsOf(meta), wakeJoined: meta.wakeJoined === true, left: leftTeamsOf(meta) }, null, 2) + "\n", { mode: 0o600 });
}
function withProviderTeams(meta = {}) { const state = readProviderTeamsState(meta); return { ...meta, joinedTeams: state.joinedTeams, wakeJoined: state.wakeJoined, left: state.left }; }
function identityHomeForLabel(label) { return join(home, `.aweb-identity-${label}`); }
function awWithIdentity(identityHome, args) { return ["aw", "--identity-home", identityHome, ...args]; }
function commandOutput(e) { return [e?.stdout, e?.stderr, e?.message].filter(Boolean).join("\n"); }
function joinedWorkspacePresent(identityHome) { return existsSync(join(identityHome, "workspace.yaml")); }
function serviceForJoinedTeam(root, label, accepted, ...docs) {
  const fromDocs = [...docs, accepted].map((d) => d && (d.service || d.service_url || d.aweb_url || d.workspace?.service || d.workspace?.service_url || d.workspace?.aweb_url)).find(Boolean);
  if (fromDocs) return fromDocs;
  const rootWorkspace = root ? join(resolve(root), ".aw", "workspace.yaml") : undefined;
  const fromRoot = rootWorkspace && existsSync(rootWorkspace) ? yamlScalar(readFileSync(rootWorkspace, "utf8"), "aweb_url") : undefined;
  if (fromRoot) return fromRoot;
  throw new Error(`cannot determine the aweb service for joined team ${label} from ${root || "(unknown root)"}; pass --service <url> (ask the team owner; hosted aweb is https://app.aweb.ai/api)`);
}
function releaseReceiptStatus(doc) {
  return doc && typeof doc === "object" && doc.alias_released === true ? "released" : undefined;
}
function cleanupJoinedIdentity(entry, fallbackAlias, cwd = home) {
  let receipt, released;
  const alias = entry.alias || fallbackAlias;
  if (!alias) throw new Error(`failed to leave team ${entry.label}; no alias is known for ${entry.identityHome}`);
  try {
    receipt = parseAwJson(run(awWithIdentity(entry.identityHome, ["workspace", "delete", alias, "--json"]), cwd, 60000), "aw workspace delete");
    released = releaseReceiptStatus(receipt);
  } catch (e) {
    throw new Error(`failed to leave team ${entry.label}; kept ${entry.identityHome} so cleanup can be retried: ${String(commandOutput(e)).slice(0, 300)}`);
  }
  if (!released) throw new Error(`failed to leave team ${entry.label}; workspace delete did not report alias_released: true; kept ${entry.identityHome} so cleanup can be retried: ${JSON.stringify(receipt)}`);
  try { rmSync(entry.identityHome, { recursive: true, force: true }); } catch { /* best effort */ }
  return { released, receipt };
}
function acceptedTeamMembership(identityHome, expectedTeam) {
  const listed = parseAwJson(run(awWithIdentity(identityHome, ["id", "team", "list", "--json"]), dirname(identityHome), 60000), "aw id team list");
  const ids = teamIdsOf(listed).map(String);
  if (expectedTeam) return ids.includes(expectedTeam) ? expectedTeam : undefined;
  return ids.length === 1 ? ids[0] : undefined;
}
function connectExistingJoinedTeam({ label, identityHome, expectedTeam, root, cwd = home, serviceDocs = [], resumeCommand }) {
  const team = acceptedTeamMembership(identityHome, expectedTeam);
  if (!team) throw new Error(`team root ${dirname(identityHome)} already holds an aweb identity, but aw id team list does not show ${expectedTeam || "exactly one team membership"}; choose a different label or remove the stale root deliberately`);
  try {
    if (!joinedWorkspacePresent(identityHome)) {
      const service = serviceForJoinedTeam(root, label, {}, ...serviceDocs);
      run(awWithIdentity(identityHome, ["workspace", "connect", flagEq("--service", service), flagEq("--team", team), "--json"]), cwd, 60000, { secretSafe: true });
    }
    if (!joinedWorkspacePresent(identityHome)) throw new Error(`workspace connect did not write ${join(identityHome, "workspace.yaml")}`);
  } catch (e) {
    throw new Error(`joined team ${label} resume failed: ${e.message || e}; kept ${identityHome} for retry${resumeCommand ? `; resume with: ${resumeCommand}` : ""}`);
  }
  return { label, team, identityHome, receive: "poll", since: new Date().toISOString() };
}
function acceptConnectVerifyJoinedTeam({ label, token, identityHome, alias: requestedAlias, expectedTeam, root, cwd = home, serviceDocs = [], cleanupOnFailure = true, resumeCommand, useAcceptedService = true }) {
  if (!token || typeof token !== "string") throw new Error(`aw id team accept-invite received no invite token for ${label}`);
  const raw = parseSecretJson(run(awWithIdentity(identityHome, ["id", "team", "accept-invite", token, flagEq("--name", requestedAlias), "--local", "--json"]), cwd, JOIN_TIMEOUT_MS, { secrets: [token], secretSafe: true }), "aw id team accept-invite");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`aw id team accept-invite returned no usable result for joined team ${label}`);
  const alias = typeof raw.alias === "string" && AWEB_ALIAS_RE.test(raw.alias) ? raw.alias : requestedAlias;
  const team = typeof raw.team_id === "string" && raw.team_id ? raw.team_id : expectedTeam;
  if (!team) throw new Error(`aw id team accept-invite returned no team_id for joined team ${label}`);
  if (expectedTeam && team !== expectedTeam) throw new Error(`joined team ${team} differs from requested ${expectedTeam}`);
  const joined = { label, team, identityHome, receive: "poll", since: new Date().toISOString(), alias };
  try {
    if (!joinedWorkspacePresent(identityHome)) {
      const service = serviceForJoinedTeam(root, label, useAcceptedService ? raw : {}, ...serviceDocs);
      run(awWithIdentity(identityHome, ["workspace", "connect", flagEq("--service", service), flagEq("--team", team), "--json"]), cwd, 60000, { secretSafe: true });
    }
    if (!joinedWorkspacePresent(identityHome)) throw new Error(`workspace connect did not write ${join(identityHome, "workspace.yaml")}`);
  } catch (e) {
    if (!cleanupOnFailure) throw new Error(`joined team ${label} was accepted but workspace connect/verification failed: ${e.message || e}; kept ${identityHome} for retry${resumeCommand ? `; resume with: ${resumeCommand}` : ""}`);
    let cleanupNote;
    try { cleanupJoinedIdentity(joined, requestedAlias, cwd); cleanupNote = "; the joined identity was deleted"; }
    catch (cleanupError) { cleanupNote = `; cleanup failed: ${cleanupError.message || cleanupError}`; }
    throw new Error(`joined team ${label} was accepted but workspace connect/verification failed: ${e.message || e}${cleanupNote}`);
  }
  return { raw, joined };
}
function readCapabilityMeta() {
  if (process.env.OATS_META) { try { return withProviderTeams(JSON.parse(process.env.OATS_META || "{}")); } catch { return withProviderTeams({}); } }
  try { return withProviderTeams(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).capabilityMeta?.["oats.aweb"] || {}); } catch { return withProviderTeams({}); }
}
function defaultTeamObject(meta = {}) {
  const label = meta.defaultTeam?.label || defaultTeamLabel() || null;
  const team = meta.defaultTeam?.team || meta.team || meta.identity?.team || defaultTeamId() || null;
  if (!label && !team) return null;
  const from = meta.defaultTeam?.from === "soul" ? "soul" : "deployment";
  return { label, team, from };
}
function teamsDocument(meta = readCapabilityMeta()) {
  const teams = parseOatsTeams();
  const joined = joinedTeamsOf(meta);
  const joinedLabels = new Set(joined.map((j) => j.label));
  return {
    defaultTeam: defaultTeamObject(meta),
    eligible: teams.filter((t) => !t.default && t.team).map((t) => ({ label: t.label, team: t.team, joined: joinedLabels.has(t.label), from: t.from })),        
    joined: joined.map((j) => ({ label: j.label, team: j.team, identityHome: j.identityHome, receive: j.receive || "poll", since: j.since })),
    left: leftTeamsOf(meta),
    at: new Date().toISOString(),
  };
}
function mintJoinedTeam(row, meta) {
  const existing = joinedTeamsOf(meta).find((j) => j.label === row.label);
  if (existing) return { meta, joined: existing, changed: false };
  const identityHome = identityHomeForLabel(row.label);
  const root = awebRootForTeam(row.team);
  if (!root) throw new Error(`${awebRootProblem(rootSettingCandidate(row.team))}, so team ${row.label} could not be joined`);
  const inv = parseSecretJson(run(["aw", "team", "invite", flagEq("--team-id", row.team), "--json"], root, 45000, { secretSafe: true }), "aw team invite");
  if (!inv?.token || typeof inv.token !== "string") throw new Error(`aw team invite returned no usable token for ${row.label}`);
  const { joined } = acceptConnectVerifyJoinedTeam({ label: row.label, token: inv.token, identityHome, alias: instance || meta.alias, expectedTeam: row.team, root, cwd: home, serviceDocs: [inv] });
  const next = { ...meta, joinedTeams: [...joinedTeamsOf(meta), joined] };
  return { meta: next, joined, changed: true };
}
function leaveJoinedTeam(label, meta) {
  const joined = joinedTeamsOf(meta);
  const entry = joined.find((j) => j.label === label);
  if (!entry) return { meta, changed: false };
  const { released, receipt } = cleanupJoinedIdentity(entry, meta.alias || instance, home);
  return { meta: { ...meta, joinedTeams: joined.filter((j) => j.label !== label) }, changed: true, released, receipt };
}
function awebRootForTeam(team) {
  const declared = declaredRootCandidate(team);
  if (declared && isAbsolute(declared.root) && existsSync(join(resolve(declared.root), ".aw"))) return resolve(declared.root);
  if (declared?.declared) return undefined;
  const candidate = rootSettingCandidate(team);
  if (candidate && isAbsolute(candidate.root) && existsSync(join(resolve(candidate.root), ".aw"))) return resolve(candidate.root);
  return undefined;
}
let forwardedSoulArg;
function stripForwardedSoul(argv = process.argv.slice(3)) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--soul") { if (i + 1 < argv.length) forwardedSoulArg = argv[++i]; continue; }
    if (arg.startsWith("--soul=")) { forwardedSoulArg = arg.slice("--soul=".length); continue; }
    out.push(arg);
  }
  return out;
}
function parseHomeCommandArgs(argv = process.argv.slice(3)) {
  argv = stripForwardedSoul(argv);
  const rest = [];
  let json = false, labels;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") { json = true; continue; }
    if (arg === "--home" && argv[i + 1]) { home = resolve(argv[++i]); process.env.OATS_HOME = home; continue; }
    if (arg.startsWith("--home=")) { home = resolve(arg.slice("--home=".length)); process.env.OATS_HOME = home; continue; }
    if (arg === "--labels" && argv[i + 1]) { labels = argv[++i]; continue; }
    if (arg.startsWith("--labels=")) { labels = arg.slice("--labels=".length); continue; }
    rest.push(arg);
  }
  if (!labels && rest[0]) labels = rest[0];
  return { json, labels: labelsCsv(labels) };
}
function outputTeamsDocument(doc, json) {
  if (json) { console.log(JSON.stringify(doc)); return; }
  console.log(`default team: ${doc.defaultTeam ? `${doc.defaultTeam.label} (${doc.defaultTeam.team || "unmapped"})` : "none"}`);
  for (const row of doc.eligible) console.log(`${row.joined ? "joined" : "eligible"}: ${row.label} (${row.team})`);
  for (const row of doc.joined || []) if (!(doc.eligible || []).some((e) => e.label === row.label)) console.log(`joined: ${row.label} (${row.team})`);
  for (const row of doc.left || []) console.log(`left: ${row.label} (${row.team}) ${row.reason}`);
  for (const warning of doc.warnings || []) console.log(`warning: ${warning}`);
}
const actionWarning = (warning) => String(warning || "").slice(0, 300);
const registryOrigin = (value) => typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : undefined;
function registryOriginFromJoinedState(row, match, listed) {
  const fromJson = registryOrigin(match?.registry_origin || match?.registry_url || match?.registry || match?.awid_registry_url || listed?.registry_origin || listed?.registry_url || listed?.registry || listed?.awid_registry_url);
  if (fromJson) return { registry: fromJson };
  for (const file of ["identity.yaml", "teams.yaml", "workspace.yaml", "registry.yaml", "config.yaml"]) {
    try {
      const text = readFileSync(join(row.identityHome, file), "utf8");
      for (const key of ["awid_registry_url", "registry_origin", "registry_url", "registry"]) {
        const found = registryOrigin(yamlScalar(text, key));
        if (found) return { registry: found };
      }
    } catch { /* keep looking */ }
  }
  const fromEnv = registryOrigin(process.env.AWID_REGISTRY_URL);
  if (fromEnv) return { registry: fromEnv };
  return { registry: null, registryError: "registry origin could not be determined from the joined identity; command omits --registry and aw will use its default" };
}
function certificateIdFromJoinedCertificateFile(row) {
  const certFile = join(row.identityHome, "team-certs", `${String(row.team || "").replace(/:/g, "__")}.pem`);
  if (!existsSync(certFile)) return { found: false };
  try {
    const cert = JSON.parse(readFileSync(certFile, "utf8"));
    if (cert?.team_id !== row.team) return { found: false, error: `certificate file ${certFile} is for ${cert?.team_id || "unknown team"}, not ${row.team}` };
    const certificateId = typeof cert?.certificate_id === "string" ? cert.certificate_id.trim() : "";
    if (!certificateId) return { found: false, error: `certificate file ${certFile} did not contain a certificate_id for ${row.team}` };
    return { found: true, certificateId };
  } catch (e) {
    return { found: false, error: `could not read certificate file ${certFile}: ${e.message || e}` };
  }
}
function certificateIdForJoinedTeam(row) {
  const fromFile = certificateIdFromJoinedCertificateFile(row);
  let listed, match, listError;
  try {
    listed = parseAwJson(run(awWithIdentity(row.identityHome, ["id", "team", "list", "--json"]), home, 60000), "aw id team list");
    const memberships = teamMemberships(listed);
    match = memberships.find((m) => String(m?.team_id || m?.id || m?.team || m) === row.team);
  } catch (e) {
    listError = actionWarning(e.message || e);
  }
  const registry = registryOriginFromJoinedState(row, match, listed);
  if (fromFile.found) return { certificateId: fromFile.certificateId, ...registry };
  if (match) {
    const certificateId = match && typeof match === "object" ? (match.certificate_id || match.cert_id || match.certId || match.certificate?.id || match.cert?.id) : undefined;
    if (typeof certificateId === "string" && certificateId.trim()) return { certificateId: certificateId.trim(), ...registry };
    return { certificateId: null, certificateIdError: fromFile.error || `certificate id for ${row.team} was not present in the joined certificate file or aw id team list --json`, ...registry };
  }
  return { certificateId: null, certificateIdError: fromFile.error || listError || `aw id team list --json returned no membership for ${row.team}`, ...registry };
}
function failedLeaveDisposition(row, error) {
  const text = String(error?.message || error || "");
  const reason = /team_not_hosted/i.test(text) ? "team_not_hosted" : actionWarning(text);
  const data = { label: row.label, team: row.team, alias: row.alias || instance || null, ...certificateIdForJoinedTeam(row), at: new Date().toISOString(), reason, ...(reason === "team_not_hosted" ? { cleanup: "controller" } : {}) };
  const teamName = String(row.team || "").split(":")[0] || row.team;
  const namespace = String(row.team || "").includes(":") ? String(row.team).split(":").slice(1).join(":") : "<namespace>";
  const registryArg = data.registry ? ` --registry ${data.registry}` : "";
  const command = reason === "team_not_hosted" && data.certificateId ? `aw id team remove-member --namespace ${namespace} --team ${teamName} --cert-id ${data.certificateId}${registryArg} --json` : undefined;
  const ownerCommand = command
    ? `; controller cleanup: ${command}${data.registryError ? ` (${data.registryError})` : ""}`
    : reason === "team_not_hosted"
      ? `; controller cleanup needs the certificate id, but ${data.certificateIdError || "it could not be read"}${data.registryError ? ` (${data.registryError})` : ""}`
      : "";
  return { data: { ...data, ...(command ? { command } : {}) }, warning: `joined team ${row.label} cleanup failed: ${data.reason}${ownerCommand}` };
}
function runTeamsCommand(kind) {
  const args = parseHomeCommandArgs();
  let meta = readCapabilityMeta();
  const actions = [];
  const warnings = [];
  if (kind === "join" || kind === "leave") {
    if (identityMode === "global" || meta.identity?.mode === "global") {
      const error = new Error('joined teams need local per-team identities; this home acts as a resident identity through a session grant (identity.mode "global")');
      error.code = "E_TEAM_GLOBAL_MODE";
      throw error;
    }
    const rows = validateJoinLabels(args.labels, { action: kind });
    if (!rows.length) { const error = new Error("labels are required"); error.code = "E_BAD_ARGS"; throw error; }
    // Record every completed label even when a later one fails: a confirmed
    // leave deleted its home, and a join created a remote identity.
    try {
      for (const row of rows) {
        const result = kind === "join" ? mintJoinedTeam(row, meta) : leaveJoinedTeam(row.label, meta);
        meta = result.meta;
        writeProviderTeamsState(meta);
        const boundedWarning = result.warning ? actionWarning(result.warning) : undefined;
        actions.push({ action: kind, label: row.label, ...(result.released ? { released: result.released } : {}), ...(result.receipt ? { receipt: result.receipt } : {}), ...(boundedWarning ? { warning: boundedWarning } : {}) });
        if (boundedWarning) warnings.push(`oats-aweb: ${boundedWarning}`);
      }
    } catch (e) {
      // What already happened travels with the failure, so a caller can
      // reconcile (the operation envelope carries it as error.details).
      e.partial = { actions };
      throw e;
    } finally {
      const synced = syncWakeReceive(meta);
      meta = synced.meta;
      for (const w of synced.warnings) warnings.push(`oats-aweb: ${w}`);
      writeProviderTeamsState(meta);
    }
  }
  const doc = { ...teamsDocument(meta), ...(actions.length ? { actions } : {}), ...(warnings.length ? { warnings } : {}) };
  if (operation) operationOk(doc);
  outputTeamsDocument(doc, args.json);
}

/** The primary identity's team comes only from the kernel's team-model v2
 *  default env. Never fall back to the root's active team. */
function resolvePrimaryTeam() {
  const warnings = [];
  const team = defaultTeamId();
  if (!team) fatal(teamConfigRemedy());
  const root = awebRootForTeam(team);
  if (!root) fatal(`${awebRootProblem(rootSettingCandidate(team))}, so default team ${defaultTeamLabel() || team} (${team}) could not mint this instance; run oats aweb setup or ask the team's owner for an invite`);
  return { team, root, from: defaultTeamFromEnv(), label: defaultTeamLabel(), warnings };
}
function appendProviderEvent(kind, data) {
  try {
    const row = { eventsApi: 2, at: new Date().toISOString(), instance, home, incarnation: null, producer: "oats.aweb", kind, data };
    appendFileSync(join(home, ".oats-events.jsonl"), JSON.stringify(row) + "\n");
  } catch { /* evidence only */ }
}

/** The home's runtime. Spawn and launch run in the session's own env; a
 *  join/leave may be run by another agent whose OATS_RUNTIME is its own. */
function instanceRuntime(meta = {}) {
  const own = ["spawn", "launch"].includes(event) ? process.env.OATS_RUNTIME : undefined;
  if (own) return own;
  if (meta.runtime) return meta.runtime;
  try { const r = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).runtime; if (r) return r; } catch { /* fall through */ }
  return process.env.OATS_RUNTIME || undefined;
}
function primaryIdentityHomeOf(meta = {}) {
  return meta.identity?.mode === "global" && meta.identity?.grant?.home ? meta.identity.grant.home : join(home, ".aw");
}
/** Keep the host wake broker's registration for this home in step with the
 *  joined teams, and record each joined team's receive mode. Never throws: a
 *  refused registration leaves that team poll-only with a warning. */
function syncWakeReceive(meta) {
  // A joined home that no longer exists would make aw refuse the whole
  // registration; it is stale provider state, not a receive identity.
  const joined = joinedTeamsOf(meta).filter((j) => existsSync(j.identityHome));
  const delivery = meta.delivery || deliveryMode;
  const runtime = instanceRuntime(meta);
  const primary = primaryIdentityHomeOf(meta);
  const doc = wakeRegistration({ home, primaryIdentityHome: primary, delivery, runtime, joined, backend: process.env.OATS_BACKEND });
  const warnings = [];
  let receive = "poll", wakeJoined = false;
  if (doc) {
    try { run(["aw", "wake", "register", "--registration-json", "-"], home, 60000, { input: JSON.stringify(doc) }); receive = "native"; wakeJoined = true; }
    catch (e) { warnings.push(`joined teams stay poll-only: aw wake register refused the multi-identity registration (${e.message || e})`); }
  } else if (joined.length && !runtimeDeliveryFor({ delivery, runtime })) {
    warnings.push(`joined teams receive by polling: runtime ${runtime || "unknown"} has no native presentation surface for the host wake broker`);
  }
  if (!wakeJoined && meta.wakeJoined) {
    // Back to one identity: a session home keeps its legacy registration, a
    // native home leaves the broker entirely.
    if (delivery === "session") { try { wakeRegister(home, primary); } catch (e) { warnings.push(String(e.message || e)); } }
    else if (!wakeDeregister(home)) warnings.push("aw wake deregister failed; the broker treats a stale registration as inactive on its own");
  }
  const next = { ...meta, ...(runtime ? { runtime } : {}), wakeJoined, joinedTeams: joinedTeamsOf(meta).map((j) => ({ ...j, receive: joined.includes(j) ? receive : "poll" })) };
  return { meta: next, warnings };
}

if (event === "launch") {
  if (identityMode === "global" || grantRenewMode() === "launch") globalGrantRenew();
  let oldMeta = withProviderTeams(JSON.parse(process.env.OATS_META || "{}"));
  const joined = joinedTeamsOf(oldMeta);
  if (joined.length && process.env.OATS_TEAMS_SOURCE === "live") {
    const eligible = new Set(eligibleTeams().map((t) => t.label));
    const warnings = [];
    for (const row of joined) if (!eligible.has(row.label)) {
      try {
        oldMeta = leaveJoinedTeam(row.label, oldMeta).meta;
        const left = { label: row.label, team: row.team, at: new Date().toISOString(), reason: "no-longer-eligible" };
        oldMeta = { ...oldMeta, left: [...leftTeamsOf(oldMeta), left].slice(-20) };
        appendProviderEvent("aweb-team-left", left);
        warnings.push(`left joined team ${row.label} because it is no longer eligible`);
      }
      catch (e) {
        const failed = failedLeaveDisposition(row, e);
        appendProviderEvent("aweb-team-leave-failed", failed.data);
        warnings.push(failed.warning);
      }
    }
    // Re-register what remains: the runtime may differ from the last session.
    const synced = syncWakeReceive(oldMeta);
    oldMeta = synced.meta;
    warnings.push(...synced.warnings);
    writeProviderTeamsState(oldMeta);
    out({ meta: oldMeta, ...retainedLaunchOutput(oldMeta), ...(warnings.length ? { warning: `oats-aweb: ${warnings.join(" | ")}` } : {}) });
  }
  if (joined.length) {
    const synced = syncWakeReceive(oldMeta);
    oldMeta = synced.meta;
    writeProviderTeamsState(oldMeta);
    out({ meta: oldMeta, ...retainedLaunchOutput(oldMeta), warning: ["oats-aweb: teams-unverified — keeping joined team memberships because live eligible teams are unavailable", ...synced.warnings.map((w) => `oats-aweb: ${w}`)].join(" | ") });
  }
  out(retainedLaunchOutput(oldMeta));
} else if (event === "spawn") {
  if (identityMode === "global" && identitySettings.source) fatal('identity.mode "global" cannot be combined with identity.source; use identity.mode "local" with identity.source for a retained seat, or identity.mode "global" with identity.resident for a resident grant');
  if (identityMode === "global" && requestedJoinLabels().length) fatal('settings.oats.aweb.join is supported only with local per-team identities; identity.mode "global" is explicit resident-grant mode');
  if (identityMode === "global") globalGrantSpawn();
  if (identityMode === "local" && settings.identity && typeof settings.identity === "object" && settings.identity.source) retainedSeatSpawn(String(settings.identity.source), settings.identity.takeOver === true);
  let joinRows;
  try { joinRows = validateJoinLabels(requestedJoinLabels()); }
  catch (e) { fatal(e.message || e); }
  let minted;                 // external identity, once `aw team join` succeeds
  let spawnMeta;              // with joined teams, once any is accepted
  try {
    // Team correctness: the kernel's default team id is the only source. ALWAYS
    // pass --team-id explicitly — never inherit whatever team happens to be
    // active at mint time — and verify the joined cert matches.
    // The instance name IS the discoverable alias (the team roster doubles as the
    // cross-machine instance directory).
    const primary = resolvePrimaryTeam();
    const { team, root } = primary;
    const warnings = [...primary.warnings];
    // Both of these carry the invite token — one mints it, the other spends it —
    // so neither their output nor their diagnostics may reach a log.
    const inv = parseSecretJson(run(["aw", "team", "invite", flagEq("--team-id", team), "--json"], root, 45000, { secretSafe: true }), "aw team invite");
    if (!inv?.token || typeof inv.token !== "string") fatal("aw team invite returned no usable token, so no identity could be minted");
    let raw;
    try {
      // 120 s: a join on a slow or flapping link is slow, not broken; a killed
      // join that completed server-side is caught below.
      raw = parseSecretJson(run(["aw", "team", "join", inv.token, flagEq("--name", instance), "--json"], home, JOIN_TIMEOUT_MS, { secrets: [inv.token], secretSafe: true }), "aw team join");
    } catch (e) {
      // The join may have completed after the CLI was killed or reported a
      // failure: if the home now holds a bound identity, that identity EXISTS
      // and must be reported so compensation retires it instead of orphaning it.
      if (joinedLate(home)) {
        const late = workspaceAliasOf(home);
        minted = { team, alias: late };
        fatal(`aw team join was reported failed (${e.message || e}) but the home now holds a bound identity "${late}" on ${team}; reported for compensation so it is retired, not orphaned`, minted);
      }
      // A retired alias keeps its certificate until aweb-abim ships, so a
      // re-spawn under the same name is refused by AWID. Say that, and the
      // remedy, instead of relaying a bare join error.
      if (e.aliasConflict) {
        fatal(`alias "${instance}" already holds a certificate on ${team} (a retired instance of that name is not reusable until aweb-abim ships), so no identity could be minted — ${ALIAS_REUSE_REMEDY}`);
      }
      throw e;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fatal("aw team join returned no usable result, so no identity could be minted", minted);
    // The RESPONSE is not a safe place to take strings from. Suppressing the
    // failure paths does nothing if a successful reply is copied into meta and
    // the briefing verbatim: a response echoing the invite token back as the
    // alias would print it twice, on exit 0 (reviewer-a6aa1c5). Accept a field
    // only if it is a plausible value of its own kind and is not carrying the
    // token; otherwise fall back to what WE asked for, which is always known.
    const clean = (v) => (typeof v === "string" && v.trim() && !v.includes(inv.token) ? v.trim() : undefined);
    const joined = {
      alias: (() => { const a = clean(raw.alias); return a && AWEB_ALIAS_RE.test(a) ? a : instance; })(),
      // Team ids are "<name>:<domain>"; anything else is not one, and the
      // requested team is the honest fallback.
      team_id: (() => { const t = clean(raw.team_id); return t && /^[^\s:]+:[^\s:]+$/.test(t) ? t : team; })(),
    };
    // External state now exists. Record it immediately so any later failure can
    // still report it for compensation.
    minted = { team: joined.team_id, alias: joined.alias };
    run(["aw", "init", "--do-not-touch-agents-md"], home);
    const alias = joined.alias;
    const mismatch = joined.team_id !== team
      ? ` [WARNING: joined ${joined.team_id}, expected ${team}]` : "";
    // Runtime integration: for Claude Code sessions the aweb-channel plugin
    // carries real-time push events. This hook does NOT install it. The plugin
    // is a DECLARED runtime requirement (oats.json), consented once at
    // `oats install` and verified by the kernel before spawn — installing it here
    // would mutate the operator's Claude configuration without asking, inside a
    // spawn, which is exactly the silent host mutation the consent gate exists
    // to prevent. By the time this runs the kernel has already proven the plugin
    // is present and enabled, so contributing the flag is safe.
    // Session delivery: no channel flag, AWEB_DELIVERY=session in the launch
    // environment (declared in the manifest), and the truth about waking.
    const launch = (process.env.OATS_RUNTIME || "") === "claude" && deliveryMode === "channel"
      ? { claude: "--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace" }
      : undefined;
    const env = { ...(deliveryMode === "session" ? { AWEB_DELIVERY: "session" } : {}), AWEB_IDENTITY_HOME: join(home, ".aw") };
    const channelWarning = undefined;
    if (deliveryMode === "session") wakeRegister(home, join(home, ".aw"));
    const deliveryBrief = deliveryMode === "session"
      ? ` Notification delivery: external (AWEB_DELIVERY=session): the host wake broker (aw wake) is registered for this home and nudges you when mail or chat arrives; the native aweb channel is not running. If you have waited long with nothing arriving, check \`aw mail inbox\` and \`aw chat pending\` yourself at task boundaries.`
      : "";
    let meta = { team: joined.team_id, alias, delivery: deliveryMode, defaultTeam: { label: primary.label, team: joined.team_id, from: primary.from }, left: [], ...(process.env.OATS_RUNTIME ? { runtime: process.env.OATS_RUNTIME } : {}), identity: identityMeta({ mode: "local", alias, team: joined.team_id }) };
    for (const row of joinRows) { const result = mintJoinedTeam(row, meta); meta = result.meta; spawnMeta = meta; writeProviderTeamsState(meta); if (result.warning) warnings.push(`oats-aweb: ${result.warning}`); }
    if (joinedTeamsOf(meta).length) { const synced = syncWakeReceive(meta); meta = synced.meta; for (const w of synced.warnings) warnings.push(`oats-aweb: ${w}`); }
    writeProviderTeamsState(meta);
    const defaultTeamBrief = meta.defaultTeam.from === "soul" ? "the default team configured for this soul" : "this deployment's default team";
    const joinedNow = joinedTeamsOf(meta);
    const joinedBrief = joinedNow.length ? ` Joined teams: ${joinedNow.map((j) => `${j.label} (${j.team}, receive ${j.receive}, send with \`aw --identity-home ${j.identityHome} mail|chat ...\`)`).join("; ")}.` : "";
    out({
      meta,
      env,
      brief: `Comms: you have an aweb identity — alias "${alias}" on team ${joined.team_id}, ${defaultTeamBrief}.${mismatch}${deliveryBrief}${joinedBrief} Load the oats-aweb skill before messaging: \`oats aweb teams --json\` shows your teams, \`oats aweb roster\` who you can reach. Coordination stays in your deployment's task layer.`,
      ...(launch ? { launch } : {}),
      ...(joined.team_id !== team ? { warning: `oats-aweb: team mismatch — joined ${joined.team_id}, expected ${team}` } : warnings.length ? { warning: warnings.join(" | ") } : channelWarning ? { warning: channelWarning } : {}),
    });
  } catch (e) {
    // A join may already have created a REMOTE identity before the failure.
    // Hand it back as meta so the kernel's compensation can delete it — losing
    // it here would strand a roster entry no one owns.
    fatal(`identity minting failed: ${e.message || e}`, minted && joinedTeamsOf(spawnMeta).length ? { ...minted, joinedTeams: joinedTeamsOf(spawnMeta) } : minted);
  }
} else if (event === "retire") {
  let meta = withProviderTeams(JSON.parse(process.env.OATS_META || "{}"));
  const retireWarnings = [];
  const pendingControllerCleanup = [];
  const rememberControllerCleanup = (data) => {
    if (data?.cleanup === "controller") pendingControllerCleanup.push({ label: data.label, team: data.team, alias: data.alias, certificateId: data.certificateId, ...(data.command ? { command: data.command } : {}) });
  };
  const retiredMeta = (fields = {}) => ({ ...fields, ...(pendingControllerCleanup.length ? { pendingControllerCleanup } : {}) });
  if (hasStaleTeamSetting) retireWarnings.push(TEAM_SETTING_MESSAGE);
  // A retained seat: release the lock and leave the identity alone. Never
  // aw workspace delete (it would soft-delete the standing identity's row)
  // and never team retire; the source .aw stays until a human removes it.
  if (meta.delivery === "session" && (meta.retained || meta.identity?.mode !== "global")) { if (!wakeDeregister(home)) process.stderr.write("oats-aweb: aw wake deregister failed; the broker treats a retired home as inactive on its own\n"); }
  if (meta.identity?.mode === "global" && !meta.retained) globalGrantRetire(meta);
  for (const joined of joinedTeamsOf(meta)) {
    try { meta = leaveJoinedTeam(joined.label, meta).meta; }
    catch (e) { const failed = failedLeaveDisposition(joined, e); retireWarnings.push(failed.warning); rememberControllerCleanup(failed.data); }
  }
  // A native (channel/pi) home registered with the broker only for its joined
  // teams; a session home was deregistered above.
  if (meta.wakeJoined && meta.delivery !== "session") { if (!wakeDeregister(home)) retireWarnings.push("aw wake deregister failed; the broker treats a retired home as inactive on its own"); }
  meta = { ...meta, wakeJoined: false };
  writeProviderTeamsState(meta);
  if (meta.retained) {
    if (meta.lock) { try { rmSync(meta.lock, { force: true }); } catch { /* the lock may already be gone */ } }
    const retainedWarning = `released the retained identity "${meta.alias}" (lock ${meta.lock || "?"} removed); the identity itself and ${meta.source || "its source"} are untouched${meta.tookOverFrom ? `; this seat had taken over from ${meta.tookOverFrom}` : ""}`;
    out({ meta: retiredMeta({ retired: true, retained: true, identityReleased: true, joinedTeams: joinedTeamsOf(meta), ...(meta.tookOverFrom ? { tookOverFrom: meta.tookOverFrom } : {}) }), warning: `oats-aweb: ${[...retireWarnings, retainedWarning].join(" | ")}` });
  }
  // No alias means the spawn hook never reported an identity: nothing exists to
  // undo, which is completion. An alias WITH no local `.aw` is the opposite —
  // the remote record exists and its key is gone, so the self-delete cannot be
  // authenticated and the cleanup is incomplete, not vacuous (reviewer-602627c).
  // A home whose spawn hook could not report its alias (a join killed on
  // timeout that completed anyway) still carries the alias in its workspace
  // binding: use it rather than leaving the workspace orphaned.
  if (!meta.alias) { const late = workspaceAliasOf(home); if (late) meta = { ...meta, alias: late, aliasFromHome: true }; }
  if (!meta.alias) out({ meta: retiredMeta({ retired: false, reason: "nothing-to-delete" }) });
  if (!existsSync(join(home, ".aw"))) {
    out({ meta: retiredMeta({ retired: false, reason: "no-local-identity-key" }), warning: `oats-aweb: alias "${meta.alias}" was minted but ${join(home, ".aw")} is gone, so the remote record cannot be self-deleted and will linger until stale` }, 1);
  }
  try {
    // Self-delete from inside the home, authenticated by its own key — a remote
    // delete would 409 until the server marks the workspace stale. aw >= 1.36.13
    // reports whether the certificate was revoked and the alias was released.
    const raw = run(["aw", "workspace", "delete", meta.alias, "--json"], home);
    let doc; try { doc = JSON.parse(raw); } catch { doc = undefined; }
    const released = doc?.alias_released === true;
    const reason = typeof doc?.alias_released_reason === "string" ? doc.alias_released_reason : typeof doc?.reason === "string" ? doc.reason : (doc ? "unstated" : "no JSON answer");
    if (!released && /team_not_hosted/i.test(reason)) {
      const failed = failedLeaveDisposition({ label: "default", team: meta.team || meta.defaultTeam?.team || meta.identity?.team || defaultTeamId(), alias: meta.alias, identityHome: join(home, ".aw") }, reason);
      retireWarnings.push(failed.warning.replace(/^joined team default cleanup failed:/, "default identity cleanup failed:"));
      rememberControllerCleanup({ ...failed.data, label: "default" });
    }
    out({ meta: retiredMeta({ retired: true, aliasReusable: released, aliasReason: reason, joinedTeams: joinedTeamsOf(meta) }), ...(retireWarnings.length ? { warning: `oats-aweb: ${retireWarnings.join(" | ")}` } : released ? {} : { warning: `oats-aweb: workspace "${meta.alias}" deleted but its alias was not released (${reason}); spawn successors with a different --name (kernels 0.26.0+) or a different --purpose until it is` }) });
  } catch (e) {
    // Exit nonzero: during a required-hook rollback this is the signal that
    // compensation did NOT complete, so the spawn is not reported as cleanly
    // rolled back while a remote identity still exists.
    out({ meta: retiredMeta({ retired: false, reason: "self-delete-failed" }), warning: `oats-aweb: self-delete failed (the remote record will linger until stale): ${e.message || e}` }, 1);
  }
} else if (["teams", "join", "leave"].includes(event)) {
  try { runTeamsCommand(event); process.exit(0); }
  catch (e) {
    console.error(e.code ? `${e.code}: ${e.message}` : `oats aweb ${event}: ${e.message || e}`);
    if (operation) operationFail(e.code, e.message || String(e), e.partial ? { ...e.partial, joined: teamsDocument(readCapabilityMeta()).joined } : undefined);
    process.exit(1);
  }
} else if (event === "roster") {
  // Cross-machine directory: every OATS-spawned instance joins the team with
  // alias = instance name, so the team's member roster lists live instances
  // wherever they run (plus human members). Local liveness comes from
  // `oats status` in the deployment; this is the network view.
  // Default: this instance's default team, listed from the root that minted
  // it. `--label <label>` lists an eligible (joined or not) workspace team from
  // the host root that holds it.
  const argv = stripForwardedSoul(process.argv.slice(3));
  const labelAt = argv.indexOf("--label");
  const label = labelAt >= 0 ? argv[labelAt + 1] : (argv.find((a) => a.startsWith("--label=")) || "").slice("--label=".length) || undefined;
  const meta = readCapabilityMeta();
  let team, root;
  if (label) {
    const row = eligibleTeams().find((t) => t.label === label);
    if (!row) { console.error(`E_TEAM_NOT_ELIGIBLE: ${label} is not an eligible team label for this instance (eligible: ${eligibleTeams().map((t) => t.label).join(", ") || "(none)"})`); process.exit(1); }
    team = row.team; root = awebRootForTeam(team);
    if (!root) { console.error(`oats aweb roster: ${awebRootProblem(rootSettingCandidate(team))}, so the roster of ${label} cannot be read from this host`); process.exit(1); }
  } else {
    team = meta.defaultTeam?.team || meta.identity?.team || meta.team || defaultTeamId();
    root = awebRootForTeam(team);
    if (!root) { console.error(`oats aweb roster: ${awebRootProblem(rootSettingCandidate(team))}`); process.exit(1); }
  }
  if (!team) { console.error(`oats aweb roster: ${teamConfigRemedy()}`); process.exit(1); }
  const teamFlag = [flagEq(team.includes(":") ? "--team-id" : "--team", team)];
  const r = JSON.parse(run(["aw", "id", "team", "members", ...teamFlag, "--json"], root, 60000));
  if (argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`aweb team ${r.team_id || team} — member roster (cross-machine):`);
  const members = r.members || [];
  if (!members.length) console.log("  (no member certificates visible from this workspace)");
  for (const m of members) console.log(`  ${m.alias || m.name || m.did || JSON.stringify(m)}`);
  console.log(`\nAliases minted by OATS are instance names; message one with \`aw mail send --to <alias> --subject "..." --body-file <file>\`${label ? ` as this team: \`aw --identity-home <identityHome> mail send ...\` (identityHome from \`oats aweb teams --json\`)` : ""}.`);
  process.exit(0);
} else if (event === "setup") {
  // Guided onboarding — idempotent, prints what it finds and can run one
  // existing aw primitive when the operator supplies the needed authority.
  const args = stripForwardedSoul(process.argv.slice(3)).filter((arg) => arg !== "--json");
  const usage = "usage: oats aweb setup [--username <hosted-user> | --create <label> [--namespace <domain>] | --join <label> [--invite <token>] [--service <url>] [--name <alias>]]";
  let username, invite, createLabel, createNamespace, joinLabel, joinService, joinName;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--username" && args[i + 1]) { username = args[++i]; continue; }
    if (arg.startsWith("--username=") && arg.length > "--username=".length) { username = arg.slice("--username=".length); continue; }
    if (arg === "--invite" && args[i + 1]) { invite = args[++i]; continue; }
    if (arg.startsWith("--invite=") && arg.length > "--invite=".length) { invite = arg.slice("--invite=".length); continue; }
    if (arg === "--join" && args[i + 1]) { joinLabel = args[++i]; continue; }
    if (arg.startsWith("--join=") && arg.length > "--join=".length) { joinLabel = arg.slice("--join=".length); continue; }
    if (arg === "--create" && args[i + 1]) { createLabel = args[++i]; continue; }
    if (arg.startsWith("--create=") && arg.length > "--create=".length) { createLabel = arg.slice("--create=".length); continue; }
    if (arg === "--namespace" && args[i + 1]) { createNamespace = args[++i]; continue; }
    if (arg.startsWith("--namespace=") && arg.length > "--namespace=".length) { createNamespace = arg.slice("--namespace=".length); continue; }
    if (arg === "--service" && args[i + 1]) { joinService = args[++i]; continue; }
    if (arg.startsWith("--service=") && arg.length > "--service=".length) { joinService = arg.slice("--service=".length); continue; }
    if (arg === "--name" && args[i + 1]) { joinName = args[++i]; continue; }
    if (arg.startsWith("--name=") && arg.length > "--name=".length) { joinName = arg.slice("--name=".length); continue; }
    console.error(`oats aweb setup: ${usage}`);
    process.exit(2);
  }
  if (createNamespace && !createLabel) { console.error(`oats aweb setup: --namespace requires --create\n${usage}`); process.exit(2); }
  if (invite && !joinLabel) { console.error(`oats aweb setup: --invite requires --join <label> so the team gets its own root\n${usage}`); process.exit(2); }
  if ((joinService || joinName) && !joinLabel) { console.error(`oats aweb setup: --service/--name require --join <label>\n${usage}`); process.exit(2); }
  const apiKey = !!process.env.AWEB_API_KEY;
  const actions = [username ? "--username" : null, joinLabel ? "--join" : null, createLabel ? "--create" : null, apiKey && !createLabel ? "AWEB_API_KEY" : null].filter(Boolean);
  if (actions.length > 1) { console.error(`oats aweb setup: choose exactly one onboarding authority (${actions.join(", ")})\n${usage}`); process.exit(2); }

  const teamName = defaultTeamId();
  const teamId = defaultTeamId();
  const candidate = rootSettingCandidate(teamName);
  const scope = candidate?.root ? resolve(candidate.root) : process.cwd();
  console.log(`aweb onboarding — messaging root: ${scope}${teamName ? `, team: ${teamName}` : ""}\n`);
  if (!isAbsolute(scope)) {
    console.log(`${candidate?.key || "settings.oats.aweb.root"} must be an absolute directory whose .aw is the aweb minting root.`);
    process.exit(0);
  }

  const want = teamId || teamName;
  const defaultTeamForUsername = username ? `default:${username}.aweb.ai` : undefined;
  const readTeamsAt = (rootDir) => {
    try { return parseAwJson(run(["aw", "team", "list", "--json"], rootDir), "aw team list"); }
    catch { return { memberships: [] }; }
  };
  const readTeams = () => readTeamsAt(scope);
  const matchingTeam = (teams) => want ? teamIdsOf(teams).find((tid) => String(tid) === want || String(tid).startsWith(`${want}:`)) : undefined;
  const rootAlias = () => {
    try { const who = JSON.parse(run(["aw", "whoami", "--json"], scope)); return who.alias || who.name; } catch { return undefined; }
  };
  const setupAlias = () => {
    const alias = joinName || rootAlias();
    if (!alias || !AWEB_ALIAS_RE.test(alias)) throw new Error(`--name <alias> is required when no root identity is available; aliases must match the aweb 1-64 character rule`);
    return alias;
  };
  const setupResumeCommand = (label) => `oats aweb setup --soul ${setupSoulArg()} --join ${label} --service <url>`;
  const setupServiceDocs = (teamRoot) => {
    const docs = [];
    if (joinService) docs.push({ aweb_url: joinService });
    if (process.env.AWEB_URL) docs.push({ aweb_url: process.env.AWEB_URL });
    const addRoot = (rootDir) => {
      if (!rootDir || resolve(rootDir) === resolve(teamRoot || "")) return;
      try { const url = yamlScalar(readFileSync(join(resolve(rootDir), ".aw", "workspace.yaml"), "utf8"), "aweb_url"); if (url) docs.push({ aweb_url: url }); } catch { /* no service there */ }
    };
    const roots = settings.roots && typeof settings.roots === "object" && !Array.isArray(settings.roots) ? settings.roots : {};
    for (const rootDir of Object.values(roots)) if (typeof rootDir === "string") addRoot(rootDir);
    if (typeof settings.root === "string") addRoot(settings.root);
    addRoot(scope);
    return docs;
  };
  const hostedCreateUnavailable = () => "creating an additional hosted team needs hosted team creation (aweb-abkh), not yet released in aw or aweb Cloud; use --namespace <domain> for a team you control, or ask the aweb team";
  const candidateTeamId = (name) => `${name}:${createNamespace}`;
  const teamExistsError = (e) => e?.status === 409 || /\b409\b|\bconflict\b|\balready exists\b|\bexists\b/i.test(commandOutput(e));
  const configuredTeamForLabel = (label) => parseOatsTeams().find((t) => t.label === label && t.team)?.team || (label === defaultTeamLabel() ? defaultTeamId() : undefined);
  const acceptIntoTeamRoot = (label, token, expectedTeam, ...serviceDocs) => {
    const teamRoot = perTeamRoot(process.env.OATS_WORKSPACE || scope, label);
    const idHome = join(teamRoot, ".aw");
    const resumeCommand = setupResumeCommand(label);
    const docs = [...setupServiceDocs(teamRoot), ...serviceDocs];
    const recordTeam = expectedTeam || configuredTeamForLabel(label) || `<team for ${label}>`;
    assertAwebRootSettingRecordable(recordTeam, teamRoot, { start: process.env.OATS_WORKSPACE || scope });
    let joined;
    if (existsSync(join(idHome, "identity.yaml"))) {
      if (existsSync(join(idHome, "workspace.yaml"))) throw new Error(`team root ${teamRoot} already holds a connected aweb identity; choose a different label or remove the stale root deliberately`);
      joined = connectExistingJoinedTeam({ label, identityHome: idHome, expectedTeam: expectedTeam || configuredTeamForLabel(label), root: scope, cwd: teamRoot, serviceDocs: docs, resumeCommand });
    } else {
      if (!token || typeof token !== "string") throw new Error(`--join ${label} needs --invite <token> unless ${teamRoot} already holds an accepted unconnected identity to resume`);
      mkdirSync(teamRoot, { recursive: true });
      try {
        ({ joined } = acceptConnectVerifyJoinedTeam({ label, token, identityHome: idHome, alias: setupAlias(), expectedTeam: expectedTeam || configuredTeamForLabel(label), root: scope, cwd: teamRoot, serviceDocs: docs, cleanupOnFailure: false, resumeCommand, useAcceptedService: false }));
      } catch (e) {
        if (!existsSync(idHome)) { try { rmSync(teamRoot, { recursive: true, force: true }); } catch { /* best effort after failure before identity creation */ } }
        throw e;
      }
    }
    recordAwebRootSetting(joined.team, teamRoot, { start: process.env.OATS_WORKSPACE || scope });
    return { team: joined.team, teamRoot };
  };
  const createTeam = (label) => {
    if (!createNamespace) throw new Error(hostedCreateUnavailable());
    const base = normalizeAwebTeamName(label);
    for (let n = 1; n <= 20; n++) {
      const name = n === 1 ? base : `${base}-${n}`;
      const expectedTeam = candidateTeamId(name);
      const createArgs = ["aw", "id", "team", "create", flagEq("--name", name), flagEq("--namespace", createNamespace), "--json"];
      try {
        const created = parseSecretJson(run(createArgs, scope, 120000, { secretSafe: true }), "aw id team create");
        if (!created?.team_id || typeof created.team_id !== "string") throw new Error("aw id team create returned no team_id");
        const team = created.team_id;
        const token = created.invite_token || created.invite || created.token;
        if (!token || typeof token !== "string") throw new Error("aw id team create returned no invite token");
        return acceptIntoTeamRoot(label, token, team, created);
      } catch (e) {
        if (!teamExistsError(e)) throw e;
        const teams = readTeams();
        if (teamIdsOf(teams).some((tid) => String(tid) === expectedTeam)) { recordAwebRootSetting(expectedTeam, scope, { start: process.env.OATS_WORKSPACE || scope }); return { team: expectedTeam, teamRoot: scope, reused: true }; }
        if (n === 20) throw new Error(`could not create a unique aweb team for ${JSON.stringify(label)} after suffixing through -20`);
      }
    }
  };
  const recordLocalTeam = (label, team) => {
    const cli = process.env.OATS_CLI_BIN;
    if (!cli) throw new Error("OATS_CLI_BIN is required to record a new local team");
    assertNotFlag(label, "team label");
    run([cli, "teams", "add", label, flagEq("--team", team)], process.cwd(), 60000);
  };
  const setupSoulArg = () => forwardedSoulArg || "<soul>";
  const missingSharedRows = () => parseOatsTeams().filter((t) => {
    if (t.from !== "shared" || !t.label || !t.team) return false;
    const teamRoot = awebRootForTeam(t.team);
    if (!teamRoot) return true;
    const ids = new Set(teamIdsOf(readTeamsAt(teamRoot)).map(String));
    return !ids.has(t.team);
  });
  const printSharedMissing = (rows) => {
    for (const row of rows) console.log(`team ${row.label} (${row.team}) is shared: ask its owner for an invite, then run \`oats aweb setup --soul ${setupSoulArg()} --join ${row.label} --invite <token>\``);
  };
  const printVerdict = (teams) => {
    const match = matchingTeam(teams);
    if (match) {
      console.log(`readiness: ready`);
      console.log(`✓ aweb workspace initialized and member of ${match}.`);
      if (teams.active_team && teams.active_team !== match) console.log(`  Note: active team is ${teams.active_team}; instances join ${match} explicitly, but consider \`aw team switch ${match}\`.`);
      console.log("  Done — spawned instances will join this team automatically (alias = instance name).");
      console.log("  Roster: `oats aweb roster`  ·  local: `oats status` (in the deployment)");
      return;
    }
    console.log(`readiness: needs-configuration`);
    if (!want) {
      console.log(`  no team: ${teamConfigRemedy()}`);
      const active = teams.active_team || teamIdsOf(teams)[0];
      if (active) console.log(`  This root is a member of ${active}; record it with \`oats teams add <label> --team ${active}\` and \`oats teams default <label>\`.`);
      else if (defaultTeamForUsername) console.log(`  New hosted users create ${defaultTeamForUsername}; map the workspace team to that id if this is the intended team.`);
      return;
    }
    console.log(`  Workspace initialized, but no membership matching "${want}".`);
    if (defaultTeamForUsername) console.log(`  New hosted users create ${defaultTeamForUsername}; record it with \`oats teams add <label> --team ${defaultTeamForUsername}\` and \`oats teams default <label>\`, then re-run setup.`);
    console.log("  Existing team path: ask a member for an invite token, then run `oats aweb setup --invite <token>` (uses `aw team join <token>` at the root).");
    console.log("  Team API-key path: set AWEB_API_KEY in the environment and run `oats aweb setup` (uses `aw init` at the root; the key is never printed).");
    console.log("  New hosted-account path: run `oats aweb setup --username <u>` (uses `aw init --new-account --username <u>` and creates default:<u>.aweb.ai).");
  };

  try {
    const hasRoot = existsSync(join(scope, ".aw"));
    let teams = hasRoot ? readTeams() : { memberships: [] };
    const unmappedDefault = !actions.length && defaultTeamLabel() && !defaultTeamId();
    if (unmappedDefault) {
      console.log(`team ${defaultTeamLabel()} has no provider id yet: ask its owner to run \`oats aweb setup --create ${defaultTeamLabel()} --namespace <domain>\` and commit the id, or ask the owner for an invite and run \`oats aweb setup --join ${defaultTeamLabel()} --invite <token>\`.`);
      process.exit(1);
    }
    const missingShared = !actions.length ? missingSharedRows() : [];
    if (missingShared.length) { printSharedMissing(missingShared); process.exit(1); }
    if (!hasRoot && !actions.length) {
      console.log(`No aweb workspace at the messaging root yet (${candidate?.key || "settings.oats.aweb.root"}).`);
      if (!want) console.log(`  Also choose the aweb team for this deployment: ${teamConfigRemedy()}.`);
      console.log("  Choose one guided setup path:");
      console.log("    oats aweb setup --username <u>     # runs `aw init --new-account --username <u>` and creates default:<u>.aweb.ai");
      console.log("    AWEB_API_KEY=<key> oats aweb setup  # runs `aw init` for the hosted team behind the key");
      console.log("    oats aweb setup --join <label> --invite <token>    # accepts into a new per-team root");
      console.log("  Or set settings.oats.aweb.root to an absolute directory whose .aw is the aweb minting root, then re-run setup.");
      console.log("  Own your domain? Use the aweb-team-membership skill for BYOT flows.");
      process.exit(0);
    }
    if (createLabel) {
      const label = createLabel;
      if (!createNamespace) throw new Error(hostedCreateUnavailable());
      mkdirSync(scope, { recursive: true });
      console.log(`Creating aweb team ${label} in namespace ${createNamespace} for a new per-team root.`);
      const created = createTeam(label);
      teams = readTeams();
      recordLocalTeam(label, created.team);
      console.log(`✓ created ${created.team}, ${created.reused ? `reused existing member root ${created.teamRoot}` : `accepted it into ${created.teamRoot}`}, recorded roots[${created.team}], and recorded local team ${label} with \`oats teams add ${label} --team ${created.team}\`.`);
      printVerdict(teams);
      process.exit(0);
    }
    if (joinLabel) {
      console.log(invite ? `Accepting invite for ${joinLabel} into a new per-team root (token withheld).` : `Resuming join for ${joinLabel} in its per-team root.`);
      const accepted = acceptIntoTeamRoot(joinLabel, invite, undefined);
      console.log(`✓ joined ${accepted.team} as ${joinLabel} in ${accepted.teamRoot}; recorded settings.oats.aweb.roots[${accepted.team}].`);
      process.exit(0);
    }
    if (hasRoot && !matchingTeam(teams) && !actions.length) { printVerdict(teams); process.exit(0); }
    if (!hasRoot || !matchingTeam(teams)) {
      if (actions.length) mkdirSync(scope, { recursive: true });
      if (username) {
        console.log(`Running aw init --new-account --username <u> at ${scope} (username withheld from repeated logs).`);
        run(["aw", "init", "--new-account", "--username", username], scope, 120000, { secrets: [username], unsetEnv: ["AWEB_API_KEY"] });
      } else if (apiKey) {
        console.log(`Running aw init at ${scope} with AWEB_API_KEY from the environment (key withheld).`);
        run(["aw", "init"], scope, 120000, { secretSafe: true });
      }
      teams = readTeams();
    }
    printVerdict(teams);
    process.exit(0);
  } catch (e) {
    console.error(`oats aweb setup: ${e.message || e}`);
    process.exit(1);
  }
} else {
  warn(`unknown event "${event}" (expected spawn|retire)`);
}
