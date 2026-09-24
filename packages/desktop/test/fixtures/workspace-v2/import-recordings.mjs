// Import already captured CLI bytes; NEVER runs a CLI, runtime or native probe.
// Usage: node import-recordings.mjs RECORDS_DIR INSTANCE_HOME OPERATOR_SCOPE
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [source, home, operator] = process.argv.slice(2);
if (![source, home, operator].every(v => typeof v === 'string' && v.startsWith('/'))) throw new Error('Three explicit absolute recording/redaction paths required');
const target = fileURLToPath(new URL('.', import.meta.url));
const files = { version: '01-version', 'workspace-status': '06-workspace-status', status: '09-status-stub' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = { source: 'Hand-built Northwind via source CLI; no invented deployment DTOs',
  sourceVersion: '0.25.5 with unreleased served-identity addition; NOT a released-version receipt',
  redactions: ['Instance-home prefix → /fixture/desktop-study', 'Remaining operator-scope prefix → /fixture/operator'],
  authority: '6c2302ad permits captured envelopes as study fixture shapes; native guards retained',
  warning: 'status exited86 after a prevented tmux probe. Its bytes are schema evidence, not a successful live-status receipt. Production transport must reject nonzero exits.', files: {} };
for (const [name, label] of Object.entries(files)) {
  const original = readFileSync(join(source, label + '.stdout'));
  JSON.parse(original.toString('utf8'));
  const text = original.toString('utf8').replaceAll(home.replace(/\/$/, ''), '/fixture/desktop-study').replaceAll(operator.replace(/\/$/, ''), '/fixture/operator');
  const bytes = Buffer.from(JSON.stringify(JSON.parse(text), null, 2) + '\n');
  const exit = JSON.parse(readFileSync(join(source, label + '.exit'), 'utf8'));
  const requestPath = join(source, label + '.request.json');
  const request = existsSync(requestPath) ? JSON.parse(readFileSync(requestPath, 'utf8')) : null;
  provenance.files[name] = { recording: label, sourceSha256: sha(original), fixtureSha256: sha(bytes), exit, sourceHead: request?.sourceHead ?? null };
  writeFileSync(join(target, name + '.json'), bytes);
}
writeFileSync(join(target, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
