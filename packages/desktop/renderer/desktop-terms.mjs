/** The Desktop's own terms (packages/client/client-terms.mjs): the words the shared sentence tables use
 * where a sentence names the client that shows it. Said once, here; main, the backend and the page import
 * this module and pass `DESKTOP_TERMS` at every call of a table that takes terms. Code that asks whether
 * a label is this machine's compares against `DESKTOP_TERMS.thisMachine`.
 * In `renderer/` because the page loads modules from here and from the shared home only. */
import { clientTerms } from '../../client/client-terms.mjs';

export const DESKTOP_TERMS = clientTerms({
  name: 'Desktop',            // "… than Desktop can show."
  self: 'this Desktop',       // "… a workspace this Desktop can't read."
  selfInitial: 'This Desktop', // "This Desktop can't read …"
  update: 'OATS Desktop',     // "Update OATS Desktop."
  thisMachine: 'This Mac',    // a deployment that names no machine; also on Linux, for now
});
