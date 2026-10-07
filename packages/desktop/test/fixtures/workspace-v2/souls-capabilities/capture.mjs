// Capture `oats version`, `oats souls` and `oats capabilities` (feature souls-capabilities) from a kernel tree
// into OUT, with <base>/<pkg> placeholders for the scratch paths; import-capture.mjs then writes the fixture.
// Scenario: the kernel's own soulCapabilities fixture (test/desktop-facts.test.mjs; helpers v2-deployment.mjs
// and package-repo.mjs), extended for Desktop: a private (repo-owned) capability dev declares, a member soul
// `keeper` sharing the package soul's bare name, and a soul disabled here (capabilities null).
// Runs the kernel CLI in an isolated scratch deployment (no network, no operator state).
// Usage: node capture.mjs KERNEL_TREE OUT_DIR   (KERNEL_TREE: an oats checkout at or after awebai/oats#745)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const [kernel, out] = process.argv.slice(2);
const { v2Deployment } = await import(join(kernel, 'test/helpers/v2-deployment.mjs'));
const { packageRepo } = await import(join(kernel, 'test/helpers/package-repo.mjs'));
const pkg = packageRepo();
const fx = v2Deployment({
  souls: {
    dev: { soul: { knowledge: 'none', capabilities: { 'acme.own': { from: 'here' }, acme_z: { from: 'here' }, 'acme.ws': { from: 'here' }, 'acme.off': 'off', 'acme.private': { from: 'here' } } } },
    keeper: { soul: { capabilities: { 'acme.own': { from: 'here' } } } },
    off: { soul: { capabilities: { 'acme.own': { from: 'here' } } } },
  },
  capabilities: { ...Object.fromEntries(['acme.own', 'acme_z', 'acme.ws', 'acme.off'].map(id => [id, { manifest: {} }])),
    'acme.private': { manifest: { private: true } }, notes: { manifest: { layer: 'knowledge' } }, chat: { manifest: { layer: 'messaging' } } },
  local: { souls: { disabled: ['off'] } },
});
const runs = [];
try {
  fx.commit({ 'oats-workspace.yaml': { yaml: { schemaVersion: 2, name: 'fixture', members: [fx.ref], teams: { global: { description: 'Fixture team' } },
    packages: { 'acme.pkg': `${pkg.ref}@v1.0.0` },
    defaults: { knowledge: { notes: { from: fx.key } }, messaging: { chat: { from: fx.key } }, tasks: 'none',
      capabilities: { 'acme.ws': { from: fx.key }, 'acme.off': { from: fx.key }, 'acme-tool': { from: 'package' } } } } } }, 'soul capabilities');
  const sync = fx.cli(['sync', '--json']); if (sync.status !== 0) throw new Error(`sync: ${sync.stdout}${sync.stderr}`);
  mkdirSync(out, { recursive: true });
  for (const [name, argv] of [['version', ['version', '--json']], ['souls', ['souls', '--json']], ['capabilities', ['capabilities', '--json']]]) {
    const r = fx.cli(argv);
    const text = r.stdout.replaceAll(pkg.base, '<pkg>').replaceAll(fx.base, '<base>');
    writeFileSync(join(out, `${name}.json`), text);
    runs.push({ name, argv: ['oats', ...argv], cwd: '<base>/deployment', exit: r.status, sha256: createHash('sha256').update(text).digest('hex') });
  }
  writeFileSync(join(out, 'runs.json'), JSON.stringify(runs, null, 2) + '\n');
} finally { fx.cleanup(); pkg.cleanup(); }
