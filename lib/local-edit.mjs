/**
 * The one way a kernel verb rewrites the deployment's oats-local.yaml in place: `oats teams add|remove|default`
 * (lib/teams-verbs.mjs) and `oats soul launch set|remove` (lib/soul-launch-verbs.mjs) both call editLocal.
 * The file is read as it is NOW, edited in the parsed document (comments and every other entry kept),
 * validated against the local schema and by the caller's own check, and renamed in, all under the
 * deployment's local lock, so two writers never drop each other's change.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { parseConfigData } from "./config-data.mjs";
import { oatsError } from "./errors.mjs";
import { validateLocal } from "./workspace.mjs";
import { writeFileAtomic } from "./packages.mjs";
import { withDirLock } from "./dir-lock.mjs";

function fail(code, message, details) { const e = oatsError(code, message, details); e.details = details; return e; }

/** The lock every writer of oats-local.yaml named above holds: in the deployment's kernel state tree, never
 *  beside the files. */
export const localLock = (deployment) => join(deployment, ".agents", "locks", "local.lock");

/** No line folding: a value past 80 columns stays on its line (the library's default width re-wraps it). */
const RENDER = { lineWidth: 0 };

/** oats-local.yaml as it is now → { text, doc (the editable document), local (the kernel reader's value) }. */
export function readLocal(localPath) {
  const text = readFileSync(localPath, "utf8");
  const doc = YAML.parseDocument(text, { keepSourceTokens: true });
  if (doc.errors?.length) throw fail("E_WORKSPACE_SCHEMA", `${localPath}: ${doc.errors[0].message}`, { path: localPath });
  return { text, doc, local: parseConfigData(text, { origin: { kind: "local", path: localPath } }).value };
}

/**
 * Rewrite oats-local.yaml. `edit({ doc, local })` gets the file AS IT IS NOW (re-read here, never the
 * command's startup snapshot): it may throw a refusal, and it changes `doc` only where the verb's own
 * entries are. It returns null when there is nothing to change, else `{ check? }`, where `check(next)`
 * may refuse the rewritten value (`next`: the kernel reader's parse of the new text) before it is written.
 * The write is compare-and-swap: when the file changed after this read, the edit is redone on the new
 * content (a few times, then E_LOCAL_CHANGED). → { changed, local } (the value now, or as it would be).
 *
 * `verb` names the command in the lock's owner record. `plan: true` runs every check and writes nothing:
 * no lock is taken either, so a plan leaves no trace in the deployment.
 *
 * What is written is the YAML library's rendering of the edited document (RENDER): every entry the edit did
 * not touch keeps its value and its comments. It is not a byte copy: the library pads a flow collection
 * (`[a, b]` comes back `[ a, b ]`) and indents by two.
 *
 * Without `plan` the whole read-compare-write runs under the deployment's local lock (localLock), so among
 * its writers the compare and the rename are one step: a conditional write sees every earlier one.
 */
export function editLocal(ctx, { verb, plan = false }, edit) {
  if (plan) return editLocalLocked(ctx, { plan }, edit);
  const lock = localLock(ctx.deployment);
  return withDirLock(lock, `${verb} on ${ctx.localPath}`, () => editLocalLocked(ctx, { plan }, edit), {
    retryMs: 5000,
    busy: (why) => fail("E_LOCAL_BUSY", `${ctx.localPath} is being edited by another oats process (the lock ${lock}: ${why}); if no oats teams or oats soul launch command is running, remove ${lock} and retry; nothing was written`, { path: ctx.localPath, lock }),
  });
}
function editLocalLocked(ctx, { plan }, edit) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { text, doc, local: current } = readLocal(ctx.localPath);
    const step = edit({ doc, local: current });
    if (!step) return { changed: false, local: current };
    const out = doc.toString(RENDER);
    const local = parseConfigData(out, { origin: { kind: "local", path: ctx.localPath } }).value;
    const problems = validateLocal(local);
    if (problems.length) throw fail("E_WORKSPACE_SCHEMA", `the rewritten oats-local.yaml would be invalid (${problems.map((p) => `${p.path || "/"}: ${p.message}`).join("; ")}); nothing was written`, { problems });
    step.check?.(local);
    if (plan) return { changed: true, local };
    if (readFileSync(ctx.localPath, "utf8") !== text) continue; // changed under us: redo on the new content
    writeFileAtomic(ctx.localPath, out);
    return { changed: true, local };
  }
  throw fail("E_LOCAL_CHANGED", `${ctx.localPath} kept changing while this edit ran; nothing was written — run it again`, { path: ctx.localPath });
}
