// The Desktop's kernel line (F2b): the version band is >=0.25.8 <0.28.0 so it
// runs against main's kernel before 0.26.0 is tagged; the REAL gate is the
// positive packages-no-approval feature. A released 0.25.x kernel (no
// feature) is accepted by the locator but gets the "update OATS" state from
// every workspace and deployment read; the same version WITH the feature works.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acceptProbe } from '../cli-locator.mjs';
import { workspaceGate } from '../workspace-cli.mjs';
import { deploymentReadGate } from '../renderer/deployment-contract.mjs';

const released = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/f2/version.json', import.meta.url), 'utf8'));
const probe = (version, features) => ({ ...released, version, features });
const accepted = p => ({ ...p, ok: true, bin: '/fixture/bin/oats' });

test('0.25.8 without packages-no-approval is refused by every gate; with it, accepted', () => {
  const without = probe('0.25.8', released.features.filter(f => f !== 'packages-no-approval'));
  const withIt = probe('0.25.8', [...without.features, 'packages-no-approval']);
  for (const p of [without, withIt]) assert.equal(acceptProbe(p).ok, true, 'both are inside the version band');
  const older = accepted(without), current = accepted(withIt);
  assert.equal(workspaceGate(older).reason.code, 'E_WORKSPACE_FEATURE');
  assert.match(workspaceGate(older).reason.message, /Update OATS/);
  for (const action of ['status', 'workspace-status']) {
    const refused = deploymentReadGate(older, action);
    assert.equal(refused.reason.code, 'E_DEPLOYMENT_FEATURE'); assert.equal(refused.reason.feature, 'packages-no-approval');
    assert.equal(deploymentReadGate(current, action), null, action);
  }
  assert.equal(workspaceGate(current), null);
});

test('the version band alone never decides: 0.26.x without the feature is refused too; below 0.25.8 is not a kernel at all', () => {
  const noFeature = accepted(probe('0.26.3', released.features.filter(f => f !== 'packages-no-approval')));
  assert.equal(acceptProbe(noFeature).ok, true);
  assert.equal(workspaceGate(noFeature).reason.code, 'E_WORKSPACE_FEATURE');
  assert.equal(acceptProbe(probe('0.25.7', [...released.features, 'packages-no-approval'])).ok, false);
  assert.equal(acceptProbe(probe('0.27.4', [...released.features, 'packages-no-approval'])).ok, true, '0.27 (the harness rename) is inside the band');
  assert.equal(acceptProbe(probe('0.28.0', [...released.features, 'packages-no-approval'])).ok, false);
});
