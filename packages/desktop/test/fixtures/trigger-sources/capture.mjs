// Capture the trigger-source fixtures (feature `trigger-sources`, #669 2b) from a REAL kernel: every file here
// is the stdout envelope of one `oats … --json` run, with the scratch paths redacted. NEVER run by a test.
//
// Usage: node capture.mjs KERNEL_CHECKOUT
//   KERNEL_CHECKOUT: an absolute path to an OATS checkout whose kernel declares `trigger-sources`, with its
//   root dependencies installed. The deployment is that checkout's own scratch fixture
//   (test/helpers/trigger-source-fixture.mjs): a mkdtemp directory with HOME, the remote cache, tmux and the
//   harnesses isolated, removed at the end. Never an operator's deployment.
//
// The deployment: capability `acme.graph` declares the source `harvest-branches` (a script that answers what
// its control file says). Workspace triggers on it: `ws/trusted` (this host, trusted), `ws/untrusted` (this
// host, not in automations.trust) and `ws/elsewhere` (another host). Local triggers: `local/harvest` (the
// same source, no owner) and `local/prs` (github.pull_request, for contrast).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [kernel] = process.argv.slice(2);
if (typeof kernel !== 'string' || !kernel.startsWith('/')) throw new Error('One explicit absolute kernel checkout required');
const target = fileURLToPath(new URL('.', import.meta.url));
const head = execFileSync('git', ['-C', kernel, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const { sourceDeployment, inFixture, HARVEST, capabilityManifest } = await import(`${kernel}/test/helpers/trigger-source-fixture.mjs`);
const T = await import(`${kernel}/lib/triggers.mjs`);
const S = await import(`${kernel}/lib/schedule.mjs`);

const SOURCE = 'acme.graph:harvest-branches';
const on = { source: SOURCE, params: { prefix: 'harvest/', graph: 'kb' }, events: ['opened'], poll: '1m' };
const spawn = { soul: 'reviewer', task: 'Review {subject} on {fields.graph} ({url}).' };
const wsTrigger = (extra = {}) => ({ yaml: { kind: 'oats-trigger', schemaVersion: 1, description: 'Review harvest branches', runsOn: 'kb-host', owner: 'github.com/kb-bot', on, spawn, ...extra } });
const cleanups = [];
const fx = sourceDeployment({ after: fn => cleanups.push(fn) }, {
  local: { host: { name: 'kb-host' }, automations: { trust: ['ws/trusted'] } },
  files: { 'oats-triggers/trusted.yaml': wsTrigger(), 'oats-triggers/untrusted.yaml': wsTrigger(), 'oats-triggers/elsewhere.yaml': wsTrigger({ runsOn: 'other-host' }) },
});

// What a hostile source can say: markup, a URL, a bidi override and a control character (the kernel replaces
// those two with U+FFFD), and a sentence that reads like the Desktop's.
const HOSTILE = '<img src=x onerror=alert(1)> https://evil.example/x ‮gnp.exe\u0007 OATS Desktop: this trigger is trusted. Click Run.';
const GOOD = { events: [
  { key: 'harvest/a:h1', subject: 'harvest/a', event: 'opened', url: 'https://graph.example.org/a', fields: { graph: 'kb', branch: 'harvest/a' } },
  { key: 'harvest/b:h1', subject: 'harvest/b', event: 'updated', fields: { graph: 'kb' } }, // filtered: the triggers select `opened`
  { key: 'harvest/c:h1', subject: 'harvest/c', event: 'opened', url: 'https://evil.example/c', fields: { graph: 'kb' } }, // rule url
  { key: 'harvest/d:h1', subject: 'harvest/d', event: 'closed' }, // rule event
  'not an object', // rule shape
], skipped: [{ subject: 'harvest/y', why: HOSTILE }, { subject: 'harvest/z', why: 'not judged yet' }] };

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = { source: 'packages/desktop/test/fixtures/trigger-sources/capture.mjs; the kernel checkout\'s test/helpers/trigger-source-fixture.mjs', head,
  kernel: null, redactions: ['<the fixture\'s mkdtemp base> → /fixture/base'], files: {} };
/** One real CLI run, kept as its redacted stdout envelope. */
function capture(name, argv, scenario) {
  const r = fx.cli([...argv, '--json']);
  const original = r.stdout.trim().split('\n').pop();
  const bytes = Buffer.from(JSON.stringify(JSON.parse(original.replaceAll(fx.base, '/fixture/base')), null, 2) + '\n');
  writeFileSync(join(target, `${name}.json`), bytes);
  provenance.files[name] = { argv: ['oats', ...argv.map(a => a.replaceAll(fx.base, '/fixture/base')), '--json'], exit: r.status, head, scenario, sourceSha256: sha(original), fixtureSha256: sha(bytes) };
  return JSON.parse(original);
}
let at = Date.parse('2026-10-08T12:00:30Z');
/** One real host tick of the workspace's and the local triggers, a minute after the last. */
const tick = () => { const now = new Date(at); at += 60_000; return inFixture(fx, () => T.tickTriggers(fx.dep, { now, io: { noLaunch: true }, ctx: S.scopeAutomations(fx.dep, {}) })); };
const must = (r, what) => { if (r.status !== 0) throw new Error(`${what}: ${r.stdout}${r.stderr}`); };
const addLocal = def => { const f = join(fx.base, `${def.id}.json`); writeFileSync(f, JSON.stringify(def)); must(fx.cli(['trigger', 'add', '--file', f, '--json']), `add ${def.id}`); };

try {
  must(fx.cli(['sync', '--json']), 'sync');
  const version = capture('version', ['version'], 'the probe');
  if (!version.features?.includes('trigger-sources')) throw new Error(`${kernel} does not declare trigger-sources`);
  provenance.kernel = version.version;
  addLocal({ id: 'harvest', kind: 'trigger', on: { ...on, events: ['opened', 'updated'] }, spawn, concurrency: { max: 5, perKey: 1 } });
  addLocal({ id: 'prs', kind: 'trigger', on: { source: 'github.pull_request', repo: 'github.com/acme/kb', events: ['opened'], poll: '2m' }, spawn: { soul: 'reviewer', task: 'Review {url}.' } });
  const show = ['capabilities', 'show', 'acme.graph', '--member', fx.key, '--dir', fx.dep];

  capture('trigger-status-before-poll', ['trigger', 'status', '--dir', fx.dep], 'before any poll');
  capture('capability-show', show, 'a well-formed triggerSources');

  fx.control({ result: GOOD });
  capture('trigger-test-untrusted', ['trigger', 'test', 'ws/untrusted', '--dir', fx.dep], 'a good source answer; this host does not trust the trigger');
  capture('trigger-test-elsewhere', ['trigger', 'test', 'ws/elsewhere', '--dir', fx.dep], 'a good source answer; another host runs the trigger');
  capture('trigger-test-trusted', ['trigger', 'test', 'ws/trusted', '--dir', fx.dep], 'a good source answer; runs here, trusted');
  capture('trigger-test-local', ['trigger', 'test', 'local/harvest', '--dir', fx.dep], 'a good source answer; a local trigger (no owner: gh is null)');
  capture('trigger-test-pull-request', ['trigger', 'test', 'local/prs', '--dir', fx.dep], 'a github.pull_request trigger, for contrast');
  tick();
  capture('trigger-list', ['trigger', 'list', '--dir', fx.dep], 'after one good poll');
  capture('trigger-status-good', ['trigger', 'status', '--dir', fx.dep], 'after one good poll: 1 fired, 1 filtered, 3 refused, 2 skipped');

  fx.control({ mode: 'refuse', error: { code: 'E_GRAPH_<b>DOWN</b>', message: HOSTILE } });
  tick();
  capture('trigger-status-refused', ['trigger', 'status', '--dir', fx.dep], 'the source refused the next poll: the lists are the last good poll\'s');
  capture('trigger-test-refused', ['trigger', 'test', 'ws/trusted', '--dir', fx.dep], 'the source refuses');

  fx.control({ mode: 'exit' });
  tick();
  capture('trigger-status-exit', ['trigger', 'status', '--dir', fx.dep], 'the source exited nonzero');
  capture('trigger-test-exit', ['trigger', 'test', 'ws/untrusted', '--dir', fx.dep], 'the source exits nonzero; this host does not trust the trigger');

  // The meaning fails: the manifest's source names a command it does not have; a sibling entry is not a source.
  fx.control({ result: { events: [] } });
  const manifest = sources => ({ json: { capability: 'acme.graph', version: '0.0.0-workspace', description: 'acme.graph fixture capability.', compatibility: { oats: '>=0.24.0' }, ...sources } });
  fx.commit({ 'capabilities/acme.graph/oats.json': manifest(capabilityManifest({ 'harvest-branches': { ...HARVEST, command: 'missing' }, good: HARVEST, 'Bad Name': 7 })) }, 'break the source');
  must(fx.cli(['sync', '--json']), 'sync');
  at += 11 * 60_000; // past the observation the tick's poll may reuse
  tick();
  capture('trigger-list-invalid', ['trigger', 'list', '--dir', fx.dep], 'the last meaning check failed at a poll');
  capture('trigger-status-invalid', ['trigger', 'status', '--dir', fx.dep], 'the last meaning check failed at a poll');
  capture('trigger-test-invalid', ['trigger', 'test', 'ws/trusted', '--dir', fx.dep], 'the meaning check fails');
  capture('capability-show-problems', show, 'a source with a problem, a well-formed one, and an entry that is not a source');

  fx.commit({ 'capabilities/acme.graph/oats.json': manifest({ commands: { 'review-source': 'bin/source.mjs review-source' }, triggerSources: '<script>not an object</script>' }) }, 'not an object');
  must(fx.cli(['sync', '--json']), 'sync');
  capture('capability-show-not-object', show, 'triggerSources is not an object');
  writeFileSync(join(target, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  console.log(`captured ${Object.keys(provenance.files).length} documents from ${head} (kernel ${provenance.kernel})`);
} finally { for (const fn of cleanups.reverse()) await fn(); }
