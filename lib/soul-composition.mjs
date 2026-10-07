/** The instructions a spawn of a soul would write, composed WITHOUT a spawn: the one path
 *  behind `oats doctor --soul` and `oats inspect --soul --instructions`.
 *
 * It runs spawn's own two halves: the kernel half (composeInstanceAgentsMd: the soul's
 * AGENTS.md, the instance-boundary and work-mode blocks) and materialize (each capability's
 * inject), into a scratch home OUTSIDE the deployment that is removed before it returns (and
 * at exit). Nothing in the deployment is written. Capability blocks are reported
 * home-relative (`.oats/modules/<cap>/<inject>`, where an instance carries them); kernel
 * blocks keep the installed package's absolute path, as spawn writes them.
 *
 * Single-path guard: the reported text is re-rendered by renderInstructionParts (for the
 * ranges), so rendering the same parts with the scratch paths must give back, byte for byte,
 * the AGENTS.md materialize wrote — else E_COMPOSITION_INCOMPLETE, never a second answer. */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { composeInstanceAgentsMd, findAgentAt } from "./core.mjs";
import { agentDirOf, materializePrepared } from "./instance-resolution.mjs";
import { renderInstructionParts } from "./instruction-composition.mjs";
import { oatsError } from "./errors.mjs";

/** The cap of a reported text, as inspect's `instructions` (JS string length). */
export const COMPOSED_TEXT_CAP = 200_000;

const fail = (code, message, details) => Object.assign(oatsError(code, message), details ? { details } : {});

/** `[start, end)` clamped to the capped text; `truncated` when the cap cut into the part. */
function clampSpan({ start, end }, length) {
  return { start: Math.min(start, length), end: Math.min(end, length), truncated: end > length };
}

/** Compose `prepared`'s soul, whose copy is at `soulDir`, as a spawn here with no flags would.
 *  → { text, blocks, resolved, oatsCoreDeclared, composedInstructions }
 *  - text: the full document (capability markers home-relative);
 *  - blocks: every block in text order ({ source, file, content }, capability blocks
 *    home-relative and `materialized: true`);
 *  - composedInstructions: inspect's `{ file: null, text, truncated, resolution, body, sources }`,
 *    `text` capped at `cap` and every range clamped to it.
 *  Throws an E_ coded error when the soul cannot be composed here. `materialize` is a test seam. */
export async function composeSoulInstructions({ deployment, prepared, soulDir, cap = COMPOSED_TEXT_CAP, materialize = materializePrepared }) {
  const soulName = prepared.soulEntry?.name ?? agentDirOf(prepared.soulEntry);
  const agent = findAgentAt(join(deployment, "agents"), agentDirOf(prepared.soulEntry), soulDir);
  if (!agent) throw fail("E_SOUL_UNKNOWN", `soul "${soulName}" was fetched but is not readable as a soul`);
  const bodyFile = join(soulDir, "AGENTS.md");
  if (!existsSync(bodyFile)) throw fail("E_SOUL_INCOMPLETE", `soul "${soulName}" has no canonical AGENTS.md (${bodyFile})`);
  // The work mode and kind as a spawn with no flags derives them (spawnInstance: o.work || agent.work || "checkout").
  const composition = composeInstanceAgentsMd(soulDir, deployment, agent.name, agent.work || "checkout", agent.kind, prepared);
  const body = readFileSync(bodyFile, "utf8");
  let scratch;
  try { scratch = realpathSync(mkdtempSync(join(tmpdir(), "oats-compose-home-"))); }
  catch (e) { throw fail("E_MATERIALIZE_HOME", `cannot create a scratch home to compose soul "${soulName}" in under ${tmpdir()}: ${e.message}`, { why: "unwritable", cause: e.code }); }
  const remove = () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort: a temporary copy only */ } };
  process.once("exit", remove);
  try {
    const outcome = await materialize({ ...prepared, soulAgentsMd: composition.text, soulDir }, scratch);
    const written = readFileSync(join(scratch, "AGENTS.md"), "utf8");
    const materialized = Array.isArray(outcome?.blocks) ? outcome.blocks : [];
    if (renderInstructionParts(body, [...composition.blocks, ...materialized]).text !== written) {
      throw fail("E_COMPOSITION_INCOMPLETE", `soul "${soulName}": the instructions materialize wrote are not the kernel's composition plus the capability blocks it reported; nothing is reported in their place`);
    }
    const homeRelative = (file) => {
      const rel = relative(scratch, file);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw fail("E_COMPOSITION_INCOMPLETE", `soul "${soulName}": a capability block (${file}) is not inside the composed home`);
      return rel.split(sep).join("/");
    };
    const capabilityBlocks = materialized.map((b) => ({ source: b.source, file: homeRelative(b.file), content: b.content, materialized: true }));
    const blocks = [...composition.blocks, ...capabilityBlocks];
    const parts = renderInstructionParts(body, blocks);
    const length = Math.min(parts.text.length, cap);
    const kernelBlocks = composition.blocks.length;
    return {
      text: parts.text, blocks, resolved: composition.resolved, oatsCoreDeclared: composition.oatsCoreDeclared,
      composedInstructions: {
        file: null, text: parts.text.slice(0, length), truncated: parts.text.length > length,
        resolution: prepared.resolution?.revision ?? null,
        body: clampSpan(parts.body, length),
        sources: parts.blocks.map((span, i) => ({ source: blocks[i].source, file: i < kernelBlocks ? null : blocks[i].file, ...clampSpan(span, length) })),
      },
    };
  } finally {
    remove();
    process.removeListener("exit", remove);
  }
}
