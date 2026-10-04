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
 *                                   (both: an explicit ?ws= not served → 404 E_WORKSPACE_NOT_SERVED)
 *   POST /api/spawn?ws=<id>         { action: prepare|apply|result, … } → preview-bound spawn (server/spawn-apply.mjs);
 *                                   { agent, agentsRoot, serverId, … } → execution-server spawn only
 *                                   (mutations require the installed `oats` CLI; see cliUnavailable)
 *   GET  /api/session/<instance>?lines=n   ANSI pane capture of the live session
 *   POST /api/keys/<instance>       { data } → raw key bytes into the session (no Enter)
 *   POST /api/interrupt/<instance>  sends Ctrl-C (Escape for pi/claude prompts stays manual)

 *   POST /api/instance-git?ws=<id>  { action: git|diff, selector, fileId?, revision?, indexRevision? } → qualified K1 read
 *   POST /api/workspace-sync?ws=<id> { action: read|sync, refresh? } → the held `oats capabilities` catalog / `oats sync` (workspace-v2)
 *   POST /api/capabilities?ws=<id>  { action: inspect|run, selector, … } → `oats inspect` / provider operations (server/capabilities.mjs);
 *                                   { action: show|file, capability, path? } → `oats capabilities show` for one held catalog row
 *                                   (server/capability-show.mjs; local only; errors 409/400 { error, code })
 *   POST /api/models                { harness: pi|claude|codex } → advisory model catalog for the spawn modal
 *   GET  /api/cli                   CLI discovery status (bin, version, required range, tried, probePath/pathSource/pathError)
 *   POST /api/cli/reprobe           re-run discovery; body { bin? } prioritizes a user-chosen binary
 *   POST /api/window-state          { focused } → the refresh cadence backs off while the window is blurred/hidden
 *   POST /api/harvest/<instance>    the active provider’s harvest operation addressed by the exact --home; the CLI derives the recorded context
 *   GET  /api/brain/<agent>?ws=<id> agent "brain" JSON: soul (AGENTS.md, skills,
 *                                   knowledge tree) + per-instance artifacts (abs paths)
 *   GET  /api/file?path=<abs>       text file content, guarded to workspace roots + agent homes
 *
 * SECURITY: binds 127.0.0.1 ONLY. This process can type into your terminals.
 * Deployment model: every roster/header fact is the installed kernel's
 * `oats status --json` / `oats workspace status --json` (workspace model v2).
 * The server reads no deployment file and has no fallback reader.
 * Load path: status, workspace status and (cold) souls start together and the roster is
 * published as soon as the first two land; souls, the capabilities table and inspect results
 * are held server-side and re-read only when the kernel state they were read under moves
 * (see docs/desktop-load-path.md). Every roster/agents/catalog/inspect answer carries
 * `observedAt` (the kernel's observation time when reported, else the read's completion) and
 * `refreshing` (a read for that data is in flight).
 * Interaction model: terminal-direct (tmux send-keys / capture-pane) — the
 * feel of sitting at the agent's terminal; identical for pi and claude runs.
 */
// FIRST, above every other import: this process drops what the Desktop and its packaging added
// to its environment (own-environment.mjs), so each module below, and every program this
// process starts, sees the user's. Nothing here passes the cleaning function to a child.
import { launchEnvironment } from "./own-environment.mjs";
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, realpathSync, accessSync, constants as fsConstants } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { scheduleRequest } from "./schedules.mjs";
import { capabilityRequest } from "./capabilities.mjs";
import { createDeploymentObserver, mapBounded, MAX_DEPLOYMENT_OBSERVATIONS } from "./deployment-observer.mjs";
import { createMachines } from "./machines.mjs";
import { machinesGated } from "../renderer/machine-contract.mjs";
import { createSoulCatalog, soulCatalogKey } from "./soul-catalog.mjs";
import { createCapabilityCatalog, capabilityCatalogKey } from "./capability-catalog.mjs";
import { capabilityShowRequest, createCapabilityShowCache } from "./capability-show.mjs";
import { createInspectCache } from "./inspect-cache.mjs";
import { createRefreshLoop, REFRESH_FOCUSED_MS, REFRESH_BLURRED_MS } from "./refresh-loop.mjs";
import { createWorkspaceSyncBoundary, syncFailure } from "./workspace-sync.mjs";
import { instanceGitRequest } from "./instance-git.mjs";
import { lifecycleRequest } from "./instance-lifecycle.mjs";
import { readinessRequest } from './readiness.mjs';
import { readinessFailure } from '../renderer/readiness-contract.mjs';
import { spawnPreviewCachedRequest, spawnPreviewCache } from './spawn-preview.mjs';
import { teamsRequest, soulTeamsRequest, teamsFailure } from './teams.mjs';
import { instanceEventsRequest } from './instance-events.mjs';
import { eventsFailure } from '../renderer/instance-events-contract.mjs';
import { spawnApplyRequest } from './spawn-apply.mjs';
import { spawnApplyFailure } from '../renderer/spawn-apply-contract.mjs';
import { previewFailure } from '../renderer/spawn-preview-contract.mjs';
import { forgeBoundary, FORGE_EPOCH_HEADER, validForgeEpoch } from "./forge.mjs";
import { createReviewPaste } from "./review-paste.mjs";
import { launchConfigRequest } from "./launch-configs.mjs";
import { teamMembers } from "./team-members.mjs";
import { automationsRequest, automationsFailure } from "./automations.mjs";
import { normalizeSoulColor } from "../renderer/soul-colors.mjs";
import { canAddressRemote, unaddressableSentence } from "../renderer/remote-address.mjs";
import { harnessFlag, HARNESSES } from "../renderer/harness-names.mjs";
import { probeChanged } from "../renderer/cli-probe-contract.mjs";
import { workspaceNotServed, deploymentUnavailableText } from "../renderer/deployment-header.mjs";
import { readIdentity, attachment, buildViews, deploymentReason, deploymentReasonParts } from "./workspace-views.mjs";
import { createRemoteIdentityStore } from "./remote-identity.mjs";
import { THIS_MACHINE, shortPath, deploymentLabel } from "../renderer/deployment-label.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const sub = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined;
};
const flagAll = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] && !args[i + 1].startsWith("--") ? [args[i + 1]] : []));

// "collect" is retired: the kernel owns roster collection and the CLI read is
// asynchronous. Terminal liveness runs in server/liveness-main.mjs children.
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

/** Deployments in view. Each --dir registers one (repeatable); no --dir serves
 * no local deployment, never the cwd (#518). A deployment is identified by its
 * canonical directory, exactly as given to `oats --dir`; the kernel decides
 * whether it is one. */
const ctxs = [...new Set(flagAll("dir").map((d) => resolve(String(d))))];
const port = Number(flag("port") || 4820);
const DEBUG = flag("debug") === true || process.env.OATSWEB_DEBUG === "1";

/* The remembered remote identities and the roster's answered state (server/remote-identity.mjs). */
const remoteIdentities = createRemoteIdentityStore({ file: typeof flag("remote-identity") === "string" ? flag("remote-identity") : null });
let rosterAnswered = false;  // a roster answer arrived under the current CLI (remembered-only groups then leave)
let rosterFailure = null;    // the roster read's failure while no answer has arrived
/* OATSWEB_VIEWS_BEGIN — workspace views over the served deployments, extracted by
   test/workspace-views-server.test.mjs (deps: ctxs, snapshot, remoteGroups, remote, cliState,
   observing, remoteCollecting, remoteIdentities, rosterAnswered, rosterFailure, homedir, basename and
   the imported view, label and team-member helpers).
   ── Workspace views (#482, server/workspace-views.mjs) ──
   A view is what the switcher lists and a window shows: one per matched workspace identity, plus
   one per unattached deployment under that deployment's own id. Built per request from the held
   observations and the remembered remote identities; never a CLI read. */
