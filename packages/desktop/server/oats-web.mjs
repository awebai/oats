#!/usr/bin/env node
/**
 * OATS desktop backend server — the app's local control-panel API.
 *
 *   node oats-web.mjs start [--port <n>] [--dir <agents-root-context>]
 *
 * A zero-dependency localhost HTTP server (spawned by the Electron main
 * process; the desktop renderer is its only client):
 *   GET  /api/panel                 roster JSON (instances, task, tmux state; local Git unobserved)
 *   GET  /api/agents                available agents (souls) per workspace root
 *   POST /api/spawn?ws=<id>         { action: prepare|apply|result, … } → preview-bound spawn (server/spawn-apply.mjs);
 *                                   { agent, agentsRoot, serverId, … } → execution-server spawn only
 *                                   (mutations require the installed `oats` CLI; see cliUnavailable)
 *   GET  /api/session/<instance>?lines=n   ANSI pane capture of the live session
 *   POST /api/keys/<instance>       { data } → raw key bytes into the session (no Enter)
 *   POST /api/interrupt/<instance>  sends Ctrl-C (Escape for pi/claude prompts stays manual)

 *   POST /api/instance-git?ws=<id>  { action: git|diff, selector, fileId?, revision?, indexRevision? } → qualified K1 read
 *   POST /api/workspace-sync?ws=<id> { action: read|sync } → `oats capabilities` / `oats sync` (workspace-v2)
 *   POST /api/models                { harness: pi|claude|codex } → advisory model catalog for the spawn modal
 *   GET  /api/cli                   CLI discovery status (bin, version, required range, tried)
 *   POST /api/cli/reprobe           re-run discovery; body { bin? } prioritizes a user-chosen binary
 *   POST /api/harvest/<instance>    the active provider’s harvest operation addressed by the exact --home; the CLI derives the recorded context
 *   GET  /api/brain/<agent>?ws=<id> agent "brain" JSON: soul (AGENTS.md, skills,
 *                                   knowledge tree) + per-instance artifacts (abs paths)
 *   GET  /api/file?path=<abs>       text file content, guarded to workspace roots + agent homes
 *
 * SECURITY: binds 127.0.0.1 ONLY. This process can type into your terminals.
 * Deployment model: every roster/header fact is the installed kernel's
 * `oats status --json` / `oats workspace status --json` (workspace model v2).
 * The server reads no deployment file and has no fallback reader.
 * Interaction model: terminal-direct (tmux send-keys / capture-pane) — the
 * feel of sitting at the agent's terminal; identical for pi and claude runs.
 */
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, realpathSync, accessSync, constants as fsConstants } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { scheduleRequest } from "./schedules.mjs";
import { capabilityRequest } from "./capabilities.mjs";
import { createDeploymentObserver } from "./deployment-observer.mjs";
import { createSoulCatalog } from "./soul-catalog.mjs";
import { createWorkspaceSyncBoundary, syncFailure } from "./workspace-sync.mjs";
import { instanceGitRequest } from "./instance-git.mjs";
import { lifecycleRequest } from "./instance-lifecycle.mjs";
import { readinessRequest } from './readiness.mjs';
import { readinessFailure } from '../renderer/readiness-contract.mjs';
import { spawnPreviewRequest } from './spawn-preview.mjs';
import { instanceEventsRequest } from './instance-events.mjs';
import { eventsFailure } from '../renderer/instance-events-contract.mjs';
import { spawnApplyRequest } from './spawn-apply.mjs';
import { spawnApplyFailure } from '../renderer/spawn-apply-contract.mjs';
import { previewFailure } from '../renderer/spawn-preview-contract.mjs';
import { forgeBoundary, FORGE_EPOCH_HEADER, validForgeEpoch } from "./forge.mjs";
import { createReviewPaste } from "./review-paste.mjs";
import { launchConfigRequest } from "./launch-configs.mjs";
import { automationsRequest, automationsFailure } from "./automations.mjs";
import { normalizeSoulColor } from "../renderer/soul-colors.mjs";
import { harnessFlag, HARNESSES } from "../renderer/harness-names.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const sub = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined;
};
const flagAll = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] && !args[i + 1].startsWith("--") ? [args[i + 1]] : []));

// "collect" is retired: the kernel owns roster collection and the CLI read is
// asynchronous. Terminal liveness runs in server/liveness.mjs children.
if (sub !== "start") {
  console.error("usage: oats-web.mjs start [--port <n>] [--dir <deployment>]...  (repeat --dir for multiple deployments)");
  process.exit(1);
}

// The packaged app never imports the framework checkout's kernel module and
// accepts no framework-root override; reads and mutations use the installed CLI.
const locator = await import(pathToFileURL(join(HERE, "..", "cli-locator.mjs")).href);
const adapter = await import(pathToFileURL(join(HERE, "..", "cli-adapter.mjs")).href);
const remote = await import(pathToFileURL(join(HERE, "remote-roster.mjs")).href);
let remoteGroups = [];
let remoteCollecting = false;

/** Deployments in view. Each --dir registers one (repeatable); no --dir means
 * the cwd. A deployment is identified by its canonical directory, exactly as
 * given to `oats --dir`; the kernel decides whether it is one. */
const ctxs = [...new Set((flagAll("dir").length ? flagAll("dir") : [process.cwd()]).map((d) => resolve(String(d))))];
const port = Number(flag("port") || 4820);
const DEBUG = flag("debug") === true || process.env.OATSWEB_DEBUG === "1";

/** Roots come ONLY from the kernel's observed `status.root`; before (or
 * without) an observation there is nothing to act on. No layout guess. */
function workspaceEntry(ctx) {
  const deployment = snapshot.byWs.get(ctx)?.deployment;
  const observed = deployment?.status === "observed";
  return { id: ctx, name: (observed && deployment.workspace?.name) || basename(ctx) || ctx, scope: ctx, team: null,
    roots: observed ? [deployment.root] : [] };
}
function workspaces() {
  return [...ctxs.map(workspaceEntry), ...remoteGroups.map(remote.remoteWorkspace)];
}
function workspaceById(id) {
  return workspaces().find((w) => w.id === id) || workspaces()[0];
}

/** Panel data is served from the latest observation and never blocks on a
 * CLI read: the renderer and main's readiness probes stay responsive. */
function panelData(wsId) {
  const all = workspaces();
  const ws = wsId ? workspaceById(wsId) : all[0];
  if (ws?.remote) return { ...remote.remotePanel(ws.group), workspaces: workspaceChoices(all) };
  const observed = ws ? snapshot.byWs.get(ws.id) : null;
  const instances = observed?.instances || [];
  return {
    workspace: ws ? { id: ws.id, name: ws.name, team: null } : null,
    workspaces: workspaceChoices(all),
    team: null,
    deployment: publicDeployment(observed?.deployment),
    generatedAt: observed?.generatedAt || new Date().toISOString(),
    running: instances.filter((i) => i.running).length,
    instances,
  };
}

/** The renderer's deployment facts: the header observation, reachability and
 * any unavailable reason. The private soul rows stay server-side. */
function publicDeployment(deployment) {
  if (!deployment) return { status: "pending" };
  if (deployment.status !== "observed") return deployment;
  const { souls: _souls, ...rest } = deployment;
  return rest;
}

function workspaceChoices(all = workspaces()) {
  return all.map((w) => ({ id: w.id, name: w.name, team: w.team, ...(w.remote ? { server: w.server, remote: true } : {}) }));
}

/* OATSWEB_PANELPROJ_BEGIN — the /api/panel per-instance contract projection.
   Extracted by packages/desktop/test/panel-projection.test.mjs via block
   markers so a dropped/typo'd field fails a real assertion (review
   2092e0f): the renderer's cluster grouping and ux-designer's overview
   consume exactly these fields. */
function projectPanelInstance(i) {
  return {
    instance: i.instance, agent: i.agent, description: i.description,
    // The reported harness only (harness-names.mjs reads a released kernel's runtime); never a guessed default.
    repo: i.repo, work: i.work, branch: i.branch || null, harness: i.harness || null,
    model: i.model || null, running: i.running, createdAt: i.createdAt,
    home: i.home, agentsRoot: i.agentsRoot,
    workspace: dirname(i.agentsRoot), repoName: (i.repo || dirname(i.agentsRoot)).split("/").pop(),
    parentInstance: i.parentInstance || null,
    // Agent relations (kernel contract, final): siblingInstance links a
    // declared sibling to a ROOT anchor; relation/relativeTo record what
    // was declared at spawn. Forwarded for cluster grouping and the
    // cluster-first overview (ux-designer reads /api/panel).
    siblingInstance: i.siblingInstance || null,
    relation: i.relation || null,
    relativeTo: i.relativeTo || null,
    ...(i.sessionTarget ? { sessionTarget: i.sessionTarget } : {}),
    runtimeState: i.runtimeState, runtimeError: i.runtimeError,
    tmux: i.tmux, git: null,
    // Workspace-model v2 facts exactly as `oats status --json` reported them:
    // module drift rows (or the recorded map when the workspace is
    // unreachable), the soul source and the served identity. Identity is
    // present only when a provider reported one — never synthesized.
    ...(i.modules !== undefined ? { modules: i.modules } : {}),
    ...(i.soul !== undefined ? { soul: i.soul } : {}),
    ...(i.identity !== undefined ? { identity: i.identity } : {}),
    // desktop-facts: the last session start, where the model came from, the messaging identity's address.
    ...(i.startedAt !== undefined ? { startedAt: i.startedAt } : {}),
    ...(i.modelFrom !== undefined ? { modelFrom: i.modelFrom } : {}),
    ...(i.identityAddress !== undefined ? { identityAddress: i.identityAddress } : {}),
    ...(i.retirePending ? { retirePending: true } : {}),
    ...(i.rollbackIncomplete ? { rollbackIncomplete: true } : {}),
    ...(i.captured ? { captured: true } : {}),
    team: i.team || null,
  };
}
/* OATSWEB_PANELPROJ_END */

