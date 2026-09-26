/** On-demand K1 projection. IO is injected; never reads Git, files or a roster.
 * The context-panel host owns visibility/selection, this controller owns reads. */
import { gitTarget, gitTargetKey, gitState, gitDiff, gitObservation, gitKinds, INSTANCE_GIT_MINIMUM_VERSION } from './instance-git-contract.mjs';
import { createForgePrPanel } from './forge-pr.mjs';
import { ageText } from './age-text.mjs';
import { iconElement } from './shell-icons.mjs';

export const instanceGitCSS = `
/* W6 Git & GitHub (design): Branch, Changes, then the pull request, each under a small caps label. */
.instance-git { display:flex; flex-direction:column; gap:18px; min-width:0; color:var(--fg); font-size:12px; }
.instance-git .git-section { display:flex; flex-direction:column; gap:8px; min-width:0; }
.instance-git .git-changes-section { gap:2px; }
.instance-git .git-head { display:flex; align-items:center; gap:10px; min-width:0; color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.instance-git .git-changes-section .git-head { margin-bottom:4px; }
.instance-git .git-head h3 { margin:0; font:inherit; color:inherit; }
.instance-git .git-head-aside { margin-left:auto; text-transform:none; letter-spacing:0; font-weight:500; }
.instance-git .git-head-aside:empty { display:none; }
.instance-git .git-head-aside:empty + .git-link, .instance-git .git-changes-section .git-link { margin-left:auto; }
.instance-git button { font:inherit; color:var(--fg); cursor:pointer; }
.instance-git button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:3px; }
.instance-git button.git-link { height:auto; min-height:0; padding:0; border:0; background:transparent; color:var(--accent); font-size:11px; font-weight:600; letter-spacing:0; text-transform:none; }
.instance-git button.git-link:hover:not(:disabled) { text-decoration:underline; }
.instance-git button.git-link:disabled { color:var(--muted); cursor:default; text-decoration:none; }
.instance-git .git-status, .instance-git .git-note { margin:0; color:var(--muted); line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
.instance-git .git-status:empty { display:none; }
.instance-git .git-status.error { color:var(--danger); }
.instance-git details > summary { cursor:pointer; color:var(--muted); font-size:11.5px; }
.instance-git .git-facts { display:flex; flex-direction:column; gap:3px; min-width:0; }
.instance-git .git-facts:empty { display:none; }
.instance-git .git-branch-line { display:flex; align-items:center; gap:8px; min-width:0; font:650 12.5px var(--mono,monospace); }
.instance-git .git-branch-line .shell-icon { flex:none; color:var(--muted); }
.instance-git .git-branch { min-width:0; }
.instance-git .git-ahead { flex:none; margin-left:auto; color:var(--muted); font-weight:500; white-space:nowrap; }
.instance-git .git-branch-sub { color:var(--muted); font:11px/1.5 var(--mono,monospace); overflow-wrap:anywhere; }
.instance-git .git-more { margin-top:6px; }
.instance-git .git-more h4 { margin:10px 0 4px; color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.instance-git dl { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.6fr); gap:4px 10px; margin:0; }
.instance-git dt { color:var(--muted); }
.instance-git dd { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font-family:var(--mono,monospace); font-size:11px; }
.instance-git .git-files { display:flex; flex-direction:column; min-width:0; }
.instance-git button.git-file { display:flex; align-items:baseline; gap:8px; width:100%; min-height:28px; margin:0; padding:6px 2px; box-sizing:border-box; border:0; border-bottom:1px solid var(--tag-bg); border-radius:0; background:transparent; text-align:left; font:11.5px/1.35 var(--mono,monospace); }
.instance-git button.git-file:hover:not(:disabled):not([aria-pressed=true]) { background:var(--surface-2); }
.instance-git button.git-file[aria-pressed=true] { background:var(--sel); color:var(--fg); }
.instance-git button.git-file:disabled { color:var(--muted); cursor:default; }
.instance-git .git-letter { flex:none; width:12px; font-weight:700; color:var(--muted); }
.instance-git .git-file-path { flex:1; min-width:0; }
/* A path or branch breaks after its slashes; a segment breaks inside only when longer than the line. */
.instance-git .git-seg { display:inline-block; max-width:100%; overflow-wrap:anywhere; }
.instance-git .git-diff:empty { display:none; }
.instance-git .git-diff { display:flex; flex-direction:column; gap:6px; margin-top:10px; }
.instance-git .git-diff h4 { margin:0; font:600 11.5px var(--mono,monospace); overflow-wrap:anywhere; }
.instance-git .git-patch { margin:0; max-height:420px; overflow:auto; white-space:pre; padding:10px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); color:var(--fg); font:11.5px/1.5 var(--mono,monospace); }
.instance-git .git-add { color:var(--ok); }
.instance-git .git-remove { color:var(--danger); }
.instance-git .git-hunk { color:var(--accent); }
.instance-git .git-github { display:flex; flex-direction:column; gap:10px; min-width:0; }
.instance-git .git-github h3 { margin:0; color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.instance-git .git-github button { background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:5px 8px; }
/* W6 Pull request (design): title and #/state, the checks and review as rows, then Open on GitHub. */
.instance-git .forge-pr-card { display:flex; flex-direction:column; gap:10px; min-width:0; }
.instance-git .forge-head { display:flex; flex-direction:column; gap:2px; min-width:0; }
.instance-git .forge-title { font-size:13px; font-weight:650; line-height:1.35; overflow-wrap:anywhere; }
.instance-git .forge-sub { color:var(--muted); font-size:11.5px; }
.instance-git .forge-checks { display:flex; flex-direction:column; margin:0; padding:0; list-style:none; }
.instance-git .forge-check { display:flex; align-items:baseline; gap:8px; min-height:28px; padding:6px 0; box-sizing:border-box; border-bottom:1px solid var(--tag-bg); color:var(--fg); font-size:12px; line-height:1.35; }
.instance-git .forge-mark { flex:none; width:14px; text-align:center; }
.instance-git .forge-check-name { flex:1; min-width:0; overflow-wrap:anywhere; }
.instance-git .forge-check-meta { flex:none; margin-left:auto; color:var(--muted); font-size:11.5px; }
.instance-git .forge-pass .forge-mark { color:var(--ok); }
.instance-git .forge-fail .forge-mark, .instance-git .forge-review[data-outcome=fail] .forge-mark { color:var(--danger); }
.instance-git .forge-pending .forge-mark, .instance-git .forge-review[data-outcome=pending] .forge-mark { color:var(--warn); }
.instance-git .forge-neutral .forge-mark { color:var(--muted); }
.instance-git .forge-review[data-outcome=pass] .forge-mark { color:var(--ok); }
.instance-git .git-github button.forge-open { display:inline-flex; align-items:center; justify-content:center; gap:6px; width:100%; height:32px; padding:0 12px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); font-size:12.5px; font-weight:600; }
.instance-git .git-github button.forge-open:hover { background:var(--surface-2); }
.instance-git .forge-caveat { font-size:11px; }
`;
const report = v => v === null || v === undefined ? 'Not reported' : String(v);
const tail = v => String(v || '').split('/').filter(Boolean).pop() || '';
/** Text that breaks after its slashes: one inline-block per segment, a <wbr> after each slash. */
function slashed(doc, el, value) {
  el.replaceChildren();
  value.split('/').forEach((part, i, all) => {
    const seg = doc.createElement('span'); seg.className = 'git-seg'; seg.textContent = i < all.length - 1 ? `${part}/` : part;
    el.append(seg); if (i < all.length - 1) el.append(doc.createElement('wbr'));
  });
  return el;
}
/** A change's one status letter (git status --short): the index side, else the worktree side. */
export function changeLetter(file) {
  if (file.kind === 'untracked') return '?';
  if (file.kind === 'unmerged') return 'U';
  const [x, y] = file.xy; return x !== '.' ? x : y;
}
const LETTER_WORD = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed', U: 'unmerged', '?': 'untracked' };
export function createInstanceGitPanel(parent, { request, generation = () => 0, applyFocus = fn => fn(),
  requestForge, connectionGeneration = () => 0, subscribeConnections = () => () => {}, connect, openExternal, onObservation = () => {} } = {}) {
  const doc = parent.ownerDocument;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const root = node('div', undefined, 'instance-git'); parent.append(root);
  // Branch: its label, the work mode and Refresh; then the branch facts.
  const branchSection = node('section', undefined, 'git-section git-branch-section');
  const toolbar = node('div', undefined, 'git-toolbar git-head'), workMode = node('span', '', 'git-head-aside');
  const refreshButton = node('button', 'Refresh', 'git-link'); refreshButton.type = 'button';
  toolbar.append(node('h3', 'Branch'), workMode, refreshButton);
  const status = node('p', '', 'git-status'); status.setAttribute('role', 'status');
  // A read's code sits behind Details under its plain sentence (never inline).
  const statusDetails = node('details', undefined, 'git-status-details'); statusDetails.hidden = true;
  const statusCode = node('pre', '', 'git-note'); statusDetails.append(node('summary', 'Details'), statusCode);
  const facts = node('div', undefined, 'git-facts');
  // Changes: one row per file (its status letter and path); a row reads its diff below the list.
  const changesSection = node('section', undefined, 'git-section git-changes-section');
  const changesHead = node('div', undefined, 'git-head'), changesHeading = node('h3', 'Changes');
  const openDiff = node('button', 'Open diff', 'git-link'); openDiff.type = 'button'; openDiff.hidden = true;
  changesHead.append(changesHeading, openDiff);
  const files = node('div', undefined, 'git-files'); files.setAttribute('aria-label', 'Observed worktree changes');
  const diffStatus = node('p', '', 'git-status'); diffStatus.setAttribute('role', 'status');
  const diffBody = node('section', undefined, 'git-diff'); diffBody.setAttribute('aria-label', 'Read-only unified diff');
  const github = node('section', undefined, 'git-github');
  branchSection.append(toolbar, status, statusDetails, facts);
  changesSection.append(changesHead, files, diffStatus, diffBody);
  root.append(branchSection, changesSection, github);
  // Sections with nothing observed are not shown.
  changesSection.hidden = true; github.hidden = true;
  const pullRequest = createForgePrPanel(github, { request: requestForge, generation, connectionGeneration, subscribeConnections, connect, openExternal });
  let alive = true, active = false, epoch = 0, observationTicket = 0, fileTicket = 0;
  let target = null, identity = '', summaryIdentity = '', attempted = false, observation = null, selected = null, busy = false, remote = false;
  const controls = new Map();
  function visible() {
    if (!root.isConnected) return false;
    for (let el = root; el; el = el.parentElement) {
      if (el.hidden || el.inert) return false;
      const css = doc.defaultView?.getComputedStyle(el);
      if (css?.display === 'none' || css?.visibility === 'hidden') return false;
    }
    return true;
  }
  const capture = () => ({ epoch, generation: generation(), connection: connectionGeneration(), identity, target, summaryIdentity });
  const owns = ref => alive && active && ref.epoch === epoch && ref.identity === identity && ref.generation === generation() && ref.connection === connectionGeneration();
  const canPaint = ref => owns(ref) && visible();
  const message = (el, text = '', error = false) => { el.textContent = text; el.classList.toggle('error', error); if (el === status) { statusDetails.hidden = true; statusCode.textContent = ''; } };
  const unavailable = (text, code = '') => {
    message(status, `${text}${facts.childElementCount ? ' Previous observation is stale; file actions are disabled.' : ''}`, true);
    statusCode.textContent = code; statusDetails.hidden = !code;
  };
  const clearDiff = () => { selected = null; fileTicket++; diffBody.replaceChildren(); message(diffStatus); for (const b of controls.values()) b.setAttribute('aria-pressed', 'false'); };
  const clear = (summary = true) => { if (summary) onObservation(null); observation = null; pullRequest.update(); clearDiff(); controls.clear(); facts.replaceChildren(); files.replaceChildren(); workMode.textContent = ''; message(status); changesSection.hidden = true; openDiff.hidden = true; github.hidden = true; };
  const locks = () => { refreshButton.disabled = !alive || !active || !target || remote || busy; for (const b of [...controls.values(), openDiff]) b.disabled = !active || busy || !observation; };
  function send(ref, action, extra = {}) {
    const t = ref.target;
    // home is used only for validating the returned target, NEVER sent as authority.
    return request(t.workspace, { action, selector: { instance: t.instance, agent: t.agent, agentsRoot: t.agentsRoot, server: t.server }, ...extra });
  }
  function reply(raw, ref) {
    const echoed = gitTarget(raw?.target);
    if (raw?.instanceGitApi !== 1 || raw.minimumVersion !== INSTANCE_GIT_MINIMUM_VERSION
      || (echoed ? gitTargetKey(echoed) !== gitTargetKey(ref.target) : raw.target !== null || raw.status !== 'unavailable')) throw new Error('Invalid target response');
    if (raw.status === 'available' && raw.reason === null) return raw;
    if (!['unavailable', 'stale'].includes(raw.status) || raw.data !== null || typeof raw.reason?.code !== 'string'
      || typeof raw.reason.message !== 'string' || (raw.status === 'stale' && raw.reason.code !== 'E_STALE_OBSERVATION')) throw new Error('Invalid read response');
    return raw;
  }
  function rows(parent, pairs) {
    const dl = node('dl'); for (const [key, value] of pairs) dl.append(node('dt', key), node('dd', report(value))); parent.append(dl);
  }
  function renderObservation(ref, observationKey) {
    facts.replaceChildren(); controls.clear(); files.replaceChildren();
    const data = observation, o = data.observation;
    workMode.textContent = data.workMode || '';
    // The branch, and how far it is ahead of (or behind) the default branch.
    const line = node('div', undefined, 'git-branch-line');
    line.append(iconElement(doc, 'branch', { size: 13 }), slashed(doc, node('span', undefined, 'git-branch'), o.unborn ? `${report(o.branch)} · unborn` : o.detached ? 'Detached HEAD' : report(o.branch)));
    if (data.base.ref && data.base.ahead !== null) {
      const ahead = node('span', `↑${data.base.ahead}${data.base.behind ? ` ↓${data.base.behind}` : ''} from ${data.base.ref.replace(/^origin\//, '')}`, 'git-ahead');
      ahead.title = `${data.base.ahead} ahead of, ${report(data.base.behind)} behind ${data.base.ref}`; line.append(ahead);
    }
    // The repository, and whether the worktree is clean.
    const n = data.files.length, repo = tail(data.recorded.repo) || tail(o.worktree);
    const sub = node('div', [repo, n ? `clean except ${n} file${n === 1 ? '' : 's'}` : 'clean'].filter(Boolean).join(' · '), 'git-branch-sub'); sub.title = o.worktree;
    facts.append(line, sub);
    if (data.recorded.drift) facts.append(node('p', `Branch differs from recorded branch: ${report(data.recorded.branch)}`, 'git-note'));
    // Everything else the read reports, behind Details.
    const more = node('details', undefined, 'git-more'); more.append(node('summary', 'Details'));
    const seen = node('p', `Observed ${ageText(o.at)}`, 'git-note'); seen.title = o.at; more.append(seen);
    more.append(node('h4', 'Observation'));
    rows(more, [['Worktree', o.worktree], ['Observed revision', o.revision], ['Index fingerprint', o.indexRevision], ['Work mode', data.workMode],
      ['Recorded branch', data.recorded.branch], ['Branch drift', data.recorded.drift ? 'Changed from recorded branch' : 'No reported drift']]);
    // A comparison shows only what was reported; nothing reported is one plain line.
    const comparison = (title, pairs, none) => {
      more.append(node('h4', title));
      const known = pairs.filter(([, value]) => value !== null && value !== undefined && value !== '');
      if (known.length) rows(more, known); else more.append(node('p', none, 'git-note'));
    };
    comparison('Upstream comparison', [['Upstream ref', data.upstream.ref], ['Ahead', data.upstream.ahead], ['Behind', data.upstream.behind]], 'No upstream branch is reported.');
    comparison('Default-branch comparison', [['Base ref', data.base.ref], ['Base source', data.base.source], ['Merge base', data.base.mergeBase], ['Ahead', data.base.ahead], ['Behind', data.base.behind]], 'No default-branch comparison is reported.');
    for (const note of data.notes) more.append(node('p', note, 'git-note'));
    facts.append(more);
    changesSection.hidden = false; github.hidden = false; openDiff.hidden = !data.files.length;
    if (!data.files.length) files.append(node('p', 'No changes reported in this observation.', 'git-note'));
    const snapshot = data;
    for (const file of data.files) {
      const letter = changeLetter(file), shown = `${file.origPath ? `${file.origPath} → ` : ''}${file.path}${file.submodule ? ' · submodule' : ''}`;
      const b = node('button', undefined, 'git-file'); b.append(node('span', letter, 'git-letter'), slashed(doc, node('span', undefined, 'git-file-path'), shown));
      b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.dataset.fileId = file.id;
      b.title = `${LETTER_WORD[letter] || file.kind} · read diff: ${shown}`;
      b.addEventListener('click', () => {
        if (canPaint(ref) && observation === snapshot && !busy && b.isConnected && files.contains(b)) void selectFile(file, ref, snapshot);
      });
      controls.set(file.id, b); files.append(b);
    }
    locks();
    void pullRequest.update({ target: ref.target, key: observationKey, revision: o.revision, branch: o.branch });
  }
  async function refresh({ notice = '' } = {}) {
    if (!alive || !active || !target || remote || !visible()) return;
    const ref = capture(), ticket = ++observationTicket;
    attempted = true; busy = true;
    // When an expired file triggers re-observation, keep keyboard focus in the
    // same owned panel rather than dropping it onto the terminal/body.
    if (files.contains(doc.activeElement)) applyFocus(() => refreshButton.focus({ preventScroll: true }));
    observation = null; onObservation(null); pullRequest.update(); clearDiff(); message(diffStatus, notice); locks();
    message(status, facts.childElementCount ? 'Refreshing — previous observation is stale; file actions are disabled.' : 'Reading worktree…');
    try {
      const raw = await send(ref, 'git');
      if (!canPaint(ref) || ticket !== observationTicket) return;
      const result = reply(raw, ref);
      if (result.status !== 'available') { unavailable(result.reason.message, result.reason.code); return; }
      const data = gitState(result.data, ref.target);
      if (!data) throw new Error('Invalid Git observation');
      observation = data; clearDiff(); renderObservation(ref, result.observationKey); message(status); message(diffStatus, notice);
      onObservation({ identity: ref.summaryIdentity, connection: ref.connection, changed: Object.values(data.summary).some(n => n > 0), at: data.observation.at });
    } catch {
      if (canPaint(ref) && ticket === observationTicket) unavailable('Git inspection unavailable or invalid. Refresh to retry; no current changes are established.');
    } finally {
      if (owns(ref) && ticket === observationTicket) { busy = false; if (visible()) locks(); }
    }
  }
  async function selectFile(file, ref, snapshot) {
    const ticket = ++fileTicket; selected = file;
    diffBody.replaceChildren(); message(diffStatus, 'Reading diff…');
    for (const [id, b] of controls) b.setAttribute('aria-pressed', String(id === file.id));
    const current = () => canPaint(ref) && ticket === fileTicket && observation === snapshot && selected === file;
    try {
      const raw = await send(ref, 'diff', { fileId: file.id, revision: snapshot.observation.revision, indexRevision: snapshot.observation.indexRevision });
      if (!current()) return;
      const result = reply(raw, ref);
      if (result.status === 'stale') {
        // Details are diagnostic only; never turn them into a replacement diff.
        const fresh = gitObservation(result.reason.observation);
        await refresh({ notice: `The file observation changed${fresh ? ` (current revision ${fresh.revision})` : ''}. Select a file from the refreshed observation.` });
        return;
      }
      if (result.status !== 'available') { message(diffStatus, `${result.reason.message} (${result.reason.code})`, true); return; }
      const data = gitDiff(result.data, { fileId: file.id, revision: snapshot.observation.revision, indexRevision: snapshot.observation.indexRevision, observation: snapshot.observation, file });
      if (!data) throw new Error('Invalid diff');
      const against = node('p', `Against: ${/^[0-9a-f]{40,64}$/.test(data.against) ? data.against.slice(0, 7) : data.against} · ${data.bytes} patch bytes${data.truncated ? ` · truncated at ${data.limit} bytes` : ''}`, 'git-note'); against.title = data.against;
      diffBody.append(slashed(doc, node('h4'), file.path), against);
      if (data.binary) diffBody.append(node('p', 'Binary file — no text patch returned.', 'git-note'));
      else if (!data.patch) diffBody.append(node('p', 'No text patch returned for this file.', 'git-note'));
      else {
        const pre = node('pre', undefined, 'git-patch'); pre.tabIndex = 0; pre.setAttribute('aria-label', `Read-only diff for ${file.path}`);
        const lines = data.patch.split('\n'), shown = lines.slice(0, 4000);
        for (const [index, line] of shown.entries()) pre.append(node('span', line + (index < lines.length - 1 ? '\n' : ''), line.startsWith('@@') ? 'git-hunk'
          : line.startsWith('+') && !line.startsWith('+++') ? 'git-add' : line.startsWith('-') && !line.startsWith('---') ? 'git-remove' : undefined));
        diffBody.append(pre);
        if (lines.length > shown.length) diffBody.append(node('p', `Display limited to ${shown.length} of ${lines.length} returned lines.`, 'git-note'));
      }
      message(diffStatus);
    } catch {
      if (current()) message(diffStatus, 'Diff unavailable or invalid. Re-observe the worktree before retrying.', true);
    }
  }
  refreshButton.addEventListener('click', () => { if (!refreshButton.disabled && refreshButton.isConnected && visible()) void refresh(); });
  // Open diff: the selected file's diff, else the first file's.
  openDiff.addEventListener('click', () => { if (!openDiff.disabled) ((selected && controls.get(selected.id)) || controls.values().next().value)?.click(); });
  function update({ active: nextActive = false, workspace, instance, key } = {}) {
    if (!alive) return;
    const next = gitTarget({ workspace, instance: instance?.instance, agent: instance?.agent, agentsRoot: instance?.agentsRoot, home: instance?.home, server: instance?.server || null });
    const nextIdentity = JSON.stringify([generation(), connectionGeneration(), key, next && gitTargetKey(next), instance?.createdAt ?? null, !!instance?.remote]);
    summaryIdentity = JSON.stringify([workspace, key, instance?.home, instance?.agent, instance?.agentsRoot, instance?.server || null, instance?.createdAt ?? null]);
    remote = !!(next?.server || instance?.remote);
    if (nextIdentity !== identity || active !== !!nextActive) {
      epoch++; observationTicket++; fileTicket++; busy = false; attempted = false;
      const changed = identity !== nextIdentity;
      identity = nextIdentity; target = next; active = !!nextActive; clear(changed);
    }
    if (!active) { locks(); return; }
    if (!target) { message(status, 'Select a current, fully qualified instance to inspect its worktree.'); locks(); return; }
    if (remote) {
      attempted = true; message(status, 'Remote Git inspection is unavailable: K1 has no negotiated remote dispatch. No local fallback was used.');
      refreshButton.disabled = true; return;
    }
    locks();
    if (!attempted && visible()) return refresh();
  }
  const offConnection = subscribeConnections(() => {
    if (!alive) return;
    epoch++; observationTicket++; fileTicket++; busy = false; attempted = true; clear();
    message(status, 'Connection changed. Refresh Git for a current observation.'); locks();
  });
  locks();
  return { update, refresh, dispose() {
    if (!alive) return; alive = false; active = false; epoch++; observationTicket++; fileTicket++;
    offConnection?.(); clear(); pullRequest.dispose(); locks(); root.remove();
  } };
}
