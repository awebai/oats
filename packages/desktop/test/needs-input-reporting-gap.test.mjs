import test from 'node:test';
import assert from 'node:assert/strict';
import { needsInputReportingGap } from '../../client/needs-input-reporting-gap.mjs';
import { kernelRemoteRow, remoteRows } from './helpers/kernel-remote-row.mjs';

const source = version => ({ kind: 'package', package: 'oats.framework', version });
const forms = {
  drift: from => [{ name: 'oats.core', from, commit: 'recorded', current: { version: '9.0.0' }, status: 'moved' }],
  recorded: from => ({ 'oats.core': { from, commit: 'recorded', digest: 'sha256-recorded', materializedAt: '2026-10-01T00:00:00Z' } }),
};

for (const [form, modulesOf] of Object.entries(forms)) {
  test(`${form}: only a recorded framework semver below the hook release flags a Claude row`, () => {
    for (const [version, flagged] of [
      ['0.99.0', true], ['1.4.1', true], ['1.5.9', true], ['1.5.9+build.01', true],
      ['1.6.0-rc.1', true], ['1.6.0-0', true], ['1.6.0-rc.1+build.01', true],
      ['1.6.0', false], ['1.6.0+build.01', false], ['1.6.1-rc.1', false], ['1.16.0', false], ['2.0.0', false],
    ]) {
      const row = Object.freeze({ harness: 'claude', modules: modulesOf(source(version)) });
      const before = JSON.stringify(row);
      assert.equal(needsInputReportingGap(row), flagged ? version : null, version);
      assert.equal(JSON.stringify(row), before, 'the reader is pure');
    }
  });

  test(`${form}: malformed or missing versions never imply a reporting gap`, () => {
    for (const version of [undefined, null, 1.5, {}, '', '1.5', 'v1.5.9', ' 1.5.9', '1.5.9\n',
      '01.5.9', '1.05.9', '1.5.09', '1.5.9-', '1.5.9-rc..1', '1.5.9-01', '1.5.9-rc.01',
      '1.5.9+', '1.5.9+build..1', '1.5.9+<img>', '1.5.9-<script>']) {
      assert.equal(needsInputReportingGap({ harness: 'claude', modules: modulesOf(source(version)) }), null, String(version));
    }
  });

  test(`${form}: harness and module provenance must all match`, () => {
    const modules = modulesOf(source('1.5.9'));
    for (const harness of ['pi', 'codex', 'Claude', '', undefined, null])
      assert.equal(needsInputReportingGap({ harness, modules }), null, String(harness));
    for (const from of [null, {}, { ...source('1.5.9'), kind: 'member' }, { ...source('1.5.9'), package: 'other.package' }])
      assert.equal(needsInputReportingGap({ harness: 'claude', modules: modulesOf(from) }), null);
    // Lock drift, runtime state and other row facts do not supply or veto this evidence.
    assert.equal(needsInputReportingGap({ harness: 'claude', modules, running: false }), '1.5.9');
    const [remote] = remoteRows([kernelRemoteRow('remote-agent', { modules })]);
    assert.equal(needsInputReportingGap(remote), '1.5.9', 'the actual remote projection retains recorded provenance');
  });
}

test('older readers, absent oats.core, and malformed modules carry no evidence', () => {
  for (const row of [undefined, null, {}, { harness: 'claude' },
    ...[null, '', 42, [], {}, [null, {}], [{ name: 'oats.aweb', from: source('1.5.9') }],
      { 'oats.aweb': { from: source('1.5.9') } }, { 'oats.core': null }, { 'oats.core': {} },
      [{ name: 'oats.core', version: '1.5.9', current: { version: '1.5.9' } }],
    ].map(modules => ({ harness: 'claude', modules })),
  ]) assert.equal(needsInputReportingGap(row), null);
});
