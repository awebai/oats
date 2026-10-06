import { harnessOf } from "../renderer/harness-names.mjs";
import { unsupportedSession } from "../renderer/instance-presentation.mjs";
import { waitingOnYouData } from "../renderer/waiting-on-you.mjs";
/** Projection of the installed CLI's remote roster. Never reads remote paths locally. */
export function remoteWorkspace(group) {
  return {
    id: `remote:${group.id}`, name: group.label || group.server,
    scope: group.target.workspace, roots: [], team: null, remote: true,
    server: group.server, registrationPresent: group.registrationPresent, group,
  };
}

export function remotePanel(group) {
  const ws = remoteWorkspace(group);
  // A row's soul subtitle: its own group's soul list only, a string as the host reported it, never synthesized.
  const described = name => { const soul = (group.souls || []).find((a) => a?.name === name); return typeof soul?.description === "string" ? soul.description : null; };
  // A Herdr-recorded row is unsupported whatever the host's probe said: it cannot open or start.
  const instances = (group.instances || []).map(({ runtime: _released, ...i }) => {
    const unsupported = unsupportedSession(i);
    return {
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
  });
  return {
    workspace: { id: ws.id, name: ws.name, scope: ws.scope, team: null, server: ws.server,
      remote: true, registrationPresent: ws.registrationPresent === true },
    team: null, generatedAt: new Date().toISOString(),
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

export function spawnedWorkspace(groups, result) {
  if (!result.server || !result.target) return undefined;
  const group = groups.find((g) => g.server === result.server && g.registrationPresent
    && g.target.sshHost === result.target.sshHost && g.target.workspace === result.target.workspace);
  return group ? remoteWorkspace(group).id : undefined;
}
