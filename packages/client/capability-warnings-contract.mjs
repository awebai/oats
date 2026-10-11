/** Capability warnings (OATS 0.49.0, `hook-event-unsupported`; docs/desktop-cli-api.md § "Capability
 * warnings"): `{code, capability, path, message}` in `capabilities show`, `inspect` and `readiness`, and
 * the message strings of `spawn --preview`. A warning means "this capability composes, and one declared
 * hook never runs here": it is not an error, it blocks nothing and it never changes a ready state.
 *
 * The projections are tolerant: a missing or malformed `warnings` reads as none and a malformed entry is
 * skipped, never refusing the document around it (an older kernel answers no `warnings` key). Every
 * string is already a display line (display-text.mjs), so projecting twice equals projecting once: the
 * server projects before it relays and the renderer projects the relayed answer again. Pure, no DOM: the
 * server imports it. The list's presentation is capability-warnings.mjs. */
import { displayLine } from './display-text.mjs';

/** Warnings shown per surface; the rest are counted ("and N more"). */
export const WARNINGS_SHOWN = 32;
/** Entries a projection keeps (a bound on what is relayed, far above what is shown). */
export const WARNINGS_KEPT = 1000;
/** Lines one preview warning may hold (the kernel's own bound). */
export const WARNING_LINES = 32;

const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
/** The kernel's capability-name grammar: only such a name is ever looked up (Open capability). */
const CAPABILITY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** One warning, or null when it cannot be shown (not an object, no message). `capability` is kept only when it
 * is a capability name (the kernel always sends one): it is both shown and looked up (Open capability). */
export function warningOf(v) {
  if (!record(v)) return null;
  const message = displayLine(v.message);
  if (!message) return null;
  const capability = typeof v.capability === 'string' && CAPABILITY_NAME.test(v.capability) ? v.capability : null;
  return { code: displayLine(v.code), capability, path: displayLine(v.path), message };
}
/** A document's `warnings`: the showable entries, in the kernel's order ([] when absent or not a list). */
export function warningsOf(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const entry of v) { const w = warningOf(entry); if (w) out.push(w); if (out.length === WARNINGS_KEPT) break; }
  return out;
}
/** The preview's warning strings, each its lines as display lines joined by "\n" (a warning may hold several
 * lines, at most WARNING_LINES); a string with nothing to show is dropped. */
export function previewWarningsOf(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const entry of v) {
    if (typeof entry !== 'string') continue;
    const lines = entry.split(/\r\n|\r|\n/).map(displayLine).filter(Boolean).slice(0, WARNING_LINES);
    if (lines.length) out.push(lines.join('\n'));
    if (out.length === WARNINGS_KEPT) break;
  }
  return out;
}
/** What a surface shows: the first WARNINGS_SHOWN and how many more. */
export function warningsShown(list) {
  const all = Array.isArray(list) ? list : [];
  return { shown: all.slice(0, WARNINGS_SHOWN), more: Math.max(0, all.length - WARNINGS_SHOWN) };
}
