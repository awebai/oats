// Import the F7 kernel capture (kernel #179 86faf9f6, teams contract): soul teams
// (inspect --soul), spawn preview teams (+ the join choice, bound by value), the
// apply, a provider without settings.join, and E_TEAM_CONFLICT. Northwind scratch:
// release-manager team: [engineering, global]; only engineering is mapped; stand-in
// providers nw.teams / nw.chat (capture-f7.mjs + provenance.json `standIn`). NEVER runs a CLI, runtime or native probe.
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
const documents = ['version', 'souls', 'inspect-soul', 'preview-teams-default', 'preview-teams-join', 'preview-teams-join-unmapped', 'apply-teams-join',
  'inspect-home', 'teams-initial', 'preview-teams-no-join', 'preview-teams-conflict', 'inspect-soul-conflict'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captured = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8'));
const provenance = { source: `${captured.capturedBy}; test/fixtures/northwind/build.mjs; capture-f7.mjs`, kernel: captured.kernel,
  redactions: ['<base> (capture scratch) → /fixture/base', '<oats> (checkout) → /fixture/oats'], standIn: captured.standIn, files: {} };
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
