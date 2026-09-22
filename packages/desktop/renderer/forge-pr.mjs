/** Read-only, observation-bound PR card. Never constructs a gh argument. */
import { gitTargetKey } from './instance-git-contract.mjs';
import { FORGE_API, ref, forgeReason, projectedPullRequest, hostName } from './forge-contract.mjs';
export function createForgePrPanel(root, { request, generation = () => 0, connectionGeneration = () => 0,
  subscribeConnections = () => () => {}, connect = () => {}, openExternal = () => {} } = {}) {
  const doc = root.ownerDocument;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  let alive = true, selection = null, ticket = 0;
  const visible = () => {
    if (!root.isConnected) return false;
    for (let n = root; n; n = n.parentElement) {
      if (n.hidden || n.inert) return false;
      const style = doc.defaultView?.getComputedStyle(n);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  };
  const clear = text => { root.replaceChildren(node('h3', 'GitHub / pull request'), node('p', text, 'git-note')); };
  function update(value = null) { selection = value; ticket++; clear(value ? 'Reading pull request…' : 'No current Git observation.'); if (value) return refresh(); }
  async function refresh() {
    const selected = selection, mine = ++ticket, ws = generation(), account = connectionGeneration();
    const owns = () => alive && selected === selection && mine === ticket && ws === generation() && account === connectionGeneration() && visible();
    if (!selected || !visible()) return;
    if (!ref(selected.key) || typeof request !== 'function') { clear(forgeReason('E_REMOTE_NOT_REPORTED').message); return; }
    clear('Reading pull request…');
    try {
      const target = selected.target;
      const result = await request(target.workspace, { selector: { instance: target.instance, agent: target.agent,
        agentsRoot: target.agentsRoot, server: target.server }, observationKey: selected.key });
      if (!owns()) return;
      if (result?.forgeApi !== FORGE_API || !result.target || gitTargetKey(result.target) !== gitTargetKey(target)
        || result.observation?.key !== selected.key || result.observation.revision !== selected.revision || result.observation.branch !== selected.branch) {
        clear('Pull request unavailable: the observation changed or the response was invalid. Refresh Git.'); return;
      }
      if (result.status === 'available') {
        const data = projectedPullRequest(result.data, { host: result.host, path: result.repository, branch: selected.branch });
        if (!data) throw new Error('Invalid PR projection');
        const card = node('div', undefined, 'git-card');
        card.append(node('strong', `#${data.number} · ${data.title}`), node('p', `${data.state}${data.isDraft ? ' · Draft' : ''}`, 'git-note'),
          node('p', `${data.baseRefName} → ${data.headRefName}`, 'git-branch'), node('p', `Review: ${data.reviewDecision || 'Not reported'}`, 'git-note'),
          node('h3', 'Reported PR checks'));
        if (data.checks === null) card.append(node('p', 'Checks not reported.', 'git-note'));
        else if (!data.checks.length) card.append(node('p', 'No checks returned.', 'git-note'));
        else {
          const list = node('ul');
          for (const check of data.checks) list.append(node('li', `${check.name} · ${check.conclusion}`, `forge-check forge-${check.outcome}`));
          card.append(list);
        }
        card.append(node('p', 'Reported for the pull request, not proof that the local revision was pushed.', 'git-note'));
        const link = node('a', data.url); link.href = data.url; link.rel = 'noopener noreferrer';
        link.addEventListener('click', event => { event.preventDefault(); if (owns() && link.isConnected && card.contains(link)) openExternal(data.url); });
        card.append(link, node('p', `PR updated: ${data.updatedAt}`, 'git-note'));
        root.replaceChildren(node('h3', 'GitHub / pull request'), card);
      } else if (result.status === 'no-pull-request' && result.data === null) clear('No pull request found for this branch.');
      else {
        const reason = forgeReason(result.reason?.code);
        clear(result.status === 'not-connected' ? 'Not connected to GitHub.' : reason.message);
        if (result.status === 'unsupported-forge' && hostName(result.host)) root.append(node('p',
          `configure it in GitHub CLI first (\`gh auth login --hostname ${result.host}\` from a terminal)`, 'git-note'));
        if (result.status === 'not-connected' && ref(result.connectionRef) && ref(result.hostRef)) {
          const button = node('button', 'Connect GitHub'); button.type = 'button';
          button.addEventListener('click', () => { if (owns() && button.isConnected && root.contains(button)) connect({ connectionRef: result.connectionRef, hostRef: result.hostRef }); });
          root.append(button);
        }
      }
    } catch { if (owns()) clear('Pull request unavailable. Refresh Git to retry.'); }
  }
  const unsubscribe = subscribeConnections(() => { ticket++; if (selection && visible()) void refresh(); });
  clear('No current Git observation.');
  return { update, dispose() { alive = false; ticket++; selection = null; unsubscribe(); root.replaceChildren(); } };
}
