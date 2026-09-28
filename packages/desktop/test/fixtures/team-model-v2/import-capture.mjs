// Import the team model v2 capture (0.30 D1b): the REAL K1 kernel (oats feat/030-team-model, see
// provenance.json kernelTree) on a scratch Northwind build, run by capture-teams-v2.mjs with the
// Desktop's exact argv (--flag=value tokens). NEVER runs a CLI itself. <base>/<oats> placeholders
// become absolute fixture paths so the projections' absolute-path contracts apply unchanged.
// Refusal documents keep their exit. Usage: node import-capture.mjs CAPTURE_OUT_DIR
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [source] = process.argv.slice(2);
if (typeof source !== 'string' || !source.startsWith('/')) throw new Error('One explicit absolute capture directory required');
const target = fileURLToPath(new URL('.', import.meta.url));
const documents = ['version', 'teams-initial', 'teams-add', 'teams-add-exists', 'teams-add-shared', 'teams-default', 'soul-teams-show', 'soul-teams-add',
  'soul-teams-default', 'soul-teams-star-add', 'soul-teams-star-show', 'soul-teams-unknown', 'soul-teams-star-default', 'teams-remove-in-use',
  'teams-remove-shared', 'teams-after', 'souls', 'workspace-status', 'capabilities', 'inspect-soul', 'readiness-soul', 'preview', 'status',
  'inspect-home', 'soul-teams-clear-default', 'teams-final'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captured = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8'));
const provenance = { source: `${captured.capturedBy}; ${captured.fixture}; ${captured.script}`, kernelTree: captured.kernelTree, kernel: captured.kernel,
  redactions: ['<base> (capture scratch) → /fixture/base', '<oats> (kernel tree) → /fixture/oats'], files: {} };
for (const name of documents) {
  const original = readFileSync(join(source, `${name}.json`));
  const run = captured.documents.find(d => d.name === name);
  if (!run) throw new Error(`${name}: not in the capture provenance`);
  const text = original.toString('utf8').replaceAll('<base>', '/fixture/base').replaceAll('<oats>', '/fixture/oats');
  const bytes = Buffer.from(JSON.stringify(JSON.parse(text), null, 2) + '\n');
  provenance.files[name] = { argv: run.argv, exit: run.exit, commit: run.commit, sourceSha256: sha(original), fixtureSha256: sha(bytes) };
  writeFileSync(join(target, `${name}.json`), bytes);
}
writeFileSync(join(target, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(`imported ${documents.length} documents`);