/** Spawnable souls of a local v2 deployment: the kernel's spawn catalog
 * (`oats souls --json` — non-private souls of confirmed members, and external
 * souls, each with its declared work mode). Nothing is read from soul.yaml
 * here, and a soul outside the catalog is not offered for spawning. */
function agentsData(wsId) {
  const ws = wsId ? workspaceById(wsId) : workspaces()[0];
  if (ws?.remote) return { workspace: { id: ws.id, name: ws.name, server: ws.server }, agents: remote.remoteAgents(ws.group) };
  const deployment = ws ? snapshot.byWs.get(ws.id)?.deployment : null;
  const agents = [];
  let catalog = null;
  if (deployment?.status === "observed") {
    const root = deployment.root, context = dirname(root);
    const memberNames = new Map((deployment.workspaceStatus?.members || []).map((m) => [m.key, m.name]));
    const roster = new Map(deployment.souls.map((soul) => [soul.name, soul]));
    catalog = { reason: deployment.catalog?.reason ?? null, ambiguous: deployment.catalog?.ambiguous ?? [] };
    for (const soul of deployment.catalog?.souls || []) {
      const color = normalizeSoulColor(roster.get(soul.name)?.color);
      agents.push({
        name: soul.name, description: soul.description || "", kind: "persistent", work: soul.work,
        ...(color ? { color } : {}), ...(soul.team ? { team: soul.team } : {}), ...(Array.isArray(soul.labels) ? { labels: [...soul.labels] } : {}),
        // desktop-facts: whether a spawn here would refuse (problem), and the soul.yaml (path, url).
        ...(typeof soul.spawnable === "boolean" ? { spawnable: soul.spawnable, problem: soul.problem ?? null } : {}),
        ...(Object.hasOwn(soul, "file") ? { file: soul.file } : {}),
        origin: soul.origin || "", soulKind: soul.kind, repo: soul.repoKey || null, capability: null,
        soulSource: { repoKey: soul.repoKey ?? null, commit: soul.commit ?? null, path: soul.path ?? null },
        agentsRoot: root, workspace: context,
        repoName: memberNames.get(soul.repoKey) || (soul.kind === "external" ? "external" : soul.repoKey || ""),
      });
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { workspace: ws ? { id: ws.id, name: ws.name } : null, agents, ...(catalog ? { catalog } : {}) };
}

/* ── Model catalog (spawn-modal dropdown) ──
   pi: the authenticated `pi --list-models` catalog — ids are
   "provider/model" exactly as `oats spawn --model` (and pi --model) accept
   them. claude: the claude CLI's model ALIASES plus the anthropic-provider
   ids from the pi catalog when pi is installed (claude accepts full
   claude-* model names). Advisory ONLY: the renderer keeps the field
   free-text (comma-separated preference lists stay valid) and the server
   never gates /api/spawn on catalog membership. Failures resolve to an
   empty list — a missing pi must not break the spawn modal.
   SECURITY (review 9b1e3ff): every cache miss executes a child process
   (pi, possibly a login shell), so this is a POST — POST /api/models
   { harness } → { harness, models: [{ id, label }] } — behind the server's
   Origin guard: a GET with its own Origin check is bypassable by <img>/
   no-cors requests that omit the header, letting a hostile page fan out
   child processes against the fixed loopback port. All concurrent misses
   COALESCE behind one in-flight catalog promise — at most one probe runs
   regardless of request fan-in. */
const CLAUDE_MODEL_ALIASES = ["opus", "sonnet", "haiku", "sonnet[1m]"];
const MODELS_TTL_MS = 60_000;
const modelsCache = new Map(); // harness → { at, models }
function execCapture(cmd, cmdArgs) {
  return new Promise((ok) => {
    execFile(cmd, cmdArgs, { encoding: "utf8", timeout: 10_000, shell: false, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => ok(err ? null : String(stdout)));
  });
}
/* OATSWEB_MODELPARSE_BEGIN — `pi --list-models` stdout → ["provider/model"]
   (header dropped). Extracted by test/desktop-server.test.mjs via block
   markers. */
function parsePiModelList(out) {
  const models = [];
  for (const line of String(out || "").split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2 || cols[0] === "provider") continue;
    models.push(`${cols[0]}/${cols[1]}`);
  }
  return models;
}
/* OATSWEB_MODELPARSE_END */
async function piModelCatalog() {
  // Direct PATH first; a GUI-launched Electron often lacks the login PATH,
  // so fall back to the user's login shell (same pattern as the CLI probe).
  let out = await execCapture("pi", ["--list-models"]);
  if (out === null) {
    const sh = process.env.SHELL || "/bin/sh";
    out = await execCapture(sh, ["-l", "-c", "pi --list-models"]);
  }
  return parsePiModelList(out);
}
// Coalesced probe: concurrent cache misses share ONE child-process run.
let piCatalogInflight = null;
function piModelCatalogOnce() {
  if (!piCatalogInflight) {
    piCatalogInflight = piModelCatalog().finally(() => { piCatalogInflight = null; });
  }
  return piCatalogInflight;
}
async function modelsData(harness) {
  const cached = modelsCache.get(harness);
  if (cached && Date.now() - cached.at < MODELS_TTL_MS) return cached.models;
  // Codex has its own configured providers; Pi's catalog is not authoritative.
  // The model field accepts an explicit id or an empty value for native defaults.
  if (harness === "codex") return [];
  const catalog = await piModelCatalogOnce();
  const models = harness === "pi"
    ? catalog.map((id) => ({ id, label: id }))
    : [
        ...CLAUDE_MODEL_ALIASES.map((id) => ({ id, label: `${id} (alias)` })),
        ...catalog.filter((id) => id.startsWith("anthropic/"))
          .map((id) => ({ id: id.slice("anthropic/".length), label: id.slice("anthropic/".length) })),
      ];
  modelsCache.set(harness, { at: Date.now(), models });
  return models;
}

/** Spawn an instance of an available agent through the discovered `oats` CLI
 * (Desktop CLI API v1) — the app never reimplements kernel spawn logic.
 * Default is NO TASK: the instance comes up awaiting instruction.
 * Validation errors THROW (→ 409); domain/CLI results RESOLVE with the
 * envelope so stable error codes reach the UI. */
/* OATSWEB_SPAWNERR_BEGIN — /api/spawn error shaping. Extracted by
   packages/desktop/test/panel-projection.test.mjs via block markers; the
   HTTP boundary itself is covered by test/desktop-cli-integration.test.mjs.
   Stable code for the degradation UI: cli-unavailable means "install or
   choose a compatible oats CLI", not "bad request". The 300-char cap guards
   against unbounded upstream text, but E_RELATIVE_AMBIGUOUS messages
   legitimately carry multiple absolute instance homes (case-d inherited
   edges) and the renderer surfaces them VERBATIM — any fixed cap can eat
   the actionable tail for deeply nested paths (reviews f1e3211, 835a05f).
   This code's message passes through UNSLICED: it originates from the CLI
   JSON envelope, which the adapter already bounds (maxBuffer 4 MiB — the
   real upstream bound), and the renderer assigns it via textContent. */
function spawnErrorPayload(e) {
  const status = e.code === "cli-unavailable" ? 503 : 409;
  const message = String(e.message || e);
  return {
    status,
    body: {
      error: e.code === "E_RELATIVE_AMBIGUOUS" ? message : message.slice(0, 300),
      ...(e.code ? { code: e.code } : {}),
      ...(e.code === "E_TEAM_CONFLICT" && Array.isArray(e.labels) ? { labels: e.labels } : {}),
    },
  };
}
/* OATSWEB_SPAWNERR_END */

/** Execution-server spawn only (`--server`). A local spawn is always the
 * preview-bound prepare → apply of server/spawn-apply.mjs. */
async function spawnAgent({ agent, agentsRoot, task, purpose, relation, relativeTo, relativeRoot, harness, backend, model, yolo, launchConfig, serverId, wake }) {
  const name = String(agent || "");
  const root = resolve(String(agentsRoot || ""));
  const server = String(serverId);
  // agentsRoot must be one of the workspace roots this server was started for —
  // never spawn into an arbitrary caller-supplied directory.
  const known = workspaces().flatMap((w) => w.roots);
  const remoteSoul = remoteGroups.some((g) => g.server === server
    && remote.remoteAgents(g).some((a) => a.name === name && a.agentsRoot === agentsRoot));
  if (!remoteSoul && !known.some((r) => resolve(r) === root)) throw new Error(`unknown agents root "${agentsRoot}"`);
  // The agent is validated by the REMOTE kernel against its own workspace
  // (the same team repo on that host); the local roster only supplies the
  // name the operator picked.
  // Mutation boundary: a compatible installed CLI is required — degradation,
  // not a bundled kernel.
  if (!cliState.ok) {
    const err = new Error("spawning requires a compatible installed oats CLI — the desktop app does not bundle a kernel");
    err.code = "cli-unavailable";
    throw err;
  }
  // Local execution support is proven here for a local spawn; a remote spawn
  // is held to what the REMOTE advertises by the router (checkRemoteSupport),
  // and the local guard only needs the remote surface itself.
  locator.requireRemoteSupport(cliState, "spawn");
  if (launchConfig !== undefined) {
    if (!cliState.features?.includes("launch-config")) throw Object.assign(new Error("Update OATS to choose a launch configuration"), { code: "cli-no-launch-config" });
    locator.requireRemoteSupport(cliState, "launch-config");
  }
  if (wake !== undefined) {
    if (!cliState.features?.includes("schedule")) throw Object.assign(new Error("Update oats to configure recurring wake-ups"), { code: "cli-no-schedule" });
    locator.requireRemoteSupport(cliState, "schedule");
  }
  // Relation flags are a NEWER v1 surface: older v1 CLIs ignore unknown
  // spawn options and report success, silently creating an UNRELATED
  // instance. Fail closed instead of degrading silently (review f921f7d).
  const relErr = locator.relationSupportError(cliState, { relation, relativeTo });
  if (relErr) throw relErr;
  // Spawn-time relations: pass through to the CLI adapter, which owns the
  // argv allowlist and pair validation (relation ⇔ relativeTo) — invalid
  // values resolve as stable E_BAD_ARGS envelopes, never reach the CLI.
  const env = await adapter.cliSpawn(cliState.bin, {
    agent: name,
    workspaceDir: ctxs[0], // SSH routes choose their own remote cwd
    task: task ? String(task) : "",
    purpose: purpose ? String(purpose) : undefined,
    relation: relation ? String(relation) : undefined,
    relativeTo: relativeTo ? String(relativeTo) : undefined,
    // Anchor disambiguation: the renderer picker knows each instance's
    // agentsRoot; sending the pair makes related spawns unambiguous under
    // cross-root name shadowing (kernel E_RELATIVE_AMBIGUOUS otherwise).
    relativeRoot: relativeRoot ? String(relativeRoot) : undefined,
    // Harness/model overrides (spawn-modal options): adapter-allowlisted and
    // shape-validated there; empty means "agent definition default". The flag
    // is the local kernel's: its --server route translates for an older host.
    harness: harness ? String(harness) : undefined, harnessFlag: harnessFlag(cliState),
    backend: backend ? String(backend) : undefined,
    yolo,
    launchConfig,
    model: model ? String(model) : undefined,
    server,
    wake,
  });
  if (!env.ok) {
    const err = new Error(env.error.message || "spawn failed");
    err.code = env.error.code || "E_SPAWN_FAILED";
    throw err;
  }
  const r = env.result;
  if (r.server) void refreshRemoteSnapshot();
  const remoteWorkspaceId = remote.spawnedWorkspace(remoteGroups, r);
  return { instance: r.instance, agent: r.agent, home: r.home, work: r.work,
    ...(r.wakeSchedule ? { wakeSchedule: r.wakeSchedule } : {}),
    ...(r.wakeScheduleError ? { wakeScheduleError: r.wakeScheduleError } : {}),
    ...(r.routeConflict ? { routeConflict: r.routeConflict } : {}),
           branch: r.branch ?? null, launched: !!r.launched, warnings: r.warnings || [],
           tmux: r.tmux ?? null, ...(r.server ? { server: r.server, target: r.target,
             ...(remoteWorkspaceId ? { workspaceId: remoteWorkspaceId } : {}) } : {}) };
}

/* ── CLI discovery (Desktop CLI API v1) ──
   The server is the privileged process that runs mutations, so it owns the
   probe. The persisted user-chosen binary arrives from the Electron main
   process as --oats-bin (main owns persistence in userData); re-probe runs at
   startup, on explicit /api/cli/reprobe (app focus, Retry, choose). */
let cliState = { ok: false, probedAt: 0, tried: [] };
let cliProbeGeneration = 0;
// User-chosen binary: seeded from --oats-bin (main passes the persisted pick
// at server start) and updated by /api/cli/reprobe {bin} — top candidate on
// every subsequent probe until replaced.
let chosenBin = typeof flag("oats-bin") === "string" ? flag("oats-bin") : null;
const cliIo = {
  persisted: () => chosenBin,
  env: process.env,
  isExecutableFile: (p) => {
    try { const st = statSync(p); if (!st.isFile()) return false; accessSync(p, fsConstants.X_OK); return true; }
    catch { return false; }
  },
  canonicalize: (p) => realpathSync(p),
  // Slow sources — ASYNC (never block the serving event loop; review
  // 53a20c7) and evaluated lazily/at-most-once by the locator's source
  // ordering (they only run when every earlier candidate failed).
  npmGlobalBin: () => new Promise((ok) => {
    execFile("npm", ["prefix", "-g"], { encoding: "utf8", timeout: 5000, shell: false },
      (err, stdout) => ok(err ? null : (String(stdout).trim() ? join(String(stdout).trim(), "bin") : null)));
  }),
  loginShellWhich: () => new Promise((ok) => {
    const sh = process.env.SHELL || "/bin/sh";
    execFile(sh, ["-l", "-c", "command -v oats"], { encoding: "utf8", timeout: 5000, shell: false },
      (err, stdout) => { const out = String(stdout || "").trim(); ok(!err && out.startsWith("/") ? out : null); });
  }),
};
// Probe: REJECT on any execFile error — nonzero exit or timeout with
// plausible stdout must never yield the mutation binary (review 53a20c7).
const probeBin = (path) => new Promise((ok, bad) => {
  execFile(path, ["version", "--json"], { encoding: "utf8", timeout: 8000, shell: false, killSignal: "SIGKILL" },
    (err, stdout) => (err ? bad(err) : ok({ stdout })));
});
async function reprobeCli(chosen) {
  const generation = ++cliProbeGeneration;
  if (chosen) chosenBin = chosen;
  const r = await locator.discover(cliIo, probeBin);
  if (generation !== cliProbeGeneration) return cliState;
  cliState = { ...r, probedAt: Date.now() };
  void refreshSnapshot(); // the deployment observation belongs to the accepted CLI
  void refreshRemoteSnapshot();
  return cliState;
}
/** Stable diagnostics for the degradation card. */
function cliStatus() {
  return {
    ok: !!cliState.ok,
    bin: cliState.bin || null,
    version: cliState.version || null,
    source: cliState.source || null,
    required: { desktopApi: locator.DESKTOP_API, range: locator.ACCEPT_RANGE_TEXT },
    // The recovery command the degradation card offers, DERIVED rather than
    // spelled: Desktop and the kernel publish in lockstep from one tag, so
    // this app's own version names the exactly-matching CLI — always inside
    // the accepted band and never below a feature floor. A hand-pinned
    // command rots (it sat at 0.18.2 through four releases, i.e. below the
    // 0.18.6 spawn-relations floor it was telling users to install).
    install: `npm install -g @awebai/oats@${MANIFEST.version}`,
    // Capability flag for the spawn form: relation UI renders DISABLED
    // (never hidden) with the required version when the accepted CLI
    // predates spawn-time relations.
    harnesses: cliState.harnesses || ["pi", "claude"],
    harnessesSource: Array.isArray(cliState.harnesses) ? "reported" : "assumed",
    sessionBackends: cliState.sessionBackends || ["tmux"],
    launchOptions: cliState.launchOptions || [],
    features: cliState.features || [],
    scheduleApi: cliState.scheduleApi || null,
    scheduleHistoryApi: cliState.scheduleHistoryApi === 3 ? 3 : null,
    lifecycleApi: cliState.lifecycleApi === 1 ? 1 : null,
    readinessApi: cliState.readinessApi === 2 ? 2 : null,
    automationsApi: cliState.automationsApi === 1 ? 1 : null,
    // The inspector's gate (inspect on the workspace model); absent before, so
    // the Workspace inspector could never become available.
    operationsApi: cliState.operationsApi === 2 ? 2 : null,
    spawnPreviewApi: cliState.spawnPreviewApi === 2 ? 2 : null,
    spawnApplyApi: cliState.spawnApplyApi === 1 ? 1 : null,
    eventsApi: cliState.eventsApi === 2 ? 2 : null,
    workspaceApi: cliState.workspaceApi === 2 ? 2 : null,
    remote: cliState.remote || [],
    relations: !!cliState.ok && locator.supportsRelations(cliState.version),
    relationsMin: locator.RELATIONS_MIN.join("."),
    probedAt: cliState.probedAt || null,
    tried: cliState.tried || [],
  };
}

/* ── Non-blocking roster snapshot ──
/* ── Kernel-observed roster snapshot ──
   Every local deployment fact is one bounded `oats status --json` plus one
   `oats workspace status --json` (deployment-observer.mjs). Terminal liveness for
   the kernel-reported targets is observed in a separate short-lived child
   (server/liveness.mjs) so tmux/Herdr latency cannot stall key/echo handling.
   Local roster Git is null; only the on-demand K1 route observes Git. */
let snapshot = { at: 0, byWs: new Map() };   // wsId -> { deployment, instances, generatedAt } | remote panel
const DEPLOYMENT_REFRESH_MS = 5000;
const LIVENESS = join(HERE, "liveness.mjs");
const workspaceSyncRequest = createWorkspaceSyncBoundary();
const soulCatalog = createSoulCatalog();
const deploymentObserver = createDeploymentObserver({
  // Only a registered local deployment, with the CURRENT accepted CLI. The
  // probe generation is the revision: a reprobe revokes pending reads.
  getContext: (id) => ctxs.includes(id) ? { deployment: id, revision: cliProbeGeneration, cli: cliState } : null,
});
function observeLivenessRows(rows) {
  return new Promise((done) => {
    if (!rows.length) return done([]);
    const unknown = () => done(rows.map(() => ({ running: null, runtimeState: "unreachable", runtimeError: "Terminal status is unavailable" })));
    let child;
    try {
      child = execFile(process.execPath, [LIVENESS], { encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return unknown();
        try {
          const parsed = JSON.parse(stdout);
          return Array.isArray(parsed) && parsed.length === rows.length ? done(parsed) : unknown();
        } catch { return unknown(); }
      });
      child.stdin.on("error", () => { /* reported through the exit callback */ });
      child.stdin.end(JSON.stringify(rows));
    } catch { unknown(); }
  });
}
/** One deployment's panel entry. A transient busy/stale read keeps the last
 * observation; every other failure is shown as unavailable, with the kernel's
 * code/message or the missing feature's name, never as an empty roster. */
async function observeDeployment(id) {
  const previous = snapshot.byWs.get(id);
  // Before the first CLI probe settles there is no verdict to report.
  if (!cliState.probedAt) return previous || { deployment: { status: "pending" }, instances: [], generatedAt: new Date().toISOString() };
  const result = await deploymentObserver.observe(id);
  if (!result.ok) {
    if (previous && ["E_DEPLOYMENT_BUSY", "E_DEPLOYMENT_STALE"].includes(result.reason?.code)) return previous;
    return { deployment: { status: "unavailable", reason: result.reason }, instances: [], generatedAt: new Date().toISOString() };
  }
  const { roster, workspaceStatus } = result;
  // The spawn catalog is read only when the workspace moved (or the CLI changed).
  const catalog = await soulCatalog.observe(id, cliState, workspaceStatus);
  const rows = roster.agents.flatMap((agent) => agent.instances.map((instance) => ({
    ...instance, agent: instance.agent || agent.name, description: agent.description || "",
    team: agent.team || null, agentsRoot: roster.root,
  })));
  const liveness = await observeLivenessRows(rows.map((i) => ({ instance: i.instance, tmux: i.tmux, sessionTarget: i.sessionTarget })));
  const instances = rows.map((row, index) => projectPanelInstance({ ...row, ...liveness[index] }))
    .sort((a, b) => (a.running === b.running ? String(a.instance).localeCompare(b.instance) : a.running ? -1 : 1));
  return {
    deployment: { status: "observed", root: roster.root, workspace: workspaceStatus.workspace, workspaceStatus,
      reachable: roster.workspace ?? null, withheld: roster.withheld,
      souls: roster.agents.map(({ instances: _instances, ...soul }) => soul),
      catalog: { souls: catalog.souls, ambiguous: catalog.ambiguous, reason: catalog.reason } },
    instances, generatedAt: new Date().toISOString(),
  };
}
function mergeRemotePanels(byWs) {
  for (const id of byWs.keys()) if (id.startsWith("remote:")) byWs.delete(id);
  for (const group of remoteGroups) {
    const panel = remote.remotePanel(group);
    byWs.set(panel.workspace.id, panel);
  }
  return byWs;
}
async function refreshRemoteSnapshot() {
  if (remoteCollecting) return;
  if (!cliState.ok || !cliState.remote?.includes("roster")) {
    remoteGroups = []; mergeRemotePanels(snapshot.byWs); return;
  }
  remoteCollecting = true;
  const probe = cliState;
  try {
    const env = await adapter.cliRemoteRoster(probe.bin);
    if (cliState !== probe) return;
    const incoming = env.ok && Array.isArray(env.result?.groups)
      ? env.result.groups : remote.unavailableGroups(remoteGroups, env.error || { code: "E_REMOTE_ROSTER", message: "Remote roster unavailable" });
    incoming.forEach(remote.remotePanel); // validate before replacing the last readable roster
    remoteGroups = incoming;
    mergeRemotePanels(snapshot.byWs);
  } catch (e) {
    if (cliState !== probe) return;
    remoteGroups = remote.unavailableGroups(remoteGroups, { code: "E_REMOTE_ROSTER", message: `Remote roster unavailable: ${e.message}` });
    mergeRemotePanels(snapshot.byWs);
  } finally {
    remoteCollecting = false;
    if (cliState !== probe) void refreshRemoteSnapshot();
  }
}
let refreshing = null, refreshAgain = false;
/** Single-flight refresh; a request during a refresh schedules exactly one
 * follow-up (a mutation's result must be observed), never a queue. */
function refreshSnapshot() {
  if (refreshing) { refreshAgain = true; return refreshing; }
  refreshing = (async () => {
    const entries = await Promise.all(ctxs.map(async (id) => [id, await observeDeployment(id)]));
    const byWs = new Map(entries);
    for (const [id, panel] of snapshot.byWs) if (id.startsWith("remote:")) byWs.set(id, panel);
    snapshot = { at: Date.now(), byWs: mergeRemotePanels(byWs) };
  })().catch((e) => { if (DEBUG) console.log(`[snapshot] refresh failed: ${e.message}`); })
    .finally(() => { refreshing = null; if (refreshAgain) { refreshAgain = false; void refreshSnapshot(); } });
  return refreshing;
}
/* OATSWEB_FINDINST_BEGIN — workspace-scoped instance lookup, extracted by tests */
function findInstance(name, wsId, home, server) {
  // Snapshot-only: an unobserved deployment has no instances to act on.
  // With a ws scope, resolve ONLY in that workspace — same-named instances
  // exist across workspaces and "first match anywhere" picks the wrong one.
  // Same-named instances also exist across roots WITHIN one workspace, so
  // "first match in the workspace" is equally wrong for a privileged route:
  // an exact `home` qualifier resolves precisely; a bare name that matches
  // MORE THAN ONE instance in scope returns the AMBIGUOUS sentinel and the
  // route must refuse rather than act on an arbitrary pick (merged-state
  // review @7dd1e7b).
  let scope = wsId
    ? (snapshot.byWs.get(wsId)?.instances || [])
    : [...snapshot.byWs.values()].flatMap((d) => d.instances);
  // Per-instance HTTP references always name a host; absent means local.
  scope = scope.filter((i) => (i.server || "") === (server || ""));
  if (home) return scope.find((i) => i.instance === name && i.home === home);
  const hits = scope.filter((i) => i.instance === name);
  if (hits.length > 1) return findInstance.AMBIGUOUS;
  return hits[0];
}
findInstance.AMBIGUOUS = Symbol("ambiguous-instance");
/** Route helper: resolve or produce the 404/409 payload for send(). */
function resolveInstanceOr(name, wsId, home, server) {
  const inst = findInstance(name, wsId, home, server);
  if (inst === findInstance.AMBIGUOUS)
    return { error: { status: 409, body: { error: `instance name "${name}" is ambiguous in this workspace — pass the exact home qualifier`, code: "E_INSTANCE_AMBIGUOUS" } } };
  if (!inst) return { error: { status: 404, body: { error: `unknown instance "${name}"` } } };
  return { inst };
}
/* OATSWEB_FINDINST_END */

/* OATSWEB_HARVESTHOME_BEGIN — privileged-cwd containment, extracted by tests.
   The harvest CLI runs with cwd = the instance home. That home must be
   DERIVED and VERIFIED, never trusted from roster data alone: it must be the
   exact home the kernel's current status reported for this instance in a
   registered local deployment, canonicalize to <...>/instances/<name>, and
   stay inside that deployment's canonical directory. No layout is named. */
function harvestHome(inst) {
  if (!inst?.home || typeof inst.home !== "string" || inst.server) return null;
  let real;
  try { real = realpathSync(inst.home); } catch { return null; }
  if (basename(real) !== String(inst.instance) || basename(dirname(real)) !== "instances") return null;
  for (const w of workspaces()) {
    if (w.remote) continue;
    const reported = snapshot.byWs.get(w.id)?.instances || [];
    if (!reported.some((i) => !i.server && i.instance === inst.instance && i.home === inst.home)) continue;
    let scope;
    try { scope = realpathSync(w.id); } catch { continue; }
    if (real.startsWith(scope.endsWith(sep) ? scope : scope + sep)) return real;
  }
  return null;
}
/* OATSWEB_HARVESTHOME_END */

/* OATSWEB_TMUXTGT_BEGIN — exact-match anchored tmux target, extracted by
   tests. tmux -t targets are PREFIX-matched by default: in the 3s
   stale-snapshot window an exited window (reviewer-1) can prefix-match a
   similarly named live one (reviewer-15…), exposing its pane to capture or
   — worse — sending it keystrokes/Ctrl-C. `=` anchors each component to an
   exact match, so tmux errors out instead of silently prefix-matching (same
   pattern as packages/desktop/tmux-target.mjs on the attach path). */
function tmuxTarget(inst) {
  const s = String(inst?.tmux?.session ?? "");
  const w = String(inst?.tmux?.window ?? "");
  // conservative charset; ':' is the separator and '=' the anchor — both
  // forbidden inside components so a crafted name cannot re-shape the target
  if (!/^[\w@%.-]+$/.test(s) || !/^[\w@%.-]+$/.test(w)) throw new Error("invalid tmux target");
  return `=${s}:=${w}`;
}
/* OATSWEB_TMUXTGT_END */

function capture(inst, lines) {
  try {
    // No -J: joining wrapped rows would break the row-per-line grid mapping
    // (cursor_y is physical). Each output line is exactly one pane row.
    return execFileSync("tmux", ["capture-pane", "-p", "-e", "-t", tmuxTarget(inst), "-S", `-${Math.max(16, lines)}`],
      { encoding: "utf8", timeout: 4000 });
  } catch { return ""; }
}

/** Pane geometry + cursor + history depth in ONE tmux round-trip (these were
 * two display-message calls — attach latency is round-trip-bound).
 * cursor x/y are 0-based within the visible pane; "visible" reflects
 * cursor_flag and copy-mode (in copy mode the live cursor is not where
 * typing lands). history_size lets the client map capture lines to screen
 * rows deterministically (cursor row = history + cursor_y). */
/* OATSWEB_PANEINFO_BEGIN — active-pane geometry, extracted by tests (depends
   on tmuxTarget + execFileSync in scope). */
function paneInfo(inst) {
  try {
    // list-panes, NOT display-message: display-message -p -t <missing target>
    // silently falls back to a default context instead of erroring — the
    // anchored target must fail CLOSED on the read path too. The -f filter
    // selects the ACTIVE pane: capture-pane/send-keys on a window target
    // operate on the active pane, and list-panes emits all panes in index
    // order — row 0 is the wrong pane once the user splits and switches.
    const out = execFileSync("tmux", ["list-panes", "-t", tmuxTarget(inst), "-f", "#{pane_active}", "-F",
      "#{pane_width} #{pane_height} #{cursor_x} #{cursor_y} #{cursor_flag} #{pane_in_mode} #{history_size}"],
      { encoding: "utf8", timeout: 4000 }).trim().split("\n")[0].split(/\s+/).map(Number);
    return { size: { cols: out[0] || 80, rows: out[1] || 24, cx: out[2] || 0, cy: out[3] || 0,
                     cursor: out[4] === 1 && out[5] !== 1 },
             history: out[6] || 0 };
  } catch { return { size: { cols: 80, rows: 24, cx: 0, cy: 0, cursor: false }, history: 0 }; }
}
/* OATSWEB_PANEINFO_END */

/** Raw keystroke passthrough: bytes from the browser terminal go straight into
 * the pane via send-keys -H (hex bytes) — no key-name interpretation, no Enter. */
function sendKeys(inst, data, paste = false) {
  const s = String(data);
  if (paste || s.length > 512) {
    // Pastes (any size) and large payloads go through a tmux buffer as ONE
    // bracketed paste — raw carriage returns via send-keys would let a shell
    // or TUI submit/execute each line separately.
    execFileSync("tmux", ["load-buffer", "-b", "oatswebk", "-"], { input: s.replace(/\r\n?/g, "\n"), timeout: 4000 });
    execFileSync("tmux", ["paste-buffer", "-p", "-d", "-b", "oatswebk", "-t", tmuxTarget(inst)], { timeout: 4000 });
    return;
  }
  const bytes = [...Buffer.from(s, "utf8")].map((b) => b.toString(16).padStart(2, "0"));
  if (!bytes.length) return;
  // chunk to keep argv small
  for (let i = 0; i < bytes.length; i += 256) {
    execFileSync("tmux", ["send-keys", "-t", tmuxTarget(inst), "-H", ...bytes.slice(i, i + 256)], { timeout: 4000 });
  }
}

function sendInterrupt(inst) {
  execFileSync("tmux", ["send-keys", "-t", tmuxTarget(inst), "C-c"], { timeout: 4000 });
}

/* OATSWEB_KEYERR_BEGIN — safe error shaping for the /api/keys failure path,
   extracted by tests. exec errors embed the child argv (hex-encoded
   keystrokes) in e.message; only exit code and signal are safe to surface. */
function keySendError(e) {
  // execFileSync exposes normal non-zero exits as e.status; e.code carries
  // spawn-level errno strings (ETIMEDOUT, ENOENT). Prefer status.
  const code = e && (e.status ?? e.code) != null ? String(e.status ?? e.code) : "unknown";
  const signal = (e && e.signal) || "none";
  return { code, signal,
           log: `[keys] FAILED code=${code} signal=${signal}`,
           http: { error: `send-keys failed (code ${code}) — see the terminal directly` } };
}
/* OATSWEB_KEYERR_END */

// ---- Chat transcript: parse the runtime's session log into structured turns ----
// pi:     ~/.pi/agent/sessions/--<home with / -> ->--/<ts>_<id>.jsonl
// claude: ~/.claude*/projects/<cwd with / -> ->/<uuid>.jsonl
function latestFile(dir, filter = () => true) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".jsonl") && filter(f))
      .map((f) => join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  } catch { return undefined; }
}
function sessionFileFor(inst) {
  const home = inst.home;
  if ((inst.harness || "pi") === "pi") {
    const dir = join(homedir(), ".pi", "agent", "sessions", `-${home.replace(/\//g, "-")}--`);
    return { file: latestFile(dir), kind: "pi" };
  }
  const enc = home.replace(/\//g, "-");
  for (const base of [".claude", ".claude-personal", ".claude-work"]) {
    const dir = join(homedir(), base, "projects", enc);
    const f = latestFile(dir);
    if (f) return { file: f, kind: "claude" };
  }
  return { file: undefined, kind: "claude" };
}
const asText = (blocks, type = "text", key = "text") =>
  (Array.isArray(blocks) ? blocks : []).filter((b) => b?.type === type).map((b) => b[key] || "").join("\n");

export function parseTranscript(lines, kind) {
  const turns = [];
  const callIndex = new Map(); // toolCallId -> tool entry
  const push = (t) => { turns.push(t); return t; };
  for (const line of lines) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    const msg = kind === "pi" ? (d.type === "message" ? d.message : undefined)
                              : (d.type === "user" || d.type === "assistant" ? d.message : undefined);
    if (!msg) continue;
    const content = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: String(msg.content || "") }];
    if (msg.role === "user") {
      // claude folds tool_result into user messages; keep real user text only
      const toolResults = content.filter((b) => b.type === "tool_result");
      for (const r of toolResults) {
        const entry = callIndex.get(r.tool_use_id);
        if (entry) entry.result = (typeof r.content === "string" ? r.content : asText(r.content)).slice(0, 4000);
      }
      const text = asText(content).trim();
      if (text) push({ role: "user", text, ts: msg.timestamp || d.timestamp });
    } else if (msg.role === "assistant") {
      const text = asText(content).trim();
      const thinking = asText(content, "thinking", "thinking").trim();
      const tools = [];
      for (const b of content) {
        if (b.type !== "toolCall" && b.type !== "tool_use") continue;
        const entry = { id: b.id, name: b.name, args: b.arguments || b.input || {}, result: null };
        callIndex.set(b.id, entry);
        tools.push(entry);
      }
      if (text || thinking || tools.length) push({ role: "assistant", text, thinking, tools, ts: msg.timestamp || d.timestamp, model: msg.model });
    } else if (msg.role === "toolResult") {
      const entry = callIndex.get(msg.toolCallId);
      if (entry) entry.result = asText(content).slice(0, 4000);
    }
  }
  return turns;
}
function chatData(inst, limit = 120) {
  const { file, kind } = sessionFileFor(inst);
  if (!file) return { available: false, kind, turns: [] };
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return { available: false, kind, turns: [] }; }
  const turns = parseTranscript(text.split("\n").filter(Boolean), kind);
  return { available: true, kind, file, turns: turns.slice(-limit) };
}

