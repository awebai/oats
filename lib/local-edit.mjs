/**
 * The one way a kernel command rewrites the deployment's oats-local.yaml in place: every command that
 * does calls editLocal, and a new one does too (its callers are whatever imports it: no list is kept here).
 * The file is read as it is NOW, edited (in the parsed document, comments and every other entry kept; or
 * as text, by a command that has a writer of its own for its block), validated against the local schema
 * and by the caller's own check, and renamed in, all under the deployment's local lock, so two writers
 * never drop each other's change.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { isJsonSource, parseConfigData } from "./config-data.mjs";
import { oatsError } from "./errors.mjs";
import { validateLocal } from "./workspace.mjs";
import { writeFileAtomic } from "./packages.mjs";
import { withDirLock } from "./dir-lock.mjs";

function fail(code, message, details) { const e = oatsError(code, message, details); e.details = details; return e; }

/** The lock every kernel writer of oats-local.yaml holds: in the deployment's kernel state tree, never
 *  beside the files. */
export const localLock = (deployment) => join(deployment, ".agents", "locks", "local.lock");

/** No line folding: a value past 80 columns stays on its line (the library's default width re-wraps it). */
const RENDER = Object.freeze({ lineWidth: 0 });
/** `value` (a document's content, its mappings as Maps so that their keys keep the file's order: an object
 *  would move a key like "10" to the front) as two-space JSON. */
function jsonText(value, indent = "") {
  const inner = `${indent}  `;
  const block = (open, close, rows) => (rows.length ? `${open}\n${rows.map((row) => `${inner}${row}`).join(",\n")}\n${indent}${close}` : `${open}${close}`);
  if (value instanceof Map) return block("{", "}", [...value].map(([k, v]) => `${JSON.stringify(String(k))}: ${jsonText(v, inner)}`));
  if (Array.isArray(value)) return block("[", "]", value.map((v) => jsonText(v, inner)));
  return JSON.stringify(value ?? null);
}
/** The edited document as the text to write, in the syntax the file has. The kernel reader takes a file
 *  that opens with `{` as strict JSON (isJsonSource), and the library's rendering of an edited flow
 *  collection is not JSON (a new key comes out unquoted), so such a file is written as JSON. It has no
 *  comment to keep; it keeps the order of its keys and its final newline, or the absence of one, and its
 *  indentation becomes two spaces. */
const render = (doc, text) => (isJsonSource(text) ? `${jsonText(doc.toJS({ mapAsMap: true }))}${text.endsWith("\n") ? "\n" : ""}` : doc.toString(RENDER));

/** The kernel reader's value of `text`, or the reason it reads none: its decoder's refusals carry their own
 *  names, not an `E_` code, so they are caught here and never reach a command as a crash. */
function decode(text, localPath) {
  try { return { value: parseConfigData(text, { origin: { kind: "local", path: localPath } }).value }; }
  catch (e) { return { failure: String(e?.message ?? e) }; }
}

/** oats-local.yaml as it is now → { text, doc (the editable document), local (the kernel reader's value) }. */
export function readLocal(localPath) {
  const text = readFileSync(localPath, "utf8");
  const doc = YAML.parseDocument(text, { keepSourceTokens: true });
  if (doc.errors?.length) throw fail("E_WORKSPACE_SCHEMA", `${localPath}: ${doc.errors[0].message}`, { path: localPath });
  const read = decode(text, localPath);
  if (read.failure) throw fail("E_WORKSPACE_SCHEMA", `cannot decode ${localPath}: ${read.failure}; nothing was written`, { path: localPath });
  return { text, doc, local: read.value };
}

/**
 * Rewrite oats-local.yaml. `edit({ text, doc, local })` gets the file AS IT IS NOW (re-read here, never the
 * command's startup snapshot): it may throw a refusal, and it changes `doc` only where the verb's own
 * entries are. It returns null when there is nothing to change, else `{ check? }`, where `check(next)`
 * may refuse the rewritten value (`next`: the kernel reader's parse of the new text) before it is written.
 * The write is compare-and-swap: when the file changed after this read, the edit is redone on the new
 * content (a few times, then E_LOCAL_CHANGED). → { changed, local } (the value now, or as it would be).
 * The edit runs with the lock held, and may run several times: it never ends the process, and what its
 * caller keeps of it is what its last run left.
 *
 * `verb` names the command in the lock's owner record. `plan: true` runs every check and writes nothing:
 * no lock is taken either, so a plan leaves no trace in the deployment.
 *
 * What is written is the YAML library's rendering of the edited document (RENDER): every entry the edit did
 * not touch keeps its value and its comments. It is not a byte copy: the library pads a flow collection
 * (`[a, b]` comes back `[ a, b ]`) and indents by two. A file written as JSON stays JSON (render).
 * Text the kernel reader would not decode is never written: that is E_WORKSPACE_SCHEMA, as an invalid value is.
 *
 * An edit that has a writer of its own returns `{ text, check? }` instead, made from the `text` it was
 * given: that text is written as it is and the document is not rendered, so every byte the edit left alone
 * stays. It is held to the same loop (the kernel reader, the local schema, `check`, compare-and-swap, the
 * rename), and the text it was given, returned, is nothing to write: `changed: false`.
 *
 * Without `plan` the whole read-compare-write runs under the deployment's local lock (localLock), so among
 * its writers the compare and the rename are one step: a conditional write sees every earlier one.
 *
 * The write replaces the file (a sibling temporary file, renamed in): no reader sees half of it, and the
 * new file has the permission bits of the one it replaces, from before its first byte is written. A link
 * at that path is replaced too, by a regular file with its target's bits (writeFileAtomic never writes
 * through one): the target is left as it was.
 */
export function editLocal(ctx, { verb, plan = false }, edit) {
  if (plan) return editLocalLocked(ctx, { plan }, edit);
  const lock = localLock(ctx.deployment);
  return withDirLock(lock, `${verb} on ${ctx.localPath}`, () => editLocalLocked(ctx, { plan }, edit), {
    retryMs: 5000,
    busy: (why) => fail("E_LOCAL_BUSY", `${ctx.localPath} is being edited by another oats process (the lock ${lock}: ${why}); if no oats command that edits this file is running, remove ${lock} and retry; nothing was written`, { path: ctx.localPath, lock }),
  });
}
function editLocalLocked(ctx, { plan }, edit) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { text, doc, local: current } = readLocal(ctx.localPath);
    const step = edit({ text, doc, local: current });
    if (!step) return { changed: false, local: current };
    const own = typeof step.text === "string";
    const out = own ? step.text : render(doc, text);
    const read = decode(out, ctx.localPath);
    const local = read.value;
    const problems = read.failure ? [{ path: "", message: `the kernel would not decode it: ${read.failure}` }] : validateLocal(local);
    if (problems.length) throw fail("E_WORKSPACE_SCHEMA", `the rewritten oats-local.yaml would be invalid (${problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}); nothing was written`, { problems });
    step.check?.(local);
    if (own && out === text) return { changed: false, local: current };
    if (plan) return { changed: true, local };
    if (readFileSync(ctx.localPath, "utf8") !== text) continue; // changed under us: redo on the new content
    // The file that replaces it keeps its permission bits: one its operator made private stays private.
    writeFileAtomic(ctx.localPath, out, { mode: statSync(ctx.localPath).mode & 0o7777 });
    return { changed: true, local };
  }
  throw fail("E_LOCAL_CHANGED", `${ctx.localPath} kept changing while this edit ran; nothing was written — run it again`, { path: ctx.localPath });
}
