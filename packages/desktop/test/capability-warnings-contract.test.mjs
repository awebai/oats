// Capability warnings (OATS 0.49.0, hook-event-unsupported; docs/desktop-cli-api.md § "Capability warnings"):
// the tolerant projections (capability-warnings-contract.mjs), the capability show decoder that carries them
// and the workspace status rows that may name a capability and a path. No DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { warningsOf, warningOf, previewWarningsOf, warningsShown, WARNINGS_SHOWN, WARNING_LINES } from '../../client/capability-warnings-contract.mjs';
import { capabilityShowData, capabilityFileData } from '../../client/capability-show-contract.mjs';
import { workspaceStatusData } from '../../client/deployment-data.mjs';
import { DETAIL_WITHHELD } from '../../client/display-text.mjs';

const KERNEL = { code: 'hook-event-unsupported', capability: 'acme.tool', path: 'github.com/acme/agents:capabilities/acme-tool/oats.json#/hooks/on-merge',
  message: 'capability acme.tool declares hook "on-merge", which this kernel does not run; it is ignored (this kernel runs soul-scaffold, spawn, retire, launch)' };

test('warningsOf: absent, not a list and [] read as none', () => {
  for (const v of [undefined, null, 'x', 5, {}, []]) assert.deepEqual(warningsOf(v), []);
});

test('warningsOf: the kernel entry, verbatim', () => {
  assert.deepEqual(warningsOf([KERNEL]), [KERNEL]);
});

test('warningsOf: malformed entries are skipped, never refusing the list', () => {
  assert.deepEqual(warningsOf([null, 5, 'text', { message: 5 }, {}, [], { message: '' }, KERNEL]), [KERNEL]);
  assert.equal(warningOf({ message: 5 }), null);
  // Only a capability name is kept (it is shown and looked up); other fields fall to null.
  assert.deepEqual(warningOf({ message: 'm', capability: '../x', code: 7, path: null }), { code: null, capability: null, path: null, message: 'm' });
  assert.equal(warningOf({ message: 'm', capability: 'a'.repeat(129) }).capability, null);
});

test('warningsShown: 40 warnings → 32 shown and 8 more', () => {
  const many = warningsOf(Array.from({ length: 40 }, (_, i) => ({ ...KERNEL, message: `warning ${i}` })));
  assert.equal(many.length, 40);
  const { shown, more } = warningsShown(many);
  assert.equal(WARNINGS_SHOWN, 32);
  assert.equal(shown.length, 32); assert.equal(more, 8);
  assert.equal(shown[31].message, 'warning 31');
  assert.deepEqual(warningsShown(null), { shown: [], more: 0 });
});

test('warningsOf: control and bidi characters are filtered; a C0 control or a secret withholds the whole text', () => {
  const [bidi] = warningsOf([{ ...KERNEL, message: 'evil‮txt.exe hook' }]);
  assert.equal(bidi.message, 'evil�txt.exe hook');
  const [bell] = warningsOf([{ ...KERNEL, message: 'ring \u0007 the bell' }]);
  assert.equal(bell.message, DETAIL_WITHHELD, 'a C0 control withholds the whole text');
  const [secret] = warningsOf([{ ...KERNEL, message: 'token: abc123def' }]);
  assert.equal(secret.message, DETAIL_WITHHELD);
  const [path] = warningsOf([{ ...KERNEL, path: 'https://user:pw@host/x:oats.json#/hooks/x' }]);
  assert.equal(path.path, DETAIL_WITHHELD);
  const [lines] = warningsOf([{ ...KERNEL, message: 'one\ntwo\tthree' }]);
  assert.equal(lines.message, 'one two three', 'one display line');
});

test('warningsOf: projecting twice equals projecting once (the server projects, the renderer projects the relay)', () => {
  const raw = [KERNEL, { ...KERNEL, message: 'a‮b' }, { message: 'token=xyz' }, null, { message: 'x', capability: 'bad name' }];
  const once = warningsOf(raw);
  assert.deepEqual(warningsOf(structuredClone(once)), once);
});

test('previewWarningsOf: multi-line, long lines, the line bound and non-strings', () => {
  assert.deepEqual(previewWarningsOf(undefined), []);
  assert.deepEqual(previewWarningsOf([5, null, {}, '', '\n\n', 'one\r\ntwo\rthree\nfour']), ['one\ntwo\nthree\nfour']);
  const long = 'x'.repeat(1000);
  assert.deepEqual(previewWarningsOf([long]), [long], 'a 1000-character line is kept whole');
  const tall = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const [kept] = previewWarningsOf([tall]);
  assert.equal(kept.split('\n').length, WARNING_LINES);
  assert.equal(kept.split('\n').at(-1), 'line 31');
  assert.deepEqual(previewWarningsOf(['ok\ntoken: abc123def']), [`ok\n${DETAIL_WITHHELD}`], 'each line is filtered on its own');
  const once = previewWarningsOf(['a\nb', 'c‮d']);
  assert.deepEqual(previewWarningsOf(once), once, 'idempotent');
});

