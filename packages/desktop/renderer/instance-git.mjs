/** On-demand K1 projection. IO is injected; never reads Git, files or a roster.
 * The context-panel host owns visibility/selection, this controller owns reads. */
import { gitTarget, gitTargetKey, gitState, gitDiff, gitObservation, gitKinds, INSTANCE_GIT_MINIMUM_VERSION } from './instance-git-contract.mjs';
import { createForgePrPanel } from './forge-pr.mjs';
import { ageText } from './age-text.mjs';
import { iconElement } from './shell-icons.mjs';
import { readingFrom, serverLabel } from './remote-address.mjs';

export const instanceGitCSS = `
/* v4.1 Developer tab (Git and GitHub; board 2): Branch, Changes and Pull request cards under small-caps labels,
   a calm "No Git for this instance" state, and "Checked … · Refresh" as the tab's footer. */
.instance-git { display:flex; flex-direction:column; gap:20px; min-width:0; color:var(--fg); font-size:12px; }
.instance-git .git-section { display:flex; flex-direction:column; gap:8px; min-width:0; }
.instance-git .git-head { display:flex; align-items:center; gap:10px; min-width:0; color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.instance-git .git-head h3 { margin:0; font:inherit; color:inherit; }
.instance-git .git-head-count { margin-left:-4px; letter-spacing:0; text-transform:none; font:10.5px var(--mono,monospace); color:var(--muted); }
.instance-git .git-head-count:empty { display:none; }
.instance-git .git-head-aside { margin-left:auto; text-transform:none; letter-spacing:0; font-weight:500; }
.instance-git .git-head-aside:empty { display:none; }
.instance-git .git-changes-section .git-link { margin-left:auto; }
.instance-git button { font:inherit; color:var(--fg); cursor:pointer; }
.instance-git button.git-link { height:auto; min-height:0; padding:0 2px; margin:0 -2px; border:0; background:transparent; color:var(--accent); font-size:12px; font-weight:600; letter-spacing:0; text-transform:none; }
.instance-git button.git-link:hover:not(:disabled) { text-decoration:underline; }
.instance-git button.git-link:disabled { color:var(--muted); cursor:default; text-decoration:none; }
.instance-git .git-status, .instance-git .git-note { margin:0; color:var(--muted); line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
.instance-git .git-status:empty { display:none; }
.instance-git .git-status.error { color:var(--danger); }
.instance-git details > summary { cursor:pointer; color:var(--muted); font-size:11.5px; }
/* Cards: a bordered card for observed facts, a dashed one for "nothing here". */
.instance-git .git-card { border:1px solid var(--border); border-radius:9px; }
.instance-git .git-dashed { margin:0; padding:12px; border:1px dashed var(--border); border-radius:9px; color:var(--muted); font-size:12px; line-height:1.45; }
.instance-git .git-facts { display:flex; flex-direction:column; gap:8px; min-width:0; }
.instance-git .git-facts:empty { display:none; }
.instance-git .git-branch-card { display:flex; flex-direction:column; gap:3px; padding:10px 12px; }
.instance-git .git-branch-line { display:flex; align-items:center; gap:7px; min-width:0; font:600 12.5px var(--mono,monospace); }
.instance-git .git-branch-line .shell-icon { flex:none; color:var(--muted); }
.instance-git .git-branch { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.instance-git .git-ahead, .instance-git .git-upstream { color:var(--muted); white-space:nowrap; }
.instance-git .git-changes-notes:empty { display:none; }
.instance-git .git-changes-notes .git-note { margin-top:6px; font-size:11.5px; }
.instance-git .git-branch-sub { padding-left:21px; color:var(--muted); font-size:11.5px; line-height:1.4; overflow-wrap:anywhere; }
.instance-git .git-branch-card .git-note { padding-left:21px; font-size:11.5px; }
.instance-git .git-files { display:flex; flex-direction:column; min-width:0; }
.instance-git .git-files.git-card { overflow:hidden; }
.instance-git button.git-file { display:flex; align-items:center; gap:9px; width:100%; min-height:32px; margin:0; padding:8px 12px; box-sizing:border-box; border:0; border-bottom:1px solid var(--border); border-radius:0; background:transparent; text-align:left; font:12px/1.35 var(--mono,monospace); }
.instance-git button.git-file:last-child { border-bottom:0; }
.instance-git button.git-file:hover:not(:disabled):not([aria-pressed=true]) { background:var(--surface-2); }
.instance-git button.git-file[aria-pressed=true] { background:var(--sel); color:var(--fg); }
.instance-git button.git-file:disabled { color:var(--muted); cursor:default; }
/* The status letter: a 16px badge, transparent on the panel surface, the letter in its status colour. */
.instance-git .git-letter { flex:none; display:inline-grid; place-items:center; width:16px; height:16px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; font-size:10px; font-weight:700; line-height:1; color:var(--muted); }
.instance-git .git-letter-add { color:var(--ok); }
.instance-git .git-letter-mod { color:var(--warn); }
.instance-git .git-letter-del { color:var(--danger); }
/* One line: the directory (muted) gives way first, clipped from the left; the file name keeps its place. */
.instance-git .git-file-path { flex:1; display:flex; min-width:0; overflow:hidden; white-space:nowrap; }
.instance-git .git-file-dir { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; color:var(--muted); text-align:left; }
.instance-git .git-file-name { flex:0 0 auto; max-width:100%; overflow:hidden; text-overflow:ellipsis; }
.instance-git .git-counts { flex:none; display:inline-flex; gap:6px; margin-left:auto; white-space:nowrap; }
.instance-git .git-count-add { color:var(--ok); }
.instance-git .git-count-del { color:var(--danger); }
/* Red/green (and the letters) on --sel are not AA in every theme; the sign and the letter say which. */
.instance-git .git-file[aria-pressed=true] .git-count-add, .instance-git .git-file[aria-pressed=true] .git-count-del, .instance-git .git-file[aria-pressed=true] .git-letter { color:var(--fg); }
.instance-git .git-count-binary { color:var(--muted); font-family:var(--sans,system-ui); font-size:11px; }
/* A path or branch breaks after its slashes; a segment breaks inside only when longer than the line. */
.instance-git .git-seg { display:inline-block; max-width:100%; overflow-wrap:anywhere; }
.instance-git .git-diff:empty { display:none; }
.instance-git .git-diff { display:flex; flex-direction:column; gap:6px; margin-top:10px; }
.instance-git .git-diff h4 { margin:0; font:600 11.5px var(--mono,monospace); overflow-wrap:anywhere; }
.instance-git .git-patch { margin:0; max-height:420px; overflow:auto; white-space:pre; padding:10px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); color:var(--fg); font:11.5px/1.5 var(--mono,monospace); }
.instance-git .git-add { color:var(--ok); }
.instance-git .git-remove { color:var(--danger); }
.instance-git .git-hunk { color:var(--accent); }
/* No Git for this instance (directory / workspace mode): a calm dashed card, never an error. */
.instance-git .git-empty { display:flex; flex-direction:column; align-items:center; gap:10px; padding:28px 18px; text-align:center; color:var(--fg); }
.instance-git .git-empty[hidden] { display:none; }
.instance-git .git-empty-tile { display:grid; place-items:center; width:36px; height:36px; border-radius:9px; background:var(--surface-2); color:var(--muted); }
.instance-git .git-empty-title { font-weight:650; font-size:13px; color:var(--fg); }
.instance-git .git-empty-why { font-size:12px; color:var(--muted); line-height:1.45; }
.instance-git .git-empty-note { margin:-6px 0 0; font-size:11.5px; color:var(--muted); line-height:1.5; }
.instance-git .git-empty-note b { font-weight:600; color:var(--fg); }
/* Footer: when the worktree was read, and Refresh. */
.instance-git .git-footer { display:flex; align-items:center; gap:4px; flex-wrap:wrap; color:var(--muted); font-size:11px; }
.instance-git .git-footer .git-link { font-size:11px; }
.instance-git .git-github { display:flex; flex-direction:column; gap:8px; min-width:0; }
.instance-git .git-github button { background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:5px 8px; }
/* Pull request (board 2): a bordered card: state pill and title, "#N · closes …", a hairline, the checks and
   review rows, then "Send N threads" beside ↗. The caveat sits under the card. */
.instance-git .forge-pr-card { display:flex; flex-direction:column; min-width:0; overflow:hidden; }
.instance-git .forge-head { display:flex; flex-direction:column; gap:4px; min-width:0; padding:11px 12px; border-bottom:1px solid var(--border); }
/* flex-start, not center: a wrapped title keeps the pill on its first line. The pill (10.5px × 1.5 + 2px padding
   = 17.75px) matches the title's line (13px × 1.35 = 17.55px), so no margin is needed (measured on the rig). */
.instance-git .forge-title-row { display:flex; align-items:flex-start; gap:8px; min-width:0; }
.instance-git .forge-state { flex:none; padding:1px 7px; border-radius:10px; background:var(--tag-bg); color:var(--fg); font-size:10.5px; font-weight:650; line-height:1.5; }
.instance-git .forge-title { flex:1; min-width:0; font-size:13px; font-weight:650; line-height:1.35; overflow-wrap:anywhere; }
.instance-git .forge-sub { color:var(--muted); font-size:11.5px; }
.instance-git .git-github button.forge-issue { height:auto; min-height:0; padding:0; border:0; border-radius:2px; background:transparent; color:var(--accent); font:inherit; text-decoration:underline; text-underline-offset:2px; }
.instance-git .forge-body { display:flex; flex-direction:column; gap:7px; padding:10px 12px; }
.instance-git .forge-body:empty { display:none; }
.instance-git .forge-checks { display:flex; flex-direction:column; gap:7px; margin:0; padding:0; list-style:none; }
.instance-git .forge-check { display:flex; align-items:center; gap:8px; min-height:0; padding:0; box-sizing:border-box; border:0; color:var(--fg); font-size:12px; line-height:1.35; }
.instance-git .forge-mark { flex:none; display:inline-grid; place-items:center; width:14px; align-self:center; }
.instance-git .forge-check-name { flex:1; min-width:0; overflow-wrap:anywhere; }
.instance-git .forge-check-meta { flex:0 1 auto; min-width:0; margin-left:auto; color:var(--muted); font-size:11.5px; text-align:right; overflow-wrap:anywhere; }
.instance-git .forge-pass .forge-mark { color:var(--ok); }
.instance-git .forge-fail .forge-mark, .instance-git .forge-review[data-outcome=fail] .forge-mark { color:var(--danger); }
.instance-git .forge-pending .forge-mark, .instance-git .forge-review[data-outcome=pending] .forge-mark { color:var(--warn); }
.instance-git .forge-neutral .forge-mark { color:var(--muted); }
.instance-git .forge-review[data-outcome=pass] .forge-mark { color:var(--ok); }
.instance-git .git-github button.forge-open { display:inline-flex; align-items:center; justify-content:center; gap:6px; width:100%; height:32px; padding:0 12px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); font-size:12.5px; font-weight:600; }
.instance-git .git-github button.forge-open:hover { background:var(--surface-2); }
.instance-git .forge-caveat { font-size:11px; }
/* "Send N threads to <instance>" (the primary) beside ↗, and its exact preview. */
.instance-git .forge-actions { display:flex; gap:8px; min-width:0; padding:0 12px 12px; }
.instance-git .git-github button.forge-open.icon-only { flex:none; width:32px; padding:0; }
.instance-git .git-github button.forge-send { flex:1; min-width:0; height:32px; padding:0 12px; border:1px solid var(--primary-bg); border-radius:7px; background:var(--primary-bg); color:var(--primary-fg); font-size:12.5px; font-weight:650; white-space:normal; line-height:1.2; }
.instance-git .git-github button.forge-send:disabled { border-color:var(--border); background:var(--surface-2); color:var(--muted); cursor:default; }
.instance-git .git-github button.forge-cancel { height:32px; padding:0 14px; border-radius:7px; color:var(--fg); font-size:12.5px; font-weight:600; }
.instance-git .forge-send-status { padding:0 12px 12px; }
.instance-git .forge-send-status:empty { display:none; }
.instance-git .forge-send-status.error { color:var(--danger); }
.instance-git .forge-preview { display:flex; flex-direction:column; gap:8px; margin:0 12px 12px; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface-2); }
.instance-git .forge-preview[hidden] { display:none; }
.instance-git .forge-preview .forge-actions { padding:0; }
.instance-git .forge-preview-lead { margin:0; color:var(--fg); font-size:12px; line-height:1.45; }
.instance-git .forge-preview-text { max-height:260px; overflow:auto; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg); font:11.5px/1.5 var(--mono,monospace); white-space:pre-wrap; overflow-wrap:anywhere; }
.instance-git .forge-preview-seg { display:block; }
.instance-git .forge-preview-seg + .forge-preview-seg { margin-top:4px; }
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
/** A changed file's path on one line: the directory muted and clipped from the left, then the file name. */
function filePath(doc, value) {
  const el = doc.createElement('span'); el.className = 'git-file-path'; el.title = value;
  const cut = value.lastIndexOf('/') + 1;
  if (cut) {
    const dir = doc.createElement('span'), text = doc.createElement('bdi');
    dir.className = 'git-file-dir'; dir.dir = 'rtl'; text.textContent = value.slice(0, cut); dir.append(text); el.append(dir);
  }
  const name = doc.createElement('span'); name.className = 'git-file-name'; name.textContent = value.slice(cut); el.append(name);
  return el;
}
/** A change's one status letter (git status --short): the index side, else the worktree side. */
export function changeLetter(file) {
  if (file.kind === 'untracked') return '?';
  if (file.kind === 'unmerged') return 'U';
  const [x, y] = file.xy; return x !== '.' ? x : y;
}
/** A change's line counts (kernel #238): "+N" and "−M" when non-zero, "binary" for a binary
 * file, nothing when unknown (null) or absent (an older kernel). Never "+0". */
export function lineCounts(file) {
  if (file.binary === true) return { binary: true, add: null, del: null };
  const add = Number.isSafeInteger(file.additions) && file.additions > 0 ? file.additions : null;
  const del = Number.isSafeInteger(file.deletions) && file.deletions > 0 ? file.deletions : null;
  return add === null && del === null ? null : { binary: false, add, del };
}
const countWords = c => c.binary ? 'binary' : [c.add ? `${c.add} line${c.add === 1 ? '' : 's'} added` : null, c.del ? `${c.del} removed` : null].filter(Boolean).join(', ');
const LETTER_WORD = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed', U: 'unmerged', '?': 'untracked' };
// The status badge's colour class: added (ok), modified (warn), deleted (danger); anything else stays muted.
const LETTER_CLASS = { A: 'git-letter-add', M: 'git-letter-mod', D: 'git-letter-del' };
/** The branch's distance from the default branch, as the board words it: "↑3 from main", "↓1 from main",
 * "up to date" when both counts are observed zero, nothing (null) when the comparison is not reported. */
export function baseDistance(base) {
  if (!base?.ref || (base.ahead === null && base.behind === null)) return null;
  const parts = [base.ahead > 0 ? `↑${base.ahead}` : null, base.behind > 0 ? `↓${base.behind}` : null].filter(Boolean);
  if (parts.length) return `${parts.join(' ')} from ${base.ref.replace(/^origin\//, '')}`;
  return base.ahead === 0 && base.behind === 0 ? `up to date with ${base.ref.replace(/^origin\//, '')}` : null;
}
/** The upstream comparison, labelled apart from the base distance ("↑2 unpushed · ↓1 behind upstream"); null when
 * the kernel reports no upstream (unknown is not zero). */
export function upstreamDistance(upstream) {
  if (!upstream?.ref || (upstream.ahead == null && upstream.behind == null)) return null;
  const parts = [upstream.ahead > 0 ? `↑${upstream.ahead} unpushed` : null, upstream.behind > 0 ? `↓${upstream.behind} behind upstream` : null].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return upstream.ahead === 0 && upstream.behind === 0 ? 'pushed' : null;
}
/** Which kernel notes a healthy read shows, and under which card. The notes are plain strings (no codes), so
 * the one that is noise on every agent branch ("no upstream configured…") is matched on its prefix and hidden;
 * the rest stay as muted lines: line counts under Changes, everything else under the branch card. */
export function readNotes(notes) {
  const shown = { branch: [], changes: [] };
  for (const note of Array.isArray(notes) ? notes : []) {
    if (typeof note !== 'string' || /^no upstream configured\b/i.test(note)) continue;
    (/^line counts unavailable\b/i.test(note) ? shown.changes : shown.branch).push(note);
  }
  return shown;
}
/** Why there is no Git for this instance, from the roster's work mode (never inferred from the read). Only the
 * two modes that have no work tree by design are calm; null for every other mode (a worktree, checkout or attached
 * instance whose tree is gone, or an unknown mode), which the panel reports as a failure with its code. */
export function noGitReason(work) {
  if (work === 'directory') return 'It works in a plain folder (directory mode), so there is no branch or pull request to show.';
  if (work === 'workspace') return "It works across the workspace's member repositories (workspace mode), so there is no single branch or pull request to show.";
  return null;
}
/** A refusal's code, and the kernel's own message when a remote host sent one. */
const codeLine = reason => typeof reason.detail === 'string' && reason.detail ? `${reason.code}: ${reason.detail}` : reason.code;
export function createInstanceGitPanel(parent, { request, generation = () => 0, applyFocus = fn => fn(),
  requestForge, requestThreads = null, connectionGeneration = () => 0, subscribeConnections = () => () => {}, connect, openExternal, onObservation = () => {}, onPullRequest = () => {} } = {}) {
  const doc = parent.ownerDocument;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const root = node('div', undefined, 'instance-git'); parent.append(root);
  // Branch: its label and the work mode; the read's status; then the branch card.
  const branchSection = node('section', undefined, 'git-section git-branch-section');
  const toolbar = node('div', undefined, 'git-toolbar git-head'), workMode = node('span', '', 'git-head-aside');
  toolbar.append(node('h3', 'Branch'), workMode);
  const status = node('p', '', 'git-status'); status.setAttribute('role', 'status');
  // A read's code sits behind Details under its plain sentence (never inline).
  const statusDetails = node('details', undefined, 'git-status-details'); statusDetails.hidden = true;
  const statusCode = node('pre', '', 'git-note'); statusDetails.append(node('summary', 'Details'), statusCode);
  const facts = node('div', undefined, 'git-facts');
  // No Git for this instance (E_NO_WORKTREE): the board's calm empty state, in place of the sections.
  const empty = node('div', undefined, 'git-empty git-dashed'), emptyWhy = node('span', '', 'git-empty-why');
  const tile = node('span', undefined, 'git-empty-tile'); tile.setAttribute('aria-hidden', 'true'); tile.append(iconElement(doc, 'folder', { size: 18 }));
  empty.append(tile, node('span', 'No Git for this instance', 'git-empty-title'), emptyWhy);
  const emptyNote = node('p', undefined, 'git-empty-note');
  emptyNote.append('Instances in ', node('b', 'worktree'), ', ', node('b', 'checkout'), ' or ', node('b', 'attached'), ' mode show their branch, changes and pull request here.');
  // Changes: its count, Open diff, then one row per file (status badge, path, counts); a row reads its diff below the list.
  const changesSection = node('section', undefined, 'git-section git-changes-section');
  const changesHead = node('div', undefined, 'git-head'), changesHeading = node('h3', 'Changes'), changesCount = node('span', '', 'git-head-count');
  const openDiff = node('button', 'Open diff', 'git-link'); openDiff.type = 'button'; openDiff.hidden = true;
  changesHead.append(changesHeading, changesCount, openDiff);
  const files = node('div', undefined, 'git-files'); files.setAttribute('aria-label', 'Observed worktree changes');
  const diffStatus = node('p', '', 'git-status'); diffStatus.setAttribute('role', 'status');
  const diffBody = node('section', undefined, 'git-diff'); diffBody.setAttribute('aria-label', 'Read-only unified diff');
  const github = node('section', undefined, 'git-github');
  // Footer: "Checked <age> · Refresh". The age shows only with an observation; Refresh stays while there is a tree to re-read.
  const footer = node('div', undefined, 'git-footer'), checked = node('span', '', 'git-checked'), separator = node('span', ' · ', 'git-footer-sep');
  const refreshButton = node('button', 'Refresh', 'git-link'); refreshButton.type = 'button';
  footer.append(checked, separator, refreshButton);
  branchSection.append(toolbar, status, statusDetails, facts);
  const changesNotes = node('div', undefined, 'git-changes-notes');
  changesSection.append(changesHead, files, changesNotes, diffStatus, diffBody);
  root.append(branchSection, empty, emptyNote, changesSection, github, footer);
  // Sections with nothing observed are not shown.
  changesSection.hidden = true; github.hidden = true; empty.hidden = true; emptyNote.hidden = true; footer.hidden = true;
  const setChecked = at => { checked.textContent = at ? `Checked ${ageText(at)}` : ''; checked.title = at || ''; checked.hidden = separator.hidden = !at; };
  // The calm state hides the sections and the footer; leaving it shows them again.
  const noGit = on => { empty.hidden = emptyNote.hidden = !on; toolbar.hidden = on; if (on) { changesSection.hidden = true; github.hidden = true; } };
  // The painted PR's unresolved threads go up to the tab (its badge), tagged like onObservation.
  const pullRequest = createForgePrPanel(github, { request: requestForge, requestThreads, generation, connectionGeneration, subscribeConnections, connect, openExternal,
    onData: data => onPullRequest(data ? { identity: summaryIdentity, connection: connectionGeneration(), unresolvedThreads: data.unresolvedThreads ?? null } : null) });
  let alive = true, active = false, epoch = 0, observationTicket = 0, fileTicket = 0;
  let target = null, identity = '', summaryIdentity = '', attempted = false, observation = null, selected = null, busy = false, server = null, work = null;
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
  const clear = (summary = true) => { if (summary) onObservation(null); observation = null; pullRequest.update(); clearDiff(); controls.clear(); facts.replaceChildren(); files.replaceChildren(); changesNotes.replaceChildren(); files.classList.remove('git-card'); changesCount.textContent = ''; workMode.textContent = ''; message(status); setChecked(null); noGit(false); changesSection.hidden = true; openDiff.hidden = true; github.hidden = true; };
  const locks = () => {
    refreshButton.disabled = !alive || !active || !target || busy;
    footer.hidden = !alive || !active || !target || !empty.hidden;
    for (const b of [...controls.values(), openDiff]) b.disabled = !active || busy || !observation;
  };
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
  function renderObservation(ref, observationKey) {
    facts.replaceChildren(); controls.clear(); files.replaceChildren(); changesNotes.replaceChildren();
    const data = observation, o = data.observation;
    workMode.textContent = data.workMode || '';
    // The branch card: the branch on one line (full name in its title), then "repo · N files changed · ↑3 from main".
    const card = node('div', undefined, 'git-branch-card git-card');
    const line = node('div', undefined, 'git-branch-line');
    const branchText = o.unborn ? `${report(o.branch)} · unborn` : o.detached ? 'Detached HEAD' : report(o.branch);
    const branch = node('span', branchText, 'git-branch'); branch.title = branchText;
    line.append(iconElement(doc, 'branch', { size: 14 }), branch);
    const n = data.files.length, repo = tail(data.recorded.repo) || tail(o.worktree);
    const sub = node('div', [repo, n ? `${n} file${n === 1 ? '' : 's'} changed` : 'clean'].filter(Boolean).join(' · '), 'git-branch-sub'); sub.title = o.worktree;
    const distance = baseDistance(data.base);
    if (distance) {
      const ahead = node('span', distance, 'git-ahead');
      ahead.title = `${report(data.base.ahead)} ahead of, ${report(data.base.behind)} behind ${data.base.ref}`; sub.append(' · ', ahead);
    }
    // The upstream comparison (unpushed work), labelled so it cannot be read as the base distance; nothing when unknown.
    const pushed = upstreamDistance(data.upstream);
    if (pushed) {
      const up = node('span', pushed, 'git-upstream');
      up.title = `${report(data.upstream.ahead)} ahead of, ${report(data.upstream.behind)} behind ${data.upstream.ref}`; sub.append(' · ', up);
    }
    card.append(line, sub);
    if (data.recorded.drift) card.append(node('p', `Branch differs from recorded branch: ${report(data.recorded.branch)}`, 'git-note'));
    // A healthy read shows no Details (they belong to real failures) and hides only the kernel's "no upstream
    // configured" note, noise on every agent branch; its other notes stay as plain lines under their card.
    const notes = readNotes(data.notes);
    for (const note of notes.branch) card.append(node('p', note, 'git-note git-read-note'));
    facts.append(card);
    changesSection.hidden = false; github.hidden = false; openDiff.hidden = !n;
    changesCount.textContent = n ? String(n) : ''; files.classList.toggle('git-card', n > 0);
    if (!n) files.append(node('p', 'No uncommitted changes.', 'git-note git-dashed'));
    for (const note of notes.changes) changesNotes.append(node('p', note, 'git-note git-read-note'));
    const snapshot = data;
    for (const file of data.files) {
      const letter = changeLetter(file), shown = `${file.origPath ? `${file.origPath} → ` : ''}${file.path}${file.submodule ? ' · submodule' : ''}`;
      const badge = node('span', letter, `git-letter${LETTER_CLASS[letter] ? ` ${LETTER_CLASS[letter]}` : ''}`); badge.dataset.letter = letter;
      const b = node('button', undefined, 'git-file'); b.append(badge, filePath(doc, shown));
      // Its line counts (kernel #238), as the design's "+84 −3"; nothing when unknown.
      const counts = lineCounts(file);
      if (counts) {
        const box = node('span', undefined, 'git-counts');
        if (counts.binary) box.append(node('span', 'binary', 'git-count-binary'));
        if (counts.add) box.append(node('span', `+${counts.add}`, 'git-count-add'));
        if (counts.del) box.append(node('span', `−${counts.del}`, 'git-count-del'));
        b.append(box);
      }
      b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.dataset.fileId = file.id;
      b.title = [`${LETTER_WORD[letter] || file.kind}`, counts ? countWords(counts) : null, `read diff: ${shown}`].filter(Boolean).join(' · ');
      b.addEventListener('click', () => {
        if (canPaint(ref) && observation === snapshot && !busy && b.isConnected && files.contains(b)) void selectFile(file, ref, snapshot);
      });
      controls.set(file.id, b); files.append(b);
    }
    locks();
    setChecked(o.at);
    void pullRequest.update({ target: ref.target, key: observationKey, revision: o.revision, branch: o.branch });
  }
  async function refresh({ notice = '' } = {}) {
    if (!alive || !active || !target || !visible()) return;
    const ref = capture(), ticket = ++observationTicket;
    attempted = true; busy = true;
    // When an expired file triggers re-observation, keep keyboard focus in the
    // same owned panel rather than dropping it onto the terminal/body.
    if (files.contains(doc.activeElement)) applyFocus(() => refreshButton.focus({ preventScroll: true }));
    observation = null; onObservation(null); pullRequest.update(); clearDiff(); message(diffStatus, notice); noGit(false); setChecked(null); locks();
    // A remote row's worktree is read on its own machine: say so while it is in flight.
    message(status, facts.childElementCount ? 'Refreshing — previous observation is stale; file actions are disabled.' : server ? readingFrom(server) : 'Reading worktree…');
    try {
      const raw = await send(ref, 'git');
      if (!canPaint(ref) || ticket !== observationTicket) return;
      const result = reply(raw, ref);
      if (result.status !== 'available') {
        // No work tree by design (directory / workspace mode) is a calm fact, not a failure. Every other refusal,
        // including E_NO_WORKTREE for a mode that should have a tree (a lost worktree), stays red with its code.
        const calm = result.reason.code === 'E_NO_WORKTREE' && !facts.childElementCount ? noGitReason(work) : null;
        if (calm) { message(status); emptyWhy.textContent = calm; noGit(true); locks(); return; }
        unavailable(result.reason.message, codeLine(result.reason)); return;
      }
      const data = gitState(result.data, ref.target);
      if (!data) throw new Error('Invalid Git observation');
      observation = data; clearDiff(); renderObservation(ref, result.observationKey); message(status); message(diffStatus, notice);
      onObservation({ identity: ref.summaryIdentity, connection: ref.connection, changed: Object.values(data.summary).some(n => n > 0), at: data.observation.at,
        ahead: data.base.ahead, behind: data.base.behind });
    } catch {
      if (canPaint(ref) && ticket === observationTicket) unavailable('Git inspection unavailable or invalid. Refresh to retry; no current changes are established.');
    } finally {
      if (owns(ref) && ticket === observationTicket) { busy = false; if (visible()) locks(); }
    }
  }
  async function selectFile(file, ref, snapshot) {
    const ticket = ++fileTicket; selected = file;
    diffBody.replaceChildren(); message(diffStatus, server ? readingFrom(server) : 'Reading diff…');
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
      if (result.status !== 'available') { message(diffStatus, `${result.reason.message} (${codeLine(result.reason)})`, true); return; }
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
    const nextIdentity = JSON.stringify([generation(), connectionGeneration(), key, next && gitTargetKey(next), instance?.createdAt ?? null]);
    summaryIdentity = JSON.stringify([workspace, key, instance?.home, instance?.agent, instance?.agentsRoot, instance?.server || null, instance?.createdAt ?? null]);
    server = next?.server ? serverLabel(instance) : null;
    work = typeof instance?.work === 'string' ? instance.work : null;
    if (nextIdentity !== identity || active !== !!nextActive) {
      epoch++; observationTicket++; fileTicket++; busy = false; attempted = false;
      const changed = identity !== nextIdentity;
      identity = nextIdentity; target = next; active = !!nextActive; clear(changed);
    }
    if (!active) { locks(); return; }
    if (!target) { message(status, 'Select a current, fully qualified instance to inspect its worktree.'); locks(); return; }
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
