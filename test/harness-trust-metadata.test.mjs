import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { harnessTrust, nativeSecurityContext } from '../lib/harness-trust-write.mjs';

const context = 'unconfined_u:object_r:user_home_t:s0';
function probe(mode, label = context, platform = 'linux') {
  return file => nativeSecurityContext(file, { platform, run(command, args) {
    assert.equal(command, 'ls');
    return args.includes('-Zd') ? `${typeof label === 'function' ? label(file) : label} ${file}\n` : `${mode} 1 user group 2 today ${file}\n`;
  } });
}
function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'oats-trust-metadata-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'deployment'), native = join(base, 'native');
  fs.mkdirSync(root); fs.mkdirSync(native);
  const file = join(native, '.claude.json'); fs.writeFileSync(file, '{}', { mode: 0o600 });
  return { root, file, env: { HOME: native } };
}

test('GNU security-context dot is distinct from ACL plus and macOS extended attributes', () => {
  assert.equal(probe('-rw-------.')('/config'), context);
  assert.equal(probe('-rw-------')('/config'), null);
  for (const [mode, platform] of [['-rw-------+', 'linux'], ['-rw-------@', 'linux'], ['-rw-------..', 'linux'], ['-rw-------@', 'darwin'], ['-rw-------+', 'darwin'], ['-rw-------.', 'darwin']]) {
    assert.throws(() => probe(mode, context, platform)('/config'), e => e.code === 'E_CONFIG_BROKEN');
  }
  assert.equal(probe('-rw-------', context, 'darwin')('/config'), null);
  for (const label of ['?', '', 'unrecognized']) assert.throws(() => probe('-rw-------.', label)('/config'));
});

test('simulated SELinux metadata permits plan, same-context replacement and unchanged reapply', t => {
  const { root, file, env } = fixture(t), metadataProbe = probe('-rw-------.');
  assert.equal(harnessTrust(root, { env, harness: 'claude', plan: true, metadataProbe }).entries[0].status, 'change');
  assert.equal(fs.readFileSync(file, 'utf8'), '{}');
  assert.equal(fs.existsSync(join(root, '.agents')), false);
  assert.equal(harnessTrust(root, { env, harness: 'claude', metadataProbe }).entries[0].status, 'applied');
  assert.equal(harnessTrust(root, { env, harness: 'claude', metadataProbe }).entries[0].status, 'unchanged');
});

test('a different candidate default context refuses before replacement and cleans its temp', t => {
  const { root, file, env } = fixture(t);
  const metadataProbe = probe('-rw-------.', path => path.endsWith('.tmp') ? 'unconfined_u:object_r:other_t:s0' : context);
  assert.throws(() => harnessTrust(root, { env, harness: 'claude', metadataProbe }), e => e.details.reason === 'write' && !e.details.mayHaveChanged && e.details.entries[0].status === 'failed');
  assert.equal(fs.readFileSync(file, 'utf8'), '{}');
  assert.deepEqual(fs.readdirSync(env.HOME), ['.claude.json']);
});

test('security context drift is detected both before and after replacement', t => {
  for (const phase of ['before-replace', 'after-replace']) {
    const { root, file, env } = fixture(t); let drifted = false;
    const metadataProbe = probe('-rw-------.', path => drifted && path === file ? 'unconfined_u:object_r:changed_t:s0' : context);
    assert.throws(() => harnessTrust(root, { env, harness: 'claude', metadataProbe, checkpoint(name) { if (name === phase) drifted = true; } }), e => e.details.reason === (phase === 'before-replace' ? 'changed' : 'verify') && e.details.mayHaveChanged === (phase === 'after-replace'));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).projects !== undefined, phase === 'after-replace');
  }
});
