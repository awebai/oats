// Capability warnings on the REAL kernel (docs/desktop-cli-api.md § "Capability warnings
// (`hook-event-unsupported`, OATS 0.49.0)"; docs/capabilities.md#manifest). A scratch workspace (the
// repository's own minimal deployment, test/helpers/v2-deployment.mjs) has one member capability,
// acme.tool, whose oats.json declares a hook event this kernel does not run (`"on-merge": "./x.sh"`), and
// one soul, dev, that composes it. Each answer that shows the capability is read the way the Desktop reads
// it: the same exec owner builds the argv and parses the envelope (workspace-cli.mjs, cli-adapter.mjs,
// readiness-cli.mjs, spawn-preview-cli.mjs, deployment-read-cli.mjs), then the Desktop's own reader
// projects it. The kernel's raw `warnings` are asserted as well, so the test means something on its own.
// Everything happens in mkdtemp directories with HOME, the remote cache, tmux and the harnesses
// isolated by the helper: never the operator's deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cliWorkspace } from '../packages/client/workspace-cli.mjs';
import { cliCapability } from '../packages/client/cli-adapter.mjs';
import { cliReadiness } from '../packages/desktop/readiness-cli.mjs';
import { cliSpawnPreview } from '../packages/client/spawn-preview-cli.mjs';
import { cliDeploymentRead } from '../packages/client/deployment-read-cli.mjs';
import { workspaceStatusData } from '../packages/client/deployment-data.mjs';
import { capabilityShowData } from '../packages/client/capability-show-contract.mjs';
import { inspectData } from '../packages/client/inspect-contract.mjs';
import { readinessData } from '../packages/client/readiness-contract.mjs';
import { previewData, previewComposedFrom } from '../packages/client/spawn-preview-contract.mjs';
import { warningsOf, previewWarningsOf } from '../packages/client/capability-warnings-contract.mjs';
import { v2Deployment, CLI } from './helpers/v2-deployment.mjs';
import { APPROVED_HOOKS } from '../lib/capability-contract.mjs';

const CAPABILITY = 'acme.tool', SOUL = 'dev', EVENT = 'on-merge';
let cli = null;
const fx = v2Deployment({
  souls: { [SOUL]: { soul: { capabilities: { [CAPABILITY]: { from: 'here' } } } } },
  capabilities: { [CAPABILITY]: { manifest: { hooks: { [EVENT]: './x.sh' } }, files: { 'x.sh': { text: '#!/bin/sh\nexit 0\n', mode: 0o755 } } } },
});
test.after(() => fx.cleanup());

/** Every exec the Desktop's owners make runs the repository's kernel in the fixture's isolated environment
 * (owners that take `io.env` scrub it themselves; cli-adapter's runJson takes none, so it is set here). */
const argvs = [];
const io = () => ({
  env: fx.env,
  exec: (bin, argv, options, callback) => { argvs.push(argv); return execFile(bin, argv, { ...options, env: options.env ?? fx.env }, callback); },
});
/** The kernel's message for an event it does not run (lib/capability-contract.mjs APPROVED_HOOKS). */
const message = () => `capability ${CAPABILITY} declares hook "${EVENT}", which this kernel does not run; it is ignored (this kernel runs ${[...APPROVED_HOOKS].join(', ')})`;
/** The one warning, as the kernel answers it: a repo key and a repository-relative path, never a host path. */
const expected = () => ({ code: 'hook-event-unsupported', capability: CAPABILITY, path: `${fx.key}:capabilities/${CAPABILITY}/oats.json#/hooks/${EVENT}`, message: message() });
function assertWarningShape(w) {
  assert.equal(w.code, 'hook-event-unsupported');
  assert.equal(w.capability, CAPABILITY);
  assert.ok(!w.path.startsWith('/'), `path is not an absolute host path: ${w.path}`);
  assert.ok(w.path.endsWith(`#/hooks/${EVENT}`), w.path);
  assert.equal(w.message, message());
}

test.before(() => {
  const synced = fx.cli(['sync', '--json']);
  assert.equal(synced.status, 0, synced.stdout + synced.stderr);
  const probe = fx.cli(['version', '--json']);
  assert.equal(probe.status, 0, probe.stdout + probe.stderr);
  // What the Desktop's locator keeps for an accepted CLI: the probe, `ok`, and the absolute bin.
  cli = { ...JSON.parse(probe.stdout), ok: true, bin: CLI };
});

