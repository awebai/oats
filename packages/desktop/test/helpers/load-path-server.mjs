// A real `server/oats-web.mjs` process driven by a scripted fake `oats` CLI, for
// tests of the load path (parallel cycle, held catalogs, inspect cache, focus
// reprobe, cadence, --max-age). The fake answers every verb from the desktop-facts
// kernel capture retargeted to a temp deployment, records each call's argv with
// start/end times, and re-reads its config on every invocation so a test can
// change the probe, per-verb delays or the observe-max-age feature mid-run.
// Nothing here touches tmux state: the fixture's tmux target does not exist, so
// the liveness child reports the seat as not running.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const FIXTURES = fileURLToPath(new URL('../fixtures/workspace-v2/desktop-facts/', import.meta.url));
const SERVER = fileURLToPath(new URL('../../server/oats-web.mjs', import.meta.url));
export const FIXTURE_DEPLOYMENT = '/fixture/base/northwind-workspace';
/** The observation stamp the fake reports whenever it is asked with --max-age (a kernel that
 * declares observe-max-age always reports one; without the flag it reports none). */
export const FAKE_OBSERVED_AT = '2026-01-01T00:00:00.000Z';

const FAKE = `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs';
const [scriptDir, log] = [process.env.FAKE_SCRIPT_DIR, process.env.FAKE_LOG];
const config = () => JSON.parse(readFileSync(scriptDir + '/config.json', 'utf8'));
const a = process.argv.slice(2);
const verb = a[0] === 'workspace' && a[1] === 'status' ? 'workspace-status' : a[0] === 'operation' ? 'operation-run' : a[0];
const start = Date.now();
const cfg = config();
const dir = a.includes('--dir') ? a[a.indexOf('--dir') + 1] : cfg.deployment;
const fixture = name => JSON.parse(readFileSync(scriptDir + '/' + name + '.json', 'utf8').replaceAll(${JSON.stringify(FIXTURE_DEPLOYMENT)}, dir));
const delay = cfg.delays?.[verb] || 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const observation = () => a.includes('--max-age') ? { observation: { observedAt: ${JSON.stringify(FAKE_OBSERVED_AT)}, reused: a[a.indexOf('--max-age') + 1] !== '0' } } : {};
let out;
if (verb === 'version') out = cfg.version;
else if (verb === 'status') out = { ...fixture('status'), ...observation() };
else if (verb === 'workspace-status' || verb === 'souls' || verb === 'capabilities') { const d = fixture(verb); d.result = { ...d.result, ...observation() }; out = d; }
else if (verb === 'inspect') {
  const d = fixture(a.includes('--home') ? 'inspect-home' : 'inspect-soul');
  if (a.includes('--home')) { const home = a[a.indexOf('--home') + 1]; d.result.subject.home = home; d.result.instance.home = home; }
  d.result = { ...d.result, ...observation() }; out = d;
}
else if (verb === 'server') out = { schemaVersion: 1, ok: true, result: { groups: [], servers: [] } };
else if (verb === 'operation-run') out = { schemaVersion: 1, ok: true, result: { operationsApi: 2, operation: a[2], ok: true } };
else out = { schemaVersion: 1, ok: false, error: { code: 'E_UNKNOWN_COMMAND', message: 'fake: ' + a.join(' ') } };
await sleep(delay);
appendFileSync(log, JSON.stringify({ verb, argv: a, start, end: Date.now() }) + '\\n');
process.stdout.write(JSON.stringify(out));
process.exit(out?.ok === false ? 1 : 0);
`;

async function freePort() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  return port;
}

/** Boot a server for one temp deployment. `probe` mutates the fixture probe (e.g. adds a feature). */
export async function startLoadPathServer({ probe = v => v, delays = {} } = {}) {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'oats-load-path-')));
  const deployment = join(temp, 'workspace'); mkdirSync(join(deployment, 'agents'), { recursive: true });
  writeFileSync(join(deployment, 'oats-local.yaml'), 'workspace: fixture\n');
  // The fixture seat's home exists on disk so privileged routes that verify it (session start) admit it.
  mkdirSync(join(deployment, 'agents', 'release-manager', 'instances', 'release-manager-facts'), { recursive: true });
  const script = join(temp, 'script'); mkdirSync(script);
  for (const name of ['status', 'workspace-status', 'souls', 'capabilities', 'inspect-soul', 'inspect-home']) writeFileSync(join(script, `${name}.json`), readFileSync(join(FIXTURES, `${name}.json`)));
  const version = probe(JSON.parse(readFileSync(join(FIXTURES, 'version.json'), 'utf8')));
  const config = { version, delays, deployment };
  const writeConfig = () => writeFileSync(join(script, 'config.json'), JSON.stringify(config));
  writeConfig();
  const log = join(temp, 'calls.jsonl'); writeFileSync(log, '');
  const fake = join(temp, 'oats'); writeFileSync(fake, FAKE, { mode: 0o700 });
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}'); // the extensionless fake is ESM whatever the temp path
  const port = await freePort();
  const proc = spawn(process.execPath, [SERVER, 'start', '--port', String(port), '--dir', deployment], {
    detached: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, OATS_DESKTOP_OATS_BIN: fake, FAKE_SCRIPT_DIR: script, FAKE_LOG: log, PATH: '/nonexistent', SHELL: '/bin/false',
      OATS_INSTANCE_HOME: undefined, OATS_INSTANCE: undefined, OATS_DEPLOYMENT: undefined },
  });
  let stderr = ''; proc.stderr.on('data', data => { stderr += data; });
  const base = `http://127.0.0.1:${port}`;
  const ws = `?ws=${encodeURIComponent(deployment)}`;
  const get = async path => (await fetch(base + path)).json();
  const post = async (path, body) => (await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  let ready = false;
  for (let n = 0; n < 100 && !ready; n++) {
    try { ready = (await fetch(base + '/api/version')).ok; } catch { /* starting */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error(`server never listened: ${stderr}`);
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const until = async (test, { timeout = 15_000, every = 25 } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await test();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting: ${test.toString().slice(0, 120)}`);
      await new Promise(resolve => setTimeout(resolve, every));
    }
  };
  return {
    deployment, base, ws, get, post, calls, until, config,
    /** Change the fake's config for every invocation from now on. */
    reconfigure(change) { change(config); writeConfig(); },
    panel: () => get(`/api/panel${ws}`),
    agents: () => get(`/api/agents${ws}`),
    stderr: () => stderr,
    async stop() {
      const exited = proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve() : once(proc, 'exit');
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already stopped */ }
      await exited; rmSync(temp, { recursive: true, force: true });
    },
  };
}
