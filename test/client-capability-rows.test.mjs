// A capability row's pure rules in the shared home (packages/client/capability-rows.mjs): "Used by", as the
// Desktop's capability page draws it, is capabilityUsers — the souls, each with its instances that carry the
// module and how many of those are behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityUsers } from '../packages/client/capability-rows.mjs';

const ROOT = '/w/agents', OTHER = '/elsewhere/agents';
const member = { name: 'notes', kind: 'member', repoKey: 'github.com/acme/agents' };
const pkg = { name: 'tracker', kind: 'package', package: 'acme.tools' };
/** An instance of `agent` under `agentsRoot`, carrying `modules` (a list, or a map by name). */
const instance = (name, agent, modules, agentsRoot = ROOT) => ({ instance: name, agent, agentsRoot, modules });
const shape = users => users.map(({ soul, carrying, behind }) => [soul.name, carrying.map(i => i.instance), behind]);

test('capabilityUsers without composition: the souls whose instances carry it, each with its carrying instances and how many are behind', () => {
  const instances = [
    instance('dev-1', 'dev', [{ name: 'notes', status: 'current' }]),
    instance('dev-2', 'dev', { notes: { status: 'moved' } }), // a map by name reads the same
    instance('dev-3', 'dev', [{ name: 'other' }]), // carries something else
    instance('ops-1', 'ops', [{ name: 'notes', status: 'moved' }]),
    instance('ops-far', 'ops', [{ name: 'notes', status: 'moved' }], OTHER), // another agents root: another soul
    instance('nobody', null, [{ name: 'notes' }]), // no agent: no soul
  ];
  assert.deepEqual(shape(capabilityUsers(member, { instances, composition: false })), [['dev', ['dev-1', 'dev-2'], 1], ['ops', ['ops-1'], 1]]);
  // Each soul is the first instance's agents root: ops under ROOT; the instance elsewhere is not counted for it.
  assert.deepEqual(capabilityUsers(member, { instances }).map(u => u.soul), [{ name: 'dev', agentsRoot: ROOT }, { name: 'ops', agentsRoot: ROOT }]);
  // The souls list is not read without composition.
  assert.deepEqual(shape(capabilityUsers(member, { souls: [{ name: 'x', capabilities: [{ ...member }] }], instances: [] })), []);
  assert.deepEqual(capabilityUsers(member, {}), []);
});

test('capabilityUsers with composition: the souls whose composition includes it, each with the instances of its roster agent name', () => {
  const souls = [
    { name: 'dev', agentsRoot: ROOT, capabilities: [{ name: 'notes', kind: 'member', repoKey: 'github.com/acme/agents' }] },
    { name: 'idle', agentsRoot: ROOT, capabilities: [{ name: 'notes', kind: 'member', repoKey: 'github.com/acme/agents' }] }, // no instance yet
    { name: 'other-repo', agentsRoot: ROOT, capabilities: [{ name: 'notes', kind: 'member', repoKey: 'github.com/acme/else' }] }, // not this row
    { name: 'unresolved', agentsRoot: ROOT, capabilities: null },
    { name: 'reviewer', soulKind: 'package', package: 'acme.tools', agentsRoot: ROOT, capabilities: [{ name: 'tracker', kind: 'package', package: 'acme.tools' }] },
  ];
  const instances = [
    instance('dev-1', 'dev', [{ name: 'notes', status: 'moved' }]),
    instance('dev-2', 'dev', []), // composed, but its recorded modules do not carry it: not counted
    instance('dev-far', 'dev', [{ name: 'notes' }], OTHER),
    instance('rev-1', 'acme-tools--reviewer', [{ name: 'tracker', status: 'moved' }]), // a package soul's roster name
    instance('rev-bare', 'reviewer', [{ name: 'tracker' }]), // the bare name is not that soul's instance
  ];
  assert.deepEqual(shape(capabilityUsers(member, { souls, instances, composition: true })), [['dev', ['dev-1'], 1], ['idle', [], 0]]);
  assert.deepEqual(shape(capabilityUsers(pkg, { souls, instances, composition: true })), [['reviewer', ['rev-1'], 1]]);
  // The soul is the souls list's own row, not a copy.
  assert.equal(capabilityUsers(member, { souls, instances, composition: true })[0].soul, souls[0]);
  // The roster alone answers nothing with composition: a soul that does not compose it is not listed.
  assert.deepEqual(capabilityUsers(member, { souls: [], instances, composition: true }), []);
});