test('capabilities show --member: the raw warning, and capabilityShowData projects it', async () => {
  const selector = { name: CAPABILITY, kind: 'member', repoKey: fx.key };
  const answer = await cliWorkspace(cli, { action: 'capability-show', context: fx.dep, name: CAPABILITY, member: fx.key }, io());
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(argvs.at(-1), ['capabilities', 'show', CAPABILITY, '--member', fx.key, '--dir', fx.dep, '--json']);
  const raw = answer.document.result;
  assert.deepEqual(raw.warnings, [expected()], 'the kernel answers one warning, at its pointer');
  assertWarningShape(raw.warnings[0]);
  assert.deepEqual(raw.problems, [], 'a warning, not a problem: the capability composes');
  const data = capabilityShowData(raw, { selector });
  assert.ok(data, 'the show reader reads the live answer');
  assert.deepEqual(data.warnings, [expected()], 'the projection keeps code, capability, path and message');
});

test('inspect --soul: the raw warning passes through inspectData, and warningsOf reads it', async () => {
  const answer = await cliCapability(cli.bin, { action: 'inspect', context: fx.dep, soul: SOUL, agentsRoot: fx.root, localCwd: fx.dep }, io());
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(argvs.at(-1), ['inspect', '--dir', fx.dep, '--soul', SOUL, '--agents-root', fx.root, '--json']);
  assert.deepEqual(answer.result.warnings, [expected()]);
  const data = inspectData(answer.result, { agent: { name: SOUL } });
  assert.ok(data, 'the inspect reader reads the live answer');
  assert.deepEqual(warningsOf(data.warnings), [expected()]);
});

test('readiness --soul: the raw warning, and readinessData projects it without changing the ready state', async () => {
  const target = { workspace: fx.key, context: fx.dep, observedAs: 'soul', selector: { kind: 'soul', soul: SOUL, agentsRoot: fx.root } };
  const answer = await cliReadiness(cli.bin, { target }, io());
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(argvs.at(-1), ['readiness', '--dir', fx.dep, '--soul', SOUL, '--agents-root', fx.root, '--policy', '--json']);
  assert.deepEqual(answer.result.warnings, [expected()]);
  const data = readinessData(answer.result, target);
  assert.ok(data, 'the readiness reader reads the live answer');
  assert.equal(data.summary.ready, answer.result.summary.ready, 'a warning never changes the ready state');
  assert.deepEqual(data.warnings, [expected()], 'readinessData projects the warnings');
});

test('spawn --preview: the raw warning strings, and previewData projects them', async () => {
  const target = { workspace: fx.key, context: fx.dep, selector: { soul: SOUL, agentsRoot: fx.root } };
  const answer = await cliSpawnPreview(cli, { target, choices: { purpose: 'warn' } }, io());
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(argvs.at(-1), ['spawn', SOUL, '--dir', fx.dep, '--agents-root', fx.root, '--preview', '--purpose', 'warn', '--json']);
  assert.deepEqual(answer.result.warnings, [message()], "the preview's warnings are the messages, as strings");
  const data = previewData(answer.result, target, { composedFrom: previewComposedFrom(cli) });
  assert.ok(data, 'the preview reader reads the live answer');
  assert.deepEqual(previewWarningsOf(answer.result.warnings), [message()]);
  assert.deepEqual(data.warnings, [message()], 'previewData projects the warning strings');
});

test('workspace status: the raw warning, and workspaceStatusData keeps capability and path', async () => {
  const answer = await cliDeploymentRead(cli, { action: 'workspace-status', context: fx.dep }, io());
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(argvs.at(-1), ['workspace', 'status', '--dir', fx.dep, '--json']);
  const raw = answer.document.result.warnings.filter((w) => w.code === 'hook-event-unsupported');
  assert.deepEqual(raw, [expected()]);
  const data = workspaceStatusData(answer.document, fx.dep);
  assert.ok(data, 'the status reader reads the live answer');
  const rows = data.warnings.filter((w) => w.code === 'hook-event-unsupported');
  assert.deepEqual(rows, [expected()], 'the row keeps code, message, capability and path');
});