/** Roots come ONLY from the kernel's observed `status.root`; before (or
 * without) an observation there is nothing to act on. No layout guess. */
function workspaceEntry(ctx) {
  const deployment = snapshot.byWs.get(ctx)?.deployment;
  const observed = deployment?.status === "observed";
  return { id: ctx, name: (observed && deployment.workspace?.name) || basename(ctx) || ctx, scope: ctx, team: null,
    roots: observed ? [deployment.root] : [] };
}
/** Every served deployment, in served order: the local deployments (one per --dir), then the
 * remote roster groups, then (only while there is no roster answer at all) the remembered remote
 * groups, which have no rows. An id here is a deployment id: every instance-addressed route
 * resolves only these. */
function deployments() {
  return [...ctxs.map(workspaceEntry), ...remoteGroups.map(remote.remoteWorkspace), ...rememberedGroups().map(remote.remoteWorkspace)];
}

/** Remembered remote groups shown only while no roster answer exists: not reached, no rows (Q3). */
function rememberedGroups() {
  if (rosterAnswered) return [];
  const listed = new Set(remoteGroups.map((g) => g.id));
  return remoteIdentities.all().filter((e) => !listed.has(e.id)).map((e) => ({
    id: e.id, server: e.server, label: e.label, registrationPresent: true, remembered: true,
    target: { workspace: e.path }, probe: { ok: false, error: { code: "E_REMOTE_ROSTER", message: rosterFailure || "no roster answer" } },
    agentsRoot: undefined, workspace: null, souls: [], instances: [], retireFailures: [],
  }));
}
const cliReadsRemotes = () => !!cliState.ok && !!cliState.remote?.includes("roster");
const identityFeature = () => !!cliState.features?.includes("workspace-identity");
/** One deployment's identity, attachment, machine label and reason. */
function deploymentInfo(d) {
  if (!d.remote) {
    const entry = snapshot.byWs.get(d.id), observed = entry?.deployment;
    const live = observed?.status === "observed";
    // A failed re-read kept the last observation (observeDeployment): its identity still places it in its
    // view, but it is stale, not live, and says why. Still reachable: this computer's own deployment.
    const readError = live && typeof entry.error === "string" ? entry.error : null;
    const read = !live ? { status: "none" } : !identityFeature() ? { status: "feature" }
      : observed.reachable?.identityInvalid ? { status: "invalid" } : readIdentity(observed.reachable);
    const identity = read.status === "identity" ? read.identity : null;
    const attach = attachment(identity);
    // Not observed (yet): the reading or unavailable sentence, never a silent empty.
    const unavailable = live ? null : deploymentUnavailableText(observed || { status: "pending" });
    return { id: d.id, local: true, machine: THIS_MACHINE, path: d.id, label: shortPath(d.id, { home: homedir() }), name: d.name,
      live: live && !readError, reachable: live, ...(readError ? { stale: true } : {}), identityFrom: identity ? "reported" : null, identity, attach,
      teamLabel: identity?.defaultTeam?.label ?? null,
      ...reasonFields(deploymentReasonParts({ local: true, identityStatus: read.status, attach, ref: identity?.ref, unavailable, readError })),
      note: attach.note === "standalone" ? deploymentReason({ local: true, attach: { unattached: "standalone" } }) : null };
  }
  const g = d.group, machine = g.label || g.server;
  const reached = g.probe?.ok === true;
  let read = reached ? (identityFeature() ? readIdentity(g.workspace) : { status: "feature" }) : { status: "none" };
  let identityFrom = read.status === "identity" ? "reported" : null;
  if (!reached && (g.remembered || remoteIdentities.get(g.id))) {
    const memory = remoteIdentities.get(g.id);
    if (memory) { read = { status: "identity", identity: memory.workspace }; identityFrom = "remembered"; }
  }
  const identity = read.status === "identity" ? read.identity : null;
  const attach = attachment(identity);
  const reason = reasonFields(deploymentReasonParts({ local: false, machine, sshHost: g.target?.sshHost, probe: g.probe, identityStatus: read.status, attach,
    ref: identity?.ref, cliReadsRemotes: cliReadsRemotes(), rosterError: g.remembered ? rosterFailure : null }));
  const moved = remoteIdentities.note(g.id);
  const standalone = attach.note === "standalone" ? deploymentReason({ local: false, attach: { unattached: "standalone" } }) : null;
  return { id: d.id, local: false, machine, path: g.target?.workspace || "", label: shortPath(g.target?.workspace || ""), name: d.name,
    live: reached, reachable: reached, identityFrom, identity, attach, teamLabel: identity?.defaultTeam?.label ?? null,
    ...reason, note: [moved, standalone].filter(Boolean).join(" ") || null };
}
/** A reason's parts as a deployment's fields: `reason` (the full sentence), `short` and `fix` (UI spec, #482). */
function reasonFields(parts) {
  return parts ? { reason: parts.detail, short: parts.short, fix: parts.fix } : { reason: null, short: null, fix: [] };
}
/** The views and the per-deployment facts they rest on: `{ views, infos: Map<deploymentId, info> }`. */
function viewModel() {
  const infos = new Map(deployments().map((d) => [d.id, deploymentInfo(d)]));
  const views = buildViews([...infos.values()]).map((v) => {
    const unattachedReason = v.unattached ? infos.get(v.primary)?.reason ?? null : null;
    const unattachedShort = v.unattached ? infos.get(v.primary)?.short ?? null : null;
    const ref = v.unattached ? infos.get(v.primary)?.identity?.ref ?? null : null;
    return { ...v, ...(unattachedReason ? { reason: unattachedReason } : {}), ...(unattachedShort ? { short: unattachedShort } : {}), ...(ref ? { ref } : {}) };
  });
  return { views, infos };
}
/** The view a selector names: a view id, or a deployment id (answered with the view that holds it, so
 * a selection saved before views opens its view). No selector means the first view. */
function viewFor(wsId, model = viewModel()) {
  if (!wsId) return model.views[0] || null;
  return model.views.find((v) => v.id === wsId) || model.views.find((v) => v.deployments.includes(wsId)) || null;
}
/** A deployment-level surface (header, capabilities, sync, automations, schedules, teams configuration,
 * brain, launch configurations, spawn catalog): a deployment id as itself, a view id as that view's
 * PRIMARY deployment (its first local one, else its first). Never used for an instance-addressed route,
 * which resolves deployment ids only (`deployments().find`), so a view id there is refused. */
function deploymentFor(wsId) {
  const exact = wsId ? deployments().find((w) => w.id === wsId) : null;
  if (exact) return exact;
  const view = viewFor(wsId);
  return view ? deployments().find((w) => w.id === view.primary) || null : null;
}
/** A body that names an instance home (capabilities, launch configurations, schedules) addresses that
 * instance: only an exact deployment id resolves it, never a view id. Anything else is deployment-level. */
const namesInstance = (request) => request?.selector?.home !== undefined || request?.spec?.home !== undefined;
function surfaceDeployment(wsId, request) {
  if (!wsId) return undefined; // these routes name their workspace: no selector is no workspace, never the first
  return namesInstance(request) ? deployments().find((w) => w.id === wsId) : deploymentFor(wsId);
}
/** The forge roster's context for a view (or a deployment id, read as its view): the union of its
 * local deployments' rows and clones, under the view's id. */
