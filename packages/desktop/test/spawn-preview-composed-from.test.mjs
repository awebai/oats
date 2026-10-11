// Why each spawn-preview module is there (kernel #328, feature preview-composed-from): the kernel's
// modules[].composedFrom, "soul" | "workspace", projected only from a CLI that reports the feature and
// shown in the dialog as a reason tag beside the source. The kernel documents are a REAL capture
// (test/fixtures/composed-from, provenance.json): soul dev declares acme-tool and acme.own, the
// workspace gives acme.ws (defaults.capabilities) and chat (the messaging slot).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { cliSpawnPreview } from '../../client/spawn-preview-cli.mjs';
import { createSpawnPreviewBoundary } from '../server/spawn-preview.mjs';
import { proxySpawnPreview } from '../spawn-preview-proxy.mjs';
import { previewData, previewComposedFrom } from '../../client/spawn-preview-contract.mjs';
import { composePreviewModules, moduleWhyText, spawnDialogCSS } from '../renderer/spawn-dialog.mjs';
import { harnessList } from '../../client/harness-names.mjs';
import { TEXT_PAIRS } from '../renderer/contrast-inventory.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/composed-from/${name}.json`, import.meta.url), 'utf8'));
const provenance = fixture('provenance'), version = fixture('version'), captured = fixture('preview');
const DEPLOYMENT = '/fixture/base/deployment', ROOT = `${DEPLOYMENT}/agents`;
const selector = { soul: 'dev', agentsRoot: ROOT }, target = { workspace: 'fixture', context: DEPLOYMENT, selector };
const CLI = { ok: true, bin: '/fixture/oats', version: version.version, spawnPreviewApi: version.spawnPreviewApi, spawnApplyApi: version.spawnApplyApi,
  workspaceApi: version.workspaceApi, features: [...version.features], harnesses: harnessList(version), sessionBackends: [...version.sessionBackends],
  launchOptions: [...version.launchOptions], remote: [...version.remote] };
const WITHOUT = { ...CLI, features: CLI.features.filter(f => f !== 'preview-composed-from') };
const kernel = () => structuredClone(captured.result);
const reasons = modules => Object.fromEntries(modules.map(m => [m.name, m.composedFrom]));

/** The boundary replaying `result` through the real adapter for `cli`; returns the response and the argv the Desktop sent. */
async function read(result = kernel(), cli = CLI) {
  let argv;
  const boundary = createSpawnPreviewBoundary({ invoke: (c, opts) => cliSpawnPreview(c, opts, { env: {}, exec: (_bin, a, _o, callback) => {
    argv = a; callback(null, JSON.stringify({ schemaVersion: 1, ok: true, result }));
  } }) });
  const context = () => ({ workspace: { id: 'fixture', scope: DEPLOYMENT }, cli: structuredClone(cli), agents: [{ name: 'dev', agentsRoot: ROOT, work: 'directory' }], instances: [] });
  return { response: await boundary({ action: 'preview', selector, choices: {} }, context), argv };
}
function proxied(body) {
  const renderer = 'file:///fixture/index.html', frame = { url: renderer }, event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  const connection = { base: 'http://localhost:4820', wsId: 'fixture', allowedWs: new Set(['fixture']), epoch: 0, transition: false };
  return proxySpawnPreview(event, '/api/workspace-spawn-preview', { method: 'POST', body: { action: 'preview', selector, choices: {} } },
    { rendererURL: renderer, connection: () => connection, fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) }).then(r => r.body);
}

test('the capture is the real kernel with the feature, and the Desktop\'s argv is the one it was captured with', async () => {
  assert.ok(version.features.includes('preview-composed-from')); assert.equal(previewComposedFrom(CLI), true);
  assert.equal(previewComposedFrom(WITHOUT), false); assert.equal(previewComposedFrom(null), false); assert.equal(previewComposedFrom({ features: 'preview-composed-from' }), false);
  assert.deepEqual(reasons(captured.result.modules), { 'acme-tool': 'soul', 'acme.own': 'soul', 'acme.ws': 'workspace', chat: 'workspace' });
  const { argv } = await read();
  const run = provenance.files.preview.argv.slice(1).map(v => v.replaceAll('<base>', '/fixture/base'));
  const withoutPreview = a => a.filter(v => v !== '--preview');
  assert.deepEqual(withoutPreview(argv), withoutPreview(run));
});

