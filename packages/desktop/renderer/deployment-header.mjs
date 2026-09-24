/** The workspace header: `oats workspace status --json` facts exactly as the
 * installed kernel reported them (workspace model v2). Pure DOM from a server
 * observation; no read, resolver, approval action or sync-row inference.
 * `approval` is the header's ID arrays; sync's detailed approvalNeeded[] rows
 * belong to the sync/approval surface, not here. */
export const deploymentHeaderCSS = `
.deployment-header { margin:0 0 18px; min-width:0; font-size:12px; line-height:1.5; }
.deployment-header[hidden], .deployment-header [hidden] { display:none; }
.deployment-header h2 { margin:0; font-size:14px; color:var(--fg); }
.deployment-header-key { margin:2px 0 0; color:var(--muted); font:11px/1.5 var(--mono,monospace); overflow-wrap:anywhere; }
.deployment-header-status { margin:8px 0 0; color:var(--muted); overflow-wrap:anywhere; }
.deployment-header-status.warn { color:var(--fg); }
.deployment-header h3 { color:var(--fg); }
.deployment-header h3 { margin:14px 0 6px; font-size:12.5px; }
.deployment-header ul { margin:0; padding:0; list-style:none; display:grid; gap:4px; }
.deployment-header li { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 8px; min-width:0; padding:6px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--fg); overflow-wrap:anywhere; }
.deployment-header li strong { font-size:12.5px; font-weight:650; color:var(--fg); }
.deployment-header li small { color:var(--muted); font:11px/1.5 var(--mono,monospace); }
.deployment-header-fact { padding:1px 5px; border-radius:4px; background:var(--surface-2); color:var(--muted); font-size:10.5px; line-height:14px; }
`;

const short = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 7) : value;
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && value ? value : null;

/** The message for a deployment that could not be observed. A missing
 * advertised feature is named; a kernel refusal keeps its code/message. */
export function deploymentUnavailableText(deployment) {
  if (!deployment || deployment.status === 'pending') return 'Reading the deployment through the installed OATS CLI…';
  if (deployment.status === 'observed') return '';
  const reason = deployment.reason || {};
  if (reason.feature) return `The installed OATS CLI does not advertise ${reason.feature}, which the Desktop needs to show this deployment. Update OATS and retry.`;
  const code = text(reason.code), message = text(reason.message);
  return code && message ? `${code}: ${message}` : message || 'The deployment could not be observed.';
}

/** Lines describing the lock/approval state, in the kernel's own terms. */
export function lockStateLines(status) {
  const lines = [];
  const approval = status?.approval || {};
  if (list(status?.unsynced).length) lines.push(`Declared but not locked (run oats sync): ${status.unsynced.join(', ')}`);
  if (list(status?.stale).length) lines.push(`Locked but no longer declared (run oats sync): ${status.stale.join(', ')}`);
  if (list(approval.needed).length) lines.push(`Approval needed: ${approval.needed.join(', ')}`);
  if (!lines.length && list(status?.packages).length) lines.push('Every locked package is approved.');
  return lines;
}

export function createDeploymentHeader(host) {
  const doc = host.ownerDocument;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined) el.textContent = value; if (cls) el.className = cls; return el; };
  host.className = 'deployment-header';
  host.setAttribute('aria-label', 'Workspace');
  let rendered = null, disposed = false;
  function fact(parent, value) { if (value) parent.append(node('span', value, 'deployment-header-fact')); }
  function update(deployment, { active = true } = {}) {
    if (disposed) return; // a disposed owner's late render is inert
    host.hidden = !active;
    const key = JSON.stringify(deployment ?? null);
    if (key === rendered) return; // identical polls never rebuild under focus/selection
    rendered = key; host.replaceChildren();
    if (deployment?.status !== 'observed') {
      host.append(node('h2', 'Workspace'), node('p', deploymentUnavailableText(deployment), 'deployment-header-status warn'));
      host.lastChild.setAttribute('role', 'status');
      return;
    }
    const status = deployment.workspaceStatus || {};
    const workspace = status.workspace || {};
    host.append(node('h2', text(workspace.name) || 'Workspace'));
    host.append(node('p', [workspace.key, short(workspace.commit)].filter(text).join(' @ '), 'deployment-header-key'));
    const reach = deployment.reachable;
    if (reach && reach.reachable === false) {
      host.append(node('p', `Workspace unreachable — module drift is not current. ${[reach.code, reach.message].filter(text).join(': ')}`, 'deployment-header-status warn'));
    }
    const withheld = list(deployment.withheld);
    if (withheld.length) host.append(node('p', `${withheld.length} instance ${withheld.length === 1 ? 'row was' : 'rows were'} withheld: the kernel reported a home outside the soul's instances directory or a duplicate home (${withheld.map(w => w.instance).join(', ')}).`, 'deployment-header-status warn'));
    for (const line of lockStateLines(status)) host.append(node('p', line, 'deployment-header-status'));
    for (const problem of list(status.problems)) host.append(node('p', [problem.code, problem.message].filter(text).join(': '), 'deployment-header-status warn'));
    host.append(node('h3', `Members (${list(status.members).length})`));
    const members = node('ul');
    for (const member of list(status.members)) {
      const row = node('li');
      row.append(node('strong', text(member.name) || text(member.key) || 'member'), node('small', [member.key, short(member.commit)].filter(text).join(' @ ')));
      fact(row, member.status === 'confirmed' ? 'Confirmed' : text(member.status) ? `Unconfirmed: ${member.status}` : null);
      fact(row, text(member.team) ? `Team: ${member.team}` : null);
      if (member.publishes?.package) fact(row, `Publishes ${member.publishes.package}${member.publishes.version ? ` v${member.publishes.version}` : ''}`);
      if (text(member.detail)) row.append(node('small', member.detail));
      members.append(row);
    }
    host.append(members);
    host.append(node('h3', `Packages (${list(status.packages).length})`));
    const packages = node('ul');
    for (const pkg of list(status.packages)) {
      const row = node('li');
      row.append(node('strong', text(pkg.id) || 'package'), node('small', [pkg.version && `v${pkg.version}`, short(pkg.commit)].filter(text).join(' @ ')));
      fact(row, pkg.approved ? 'Approved' : 'Approval needed');
      if (list(pkg.capabilities).length) fact(row, `Modules: ${pkg.capabilities.join(', ')}`);
      packages.append(row);
    }
    if (!list(status.packages).length) packages.append(node('li', list(status.unsynced).length ? 'No package is locked yet.' : 'No packages declared.'));
    host.append(packages);
  }
  return { update, dispose() { disposed = true; host.replaceChildren(); rendered = null; } };
}
