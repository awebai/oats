// Inert DTO/DOM tests plus static source/CSS reads. No CLI, server, native window or Git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextPanelCSS } from '../renderer/context-panel.mjs';
import { JSDOM } from 'jsdom';
import { createInstanceGitPanel, instanceGitCSS } from '../renderer/instance-git.mjs';
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
  summary: { changed: 2, renamed: 0, copied: 0, unmerged: 0, untracked: 0 }, files: [file(), file({ id: secondId, path: 'other.txt' })], notes: ['No upstream configured.'] });
const diff = (f = file()) => ({ instanceGitApi: 1, observation: observation(), file: f, against: oid, binary: false, bytes: 8, truncated: false, limit: INSTANCE_DIFF_LIMIT,
  patch: '-old\n+X\n', readOnly: { helpers: 'disabled', optionalLocks: 'off', objectsWritten: 0 } });
const available = (value, t = target()) => ({ instanceGitApi: 1, minimumVersion: '0.24.7', status: 'available', target: t, data: value, reason: null });
const refused = (code = 'E_USAGE', t = target()) => ({ instanceGitApi: 1, minimumVersion: '0.24.7', status: 'unavailable', target: t, data: null, reason: { code, message: 'Read unavailable' } });
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
  assert.match(u.text(), /actual-branch/); assert.match(u.text(), /Recorded branchrecorded-branch/);
  // Nothing reported is one plain line, never rows of "Not reported".
  assert.match(u.text(), /Upstream comparisonNo upstream branch is reported\./); assert.doesNotMatch(u.text(), /Not reported/);
  assert.match(u.text(), /Base reforigin\/mainBase sourceorigin\/HEAD/);
  // W6 (design): the heading is plain "Changes" (was "Changes · 2"); the branch says its base, repo and cleanliness.
  assert.equal(u.one('.git-changes-section h3').textContent, 'Changes'); assert.equal(u.buttons().length, 2);
  assert.equal(u.one('.git-head-aside').textContent, 'worktree'); assert.equal(u.one('.git-ahead').textContent, '↑2 from main');
  assert.equal(u.one('.git-branch-sub').textContent, 'repo · clean except 2 files'); assert.equal(u.one('.git-branch-sub').title, '/fixture/work');
  assert.deepEqual(u.buttons().map(b => [b.querySelector('.git-letter').textContent, b.querySelector('.git-file-path').textContent]), [['M', 'file.txt'], ['M', 'other.txt']]);
  assert.match(u.one('.git-github').textContent, /installed OATS CLI does not report a remote/); assert.equal(u.one('a'), null);
});

test('typed unavailable and malformed data are not a healthy empty observation; explicit refresh is required after failure', async t => {
  const u = setup(t, () => refused()); await u.show();
  assert.match(u.text(), /Read unavailable.*E_USAGE/); assert.equal(u.buttons().length, 0);
  await u.show(); assert.equal(u.calls.length, 1);
  u.read(() => available({ ...data(), files: [] })); await u.view.refresh();
  assert.match(u.text(), /invalid/); assert.doesNotMatch(u.text(), /No changes reported/);
  u.read(() => available({ ...data(), files: [], summary: { changed: 0, renamed: 0, copied: 0, unmerged: 0, untracked: 0 } }));
  await u.view.refresh(); assert.match(u.text(), /No changes reported in this observation/);
});

test('a recorded healthy instance.git cannot turn missing K1 into clean or zero changes', async t => {
  const u = setup(t, () => refused());
  await u.show({ ...target(), git: { dirty: 0, ahead: 0, behind: 0, branch: 'forged-clean' } });
  assert.match(u.text(), /Read unavailable.*E_USAGE/);
  // W6: with no observation the Changes section is hidden (replaces "the heading stays plain Changes").
  assert.equal(u.one('.git-facts').textContent, ''); assert.equal(u.one('.git-changes-section').hidden, true);
  assert.doesNotMatch(u.text(), /No changes reported|Changes · 0|forged-clean|up.to.date|clean/i);
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
  const u = setup(t); await u.show(); const b = u.one('.git-toolbar button');
  await u.show(target('/team/agents', 'host-b'));
  b.dispatchEvent(new u.dom.window.Event('click')); await u.view.refresh();
  assert.equal(u.calls.length, 1); assert.match(u.text(), /Remote Git inspection is unavailable/);
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
    d.files.push(file({ id: 'e'.repeat(24), path: 'third.txt', additions: 5, deletions: 2, binary: false })); d.summary.changed = 3; return d; };
  const u = setup(t, (_ws, body) => available(body.action === 'git' ? counted() : diff())); u.host.id = 'context-panel'; u.host.className = 'context-panel';
  const style = u.doc.createElement('style'); style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8') + contextPanelCSS;
  u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme;
  await u.show(); u.buttons()[0].click(); await tick();
  const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, painted, fg, bg] of [
    // W6 (design): the section labels, branch facts, status letters and links sit on the panel surface (replaces the .git-card pairs).
    ['.git-head', '#context-panel', 'muted', 'surface'], ['.git-branch-line', '#context-panel', 'fg', 'surface'],
    ['.git-branch-sub', '#context-panel', 'muted', 'surface'], ['.git-more dt', '#context-panel', 'muted', 'surface'],
    ['.git-file:not([aria-pressed=true]) .git-letter', '#context-panel', 'muted', 'surface'], ['button.git-link', '#context-panel', 'accent', 'surface'],
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
  u.read(() => available(data())); u.one('.git-toolbar button').click(); await tick(); await tick();
  assert.equal(u.one('.git-status-details').hidden, true, 'a good read clears the code');
  assert.equal(u.one('.git-github').hidden, false); assert.match(u.text(), /Observed .* ago|Observed just now|Observed \d{4}-/);
});