/* ── capabilities show ─────────────────────────────────────────────────── */
const commit = 'c0ffee1'.padEnd(40, '0');
const show = (over = {}) => ({ capabilityShowApi: 1, name: 'acme.tool', kind: 'member', repoKey: 'github.com/acme/agents', package: null, version: null, commit,
  path: 'capabilities/acme-tool', inject: null, skills: [], problems: [], ...over });
const selector = { name: 'acme.tool', kind: 'member', repoKey: 'github.com/acme/agents' };

test('capabilityShowData: warnings are projected, and never a reason to refuse the answer', () => {
  assert.deepEqual(capabilityShowData(show(), { selector }).warnings, [], 'an older kernel: no warnings key');
  assert.deepEqual(capabilityShowData(show({ warnings: [KERNEL] }), { selector }).warnings, [KERNEL]);
  for (const bad of [null, 'x', 5, { a: 1 }, [null, 5, { message: 5 }, {}]]) {
    const data = capabilityShowData(show({ warnings: bad }), { selector });
    assert.ok(data, `${JSON.stringify(bad)} does not refuse the answer`);
    assert.deepEqual(data.warnings, []);
  }
  // The strict half is unchanged: a bad field still refuses the whole answer, warnings or not.
  assert.equal(capabilityShowData(show({ warnings: [KERNEL], problems: 'x' }), { selector }), null);
});

test('capabilityShowData: the server\'s output, relayed, decodes to itself (warnings included)', () => {
  const server = capabilityShowData(show({ warnings: [KERNEL, { ...KERNEL, message: 'a‮b' }, { message: 5 }] }), { selector });
  const renderer = capabilityShowData(structuredClone(server), { selector });
  assert.deepEqual(renderer, server);
  assert.equal(renderer.warnings.length, 2);
});

test('capabilityShowData: warnings are bounded to 1000 kept', () => {
  const data = capabilityShowData(show({ warnings: Array.from({ length: 1200 }, () => KERNEL) }), { selector });
  assert.equal(data.warnings.length, 1000);
});

test('capabilityFileData: a --file answer with warnings reads as before (they are the listing\'s to show)', () => {
  const answer = { capabilityShowApi: 1, name: 'acme.tool', kind: 'member', commit, file: { path: 'inject.md', bytes: 2, text: 'hi', binary: false, truncated: false }, warnings: [KERNEL] };
  const data = capabilityFileData(answer, { selector, path: 'inject.md' });
  assert.ok(data); assert.equal(Object.hasOwn(data, 'warnings'), false);
});

/* ── workspace status ──────────────────────────────────────────────────── */
const status = warnings => ({ schemaVersion: 1, ok: true, result: { workspaceStatusApi: 1, workspace: { name: 'acme', key: 'github.com/acme/agents', local: '/ws/oats-local.yaml' },
  members: [], packages: [], declaredPackages: [], unsynced: [], stale: [], external: [], problems: [], ...(warnings === undefined ? {} : { warnings }) } });

test('workspaceStatusData: a warning keeps a string capability and path, and drops either when it is not text', () => {
  assert.deepEqual(workspaceStatusData(status([KERNEL]), '/ws').warnings, [KERNEL]);
  assert.deepEqual(workspaceStatusData(status([{ ...KERNEL, capability: 5, path: { x: 1 } }]), '/ws').warnings, [{ code: KERNEL.code, message: KERNEL.message }]);
  assert.deepEqual(workspaceStatusData(status([{ ...KERNEL, capability: null, path: 'a\0b' }]), '/ws').warnings, [{ code: KERNEL.code, message: KERNEL.message }]);
  assert.deepEqual(workspaceStatusData(status([{ ...KERNEL, path: 'x'.repeat(9000) }]), '/ws').warnings, [{ code: KERNEL.code, capability: KERNEL.capability, message: KERNEL.message }]);
  assert.deepEqual(workspaceStatusData(status(undefined), '/ws').warnings, [], 'absent stays none');
});

test('workspaceStatusData: the earlier warning keys stay strict', () => {
  assert.equal(workspaceStatusData(status([KERNEL]), '/ws').warnings.length, 1, 'the document itself reads');
  for (const key of ['code', 'message', 'label', 'soul', 'repoKey', 'kind', 'id', 'remedy', 'entry']) {
    assert.throws(() => workspaceStatusData(status([{ ...KERNEL, [key]: 5 }]), '/ws'), { code: 'E_CLI_PROTOCOL' }, key);
  }
  assert.throws(() => workspaceStatusData(status([null]), '/ws'), { code: 'E_CLI_PROTOCOL' });
});