function viewForgeContext(wsId) {
  const view = viewFor(wsId);
  if (!view) return { workspace: undefined, cli: cliState, instances: [], clones: [] };
  const local = view.deployments.filter((id) => ctxs.includes(id));
  const observed = local.map((id) => snapshot.byWs.get(id)).filter(Boolean);
  return { workspace: { id: view.id, name: view.name, remote: local.length === 0 }, cli: cliState,
    instances: observed.flatMap((o) => o.instances || []), clones: observed.flatMap((o) => o.deployment?.workspaceStatus?.clones || []) };
}
/** One deployment's own rows (never its view's union): what an instance-addressed request may admit. */
function deploymentRows(ws) {
  return deploymentPanel(ws).instances || [];
}
/** The ids main may let a caller select: every view id and every deployment id. */
function isServed(id) {
  const model = viewModel();
  return model.views.some((v) => v.id === id) || model.infos.has(id);
}
/** /api/team-members: the members of a view's deployments only, each tagged with its deployment (Q5);
 * null for a selector that names no view. */
function teamMembersFor(wsId) {
  const model = viewModel();
  const view = viewFor(wsId, model);
  if (!view) return null;
  const members = view.deployments.map((id) => deployments().find((w) => w.id === id)).filter(Boolean);
  return teamMembers({
    deployments: members.filter((d) => !d.remote).map((d) => ({ deployment: deploymentTag(model.infos.get(d.id)), instances: snapshot.byWs.get(d.id)?.instances || [] })),
    groups: members.filter((d) => d.remote).map((d) => ({ group: d.group, deployment: deploymentTag(model.infos.get(d.id)),
      panel: snapshot.byWs.get(d.id) || remote.remotePanel(d.group) })) });
}

/** A workspace's own machines (#517, server/machines.mjs): the window's key, the deployment every
 * machine call runs in and its messaging slot. The key is the one the view's primary local deployment
 * reports (keyFrom "workspace" only; a matched view's deployments all share it); without one, or with no
 * local deployment, `key` is null and `reason` says which. null for a selector that names no view. */
function machineScope(wsId) {
  const model = viewModel();
  const view = viewFor(wsId, model);
  if (!view) return null;
  const local = view.deployments.map((id) => model.infos.get(id)).find((info) => info?.local);
  if (!local) return { key: null, deployment: null, messaging: null, reason: "no-local" };
  const identity = local.identity;
  const messaging = snapshot.byWs.get(local.id)?.deployment?.workspaceStatus?.defaults?.slots?.messaging?.name ?? null;
  if (identity?.keyFrom !== "workspace" || typeof identity.key !== "string" || !identity.key) return { key: null, deployment: local.id, messaging, reason: "no-key" };
  return { key: identity.key, deployment: local.id, messaging };
}

/** A deployment as the panel and the rows name it. */
const deploymentTag = (info) => ({ id: info.id, machine: info.machine, path: info.path });
/** A deployment's entry in the panel's `deployments` list. */
function deploymentEntry(info, primary) {
  return { ...deploymentTag(info), label: info.label, local: info.local, reachable: info.reachable,
    identityFrom: info.identityFrom, primary: info.id === primary, ...(info.stale ? { stale: true } : {}),
    ...(info.reason ? { reason: info.reason } : {}), ...(info.short ? { short: info.short } : {}),
    ...(info.reason && info.fix?.length ? { fix: [...info.fix] } : {}), ...(info.note ? { note: info.note } : {}) };
}

/** One deployment's own panel, as served before views. */
function deploymentPanel(ws) {
  if (ws?.remote) return { ...remote.remotePanel(ws.group), observedAt: null, refreshing: remoteCollecting };
  const observed = ws ? snapshot.byWs.get(ws.id) : null;
  const instances = observed?.instances || [];
  return {
    workspace: ws ? { id: ws.id, name: ws.name, team: null } : null,
    team: null,
    deployment: publicDeployment(observed?.deployment),
    generatedAt: observed?.generatedAt || new Date().toISOString(),
    // When the kernel observed the remotes this roster rests on, and whether a newer
    // observation of this deployment is running right now (the renderer labels stale data).
    observedAt: observed?.observedAt ?? null,
    refreshing: !!ws && observing.has(ws.id),
    running: instances.filter((i) => i.running).length,
    instances,
    // A failed re-read kept the last observation (observeDeployment): the kernel's message and its bounded cause.
    ...(typeof observed?.error === "string" ? { error: observed.error } : {}),
    ...(observed?.errorCause ? { errorCause: observed.errorCause } : {}),
  };
}

/** Panel data is served from the latest observation and never blocks on a
 * CLI read: the renderer and main's readiness probes stay responsive. A view's panel is its
 * primary deployment's panel (header, error, stamps) with the union of every deployment's rows,
 * each row tagged with its deployment, and the view's deployments listed. */
function panelData(wsId) {
  const model = viewModel();
  const view = viewFor(wsId, model);
  const choices = workspaceChoices(model);
  if (!view) return { ...deploymentPanel(null), workspaces: choices, deployments: [] };
  const members = view.deployments.map((id) => deployments().find((w) => w.id === id)).filter(Boolean);
  const panels = members.map((d) => [d, deploymentPanel(d)]);
  const [, primary] = panels.find(([d]) => d.id === view.primary) || panels[0];
  const instances = panels.flatMap(([d, p]) => (p.instances || []).map((row) => ({ ...row, deployment: deploymentTag(model.infos.get(d.id)) })));
  return {
    ...primary,
    // `primary`: the deployment a deployment-level request is addressed to (it echoes that deployment back).
    workspace: { ...primary.workspace, id: view.id, name: view.name, primary: view.primary, ...(view.key ? { key: view.key, teamId: view.team } : {}) },
    workspaces: choices,
    deployments: view.deployments.map((id) => deploymentEntry(model.infos.get(id), view.primary)),
    refreshing: panels.some(([, p]) => p.refreshing),
    running: instances.filter((i) => i.running).length,
    instances,
  };
}

/** The renderer's deployment facts: the header observation, reachability and
 * any unavailable reason. The private soul rows stay server-side. */
function publicDeployment(deployment) {
  if (!deployment) return { status: "pending" };
  if (deployment.status !== "observed") return deployment;
  const { souls: _souls, catalogKey: _catalogKey, ...rest } = deployment;
  return rest;
}

/** The switcher's list: views, not deployments. Each names its deployments (main lets a caller
 * select any of these ids); an unattached view keeps today's remote fields and says why. */
function workspaceChoices(model = viewModel()) {
  return model.views.map((v) => {
    const primary = deployments().find((w) => w.id === v.primary);
    const remoteOnly = v.deployments.every((id) => !model.infos.get(id)?.local);
    // Without the CLI's workspace-identity feature nothing can match: every deployment keeps its own entry, listed as
    // before views, not as "not matched" (each deployment's own reason still says why).
    const unmatched = v.unattached && identityFeature();
    return { id: v.id, name: v.name, team: null, deployments: [...v.deployments],
      // The deployments' labels, in the same order, for a view that is not on screen ("This Mac · ~/Agents/oats").
      deploymentLabels: v.deployments.map((id) => deploymentLabel(model.infos.get(id))),
      // The switcher's one-liner (UI spec, #482): the machines, in order and once each, and how many deployments aren't live.
      machines: [...new Set(v.deployments.map((id) => model.infos.get(id)?.machine).filter(Boolean))],
      notLive: v.deployments.filter((id) => !model.infos.get(id)?.live).length,
      ...(v.key ? { key: v.key } : {}), ...(unmatched ? { unattached: true } : {}), ...(unmatched && v.reason ? { reason: v.reason } : {}), ...(unmatched && v.short ? { short: v.short } : {}), ...(unmatched && v.ref ? { ref: v.ref } : {}),
      ...(remoteOnly && primary?.remote ? { server: primary.server, remote: true } : {}) };
  });
}
/* OATSWEB_VIEWS_END */

