// Import the harness capture (kernel #194, feature harness, OATS 0.27.0): the
// Desktop's own commands with the new names (--harness, harness/harnesses) and
// the deprecated spellings (--runtime flag, launch-config `runtime:`) that answer
// the envelope warning deprecated-runtime-name. Northwind scratch from the kernel
// tree's own build.mjs (capture-harness.mjs + provenance.json). NEVER runs a CLI,
// runtime or native probe. <base>/<oats> placeholders become absolute fixture paths.
// Usage: node import-capture.mjs CAPTURE_OUT_DIR
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [source] = process.argv.slice(2);
if (typeof source !== 'string' || !source.startsWith('/')) throw new Error('One explicit absolute capture directory required');
const target = fileURLToPath(new URL('.', import.meta.url));
const documents = ['version', 'inspect-soul', 'preview-default', 'preview-harness-claude', 'preview-runtime-claude', 'preview-harness-disagree',
  'apply-harness-claude', 'inspect-home', 'status', 'launch-config-set', 'launch-config-set-runtime', 'launch-config-list', 'launch-config-preview',
  'schedule-add', 'schedule-list', 'instance-events'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captured = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8'));
const provenance = { source: `${captured.capturedBy}; test/fixtures/northwind/build.mjs; capture-harness.mjs`, kernel: captured.kernel,
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
