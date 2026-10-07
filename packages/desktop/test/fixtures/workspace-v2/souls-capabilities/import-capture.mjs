// Import the souls-capabilities kernel capture (capture.mjs; awebai/oats#745): `oats version`, `oats souls`
// and `oats capabilities` from one deployment built with the kernel's own test helpers (provenance.json
// `scenario`). <base>/<pkg> placeholders become absolute fixture paths. NEVER runs a CLI.
// Usage: node import-capture.mjs CAPTURE_OUT_DIR KERNEL_COMMIT
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [source, commit] = process.argv.slice(2);
if (typeof source !== 'string' || !source.startsWith('/') || !/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('An absolute capture directory and the kernel commit are required');
const target = fileURLToPath(new URL('.', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const runs = JSON.parse(readFileSync(join(source, 'runs.json'), 'utf8'));
const provenance = JSON.parse(readFileSync(join(target, 'provenance.json'), 'utf8'));
provenance.kernel = { pr: 'awebai/oats#745', commit }; // the oats tree capture.mjs ran in
provenance.files = {};
for (const run of runs) {
  const original = readFileSync(join(source, `${run.name}.json`));
  if (sha(original) !== run.sha256) throw new Error(`${run.name}: not the captured bytes`);
  const text = original.toString('utf8').replaceAll('<base>', '/fixture/base').replaceAll('<pkg>', '/fixture/pkg');
  const bytes = Buffer.from(JSON.stringify(JSON.parse(text), null, 2) + '\n');
  provenance.files[run.name] = { argv: run.argv, cwd: run.cwd, exit: run.exit, sourceSha256: run.sha256, fixtureSha256: sha(bytes) };
  writeFileSync(join(target, `${run.name}.json`), bytes);
}
writeFileSync(join(target, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
