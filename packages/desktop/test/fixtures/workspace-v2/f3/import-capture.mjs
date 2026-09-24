// Import the F3 kernel capture (repo kernel, Northwind scratch, capture-f3.mjs
// + provenance.json alongside it). NEVER runs a CLI, runtime or native probe.
// <base>/<oats> placeholders become absolute fixture paths so projections'
// absolute-path contracts apply unchanged. Refusal documents keep their exit.
// Usage: node import-capture.mjs CAPTURE_OUT_DIR
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [source] = process.argv.slice(2);
if (typeof source !== 'string' || !source.startsWith('/')) throw new Error('One explicit absolute capture directory required');
const target = fileURLToPath(new URL('.', import.meta.url));
const documents = ['souls', 'version', 'preview-worktree-default', 'preview-worktree-purpose', 'preview-runtime-claude', 'preview-native-default',
  'preview-yolo', 'preview-branch-base', 'preview-base-unknown', 'preview-checkout-default', 'preview-checkout-as-worktree', 'preview-directory',
  'preview-soul-unknown', 'preview-clone-missing', 'apply-bound', 'apply-replayed', 'apply-stale', 'preview-after-apply',
  'preview-other', 'apply-idempotency-conflict', 'preview-race', 'apply-concurrent-a', 'apply-concurrent-b'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captured = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8'));
const provenance = { source: `${captured.capturedBy}; ${captured.fixture}; ${captured.script}`, kernel: captured.kernel,
  redactions: ['<base> (capture scratch) → /fixture/base', '<oats> (checkout) → /fixture/oats'], files: {} };
for (const name of documents) {
  const original = readFileSync(join(source, `${name}.json`));
  const run = captured.documents.find(d => d.name === name);
  if (!run) throw new Error(`${name}: not in the capture provenance`);
  const text = original.toString('utf8').replaceAll('<base>', '/fixture/base').replaceAll('<oats>', '/fixture/oats');
  const bytes = Buffer.from(JSON.stringify(JSON.parse(text), null, 2) + '\n');
  provenance.files[name] = { argv: run.argv, exit: run.exit, kernel: run.kernel, sourceSha256: sha(original), fixtureSha256: sha(bytes) };
  writeFileSync(join(target, `${name}.json`), bytes);
}
writeFileSync(join(target, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
