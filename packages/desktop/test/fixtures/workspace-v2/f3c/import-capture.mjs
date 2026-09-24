// Import the F3c kernel capture (repo kernel, Northwind scratch + one stand-in
// messaging package, capture-f3c.mjs + provenance.json alongside it). NEVER
// runs a CLI, runtime or native probe. <base>/<oats> placeholders become
// absolute fixture paths. The stand-in's manifest and the oats.aweb
// declaration it copies are recorded in provenance.json (`standIn`).
// Usage: node import-capture.mjs CAPTURE_OUT_DIR
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [source] = process.argv.slice(2);
if (typeof source !== 'string' || !source.startsWith('/')) throw new Error('One explicit absolute capture directory required');
const target = fileURLToPath(new URL('.', import.meta.url));
const documents = ['version', 'souls', 'preview-messaging-default', 'preview-messaging-local', 'preview-messaging-global',
  'preview-provider-unknown', 'apply-messaging-global', 'apply-messaging-mismatch'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const place = text => text.replaceAll('<base>', '/fixture/base').replaceAll('<oats>', '/fixture/oats');
const captured = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8'));
const provenance = { source: `${captured.capturedBy}; ${captured.fixture}; ${captured.script}`, kernel: captured.kernel,
  redactions: ['<base> (capture scratch) → /fixture/base', '<oats> (checkout) → /fixture/oats'],
  standIn: JSON.parse(place(JSON.stringify(captured.standIn))), files: {} };
for (const name of documents) {
  const original = readFileSync(join(source, `${name}.json`));
  const run = captured.documents.find(d => d.name === name);
  if (!run) throw new Error(`${name}: not in the capture provenance`);
  const bytes = Buffer.from(JSON.stringify(JSON.parse(place(original.toString('utf8'))), null, 2) + '\n');
  provenance.files[name] = { argv: run.argv, exit: run.exit, kernel: run.kernel, sourceSha256: sha(original), fixtureSha256: sha(bytes) };
  writeFileSync(join(target, `${name}.json`), bytes);
}
// The home's recorded providers after the bound apply (read from instance.json by the capture).
const recorded = readFileSync(join(source, 'apply-messaging-global-instance.json'));
const recordedBytes = Buffer.from(JSON.stringify(JSON.parse(place(recorded.toString('utf8'))), null, 2) + '\n');
provenance.files['apply-messaging-global-instance'] = { argv: ['(read)', '<home>/instance.json'], exit: 0, kernel: captured.kernel, sourceSha256: sha(recorded), fixtureSha256: sha(recordedBytes) };
writeFileSync(join(target, 'apply-messaging-global-instance.json'), recordedBytes);
writeFileSync(join(target, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
