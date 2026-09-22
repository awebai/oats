import test from 'node:test';
import assert from 'node:assert/strict';
import { createForgeAuthBroker, AUTH_KEYS } from '../forge-auth.mjs';
import { createAuthOutputFilter } from '../forge-auth-output.mjs';
import { cli, output, deferred, tick } from './helpers/forge-fixture.mjs';
const id = 'e'.repeat(64), hostRef = 'f'.repeat(64);
const snapshot = (status = 'not-connected', login = null) => ({ forgeApi: 1, status, host: 'github.com', login, hostRef, connectionRef: id, cli });
function fixture(options = {}) {
  const owner = { dead: false, isDestroyed() { return this.dead; } }, other = { isDestroyed: () => false };
  const emitted = [], children = [], writes = [], commands = [], generations = [], timers = new Set();
  const broker = createForgeAuthBroker({
    readConnection: async () => snapshot(), verify: async () => true, checkBinary: () => true, run: async (_bin, args) => { commands.push(args); return output(''); },
    confirm: async () => true, changed: gen => generations.push(gen), emit: (who, lease, event, data) => emitted.push({ who, lease, event, data }),
    setTimer: fn => { timers.add(fn); return fn; }, clearTimer: fn => timers.delete(fn),
    launchPty: (bin, args, opts) => {
      const child = { bin, args, opts, killed: false, onData(fn) { this.data = fn; }, onExit(fn) { this.exit = fn; },
        kill(signal) { this.killed = signal; this.exit?.({ exitCode: 1 }); }, write(value) { writes.push(value); }, resize() {} };
      children.push(child); return child;
    }, ...options,
  });
  return { broker, owner, other, emitted, children, writes, commands, generations, timers };
}
test('auth output redacts credentials at EVERY chunk boundary and discards OSC/clipboard strings', () => {
  for (const credential of [`ghp_${'A'.repeat(36)}`, `github_pat_${'B'.repeat(60)}`, 'c'.repeat(40)]) {
    const text = `Sign in ${credential} now\n`;
    for (let at = 0; at <= text.length; at++) {
      const filter = createAuthOutputFilter();
      const result = filter.feed(text.slice(0, at)) + filter.feed(text.slice(at)) + filter.end();
      assert.equal(result, 'Sign in [redacted] now\n');
    }
  }
  const filter = createAuthOutputFilter();
  const got = filter.feed('\x1b]52;c;PRIVATE') + filter.feed('\x07device code ABCD-EFGH\n') + filter.end();
  assert.equal(got, 'device code ABCD-EFGH\n');
  const ansi = createAuthOutputFilter();
  assert.doesNotMatch(ansi.feed(`ghp_ABC\x1b[31m${'D'.repeat(40)} `) + ansi.end(), /ghp_|ABC/);
});
test('auth filter has bounded words, no invisible-split escape and no credential prefix flushed early', () => {
  const filter = createAuthOutputFilter();
  assert.equal(filter.feed('ghp_'), ''); assert.equal(filter.feed('ABC\x07DEF'), ''); assert.equal(filter.end(), '[redacted]');
  const large = createAuthOutputFilter(); assert.equal(large.feed('a'.repeat(8192)) + large.end(), '[redacted oversized output]');
  const controls = createAuthOutputFilter(); assert.equal(controls.feed('x\x1b]8;;https://evil\x1b\\y\x1b]8;;\x1b\\ ') + controls.end(), 'xy ');
});
test('Connect reserves one global operation, creates only the approved PTY after listeners can be ready, and accepts enum keys only', async () => {
  const f = fixture();
  try {
    const result = await f.broker.connect(f.owner, id); assert.equal(result.ok, true); assert.equal(f.children.length, 0);
    assert.equal((await f.broker.connect(f.owner, id)).lease, result.lease);
    assert.equal((await f.broker.connect(f.other, id)).reason.code, 'E_FORGE_BUSY');
    assert.equal(f.broker.resize(f.other, result.lease, 80, 24).ok, false);
    assert.equal(f.broker.resize(f.owner, result.lease, 80, 24).ok, true);
    const child = f.children[0]; assert.equal(child.bin, cli.bin);
    assert.deepEqual(child.args, ['auth', 'login', '--web', '--skip-ssh-key', '--hostname', 'github.com']);
    assert.equal(child.opts.env.GH_PROMPT_DISABLED, undefined); assert.equal(child.opts.env.GH_TOKEN, undefined);
    assert.equal(f.broker.key(f.other, result.lease, 'enter').ok, false);
    assert.equal(f.broker.key(f.owner, result.lease, 'ghp_PASTE_TOKEN').ok, false);
    for (const name of Object.keys(AUTH_KEYS)) assert.equal(f.broker.key(f.owner, result.lease, name).ok, true);
    assert.deepEqual(f.writes, Object.values(AUTH_KEYS));
    child.data(`one-time ABCD-EFGH\nsecret ghp_${'A'.repeat(36)}\n`);
    assert.doesNotMatch(JSON.stringify(f.emitted), /ghp_/);
    f.broker.close(f.owner, result.lease); assert.equal(child.killed, 'SIGKILL'); assert.deepEqual(f.generations, [1, 2]);
    assert.equal(f.timers.size, 0); assert.equal(f.broker.key(f.owner, result.lease, 'enter').ok, false);
  } finally { f.broker.dispose(); }
});
test('late auth preparation success and rejection cannot spawn or erase a new operation after owner teardown', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(); let n = 0; const f = fixture({ readConnection: () => ++n === 1 ? gate.promise : Promise.resolve(snapshot()) });
    const old = f.broker.connect(f.owner, id); await tick(); f.broker.dropOwner(f.owner);
    const fresh = await f.broker.connect(f.other, id); assert.equal(fresh.ok, true);
    if (reject) gate.reject(new Error('PRIVATE')); else gate.resolve(snapshot());
    assert.equal((await old).ok, false); assert.equal(f.children.length, 0);
    assert.equal(f.broker.resize(f.other, fresh.lease, 80, 24).ok, true);
    assert.equal(f.children.length, 1); f.broker.dispose();
  }
});
test('logout requires confirmation, fresh account match and exact user; success is not a disconnected-state assertion', async () => {
  const f = fixture({ readConnection: async () => snapshot('connected', 'operator') });
  const result = await f.broker.disconnect(f.owner, id);
  assert.deepEqual(f.commands, [['auth', 'logout', '--hostname', 'github.com', '--user', 'operator']]);
  assert.equal(result.ok, true); assert.equal(result.status, undefined); assert.deepEqual(f.generations, [1, 2]); assert.equal(f.timers.size, 0);
  for (const scenario of ['cancel', 'changed', 'bad-binary']) {
    let calls = 0; const bad = fixture({ readConnection: async () => snapshot('connected', ++calls === 2 && scenario === 'changed' ? 'other' : 'operator'),
      confirm: async () => scenario !== 'cancel', verify: async () => scenario !== 'bad-binary' });
    assert.equal((await bad.broker.disconnect(bad.owner, id)).ok, false); assert.equal(bad.commands.length, 0); assert.equal(bad.timers.size, 0);
  }
});
test('logout confirmation completion after teardown cannot mutate gh; rejected subprocess diagnostics stay private', async () => {
  const confirmation = deferred(); const f = fixture({ readConnection: async () => snapshot('connected', 'operator'), confirm: () => confirmation.promise });
  const old = f.broker.disconnect(f.owner, id); await tick(); f.broker.dropOwner(f.owner); confirmation.resolve(true);
  assert.equal((await old).ok, false); assert.equal(f.commands.length, 0);
  const secret = fixture({ readConnection: async () => snapshot('connected', 'operator'), run: async () => { throw new Error('ghp_PRIVATE_SECRET'); } });
  assert.doesNotMatch(JSON.stringify(await secret.broker.disconnect(secret.owner, id)), /ghp_/); assert.equal(secret.timers.size, 0);
});
test('changed binary/backend or owner death during prepare cannot start gh and cannot leak a slot', async () => {
  for (const mode of ['binary', 'backend']) {
    const f = fixture({ checkBinary: () => mode !== 'binary' });
    const result = await f.broker.connect(f.owner, id);
    if (mode === 'backend') f.broker.invalidate();
    assert.equal(f.broker.resize(f.owner, result.lease, 80, 24).reason.code, 'E_CONNECTION_CHANGED');
    assert.equal(f.children.length, 0); assert.equal(f.timers.size, 0);
  }
  for (const reject of [false, true]) {
    const gate = deferred(), f = fixture({ readConnection: () => gate.promise });
    const pending = f.broker.connect(f.owner, id); f.owner.dead = true;
    if (reject) gate.reject(new Error('PRIVATE')); else gate.resolve(snapshot());
    assert.equal((await pending).ok, false); assert.equal(f.timers.size, 0); assert.equal(f.children.length, 0);
  }
});

test('a closing renderer cannot throw out of PTY output/exit callbacks', async () => {
  const f = fixture({ emit: () => { throw new Error('renderer closed'); } });
  const result = await f.broker.connect(f.owner, id); f.broker.resize(f.owner, result.lease, 80, 24);
  assert.doesNotThrow(() => f.children[0].data('device flow\n'));
  assert.equal(f.children[0].killed, 'SIGKILL'); assert.equal(f.timers.size, 0);
});

test('deadline, output cap and quit release only owned auth child and revoke its input lease', async () => {
  for (const reason of ['deadline', 'output', 'quit', 'exit']) {
    const f = fixture(); const result = await f.broker.connect(f.owner, id); f.broker.resize(f.owner, result.lease, 80, 24);
    const child = f.children[0];
    if (reason === 'deadline') [...f.timers][0]();
    if (reason === 'output') child.data('x'.repeat(1024 * 1024 + 1));
    if (reason === 'quit') f.broker.dispose();
    if (reason === 'exit') child.exit({ exitCode: 0 });
    assert.equal(f.timers.size, 0); assert.equal(f.broker.key(f.owner, result.lease, 'enter').ok, false);
    assert.equal(f.generations.length, 2); assert.equal(f.children.length, 1);
  }
});
