// Inspections on the workspace model (operationsApi 2) for inspector tests,
// derived from the kernel capture (fixtures/workspace-v2/f3b2, main c9dc6012
// with #162 merged) and retargeted to a test's soul or home. oats.okf declares two home
// operations: `status` (view) and `reindex` (action, optional --scope) —
// unavailable on a soul ("needs a running home (--home)"), available on a home.
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
  // the spawned-from soul row names the same soul as the subject (one stand-in identity)
  v.souls = v.souls.map((row, index) => index === 0 ? { ...row, name: soul } : row);
  if (operations) v.capabilities = v.capabilities.map(cap => cap.layer === 'knowledge' ? { ...cap, operations } : cap);
  return v;
}
/** The captured oats.okf operation rows as a home reports them (available). */
export const capturedOperations = () => capturedInspect('inspect-home').result.capabilities.find(cap => cap.id === 'oats.okf').operations;
/** The captured operationsApi 2 run result (`oats operation run knowledge:status --home`), optionally varied. */
export const capturedRun = (fields = {}) => ({ ...capturedInspect('operation-run-status').result, ...fields });