// ---- Agent brain: soul + instance artifacts as absolute paths ----
// The desktop brain view renders this map; file CONTENT is fetched separately
// through /api/file (path-guarded there). The soul and its instances are the
// ones the kernel's current `oats status --json` reported for this workspace —
// never a caller-supplied path, soul.yaml lookup or manifest walk. Skill and
// knowledge files are content for viewing, read with per-file containment.
/** Display metadata of a SKILL.md: only the `name:`/`description:` scalars of
 * its frontmatter. Content presentation, not deployment configuration. */
function skillFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const meta = {};
  for (const line of m ? m[1].split(/\r?\n/) : []) {
    const f = line.match(/^(name|description):\s*(.*?)\s*$/);
    if (f) meta[f[1]] = f[2].replace(/^["']|["']$/g, "");
  }
  return meta;
}
/** The canonical path of `path` when it stays inside the canonical `parent`;
 * null otherwise (absent, or a symlink escaping the deployment). */
function canonicalInside(path, parent) {
  try {
    const real = realpathSync(path), base = realpathSync(parent);
    return real === base || real.startsWith(base.endsWith(sep) ? base : base + sep) ? real : null;
  } catch { return null; }
}
function containedIn(base) {
  let real;
  try { real = realpathSync(base); } catch { return () => false; }
  return (file) => { try { const target = realpathSync(file); return target === real || target.startsWith(real + sep); } catch { return false; } };
}
function listSkills(dir, contained) {
  // skills live as <dir>/<skill>/SKILL.md with `name`/`description` frontmatter
  const skills = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const s = skillEntry(join(dir, e.name), contained);
      if (s) skills.push(s);
    }
  } catch { /* no skills dir */ }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