test('modulesOf keeps "soul" and "workspace" from a CLI with the feature; the proxy re-validates the projection unchanged', async () => {
  const { response } = await read();
  assert.equal(response.status, 'available');
  assert.deepEqual(response.data.modules.map(m => [m.name, m.layer, m.composedFrom]),
    [['acme-tool', null, 'soul'], ['acme.own', null, 'soul'], ['acme.ws', null, 'workspace'], ['chat', 'messaging', 'workspace']]);
  for (const m of response.data.modules) assert.deepEqual(Object.keys(m), ['name', 'layer', 'from', 'composedFrom']);
  const through = await proxied(response);
  assert.equal(through.status, 'available'); assert.deepEqual(through.data.modules, response.data.modules);
  // The renderer's own re-validation (spawn-dialog) and the apply's (spawnPreparedData) read the projection the same way.
  assert.deepEqual(previewData(response.data, target).modules, response.data.modules);
});

test('the feature gate: without preview-composed-from, no composedFrom reaches previewData, even when the kernel sends one', async () => {
  const { response } = await read(kernel(), WITHOUT);
  assert.equal(response.status, 'available');
  for (const m of response.data.modules) { assert.deepEqual(Object.keys(m), ['name', 'layer', 'from']); assert.equal(Object.hasOwn(m, 'composedFrom'), false); }
  // previewData itself: the kernel's document without the option projects no reason.
  assert.equal(previewData(kernel(), target).modules.some(m => Object.hasOwn(m, 'composedFrom')), false);
  assert.deepEqual(reasons(previewData(kernel(), target, { composedFrom: true }).modules), reasons(captured.result.modules));
});

test('any other value, or none, is dropped without refusing the row: the preview still projects every module', async () => {
  const values = ['team:eng', 'Soul', 'WORKSPACE', 'workspace ', '', null, 1, true, {}, ['soul']];
  for (const value of values) {
    const doc = kernel(); doc.modules[0].composedFrom = value;
    const { response } = await read(doc);
    assert.equal(response.status, 'available', JSON.stringify(value));
    assert.deepEqual(response.data.modules.map(m => m.name), captured.result.modules.map(m => m.name), 'every row projects');
    assert.equal(Object.hasOwn(response.data.modules[0], 'composedFrom'), false, `${JSON.stringify(value)} is dropped`);
    assert.equal(response.data.modules[1].composedFrom, 'soul', 'the other rows keep theirs');
  }
  const missing = kernel(); delete missing.modules[2].composedFrom;
  const { response } = await read(missing);
  assert.equal(response.status, 'available');
  assert.deepEqual(reasons(response.data.modules), { 'acme-tool': 'soul', 'acme.own': 'soul', 'acme.ws': undefined, chat: 'workspace' });
  assert.equal(Object.hasOwn(response.data.modules[2], 'composedFrom'), false);
  // The projection's side: its keys stay exact (composedFrom optional); a hostile value is dropped, an extra key still refuses.
  const served = (await read()).response;
  const hostile = structuredClone(served); hostile.data.modules[0].composedFrom = 'team:eng';
  const through = await proxied(hostile);
  assert.equal(through.status, 'available'); assert.equal(Object.hasOwn(through.data.modules[0], 'composedFrom'), false);
  const extra = structuredClone(served); extra.data.modules[0].why = 'soul';
  assert.equal((await proxied(extra)).reason.code, 'E_CLI_PROTOCOL');
});

