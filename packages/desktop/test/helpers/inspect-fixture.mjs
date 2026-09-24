// Inspections on the workspace model (operationsApi 2) for inspector tests,
// derived from the kernel capture (fixtures/workspace-v2/f3b2, kernel #162) and
// retargeted to a test's soul or home. Operation rows follow the documented
// shape (docs/desktop-cli-api.md, operationsApi 2) until the Northwind fixture
// declares an operation (finding sent to the maintainer: its oats.okf has none).
import { readFileSync } from 'node:fs';

const captured = name => JSON.parse(readFileSync(new URL(`../fixtures/workspace-v2/f3b2/${name}.json`, import.meta.url), 'utf8'));
export const capturedInspect = name => structuredClone(captured(name));

/** The captured soul inspection, as the kernel would report soul `name`. */
export function soulInspection(name = 'release-manager', { instructions, capabilities, operations, problems } = {}) {
  const v = capturedInspect('inspect-soul').result;
  v.subject.soul = name; v.souls[0].name = name;
  if (instructions !== undefined) v.souls[0].instructions = instructions;
  if (capabilities) v.capabilities = capabilities;
  if (operations) v.capabilities = v.capabilities.map(cap => cap.layer === 'knowledge' ? { ...cap, operations } : cap);
  if (problems) v.problems = problems;
  return v;
}
/** The captured instance inspection, as the kernel would report `home`. */
export function homeInspection(home, { instance = 'release-manager-cap', soul = 'release-manager', operations, instructions } = {}) {
  const v = capturedInspect('inspect-home').result;
  v.subject = { kind: 'instance', instance, home, soul };
  v.instance = { ...v.instance, home, instance, agent: soul, ...(instructions ? { instructions } : {}) };
  if (operations) v.capabilities = v.capabilities.map(cap => cap.layer === 'knowledge' ? { ...cap, operations } : cap);
  return v;
}
/** A documented operationsApi 2 operation row. */
export const operation = (name, kind = 'view', extra = {}) => ({ name, kind, command: name, context: 'home', description: `${name} operation`,
  args: [], argv: ['okf', name], available: true, reason: null, ...extra });
