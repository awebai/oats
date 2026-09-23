// No server/CLI/GUI is launched. Exercise the real request + execFile seams,
// including the source-extracted HTTP callback and its production guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { cliCatalog, cliList, cliCapability } from '../cli-adapter.mjs';
import { createCatalogBoundary, CATALOG_MINIMUM_VERSION } from '../server/catalog.mjs';
import { capabilityRequest, createInventoryBoundary } from '../server/capabilities.mjs';

const cli = { ok: true, bin: '/installed/oats', version: '0.24.6' }; // deliberately no operationsApi
const workspace = { id: '/team', scope: '/team' };
const member = '/team/a space; $(literal)';
const agents = [{ name: 'dev', agentsRoot: `${member}/agents` }];
const envelope = result => ({ schemaVersion: 1, ok: true, result });
const failure = code => ({ schemaVersion: 1, ok: false, error: { code, message: 'SECRET child diagnostic' } });
const description = () => ({
  schemaVersion: 1, catalog: { origin: 'override', file: '/installed/catalog.json', kernelVersion: '0.24.6' },
  packages: [{ package: 'oats.dev', url: 'https://example.invalid/dev.git', ref: null, path: 'oats', acquire: { argv: ['oats', 'install', 'oats.dev'] } }],
  capabilityAliases: [{ capability: 'oats.review', package: 'oats.dev', capabilityInPackage: 'oats.review', via: 'alias', available: true }],
  notes: ['Catalog identity grants no executable trust'],
});
const inventory = () => ({
  packages: [{ package: 'oats.dev', version: '1.0.0', level: member, source: null, path: null, commit: null, integrity: null, locked: true, dependencies: [], capabilities: ['oats.review'] }],
  capabilities: [{ capability: 'oats.review', version: null, package: 'oats.dev', level: member, trusted: null, installed: true, integrity: null, executableSurface: { commands: [], hooks: [], environment: [] }, status: 'untrusted' }],
  legacy: [{ file: '/team/oats-lock.json', level: '/team', lockfileVersion: 1, capabilities: ['legacy.notes'] }],
});
const options = { workspace, cli, agents, localCwd: '/server/local' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const asExec = result => (_bin, _argv, _opts, done) => done(null, JSON.stringify(envelope(result)));
function assertUnavailable(result, code) {
  assert.deepEqual(result, {
    catalogApi: 1, scope: 'local-cli', status: 'unavailable', minimumVersion: '0.24.6', description: null,
    reason: { code, message: result.reason.message },
  });
  assert.ok(result.reason.message.length > 0);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
}

test('read adapters fix argv/cwd, use no shell, and bound timeout/output', async () => {
  for (const [read, args, expected] of [
    [cliCatalog, { localCwd: '/server/local' }, ['catalog', '--json']],
    [cliList, { localCwd: member, context: member }, ['list', '--dir', member, '--json']],
  ]) {
    let calls = 0;
    const result = await read(cli.bin, args, { timeout: Infinity, exec(bin, argv, opts, done) {
      calls++;
      assert.equal(bin, cli.bin); assert.deepEqual(argv, expected); assert.equal(opts.cwd, args.localCwd);
      assert.equal(opts.shell, false); assert.equal(opts.encoding, 'utf8'); assert.equal(opts.timeout, 15_000);
      assert.equal(opts.maxBuffer, 4 * 1024 * 1024); assert.equal(Object.hasOwn(opts, 'env'), false);
      done(null, JSON.stringify(envelope({ genuine: true })));
    } });
    assert.deepEqual(result, envelope({ genuine: true })); assert.equal(calls, 1);
  }
});

test('read adapters always resolve typed failures, never accept success on failed exit or expose diagnostics', async () => {
  const executions = [
    [(_b, _a, _o, done) => done(null, 'SECRET not JSON'), 'E_CLI_PROTOCOL'],
    [(_b, _a, _o, done) => done(new Error('SECRET'), JSON.stringify(envelope({})), 'SECRET stderr'), 'E_CLI_FAILED'],
    [(_b, _a, _o, done) => done({ code: 'ENOENT' }, ''), 'E_CLI_FAILED'],
    [(_b, _a, _o, done) => done({ killed: true }, JSON.stringify(envelope({}))), 'E_CLI_TIMEOUT'],
    [(_b, _a, _o, done) => done({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }, JSON.stringify(envelope({}))), 'E_CLI_OUTPUT_LIMIT'],
    [() => { throw new Error('SECRET synchronous spawn exception'); }, 'E_CLI_FAILED'],
    [(_b, _a, _o, done) => done(new Error('exit 1'), JSON.stringify(failure('invalid-lock'))), 'invalid-lock'],
    // Workspace model v2 removed `list`/`catalog`: the kernel answers a typed
    // E_UNKNOWN_COMMAND (details.removed/replacement). It is an unsupported read
    // (E_USAGE), not a retry-shaped E_CLI_FAILED, and its replacement hint never
    // leaks through as UI text.
    [(_b, _a, _o, done) => done(new Error('exit 1'), JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_UNKNOWN_COMMAND', message: 'SECRET removed', details: { removed: 'list', replacement: 'SECRET oats capabilities' } } })), 'E_USAGE'],
    [(_b, _a, _o, done) => done(null, JSON.stringify(failure('SECRET'))), 'E_CLI_FAILED'],
  ];
  for (const read of [cliCatalog, cliList]) for (const [exec, code] of executions) {
    const result = await read(cli.bin, read === cliList ? { context: member, localCwd: member } : { localCwd: member }, { exec });
    assert.equal(result.schemaVersion, 1); assert.equal(result.ok, false); assert.equal(result.error.code, code);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
  // The opt-in strict exit policy must not silently change existing operations.
  const old = await cliCapability(cli.bin, { action: 'inspect', context: member }, {
    exec: (_b, _a, _o, done) => done(new Error('exit 1'), JSON.stringify(envelope({ oldPolicy: true }))),
  });
  assert.deepEqual(old, envelope({ oldPolicy: true }));
});

test('read adapter options cannot supply env, bin, source, extra argv or option-shaped paths', async () => {
  for (const read of [cliCatalog, cliList]) {
    const base = read === cliList ? { localCwd: member, context: member } : { localCwd: member };
    for (const args of [null, [], {}, { ...base, localCwd: '--dir' }, { ...base, localCwd: '/bad\0path' },
      ...['env', 'bin', 'source', 'path', 'argv', 'server', 'home'].map(key => ({ ...base, [key]: 'forbidden' }))]) {
      const result = await read(cli.bin, args, { exec: assert.fail });
      assert.equal(result.ok, false); assert.equal(result.error.code, 'E_BAD_ARGS');
    }
    assert.equal((await read('oats', base, { exec: assert.fail })).error.code, 'E_BAD_ARGS');
  }
  for (const context of [undefined, null, '--server', '/bad\0path']) {
    assert.equal((await cliList(cli.bin, { localCwd: member, context }, { exec: assert.fail })).error.code, 'E_BAD_ARGS');
  }
});

test('catalog floor uses released semver and outer acceptance, without operationsApi', async () => {
  assert.equal(CATALOG_MINIMUM_VERSION, '0.24.6');
  const read = createCatalogBoundary({ invoke: assert.fail });
  for (const state of [null, { ...cli, ok: false }, { ...cli, ok: 'true' }, { ...cli, bin: 'oats' }]) {
    assertUnavailable(await read({}, { cli: state, localCwd: member }), 'cli-unavailable');
  }
  for (const version of ['0.24.5', '0.23.99', '0.24.6-rc.1', '0.24.7-beta', 'garbage', undefined]) {
    assertUnavailable(await read({}, { cli: { ...cli, version }, localCwd: member }), 'cli-no-catalog');
  }
  const data = description();
  for (const version of ['0.24.6', '0.24.6+build.1', '0.24.7']) {
    const result = await read({}, { cli: { ...cli, version }, localCwd: member, invoke: async () => envelope(data) });
    assert.deepEqual(result, { catalogApi: 1, scope: 'local-cli', status: 'available', minimumVersion: '0.24.6', description: data, reason: null });
  }
  assertUnavailable(await read({}, { cli: { ...cli, ok: false, version: '0.25.0' }, localCwd: member }), 'cli-unavailable');
});

test('catalog accepts no arguments and validates minimal landed shape without inventing unknown facts', async () => {
  const read = createCatalogBoundary({ invoke: assert.fail });
  for (const body of [null, [], '', 1, ...['source', 'path', 'env', 'bin', 'argv', 'context', 'ws', 'server'].map(k => ({ [k]: 'x' }))]) {
    await assert.rejects(read(body, { cli, localCwd: member }), { code: 'E_BAD_ARGS' });
  }
  const data = description(); data.packages[0].url = null; data.packages[0].path = null;
  data.packages[0].signatures = null; data.capabilityAliases[0].available = null;
  const result = await read({}, { cli, localCwd: member, invoke: async () => envelope(data) });
  assert.strictEqual(result.description, data);
  assert.equal(Object.hasOwn(result.description.packages[0], 'exports'), false);
  for (const change of [
    d => { d.schemaVersion = 2; }, d => { d.catalog.origin = 'remote'; }, d => { delete d.catalog.file; },
    d => { d.packages = null; }, d => { d.packages[0].acquire.argv.push('--trust'); }, d => { d.packages[0].ref = 2; },
    d => { d.capabilityAliases[0].available = 'true'; }, d => { d.capabilityAliases = [{}]; }, d => { d.notes = 'SECRET'; },
  ]) {
    const bad = description(); change(bad);
    assertUnavailable(await read({}, { cli, localCwd: member, invoke: async () => envelope(bad) }), 'E_CLI_PROTOCOL');
  }
});

test('catalog missing command, failed child, malformed envelope and rejection are recoverable unavailable', async () => {
  for (const returned of [failure('E_USAGE'), failure('invalid-source'), null, { ok: true, result: description() }]) {
    const read = createCatalogBoundary({ invoke: async () => returned });
    assertUnavailable(await read({}, { cli, localCwd: member }), 'E_CLI_FAILED');
  }
  for (const exec of [
    (_b, _a, _o, done) => done(new Error('SECRET'), JSON.stringify(envelope(description()))),
    (_b, _a, _o, done) => done(new Error('SECRET'), 'unknown command catalog', 'SECRET'),
  ]) {
    const read = createCatalogBoundary({ invoke: (bin, args) => cliCatalog(bin, args, { exec }) });
    assertUnavailable(await read({}, { cli, localCwd: member }), 'E_CLI_FAILED');
  }
});

test('catalog coalesces pending success/rejection only, releases each flight and recovers', async () => {
  for (const reject of [false, true]) {
    let calls = 0; const pending = deferred();
    const read = createCatalogBoundary({ invoke: () => { calls++; return calls === 1 ? pending.promise : envelope(description()); } });
    const requests = Array.from({ length: 8 }, () => read({}, { cli, localCwd: member }));
    await tick(); assert.equal(calls, 1);
    if (reject) pending.reject(new Error('SECRET')); else pending.resolve(envelope(description()));
    const results = await Promise.all(requests);
    for (const r of results) assert.deepEqual(r, results[0]);
    assert.equal(results[0].status, reject ? 'unavailable' : 'available');
    assert.equal((await read({}, { cli, localCwd: member })).status, 'available');
    assert.equal(calls, 2, 'no response cache, including errors');
  }
});

test('catalog coalescing distinguishes binary, version, cwd and invoker', async () => {
  let calls = 0; const pending = deferred();
  const invoke = () => { calls++; return pending.promise; };
  const other = () => { calls++; return pending.promise; };
  const read = createCatalogBoundary({ invoke });
  const base = { cli, localCwd: member };
  const requests = [base, base, { ...base, cli: { ...cli, bin: '/another/oats' } },
    { ...base, cli: { ...cli, version: '0.24.7' } }, { ...base, localCwd: '/elsewhere' }, { ...base, invoke: other }].map(o => read({}, o));
  await tick(); assert.equal(calls, 5); pending.resolve(envelope(description())); await Promise.all(requests);
});

test('list uses exact admitted classic context and genuine CLI arrays, without an operations gate', async () => {
  const data = inventory(); let call;
  const invokeList = (bin, args) => cliList(bin, args, { exec(b, argv, opts, done) {
    call = { b, argv, opts }; done(null, JSON.stringify(envelope(data)));
  } });
  const result = await capabilityRequest({ action: 'list', selector: { context: member } }, { ...options, invokeList, invoke: assert.fail });
  assert.deepEqual(result, { inventoryApi: 1, scope: { kind: 'classic', context: member }, ...data });
  assert.deepEqual(call.argv, ['list', '--dir', member, '--json']); assert.equal(call.opts.cwd, member); assert.equal(call.opts.shell, false);
  await capabilityRequest({ action: 'list', selector: {} }, { ...options, cli: { ...cli, version: '0.22.0' }, invokeList });
  assert.deepEqual(call.argv, ['list', '--dir', '/team', '--json']);
});

test('list refuses remote, captured, foreign and all extra selectors/arguments before invoking', async () => {
  const opts = { ...options, invokeList: assert.fail };
  for (const field of ['home', 'soul', 'agentsRoot', 'D', 'R', 'deployment', 'resolution', 'server', 'env', 'bin', 'argv', 'path']) {
    await assert.rejects(capabilityRequest({ action: 'list', selector: { [field]: member } }, opts), { code: 'E_BAD_ARGS' });
    await assert.rejects(capabilityRequest({ action: 'list', selector: {}, [field]: member }, opts), { code: 'E_BAD_ARGS' });
  }
  for (const selector of [null, [], '', { context: '--dir' }, { context: '/foreign' }, { context: `${member}/../a space; $(literal)` }, { context: null }]) {
    await assert.rejects(capabilityRequest({ action: 'list', selector }, opts), { code: 'E_BAD_ARGS' });
  }
  for (const ws of [{ ...workspace, remote: true }, { ...workspace, server: 'registered' }, { ...workspace, remote: true, server: 'registered', registrationPresent: true }]) {
    await assert.rejects(capabilityRequest({ action: 'list', selector: {} }, { ...opts, workspace: ws, cli: { ...cli, remote: ['operations', 'list'] } }), { code: 'unsupported-remote-operation' });
  }
  await assert.rejects(capabilityRequest({ action: 'list', selector: {} }, { ...opts, workspace: undefined }), { code: 'E_WORKSPACE_UNKNOWN' });
  await assert.rejects(capabilityRequest({ action: 'list', selector: {} }, { ...opts, cli: { ...cli, ok: false } }), { code: 'cli-unavailable' });
});

test('list preserves lock-v3 refusal and malformed/failed read is never an empty inventory', async () => {
  for (const code of ['invalid-lock', 'migration-required', 'unsupported-wire-version', 'E_USAGE']) {
    await assert.rejects(capabilityRequest({ action: 'list', selector: {} }, { ...options, invokeList: async () => failure(code) }), error => {
      assert.equal(error.code, code); assert.doesNotMatch(error.message, /SECRET/); return true;
    });
  }
  for (const result of [{}, [], { packages: [], capabilities: [] }, { ...inventory(), capabilities: [null] }, { ...inventory(), packages: [{}] }]) {
    await assert.rejects(capabilityRequest({ action: 'list', selector: {} }, { ...options, invokeList: async () => envelope(result) }), { code: 'E_CLI_PROTOCOL' });
  }
  const invokeList = (bin, args) => cliList(bin, args, { exec: (_b, _a, _o, done) => done(new Error('SECRET'), JSON.stringify(envelope({ packages: [], capabilities: [], legacy: [] }))) });
  await assert.rejects(capabilityRequest({ action: 'list', selector: {} }, { ...options, invokeList }), { code: 'E_CLI_FAILED' });
});

test('list coalesces success and rejected invocation, then releases and recovers', async () => {
  for (const reject of [false, true]) {
    const pending = deferred(); let calls = 0;
    const read = createInventoryBoundary({ invoke: () => { calls++; return calls === 1 ? pending.promise : envelope(inventory()); } });
    const requests = Array.from({ length: 6 }, () => read({ action: 'list', selector: {} }, options));
    const resultsPromise = Promise.allSettled(requests);
    await tick(); assert.equal(calls, 1);
    if (reject) pending.reject(new Error('SECRET')); else pending.resolve(envelope(inventory()));
    const results = await resultsPromise;
    assert.ok(results.every(r => r.status === (reject ? 'rejected' : 'fulfilled')));
    if (reject) for (const r of results) { assert.equal(r.reason.code, 'E_CLI_FAILED'); assert.doesNotMatch(r.reason.message, /SECRET/); }
    const recovered = await read({ action: 'list', selector: {} }, options);
    assert.equal(recovered.inventoryApi, 1); assert.equal(calls, 2);
  }
});

test('list coalescing keys binary/version/scoped cwd/invoker independently', async () => {
  let calls = 0; const pending = deferred();
  const invoke = () => { calls++; return pending.promise; };
  const other = () => { calls++; return pending.promise; };
  const read = createInventoryBoundary({ invoke });
  const request = { action: 'list', selector: {} };
  const requests = [options, options, { ...options, cli: { ...cli, bin: '/other/oats' } },
    { ...options, cli: { ...cli, version: '0.24.7' } }, { ...options, invoke: other }].map(o => read(request, o));
  requests.push(read({ action: 'list', selector: { context: member } }, options));
  await tick(); assert.equal(calls, 5); pending.resolve(envelope(inventory())); await Promise.all(requests);
});

function httpHarness({ state = cli, exec = asExec(description()), listExec = asExec(inventory()) } = {}) {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const send = (res, code, body, type');
  const end = source.indexOf('\nserver.on("error",');
  assert.ok(start > 0 && end > start);
  const errorStart = source.indexOf('function spawnErrorPayload(e)');
  const errorEnd = source.indexOf('/* OATSWEB_SPAWNERR_END */', errorStart);
  let catalogCalls = 0, listCalls = 0, lookups = 0;
  const readCatalog = createCatalogBoundary({ invoke: (bin, args) => cliCatalog(bin, args, { exec(...params) { catalogCalls++; return exec(...params); } }) });
  const invokeList = (bin, args) => cliList(bin, args, { exec(...params) { listCalls++; return listExec(...params); } });
  const dependencies = {
    createServer: callback => callback,
    catalogRequest: readCatalog,
    capabilityRequest: (req, opts) => capabilityRequest(req, { ...opts, invokeList }),
    cliState: state, ctxs: ['/server/local'],
    workspaces: () => { lookups++; return [workspace, { id: 'remote:team', scope: '/remote/team', remote: true, server: 'registered' }]; },
    agentsData: () => ({ agents }), panelData: assert.fail,
  };
  const handler = new Function(...Object.keys(dependencies), `${source.slice(errorStart, errorEnd)}\n${source.slice(start, end)}\nreturn server;`)(...Object.values(dependencies));
  return {
    counts: () => ({ catalogCalls, listCalls, lookups }),
    async request({ url = '/api/catalog', method = 'POST', body = '{}', headers = { host: '127.0.0.1:4820', origin: 'http://localhost:4820' } } = {}) {
      const req = new EventEmitter(); req.url = url; req.method = method; req.headers = headers;
      let result;
      const res = { writeHead(status, responseHeaders) { result = { status, headers: responseHeaders }; }, end(raw) { result.body = JSON.parse(raw); } };
      const completion = handler(req, res);
      req.emit('data', Buffer.from(body)); req.emit('end'); await completion;
      assert.ok(result, 'handler responded'); return result;
    },
  };
}

test('real HTTP Host/Origin guards run first for catalog/list, even with malformed bodies', async () => {
  const http = httpHarness({ exec: assert.fail, listExec: assert.fail });
  for (const url of ['/api/catalog', '/api/capabilities?ws=%2Fteam']) {
    for (const headers of [
      {}, { host: 'evil.invalid' }, { host: '127.0.0.1.evil.invalid:4820' },
      { host: 'localhost', origin: 'https://evil.invalid' }, { host: 'localhost', origin: 'null' }, { host: 'localhost', origin: 'not a URL' },
    ]) {
      const response = await http.request({ url, headers, body: 'not JSON' });
      assert.equal(response.status, 403); assert.deepEqual(response.body, { error: 'forbidden origin' });
    }
  }
  assert.deepEqual(http.counts(), { catalogCalls: 0, listCalls: 0, lookups: 0 });
});

test('real HTTP GET and bad catalog arguments never execute a read', async () => {
  const http = httpHarness({ exec: assert.fail, listExec: assert.fail });
  for (const url of ['/api/catalog', '/api/capabilities?ws=%2Fteam']) {
    assert.equal((await http.request({ url, method: 'GET' })).status, 404);
    assert.equal((await http.request({ url, method: 'GET', headers: { host: 'evil.invalid' } })).status, 403);
  }
  for (const body of ['null', '[]', '1', '""', '{', '{"env":{}}', '{"source":"/other"}', '{"argv":["install"]}', ' '.repeat(65537)]) {
    const result = await http.request({ body }); assert.equal(result.status, 400); assert.equal(result.body.code, 'E_BAD_ARGS');
  }
  for (const query of ['?ws=remote', '?bin=/other', '?source=override', '?argv=catalog', '?x=']) {
    const result = await http.request({ url: `/api/catalog${query}` }); assert.equal(result.status, 400); assert.equal(result.body.code, 'E_BAD_ARGS');
  }
  assert.deepEqual(http.counts(), { catalogCalls: 0, listCalls: 0, lookups: 0 });
});

test('HTTP catalog exact wrapper uses local cwd; empty body accepted and failures stay recoverable', async () => {
  const data = description(); let argvSeen, cwdSeen;
  const http = httpHarness({ exec(_bin, argv, opts, done) { argvSeen = argv; cwdSeen = opts.cwd; done(null, JSON.stringify(envelope(data))); } });
  for (const body of ['', '{}']) {
    const result = await http.request({ body });
    assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'no-store');
    assert.deepEqual(result.body, { catalogApi: 1, scope: 'local-cli', status: 'available', minimumVersion: '0.24.6', description: data, reason: null });
    assert.deepEqual(argvSeen, ['catalog', '--json']); assert.equal(cwdSeen, '/server/local');
  }
  assert.equal(http.counts().catalogCalls, 2);
  const old = httpHarness({ state: { ...cli, version: '0.24.5' }, exec: assert.fail });
  assertUnavailable((await old.request()).body, 'cli-no-catalog');
  const missing = httpHarness({ exec: (_b, _a, _o, done) => done(new Error('SECRET'), JSON.stringify(failure('E_USAGE')), 'SECRET stderr') });
  const unavailable = await missing.request(); assert.equal(unavailable.status, 200); assertUnavailable(unavailable.body, 'E_CLI_FAILED');
});

test('HTTP list rejects remote/foreign/captured/query misuse and keeps lock refusal visible', async () => {
  const http = httpHarness({ exec: assert.fail, listExec: assert.fail });
  for (const [url, body, code] of [
    ['/api/capabilities?ws=remote:team', '{"action":"list","selector":{}}', 'unsupported-remote-operation'],
    ['/api/capabilities?ws=foreign', '{"action":"list","selector":{}}', 'E_WORKSPACE_UNKNOWN'],
    ['/api/capabilities?ws=/team&ws=/team', '{"action":"list","selector":{}}', 'E_BAD_ARGS'],
    ['/api/capabilities?ws=/team&server=remote', '{"action":"list","selector":{}}', 'E_BAD_ARGS'],
    ['/api/capabilities?ws=/team', '{"action":"list","selector":{"home":"/team/home"}}', 'E_BAD_ARGS'],
    ['/api/capabilities?ws=/team', '{"action":"list","selector":{"D":"/team"}}', 'E_BAD_ARGS'],
    ['/api/capabilities?ws=/team', '{"action":"list","argv":["install"]}', 'E_BAD_ARGS'],
    ['/api/capabilities?ws=/team', '{', 'E_BAD_ARGS'],
  ]) {
    const response = await http.request({ url, body }); assert.ok(response.status >= 400); assert.equal(response.body.code, code);
  }
  assert.equal(http.counts().listCalls, 0);
  const locked = httpHarness({ listExec: (_b, _a, _o, done) => done(new Error('exit 1'), JSON.stringify(failure('invalid-lock'))) });
  const result = await locked.request({ url: '/api/capabilities?ws=/team', body: '{"action":"list","selector":{}}' });
  assert.equal(result.status, 409); assert.equal(result.body.code, 'invalid-lock');
  assert.equal(Object.hasOwn(result.body, 'packages'), false); assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});

test('HTTP concurrent catalog/list share successful/failed adapter flights, then refresh and recover', async () => {
  for (const list of [false, true]) for (const failed of [false, true]) {
    let done;
    const data = list ? inventory() : description();
    const exec = (_b, _a, _o, callback) => { done = callback; };
    const http = httpHarness(list ? { listExec: exec } : { exec });
    const args = list ? { url: '/api/capabilities?ws=/team', body: JSON.stringify({ action: 'list', selector: { context: member } }) } : {};
    const requests = Array.from({ length: 5 }, () => http.request(args));
    await tick(); assert.equal(list ? http.counts().listCalls : http.counts().catalogCalls, 1);
    if (failed) done(new Error('SECRET'), JSON.stringify(failure('invalid-lock')), 'SECRET stderr');
    else done(null, JSON.stringify(envelope(data)));
    const results = await Promise.all(requests);
    for (const r of results) {
      assert.equal(r.status, list && failed ? 409 : 200); assert.deepEqual(r.body, results[0].body);
      assert.doesNotMatch(JSON.stringify(r), /SECRET/);
    }
    if (failed) {
      if (list) assert.equal(results[0].body.code, 'invalid-lock');
      else assertUnavailable(results[0].body, 'E_CLI_FAILED');
    } else if (list) assert.deepEqual(results[0].body, { inventoryApi: 1, scope: { kind: 'classic', context: member }, ...data });
    const next = http.request({ ...args, headers: { host: '127.0.0.1:4820' } }); await tick();
    assert.equal(list ? http.counts().listCalls : http.counts().catalogCalls, 2);
    done(null, JSON.stringify(envelope(data)));
    const recovery = await next; assert.equal(recovery.status, 200);
    assert.equal(list ? recovery.body.inventoryApi : recovery.body.status, list ? 1 : 'available');
  }
});
