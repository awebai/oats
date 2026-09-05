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
  const instances = (group.instances || []).map((i) => ({
    ...i, server: group.server, savedRoute: i.savedRoute === true,
    home: i.home, agentsRoot: i.agentsRoot || group.agentsRoot,
    workspace: group.target.workspace, repoName: group.label || group.server,
    runtime: i.runtime || null, model: i.model || null,
    running: group.probe.ok ? i.running : null,
    runtimeError: group.probe.ok ? i.runtimeError : group.probe.error?.message || "Server is unreachable",
    tmux: i.tmux || null, git: i.git || null, task: i.task || "", next: i.next || "",
  }));
  return {
    workspace: { id: ws.id, name: ws.name, team: null, server: ws.server, remote: true },
    team: null, generatedAt: new Date().toISOString(),
    running: instances.filter((i) => i.running).length, instances,
    error: group.probe.ok ? null : group.probe.error?.message || "Server is unreachable",
  };
}

export function remoteAgents(group) {
  if (!group.registrationPresent || !group.probe.ok) return [];
  return (group.souls || []).map((a) => ({
    ...a, server: group.server, remote: true,
    agentsRoot: a.agentsRoot || group.agentsRoot,
    workspace: group.target.workspace, repoName: group.label || group.server,
    runtime: a.runtime || "pi", backend: a.backend || "tmux", work: a.work || "checkout",
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
