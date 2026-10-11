/** Who is in each team, wherever it runs: a projection of the held observations of ONE workspace
 * view's deployments (#482): its local deployments' rosters and its remote groups' panels, never
 * another workspace's. It runs no command and adds no ssh: the remote roster loop's `server roster`
 * read is the only source for other machines. A member is a row whose identity.team is a non-empty
 * string; the renderer groups them by team, and by deployment within a team (`deployment`, labelled
 * by machine). `workspace` is the member's DEPLOYMENT id: every action on a member is addressed to it. */
import { canAddressRemote, rowReason } from '../../client/remote-address.mjs';

const text = v => typeof v === 'string' && v ? v : null;
const team = row => text(row?.identity?.team);

function member(row, { deployment, server = null, serverLabel = null }) {
  return {
    workspace: deployment.id, deployment: { ...deployment }, server, serverLabel,
    instance: row.instance, agent: row.agent, agentsRoot: row.agentsRoot, home: row.home, team: team(row),
    running: row.running === true ? true : row.running === false ? false : null,
    // The roster's own rule (a saved route decides when this computer's OATS reports no fact).
    addressable: canAddressRemote(row), missingRemotely: row.missingRemotely === true,
    // The roster's own reason for a row that can't be opened (spec 01), once, here: the sentence and its short label.
    reason: rowReason(row)?.sentence ?? null, reasonLabel: rowReason(row)?.label ?? null,
    createdAt: text(row.createdAt),
  };
}

/** `deployments`: [{deployment, instances}], the view's local deployments and their rows;
 * `groups`: [{group, deployment, panel}], the view's remote groups and their projected panels (remotePanel).
 * `deployment` is `{id, machine, path}`. */
export function teamMembers({ deployments = [], groups = [] }) {
  const members = deployments.flatMap(({ deployment, instances = [] }) => instances.filter(row => team(row)).map(row => member(row, { deployment })));
  const servers = [], notReached = [];
  for (const { group, deployment, panel } of groups) {
    const label = group.label || group.server, rows = panel.instances || [];
    for (const row of rows.filter(r => team(r))) members.push(member(row, { deployment, server: group.server, serverLabel: label }));
    servers.push({ server: group.server, label, group: group.id, deployment: deployment.id, reached: group.probe?.ok === true,
      error: group.probe?.ok === true ? null : text(group.probe?.error?.message) ?? 'Server is unreachable',
      registered: group.registrationPresent === true });
    // A failed group holding no rows (last-known or current) is a server we have nothing to show for.
    if (group.probe?.ok !== true && !rows.length) notReached.push({ server: group.server, label, deployment: deployment.id });
  }
  return { members, servers, notReached };
}
