import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitTerminalTarget } from '../terminal-target.mjs';

const tmux = { session: 'agents', window: 'dev-1', socket: '/memory/tmux.sock' };
const herdr = { sessionTarget: { backend: 'herdr', protocol: 20, socket: '/memory/herdr.sock', paneId: 'w1:pA', terminalId: 'term_ABC' } };
const remote = { remote: { serverId: 'peer', instance: 'dev-1', home: '/memory/home' } };
for (const [name, target] of [['tmux', tmux], ['Herdr', herdr], ['remote', remote]]) {
  test(`${name} admission copies/freezes only its existing adapter fields, defaults geometry, and tags the key`, () => {
    const input = structuredClone(target), admitted = admitTerminalTarget(input);
    assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.spec));
    assert.equal(admitted.spec.cols, 80); assert.equal(admitted.spec.rows, 24);
    assert.match(admitted.key, new RegExp(`^\\["${name.toLowerCase()}"`));
    if (name === 'remote') { input.remote.home = '/changed'; assert.equal(admitted.spec.remote.home, '/memory/home'); assert.ok(Object.isFrozen(admitted.spec.remote)); }
    if (name === 'Herdr') { input.sessionTarget.terminalId = 'term_OTHER'; assert.equal(admitted.spec.sessionTarget.terminalId, 'term_ABC'); assert.ok(Object.isFrozen(admitted.spec.sessionTarget)); }
    if (name === 'tmux') { input.session = 'other'; assert.equal(admitted.spec.session, 'agents'); }
  });
}

test('canonical tmux aliases for numeric window/default socket do not bypass dedupe', () => {
  assert.equal(admitTerminalTarget({ session: 's', window: 1, socket: null }).key, admitTerminalTarget({ session: 's', window: '1', socket: '' }).key);
  assert.equal(admitTerminalTarget({ session: 's', window: null }).key, admitTerminalTarget({ session: 's' }).key);
  assert.notEqual(admitTerminalTarget({ session: 's', socket: '/memory/one' }).key, admitTerminalTarget({ session: 's', socket: '/memory/two' }).key);
});

const invalid = [null, [], {}, { session: 's', remote: remote.remote }, { session: 's', sessionTarget: herdr.sessionTarget },
  { ...remote, sessionTarget: herdr.sessionTarget }, { remote: null }, { sessionTarget: null },
  { session: 's', owner: 2 }, { ...remote, bin: '/memory/evil' }, { ...herdr, env: {} },
  { remote: { ...remote.remote, command: 'anything' } }, { sessionTarget: { ...herdr.sessionTarget, bin: 'other' } },
  { ...remote, socket: '/memory/other' }, { ...herdr, window: 'other' },
  { session: '=s' }, { session: 's:other' }, { session: 's', window: '=other' }, { session: 's', window: {} },
  { session: 's', window: -1 }, { session: 's', window: 1.1 }, { session: 's', socket: 'relative' },
  { session: 's', socket: '/memory/\0bad' }, { session: 's', socket: '/memory/\nbad' },
  { session: 's', cols: '80' }, { session: 's', rows: Infinity }, { session: 's', cols: 0 }, { session: 's', cols: 1001 },
  { session: 'x'.repeat(129) }, { remote: { ...remote.remote, home: 'relative' } },
  { remote: { ...remote.remote, instance: 'x'.repeat(129) } }, { remote: { ...remote.remote, home: '/'.repeat(4097) } },
  { sessionTarget: { ...herdr.sessionTarget, protocol: '20' } }, { sessionTarget: { ...herdr.sessionTarget, paneId: 'untyped' } },
];
for (let i = 0; i < invalid.length; i++) test(`closed target grammar rejects malformed/ambiguous/extra authority ${i}`, () => assert.throws(() => admitTerminalTarget(invalid[i])));
