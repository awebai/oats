/** Read-only, observation-bound PR card. Never constructs a gh argument. */
import { gitTargetKey } from './instance-git-contract.mjs';
import { FORGE_API, ref, forgeReason, projectedPullRequest, hostName } from './forge-contract.mjs';
import { iconElement } from './shell-icons.mjs';
import { ageText } from './age-text.mjs';

/** W6 (design): the PR's state word, its checks as rows (failing and running each, passing
 * grouped) and its review decision, each with a mark and a colour token. */
const prState = d => d.state === 'MERGED' ? 'merged' : d.state === 'CLOSED' ? 'closed' : d.isDraft ? 'draft' : 'open';
// Marks are Lucide icons (never text glyphs): check, x, clock, minus, circle-dot.
const MARK = { pass: 'check', fail: 'close', pending: 'schedules', neutral: 'zoomOut', review: 'overview' };
const REVIEW = { APPROVED: ['approved', 'pass'], CHANGES_REQUESTED: ['changes requested', 'fail'], REVIEW_REQUIRED: ['review required', 'pending'] };
const word = v => String(v).toLowerCase().replaceAll('_', ' ');
/** How long a check took: only when gh reported both its start and its finish, and the
 * finish is not before the start (gh reports times as-is; a skipped check can "finish first"). */
