// What a rendered Details line must be (remote-address.mjs codeLineNodes), for every view that shows a
// host's own message: one display line, alone in its <bdi>, with Desktop's own text outside it.
import assert from 'node:assert/strict';
import { NOT_NOTE_TEXT, cleanLine } from '../../../client/display-text.mjs';

/** A host message as a kernel error can carry it: a line break, a tab, both Unicode line separators and a
 * character of the set. */
export const MESSY = 'fatal: bad object HEAD\n\thint: fetch first\u2028then\u2029retry \u202Enow ';
/** MESSY as the display filter shows it. */
export const MESSY_LINE = 'fatal: bad object HEAD hint: fetch first then retry \uFFFDnow';

/** `el` reads `before` + `detail` + `after`. `detail` is the whole text of the one <bdi> under `el`, a
 * single text node, and is one display line; `before` and `after` are outside the <bdi>. */
export function assertIsolatedDetail(el, { before, detail, after = '' }) {
  const fields = [...el.querySelectorAll('bdi')], doc = el.ownerDocument;
  assert.equal(fields.length, 1, 'one isolated field');
  const [field] = fields;
  assert.equal(field.textContent, detail, 'the detail is the whole text of its <bdi>');
  assert.equal(field.childNodes.length, 1); assert.equal(field.firstChild.nodeType, 3, 'set as text, never parsed');
  assert.ok(cleanLine(detail), 'one display line');
  assert.equal(el.textContent, `${before}${detail}${after}`);
  assert.doesNotMatch(el.textContent, NOT_NOTE_TEXT, 'the whole line is a single line');
  const lead = doc.createRange(); lead.setStart(el, 0); lead.setEndBefore(field);
  const trail = doc.createRange(); trail.setStartAfter(field); trail.setEnd(el, el.childNodes.length);
  assert.equal(lead.toString(), before, "Desktop's own text before the field is outside it");
  assert.equal(trail.toString(), after, 'and so is the text after it');
}