/* OATSWEB_PANELPROJ_BEGIN — the /api/panel per-instance contract projection.
   Extracted by packages/desktop/test/panel-projection.test.mjs via block
   markers so a dropped/typo'd field fails a real assertion (review
   2092e0f): the renderer's cluster grouping and its overview consume
   exactly these fields. */
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
    // cluster-first overview (the renderer reads /api/panel).
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
    // Needs input (PR K): the validated claim (or null, unknown) as status reported it; absent stays absent.
    // Desktop liveness is merged before projection, so running/runtimeState beside it are Desktop's.
    ...(i.waitingOnYou !== undefined ? { waitingOnYou: i.waitingOnYou } : {}),
    team: i.team || null,
  };
}
/* OATSWEB_PANELPROJ_END */

/** Spawnable souls of a local v2 deployment: the kernel's spawn catalog
 * (`oats souls --json` — non-private souls of confirmed members, and external
 * souls, each with its declared work mode). Nothing is read from soul.yaml
 * here, and a soul outside the catalog is not offered for spawning. */
function agentsData(wsId) {
  const ws = deploymentFor(wsId);
  if (ws?.remote) return { workspace: { id: ws.id, name: ws.name, server: ws.server }, agents: remote.remoteAgents(ws.group), observedAt: null, refreshing: false };
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
        // Team model v2 (0.30): the soul's teams here (the default first) and its default, as the kernel resolved them.
        ...(Array.isArray(soul.teams) ? { teams: soul.teams.map((t) => ({ ...t })) } : {}),
        ...(Object.hasOwn(soul, "defaultTeam") ? { defaultTeam: soul.defaultTeam && { ...soul.defaultTeam } } : {}),
        // Launch preferences (0.30): the soul's declared and effective harness + model, and where it came from.
        ...(soul.launch ? { launch: structuredClone(soul.launch) } : {}),
        // The kernel's soul key (`oats soul teams <key>`): the qualified name for a package soul, the bare name otherwise.
        ...(typeof soul.key === "string" ? { key: soul.key } : {}),
        ...(soul.kind === "package" ? { package: soul.package, version: soul.version, qualifiedName: soul.qualifiedName } : {}),
        origin: soul.origin || "", soulKind: soul.kind, repo: soul.repoKey || null, capability: null,
        soulSource: { repoKey: soul.repoKey ?? null, commit: soul.commit ?? null, path: soul.path ?? null },
        agentsRoot: root, workspace: context,
        repoName: memberNames.get(soul.repoKey) || (soul.kind === "external" ? "external" : soul.kind === "package" ? `package ${soul.package}` : soul.repoKey || ""),
      });
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  // The souls read's own stamps (it runs apart from the roster reads): when the kernel observed
  // the remotes for this catalog, and whether a re-read is in flight. Both live on the snapshot
  // entry so this projection needs nothing but the snapshot.
  return { workspace: ws ? { id: ws.id, name: ws.name } : null, agents, ...(catalog ? { catalog } : {}),
    observedAt: deployment?.catalog?.observedAt ?? null, refreshing: deployment?.catalog?.refreshing === true };
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
  const known = deployments().flatMap((w) => w.roots);
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
    workspaceDir: ctxs[0] ?? homedir(), // SSH routes choose their own remote cwd
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
  const spawnedDeployment = remote.spawnedWorkspace(remoteGroups, r);
  // The renderer switches to the reply's workspace: the VIEW that holds the deployment, never a bare deployment id.
  const remoteWorkspaceId = spawnedDeployment ? viewFor(spawnedDeployment)?.id ?? spawnedDeployment : undefined;
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
// The revision every deployment read is admitted under: pending reads are revoked (E_DEPLOYMENT_STALE)
// when it moves, so it moves ONLY when the accepted CLI actually changed in a gate-relevant field
// (bin, version, features, API integers, remote support: renderer/cli-probe-contract.mjs). A focus
// reprobe of the same binary is a no-op here: it neither cancels the observation in flight nor
// wipes the held catalogs, and cliState keeps its identity (the remote roster compares by it).
let cliProbeGeneration = 0;
let probeSequence = 0; // orders concurrent probes; a superseded probe's result is dropped
// User-chosen binary: seeded from --oats-bin (main passes the persisted pick
// at server start) and updated by /api/cli/reprobe {bin} — top candidate on
// every subsequent probe until replaced.
let chosenBin = typeof flag("oats-bin") === "string" ? flag("oats-bin") : null;
// Where this server's PATH came from (the Electron main process resolves the
// login shell's PATH before starting it: login-path.mjs). The probe and every
// oats call inherit process.env.PATH; a standalone server reports "inherited".
const PATH_SOURCE = flag("path-source") === "login-shell" ? "login-shell" : "inherited";
const PATH_ERROR = typeof flag("path-error") === "string" ? flag("path-error") : null;
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
  const sequence = ++probeSequence;
  if (chosen) chosenBin = chosen;
  const r = await locator.discover(cliIo, probeBin);
  if (sequence !== probeSequence) return cliState;
  const first = !cliState.probedAt;
  if (!probeChanged(cliState, r)) {
    // Same CLI: refresh the diagnostics in place (the card reads `tried`), nothing downstream moves.
    Object.assign(cliState, { probedAt: Date.now(), tried: r.tried || [] });
    if (first) void refreshSnapshot({ live: true }); // the first verdict, even "none found", must be published
    return cliState;
  }
  cliProbeGeneration++;
  cliState = { ...r, probedAt: Date.now() };
  rosterAnswered = false; rosterFailure = null; // the roster belongs to the accepted CLI
  // Everything held was read with the previous CLI.
  inspectCache.clear(); capabilityCatalog.forgetAll(); capabilityShowCache.clear(); admitted.clear(); spawnPreviewCache.invalidate();
  void refreshSnapshot({ live: true }); // the deployment observation belongs to the accepted CLI
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
    capabilityShowApi: cliState.capabilityShowApi === 1 ? 1 : null,
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
/** /api/cli as served: the probe status plus the PATH it ran with (and every
 * oats call runs with), its source, and why the login shell's PATH could not
 * be used when it was not. */
const servedCliStatus = () => ({ ...cliStatus(), probePath: process.env.PATH || "", pathSource: PATH_SOURCE, pathError: PATH_ERROR });

/* ── Kernel-observed roster snapshot ──
   Every local deployment fact is one bounded `oats status --json` plus one
   `oats workspace status --json` (deployment-observer.mjs). Terminal liveness for
   the kernel-reported targets is observed in a separate short-lived child
   (server/liveness-main.mjs) so tmux latency cannot stall key/echo handling.
   Local roster Git is null; only the on-demand K1 route observes Git.

   Observation reuse (kernel feature observe-max-age): a background cycle lets the kernel reuse
   remote-head observations up to BACKGROUND_MAX_AGE seconds old; the FIRST cycle of a deployment
   (admission), a mutation's follow-up and an explicit user refresh observe live (0). The adapters
   pass no flag at all to a kernel that does not declare the feature. */