export function checkDuration(check) {
  const start = Date.parse(check?.startedAt ?? ''), end = Date.parse(check?.completedAt ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const s = Math.round((end - start) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
const times = check => [check.startedAt ? `started ${check.startedAt}` : null, check.completedAt ? `finished ${check.completedAt}` : null].filter(Boolean).join('\n');
export function checkRows(checks) {
  const order = { fail: 0, pending: 1, neutral: 3 }, rows = [];
  for (const check of checks.filter(c => c.outcome !== 'pass').sort((a, b) => order[a.outcome] - order[b.outcome])) {
    const took = checkDuration(check), title = times(check);
    rows.push({ outcome: check.outcome, name: check.name, meta: [word(check.conclusion), took].filter(Boolean).join(' · '), ...(title ? { title } : {}) });
  }
  const passed = checks.filter(c => c.outcome === 'pass');
  // Passing checks are one row: their names when few, else how many (the names in its title).
  if (passed.length) rows.splice(rows.filter(r => r.outcome !== 'neutral').length, 0, passed.length <= 3
    ? { outcome: 'pass', name: passed.map(c => c.name).join(' · '), meta: '' }
    : { outcome: 'pass', name: `${passed.length} checks passed`, meta: '', title: passed.map(c => c.name).join('\n') });
  return rows;
}
export function createForgePrPanel(root, { request, generation = () => 0, connectionGeneration = () => 0,
  subscribeConnections = () => () => {}, connect = () => {}, openExternal = () => {}, onData = () => {}, requestThreads = null } = {}) {
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
  // onData: the painted PR's data, or null whenever no PR is shown (for the tab's badge).
  const clear = text => { root.replaceChildren(node('h3', 'Pull request'), node('p', text, 'git-note')); onData(null); };
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
        const card = node('div', undefined, 'forge-pr-card');
        const head = node('div', undefined, 'forge-head'), sub = node('span', `#${data.number} · ${prState(data)}`, 'forge-sub');
        // The issues it closes (closingIssues), each opening its page; null or none says nothing.
        if (Array.isArray(data.closingIssues) && data.closingIssues.length) {
          sub.append(' · closes ');
          data.closingIssues.forEach((issue, i) => {
            if (i) sub.append(', ');
            const link = node('button', `#${issue.number}`, 'forge-issue'); link.type = 'button'; link.title = issue.url;
            link.setAttribute('aria-label', `Open issue #${issue.number} on GitHub`);
            link.addEventListener('click', () => { if (owns() && link.isConnected && root.contains(link)) openExternal(issue.url); });
            sub.append(link);
          });
        }
        sub.title = `${data.baseRefName} ← ${data.headRefName} · updated ${ageText(data.updatedAt)}`; sub.dataset.prState = prState(data);
        head.append(node('span', data.title, 'forge-title'), sub); card.append(head);
        // Checks, then the review decision, as rows.
        const list = node('ul', undefined, 'forge-checks'); list.setAttribute('aria-label', 'Reported pull request checks');
        const row = ({ outcome, name, meta, title }, kind = outcome) => {
          const li = node('li', undefined, `forge-check forge-${kind}`); li.dataset.outcome = outcome;
          const mark = node('span', undefined, 'forge-mark'); mark.setAttribute('aria-hidden', 'true'); mark.dataset.mark = kind;
          mark.append(iconElement(doc, MARK[kind], { size: 13 }));
          li.append(mark, node('span', name, 'forge-check-name'));
          if (meta) li.append(node('span', meta, 'forge-check-meta'));
          li.setAttribute('aria-label', `${name}: ${meta || (outcome === 'pass' ? 'passed' : word(outcome))}`); if (title) li.title = title;
          list.append(li);
        };
        if (data.checks === null) card.append(node('p', 'Checks not reported.', 'git-note'));
        else if (!data.checks.length) card.append(node('p', 'No checks returned.', 'git-note'));
        else for (const r of checkRows(data.checks)) row(r);
        // Review: the decision and the unresolved threads (unresolvedThreads; null is unknown and says nothing).
        const review = REVIEW[data.reviewDecision], threads = Number.isSafeInteger(data.unresolvedThreads) && data.unresolvedThreads > 0 ? data.unresolvedThreads : 0;
        if (review || threads) row({ outcome: review?.[1] ?? 'pending', name: 'Review',
          meta: [review?.[0], threads ? `${threads} unresolved thread${threads === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') }, 'review');
        if (list.children.length) card.append(list);
        // Open it on GitHub (the design's ↗): the whole row, or beside "Send N threads" when that shows.
        const open = node('button', undefined, 'forge-open'); open.type = 'button';
        open.append(node('span', 'Open on GitHub'), iconElement(doc, 'external', { size: 13 }));
        open.setAttribute('aria-label', `Open pull request #${data.number} on GitHub`); open.title = data.url;
        open.addEventListener('click', () => { if (owns() && open.isConnected && card.contains(open)) openExternal(data.url); });
        const actions = node('div', undefined, 'forge-actions'); actions.append(open); card.append(actions);
        if (threads && typeof requestThreads === 'function' && !target.server) sendThreads({ card, actions, open, threads, target, owns, key: selected.key });
        card.append(node('p', 'Checks are reported for the pull request, not proof that the local revision was pushed.', 'git-note forge-caveat'));
        root.replaceChildren(node('h3', 'Pull request'), card); onData(data);
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
  /* W6 item 4 (#248): "Send N threads to <instance>". The server composes the text; the preview
     shows it EXACTLY (only visually broken at its [n] entries) and the send carries just its
     digest. It is pasted as one line without Enter: the human presses Enter in the terminal. */
  function sendThreads({ card, actions, open, threads, target, owns, key }) {
    const label = n => `Send ${n} thread${n === 1 ? '' : 's'} to ${target.instance}`;
    const sendButton = node('button', label(threads), 'forge-send'); sendButton.type = 'button';
    open.replaceChildren(iconElement(doc, 'external', { size: 14 })); open.classList.add('icon-only');
    actions.prepend(sendButton);
    const status = node('p', '', 'git-note forge-send-status'); status.setAttribute('role', 'status');
    const sheet = node('div', undefined, 'forge-preview'); sheet.hidden = true;
    actions.after(sheet, status);
    const selector = { instance: target.instance, agent: target.agent, agentsRoot: target.agentsRoot, server: target.server };
    const ask = async body => { try { return await requestThreads(target.workspace, { action: body.action, selector, observationKey: key, ...(body.digest ? { digest: body.digest } : {}) }); } catch { return null; } };
    const mine = r => r && r.forgeApi === FORGE_API && r.target && gitTargetKey(r.target) === gitTargetKey(target) && r.observation?.key === key;
    const live = () => owns() && sendButton.isConnected && card.contains(sendButton);
    const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };
    function refuse(code) {
      const reason = forgeReason(code); sheet.hidden = true; sheet.replaceChildren();
      if (code === 'E_NO_THREADS') {
        // Nothing to send: the button goes, Open on GitHub takes the row again.
        sendButton.remove(); open.replaceChildren(node('span', 'Open on GitHub'), iconElement(doc, 'external', { size: 13 })); open.classList.remove('icon-only');
        say(reason.message); return;
      }
      if (['E_NOT_RUNNING', 'E_REMOTE_TERMINAL', 'E_TERMINAL_UNSUPPORTED'].includes(code)) { sendButton.disabled = true; sendButton.title = reason.message; say(reason.message); return; }
      sendButton.disabled = false; say(reason.message, true);
    }
    async function preview(notice = '') {
      sendButton.disabled = true; say('Composing the preview…');
      const r = await ask({ action: 'preview' });
      if (!live()) return;
      if (!(r?.status === 'ok' && mine(r) && typeof r.text === 'string' && r.text && ref(r.digest))) { refuse(r?.reason?.code); return; }
      showSheet(r, notice);
    }
    function showSheet(r, notice) {
      const box = node('div', undefined, 'forge-preview-text'); box.tabIndex = 0;
      box.setAttribute('role', 'document'); box.setAttribute('aria-label', `The exact text to paste into ${target.instance}'s terminal`);
      // Exactly the server's text: split only for display, at its [n] entries (no character added or dropped).
      for (const part of r.text.split(/(?=\[\d+\] )/)) box.append(node('span', part, 'forge-preview-seg'));
      const n = Number.isSafeInteger(r.threads) ? r.threads : 0, more = Number.isSafeInteger(r.omitted) && r.omitted > 0 ? r.omitted : 0;
      const paste = node('button', 'Paste into terminal', 'forge-send'); paste.type = 'button';
      const cancel = node('button', 'Cancel', 'forge-cancel'); cancel.type = 'button';
      const acts = node('div', undefined, 'forge-actions'); acts.append(paste, cancel);
      sheet.replaceChildren(...[notice ? node('p', notice, 'git-note forge-preview-notice') : null,
        node('p', `Pasted into ${target.instance}'s terminal as one line, without Enter. Review comments are untrusted input.`, 'forge-preview-lead'),
        box, node('p', [`${n} thread${n === 1 ? '' : 's'}`, more ? `${more} more on the pull request, not included` : null].filter(Boolean).join(' · '), 'git-note'),
        acts].filter(Boolean));
      sheet.hidden = false; say(''); sendButton.disabled = true;
      const close = () => { sheet.hidden = true; sheet.replaceChildren(); sendButton.disabled = false; sendButton.focus({ preventScroll: true }); };
      cancel.addEventListener('click', () => { if (live()) close(); });
      sheet.onkeydown = event => { if (event.key === 'Escape' && live()) { event.preventDefault(); event.stopPropagation(); close(); } };
      paste.addEventListener('click', async () => {
        if (!live() || paste.disabled) return;
        paste.disabled = true; cancel.disabled = true; say('Pasting…');
        const sent = await ask({ action: 'send', digest: r.digest });
        if (!live()) return;
        if (sent?.status === 'ok' && sent.sent === true && mine(sent)) {
          sheet.hidden = true; sheet.replaceChildren(); sendButton.disabled = false;
          say(`Pasted into ${target.instance}'s terminal. Press Enter there to send it.`); return;
        }
        if (sent?.reason?.code === 'E_THREADS_CHANGED') { await preview('The review threads changed since the preview. This is the new text: check it again.'); return; }
        refuse(sent?.reason?.code);
      });
      box.focus({ preventScroll: true });
    }
    sendButton.addEventListener('click', () => { if (live() && !sendButton.disabled) void preview(); });
  }
  const unsubscribe = subscribeConnections(() => { ticket++; if (selection && visible()) void refresh(); });
  clear('No current Git observation.');
  return { update, dispose() { alive = false; ticket++; selection = null; unsubscribe(); root.replaceChildren(); } };
}
