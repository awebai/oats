// Import the teams-panel kernel capture (teams contract 2026-09-25; 1.16 names per its
// AMENDMENT, c129125a): the live-instance operations messaging:teams|join|leave through
// the real kernel's `oats operation run`, on a Northwind scratch with the REAL oats.aweb
// provider (its release tag) and a fake `aw` standing in for the aweb server
// (capture-teams-real.mjs; provenance.json `provider` and `fakeAw`). NEVER runs a CLI, runtime or native probe.
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
const documents = ['version', 'inspect-home', 'inspect-soul', 'teams-initial', 'join-dev', 'join-reviewers', 'join-not-eligible',
  'leave-default', 'leave-reviewers', 'teams-joined', 'join-missing-arg', 'teams-on-soul'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captured = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8'));
const provenance = { source: `${captured.capturedBy}; test/fixtures/northwind/build.mjs; ${captured.script || 'capture-teams.mjs'}`, kernel: captured.kernel,
  redactions: ['<base> (capture scratch) → /fixture/base', '<oats> (checkout) → /fixture/oats'],
  ...(captured.provider ? { provider: captured.provider, fakeAw: captured.fakeAw } : { standIn: captured.standIn }), files: {} };
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
