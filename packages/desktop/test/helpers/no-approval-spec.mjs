/** Kernel 0.26.0 removes package approval (docs/design/2026-09-24-phase-d-plan.md
 * § "Human decision (2026-09-24): no package approval"; feature
 * `packages-no-approval`). Until the kernel PR's branch can be captured, the
 * Desktop tests read the 0.25.x kernel captures through that published spec:
 * the probe advertises the feature (and at least 0.25.8, what main's kernel
 * reports until 0.26.0 is tagged); sync, capabilities, workspace status and
 * onboarding documents carry no approval fields; a successful sync exits 0.
 *
 * TEMPORARY: delete this helper when the fixtures are recaptured from the
 * kernel branch — every use then reads the capture directly. */
export const NO_APPROVAL = 'packages-no-approval';

/** The kernel on main before 0.26.0 is tagged: it reports 0.25.8 (the
 * Desktop band's floor) and advertises packages-no-approval. */
export const MAIN_KERNEL_VERSION = '0.25.8';
const below = (v, floor) => { const a = v.split('.').map(Number), b = floor.split('.').map(Number); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
export const specProbe = probe => ({ ...probe, version: below(probe.version, MAIN_KERNEL_VERSION) ? MAIN_KERNEL_VERSION : probe.version,
  features: [...probe.features.filter(f => f !== NO_APPROVAL), NO_APPROVAL] });

function strip(result) {
  if (!result || typeof result !== 'object') return;
  delete result.approval; delete result.approvalNeeded;
  for (const row of Array.isArray(result.packages) ? result.packages : []) delete row.approved;
  for (const row of Array.isArray(result.capabilities) ? result.capabilities : []) if (row && typeof row === 'object') delete row.approved;
  for (const row of Array.isArray(result.changes) ? result.changes : []) delete row.approvalNeeded;
}
export function specDocument(document) {
  const doc = structuredClone(document);
  strip(doc?.result); strip(doc?.result?.sync);
  return doc;
}
/** Sync and onboarding no longer exit 2: nothing is pending. */
export const specExit = exit => exit === 2 ? 0 : exit;
