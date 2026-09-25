/** Formatting shared by current preparation and retained instruction projection.
 * Selection/order is supplied by the caller; this module never discovers config. */

export function renderInstructionText(body, blocks) {
  let text = body.replace(/\n*$/, "\n");
  for (const { source, file, content } of blocks) {
    text += `\n<!-- oats:${source} src=${file} -->\n${content.trim()}\n<!-- /oats:${source} -->\n`;
  }
  return text;
}

