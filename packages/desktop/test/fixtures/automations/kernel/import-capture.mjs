// Import the automations capture (kernel 2b #213 + #215, feature automations, automationsApi 1). REAL captures; they replace the hand-built provisional fixtures:
// workspace triggers/schedules in member `agents` (runs here, elsewhere, owner-mismatch,
// a wrong-kind file) plus a local trigger and a local command schedule, on a scratch
// Northwind (capture-automations.mjs + provenance.json). This host: fixture-laptop; a stub
// gh logged in as fixture-bot. NEVER runs a CLI, runtime or native probe.
// Usage: node import-capture.mjs CAPTURE_OUT_DIR
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [source] = process.argv.slice(2);
if (typeof source !== 'string' || !source.startsWith('/')) throw new Error('One explicit absolute capture directory required');
const target = fileURLToPath(new URL('.', import.meta.url));
const documents = ['version', 'sync', 'schedule-add-local', 'trigger-add-local', 'trigger-list', 'schedule-list', 'trigger-test', 'trigger-test-mismatch',
  'trigger-status', 'schedule-test', 'schedule-test-elsewhere', 'trigger-disable', 'trigger-list-disabled', 'trigger-enable', 'schedule-disable', 'schedule-enable',
  'schedule-run-elsewhere', 'schedule-remove-workspace', 'trigger-remove-workspace', 'workspace-status', 'automations-refresh'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captured = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8'));
const provenance = { source: `${captured.capturedBy}; test/fixtures/northwind/build.mjs; capture-automations.mjs`, kernel: captured.kernel,
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
