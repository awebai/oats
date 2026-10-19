import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveCaptureRoots } from '../lib/setup-capture-roots.mjs';

const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'setup-root-adapter-')));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));
const loc = path => join(base, path);
const deployment = loc('deployment');
const config = (harness, env = {}, args = []) => ({ harness, env, args });
function derive(configurations, env = { HOME: loc('person') }) {
  return deriveCaptureRoots({ deployment, configurations, env });
}

test('setup derives every effective named configuration through native location rules', () => {
  const request = derive({
    cc: config('claude', { CLAUDE_CONFIG_DIR: loc('cc'), TOKEN: { fromEnv: 'SECRET' } }),
    codex: config('codex', { CODEX_HOME: { fromEnv: 'CX' } }),
    unselected: config('pi', { PI_CODING_AGENT_DIR: loc('pi') }),
    home: config('claude', { HOME: loc('other') }),
    duplicate: config('claude', { CLAUDE_CONFIG_DIR: loc('cc/./') }),
  }, { HOME: loc('person'), CX: loc('codex'), SECRET: 'never-persist' });
  assert.deepEqual(request, { schemaVersion: 1, deployment, roots: [
    { source: 'cc', path: loc('cc/projects') }, { source: 'cc', path: loc('other/.claude/projects') },
    { source: 'codex', path: loc('codex/sessions') }, { source: 'pi', path: loc('pi/sessions') },
  ], unavailable: [] });
  assert.doesNotMatch(JSON.stringify(request), /never-persist|TOKEN|SECRET|executable|model|args/);
});

test('pi selectors preserve repeated flag precedence, both spellings and native tilde rule', () => {
  assert.deepEqual(derive({ pi: config('pi', { PI_CODING_AGENT_SESSION_DIR: '/env' },
    ['--session-dir=/first', '--session-dir', '~/last']) }).roots, [{ source: 'pi', path: loc('person/last') }]);
  assert.equal(derive({ pi: config('pi', { PI_CODING_AGENT_SESSION_DIR: '' }) }).roots[0].path, loc('person/.pi/agent/sessions'));
  assert.equal(derive({ codex: config('codex', { CODEX_HOME: '' }) }).roots[0].path, loc('person/.codex/sessions'));
});

test('refusals are per configuration, do not leak unrelated values or substitute defaults', () => {
  const request = derive({ good: config('codex', { CODEX_HOME: loc('ok') }),
    relative: config('claude', { CLAUDE_CONFIG_DIR: './wrong-cwd' }),
    unresolved: config('codex', { CODEX_HOME: { fromEnv: 'ABSENT' } }),
    malformed: config('pi', {}, ['--session-dir']), explicit: config('pi', {}, ['--session=/private/session']),
    unsupported: config('claude', { CLAUDE_CONFIG_DIR: '~/unsupported' }),
  });
  assert.deepEqual(request.roots, [{ source: 'codex', path: loc('ok/sessions') }]);
  assert.deepEqual(request.unavailable.map(({ configuration, reason }) => [configuration, reason]).sort(),
    [['explicit', 'malformed'], ['malformed', 'malformed'], ['relative', 'relative'], ['unresolved', 'unresolved-reference'], ['unsupported', 'malformed']]);
  assert.doesNotMatch(JSON.stringify(request), /wrong-cwd|private\/session|ABSENT/);
});

test('unreadable effective map records a deployment diagnostic; empty effective map explicitly retires', () => {
  assert.deepEqual(derive({}), { schemaVersion: 1, deployment, roots: [], unavailable: [] });
  const result = deriveCaptureRoots({ deployment, configurationError: true, env: { HOME: loc('person') } });
  assert.deepEqual(result.unavailable, [{ configuration: '(deployment)', selector: 'launch-configs', reason: 'unreadable' }]);
});

test('kernel doctor transport preserves an unknown future capture-roots row generically', async () => {
  const { doctorCaptureWarnings } = await import('../lib/doctor-capture.mjs');
  const rows = [{ code: 'capture-roots-future', message: 'Inspect future registration evidence.' }];
  const response = { schemaVersion: 1, status: 'warning', rows, lastRun: null, lastSuccess: null, lastFailure: null,
    backlog: { pending: false, setAsideCount: 0, setAside: [], truncated: false, failedCount: 0, failed: [], failedTruncated: false } };
  assert.deepEqual(doctorCaptureWarnings({ env: {}, run: () => ({ status: 0, stdout: JSON.stringify(response), stderr: '' }) }), rows);
});

test('resolved unreadable selector keeps its configuration label and requires the matching root path', () => {
  const path = loc('unreadable-codex'); fs.symlinkSync(loc('no-target'), path);
  const request = derive({ one: config('codex', { CODEX_HOME: path }), two: config('codex', { CODEX_HOME: path }) });
  assert.deepEqual(request.roots, [{ source: 'codex', path: join(path, 'sessions') }]);
  assert.deepEqual(request.unavailable, ['one', 'two'].map(configuration => ({ configuration, selector: 'CODEX_HOME', reason: 'unreadable', path: join(path, 'sessions') })));
});
