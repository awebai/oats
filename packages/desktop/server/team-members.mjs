/** Who is in each team, wherever it runs: a projection of the held observations (this workspace's
 * roster and every remote group's panel). It runs no command and adds no ssh: the remote roster
 * loop's `server roster` read is the only source for other machines. A member is a row whose
 * identity.team is a non-empty string; the renderer groups them by team. */
import { canAddressRemote, rowReason } from '../renderer/remote-address.mjs';

const text = v => typeof v === 'string' && v ? v : null;
const team = row => text(row?.identity?.team);

function member(row, { workspace, server = null, serverLabel = null }) {
  return {
    workspace, server, serverLabel,
    instance: row.instance, agent: row.agent, agentsRoot: row.agentsRoot, home: row.home, team: team(row),
    running: row.running === true ? true : row.running === false ? false : null,
    // The roster's own rule (a saved route decides when this computer's OATS reports no fact).
    addressable: canAddressRemote(row), missingRemotely: row.missingRemotely === true,
    // The roster's own reason for a row that can't be opened (spec 01), once, here: the sentence and its short label.
    reason: rowReason(row)?.sentence ?? null, reasonLabel: rowReason(row)?.label ?? null,
    createdAt: text(row.createdAt),
  };
}

/** `groups`: [{group, panel}], the kernel's remote groups and their projected panels (remotePanel). */
export function teamMembers({ workspace, instances = [], groups = [] }) {
  if (workspace?.remote || workspace?.server) return { error: 'unsupported-remote-operation' };
  const members = instances.filter(row => team(row)).map(row => member(row, { workspace: workspace.id }));
  const servers = [], notReached = [];
  for (const { group, panel } of groups) {
    const label = group.label || group.server, rows = panel.instances || [];
    for (const row of rows.filter(r => team(r))) members.push(member(row, { workspace: panel.workspace.id, server: group.server, serverLabel: label }));
    servers.push({ server: group.server, label, group: group.id, reached: group.probe?.ok === true,
      error: group.probe?.ok === true ? null : text(group.probe?.error?.message) ?? 'Server is unreachable',
      registered: group.registrationPresent === true, souls: (group.souls || []).map(s => s?.name).filter(text) });
    // A failed group holding no rows (last-known or current) is a server we have nothing to show for.
    if (group.probe?.ok !== true && !rows.length) notReached.push({ server: group.server, label });
  }
  return { members, servers, notReached };
}