test('the dialog tags each row with why it is there, beside its source, in Core and Capabilities alike; no tag when the preview does not say', async () => {
  const dom = new JSDOM('<body></body>'), doc = dom.window.document;
  const { response } = await read();
  const { core, caps } = composePreviewModules(doc, response.data.modules);
  const rows = [...caps[1].querySelectorAll('.spawn-cap-row')];
  // The module on line 1, its chips (source, then reason) as one group on line 2.
  const shape = parent => [...parent.children].map(c => c.className === 'spawn-cap-tags' ? [...c.children].map(t => [t.className, t.textContent]) : [c.className, c.textContent]);
  assert.deepEqual(rows.map(shape), [
    [['mono', 'acme-tool'], [['spawn-cap-source', 'ws · latest'], ['spawn-cap-why', 'Soul']]],
    [['mono', 'acme.own'], [['spawn-cap-source', 'ws · latest'], ['spawn-cap-why', 'Soul']]],
    [['mono', 'acme.ws'], [['spawn-cap-source', 'ws · latest'], ['spawn-cap-why', 'Workspace default']]],
  ], 'chat fills the messaging slot: Core\'s only');
  assert.equal(caps[0].textContent, 'Capabilities · 3');
  // The reason is part of the row's accessible text: plain text, never hidden from assistive technology.
  for (const row of rows) { assert.equal(row.querySelector('[aria-hidden]'), null); assert.ok(row.textContent.endsWith(row.querySelector('.spawn-cap-why').textContent)); }
  // A core row: the same chips, its reason without the slot (the row already names it).
  assert.deepEqual([...core[1].querySelectorAll('.spawn-core-row')].map(row => [...row.children].map(c => c.className === 'spawn-core-module' ? shape(c) : [c.className, c.textContent])), [
    [['spawn-core-layer', 'Knowledge'], ['muted', 'None']],
    [['spawn-core-layer', 'Messaging'], [['mono', 'chat'], [['spawn-cap-source', 'ws · latest'], ['spawn-cap-why', 'Workspace default']]]],
    [['spawn-core-layer', 'Tasks'], ['muted', 'None']]]);
  // An older CLI (or a dropped value): the rows carry no composedFrom, and no tag is guessed.
  const older = composePreviewModules(doc, (await read(kernel(), WITHOUT)).response.data.modules);
  assert.equal(older.caps[1].querySelectorAll('.spawn-cap-row').length, 3); assert.equal(older.caps[1].querySelector('.spawn-cap-why'), null);
  assert.equal(older.core[1].querySelector('.spawn-cap-why'), null);
  dom.window.close();
});

test('moduleWhyText: Soul; Workspace default (a core row names its own slot); nothing otherwise', () => {
  assert.equal(moduleWhyText({ composedFrom: 'soul', layer: null }), 'Soul');
  assert.equal(moduleWhyText({ composedFrom: 'soul', layer: 'messaging' }), 'Soul');
  assert.equal(moduleWhyText({ composedFrom: 'workspace', layer: null }), 'Workspace default');
  for (const layer of ['knowledge', 'messaging', 'tasks', 'tools']) assert.equal(moduleWhyText({ composedFrom: 'workspace', layer }), 'Workspace default');
  for (const m of [{}, { composedFrom: 'team:eng' }, { composedFrom: null }, null, undefined]) assert.equal(moduleWhyText(m), '');
});

test('the reason tag reuses the source chip\'s muted tag pair (--muted on --tag-bg), the pair theme-contrast checks', () => {
  const rule = spawnDialogCSS.match(/^\.spawn-cap-source, \.spawn-cap-why \{([^}]*)\}/m);
  assert.ok(rule, 'one rule for both tags');
  assert.match(rule[1], /background:var\(--tag-bg\); color:var\(--muted\);/);
  assert.equal(spawnDialogCSS.match(/\.spawn-cap-why/g).length, 1, 'no rule, colour or opacity of its own');
  // A long name beside a package source and a reason: the name always has line 1 to itself and the tags
  // wrap as a left-aligned group on line 2, at every width (never right-justified chips that drop only
  // for long names). Core rows share the grammar inside their slot column.
  assert.match(spawnDialogCSS, /\.spawn-cap-row, \.spawn-core-module \{ display:flex; flex-direction:column; align-items:flex-start;/);
  assert.match(spawnDialogCSS, /\.spawn-core-row \.mono, \.spawn-cap-row \.mono, [^{]*\{ max-width:100%; min-width:0; overflow-wrap:anywhere; \}/);
  // The inventory theme-contrast.test.mjs holds every palette to (renderer/contrast-inventory.mjs).
  assert.ok(TEXT_PAIRS.some(([fg, bg]) => fg === 'muted' && bg === 'tag-bg'), 'muted on tag-bg is in the computed contrast inventory');
});
