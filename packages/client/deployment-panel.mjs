/** What one deployment's observation becomes for a client's panel (#855, 1d): the kernel's roster as
 * rows, the liveness collector's input and its answers, each row as the panel serves it, and the
 * deployment's entry: before the first probe, after a failed read, and observed.
 *
 * Every function takes what it needs and returns a value. Nothing is kept between calls, and nothing
 * here reads a clock, a file or a process: a client runs the collector itself (liveness-main.mjs, as a
 * child, with its own environment and limits) and gives what it printed to `livenessAnswers`, and it
 * passes the time of its call as `at`, an ISO string. Each client keeps its own store of entries.
 *
 * Not for a page: this module imports `node:path`. What a page shows of a deployment that is not
 * observed is in deployment-facts.mjs (`deploymentUnavailableText`), and the Desktop's
 * test/inventory.test.mjs holds that its page reaches no module that imports a Node builtin. */
import { dirname } from 'node:path';

/** One row per instance of a roster (deployment-data.mjs `deploymentStatusData`): the kernel's row,
 * with `agent`, `description` and `team` from its soul and `agentsRoot` from the roster.
 * Needs input: a row keeps the kernel's `waitingOnYou` only when this CLI advertises waiting-on-you.
 * Gate on the feature, never the version: a pre-feature kernel emitting the field is dropped. A row
 * without the key stays without it. */
export function rosterRows(roster, cli) {
  const waitingFeature = Array.isArray(cli?.features) && cli.features.includes("waiting-on-you");
  return roster.agents.flatMap((agent) => agent.instances.map(({ waitingOnYou, ...instance }) => ({
    ...instance, ...(waitingFeature && waitingOnYou !== undefined ? { waitingOnYou } : {}),
    agent: instance.agent || agent.name, description: agent.description || "",
    team: agent.team || null, agentsRoot: roster.root,
  })));
}

/** The liveness collector's input (liveness.mjs `observeLiveness`), one per row, in the rows' order.
 * `running` is the kernel's answer: the collector leaves a row it answered `null` as the kernel has it. */
export function livenessInput(rows) {
  return rows.map((i) => ({ instance: i.instance, running: i.running, tmux: i.tmux, sessionTarget: i.sessionTarget,
    runtimeState: i.runtimeState, runtimeError: i.runtimeError }));
}

/** The collector's answers, one per row. `stdout` is what the collector printed, or `null` when it
 * failed, timed out or could not start. Anything that is not JSON for an array of exactly
 * `rows.length` answers gives every row the unknown answer; no rows give `[]`, whatever was printed. */
export function livenessAnswers(rows, stdout) {
  if (!rows.length) return [];
  const unknown = () => rows.map(() => ({ running: null, runtimeState: "unreachable", runtimeError: "Terminal status is unavailable" }));
  if (typeof stdout !== "string") return unknown();
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) && parsed.length === rows.length ? parsed : unknown();
  } catch { return unknown(); }
}

/** A row as the panel serves it: the per-instance contract a client's grouping and overview read.
 * A dropped or misspelt field here is a field no view receives. */
export function panelInstance(i) {
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
    // cluster-first overview.
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
    // #802: a spawn setting up its worktree (deployment-data.mjs keeps it as true only).
    ...(i.spawnInProgress === true ? { spawnInProgress: true } : {}),
    ...(i.captured ? { captured: true } : {}),
    // Needs input (PR K): the validated claim (or null, unknown) as status reported it; absent stays absent.
    // The client's liveness is merged before projection, so running/runtimeState beside it are the probe's.
    ...(i.waitingOnYou !== undefined ? { waitingOnYou: i.waitingOnYou } : {}),
    team: i.team || null,
  };
}

/** The panel's rows: each row merged with its liveness answer and projected, running first, then by name. */
export function panelInstances(rows, answers) {
  return rows.map((row, index) => panelInstance({ ...row, ...answers[index] }))
    .sort((a, b) => (a.running === b.running ? String(a.instance).localeCompare(b.instance) : a.running ? -1 : 1));
}

/** A deployment's entry before the first CLI probe has settled, when there is no verdict to report:
 * the entry already held, or a pending one. */
export function pendingEntry(previous, at) {
  return previous || { deployment: { status: "pending" }, instances: [], generatedAt: at };
}

/** A deployment's entry after a read that failed with `reason` (deployment-contract.mjs).
 * A transient busy or stale read keeps the entry held, as it is. A remote the kernel could not read
 * (a cache problem, the network, a timeout) does not erase what was observed: the last observation
 * stays, marked with the failure, the kernel's message and its bounded cause (Spec D); an `error` and
 * an `errorCause` it already carried are replaced, the cause removed when this reason has none.
 * Every other failure, and each of those without an entry to keep, is shown as unavailable with the
 * reason, never as an empty roster. */
export function failedEntry(previous, reason, at) {
  if (previous && ["E_DEPLOYMENT_BUSY", "E_DEPLOYMENT_STALE"].includes(reason?.code)) return previous;
  if (previous?.deployment?.status === "observed" && reason?.code === "E_REMOTE_UNREADABLE") {
    const { error: _error, errorCause: _cause, ...kept } = previous;
    const cause = reason.cause;
    return { ...kept, error: reason.message, ...(cause ? { errorCause: { code: reason.code, ...cause } } : {}) };
  }
  return { deployment: { status: "unavailable", reason }, instances: [], generatedAt: at };
}

/** An observed deployment's entry: the observer's answer (deployment-observer.mjs: `roster`,
 * `workspaceStatus`, `observedAt`) and the panel's rows (`panelInstances`). `souls` are the roster's
 * souls without their instances. A client adds its own facts to `deployment` after the call. */
export function observedEntry({ roster, workspaceStatus, observedAt }, instances, at) {
  return {
    deployment: { status: "observed", root: roster.root, workspace: workspaceStatus.workspace, workspaceStatus,
      reachable: roster.workspace ?? null, withheld: roster.withheld,
      souls: roster.agents.map(({ instances: _instances, ...soul }) => soul) },
    instances, generatedAt: at, observedAt,
  };
}

/** The deployment facts a view may show: the header observation, reachability and any unavailable
 * reason. Pending when there is none; as it is when not observed; without the private soul rows
 * (`souls`) and the catalog's key when observed. */
export function publicDeployment(deployment) {
  if (!deployment) return { status: "pending" };
  if (deployment.status !== "observed") return deployment;
  const { souls: _souls, catalogKey: _catalogKey, ...rest } = deployment;
  return rest;
}
