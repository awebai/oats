// Inert DTO/DOM tests plus static source/CSS reads. No CLI, server, native window or Git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextPanelCSS } from '../renderer/context-panel.mjs';
import { JSDOM } from 'jsdom';
import { createInstanceGitPanel, instanceGitCSS, baseDistance, noGitReason, upstreamDistance, readNotes } from '../renderer/instance-git.mjs';
import { gitState, gitDiff, gitTarget, gitTargetKey, INSTANCE_DIFF_LIMIT } from '../renderer/instance-git-contract.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const oid = 'a'.repeat(40), idx = 'b'.repeat(40), id = 'c'.repeat(24), secondId = 'd'.repeat(24);
const target = (root = '/team/agents', server = null) => ({ workspace: '/team', instance: 'dev-1', agent: 'dev', agentsRoot: root, home: `${root}/dev/instances/dev-1`, server });
const file = (fields = {}) => ({ id, kind: 'changed', xy: '.M', submodule: false, path: 'file.txt', origPath: null, ...fields });
const observation = () => ({ revision: oid, indexRevision: idx, at: '2026-09-22T00:00:00.000Z', worktree: '/fixture/work', branch: 'actual-branch', detached: false, unborn: false });
const data = (t = target()) => ({ instanceGitApi: 1, instance: t.instance, agent: t.agent, home: t.home, workMode: 'worktree', observation: observation(),
  recorded: { branch: 'recorded-branch', repo: '/recorded/repo', drift: true }, upstream: { ref: null, ahead: null, behind: null },
  base: { ref: 'origin/main', source: 'origin/HEAD', mergeBase: 'e'.repeat(40), ahead: 2, behind: 0 },
  summary: { changed: 2, renamed: 0, copied: 0, unmerged: 0, untracked: 0 }, files: [file(), file({ id: secondId, path: 'other.txt' })], notes: ['no upstream configured: upstream ahead/behind are unknown, not zero'] });
const diff = (f = file()) => ({ instanceGitApi: 1, observation: observation(), file: f, against: oid, binary: false, bytes: 8, truncated: false, limit: INSTANCE_DIFF_LIMIT,
  patch: '-old\n+X\n', readOnly: { helpers: 'disabled', optionalLocks: 'off', objectsWritten: 0 } });
const available = (value, t = target()) => ({ instanceGitApi: 1, minimumVersion: '0.24.7', status: 'available', target: t, data: value, reason: null });
const refused = (code = 'E_USAGE', t = target(), message = 'Read unavailable') => ({ instanceGitApi: 1, minimumVersion: '0.24.7', status: 'unavailable', target: t, data: null, reason: { code, message } });
const stale = () => ({ ...refused('E_STALE_OBSERVATION'), status: 'stale', reason: { code: 'E_STALE_OBSERVATION', message: 'Moved tree', observation: { ...observation(), revision: 'f'.repeat(40) } } });
function setup(t, request, create = createInstanceGitPanel) {
  const dom = new JSDOM('<!doctype html><body><input id="terminal"><aside></aside></body>'), doc = dom.window.document, host = doc.querySelector('aside');
  const style = doc.createElement('style'); style.textContent = instanceGitCSS; doc.head.append(style);
  let gen = 0, read = request || ((_ws, body) => available(body.action === 'git' ? data() : diff(body.fileId === id ? file() : file({ id: secondId, path: 'other.txt' }))));
  const calls = [], focused = [];
  const view = create(host, { generation: () => gen, request: (ws, body) => { calls.push({ ws, body }); return read(ws, body); },
    applyFocus: fn => { focused.push(true); fn(); } });
  t.after(() => { view.dispose(); dom.window.close(); });
  const show = (t = target(), active = true) => view.update({ active, workspace: t.workspace, instance: t, key: gitTargetKey(t) });
  return { dom, doc, host, view, calls, focused, show, bump: () => ++gen, read: fn => { read = fn; },
    one: s => host.querySelector(s), buttons: () => [...host.querySelectorAll('.git-file')], text: () => host.textContent };
}

