/** Formatting shared by current preparation and retained instruction projection.
 * Selection/order is supplied by the caller; this module never discovers config. */
import { readPortableBytes } from "./portable-files.mjs";
import { oatsError } from "./errors.mjs";

export function renderInstructionText(body, blocks) {
  let text = body.replace(/\n*$/, "\n");
  for (const { source, file, content } of blocks) {
    text += `\n<!-- oats:${source} src=${file} -->\n${content.trim()}\n<!-- /oats:${source} -->\n`;
  }
  return text;
}

/** Input is the result of exact record verification, not a current config or
 * a mutable soul directory. All paths come from its verified resource inventory. */
export function composeCapturedInstructions(verified) {
  const composition = verified.record.dispatch.composition;
  if (!composition) throw oatsError("resolution-incomplete", "captured instruction composition is absent");
  const read = (key) => {
    const file = verified.resources.get(key);
    if (!file) throw oatsError("resolution-incomplete", "captured instruction resource is absent");
    let content;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(readPortableBytes(file)); }
    catch (cause) { throw oatsError("invalid-resolution", "captured instructions are not readable UTF-8", { cause }); }
    return { file, content };
  };
  const body = read(composition.body);
  const blocks = composition.blocks.map(({ source, resource }) => ({ source, ...read(resource) }));
  const skills = composition.skills.map(({ name, resource }) => ({ name, path: verified.resources.get(resource) }));
  return { text: renderInstructionText(body.content, blocks), blocks, skills, omissions: composition.omissions };
}
