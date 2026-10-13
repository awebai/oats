import { harnessOf } from "./harness-names.mjs";
import { unsupportedSession, unsupportedSessionOrigin, hasRuntimeError } from "./instance-presentation.mjs";
import { madeByKernel } from "./kernel-made.mjs";
import { waitingOnYouData } from "./waiting-on-you.mjs";
/** Projection of the installed CLI's remote roster. Never reads remote paths locally. */
export function remoteWorkspace(group) {
  return {
    id: `remote:${group.id}`, name: group.label || group.server,
    scope: group.target.workspace, roots: [], team: null, remote: true,
    server: group.server, registrationPresent: group.registrationPresent, group,
  };
}

/** The time a caller gives, or a TypeError when it gave none: this module reads no clock. `table` names
 * the function that was called without it (as client-terms.mjs `requireTerms` does for terms). */
function requireTime(at, table) {
  if (typeof at !== "string" || !at) throw new TypeError(`${table}: at must be the time of the call, a non-empty string`);
  return at;
}

/** A remote deployment's panel. `at` is the time the panel is made, an ISO string, and is required: the
 * caller holds the time of its call (panel-views.mjs passes `held.at`) and no clock is read here.
 *
 * A row is the host's row, spread whole, so a row with a `runtimeError` gets its speaker here
 * (`runtimeErrorOrigin`; instance-presentation.mjs names the three) and any other row gets none: a
 * `runtimeErrorOrigin` a host sent never survives, on any path. Which text it is decides:
 *
 *   a Herdr row                          "kernel" for the host's own reason, no key for the stand-in
 *   a reached server                     the host's row text: "kernel" (a host's OATS, relayed)
 *   a server not reached, an error the   "kernel": the mark of kernel-made.mjs, set where the roster's
 *     installed CLI printed                answer is parsed (cli-adapter.mjs `cliRemoteRoster`)
 *   a server not reached, any other      "roster-read": written while the roster was read (a read
 *     error, or none ("Server is           that threw, a timeout, an answer that is not the contract's)
 *     unreachable")
 *
 * No code and no message is read to decide it. The mark is on the error object: a group is held and
 * passed back as it was answered (`remoteRosterState`), and a copy of its `probe.error` reads as
 * "roster-read", never as the kernel's. */
export function remotePanel(group, at) {
  requireTime(at, "remotePanel");
  const ws = remoteWorkspace(group);
  // A row's soul subtitle: its own group's soul list only, a string as the host reported it, never synthesized.
  const described = name => { const soul = (group.souls || []).find((a) => a?.name === name); return typeof soul?.description === "string" ? soul.description : null; };
  // A Herdr-recorded row is unsupported whatever the host's probe said: it cannot open or start.
  const instances = (group.instances || []).map(({ runtime: _released, runtimeErrorOrigin: _sent, ...i }) => {
    const unsupported = unsupportedSession(i);
    const origin = unsupported ? unsupportedSessionOrigin(i) : group.probe.ok || (group.probe.error?.message && madeByKernel(group.probe.error)) ? "kernel" : "roster-read";
    const row = {
      ...i, server: group.server, savedRoute: i.savedRoute === true,
      // The last roster read of this server failed: its rows are last-known, their state unknown.
      serverUnreached: !group.probe.ok,
      home: i.home, agentsRoot: i.agentsRoot || group.agentsRoot,
      workspace: group.target.workspace, repoName: group.label || group.server,
      harness: harnessOf({ runtime: _released, ...i }) || null, model: i.model || null, description: described(i.agent),
      running: group.probe.ok ? i.running : null,
      runtimeError: group.probe.ok ? i.runtimeError : group.probe.error?.message || "Server is unreachable",
      tmux: i.tmux || null, git: i.git || null, task: i.task || "", next: i.next || "",
      // Needs input: only a remote kernel with the feature reports it — validated, never synthesized when absent.
      ...(Object.hasOwn(i, "waitingOnYou") ? { waitingOnYou: waitingOnYouData(i.waitingOnYou) } : {}),
      ...(unsupported ? { running: null, runtimeState: "unsupported", runtimeError: unsupported } : {}),
    };
    return hasRuntimeError(row) && origin ? { ...row, runtimeErrorOrigin: origin } : row;
  });
  return {
    workspace: { id: ws.id, name: ws.name, scope: ws.scope, team: null, server: ws.server,
      remote: true, registrationPresent: ws.registrationPresent === true },
    team: null, generatedAt: at,
    running: instances.filter((i) => i.running).length, instances,
    error: group.probe.ok ? null : group.probe.error?.message || "Server is unreachable",
  };
}