test('inert mount; first-visible read once; routine updates preserve controls/focus; fixed selector never contains home/path/cwd', async t => {
  const u = setup(t); assert.equal(u.calls.length, 0); await u.show(target(), false); assert.equal(u.calls.length, 0);
  u.doc.querySelector('#terminal').focus(); await u.show();
  assert.equal(u.doc.activeElement.id, 'terminal'); const b = u.buttons()[0]; b.focus();
  for (let n = 0; n < 10; n++) await u.show();
  assert.equal(u.calls.length, 1); assert.equal(u.buttons()[0], b); assert.equal(u.doc.activeElement, b);
  assert.deepEqual(u.calls[0], { ws: '/team', body: { action: 'git', selector: { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', server: null } } });
  b.click(); await tick();
  assert.deepEqual(u.calls[1].body, { action: 'diff', selector: u.calls[0].body.selector, fileId: id, revision: oid, indexRevision: idx });
  assert.match(u.one('.git-patch').textContent, /-old\n\+X/); assert.equal(u.doc.activeElement, b);
  assert.match(u.text(), /actual-branch/); assert.match(u.text(), /Branch differs from recorded branch: recorded-branch/);
  // v4.1: no Details disclosure on a healthy read; the kernel's own notes stay visible as plain lines, except "no upstream configured".
  assert.equal(u.one('.git-more'), null); assert.equal(u.one('.git-branch-section details:not(.git-status-details)'), null);
  assert.doesNotMatch(u.text(), /no upstream configured/i, 'the no-upstream note is noise on every agent branch'); assert.equal(u.one('.git-upstream'), null, 'unknown upstream: no unpushed count'); assert.doesNotMatch(u.text(), /Not reported/);
  // v4.1 board 2: the heading is plain "Changes" with the count in its own mono span; the branch card says its base, repo and how many files changed.
  assert.equal(u.one('.git-changes-section h3').textContent, 'Changes'); assert.equal(u.one('.git-head-count').textContent, '2'); assert.equal(u.buttons().length, 2);
  assert.equal(u.one('.git-head-aside').textContent, 'worktree'); assert.equal(u.one('.git-ahead').textContent, '↑2 from main');
  assert.equal(u.one('.git-branch-sub').textContent, 'repo · 2 files changed · ↑2 from main', 'the distance sits in the subline'); assert.equal(u.one('.git-branch-sub').title, '/fixture/work');
  assert.equal(u.one('.git-branch').title, 'actual-branch', 'one line; the full name in its title');
  assert.ok(u.one('.git-branch-card.git-card') && u.one('.git-files.git-card'), 'the branch and the file list are bordered cards');
  assert.deepEqual(u.buttons().map(b => [b.querySelector('.git-letter').textContent, b.querySelector('.git-file-path').textContent]), [['M', 'file.txt'], ['M', 'other.txt']]);
  assert.match(u.one('.git-github').textContent, /installed OATS CLI does not report a remote/); assert.equal(u.one('a'), null);
});

test('typed unavailable and malformed data are not a healthy empty observation; explicit refresh is required after failure', async t => {
  const u = setup(t, () => refused()); await u.show();
  assert.match(u.text(), /Read unavailable.*E_USAGE/); assert.equal(u.buttons().length, 0);
  await u.show(); assert.equal(u.calls.length, 1);
  u.read(() => available({ ...data(), files: [] })); await u.view.refresh();
  assert.match(u.text(), /invalid/); assert.doesNotMatch(u.text(), /No uncommitted changes/);
  u.read(() => available({ ...data(), files: [], summary: { changed: 0, renamed: 0, copied: 0, unmerged: 0, untracked: 0 } }));
  await u.view.refresh(); assert.match(u.text(), /No uncommitted changes\./);
});

test('a recorded healthy instance.git cannot turn missing K1 into clean or zero changes', async t => {
  const u = setup(t, () => refused());
  await u.show({ ...target(), git: { dirty: 0, ahead: 0, behind: 0, branch: 'forged-clean' } });
  assert.match(u.text(), /Read unavailable.*E_USAGE/);
  // W6: with no observation the Changes section is hidden (replaces "the heading stays plain Changes").
  assert.equal(u.one('.git-facts').textContent, ''); assert.equal(u.one('.git-changes-section').hidden, true);
  assert.doesNotMatch(u.text(), /No uncommitted changes|Changes · 0|forged-clean|up.to.date|clean/i);
  assert.equal(u.buttons().length, 0);
});

test('failed refresh retains visibly stale facts, disables old actions, and never restores an old diff', async t => {
  const u = setup(t); await u.show(); u.buttons()[0].click(); await tick(); assert.ok(u.one('.git-patch'));
  const b = u.buttons()[0]; u.read(() => Promise.reject(new Error('SECRET child stderr'))); await u.view.refresh();
  assert.match(u.text(), /Previous observation is stale/); assert.match(u.text(), /actual-branch/);
  assert.equal(u.one('.git-patch'), null); assert.ok(u.buttons().every(b => b.disabled));
  const before = u.calls.length; b.dispatchEvent(new u.dom.window.Event('click')); await tick(); assert.equal(u.calls.length, before);
  assert.doesNotMatch(u.text(), /SECRET/);
});

for (const end of ['success', 'reject']) test(`new observation refusal wins over older ${end}`, async t => {
  const old = deferred(), u = setup(t, () => old.promise); void u.show();
  u.read(() => refused('CURRENT')); await u.view.refresh();
  if (end === 'success') old.resolve(available(data())); else old.reject(new Error('OLD'));
  await tick(); assert.match(u.text(), /CURRENT/); assert.equal(u.buttons().length, 0); assert.doesNotMatch(u.text(), /OLD|actual-branch/);
});
for (const end of ['success', 'reject']) test(`new file owns result and status against older ${end}`, async t => {
  const pending = deferred(), u = setup(t); await u.show();
  u.read((_ws, body) => body.fileId === id ? pending.promise : available(diff(file({ id: secondId, path: 'other.txt' }))));
  u.buttons()[0].click(); u.buttons()[1].click(); await tick();
  const before = u.one('.git-diff').innerHTML;
  if (end === 'success') pending.resolve(available(diff())); else pending.reject(new Error('OLD'));
  await tick(); assert.equal(u.one('.git-diff').innerHTML, before); assert.match(u.one('.git-diff').textContent, /other.txt/);
});
for (const boundary of ['selection', 'workspace', 'hidden', 'dispose']) for (const end of ['success', 'reject']) {
  test(`pending diff ${end} cannot cross ${boundary} ownership`, async t => {
    const u = setup(t); await u.show(); const pending = deferred(), old = u.buttons()[0];
    u.read(() => pending.promise); old.click();
    if (boundary === 'selection') { u.read(() => available(data(target('/other/agents')), target('/other/agents'))); await u.show(target('/other/agents')); }
    else if (boundary === 'workspace') { u.bump(); u.bump(); }
    else if (boundary === 'hidden') await u.show(target(), false);
    else u.view.dispose();
    const before = u.host.innerHTML;
    if (end === 'success') pending.resolve(available(diff())); else pending.reject(new Error('OLD'));
    await tick(); assert.equal(u.host.innerHTML, before);
    const count = u.calls.length; old.dispatchEvent(new u.dom.window.Event('click')); await tick(); assert.equal(u.calls.length, count);
  });
}

test('stale diff clears selection and re-observes once, never automatically substitutes another file', async t => {
  const u = setup(t); await u.show();
  u.read((_ws, body) => body.action === 'diff' ? stale() : available(data()));
  const b = u.buttons()[0]; b.focus(); b.click(); await tick(); await tick();
  assert.deepEqual(u.calls.map(c => c.body.action), ['git', 'diff', 'git']); assert.equal(u.one('.git-patch'), null);
  assert.match(u.text(), /Select a file from the refreshed observation/);
  assert.ok(u.buttons().every(b => b.getAttribute('aria-pressed') === 'false'));
  assert.equal(u.doc.activeElement.textContent, 'Refresh'); assert.equal(u.focused.length, 1);
});

test('stale automatic re-observation cannot overwrite a newer selection or leak its diagnostic on failure', async t => {
  const u = setup(t); await u.show(); const pending = deferred();
  u.read((_ws, body) => body.action === 'diff' ? stale() : pending.promise); u.buttons()[0].click(); await tick();
  u.read(() => available(data(target('/other/agents')), target('/other/agents'))); await u.show(target('/other/agents'));
  const before = u.host.innerHTML; pending.reject(new Error('OLD stale refresh failed')); await tick();
  assert.equal(u.host.innerHTML, before); assert.doesNotMatch(u.text(), /Select a file from|OLD/);
});

test('remote and incomplete targets cannot read or act, including retained Refresh dispatch', async t => {
  const u = setup(t); await u.show(); const b = u.one('.git-footer button');
  await u.show(target('/team/agents', 'host-b'));
  b.dispatchEvent(new u.dom.window.Event('click')); await u.view.refresh();
  assert.equal(u.calls.length, 1); assert.match(u.text(), /Remote Git inspection is unavailable/);
  assert.equal(u.one('.git-footer').hidden, true, 'nothing to refresh: no footer');
  await u.show({ ...target(), agent: undefined }); assert.equal(u.calls.length, 1); assert.match(u.text(), /fully qualified/);
});

test('wrong target echo, same-name foreign home and foreign diff id/revisions fail closed', async t => {
  const u = setup(t, () => available(data(), target('/other/agents'))); await u.show(); assert.equal(u.buttons().length, 0);
  u.read(() => available({ ...data(), home: '/other/home' })); await u.view.refresh(); assert.equal(u.buttons().length, 0);
  u.read(() => available(data())); await u.view.refresh();
  for (const mutate of [d => { d.file.id = secondId; }, d => { d.observation.indexRevision = 'e'.repeat(40); }, d => { d.observation.worktree = '/other/work'; }, d => { d.file.path = 'wrong.txt'; }]) {
    const d = diff(); mutate(d); u.read(() => available(d)); u.buttons()[0].click(); await tick();
    assert.equal(u.one('.git-patch'), null); assert.match(u.text(), /Diff unavailable or invalid/);
  }
});

test('literal rename paths and patch content cannot create markup, URLs or path requests', async t => {
  const evil = 'new\n<img src=x onerror=evil()>', f = file({ kind: 'renamed', xy: 'R.', path: evil, origPath: 'old name.txt', score: 'R100' });
  const state = data(); state.files = [f]; state.summary = { changed: 0, renamed: 1, copied: 0, unmerged: 0, untracked: 0 };
  const patch = '<script>evil()</script>\n+javascript:evil()\n', d = { ...diff(f), patch, bytes: Buffer.byteLength(patch) };
  const u = setup(t, (_ws, body) => available(body.action === 'git' ? state : d)); await u.show(); u.buttons()[0].click(); await tick();
  assert.ok(u.text().includes(evil)); assert.ok(u.text().includes('<script>evil()</script>'));
  assert.equal(u.one('script,img,a,iframe'), null); assert.equal(u.calls[1].body.fileId, id);
  assert.equal(Object.hasOwn(u.calls[1].body, 'path'), false); assert.equal(Object.hasOwn(u.calls[1].body.selector, 'home'), false);
});

test('binary, truncated and UI-line-limited patches retain explicit qualification', async t => {
  const u = setup(t); await u.show();
  u.read(() => available({ ...diff(), binary: true, patch: '', bytes: 0 })); u.buttons()[0].click(); await tick();
  assert.match(u.text(), /Binary file/); assert.equal(u.one('.git-patch'), null);
  const patch = '+line\n'.repeat(4500);
  u.read(() => available({ ...diff(), patch, bytes: 300000, truncated: true })); u.buttons()[0].click(); await tick();
  assert.match(u.text(), /truncated at 262144 bytes/); assert.match(u.text(), /Display limited to 4000 of 4501 returned lines/);
});

test('DTO validation refuses pre-hardening HEAD/helper claims, false null counts, malformed statuses and duplicate ids', () => {
  const request = { fileId: id, revision: oid, indexRevision: idx, observation: observation(), file: file() };
  assert.ok(gitDiff(diff(), request)); assert.ok(gitState(data(), target()));
  for (const mutate of [d => { d.against = 'HEAD'; }, d => { delete d.readOnly; }, d => { d.readOnly.helpers = 'enabled'; }, d => { d.patch = 'x'.repeat(INSTANCE_DIFF_LIMIT + 1); d.bytes = d.patch.length; }, d => { d.bytes = 0; }]) {
    const d = diff(); mutate(d); assert.equal(gitDiff(d, request), null);
  }
  for (const mutate of [d => { d.upstream.ahead = 0; }, d => { d.files[1].id = id; }, d => { d.files[0].kind = 'unknown'; }, d => { d.summary.changed = -1; }, d => { d.observation.indexRevision = 'no-index'; }, d => { d.home = '/foreign'; }]) {
    const d = data(); mutate(d); assert.equal(gitState(d, target()), null);
  }
  assert.equal(gitTarget({ ...target(), home: '--home' })?.home, '--home', 'DTO target strings do not grant filesystem authority; Node boundary must enforce absolute server-owned paths');
});

async function factory(guard, weaken) {
  if (!weaken) return createInstanceGitPanel;
  const url = new URL('../renderer/instance-git.mjs', import.meta.url);
  let source = readFileSync(url, 'utf8').replace(/from '(\.[^']+)'/g, (_, path) => `from '${new URL(path, url).href}'`);
  if (guard === 'observation') {
    assert.ok(source.includes('ticket !== observationTicket') && source.includes('ticket === observationTicket'));
    source = source.replaceAll('ticket !== observationTicket', 'false').replaceAll('ticket === observationTicket', 'true');
  } else {
    const needle = guard === 'workspace' ? 'ref.generation === generation()' : 'ticket === fileTicket';
    assert.equal(source.split(needle).length, 2); source = source.replace(needle, 'true');
  }
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).createInstanceGitPanel;
}
for (const guard of ['observation', 'workspace', 'file']) for (const outcome of ['success', 'reject']) for (const weakened of [false, true]) {
  test(`${guard} guard ${outcome}${weakened ? ' mutation is detected' : ' preserves ownership'}`, async t => {
    const u = setup(t, undefined, await factory(guard, weakened)), pending = deferred();
    if (guard === 'file') {
      await u.show(); u.read(() => pending.promise); u.buttons()[0].click();
      u.read(() => refused('CURRENT')); u.buttons()[0].click(); await tick();
    } else {
      u.read(() => pending.promise); void u.show();
      if (guard === 'workspace') { u.bump(); u.bump(); }
      else { u.read(() => refused('CURRENT')); await u.view.refresh(); }
    }
    const before = u.host.innerHTML;
    if (outcome === 'success') pending.resolve(available(guard === 'file' ? diff() : data())); else pending.reject(new Error('OLD'));
    await tick();
    const unchanged = () => assert.equal(u.host.innerHTML, before);
    if (weakened) assert.throws(unchanged); else unchanged();
  });
}
function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: actual Git panel/diff uses computed-token AA backgrounds`, async t => {
  // Line counts (kernel #238): "+3 −1" on one row, "binary" on the other.
  const counted = () => { const d = data(); Object.assign(d.files[0], { additions: 3, deletions: 1, binary: false }); Object.assign(d.files[1], { additions: null, deletions: null, binary: true });
    d.files.push(file({ id: 'e'.repeat(24), path: 'third.txt', additions: 5, deletions: 2, binary: false }), file({ id: 'f'.repeat(24), xy: 'A.', path: 'added.txt' }), file({ id: '1'.repeat(24), xy: '.D', path: 'gone.txt' }),
      file({ id: '2'.repeat(24), kind: 'untracked', xy: '??', path: 'new.txt' })); d.summary.changed = 5; d.summary.untracked = 1; return d; };
  const u = setup(t, (_ws, body) => available(body.action === 'git' ? counted() : diff())); u.host.id = 'context-panel'; u.host.className = 'context-panel';
  const style = u.doc.createElement('style'); style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8') + contextPanelCSS;
  u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme;
  await u.show(); u.buttons()[0].click(); await tick();
  const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    // W6 (design): the section labels, branch facts, status letters and links sit on the panel surface (replaces the .git-card pairs).
    ['.git-head', '#context-panel', 'muted', 'surface'], ['.git-branch-line', '#context-panel', 'fg', 'surface'],
    ['.git-branch-sub', '#context-panel', 'muted', 'surface'], 
    // v4.1: the status badge's letter in its status colour (A ok, M warn, D danger, others muted) on the panel surface; --fg once the row is selected.
    ['.git-file:not([aria-pressed=true]) .git-letter[data-letter="?"]', '#context-panel', 'muted', 'surface'], ['.git-file:not([aria-pressed=true]) .git-letter.git-letter-add', '#context-panel', 'ok', 'surface'],
    ['.git-file:not([aria-pressed=true]) .git-letter.git-letter-mod', '#context-panel', 'warn', 'surface'], ['.git-file:not([aria-pressed=true]) .git-letter.git-letter-del', '#context-panel', 'danger', 'surface'],
    ['.git-file[aria-pressed=true] .git-letter', '.git-file[aria-pressed=true]', 'fg', 'sel'],
    ['button.git-link', '#context-panel', 'accent', 'surface'], ['.git-head-count', '#context-panel', 'muted', 'surface'], ['.git-ahead', '#context-panel', 'muted', 'surface'],
    ['.git-footer', '#context-panel', 'muted', 'surface'], ['.git-footer .git-link', '#context-panel', 'accent', 'surface'],
    ['.git-file:not([aria-pressed=true]) .git-count-binary', '#context-panel', 'muted', 'surface'],
    ['.git-file:not([aria-pressed=true]) .git-count-add', '#context-panel', 'ok', 'surface'], ['.git-file:not([aria-pressed=true]) .git-count-del', '#context-panel', 'danger', 'surface'],
    ['.git-file[aria-pressed=true] .git-count-add', '.git-file[aria-pressed=true]', 'fg', 'sel'], ['.git-file[aria-pressed=true] .git-count-del', '.git-file[aria-pressed=true]', 'fg', 'sel'],
    ['.git-github p', '#context-panel', 'muted', 'surface'], ['.git-file[aria-pressed=true]', '.git-file[aria-pressed=true]', 'fg', 'sel'],
    ['.git-add', '.git-patch', 'ok', 'surface-2'], ['.git-remove', '.git-patch', 'danger', 'surface-2'],
  ]) {
    const el = u.doc.querySelector(selector), background = u.doc.querySelector(painted); assert.ok(el && background);
    assert.equal(u.dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(u.dom.window.getComputedStyle(background).background, `var(--${bg})`, painted);
    const a = luminance(root.getPropertyValue(`--${fg}`).trim()), b = luminance(root.getPropertyValue(`--${bg}`).trim());
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(u.dom.window.getComputedStyle(parent).opacity, '1');
  }
});

test('a refused read is one plain sentence with its code behind Details; sections with nothing observed are hidden', async t => {
  const u = setup(t, () => refused('E_CLI_FAILED'));
  await u.show();
  const status = u.one('.git-status');
  assert.equal(status.textContent, 'Read unavailable'); assert.doesNotMatch(status.textContent, /E_CLI_FAILED/);
  const details = u.one('.git-status-details');
  assert.equal(details.hidden, false); assert.equal(details.querySelector('summary').textContent, 'Details'); assert.equal(details.querySelector('pre').textContent, 'E_CLI_FAILED');
  assert.equal(u.one('.git-changes-section').hidden, true, 'no observation: no Changes section'); assert.equal(u.one('.git-github').hidden, true, 'no observation: no GitHub section');
  assert.equal(u.one('.git-footer').hidden, false, 'Refresh stays reachable after a failed read'); assert.equal(u.one('.git-checked').hidden, true, 'nothing was checked yet');
  u.read(() => available(data())); u.one('.git-footer button').click(); await tick(); await tick();
  assert.equal(u.one('.git-status-details').hidden, true, 'a good read clears the code');
  assert.equal(u.one('.git-github').hidden, false); assert.match(u.one('.git-footer').textContent, /^Checked .+ · Refresh$/);
});

// v4.1 board 2 (Git & GitHub): the footer, the branch distance, the status badges, the calm "No Git" state.
test('footer "Checked <age> · Refresh": the age only with an observation (its title the exact time), Refresh re-reads', async t => {
  const u = setup(t); await u.show();
  const footer = u.one('.git-footer'), checked = u.one('.git-checked'), refresh = u.one('.git-footer button.git-link');
  assert.equal(footer.hidden, false); assert.equal(refresh.textContent, 'Refresh'); assert.equal(u.one('.git-toolbar button'), null, 'Refresh left the Branch header');
  assert.match(checked.textContent, /^Checked (.* ago|just now|\d{4}-)/); assert.equal(checked.title, '2026-09-22T00:00:00.000Z'); assert.equal(checked.hidden, false);
  assert.match(footer.textContent, /^Checked .+ · Refresh$/);
  refresh.click(); await tick(); await tick(); assert.deepEqual(u.calls.map(c => c.body.action), ['git', 'git']);
  u.read(() => refused('E_GIT_FAILED')); refresh.click(); await tick(); await tick();
  assert.equal(checked.hidden, true, 'a failed read has no checked time'); assert.equal(footer.hidden, false, 'but Refresh stays');
  await u.show(target(), false); assert.equal(footer.hidden, true, 'inactive: no footer');
});

test('onObservation carries ahead/behind from the default-branch comparison, as numbers or null', async t => {
  const seen = [];
  const dom = new JSDOM('<!doctype html><body><aside></aside></body>'), host = dom.window.document.querySelector('aside');
  let value = data();
  const view = createInstanceGitPanel(host, { request: () => available(value), onObservation: s => seen.push(s) });
  t.after(() => { view.dispose(); dom.window.close(); });
  const show = () => view.update({ active: true, workspace: target().workspace, instance: target(), key: gitTargetKey(target()) });
  await show();
  assert.deepEqual(seen.at(-1), { identity: seen.at(-1).identity, connection: 0, changed: true, at: '2026-09-22T00:00:00.000Z', ahead: 2, behind: 0 });
  value = { ...data(), base: { ref: null, source: null, mergeBase: null, ahead: null, behind: null } }; await view.refresh();
  assert.deepEqual([seen.at(-1).ahead, seen.at(-1).behind], [null, null], 'not reported stays null, never 0');
});

test('branch distance: "↑a ↓b from <base>", "up to date with <base>" when both are observed zero, nothing when not reported', async t => {
  const base = (ahead, behind, ref = 'origin/main') => ({ ref, source: 'origin/HEAD', mergeBase: 'e'.repeat(40), ahead, behind });
  assert.equal(baseDistance(base(3, 0)), '↑3 from main'); assert.equal(baseDistance(base(0, 1)), '↓1 from main'); assert.equal(baseDistance(base(2, 5)), '↑2 ↓5 from main');
  assert.equal(baseDistance(base(4, 0, 'upstream/develop')), '↑4 from upstream/develop', 'only an origin/ prefix is dropped');
  assert.equal(baseDistance(base(0, 0)), 'up to date with main');
  assert.equal(baseDistance({ ref: null, source: null, mergeBase: null, ahead: null, behind: null }), null);
  assert.equal(baseDistance(base(null, null)), null); assert.equal(baseDistance(base(0, null)), null, 'a half-known zero is not "up to date"');
  assert.equal(baseDistance(base(null, 2)), '↓2 from main');
  const u = setup(t, () => available({ ...data(), base: base(0, 0) })); await u.show();
  assert.equal(u.one('.git-ahead').textContent, 'up to date with main'); assert.equal(u.one('.git-ahead').title, '0 ahead of, 0 behind origin/main');
  u.read(() => available({ ...data(), base: { ref: null, source: null, mergeBase: null, ahead: null, behind: null } })); await u.view.refresh();
  assert.equal(u.one('.git-ahead'), null, 'unknown: nothing');
});

test('upstream comparison: "↑n unpushed · ↓m behind upstream" beside the base distance, "pushed" at 0/0, nothing when unknown', async t => {
  const up = (ahead, behind, ref = 'origin/oats') => ({ ref, ahead, behind });
  assert.equal(upstreamDistance(up(2, 0)), '↑2 unpushed'); assert.equal(upstreamDistance(up(0, 1)), '↓1 behind upstream');
  assert.equal(upstreamDistance(up(2, 1)), '↑2 unpushed · ↓1 behind upstream'); assert.equal(upstreamDistance(up(0, 0)), 'pushed');
  assert.equal(upstreamDistance({ ref: null, ahead: null, behind: null }), null); assert.equal(upstreamDistance(up(0, null)), null, 'a half-known zero is not "pushed"');
  const u = setup(t, () => available({ ...data(), upstream: up(2, 0), base: { ...data().base, ahead: 6 }, notes: [] })); await u.show();
  assert.equal(u.one('.git-branch-sub').textContent, 'repo · 2 files changed · ↑6 from main · ↑2 unpushed', 'both comparisons, each labelled');
  assert.equal(u.one('.git-upstream').title, '2 ahead of, 0 behind origin/oats');
  u.read(() => available({ ...data(), upstream: { ref: null, ahead: null, behind: null } })); await u.view.refresh();
  assert.equal(u.one('.git-upstream'), null, 'unknown: nothing'); assert.equal(u.one('.git-branch-sub').textContent, 'repo · 2 files changed · ↑2 from main');
});

test('kernel notes: only "no upstream configured" is hidden; line counts show under Changes, the base note under the branch card', async t => {
  const numstat = 'line counts unavailable (git diff --numstat failed): additions/deletions are unknown, not zero';
  const noBase = 'no default branch found (origin/HEAD, origin/main, origin/master, main, master): base comparison unknown';
  const noUp = 'no upstream configured: upstream ahead/behind are unknown, not zero';
  assert.deepEqual(readNotes([noUp, noBase, numstat]), { branch: [noBase], changes: [numstat] });
  assert.deepEqual(readNotes(undefined), { branch: [], changes: [] });
  const u = setup(t, () => available({ ...data(), notes: [noUp, noBase, numstat] })); await u.show();
  assert.equal(u.one('.git-changes-section .git-changes-notes .git-read-note').textContent, numstat, 'the numstat note is shown under Changes');
  assert.equal(u.one('.git-branch-card .git-read-note').textContent, noBase);
  assert.doesNotMatch(u.text(), /no upstream configured/); assert.equal(u.one('.git-status-details').hidden, true, 'still no Details on a healthy read');
  u.read(() => available({ ...data(), notes: [] })); await u.view.refresh();
  assert.equal(u.host.querySelectorAll('.git-read-note').length, 0, 'a new read clears the old notes');
});

test('status badges: the letter with its class per kind (A add, M mod, D del, others plain), inside a bordered list with hairlines', async t => {
  const state = data();
  state.files = [file({ id: '1'.repeat(24), xy: 'A.', path: 'a' }), file({ id: '2'.repeat(24), xy: '.M', path: 'm' }), file({ id: '3'.repeat(24), xy: 'D.', path: 'd' }),
    file({ id: '4'.repeat(24), kind: 'renamed', xy: 'R.', path: 'r', origPath: 'q', score: 'R100' }), file({ id: '5'.repeat(24), kind: 'untracked', xy: '??', path: 'u' })];
  state.summary = { changed: 3, renamed: 1, copied: 0, unmerged: 0, untracked: 1 };
  const u = setup(t, () => available(state)); await u.show();
  assert.deepEqual(u.buttons().map(b => [b.querySelector('.git-letter').textContent, b.querySelector('.git-letter').dataset.letter, b.querySelector('.git-letter').className]),
    [['A', 'A', 'git-letter git-letter-add'], ['M', 'M', 'git-letter git-letter-mod'], ['D', 'D', 'git-letter git-letter-del'], ['R', 'R', 'git-letter'], ['?', '?', 'git-letter']]);
  assert.equal(u.one('.git-head-count').textContent, '5'); assert.ok(u.one('.git-files').classList.contains('git-card'));
  assert.match(instanceGitCSS, /button\.git-file \{[^}]*border-bottom:1px solid var\(--border\)/); assert.match(instanceGitCSS, /button\.git-file:last-child \{ border-bottom:0; \}/);
});

test('no uncommitted changes: a dashed card under the Changes header, no count, no Open diff, no bordered list', async t => {
  const u = setup(t, () => available({ ...data(), files: [], summary: { changed: 0, renamed: 0, copied: 0, unmerged: 0, untracked: 0 } })); await u.show();
  const note = u.one('.git-files .git-dashed');
  assert.equal(note.textContent, 'No uncommitted changes.'); assert.equal(u.one('.git-head-count').textContent, ''); assert.equal(u.one('.git-changes-section .git-link').hidden, true);
  assert.equal(u.one('.git-files').classList.contains('git-card'), false); assert.equal(u.one('.git-branch-sub').textContent, 'repo · clean · ↑2 from main');
  assert.doesNotMatch(u.text(), /No changes reported/);
});

for (const [work, sentence] of [['directory', 'It works in a plain folder (directory mode), so there is no branch or pull request to show.'],
  ['workspace', "It works across the workspace's member repositories (workspace mode), so there is no single branch or pull request to show."]]) {
  test(`E_NO_WORKTREE for work ${JSON.stringify(work)} is the calm "No Git for this instance" state, not an error`, async t => {
    const u = setup(t, () => refused('E_NO_WORKTREE', target(), 'This instance has no available Git worktree'));
    await u.show({ ...target(), work });
    const empty = u.one('.git-empty');
    assert.equal(empty.hidden, false); assert.ok(empty.classList.contains('git-dashed'));
    assert.equal(empty.querySelector('.git-empty-title').textContent, 'No Git for this instance');
    assert.equal(empty.querySelector('.git-empty-why').textContent, sentence); assert.equal(noGitReason(work), sentence);
    assert.ok(empty.querySelector('.git-empty-tile svg.shell-icon'), 'the folder tile'); assert.equal(empty.querySelector('.git-empty-tile').getAttribute('aria-hidden'), 'true');
    const note = u.one('.git-empty-note');
    assert.equal(note.hidden, false); assert.equal(note.textContent, 'Instances in worktree, checkout or attached mode show their branch, changes and pull request here.');
    assert.deepEqual([...note.querySelectorAll('b')].map(b => b.textContent), ['worktree', 'checkout', 'attached']);
    assert.equal(u.one('.git-status').textContent, ''); assert.equal(u.one('.error'), null, 'no red status'); assert.equal(u.one('.git-status-details').hidden, true, 'no Details');
    assert.doesNotMatch(u.text(), /no available Git worktree|E_NO_WORKTREE/);
    assert.equal(u.one('.git-toolbar').hidden, true, 'no Branch header'); assert.equal(u.one('.git-changes-section').hidden, true); assert.equal(u.one('.git-github').hidden, true);
    assert.equal(u.one('.git-footer').hidden, true, 'nothing to refresh');
    // Leaving for an instance with a tree shows the sections again.
    u.read(() => available(data())); await u.show(target('/other/agents'));
    assert.equal(u.one('.git-empty').hidden, true); assert.equal(u.one('.git-empty-note').hidden, true); assert.equal(u.one('.git-toolbar').hidden, false);
  });
}

// A mode that should have a tree (its worktree was lost) or an unknown mode is a failure, never a calm state.
for (const work of ['worktree', 'checkout', 'attached', undefined, 'odd']) test(`E_NO_WORKTREE for work ${JSON.stringify(work)} stays red with the kernel message, its code and Refresh`, async t => {
  const u = setup(t, () => refused('E_NO_WORKTREE', target(), 'This instance has no available Git worktree'));
  await u.show({ ...target(), work });
  assert.equal(noGitReason(work), null);
  assert.equal(u.one('.git-empty').hidden, true); assert.equal(u.one('.git-empty-note').hidden, true);
  const status = u.one('.git-status');
  assert.equal(status.textContent, 'This instance has no available Git worktree'); assert.ok(status.classList.contains('error'));
  assert.equal(u.one('.git-status-details').hidden, false); assert.equal(u.one('.git-status-details pre').textContent, 'E_NO_WORKTREE');
  assert.equal(u.one('.git-toolbar').hidden, false); assert.equal(u.one('.git-footer').hidden, false, 'Refresh to retry');
});

test('E_NO_WORKTREE after a good observation is a stale failure like any other, never a calm empty state over stale facts', async t => {
  const u = setup(t); await u.show();
  u.read(() => refused('E_NO_WORKTREE', target(), 'This instance has no available Git worktree')); await u.view.refresh();
  assert.equal(u.one('.git-empty').hidden, true); assert.ok(u.one('.git-status').classList.contains('error'));
  assert.match(u.one('.git-status').textContent, /no available Git worktree.*Previous observation is stale/); assert.equal(u.one('.git-status-details pre').textContent, 'E_NO_WORKTREE');
});

for (const code of ['E_GIT_FAILED', 'E_CLI_FAILED', 'E_CLI_PROTOCOL', 'cli-unavailable']) test(`${code} keeps the red status with its code behind Details`, async t => {
  const u = setup(t, () => refused(code, target(), 'Git read failed')); await u.show({ ...target(), work: 'directory' });
  const status = u.one('.git-status');
  assert.equal(status.textContent, 'Git read failed'); assert.ok(status.classList.contains('error'));
  assert.equal(u.one('.git-status-details').hidden, false); assert.equal(u.one('.git-status-details pre').textContent, code);
  assert.equal(u.one('.git-empty').hidden, true); assert.equal(u.one('.git-empty-note').hidden, true); assert.equal(u.one('.git-toolbar').hidden, false);
  assert.equal(u.one('.git-footer').hidden, false, 'Refresh to retry');
});

test('the Git CSS uses semantic tokens only and leaves keyboard focus to the global rule (no per-component rings)', () => {
  assert.doesNotMatch(instanceGitCSS, /#[0-9a-f]{3,8}\b|color-mix|opacity/i);
  assert.doesNotMatch(instanceGitCSS, /focus-visible|outline/);
  assert.match(instanceGitCSS, /\.git-dashed \{[^}]*border:1px dashed var\(--border\); border-radius:9px/);
  assert.match(instanceGitCSS, /\.git-card \{ border:1px solid var\(--border\); border-radius:9px; \}/);
  assert.match(instanceGitCSS, /\.forge-state \{[^}]*background:var\(--tag-bg\); color:var\(--fg\)/);
});
