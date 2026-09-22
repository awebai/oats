/** On-demand K1 projection. IO is injected; never reads Git, files or a roster.
 * The context-panel host owns visibility/selection, this controller owns reads. */
import { gitTarget, gitTargetKey, gitState, gitDiff, gitObservation, gitKinds, INSTANCE_GIT_MINIMUM_VERSION } from './instance-git-contract.mjs';

export const instanceGitCSS = `
.instance-git { min-width:0; color:var(--fg); font-size:12px; }
.instance-git .git-toolbar { display:flex; gap:8px; align-items:center; margin-bottom:12px; }
.instance-git .git-toolbar h2 { flex:1; margin:0; font-size:14px; }
.instance-git button { font:inherit; background:var(--surface); color:var(--fg); border:1px solid var(--border); border-radius:6px; padding:5px 8px; cursor:pointer; }
.instance-git button:hover:not(:disabled) { background:var(--surface-2); }
.instance-git button:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.instance-git button:disabled { color:var(--faint); background:var(--surface-2); cursor:default; }
.instance-git .git-status, .instance-git .git-note { color:var(--muted); line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
.instance-git .git-status:empty { display:none; }
.instance-git .git-status.error { color:var(--danger); }
.instance-git details > summary { cursor:pointer; color:var(--muted); margin-top:8px; }
.instance-git .git-counts { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; }
.instance-git .git-counts span { padding:2px 5px; border-radius:4px; background:var(--surface-2); color:var(--muted); font-size:10.5px; }
.instance-git .git-card { border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin:0 0 16px; overflow-wrap:anywhere; background:var(--surface-2); }
.instance-git h3 { font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; margin:16px 0 8px; }
.instance-git dl { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.6fr); gap:6px 10px; }
.instance-git dt { color:var(--muted); }
.instance-git dd { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.instance-git .git-branch { font:600 12px var(--mono,monospace); white-space:pre-wrap; }
.instance-git .git-path { font:11px/1.5 var(--mono,monospace); white-space:pre-wrap; overflow-wrap:anywhere; }
.instance-git .git-files { display:grid; gap:2px; }
.instance-git .git-file { width:100%; min-height:30px; text-align:left; white-space:pre-wrap; overflow-wrap:anywhere; font:11.5px/1.5 var(--mono,monospace); }
.instance-git button.git-file[aria-pressed=true] { background:var(--sel); color:var(--fg); border-color:var(--accent); }
.instance-git .git-patch { max-height:420px; overflow:auto; white-space:pre; padding:10px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); color:var(--fg); font:11.5px/1.5 var(--mono,monospace); }
.instance-git .git-add { color:var(--ok); }
.instance-git .git-remove { color:var(--danger); }
.instance-git .git-hunk { color:var(--accent); }
`;
const report = v => v === null || v === undefined ? 'Not reported' : String(v);
export function createInstanceGitPanel(parent, { request, generation = () => 0, applyFocus = fn => fn() } = {}) {
  const doc = parent.ownerDocument;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const root = node('div', undefined, 'instance-git'); parent.append(root);
  const toolbar = node('div', undefined, 'git-toolbar'), refreshButton = node('button', 'Refresh'); refreshButton.type = 'button';
  toolbar.append(node('h2', 'Worktree'), refreshButton);
  const status = node('p', '', 'git-status'); status.setAttribute('role', 'status');
  const facts = node('div', undefined, 'git-facts'), changesHeading = node('h3', 'Changes');
  const files = node('div', undefined, 'git-files'); files.setAttribute('aria-label', 'Observed worktree changes');
  const diffStatus = node('p', '', 'git-status'); diffStatus.setAttribute('role', 'status');
  const diffBody = node('section', undefined, 'git-diff'); diffBody.setAttribute('aria-label', 'Read-only unified diff');
  const github = node('section', undefined, 'git-github');
  github.append(node('h3', 'GitHub / pull request'), node('p', 'Unavailable pending P1. No pull requests, checks or reviews are reported by this Git observation.', 'git-note'));
  root.append(toolbar, status, facts, changesHeading, files, diffStatus, diffBody, github);
  let alive = true, active = false, epoch = 0, observationTicket = 0, fileTicket = 0;
  let target = null, identity = '', attempted = false, observation = null, selected = null, busy = false, remote = false;
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
  const capture = () => ({ epoch, generation: generation(), identity, target });
  const owns = ref => alive && active && ref.epoch === epoch && ref.identity === identity && ref.generation === generation();
  const canPaint = ref => owns(ref) && visible();
  const message = (el, text = '', error = false) => { el.textContent = text; el.classList.toggle('error', error); };
  const unavailable = text => message(status, `${text}${facts.childElementCount ? ' Previous observation is stale; file actions are disabled.' : ''}`, true);
  const clearDiff = () => { selected = null; fileTicket++; diffBody.replaceChildren(); message(diffStatus); for (const b of controls.values()) b.setAttribute('aria-pressed', 'false'); };
  const clear = () => { observation = null; clearDiff(); controls.clear(); facts.replaceChildren(); files.replaceChildren(); changesHeading.textContent = 'Changes'; message(status); };
  const locks = () => { refreshButton.disabled = !alive || !active || !target || remote || busy; for (const b of controls.values()) b.disabled = !active || busy || !observation; };
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
  function renderObservation(ref) {
    facts.replaceChildren(); controls.clear(); files.replaceChildren();
    const data = observation, o = data.observation, card = node('section', undefined, 'git-card');
    card.append(node('div', o.unborn ? `${report(o.branch)} · unborn` : o.detached ? 'Detached HEAD' : report(o.branch), 'git-branch'), node('div', o.worktree, 'git-path'));
    card.append(node('p', `Observed: ${o.at}`, 'git-note'));
    if (data.recorded.drift) card.append(node('p', `Branch differs from recorded branch: ${report(data.recorded.branch)}`, 'git-note'));
    const metadata = node('details'); metadata.append(node('summary', 'Observation details'));
    rows(metadata, [['Observed revision', o.revision], ['Index fingerprint', o.indexRevision], ['Work mode', data.workMode],
      ['Recorded branch', data.recorded.branch], ['Branch drift', data.recorded.drift ? 'Changed from recorded branch' : 'No reported drift']]);
    card.append(metadata);
    facts.append(card, node('h3', 'Upstream comparison'));
    rows(facts, [['Upstream ref', data.upstream.ref], ['Ahead', data.upstream.ahead], ['Behind', data.upstream.behind]]);
    facts.append(node('h3', 'Default-branch comparison'));
    rows(facts, [['Base ref', data.base.ref], ['Base source', data.base.source], ['Merge base', data.base.mergeBase], ['Ahead', data.base.ahead], ['Behind', data.base.behind]]);
    for (const note of data.notes) facts.append(node('p', note, 'git-note'));
    changesHeading.textContent = `Changes · ${data.files.length}`;
    const counts = node('div', undefined, 'git-counts'); counts.setAttribute('role', 'list'); counts.setAttribute('aria-label', 'Reported change counts');
    for (const kind of gitKinds) { const label = node('span', `${kind[0].toUpperCase() + kind.slice(1)}: ${data.summary[kind]}`); label.setAttribute('role', 'listitem'); counts.append(label); }
    files.append(counts);
    if (!data.files.length) files.append(node('p', 'No changes reported in this observation.', 'git-note'));
    const snapshot = data;
    for (const file of data.files) {
      const b = node('button', `${file.xy}  ${file.origPath ? `${file.origPath} → ` : ''}${file.path}${file.submodule ? ' · submodule' : ''}`, 'git-file');
      b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.dataset.fileId = file.id;
      b.title = `Read diff: ${file.origPath ? `${file.origPath} → ` : ''}${file.path}`;
      b.addEventListener('click', () => {
        if (canPaint(ref) && observation === snapshot && !busy && b.isConnected && files.contains(b)) void selectFile(file, ref, snapshot);
      });
      controls.set(file.id, b); files.append(b);
    }
    locks();
  }
  async function refresh({ notice = '' } = {}) {
    if (!alive || !active || !target || remote || !visible()) return;
    const ref = capture(), ticket = ++observationTicket;
    attempted = true; busy = true;
    // When an expired file triggers re-observation, keep keyboard focus in the
    // same owned panel rather than dropping it onto the terminal/body.
    if (files.contains(doc.activeElement)) applyFocus(() => refreshButton.focus({ preventScroll: true }));
    observation = null; clearDiff(); message(diffStatus, notice); locks();
    message(status, facts.childElementCount ? 'Refreshing — previous observation is stale; file actions are disabled.' : 'Reading worktree…');
    try {
      const raw = await send(ref, 'git');
      if (!canPaint(ref) || ticket !== observationTicket) return;
      const result = reply(raw, ref);
      if (result.status !== 'available') { unavailable(`${result.reason.message} (${result.reason.code})`); return; }
      const data = gitState(result.data, ref.target);
      if (!data) throw new Error('Invalid Git observation');
      observation = data; clearDiff(); renderObservation(ref); message(status); message(diffStatus, notice);
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
      diffBody.append(node('h3', file.path), node('p', `Against: ${data.against} · ${data.bytes} patch bytes${data.truncated ? ` · truncated at ${data.limit} bytes` : ''}`, 'git-note'));
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
  function update({ active: nextActive = false, workspace, instance, key } = {}) {
    if (!alive) return;
    const next = gitTarget({ workspace, instance: instance?.instance, agent: instance?.agent, agentsRoot: instance?.agentsRoot, home: instance?.home, server: instance?.server || null });
    const nextIdentity = JSON.stringify([generation(), key, next && gitTargetKey(next), !!instance?.remote]);
    remote = !!(next?.server || instance?.remote);
    if (nextIdentity !== identity || active !== !!nextActive) {
      epoch++; observationTicket++; fileTicket++; busy = false; attempted = false;
      identity = nextIdentity; target = next; active = !!nextActive; clear();
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
  locks();
  return { update, refresh, dispose() {
    if (!alive) return; alive = false; active = false; epoch++; observationTicket++; fileTicket++;
    clear(); locks(); root.remove();
  } };
}
