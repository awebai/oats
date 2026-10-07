/** Formatting shared by current preparation and retained instruction projection.
 * Selection/order is supplied by the caller; this module never discovers config. */

/** The composed document and where each part of it is: `body` and every `blocks[i]` as
 *  `[start, end)` in JS string units. The parts tile the text: the body starts at 0, each
 *  part ends where the next starts (after the blank separator line before the next opening
 *  marker), and the last part ends at `text.length`. A block starts at the `<` of its opening
 *  marker. The one renderer: renderInstructionText is its `.text`. */
export function renderInstructionParts(body, blocks) {
  let text = body.replace(/\n*$/, "\n");
  const spans = [];
  for (const { source, file, content } of blocks) {
    text += "\n";
    const start = text.length;
    text += `<!-- oats:${source} src=${file} -->\n${content.trim()}\n<!-- /oats:${source} -->\n`;
    spans.push({ start });
  }
  const bodyEnd = spans.length ? spans[0].start : text.length;
  return { text, body: { start: 0, end: bodyEnd }, blocks: spans.map(({ start }, i) => ({ start, end: i + 1 < spans.length ? spans[i + 1].start : text.length })) };
}

export function renderInstructionText(body, blocks) {
  return renderInstructionParts(body, blocks).text;
}
