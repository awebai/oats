// No server/CLI/GUI is launched. Exercise the real request + execFile seams,
// including the source-extracted HTTP callback and its production guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import * as adapter from '../cli-adapter.mjs';
const { cliList, cliCapability } = adapter;
import { capabilityRequest, createInventoryBoundary } from '../server/capabilities.mjs';

const cli = { ok: true, bin: '/installed/oats', version: '0.24.6' }; // deliberately no operationsApi
const workspace = { id: '/team', scope: '/team' };
const member = '/team/a space; $(literal)';
const agents = [{ name: 'dev', agentsRoot: `${member}/agents` }];
const envelope = result => ({ schemaVersion: 1, ok: true, result });
const failure = code => ({ schemaVersion: 1, ok: false, error: { code, message: 'SECRET child diagnostic' } });
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

test('read adapters fix argv/cwd, use no shell, and bound timeout/output', async () => {
  assert.equal(Object.hasOwn(adapter, 'cliCatalog'), false, 'the removed catalog verb has no adapter');
  for (const [read, args, expected] of [
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
  for (const read of [cliList]) for (const [exec, code] of executions) {
    const result = await read(cli.bin, { context: member, localCwd: member }, { exec });
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
  for (const read of [cliList]) {
    const base = { localCwd: member, context: member };
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

function httpHarness({ state = cli, listExec = asExec(inventory()) } = {}) {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const send = (res, code, body, type');
  const end = source.indexOf('\nserver.on("error",');
  assert.ok(start > 0 && end > start);
  const errorStart = source.indexOf('function spawnErrorPayload(e)');
  const errorEnd = source.indexOf('/* OATSWEB_SPAWNERR_END */', errorStart);
  let listCalls = 0, lookups = 0;
  const invokeList = (bin, args) => cliList(bin, args, { exec(...params) { listCalls++; return listExec(...params); } });
  const dependencies = {
    createServer: callback => callback,
    capabilityRequest: (req, opts) => capabilityRequest(req, { ...opts, invokeList }),
    cliState: state, ctxs: ['/server/local'],
    workspaces: () => { lookups++; return [workspace, { id: 'remote:team', scope: '/remote/team', remote: true, server: 'registered' }]; },
    agentsData: () => ({ agents }), panelData: assert.fail,
  };
  const handler = new Function(...Object.keys(dependencies), `${source.slice(errorStart, errorEnd)}\n${source.slice(start, end)}\nreturn server;`)(...Object.values(dependencies));
  return {
    counts: () => ({ listCalls, lookups }),
    async request({ url = '/api/capabilities?ws=%2Fteam', method = 'POST', body = '{}', headers = { host: '127.0.0.1:4820', origin: 'http://localhost:4820' } } = {}) {
      const req = new EventEmitter(); req.url = url; req.method = method; req.headers = headers;
      let result;
      const res = { writeHead(status, responseHeaders) { result = { status, headers: responseHeaders }; }, end(raw) { result.body = JSON.parse(raw); } };
      const completion = handler(req, res);
      req.emit('data', Buffer.from(body)); req.emit('end'); await completion;
      assert.ok(result, 'handler responded'); return result;
    },
  };
}

test('real HTTP Host/Origin guards run first for the removed catalog path and list, even with malformed bodies', async () => {
  const http = httpHarness({ listExec: assert.fail });
  for (const url of ['/api/catalog', '/api/capabilities?ws=%2Fteam']) {
    for (const headers of [
      {}, { host: 'evil.invalid' }, { host: '127.0.0.1.evil.invalid:4820' },
      { host: 'localhost', origin: 'https://evil.invalid' }, { host: 'localhost', origin: 'null' }, { host: 'localhost', origin: 'not a URL' },
    ]) {
      const response = await http.request({ url, headers, body: 'not JSON' });
      assert.equal(response.status, 403); assert.deepEqual(response.body, { error: 'forbidden origin' });
    }
  }
  assert.deepEqual(http.counts(), { listCalls: 0, lookups: 0 });
});

test('the removed catalog route is not served for any method or body, and GET list never executes', async () => {
  const http = httpHarness({ listExec: assert.fail });
  for (const method of ['GET', 'POST']) for (const body of ['{}', '', '{"env":{}}']) {
    const result = await http.request({ url: '/api/catalog', method, body });
    assert.equal(result.status, 404); assert.deepEqual(result.body, { error: 'not found' });
  }
  assert.equal((await http.request({ method: 'GET' })).status, 404);
  assert.equal((await http.request({ method: 'GET', headers: { host: 'evil.invalid' } })).status, 403);
  assert.deepEqual(http.counts(), { listCalls: 0, lookups: 0 });
});

test('HTTP list rejects remote/foreign/captured/query misuse and keeps lock refusal visible', async () => {
  const http = httpHarness({ listExec: assert.fail });
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

test('HTTP concurrent list requests share successful/failed adapter flights, then refresh and recover', async () => {
  for (const failed of [false, true]) {
    let done;
    const data = inventory();
    const http = httpHarness({ listExec: (_b, _a, _o, callback) => { done = callback; } });
    const args = { url: '/api/capabilities?ws=/team', body: JSON.stringify({ action: 'list', selector: { context: member } }) };
    const requests = Array.from({ length: 5 }, () => http.request(args));
    await tick(); assert.equal(http.counts().listCalls, 1);
    if (failed) done(new Error('SECRET'), JSON.stringify(failure('invalid-lock')), 'SECRET stderr');
    else done(null, JSON.stringify(envelope(data)));
    const results = await Promise.all(requests);
    for (const r of results) {
      assert.equal(r.status, failed ? 409 : 200); assert.deepEqual(r.body, results[0].body);
      assert.doesNotMatch(JSON.stringify(r), /SECRET/);
    }
    if (failed) assert.equal(results[0].body.code, 'invalid-lock');
    else assert.deepEqual(results[0].body, { inventoryApi: 1, scope: { kind: 'classic', context: member }, ...data });
    const next = http.request({ ...args, headers: { host: '127.0.0.1:4820' } }); await tick();
    assert.equal(http.counts().listCalls, 2);
    done(null, JSON.stringify(envelope(data)));
    const recovery = await next; assert.equal(recovery.status, 200);
    assert.equal(recovery.body.inventoryApi, 1);
  }
});
