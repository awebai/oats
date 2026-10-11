// #917 live runs with a real Claude, at the fixed head. Driven by run.sh; see README.md.
// Usage: node drive.mjs <oats-repo-at-the-head> <out-dir> <enter|notice>
//   enter:  Claude with its network denied, through the executable LIVE_ENTER_EXECUTABLE names
//           (macOS default: claude-sandboxed.sh, sandbox-exec; Linux: the operator's own isolation
//           wrapper), so the development-channel confirmation appears; the kernel must send one
//           Enter on a frame that equals entry one, and the start completes.
//   notice: Claude as installed, network up, with telemetry and non-essential traffic off, so its
//           channel gate reads false and it ignores the flag; the kernel must record flag-ignored,
//           launched, with no key.
//
// Everything lives in one scratch base made by the repository's own test fixture
// (test/helpers/v2-deployment.mjs): a bare workspace remote, a deployment with its own
// oats-local.yaml, an isolated HOME and a private TMUX_TMPDIR, so the `oats` tmux server is
// the scratch one, never the operator's. The soul `dev` composes no capability: no provider
// hook runs, no aweb identity is minted. Claude runs with a throwaway CLAUDE_CONFIG_DIR and
// HOME, a dummy API key and ANTHROPIC_BASE_URL on a dead local port. watch-panes.mjs reads the
// scratch server's panes (read-only) so each start's audited frame can be shown byte for byte.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [repoArg, outArg, mode] = process.argv.slice(2);
if (!repoArg || !outArg || !["enter", "notice"].includes(mode)) { console.error("usage: node drive.mjs <oats-repo> <out-dir> <enter|notice>"); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const repo = realpathSync(repoArg), out = resolve(outArg);
mkdirSync(out, { recursive: true });
// The real Claude binary: LIVE_ENTER_CLAUDE_BINARY, else Homebrew's on macOS and `command -v
// claude` on Linux, resolved once and recorded in host.json. LIVE_ENTER_CLAUDE replaces it ONLY for
// a mechanics dry run with a stub; the live proof is a run without it (run.sh refuses it unless asked).
const STUB = process.env.LIVE_ENTER_CLAUDE;
const PLATFORMS = ["darwin", "linux"];
if (!PLATFORMS.includes(process.platform)) { console.error(`unsupported platform ${process.platform}`); process.exit(2); }
const resolveClaude = () => {
  const r = spawnSync("sh", ["-c", "command -v claude"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) { console.error("claude is not on PATH"); process.exit(2); }
  return r.stdout.trim();
};
const CLAUDE_BINARY = STUB || process.env.LIVE_ENTER_CLAUDE_BINARY || (process.platform === "darwin" ? "/opt/homebrew/bin/claude" : resolveClaude());
// The enter run's network-denying executable: LIVE_ENTER_EXECUTABLE (an absolute path), else on
// macOS claude-sandboxed.sh, which names Homebrew's Claude itself, so a dry run's stub replaces it.
// Linux has no default: the operator brings the isolation wrapper. The launch configuration passes
// the binary to a wrapper as CLAUDE_BINARY, for a wrapper that wants it.
const ENTER_EXECUTABLE = process.env.LIVE_ENTER_EXECUTABLE || (process.platform === "darwin" ? (STUB || join(here, "claude-sandboxed.sh")) : STUB);
if (mode === "enter" && !ENTER_EXECUTABLE) { console.error("the enter run on Linux needs LIVE_ENTER_EXECUTABLE: the absolute path of your isolation wrapper"); process.exit(2); }
const EXECUTABLE = mode === "enter" ? ENTER_EXECUTABLE : CLAUDE_BINARY;
if (!isAbsolute(EXECUTABLE) || !isAbsolute(CLAUDE_BINARY)) { console.error(`the executable and the Claude binary must be absolute paths: ${EXECUTABLE}, ${CLAUDE_BINARY}`); process.exit(2); }
const wrapperEnv = EXECUTABLE !== CLAUDE_BINARY ? { CLAUDE_BINARY } : {};
// LIVE_ENTER_EXTRA_ENV: space-separated NAME=value pairs added to the launch configuration's env
// only (the telemetry A/B: "DISABLE_TELEMETRY=1"). Recorded in host.json.
const EXTRA_ENV = Object.fromEntries((process.env.LIVE_ENTER_EXTRA_ENV || "").split(/\s+/).filter(Boolean).map((pair) => {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(pair);
  if (!m) { console.error(`LIVE_ENTER_EXTRA_ENV: ${JSON.stringify(pair)} is not NAME=value`); process.exit(2); }
  return [m[1], m[2]];
}));
const DUMMY_KEY = "oats-fixture-no-credential"; // the A6 capture's dummy key, byte for byte
const NAME = "live-enter";

const load = (p) => import(pathToFileURL(join(repo, p)).href);
const { v2Deployment } = await load("test/helpers/v2-deployment.mjs");
const { claudeVersionOf, normalizeScreen, DEV_CHANNEL_ENTRIES, FLAG_IGNORED_ENTRIES, matchFlagIgnoredEntry } = await load("lib/launch-prompt-fixtures.mjs");
const YAML = createRequire(join(repo, "package.json"))("yaml");

const save = (name, value) => writeFileSync(join(out, name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
const step = (msg) => console.log(`\n== ${msg}`);
const fail = (msg) => { console.error(`FAIL: ${msg}`); throw new Error(msg); };

for (const f of [CLAUDE_BINARY, EXECUTABLE]) if (!existsSync(f)) fail(`${f} not found`);
// The version comes from the binary's real path, as the kernel reads it; the audit's own
// claudeVersion reads the executable, so through the wrapper it is `unknown`. Where the path
// carries no version (an npm install on Linux), it stays `unknown` and host.json adds what
// `claude --version` printed, taken by this script, never by the kernel.
const binaryVersion = claudeVersionOf(CLAUDE_BINARY);
const git = (...args) => { const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
const head = git("rev-parse", "HEAD");
const host = { mode, ranBy: userInfo().username, host: hostname(), platform: `${process.platform}-${process.arch}`,
  claudeBinary: CLAUDE_BINARY, claudeBinaryRealPath: realpathSync(CLAUDE_BINARY), ...binaryVersion,
  launchExecutable: EXECUTABLE, launchExecutableVersion: claudeVersionOf(EXECUTABLE),
  ...(Object.keys(wrapperEnv).length ? { wrapperEnv } : {}), ...(Object.keys(EXTRA_ENV).length ? { extraLaunchEnv: EXTRA_ENV } : {}), dryRunStub: !!STUB,
  // When the run's checkout is the live branch itself, its first parent is the #917 head.
  oatsHead: head, oatsHeadSubject: git("log", "-1", "--format=%s"), oatsHeadFirstParent: git("rev-parse", "HEAD^"),
  startedAt: new Date().toISOString() };
save("host.json", host);

step(`scratch deployment (test fixture: private TMUX_TMPDIR, isolated HOME, no capabilities); mode ${mode}`);
const fx = v2Deployment();
const socket = join(realpathSync(fx.env.TMUX_TMPDIR), `tmux-${process.getuid()}`, "oats");
const state = { base: fx.base, tmuxTmpdir: fx.env.TMUX_TMPDIR, deployment: fx.dep, socket };
save("state.json", state); // cleanup.sh reads this if the run stops early
console.log(JSON.stringify(state, null, 2));
const watcher = spawn(process.execPath, [join(here, "watch-panes.mjs"), socket, out], { stdio: ["pipe", "ignore", "inherit"] });

const home = join(realpathSync(fx.root), "dev", "instances", NAME);
const claudeHome = join(fx.base, "claude-home"), claudeConfig = join(fx.base, "claude-config");
mkdirSync(claudeHome, { recursive: true }); mkdirSync(claudeConfig, { recursive: true });
// Claude's temporary files stay in the scratch base too.
const claudeTmp = join(fx.base, "claude-tmp");
mkdirSync(claudeTmp, { recursive: true });
// The #886 A6 capture's environment, which showed the confirmation: CLAUDE_CONFIG_DIR, a dummy
// ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL on a dead local port, DISABLE_AUTOUPDATER, TERM and LANG.
// HOME, XDG_CACHE_HOME and TMPDIR are throwaway too, so nothing is written outside the base (A6 ran
// in a throwaway container, whose own HOME was throwaway).
// Never DISABLE_TELEMETRY, DO_NOT_TRACK or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC in `enter`:
// each turns GrowthBook off, and Claude then reads its channel gate (tengu_harbor) as false
// whatever the seeded cache says, ignores the flag and shows no confirmation. The `notice` run
// sets the two that the earlier live runs had, which is what produced the flag-ignored notice.
const throwawayEnv = { CLAUDE_CONFIG_DIR: claudeConfig, HOME: claudeHome, XDG_CACHE_HOME: join(claudeHome, ".cache"), TMPDIR: claudeTmp,
  DISABLE_AUTOUPDATER: "1", TERM: "xterm-256color", LANG: "C.UTF-8",
  ...(mode === "notice" ? { DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } : {}) };
if (binaryVersion.claudeVersion === "unknown") {
  // Taken through the run's own executable (in `enter`, the network-denying wrapper), in the
  // throwaway environment, by this script: the kernel never runs Claude to read a version.
  if (STUB) host.claudeVersionOutput = "not taken: dry-run stub";
  else {
    const r = spawnSync(EXECUTABLE, ["--version"], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, ...throwawayEnv, ...wrapperEnv } });
    host.claudeVersionOutput = r.error ? `failed: ${r.error.code ?? r.error.message}` : (r.stdout || r.stderr).trim();
  }
  save("host.json", host);
}

step("throwaway Claude config: onboarding, dummy-key approval, offline channel gate, trust for the home only");
const seeded = {
  hasCompletedOnboarding: true, lastOnboardingVersion: binaryVersion.claudeVersion, theme: "dark",
  customApiKeyResponses: { approved: [DUMMY_KEY.slice(-20)], rejected: [] },
  cachedGrowthBookFeatures: { tengu_harbor: true },
  projects: { [home]: { hasTrustDialogAccepted: true } },
};
writeFileSync(join(claudeConfig, ".claude.json"), JSON.stringify(seeded, null, 2));
save("seeded-claude.json", seeded);

step("launch configuration `live`: the development-channel flag as args, every value throwaway");
const localFile = join(fx.dep, "oats-local.yaml");
const local = YAML.parse(readFileSync(localFile, "utf8"));
local["launch-configs"] = { live: {
  harness: "claude", executable: EXECUTABLE,
  args: ["--dangerously-load-development-channels", "plugin:aweb-channel@awebai-marketplace"],
  env: { ...throwawayEnv, ANTHROPIC_API_KEY: DUMMY_KEY, ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ...wrapperEnv, ...EXTRA_ENV },
} };
writeFileSync(localFile, YAML.stringify(local, { lineWidth: 0 }));
save("oats-local.yaml", YAML.stringify(local, { lineWidth: 0 }));

const cli = (args) => {
  const r = fx.cli(args);
  let envelope; try { envelope = r.json(); } catch { envelope = { unparsed: r.stdout }; }
  return { status: r.status, envelope, stderr: r.stderr };
};
const events = () => {
  const file = join(home, ".oats-events.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "launch-prompt") : [];
};
const instance = () => JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
const pane = () => {
  const meta = instance(), t = meta.launchPromptTarget ?? meta.tmux;
  try { return execFileSync("tmux", ["-u", "-S", t.socket, "capture-pane", "-p", "-t", t.paneId ?? `=${t.session}:=${t.window}`], { encoding: "utf8", timeout: 5000 }); }
  catch (e) { return `capture failed: ${e.message}`; }
};
const frameOf = (sha) => { const f = join(out, "frames", `${sha}.txt`); return existsSync(f) ? readFileSync(f, "utf8") : null; };
// What one start shows: its record, its own launch-prompt rows, and the frame its rows audited.
const record = (label, result) => {
  save(`${label}-answer.json`, result);
  const meta = instance(), lp = meta.launchPrompts;
  const startId = lp?.startId ?? lp?.receipt?.[0]?.row?.data?.startId;
  const rows = events().filter((e) => e.data.startId === startId).map((e) => e.data);
  save(`${label}-launchPrompts.json`, { launched: meta.launched, launchPrompts: lp, launchPromptTarget: meta.launchPromptTarget ?? null });
  save(`${label}-events.json`, rows);
  save(`${label}-pane.txt`, pane());
  const keyRows = rows.filter((r) => r.key || ["attempted", "submitted", "failed", "uncertain"].includes(r.status));
  // The frame the kernel judged: the one it pressed Enter on, recognised as the notice, or blocked on.
  const audited = rows.find((r) => r.status === "attempted") ?? rows.find((r) => r.status === "flag-ignored") ?? rows.find((r) => r.status === "blocked");
  const frame = audited ? frameOf(audited.signatureDigest) : null;
  if (frame) save(`${label}-audited-frame.txt`, frame);
  const evidence = {
    status: lp?.status, reason: lp?.reason, launched: meta.launched, startId,
    rows: rows.map((r) => r.status), entry: audited?.signatureId ?? null, auditClaudeVersion: rows[0]?.claudeVersion ?? null,
    enterRows: keyRows.length, enterKeys: rows.filter((r) => r.status === "submitted" && r.key === "Enter").length,
    auditedFrameCaptured: !!frame,
    frameEqualsEntryOne: frame ? normalizeScreen(frame) === DEV_CHANNEL_ENTRIES[0].text : null,
    frameMatchesFlagIgnored: frame ? matchFlagIgnoredEntry(frame)?.id === FLAG_IGNORED_ENTRIES[0].id : null,
    claudeSessionShown: lp?.claudeSessionShown ?? false,
    warnings: result.envelope?.result?.warnings ?? null, error: result.envelope?.error?.message ?? null,
  };
  save(`${label}-evidence.json`, evidence);
  console.log(`${label}: exit ${result.status}, ${JSON.stringify(evidence, null, 2)}`);
  return evidence;
};
// What the run must show: LIVE_ENTER_EXPECT, else `completed` for enter and `flag-ignored` for
// notice. The telemetry A/B's run B is enter with LIVE_ENTER_EXPECT=flag-ignored.
const EXPECT = process.env.LIVE_ENTER_EXPECT || (mode === "enter" ? "completed" : "flag-ignored");
if (!["completed", "flag-ignored"].includes(EXPECT)) { console.error(`LIVE_ENTER_EXPECT must be completed or flag-ignored, not ${EXPECT}`); process.exit(2); }
// What the kernel's own record and rows must show, and what the witnessed frame must be.
const rowsShow = {
  completed: (e) => e.status === "completed" && e.launched === true && e.enterKeys === 1 && e.enterRows === 2
    && e.entry === DEV_CHANNEL_ENTRIES[0].id,
  "flag-ignored": (e) => e.status === "flag-ignored" && e.launched === true && e.enterRows === 0
    && e.entry === FLAG_IGNORED_ENTRIES[0].id
    && (e.warnings ?? []).some((w) => w.startsWith("Claude ignored --dangerously-load-development-channels:"))
    && !(e.warnings ?? []).some((w) => w.startsWith("This start passes")),
};
const frameShows = { completed: (e) => e.frameEqualsEntryOne === true, "flag-ignored": (e) => e.frameMatchesFlagIgnored === true };
// One start's verdict: `shown`; `frame-not-sampled` when the rows show the outcome but the witness
// holds no frame for the audited digest (it polls every 50 ms, and the kernel can act on a frame
// sooner); else `failed`.
const proves = (e) => !rowsShow[EXPECT](e) ? "failed" : !e.auditedFrameCaptured ? "frame-not-sampled" : frameShows[EXPECT](e) ? "shown" : "failed";
// Exit status: 0 shown, 3 shown by the rows with a frame not sampled, 1 anything else.
const FRAME_NOT_SAMPLED_EXIT = 3;

let exitCode = 0;
const verdict = {};
try {
  step(`oats spawn dev --name ${NAME} --launch-config live --json`);
  const spawned = record("spawn", cli(["spawn", "dev", "--name", NAME, "--launch-config", "live", "--json"]));
  verdict.spawn = proves(spawned);

  step("launch-config preview --home: the statement for the next start, nothing captured or sent");
  const preview = cli(["launch-config", "preview", "--home", home, "--json"]);
  save("preview.json", preview);
  console.log(`preview ok ${preview.envelope?.ok}, warnings: ${JSON.stringify(preview.envelope?.result?.warnings ?? null)}`);

  step("oats session restart --json (respawn: same pane, new process)");
  const restarted = record("restart", cli(["session", "restart", "--home", home, "--json"]));
  verdict.restart = proves(restarted);

  step(`oats retire ${NAME} --json`);
  save("retire-answer.json", cli(["retire", NAME, "--json"]));
  console.log(`home removed: ${!existsSync(home)}`);
  // enter: both starts show the Enter. notice: the restart carries it (a fresh config's first spawn
  // may keep the notice hidden, which blocks loudly with claudeSessionShown).
  // completed: both starts show the Enter. flag-ignored: the restart carries it (a fresh config's
  // first spawn may keep the notice hidden, which blocks loudly with claudeSessionShown).
  const required = EXPECT === "completed" ? [verdict.spawn, verdict.restart] : [verdict.restart];
  if (required.some((v) => v === "failed")) exitCode = 1;
  else if (required.some((v) => v === "frame-not-sampled")) exitCode = FRAME_NOT_SAMPLED_EXIT;
} catch (e) {
  exitCode = 1;
  console.error(e.stack || e.message);
} finally {
  watcher.stdin.end();
  step("cleanup: kill the private tmux server, check no process is left in the base, remove it");
  try { fx.cleanup(); console.log("fixture cleanup: no process left, base removed"); }
  catch (e) { exitCode = 1; console.error(`fixture cleanup reported: ${e.message} (run cleanup.sh ${out})`); }
  const leftovers = spawnSync("pgrep", ["-fl", state.base], { encoding: "utf8" }).stdout.trim();
  save("cleanup.json", { baseExists: existsSync(state.base), tmuxTmpdirExists: existsSync(state.tmuxTmpdir), processesNamingBase: leftovers || null });
  console.log(`base exists: ${existsSync(state.base)}; private TMUX_TMPDIR exists: ${existsSync(state.tmuxTmpdir)}; processes naming the base: ${leftovers || "none"}`);
  if (leftovers || existsSync(state.base) || existsSync(state.tmuxTmpdir)) exitCode = 1; // an unclean run fails, whatever it showed
  // For flag-ignored only the restart is required: a fresh config's spawn may keep the notice hidden.
  const requiredStarts = EXPECT === "completed" ? ["spawn", "restart"] : ["restart"];
  save("verdict.json", { mode, expect: EXPECT, required: requiredStarts, ...verdict, exitCode });
  console.log(`verdict: ${JSON.stringify({ mode, expect: EXPECT, required: requiredStarts, ...verdict, exitCode })}`);
}
process.exit(exitCode);