export function remoteAgents(group) {
  if (!group.registrationPresent || !group.probe.ok) return [];
  return (group.souls || []).map(({ runtime: _released, ...a }) => ({
    ...a, server: group.server, remote: true,
    agentsRoot: a.agentsRoot || group.agentsRoot,
    workspace: group.target.workspace, repoName: group.label || group.server,
    // The reported default harness only (a pre-0.27 host's `runtime` is read as it); never a guessed pi.
    harness: harnessOf({ runtime: _released, ...a }) || null, backend: a.backend || "tmux", work: a.work || "checkout",
    kind: a.kind || "persistent", description: a.description || "",
  }));
}

export function unavailableGroups(groups, error) {
  return groups.map((g) => ({ ...g, probe: { ok: false, error }, instances: (g.instances || []).map((i) => ({ ...i, running: null })) }));
}

/** The roster read's failure in words, and as the error an unavailable group carries. */
const ROSTER_UNAVAILABLE = "Remote roster unavailable";
const rosterError = (message) => ({ code: "E_REMOTE_ROSTER", message });

/**
 * What one outcome of `oats server roster --json` makes of the roster a client holds. No state: the
 * client keeps the three values between reads and passes them back as `previous`.
 *
 *   previous: { remoteGroups, rosterAnswered, rosterFailure }
 *   outcome:  { gated: true }     no accepted CLI, or one that does not read other machines
 *                                 (panel-views.mjs `cliReadsRemotes`): the read was not made
 *           | { envelope }        what the CLI answered (cli-adapter.mjs `cliRemoteRoster`)
 *           | { thrown: string }  the read failed: the message of what was thrown
 *   at:       the caller's time, the one `remotePanel` stamps
 *   ->        { remoteGroups, rosterAnswered, rosterFailure, reported }
 *
 * `remoteGroups` is the last readable roster: an answer replaces it only when every group of it can be
 * projected (`remotePanel`), and a failed read keeps the groups held, each marked not reached
 * (`unavailableGroups`). `rosterAnswered` says an answer arrived; `rosterFailure` is the failure's
 * sentence, kept only while none has. `reported` is what the client hands to its memory of identities
 * (remote-identity-memory.mjs `observeIdentities`): the groups of an `ok` envelope, else null.
 *
 * The sentence of a thrown read carries the message of an error from outside the client: a client
 * shows it through `displayLine` (display-text.mjs) only.
 *
 * What stays the caller's: one read at a time, when it runs, and dropping an answer that was read
 * with a kernel record that is no longer the accepted one. And its own `try`/`catch` around the read
 * and around what it does with `reported`: if that step throws after the caller took the new state, the
 * caller takes `{ thrown: <message> }` next, so the groups it just took are marked not reached.
 */
export function remoteRosterState(previous, outcome, at) {
  requireTime(at, "remoteRosterState");
  if (outcome.gated) return { remoteGroups: [], rosterAnswered: false, rosterFailure: previous.rosterFailure, reported: null };
  /** A read with no answer to keep: the groups held, marked; the sentence only while no answer has ever arrived. */
  const failed = (message) => ({
    remoteGroups: unavailableGroups(previous.remoteGroups, rosterError(message)), rosterAnswered: previous.rosterAnswered,
    rosterFailure: previous.rosterAnswered ? previous.rosterFailure : message, reported: null,
  });
  if (!Object.hasOwn(outcome, "envelope")) return failed(`${ROSTER_UNAVAILABLE}: ${outcome.thrown}`);
  try {
    const env = outcome.envelope;
    const incoming = env.ok && Array.isArray(env.result?.groups)
      ? env.result.groups : unavailableGroups(previous.remoteGroups, env.error || rosterError(ROSTER_UNAVAILABLE));
    for (const group of incoming) remotePanel(group, at); // validate before replacing the last readable roster
    if (env.ok) return { remoteGroups: incoming, rosterAnswered: true, rosterFailure: null, reported: incoming };
    return { remoteGroups: incoming, rosterAnswered: previous.rosterAnswered,
      rosterFailure: previous.rosterAnswered ? previous.rosterFailure : env.error?.message || ROSTER_UNAVAILABLE, reported: null };
  } catch (e) {
    // An answer that cannot be read, or a group of it that cannot be projected: as a read that threw.
    return failed(`${ROSTER_UNAVAILABLE}: ${e.message}`);
  }
}

/** The panel of each group, keyed as a client's snapshot keys it: [[`remote:<group id>`, panel], …], every one made at `at`. */
export function remotePanelEntries(remoteGroups, at) {
  requireTime(at, "remotePanelEntries");
  return remoteGroups.map((group) => { const panel = remotePanel(group, at); return [panel.workspace.id, panel]; });
}

export function spawnedWorkspace(groups, result) {
  if (!result.server || !result.target) return undefined;
  const group = groups.find((g) => g.server === result.server && g.registrationPresent
    && g.target.sshHost === result.target.sshHost && g.target.workspace === result.target.workspace);
  return group ? remoteWorkspace(group).id : undefined;
}