let snapshot = { at: 0, byWs: new Map() };   // wsId -> { deployment, instances, generatedAt, observedAt } | remote panel
const BACKGROUND_MAX_AGE = 60;
const LIVENESS = join(HERE, "liveness-main.mjs");
const soulCatalog = createSoulCatalog();
const capabilityCatalog = createCapabilityCatalog();
const inspectCache = createInspectCache();
// What a capability ships, per (deployment, row, commit[, file]): content at one commit never moves.
const capabilityShowCache = createCapabilityShowCache();
// The read side of /api/workspace-sync answers from the held capabilities table for an
// observed deployment (the current workspace status is its key); a re-read happens only
// when that key moves, at admission, or on refresh:true.
const workspaceSyncRequest = createWorkspaceSyncBoundary({ catalog: capabilityCatalog, maxAge: BACKGROUND_MAX_AGE,
  observed: (id) => { const d = snapshot.byWs.get(id)?.deployment; return d?.status === "observed" ? d.workspaceStatus : null; } });
const admitted = new Set();  // deployments with at least one successful observation under the current CLI
const observing = new Set(); // deployments whose observation is in flight right now (/api/panel refreshing)
const deploymentObserver = createDeploymentObserver({
  // Only a registered local deployment, with the CURRENT accepted CLI. The
  // probe generation is the revision: a real CLI change revokes pending reads.
  getContext: (id) => ctxs.includes(id) ? { deployment: id, revision: cliProbeGeneration, cli: cliState } : null,
});
function observeLivenessRows(rows) {
  return new Promise((done) => {
    if (!rows.length) return done([]);
    const unknown = () => done(rows.map(() => ({ running: null, runtimeState: "unreachable", runtimeError: "Terminal status is unavailable" })));
    let child;
    try {
      // The collector is this executable as Node too: it gets the environment this process was
      // started with (the Node-mode flag is in it) and cleans its own. No other child gets it.
      child = execFile(process.execPath, [LIVENESS], { encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: launchEnvironment }, (err, stdout) => {
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
/** The /api/agents view of a souls-catalog entry: the last good catalog (or none), the latest
 * failure next to it, and its own stamps. `refreshing` is patched on the snapshot entry when a
 * pending read lands, so the projection needs nothing but the snapshot. */
function catalogProjection(entry, refreshing) {
  return { souls: entry?.souls ?? null, ambiguous: entry?.ambiguous ?? [], reason: entry?.reason ?? null,
    observedAt: entry?.observedAt ?? null, refreshing };
}
/** One deployment's panel entry. A transient busy/stale read keeps the last
 * observation; every other failure is shown as unavailable, with the kernel's
 * code/message or the missing feature's name, never as an empty roster.
 * The roster is published as soon as status and workspace status land: the souls catalog
 * is started alongside them on a cold cycle (soulCatalog.prefetch), bound to this cycle's
 * key when the workspace status is known (settle), and attached to the published entry
 * when it lands. The capabilities table follows the same cycle (prefetch, then ensure binds
 * it) and is re-read whenever its key moves, never on the request path. */
async function observeDeployment(id, { live = false } = {}) {
  const previous = snapshot.byWs.get(id);
  // Before the first CLI probe settles there is no verdict to report.
  if (!cliState.probedAt) return previous || { deployment: { status: "pending" }, instances: [], generatedAt: new Date().toISOString() };
  const cli = cliState, admission = !admitted.has(id);
  const maxAge = live || admission ? 0 : BACKGROUND_MAX_AGE;
  observing.add(id);
  try {
    // Cold: souls and the capabilities table start WITH the roster reads (unbound), and are bound to
    // this cycle's key once the workspace status lands. Warm: nothing starts here.
    soulCatalog.prefetch(id, cli, { maxAge }); capabilityCatalog.prefetch(id, cli, { maxAge });
    const result = await deploymentObserver.observe(id, { maxAge });
    if (!result.ok) {
      if (previous && ["E_DEPLOYMENT_BUSY", "E_DEPLOYMENT_STALE"].includes(result.reason?.code)) return previous;
      // A remote the kernel could not read (a cache problem, the network, a timeout) does not erase what
      // was observed: the last observation stays, marked with the failure (Spec D). The roster shows it
      // stale with the kernel's message and its bounded cause; other failures replace it as before.
      if (previous?.deployment?.status === "observed" && result.reason?.code === "E_REMOTE_UNREADABLE") {
        const { error: _error, errorCause: _cause, ...kept } = previous;
        const cause = result.reason.cause;
        return { ...kept, error: result.reason.message, ...(cause ? { errorCause: { code: result.reason.code, ...cause } } : {}) };
      }
      return { deployment: { status: "unavailable", reason: result.reason }, instances: [], generatedAt: new Date().toISOString() };
    }
    admitted.add(id);
    const { roster, workspaceStatus, observedAt } = result;
    const catalogKey = soulCatalogKey(cli, workspaceStatus);
    // Bind (or start) the souls read for this workspace state; never wait for it here. Age alone never
    // makes this cycle re-read: a catalog past HELD_TTL_MS is re-read when someone looks (/api/agents →
    // revalidateCatalog), so an idle app costs nothing and no deployment file is ever named to find out.
    const { entry: catalogEntry, pending } = soulCatalog.settle(id, cli, workspaceStatus, { maxAge });
    capabilityCatalog.ensure(id, cli, workspaceStatus, { maxAge });
    // Needs input: a row keeps the kernel's waitingOnYou only when this CLI advertises waiting-on-you.
    // Gate on the feature, never the version: a pre-feature kernel emitting the field is dropped.
    const waitingFeature = !!cli.features?.includes("waiting-on-you");
    const rows = roster.agents.flatMap((agent) => agent.instances.map(({ waitingOnYou, ...instance }) => ({
      ...instance, ...(waitingFeature && waitingOnYou !== undefined ? { waitingOnYou } : {}),
      agent: instance.agent || agent.name, description: agent.description || "",
      team: agent.team || null, agentsRoot: roster.root,
    })));
    const liveness = await observeLivenessRows(rows.map((i) => ({ instance: i.instance, tmux: i.tmux, sessionTarget: i.sessionTarget,
      runtimeState: i.runtimeState, runtimeError: i.runtimeError })));
    const instances = rows.map((row, index) => projectPanelInstance({ ...row, ...liveness[index] }))
      .sort((a, b) => (a.running === b.running ? String(a.instance).localeCompare(b.instance) : a.running ? -1 : 1));
    const entry = {
      deployment: { status: "observed", root: roster.root, workspace: workspaceStatus.workspace, workspaceStatus,
        reachable: roster.workspace ?? null, withheld: roster.withheld,
        souls: roster.agents.map(({ instances: _instances, ...soul }) => soul),
        catalog: catalogProjection(catalogEntry, !!pending), catalogKey },
      instances, generatedAt: new Date().toISOString(), observedAt,
    };
    // Attach the catalog when it lands: to THIS cycle's entry (it may land before the entry is published —
    // publication still waits on the liveness child and on the other deployments) and to whatever entry is
    // published by then.
    if (pending) attachCatalog(id, pending, entry);
    return entry;
  } finally { observing.delete(id); }
}
/** Put a landed souls catalog on the entries that were read under its key: `entry` (a cycle's, possibly not yet
 * published) and whatever is published for the deployment by then. Only an entry read under the same key takes
 * it (an unadopted flight lands under null and is re-read next cycle). */
function attachCatalog(id, pending, entry = null) {
  pending.then((landed) => {
    const projection = catalogProjection(landed, soulCatalog.refreshing(id));
    for (const target of [entry, snapshot.byWs.get(id)]) {
      if (target?.deployment?.status === "observed" && landed?.key === target.deployment.catalogKey) target.deployment.catalog = projection;
    }
  }).catch(() => { /* the entry keeps the last good catalog; the next cycle re-reads */ });
}
/** /api/agents found a held catalog past its TTL: answer from it (the caller projects it, with `refreshing`)
 * and start one re-read behind the answer, attached to the published entry when it lands. Request-driven on
 * purpose, and gated on window focus: the renderer's Spawn/Workspace view polls /api/agents every 8 s while
 * mounted, blurred or minimized included, so without the gate age would become a periodic `oats souls` run
 * again. Focused with that view open, the catalog is re-read about once per TTL + read; blurred, never. */
function revalidateCatalog(wsId) {
  if (!refreshLoop.focused()) return;
  const ws = deploymentFor(wsId);
  const published = ws && !ws.remote ? snapshot.byWs.get(ws.id) : null, d = published?.deployment;
  if (d?.status !== "observed" || !cliState.ok) return;
  const pending = soulCatalog.revalidate(ws.id, cliState, d.workspaceStatus, { maxAge: BACKGROUND_MAX_AGE });
  if (!pending) return;
  d.catalog = { ...d.catalog, refreshing: true }; // this answer says a re-read is in flight
  attachCatalog(ws.id, pending);
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
    remoteGroups = []; rosterAnswered = false; mergeRemotePanels(snapshot.byWs); return;
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
    if (env.ok) { rosterAnswered = true; rosterFailure = null; remoteIdentities.observe(incoming); }
    else if (!rosterAnswered) rosterFailure = env.error?.message || "Remote roster unavailable";
    mergeRemotePanels(snapshot.byWs);
  } catch (e) {
    if (cliState !== probe) return;
    remoteGroups = remote.unavailableGroups(remoteGroups, { code: "E_REMOTE_ROSTER", message: `Remote roster unavailable: ${e.message}` });
    if (!rosterAnswered) rosterFailure = `Remote roster unavailable: ${e.message}`;
    mergeRemotePanels(snapshot.byWs);
  } finally {
    remoteCollecting = false;
    if (cliState !== probe) void refreshRemoteSnapshot();
  }
}
/** One observation cycle over every registered deployment; the refresh loop owns when it runs. */
async function observeAll({ live = false } = {}) {
  try {
    // At most as many deployments at once as the observer admits, so every one is read each cycle (#461).
    const entries = await mapBounded(ctxs, MAX_DEPLOYMENT_OBSERVATIONS, async (id) => [id, await observeDeployment(id, { live })]);
    const byWs = new Map(entries);
    for (const [id, panel] of snapshot.byWs) if (id.startsWith("remote:")) byWs.set(id, panel);
    snapshot = { at: Date.now(), byWs: mergeRemotePanels(byWs) };
  } catch (e) { if (DEBUG) console.log(`[snapshot] refresh failed: ${e.message}`); }
}
// Cadence: the next cycle starts a fixed interval AFTER the previous one completed (a slow
// kernel is never asked twice at once), 5 s while a window is focused, 30 s while every window
// is blurred or hidden (/api/window-state); focus returning runs one prompt cycle. A cycle
// requested during a cycle (a mutation's result must be observed) runs exactly once right after.
const refreshLoop = createRefreshLoop({ run: observeAll, focusedMs: REFRESH_FOCUSED_MS, blurredMs: REFRESH_BLURRED_MS });
// The remote roster (`server roster`, one bounded CLI read) follows the same shape: 10 s focused, the same 30 s blurred.
const remoteLoop = createRefreshLoop({ run: () => refreshRemoteSnapshot(), focusedMs: 10_000, blurredMs: REFRESH_BLURRED_MS });
/* A workspace's own machines (#517): Where to run, the Setup tab's Machines, Add a machine. */
const machines = createMachines({ adapter, cli: () => cliState });
/** Observe now (or right after the cycle in flight); `live` makes the kernel observe the remotes afresh. */
function refreshSnapshot(options = {}) { return refreshLoop.request(options); }
/** A mutation this backend performed for a workspace: what inspect reported may have changed, and the
 * roster must observe the result live. Inspections are held under the workspace's SCOPE (the deployment
 * directory the kernel was pointed at), which is the id for a local deployment but not for a remote one. */
function observeMutation(wsId) {
  const scope = deployments().find((w) => w.id === wsId)?.scope;
  if (scope) inspectCache.invalidate(scope);
  // The dialog's held spawn previews are keyed by workspace id, not scope.
  if (wsId) spawnPreviewCache.invalidate(wsId);
  return refreshSnapshot({ live: true });
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
  for (const w of deployments()) {
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
  const ws = deploymentFor(wsId);
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
  for (const w of deployments()) for (const r of w.roots) admit(r);
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
    if (req.method === "GET" && (path === "/api/panel" || path === "/api/agents")) {
      const asked = url.searchParams.get("ws") || undefined;
      // An explicit workspace this server does not serve (a path, an id, a remote it no longer has) is
      // refused, never answered with another workspace's data. No ?ws= still means the first workspace.
      // A view id or a deployment id (a deployment answers with its view: a selection saved before views opens it).
      if (asked && !isServed(asked)) return send(res, 404, workspaceNotServed(asked));
      // Served from the latest kernel observation; never waits on a CLI read.
      if (path === "/api/panel") return send(res, 200, panelData(asked));
      revalidateCatalog(asked);
      return send(res, 200, agentsData(asked));
    }
    if (path === "/api/launch-configs" && req.method === "POST") {
      const asked = url.searchParams.get("ws");
      try {
        const request = await readBody(req);
        const workspace = surfaceDeployment(asked, request);
        const result = await launchConfigRequest(request, {
          workspace, cli: cliState, localCwd: ctxs[0] ?? homedir(),
          agents: workspace ? agentsData(workspace.id).agents : [],
          instances: workspace ? deploymentRows(workspace) : [],
        }).finally(() => { if (workspace && ['set', 'remove'].includes(request?.action)) spawnPreviewCache.invalidate(workspace.id); }); // the default launch a preview reports
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
          const workspace = deployments().find(w => w.id === url.searchParams.get("ws"));
          const observed = workspace ? snapshot.byWs.get(workspace.id) : null;
          // clones[]: the kernel's member keys and this computer's clone paths (#217), for the roster.
          return { workspace, cli: cliState, instances: observed?.instances || [], clones: observed?.deployment?.workspaceStatus?.clones || [] };
        };
        // The pull-request roster is the VIEW's: every local deployment's rows (keyed by home) and clones.
        // A view with no local deployment is remote, as a remote deployment was before views.
        if (path === "/api/forge-roster") return send(res, 200, await forgeBoundary.roster(request, () => viewForgeContext(url.searchParams.get("ws")), epoch));
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
          const workspace = deployments().find(w => w.id === url.searchParams.get('ws'));
          return { workspace, cli: cliState, epoch: cliProbeGeneration, localCwd: ctxs[0] ?? homedir(),
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
          const workspace = deploymentFor(url.searchParams.get('ws'));
          return { workspace, cli: cliState, agents: workspace && !workspace.remote && !workspace.server ? agentsData(workspace.id).agents : [],
            instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] };
        };
        // Settled answers are reused for a short window (server/spawn-preview.mjs); prepare never reads them.
        return send(res, 200, await spawnPreviewCachedRequest(request, getContext));
      } catch { return send(res, 400, previewFailure('E_BAD_ARGS')); }
    }
    if (path === '/api/workspace-readiness' && req.method === 'POST') {
      try {
        if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) throw new Error('bad query');
        const request = await readStrictBody(req);
        const getContext = () => {
          const workspace = deployments().find(w => w.id === url.searchParams.get('ws'));
          return { workspace, cli: cliState, agents: workspace && !workspace.remote && !workspace.server ? agentsData(workspace.id).agents : [],
            localCwd: ctxs[0] ?? homedir(), instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] };
        };
        return send(res, 200, await readinessRequest(request, getContext));
      } catch { return send(res, 400, readinessFailure('E_BAD_ARGS')); }
    }
    // Team model v2: the deployment's teams and a soul's teams, through the kernel verbs (the
    // only writer of oats-local.yaml). POST, so the Origin guard above covers every action.
    if ((path === '/api/workspace-teams' || path === '/api/workspace-soul-teams') && req.method === 'POST') {
      try {
        if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) throw new Error('bad query');
        const request = await readStrictBody(req, 4096);
        const getContext = () => ({ workspace: deploymentFor(url.searchParams.get('ws')), cli: cliState });
        const result = await (path === '/api/workspace-teams' ? teamsRequest : soulTeamsRequest)(request, getContext);
        // The writing actions change oats-local.yaml; inspect reports a soul's teams, so the held inspections go
        // (held under the workspace's scope, see observeMutation).
        if (['add', 'remove', 'default', 'clear-default'].includes(request.action)) {
          const { scope, id } = getContext().workspace || {};
          if (scope) inspectCache.invalidate(scope);
          if (id) spawnPreviewCache.invalidate(id); // a spawn preview reports the soul's teams
        }
        return send(res, 200, result);
      } catch { return send(res, 400, teamsFailure('E_BAD_ARGS')); }
    }
    if (path === '/api/instance-lifecycle' && req.method === 'POST') {
      try {
        if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) throw new Error('bad query');
        const request = await readStrictBody(req);
        const getContext = () => {
          const workspace = deployments().find(w => w.id === url.searchParams.get('ws'));
          return { workspace, cli: cliState, localCwd: ctxs[0] ?? homedir(), instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] };
        };
        const result = await lifecycleRequest(request, getContext);
        if (request.action === 'apply' && ['complete', 'partial', 'refused', 'unknown'].includes(result.status)) {
          // A remote apply (even an unknown outcome) re-reads the remote roster at once: the operator sees current state.
          try { if (getContext().workspace?.remote) void remoteLoop.request(); else observeMutation(url.searchParams.get('ws')); }
          catch { /* a refresh must not erase a mutation receipt */ }
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
        const workspace = deployments().find(w => w.id === url.searchParams.get("ws"));
        // Never collect Git here or fall back to another workspace.
        // An absent exact snapshot is unavailable; refreshing the roster is
        // the existing collector's job, not an authority to infer another home.
        const result = await instanceGitRequest(request, { workspace, cli: cliState, localCwd: ctxs[0] ?? homedir(),
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
        const workspace = deploymentFor(url.searchParams.get("ws"));
        const result = await workspaceSyncRequest(request, { workspace, cli: cliState });
        if (request?.action === "sync" && result.status === "ok") {
          try { observeMutation(workspace?.id); } catch { /* a refresh must not erase the sync report */ }
        }
        return send(res, 200, result);
      } catch { return send(res, 400, syncFailure("E_BAD_ARGS")); }
    }
    if (path === "/api/capabilities" && req.method === "POST") {
      const asked = url.searchParams.get("ws");
      try {
        const request = await readStrictBody(req);
        const workspace = surfaceDeployment(asked, request);
        if (request?.action === "show" || request?.action === "file") {
          // What a capability ships (server/capability-show.mjs): its own gate (capability-show), not the
          // operations API's. The selector must match a row of the held table; with none held yet for an
          // observed deployment, the catalog read (held answer at once, else one kernel read) supplies it.
          try {
            const result = await capabilityShowRequest(request, { workspace, cli: cliState, cache: capabilityShowCache, maxAge: BACKGROUND_MAX_AGE,
              catalog: async () => {
                const d = workspace && !workspace.remote ? snapshot.byWs.get(workspace.id)?.deployment : null;
                const entry = d?.status === "observed" ? await capabilityCatalog.read(workspace.id, cliState, d.workspaceStatus, { maxAge: BACKGROUND_MAX_AGE })
                  : capabilityCatalog.held(workspace.id);
                return entry?.capabilities?.capabilities ?? null;
              } });
            return send(res, 200, result);
          } catch (e) {
            const code = typeof e?.code === "string" ? e.code : "E_CLI_FAILED";
            return send(res, code === "E_BAD_ARGS" ? 400 : 409, { error: String(e?.message || "").slice(0, 4096), code });
          }
        }
        // Inspections are served from the held cache (keyed by the soul catalog's key or the instance's
        // reported identity) and coalesced; `refresh: true` observes live. A run never touches the cache.
        // A soul inspection's key is the capabilities key (member/workspace commits, package rows, lock currency);
        // what no key can see (local configuration edited outside Desktop) is bounded by the cache TTL.
        const observed = workspace && !workspace.remote ? snapshot.byWs.get(workspace.id)?.deployment : null;
        const result = await capabilityRequest(request, {
          workspace, cli: cliState, localCwd: ctxs[0] ?? homedir(),
          agents: workspace ? agentsData(workspace.id).agents : [],
          instances: workspace ? deploymentRows(workspace) : [],
          cache: inspectCache, maxAge: BACKGROUND_MAX_AGE,
          catalogKey: observed?.status === "observed" ? capabilityCatalogKey(cliState, observed.workspaceStatus) : null,
        }).finally(() => { if (workspace && request?.action === "run") spawnPreviewCache.invalidate(workspace.id); }); // an operation can change what a spawn preview reads
        return send(res, 200, result);
      } catch (e) { const { status, body } = spawnErrorPayload(e); return send(res, status, body); }
    }
    if (path === '/api/automations') {
      // Triggers and schedules (feature automations): one local workspace, the kernel's lists and verbs ({ kind, action, key? }).
      if (req.method !== 'POST') return send(res, 405, automationsFailure('E_BAD_ARGS'));
      let request;
      try { ({ body: request } = await readStrictBody(req, 4096, true)); } catch { return send(res, 400, automationsFailure('E_BAD_ARGS')); }
      if (url.searchParams.getAll('ws').length !== 1 || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) return send(res, 400, automationsFailure('E_BAD_ARGS'));
      const workspace = deploymentFor(url.searchParams.get('ws'));
      return send(res, 200, await automationsRequest(request, { workspace, cli: cliState }));
    }
    if (path === '/api/schedules') {
      // The local schedule form's verbs (add/update/remove, reconcile, host-*). Reading and
      // enable/disable/run/test are the kernel's automations (/api/automations, §2.3a).
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed', code: 'E_METHOD_NOT_ALLOWED' });
      let request;
      try { ({ body: request } = await readStrictBody(req, 65536, true)); } catch { return send(res, 400, { error: 'Invalid schedule request', code: 'E_BAD_ARGS' }); }
      // No default workspace: a mutation names its workspace.
      const workspace = surfaceDeployment(url.searchParams.get('ws'), request);
      try {
        const result = await scheduleRequest(request, {
          workspace, cli: cliState, localCwd: ctxs[0] ?? homedir(),
          agents: workspace ? agentsData(workspace.id).agents : [],
          instances: workspace ? deploymentRows(workspace) : [],
        });
        return send(res, 200, result);
      } catch (e) { const { status, body } = spawnErrorPayload(e); return send(res, status, body); }
    }
    const bm = path.match(/^\/api\/brain\/([A-Za-z0-9._-]+)$/);
    if (bm && req.method === "GET") {
      if (deploymentFor(url.searchParams.get("ws"))?.remote) return send(res, 409, { error: "Remote files are available through the agent terminal", code: "E_REMOTE_FILES" });
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
    if (req.method === "GET" && path === "/api/team-members") {
      // Who is in each team, wherever it runs (spec 02): the held observations only, no command.
      if (url.searchParams.getAll("ws").length !== 1 || [...url.searchParams.keys()].some(k => k !== "ws")) return send(res, 400, { error: "Expected one workspace selector", code: "E_BAD_ARGS" });
      // The VIEW's members (#482): its deployments only, each member tagged with its deployment and machine.
      const result = teamMembersFor(url.searchParams.get("ws"));
      if (!result) return send(res, 400, { error: "Select a known workspace", code: "E_WORKSPACE_UNKNOWN" });
      return send(res, 200, result);
    }
    if (req.method === "GET" && path === "/api/servers") {
      // Registered execution servers, read through the CLI (the Desktop
      // holds no registry of its own). Without a compatible CLI there are
      // no servers to offer, which the renderer renders as "local only".
      if (!cliState.ok) return send(res, 200, { servers: [], reason: "cli-unavailable" });
      // #517: with servers-per-workspace and server-connect, only the window's own machines (server/machines.mjs).
      if (machinesGated(cliState)) {
        if (url.searchParams.getAll("ws").length > 1 || [...url.searchParams.keys()].some((k) => k !== "ws")) return send(res, 400, { error: "Expected one workspace selector", code: "E_BAD_ARGS" });
        const scope = machineScope(url.searchParams.get("ws"));
        if (!scope) return send(res, 400, { error: "Select a known workspace", code: "E_WORKSPACE_UNKNOWN" });
        try { return send(res, 200, await machines.forScope(scope)); }
        catch (e) { return send(res, 200, { servers: [], key: scope.key, filtered: true, deployment: null, aweb: false, error: { code: e.code || "E_SERVERS", message: e.message || "The server registry could not be read" } }); }
      }
      const env = await adapter.cliServers(cliState.bin);
      if (!env.ok) return send(res, 200, { servers: [], reason: env.error?.code || "E_SERVERS" });
      return send(res, 200, { servers: (env.result.servers || []).map((s) => ({ id: s.id, label: s.label || s.id, sshHost: s.sshHost, workspace: s.workspace })) });
    }
    if (req.method === "POST" && ["/api/server-check", "/api/server-remove", "/api/server-connect"].includes(path)) {
      // #517: Check, Remove and Add a machine for the window's workspace (server/machines.mjs admits each id
      // by its workspace key). Fixed argv through the CLI; its envelope is relayed, never its stderr.
      if (url.searchParams.getAll("ws").length !== 1 || [...url.searchParams.keys()].some((k) => k !== "ws")) return send(res, 400, { error: "Expected one workspace selector", code: "E_BAD_ARGS" });
      let body;
      try { body = await readStrictBody(req, 4096); } catch (e) { return send(res, 400, { error: e.message, code: "E_BAD_ARGS" }); }
      const scope = machineScope(url.searchParams.get("ws"));
      if (!scope) return send(res, 400, { error: "Select a known workspace", code: "E_WORKSPACE_UNKNOWN" });
      try {
        if (path === "/api/server-check") return send(res, 200, await machines.check(scope, body.id));
        const envelope = path === "/api/server-remove" ? await machines.remove(scope, body.id) : await machines.connect(scope, body);
        // A registration changed: the remote roster reads it now, so the view gains (or loses) that deployment.
        if (envelope?.ok) void remoteLoop.request();
        return send(res, 200, envelope);
      } catch (e) {
        return send(res, e.code === "E_BUSY" || e.code === "E_FEATURE" ? 409 : 400, { error: e.message, code: e.code || "E_BAD_ARGS" });
      }
    }
    if (req.method === "GET" && path === "/api/cli") {
      return send(res, 200, servedCliStatus());
    }
    if (req.method === "POST" && path === "/api/window-state") {
      // Window activity from the Electron main process (window-activity.mjs): the refresh cadence backs off
      // while every window is blurred or hidden, and focus returning runs one prompt cycle. POST, so the
      // Host/Origin guards above cover it; the body is one boolean and nothing else.
      let body;
      try { body = await readStrictBody(req, 1024); } catch { return send(res, 400, { error: "body needs { focused: boolean }", code: "E_BAD_ARGS" }); }
      if (typeof body.focused !== "boolean" || Object.keys(body).length !== 1) return send(res, 400, { error: "body needs { focused: boolean }", code: "E_BAD_ARGS" });
      refreshLoop.setFocused(body.focused); remoteLoop.setFocused(body.focused);
      return send(res, 200, { focused: refreshLoop.focused() });
    }
    if (req.method === "POST" && path === "/api/cli/reprobe") {
      // Re-probe triggers (contract): launch, app focus, explicit Retry, and
      // after choosing a binary — main/renderer call this; body may carry a
      // user-chosen absolute path which becomes the top-priority candidate.
      const body = await readBody(req);
      const chosen = typeof body.bin === "string" && body.bin.startsWith("/") ? body.bin : undefined;
      await reprobeCli(chosen);
      return send(res, 200, servedCliStatus());
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
          const workspace = deploymentFor(url.searchParams.get('ws'));
          return { workspace, cli: cliState, agents: workspace && !workspace.remote && !workspace.server ? agentsData(workspace.id).agents : [],
            instances: workspace ? snapshot.byWs.get(workspace.id)?.instances || [] : [] };
        };
        // A spawn in the air changes what a preview answers (the next instance number, the roster): held
        // previews go when it starts, and again when it ends (observeMutation), so a preview read meanwhile
        // never refills them with the pre-spawn answer (the cache's flight clock).
        if (body.action === 'apply') { try { spawnPreviewCache.invalidate(url.searchParams.get('ws')); } catch { /* never blocks the apply */ } }
        const result = await spawnApplyRequest(body, getContext);
        if (body.action === 'apply') { try { observeMutation(url.searchParams.get('ws')); } catch { /* a refresh must not erase a spawn receipt */ } }
        return send(res, 200, result);
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
          if (!canAddressRemote(inst)) return send(res, 409, { error: unaddressableSentence(inst), code: "E_SNAPSHOT_UNKNOWN" });
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
          workspaceDir: inst.server ? ctxs[0] ?? homedir() : dirname(inst.agentsRoot), server: inst.server });
        observeMutation(url.searchParams.get("ws")); void refreshRemoteSnapshot();
        return env.ok ? send(res, 200, env.result) : send(res, env.error.code === "E_BAD_ARGS" ? 400 : 409, { error: env.error.message, code: env.error.code });
      }
      /* OATSWEB_START_END */
      const workspace = deployments().find(w => w.id === url.searchParams.get("ws"));
      const result = await capabilityRequest({ action: "run", selector: { home: inst.home }, operation: "knowledge:harvest" }, {
        workspace, cli: cliState, localCwd: ctxs[0] ?? homedir(),
        agents: workspace ? agentsData(workspace.id).agents : [],
        instances: workspace ? deploymentRows(workspace) : [],
        cache: inspectCache, // a run invalidates the deployment's held inspections
      }).finally(() => { if (workspace) spawnPreviewCache.invalidate(workspace.id); });
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
  console.log(`oats-desktop server — API at ${addr}  (workspaces: ${deployments().map((w) => w.name).join(", ") || "none"})`);
  console.log("Bound to 127.0.0.1 only. This process can type into your agent terminals — do not expose it.");
});
void refreshLoop.start();                // the first cycle publishes "pending" until the CLI probe settles
reprobeCli().then((s) => {
  console.log(s.ok
    ? `oats-desktop server: oats CLI ${s.version} at ${s.bin} (${s.source})`
    : `oats-desktop server: no compatible oats CLI found — reads and terminals work; Spawn/Harvest disabled (${(s.tried || []).length} candidate(s) tried)`);
});
void remoteLoop.start();                 // coalesced host reads, independent of terminal traffic
