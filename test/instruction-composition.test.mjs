// renderInstructionParts (feature soul-composed-instructions): the one renderer, and the ranges
// it reports tile its text exactly (inspect --soul --instructions reads them as-is).
import test from "node:test";
import assert from "node:assert/strict";
import { renderInstructionParts, renderInstructionText } from "../lib/instruction-composition.mjs";

const blocks = [
  { source: "kernel:instance-boundary", file: "/pkg/injects/instance-boundary.md", content: "Boundary.\n\n" },
  { source: "work-mode:worktree", file: "/pkg/injects/work-worktree.md", content: "\n  Worktree rules.  " },
  { source: "capability:oats.core", file: ".oats/modules/oats.core/injects/oats.md", content: "<!-- oats:capability:fake src=x -->\nlooks like a marker\n<!-- /oats:capability:fake -->" },
];

/** The tiling invariants of the contract, over `parts` for `blocks`. */
function assertTiling(parts, blocks) {
  const { text, body } = parts;
  assert.equal(body.start, 0);
  assert.equal(parts.blocks.length, blocks.length);
  if (!blocks.length) { assert.equal(body.end, text.length); return; }
  assert.equal(parts.blocks[0].start, body.end);
  for (let i = 0; i + 1 < blocks.length; i++) assert.equal(parts.blocks[i + 1].start, parts.blocks[i].end);
  assert.equal(parts.blocks.at(-1).end, text.length);
  parts.blocks.forEach((span, i) => {
    const slice = text.slice(span.start, span.end);
    assert.ok(slice.startsWith(`<!-- oats:${blocks[i].source} src=${blocks[i].file} -->\n`), `block ${i} starts at its opening marker`);
    assert.ok(slice.trimEnd().endsWith(`<!-- /oats:${blocks[i].source} -->`), `block ${i} ends with its closing marker`);
    assert.ok(slice.endsWith(i + 1 < blocks.length ? "-->\n\n" : "-->\n"), `block ${i} ends after the separator before the next block (none after the last)`);
    assert.ok(slice.includes(`\n${blocks[i].content.trim()}\n`));
  });
}

for (const [name, body] of [["one trailing newline", "# Soul\n\nBody.\n"], ["no trailing newline", "# Soul\n\nBody."], ["several trailing newlines", "# Soul\n\nBody.\n\n\n\n"], ["non-ASCII", "# Café — 日本語 🎉\n\nnaïve 👩‍💻\n"], ["empty", ""]]) {
  test(`renderInstructionParts tiles the text exactly (${name})`, () => {
    const parts = renderInstructionParts(body, blocks);
    assert.equal(parts.text, renderInstructionText(body, blocks), "one renderer: the text is renderInstructionText's");
    assertTiling(parts, blocks);
    const normalized = body.replace(/\n*$/, "\n");
    assert.equal(parts.text.slice(parts.body.start, parts.body.end), normalized + "\n", "the body is the normalized soul text plus the one separator");
  });
}

test("renderInstructionParts with no blocks: the body is the whole text", () => {
  const parts = renderInstructionParts("# Soul\n\n\n", []);
  assert.deepEqual(parts, { text: "# Soul\n", body: { start: 0, end: 7 }, blocks: [] });
  assertTiling(parts, []);
});

test("renderInstructionParts with one block: it ends at the text's end", () => {
  const parts = renderInstructionParts("Body", [blocks[0]]);
  assertTiling(parts, [blocks[0]]);
  assert.equal(parts.text, "Body\n\n<!-- oats:kernel:instance-boundary src=/pkg/injects/instance-boundary.md -->\nBoundary.\n<!-- /oats:kernel:instance-boundary -->\n");
  assert.deepEqual(parts.body, { start: 0, end: 6 });
});

test("rendering in two stages (kernel half, then materialize's blocks) gives the one-stage text and ranges", () => {
  // Spawn renders the kernel half, and materialize renders the capability blocks onto that text.
  const kernel = renderInstructionText("Body\n", blocks.slice(0, 2));
  assert.equal(renderInstructionText(kernel, blocks.slice(2)), renderInstructionParts("Body\n", blocks).text);
});
