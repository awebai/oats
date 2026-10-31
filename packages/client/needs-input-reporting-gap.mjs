// docs/release-notes/v0.40.0.md: oats.framework 1.6.0 carries oats.core 2.4.0,
// the first Claude needs-input hooks. Compare the home's recorded version, never the lock.
const NEEDS_INPUT_FRAMEWORK_MIN = Object.freeze([1, 6, 0]);

/** The recorded framework version when this row cannot report needs input, else null.
 * Both local and remote rows carry drift rows, or a recorded map when the workspace
 * wasn't read. Missing evidence says nothing about reporting coverage. */
export function needsInputReportingGap(row) {
  if (row?.harness !== 'claude') return null;
  const modules = row.modules;
  const core = Array.isArray(modules) ? modules.find(m => m?.name === 'oats.core')
    : modules && typeof modules === 'object' && Object.hasOwn(modules, 'oats.core') ? modules['oats.core'] : null;
  const from = core?.from;
  if (from?.kind !== 'package' || from.package !== 'oats.framework' || typeof from.version !== 'string') return null;
  // Semver: core numbers and numeric prerelease identifiers have no leading zeros;
  // build identifiers do. Match the entire string (including a possible final newline).
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(from.version);
  if (!match || match[0] !== from.version || match[4]?.split('.').some(id => /^\d+$/.test(id) && id.length > 1 && id[0] === '0')) return null;
  for (let i = 0; i < NEEDS_INPUT_FRAMEWORK_MIN.length; i++) {
    const number = Number(match[i + 1]), minimum = NEEDS_INPUT_FRAMEWORK_MIN[i];
    if (number !== minimum) return number < minimum ? from.version : null;
  }
  // A prerelease of the first supporting release still sorts below it.
  return match[4] ? from.version : null;
}
