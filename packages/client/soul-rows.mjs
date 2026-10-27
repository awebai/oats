/** The souls a local deployment offers, one row each: what a client lists and opens. The rows come
 * from the kernel's spawn catalog (`oats souls --json`, held by soul-catalog.mjs: non-private souls
 * of confirmed members, external souls and package souls, each with its declared work mode), and
 * two facts the catalog does not carry: a soul's colour, from the roster's `souls` (soul-colors.mjs
 * keeps only a palette name), and its member's name, from `workspace status`. Nothing is read from
 * soul.yaml, and a soul outside the catalog has no row, so it is not offered for spawning.
 *
 *   soulRows(deployment, catalog) -> rows, sorted by name
 *
 *   deployment  an observed deployment, as deployment-panel.mjs `observedEntry` makes it: `root`
 *               (the agents root), `souls` (the roster's) and `workspaceStatus.members`
 *   catalog     the held catalog's `souls` list; null or absent: no rows
 *
 * No state: the rows are built from the two arguments on every call. */
import { dirname } from 'node:path';
import { normalizeSoulColor } from './soul-colors.mjs';

export function soulRows(deployment, catalog) {
  const agents = [];
  const root = deployment.root, context = dirname(root);
  const memberNames = new Map((deployment.workspaceStatus?.members || []).map((m) => [m.key, m.name]));
  const roster = new Map(deployment.souls.map((soul) => [soul.name, soul]));
  for (const soul of catalog || []) {
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
      // Its composed capabilities (souls-capabilities; null = it did not resolve), for Capabilities' "Used by".
      ...(Object.hasOwn(soul, "capabilities") ? { capabilities: soul.capabilities && soul.capabilities.map((c) => ({ ...c })) } : {}),
      // The kernel's soul key (`oats soul teams <key>`): the qualified name for a package soul, the bare name otherwise.
      ...(typeof soul.key === "string" ? { key: soul.key } : {}),
      // Feature instance-background (#1579): the soul runs its instances in the background unless a spawn says otherwise.
      ...(soul.background === true ? { background: true } : {}),
      ...(soul.kind === "package" ? { package: soul.package, version: soul.version, qualifiedName: soul.qualifiedName } : {}),
      origin: soul.origin || "", soulKind: soul.kind, repo: soul.repoKey || null, capability: null,
      soulSource: { repoKey: soul.repoKey ?? null, commit: soul.commit ?? null, path: soul.path ?? null },
      agentsRoot: root, workspace: context,
      repoName: memberNames.get(soul.repoKey) || (soul.kind === "external" ? "external" : soul.kind === "package" ? `package ${soul.package}` : soul.repoKey || ""),
    });
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}