function skillEntry(skillDir, contained) {
  const p = join(skillDir, "SKILL.md");
  if (!existsSync(p)) return null;
  // A nested SKILL.md symlink can escape its owning tree even when the tree
  // dir itself is contained — reject per file.
  if (contained && !contained(p)) return null;
  let meta = {};
  try { meta = skillFrontmatter(readFileSync(p, "utf8")); } catch { /* unreadable skill */ }
  return { name: meta.name || basename(skillDir), path: p, description: String(meta.description || "").trim() };
}
function mdTree(dir) {
  // all markdown files of a knowledge bundle, depth-first, absolute paths
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6) return; // bundles are shallow; guard against cycles
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}
const mdIf = (p) => (existsSync(p) ? p : null);
function brainData(agentName, wsId) {
  const ws = wsId ? workspaceById(wsId) : workspaces()[0];
  const observed = ws && !ws.remote ? snapshot.byWs.get(ws.id) : null;
  if (observed?.deployment?.status !== "observed") return null;
  const root = observed.deployment.root;
  const def = observed.deployment.souls.find((s) => s.name === agentName);
  // The soul directory must canonically belong to this deployment.
  if (!def?.dir || !canonicalInside(def.dir, ws.id)) return null;
  const soulDir = join(def.dir, "soul");
  /* OATSWEB_BRAINSKILLS_BEGIN — skill-path expansion, extracted by tests */
  const expandSkillPath = (p, exists, list, entry) =>
    // a path is either a leaf skill dir (contains SKILL.md) or a parent tree
    // of skill dirs (a materialized module's `.agents/skills/<module>/`).
    exists(join(p, "SKILL.md")) ? [entry(p)].filter(Boolean) : list(p);
  const mergeSkills = (...groups) => {
    const byName = new Map();
    for (const g of groups) for (const s of g) if (!byName.has(s.name)) byName.set(s.name, s);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  /* OATSWEB_BRAINSKILLS_END */
  // Soul content is workspace-member content: every file must stay inside the
  // kernel-reported soul directory (a per-commit copy behind the soul pointer).
  const soulContained = containedIn(def.dir);
  const soulSkills = mergeSkills(listSkills(join(soulDir, "skills"), soulContained));
  const knowledgeDir = join(soulDir, "knowledge");
  // Instances are exactly the kernel-reported rows of this soul and root.
  const rows = (observed.instances || []).filter((i) => !i.server && i.agent === def.name && i.agentsRoot === root
    && canonicalInside(i.home, ws.id))
    .sort((a, b) => String(a.instance).localeCompare(String(b.instance)));
  const instances = rows.map((live) => {
    const home = live.home;
    const homeContained = containedIn(home);
    const skillsDir = join(home, ".agents", "skills");
    let entries = [];
    try { entries = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { /* none */ }
    const skills = mergeSkills(entries.flatMap((e) => expandSkillPath(join(skillsDir, e.name), existsSync,
      (d) => listSkills(d, homeContained), (d) => skillEntry(d, homeContained))));
    const notesDir = join(home, "notes");
    return {
      instance: live.instance, home, running: live.running === true,
      agentsMd: mdIf(join(home, "AGENTS.md")),
      skills,
      state: mdIf(join(home, "STATE.md")),
      task: mdIf(join(home, "TASK.md")),
      notes: existsSync(notesDir) ? mdTree(notesDir) : [],
    };
  });
  return {
    agent: def.name, description: def.description || "", agentsRoot: root,
    soul: {
      agentsMd: mdIf(join(soulDir, "AGENTS.md")),
      skills: soulSkills,
      knowledge: {
        index: mdIf(join(knowledgeDir, "index.md")),
        tree: existsSync(knowledgeDir) ? mdTree(knowledgeDir) : [],
      },
    },
    instances,
  };
}

// ---- File serving (markdown/brain viewers) ----

/* OATSWEB_FILEGUARD_BEGIN — path-traversal guard for /api/file, extracted by
   tests. A requested path is readable ONLY if its realpath (symlinks resolved)
   sits under one of the allowed roots. CONTRACT: allowedRoots are
   PRE-CANONICALIZED strings captured at admission time — the guard must
   NEVER re-resolve them (review 9db1e81: re-running realpathSync on a root
   at use time re-opened the admission-to-use TOCTOU — a dir→symlink swap
   between fileRoots() and this check made root and request resolve into the
   same outside target). Only the REQUESTED path is canonicalized here; `..`
   segments, sneaky prefixes (/root-evil vs /root) and request-side symlink
   escapes all fail closed against the immutable root strings. */
function underRoot(realPath, realRoot) {
  return realPath === realRoot || realPath.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
}
function resolveGuardedFile(requested, allowedRoots) {
  if (typeof requested !== "string" || !requested.startsWith("/")) return { error: "path must be absolute", code: 400 };
  let real;
  try { real = realpathSync(resolve(requested)); } catch { return { error: "no such file", code: 404 }; }
  if (!allowedRoots.some((root) => underRoot(real, root))) return { error: "path outside allowed roots", code: 403 };
  return { real };
}
/* OATSWEB_FILEGUARD_END */

const MARKDOWN_EXT = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const FILE_MAX_BYTES = 2 * 1024 * 1024;

/** Allowed roots for /api/file: every agents root of every workspace (agent
 * homes — souls, instances, knowledge) plus the known instances' work trees
 * and repos (the brain/markdown viewers open files there too).
 * EVERY returned root is canonicalized HERE, exactly once — the guard
 * compares against these immutable strings without re-resolving (see the
 * FILEGUARD contract above): a dir→symlink swap after this admission
 * changes nothing the guard consults. */
function fileRoots() {
  const roots = [];
  const admit = (p) => { try { roots.push(realpathSync(p)); } catch { /* absent — skip */ } };
  for (const w of workspaces()) for (const r of w.roots) admit(r);
  // Every soul directory the kernel reported for an observed local deployment
  // (its souls/knowledge/instances are viewable), admitted only when its
  // canonical path stays inside the canonical deployment: a symlinked soul
  // directory must not widen the file roots. Canonicalized once here.
  for (const [id, d] of snapshot.byWs) {
    if (d.deployment?.status !== "observed") continue;
    for (const soul of d.deployment.souls) {
      const real = canonicalInside(soul.dir, id);
      if (real) roots.push(real);
    }
  }
  for (const [id, d] of snapshot.byWs) {
    for (const i of d.instances) {
      if (i.server) continue; // Remote paths never grant access to local files.
      // The home itself must canonicalize inside its deployment; its work tree
      // and repo are operator checkouts that legitimately live elsewhere.
      const home = i.home ? canonicalInside(i.home, id) : null;
      if (home) { roots.push(home); admit(join(i.home, "work")); } // <home>/work = the work tree (i.work is the MODE)
      if (i.repo) admit(i.repo);
    }
  }
  return roots;
}

function fileData(requested) {
  const g = resolveGuardedFile(requested, fileRoots());
  if (g.error) return g;
  const st = statSync(g.real);
  if (!st.isFile()) return { error: "not a regular file", code: 400 };
  if (st.size > FILE_MAX_BYTES) return { error: `file too large (${st.size} bytes)`, code: 413 };
  const buf = readFileSync(g.real);
  if (buf.includes(0)) return { error: "binary file", code: 415 };
  return {
    body: {
      path: g.real, name: basename(g.real), size: st.size, mtime: st.mtime.toISOString(),
      markdown: MARKDOWN_EXT.has(extname(g.real).toLowerCase()),
      content: buf.toString("utf8"),
    },
  };
}

// ---- HTTP ----
// Identity for compatibility probes (GET /api/version): the desktop app must
// not reuse an OLDER server that answers /api/panel but lacks the
// desktop endpoints (/api/brain, /api/file...). The bundled
// server's identity is the desktop package's name and version.
const MANIFEST = (() => {
  const p = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  return { capability: p.name, version: p.version };
})();
const send = (res, code, body, type = "application/json") => {
  const data = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
  res.end(data);
};
const readBody = (req) => new Promise((ok) => {
  let b = ""; req.on("data", (c) => { b += c; if (b.length > 65536) req.destroy(); });
  req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } });
});

