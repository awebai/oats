// A remote roster group and row in the shape the kernel's `oats server roster --json` emits them
// (lib/servers.mjs, rosterGroups): a row carries every REMOTE_ROW_FACTS key, null unless the host
// reported it, so `runtimeState` is null on a running row (#582). Hand-built on purpose: Desktop tests
// never import the kernel (#577). The kernel's own suite feeds real rosterGroups output through
// remotePanel and waitingClaim; keep this shape equal to it.
import { remotePanel } from "../../server/remote-roster.mjs";

const AGENTS_ROOT = "/remote/project/agents";
const REMOTE_ROW_FACTS = ["identity", "identityAddress", "teams", "startedAt", "createdAt", "model", "runtimeState",
  "parentInstance", "siblingInstance", "relation", "relativeTo", "spawnOrigin"];

/** A row the host listed: running in tmux unless `extra` says otherwise. */
export const kernelRemoteRow = (name = "dev-one", extra = {}) => ({
  server: "host", instance: name, agent: "dev", home: `${AGENTS_ROOT}/dev/instances/${name}`, agentsRoot: AGENTS_ROOT,
  harness: "claude", backend: "tmux", tmux: { session: "oats", window: name }, running: true,
  ...Object.fromEntries(REMOTE_ROW_FACTS.map(key => [key, null])),
  retirePending: false, rollbackIncomplete: false, savedRoute: true, addressable: true, missingRemotely: false, ...extra });

/** A saved route the host did not list (retired there, or its home removed): nothing is known but the route. */
export const kernelGoneRow = (name = "dev-gone", extra = {}) => ({
  server: "host", instance: name, agent: "dev", home: `${AGENTS_ROOT}/dev/instances/${name}`, agentsRoot: AGENTS_ROOT,
  harness: "claude", backend: null, running: null,
  ...Object.fromEntries(REMOTE_ROW_FACTS.map(key => [key, null])),
  retirePending: false, rollbackIncomplete: false, savedRoute: true, addressable: false, missingRemotely: true, ...extra });

export const kernelRemoteGroup = (instances = [kernelRemoteRow()], extra = {}) => ({
  id: "host:build:/remote/project", server: "host", label: "Build server", registrationPresent: true,
  target: { sshHost: "build", workspace: "/remote/project" }, probe: { ok: true }, agentsRoot: AGENTS_ROOT, workspace: null,
  souls: [{ name: "dev", harness: "claude", work: "worktree", backend: "tmux", description: "", agentsRoot: AGENTS_ROOT }],
  instances, retireFailures: [], ...extra });

/** The rows the renderer receives for those kernel rows: the shipped remotePanel projection. */
export const remoteRows = (instances, extra) => remotePanel(kernelRemoteGroup(instances, extra)).instances;
