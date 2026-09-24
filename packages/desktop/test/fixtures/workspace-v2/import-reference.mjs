// Import the maintainer's exit-0 reference capture (0.25.6 kernel, Northwind,
// capture.mjs + provenance.json alongside it). NEVER runs a CLI, runtime or
// native probe. The capture's <base>/<oats> placeholders become absolute
// fixture paths so the projection's absolute-path contract applies unchanged.
// Usage: node import-reference.mjs CAPTURE_DIR
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [source] = process.argv.slice(2);
if (typeof source !== 'string' || !source.startsWith('/')) throw new Error('One explicit absolute capture directory required');
const target = fileURLToPath(new URL('.', import.meta.url));
// fixture name → capture document name
const files = { version: 'version', 'workspace-status': 'workspace-status-approved', status: 'status', 'status-identities': 'status-identities' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captured = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8'));
const provenance = { source: `${captured.capturedBy}; ${captured.fixture}`, kernel: captured.kernel,
  redactions: ['<base> (capture tmpdir) → /fixture/base', '<oats> (checkout) → /fixture/oats'],
  note: 'Replaces the earlier exit-86 study capture. Shape diff against it: the study instance also carried instance.json passthrough keys (decision, layers, spawnCompleted, spawnIdempotencyKey, team, wake) from an idempotent spawn; the Desktop reads none of them. No field the Desktop reads differed.',
  files: {} };
for (const [name, document] of Object.entries(files)) {
  const original = readFileSync(join(source, document + '.json'));
  const run = captured.documents.find(d => d.name === document);
  if (!run || run.exit !== 0) throw new Error(`${document}: capture is not an exit-0 document`);
  const text = original.toString('utf8').replaceAll('<base>', '/fixture/base').replaceAll('<oats>', '/fixture/oats');
  const bytes = Buffer.from(JSON.stringify(JSON.parse(text), null, 2) + '\n');
  provenance.files[name] = { document, argv: run.argv, exit: run.exit, kernel: run.kernel, sourceSha256: sha(original), fixtureSha256: sha(bytes) };
  writeFileSync(join(target, name + '.json'), bytes);
}
writeFileSync(join(target, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