// New read commands cannot turn malformed JSON into an empty valid request.
// Keep the legacy parser for the other existing request families.
const readStrictBody = (req, limit = 65536, measured = false) => new Promise((ok, reject) => {
  const bad = () => reject(Object.assign(new Error(`Expected a JSON object body up to ${limit} bytes`), { code: "E_BAD_ARGS" }));
  const chunks = []; let size = 0;
  req.on("data", c => {
    size += Buffer.byteLength(c);
    if (size > limit) { chunks.length = 0; bad(); }
    else chunks.push(Buffer.from(c));
  });
  req.on("end", () => {
    if (size > limit) return;
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(raw.trim() ? raw : "{}");
      if (!body || typeof body !== "object" || Array.isArray(body)) return bad();
      ok(measured ? { body, bytes: size } : body);
    } catch { bad(); }
  });
  req.on("error", bad);
  req.on("aborted", bad);
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  // DNS-rebinding guard: EVERY request must carry a loopback Host — a hostile
  // page rebinding its hostname to 127.0.0.1 must neither type into terminals
  // (POST) nor read workspace files via the GET API (/api/file).
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  const okHost = (h) => h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  if (!okHost(host)) return send(res, 403, { error: "forbidden origin" });
  // CSRF guard: mutating requests must also come from a loopback origin.
  if (req.method === "POST") {
    let originOk = true;
    if (req.headers.origin !== undefined) {
      // "Origin: null" (sandboxed pages) and malformed origins must 403, not throw.
      try { originOk = okHost(new URL(String(req.headers.origin)).hostname); } catch { originOk = false; }
    }
    if (!originOk) return send(res, 403, { error: "forbidden origin" });
  }
  try {
    if (req.method === "GET" && path === "/api/version") {
      return send(res, 200, { capability: MANIFEST.capability, version: MANIFEST.version });
    }
    if (req.method === "GET" && path === "/api/panel") {
      // Served from the latest kernel observation; never waits on a CLI read.
      return send(res, 200, panelData(url.searchParams.get("ws") || undefined));
    }
    if (req.method === "GET" && path === "/api/agents") return send(res, 200, agentsData(url.searchParams.get("ws") || undefined));
    if (path === "/api/launch-configs" && req.method === "POST") {
      const workspace = workspaces().find(w => w.id === url.searchParams.get("ws"));
      try {
        const result = await launchConfigRequest(await readBody(req), {
          workspace, cli: cliState, localCwd: ctxs[0],
          agents: workspace ? agentsData(workspace.id).agents : [],
          instances: workspace ? panelData(workspace.id).instances : [],
        });
        return send(res, 200, result);
      } catch (e) { const { status, body } = spawnErrorPayload(e); return send(res, status, body); }
    }
    if (["/api/forge-connections", "/api/instance-forge", "/api/forge-roster", "/api/instance-review-threads"].includes(path) && req.method === "POST") {
      try {
        const epoch = req.headers[FORGE_EPOCH_HEADER] ?? "standalone:0";
        if (!validForgeEpoch(epoch)) throw new Error("bad epoch");
        const request = await readStrictBody(req);
        if (path === "/api/forge-connections") {
          if (url.search) throw new Error("unexpected query");
          return send(res, 200, await forgeBoundary.connections(request, epoch));
        }
        if (url.searchParams.getAll("ws").length !== 1 || !url.searchParams.get("ws") || [...url.searchParams.keys()].some(k => k !== "ws")) throw new Error("bad workspace query");
        const getContext = () => {
          const workspace = workspaces().find(w => w.id === url.searchParams.get("ws"));
          const observed = workspace ? snapshot.byWs.get(workspace.id) : null;
          // clones[]: the kernel's member keys and this computer's clone paths (#217), for the roster.
          return { workspace, cli: cliState, instances: observed?.instances || [], clones: observed?.deployment?.workspaceStatus?.clones || [] };
        };
        if (path === "/api/forge-roster") return send(res, 200, await forgeBoundary.roster(request, getContext, epoch));
        if (path === "/api/instance-review-threads") {
          // The paste goes to the instance's own anchored tmux target in THIS workspace, looked up fresh.
          const find = (target) => (getContext().instances || []).find((i) => i.home === target.home && i.instance === target.instance) || null;
          return send(res, 200, await forgeBoundary.reviewThreads(request, getContext, epoch, createReviewPaste({ find, tmuxTarget })));
        }
        return send(res, 200, await forgeBoundary.pull(request, getContext, epoch));
      } catch {
        return send(res, 400, { forgeApi: 1, status: "unavailable", data: null,
          reason: { code: "E_BAD_ARGS", message: "Invalid forge request." } });
      }
    }
    if (path === '/api/instance-events' && req.method === 'POST') {
      try {
        if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) throw new Error('bad query');
        const request = await readStrictBody(req, 16384);
        const getContext = () => {
          const workspace = workspaces().find(w => w.id === url.searchParams.get('ws'));
          return { workspace, cli: cliState, epoch: cliProbeGeneration,
            instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] };
        };
        return send(res, 200, await instanceEventsRequest(request, getContext));
      } catch { return send(res, 400, eventsFailure('E_BAD_ARGS')); }
    }
    if (path === '/api/workspace-spawn-preview' && req.method === 'POST') {
      try {
        if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) throw new Error('bad query');
        const request = await readStrictBody(req, 16384);
        const getContext = () => {
          const workspace = workspaces().find(w => w.id === url.searchParams.get('ws'));
          return { workspace, cli: cliState, agents: workspace && !workspace.remote && !workspace.server ? agentsData(workspace.id).agents : [],
            instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] };
        };
        return send(res, 200, await spawnPreviewRequest(request, getContext));
      } catch { return send(res, 400, previewFailure('E_BAD_ARGS')); }
    }
    if (path === '/api/workspace-readiness' && req.method === 'POST') {
      try {
        if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) throw new Error('bad query');
        const request = await readStrictBody(req);
        const getContext = () => {
          const workspace = workspaces().find(w => w.id === url.searchParams.get('ws'));
          return { workspace, cli: cliState, agents: workspace && !workspace.remote && !workspace.server ? agentsData(workspace.id).agents : [],
            instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] };
        };
        return send(res, 200, await readinessRequest(request, getContext));
      } catch { return send(res, 400, readinessFailure('E_BAD_ARGS')); }
    }
    if (path === '/api/instance-lifecycle' && req.method === 'POST') {
      try {
        if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) throw new Error('bad query');
        const request = await readStrictBody(req);
        const getContext = () => {
          const workspace = workspaces().find(w => w.id === url.searchParams.get('ws'));
          return { workspace, cli: cliState, instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] };
        };
        const result = await lifecycleRequest(request, getContext);
        if (request.action === 'apply' && ['complete', 'partial', 'refused', 'unknown'].includes(result.status)) {
          try { refreshSnapshot(); } catch { /* a refresh must not erase a mutation receipt */ }
        }
        return send(res, 200, result);
      } catch {
        return send(res, 400, { lifecycleApi: 1, status: 'unavailable', target: null, planRef: null, plan: null, receipt: null,
          reason: { code: 'E_BAD_ARGS', message: 'Lifecycle requests require one workspace and a bounded JSON object.' } });
      }
    }
    if (path === "/api/instance-git" && req.method === "POST") {
      try {
        if (url.searchParams.getAll("ws").length !== 1 || !url.searchParams.get("ws") || [...url.searchParams.keys()].some(key => key !== "ws")) {
          throw Object.assign(new Error("Expected one workspace selector"), { code: "E_BAD_ARGS" });
        }
        const request = await readStrictBody(req);
        const workspace = workspaces().find(w => w.id === url.searchParams.get("ws"));
        // Never collect Git here or fall back to another workspace.
        // An absent exact snapshot is unavailable; refreshing the roster is
        // the existing collector's job, not an authority to infer another home.
        const result = await instanceGitRequest(request, { workspace, cli: cliState,
          instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] });
        return send(res, 200, result);
      } catch (error) {
        const bad = error?.code === "E_BAD_ARGS";
        return send(res, bad ? 400 : 503, { code: bad ? "E_BAD_ARGS" : "E_CLI_FAILED",
          error: bad ? "Git inspection requires one workspace selector and a JSON object body up to 64 KiB" : "Git inspection is unavailable" });
      }
    }
    if (path === "/api/workspace-sync" && req.method === "POST") {
      // Workspace model v2: catalog read and sync through the installed kernel
      // (server/workspace-sync.mjs). One local deployment.
      try {
        if (url.searchParams.getAll("ws").length !== 1 || !url.searchParams.get("ws") || [...url.searchParams.keys()].some(k => k !== "ws")) throw new Error("bad query");
        const request = await readStrictBody(req, 16384);
        const workspace = workspaces().find(w => w.id === url.searchParams.get("ws"));
        const result = await workspaceSyncRequest(request, { workspace, cli: cliState });
        if (request?.action === "sync" && result.status === "ok") {
          try { refreshSnapshot(); } catch { /* a refresh must not erase the sync report */ }
        }
        return send(res, 200, result);
      } catch { return send(res, 400, syncFailure("E_BAD_ARGS")); }
    }
    if (path === "/api/capabilities" && req.method === "POST") {
      const workspace = workspaces().find(w => w.id === url.searchParams.get("ws"));
      try {
        const request = await readStrictBody(req);
        const result = await capabilityRequest(request, {
          workspace, cli: cliState, localCwd: ctxs[0],
          agents: workspace ? agentsData(workspace.id).agents : [],
          instances: workspace ? panelData(workspace.id).instances : [],
        });
        return send(res, 200, result);
      } catch (e) { const { status, body } = spawnErrorPayload(e); return send(res, status, body); }
    }
    if (path === '/api/automations') {
      // Triggers and schedules (feature automations): one local workspace, the kernel's lists and verbs ({ kind, action, key? }).
      if (req.method !== 'POST') return send(res, 405, automationsFailure('E_BAD_ARGS'));
      let request;
      try { ({ body: request } = await readStrictBody(req, 4096, true)); } catch { return send(res, 400, automationsFailure('E_BAD_ARGS')); }
      if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) return send(res, 400, automationsFailure('E_BAD_ARGS'));
      const workspace = workspaces().find(w => w.id === url.searchParams.get('ws'));
      return send(res, 200, await automationsRequest(request, { workspace, cli: cliState }));
    }
    if (path === '/api/schedules') {
      // The local schedule form's verbs (add/update/remove, reconcile, host-*). Reading and
      // enable/disable/run/test are the kernel's automations (/api/automations, §2.3a).
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed', code: 'E_METHOD_NOT_ALLOWED' });
      let request;
      try { ({ body: request } = await readStrictBody(req, 65536, true)); } catch { return send(res, 400, { error: 'Invalid schedule request', code: 'E_BAD_ARGS' }); }
      // No default workspace: a mutation names its workspace.
      const workspace = workspaces().find(w => w.id === url.searchParams.get('ws'));
      try {
        const result = await scheduleRequest(request, {
          workspace, cli: cliState, localCwd: ctxs[0],
          agents: workspace ? agentsData(workspace.id).agents : [],
          instances: workspace ? panelData(workspace.id).instances : [],
        });
        return send(res, 200, result);
      } catch (e) { const { status, body } = spawnErrorPayload(e); return send(res, status, body); }
    }
    const bm = path.match(/^\/api\/brain\/([A-Za-z0-9._-]+)$/);
    if (bm && req.method === "GET") {
      if (workspaceById(url.searchParams.get("ws"))?.remote) return send(res, 409, { error: "Remote files are available through the agent terminal", code: "E_REMOTE_FILES" });
      const d = brainData(bm[1], url.searchParams.get("ws") || undefined);
      return d ? send(res, 200, d) : send(res, 404, { error: `unknown agent "${bm[1]}"` });
    }
    if (req.method === "POST" && path === "/api/models") {
      // POST (not GET) so the CSRF Origin guard above covers this
      // command-running route — see the model-catalog SECURITY note.
      const body = await readBody(req);
      const harness = typeof body.harness === "string" && body.harness ? body.harness : "pi";
      if (!HARNESSES.includes(harness)) return send(res, 400, { error: `unknown harness "${harness}" (pi|claude|codex)` });
      return send(res, 200, { harness, models: await modelsData(harness) });
    }
    if (req.method === "GET" && path === "/api/servers") {
      // Registered execution servers, read through the CLI (the Desktop
      // holds no registry of its own). Without a compatible CLI there are
      // no servers to offer, which the renderer renders as "local only".
      if (!cliState.ok) return send(res, 200, { servers: [], reason: "cli-unavailable" });
      const env = await adapter.cliServers(cliState.bin);
      if (!env.ok) return send(res, 200, { servers: [], reason: env.error?.code || "E_SERVERS" });
      return send(res, 200, { servers: (env.result.servers || []).map((s) => ({ id: s.id, label: s.label || s.id, sshHost: s.sshHost, workspace: s.workspace })) });
    }
    if (req.method === "GET" && path === "/api/cli") {
      return send(res, 200, cliStatus());
    }
    if (req.method === "POST" && path === "/api/cli/reprobe") {
      // Re-probe triggers (contract): launch, app focus, explicit Retry, and
      // after choosing a binary — main/renderer call this; body may carry a
      // user-chosen absolute path which becomes the top-priority candidate.
      const body = await readBody(req);
      const chosen = typeof body.bin === "string" && body.bin.startsWith("/") ? body.bin : undefined;
      await reprobeCli(chosen);
      return send(res, 200, cliStatus());
    }
    if (req.method === "POST" && path === "/api/spawn") {
      let body;
      try { body = await readStrictBody(req, 65536); }
      catch { const failure = spawnApplyFailure('E_BAD_ARGS'); return send(res, 400, { ...failure, code: failure.reason.code, error: failure.reason.message }); }
      if (Object.hasOwn(body, 'action')) {
        if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) {
          const failure = spawnApplyFailure('E_BAD_ARGS'); return send(res, 400, { ...failure, code: failure.reason.code, error: failure.reason.message });
        }
        const getContext = () => {
          const workspace = workspaces().find(w => w.id === url.searchParams.get('ws'));
          return { workspace, cli: cliState, agents: workspace && !workspace.remote && !workspace.server ? agentsData(workspace.id).agents : [],
            instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] };
        };
        return send(res, 200, await spawnApplyRequest(body, getContext));
      }
      // Only an actual remote argv route exempts a fully capable CLI from the
      // local confirmation fence. Truthy arrays/objects must not bypass it.
      const remoteRequest = typeof body.serverId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(body.serverId);
      if (!remoteRequest) {
        const failure = spawnApplyFailure('E_PLAN_REQUIRED'); return send(res, 409, { ...failure, code: failure.reason.code, error: failure.reason.message });
      }
      // Ordinary older/remote spawn never gains the new options or a caller key.
      if (body && (['base', 'branch', 'work', 'modelMode', 'expectDecision', 'choices', 'spawnRef', 'idempotencyKey', 'decision'].some(k => Object.hasOwn(body, k))
        || typeof body.model === 'object' && body.model !== null || body.model === '@native-default')) {
        return send(res, 409, { code: 'E_UNSUPPORTED_OPTION', error: 'An execution-server spawn takes only the ordinary spawn options.' });
      }
      if (typeof body.agent !== "string" || !body.agent || typeof body.agentsRoot !== "string" || !body.agentsRoot)
        return send(res, 400, { error: "body needs { agent, agentsRoot }" });
      try { return send(res, 200, { spawned: true, ...(await spawnAgent(body)) }); }
      catch (e) { const { status, body: b } = spawnErrorPayload(e); return send(res, status, b); }
    }
    const hm = path.match(/^\/api\/(harvest|retire|start|restart)\/([A-Za-z0-9._-]+)$/);
    if (hm && req.method === "POST") {
      if (hm[1] === 'retire') return send(res, 409, { code: 'E_PLAN_REQUIRED', error: 'Open a fresh Remove confirmation. Unguarded retirement is unavailable, including remote retirement.' });
      // Desktop v1 mutation 2: the active provider’s harvest operation, cwd FIXED by this
      // privileged backend to the RESOLVED instance home — the caller only
      // names an instance; it can never steer the cwd.
      const r = resolveInstanceOr(hm[2], url.searchParams.get("ws") || undefined, url.searchParams.get("home") || undefined, url.searchParams.get("server") || undefined);
      if (r.error) return send(res, r.error.status, r.error.body);
      const inst = r.inst;
      if (!cliState.ok) return send(res, 503, { error: `${hm[1]} requires a compatible installed oats CLI`, code: "cli-unavailable" });
      /* OATSWEB_START_BEGIN — resolved instance start, exercised without launching a harness. */
      if (hm[1] === "start" || hm[1] === "restart") {
        if (!cliState.features?.includes("session-start")) return send(res, 409, { error: "Starting an existing instance requires an updated OATS CLI", code: "unsupported-start-option" });
        if (inst.server) {
          if (!inst.savedRoute) return send(res, 409, { error: "No saved route for this remote instance", code: "E_SNAPSHOT_UNKNOWN" });
          locator.requireRemoteSupport(cliState, "session-start");
        } else if (!harvestHome(inst)) return send(res, 409, { error: "Instance home is outside the workspace instances layout" });
        const body = await readBody(req);
        const restart = hm[1] === "restart";
        if (restart && !cliState.features?.includes("session-restart")) return send(res, 409, { error: "Update OATS to restart an existing instance", code: "unsupported-start-option" });
        if ([body.launchConfig, body.harness, body.yolo].some(v => v !== undefined)) {
          if (!cliState.features?.includes("launch-config")) return send(res, 409, { error: "Update OATS to change the launch configuration", code: "unsupported-start-option" });
          if (inst.server) locator.requireRemoteSupport(cliState, "launch-config");
        }
        if (restart && inst.server) locator.requireRemoteSupport(cliState, "session-restart");
        const env = await adapter.cliStart(cliState.bin, { home: inst.home, model: body.model,
          launchConfig: body.launchConfig, harness: body.harness, harnessFlag: harnessFlag(cliState), yolo: body.yolo, restart,
          workspaceDir: inst.server ? ctxs[0] : dirname(inst.agentsRoot), server: inst.server });
        refreshSnapshot(); void refreshRemoteSnapshot();
        return env.ok ? send(res, 200, env.result) : send(res, env.error.code === "E_BAD_ARGS" ? 400 : 409, { error: env.error.message, code: env.error.code });
      }
      /* OATSWEB_START_END */
      const workspace = workspaces().find(w => w.id === url.searchParams.get("ws"));
      const result = await capabilityRequest({ action: "run", selector: { home: inst.home }, operation: "knowledge:harvest" }, {
        workspace, cli: cliState, localCwd: ctxs[0],
        agents: workspace ? agentsData(workspace.id).agents : [],
        instances: workspace ? panelData(workspace.id).instances : [],
      });
      return send(res, 200, result);
    }
    if (req.method === "GET" && path === "/api/file") {
      const r = fileData(url.searchParams.get("path") || "");
      return r.error ? send(res, r.code, { error: r.error }) : send(res, 200, r.body);
    }
    const m = path.match(/^\/api\/(session|keys|interrupt|chat)\/([A-Za-z0-9._-]+)$/);
    if (m) {
      const r = resolveInstanceOr(m[2], url.searchParams.get("ws") || undefined, url.searchParams.get("home") || undefined, url.searchParams.get("server") || undefined);
      if (r.error) return send(res, r.error.status, r.error.body);
      const inst = r.inst;
      if (inst.server) return send(res, 409, { error: "Use the remote agent terminal for this operation", code: "E_REMOTE_TERMINAL" });
      if (m[1] === "session" && req.method === "GET") {
        if (!inst.running) return send(res, 200, { running: false, text: "" });
        const info = paneInfo(inst);
        const hist = Math.min(info.history, Math.max(0, Number(url.searchParams.get("lines") || 500)));
        return send(res, 200, { running: true, size: info.size, history: hist, text: capture(inst, hist) });
      }
      if (m[1] === "keys" && req.method === "POST") {
        if (!inst.running) return send(res, 409, { error: "instance is not running" });
        const { data, paste } = await readBody(req);
        if (typeof data !== "string" || !data.length) return send(res, 400, { error: "body needs { data }" });
        // SECURITY: never log the payload — typed text can contain secrets.
        if (DEBUG) console.log(`[keys] inst=${inst.instance} target=${tmuxTarget(inst)} paste=${paste === true} len=${Buffer.byteLength(data, "utf8")}`);
        try {
          sendKeys(inst, data, paste === true);
        } catch (e) {
          // SECURITY: e.message embeds the child argv (hex-encoded keystrokes)
          // — never let it reach logs or the response (keySendError shapes it).
          const safe = keySendError(e);
          if (DEBUG) console.log(`${safe.log} inst=${inst.instance}`);
          return send(res, 500, safe.http);
        }
        return send(res, 200, { sent: true });
      }
      if (m[1] === "interrupt" && req.method === "POST") {
        if (!inst.running) return send(res, 409, { error: "instance is not running" });
        sendInterrupt(inst);
        return send(res, 200, { sent: true });
      }
      if (m[1] === "chat" && req.method === "GET") return send(res, 200, chatData(inst, Number(url.searchParams.get("limit") || 120)));
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    if (e.code === "unsupported-remote-operation") return send(res, 409, { error: e.message, code: e.code });
    return send(res, 500, { error: String(e.message || e).slice(0, 300) });
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`oats-desktop server: port ${port} is already in use — a desktop backend is likely already running.`);
    console.error(`Use --port <n> for a second server, or stop the old one: pkill -f "packages/desktop/server/oats-web.mjs start"`);
    process.exit(1);
  }
  throw e;
});
server.listen(port, "127.0.0.1", () => {
  const addr = `http://127.0.0.1:${port}`;
  console.log(`oats-desktop server — API at ${addr}  (workspaces: ${workspaces().map((w) => w.name).join(", ") || "none"})`);
  console.log("Bound to 127.0.0.1 only. This process can type into your agent terminals — do not expose it.");
});
void refreshSnapshot();                  // pending until the CLI probe settles
reprobeCli().then((s) => {
  console.log(s.ok
    ? `oats-desktop server: oats CLI ${s.version} at ${s.bin} (${s.source})`
    : `oats-desktop server: no compatible oats CLI found — reads and terminals work; Spawn/Harvest disabled (${(s.tried || []).length} candidate(s) tried)`);
});
setInterval(refreshSnapshot, DEPLOYMENT_REFRESH_MS).unref(); // single-flight kernel observation
setInterval(refreshRemoteSnapshot, 10000).unref(); // coalesced host reads, independent of terminal traffic
