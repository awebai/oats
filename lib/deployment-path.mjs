/** A deployment's canonical path: the one spelling of a deployment directory the kernel records and
 *  compares. A leaf (awebai/oats#1630): this computer's deployments list (deployments.mjs) reads it in
 *  the prelude of every command that lists its deployment, without loading core.mjs, which re-exports it. */
import { canonicalHomePath } from "./real-path.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname, relative, sep, isAbsolute, join } from "node:path";
import { oatsError } from "./errors.mjs";

/** Is there a Git marker (`.git` dir or worktree pointer file) at or above `dir`?
 * Filesystem-only: it answers "does Git own this location" even when the git
 * binary is missing, refuses the repo (dubious ownership), or cannot read its
 * metadata — cases where a probe failure must NOT be read as "not a repo". */
function hasGitMarker(dir) {
  let d = resolve(dir);
  while (true) {
    if (existsSync(join(d, ".git"))) return true;
    const parent = dirname(d);
    if (parent === d) return false;
    d = parent;
  }
}

/** Canonicalize any deployment path that determines where an instance HOME is
 * created — the agents root, and the agent directory derived from it.
 *
 * findRoot() walks up from the INVOCATION directory, so the path can sit inside
 * a LINKED git worktree: a human running `oats spawn` from a worktree, or (far
 * more common) an agent that ran `cd ./work` first. Instance homes must live in
 * the soul-owning repo's PRIMARY checkout — `agents/*​/instances/` is gitignored,
 * so a home created in a linked worktree is invisible in status, and it dies
 * with the tree that hosted it.
 *
 * Canonical identity comes from Git, never from a branch name: the FIRST record
 * of `git worktree list --porcelain` is the main worktree. Probes are argv-based
 * (paths may contain shell metacharacters) and read-only.
 *
 * Returns the path unchanged only when Git does not own the location, when it is
 * already in the main worktree, or when it lies outside the work tree it was
 * discovered from. Throws E_NO_CANONICAL_ROOT whenever Git DOES own the location
 * but the primary checkout cannot be established — including a failed probe,
 * which must never pass as "not a repo" (reviewer-2366d09): guessing recreates
 * the very misplacement this exists to prevent.
 *
 * `self`: the path is a deployment directory, owned by the repository it sits
 * in, that repository's root included (this computer's deployments list,
 * lib/deployments.mjs). The probe starts at the directory itself rather than
 * its parent, and the root of a linked worktree maps to the primary checkout's
 * root. Without it (the agents roots), a path that is a work tree's root is left
 * where it is.
 */
export function canonicalDeploymentPath(p, { self = false } = {}) {
  if (!p) return p;
  const abs = resolve(p);
  const probe = (argv) => {
    try { return { ok: true, out: execFileSync(argv[0], argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { return { ok: false, err: String(e.stderr || e.message || "").trim() }; }
  };
  // The scope that owns the path. The directory itself may not exist yet
  // (local-only scopes, an agent dir created on first use), so probe from the
  // nearest existing ancestor.
  let scope = self ? abs : dirname(abs);
  while (!existsSync(scope) && dirname(scope) !== scope) scope = dirname(scope);
  const top = probe(["git", "-C", scope, "rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    // A failed probe is NOT evidence of a non-Git scope. Only the absence of any
    // Git marker is — otherwise an unavailable/erroring git would silently let a
    // linked worktree through, which is exactly the fail-open this prevents.
    if (hasGitMarker(scope)) {
      throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside a Git-owned location whose repository could not be read (${top.err || "git rev-parse failed"}) — instance homes must live in the soul-owning repo's primary checkout, and OATS cannot confirm this is it; fix the Git error or pass --dir <primary checkout>`);
    }
    return abs;                                  // genuinely not a Git work tree
  }
  const toplevel = top.out.trim();
  if (!toplevel) return abs;
  // Git reports CANONICAL paths, so every comparison and every relative()
  // below must be realpath-based: on macOS a temp/agents root reached through
  // /var while Git reports /private/var would otherwise look "outside" the
  // work tree and silently skip canonicalization. So would a root given in
  // another letter case on a case-insensitive filesystem: Git's paths are in
  // their on-disk spelling, and so are both sides here. The agents dir itself
  // may not exist yet (local-only scopes), so resolve the nearest existing
  // ancestor and re-append the remainder.
  const realOf = canonicalHomePath;
  const same = (a, b) => realOf(a) === realOf(b);
  // Linked or main? `--git-dir` equals `--git-common-dir` in the MAIN worktree
  // and points at <common>/worktrees/<name> in a linked one. This settles it
  // without `git worktree list`, so the overwhelmingly common main-checkout
  // path costs one probe and — crucially — cannot be failed by a hiccup in a
  // command it does not need (a forced `worktree list` failure used to reject
  // an ordinary main-checkout spawn).
  const dirs = probe(["git", "-C", scope, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
  const [gitDir, commonDir] = dirs.ok
    ? dirs.out.trim().split("\n").map((l) => l.trim())
    // Pre-2.31 git has no --path-format: fall back to plain output, whose paths
    // may be relative to the scope.
    : (() => {
      const plain = probe(["git", "-C", scope, "rev-parse", "--git-dir", "--git-common-dir"]);
      if (!plain.ok) return [];
      return plain.out.trim().split("\n").map((l) => resolve(scope, l.trim()));
    })();
  if (!gitDir || !commonDir) {
    throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside the Git work tree ${toplevel}, but OATS could not tell a linked worktree from the primary checkout (${dirs.err || "git rev-parse --git-dir/--git-common-dir failed"}) — instance homes must live in the soul-owning repo's primary checkout; fix the Git error or pass --dir <primary checkout>`);
  }
  // Main checkout: the common case, and the one that must stay free — returned
  // untouched, in the caller's own path form.
  if (same(gitDir, commonDir)) return abs;
  // Linked worktree from here on — the primary checkout is REQUIRED, not optional.
  const list = probe(["git", "-C", scope, "worktree", "list", "--porcelain", "-z"]);
  const mainWorktree = list.ok
    ? (list.out.split("\0").find((f) => f.startsWith("worktree ")) || "").slice("worktree ".length)
    : undefined;
  if (!list.ok) throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside the linked Git worktree ${toplevel}, and the primary checkout could not be determined (${list.err || "git worktree list failed"}) — instance homes must live in the soul-owning repo's primary checkout; re-run from it or pass --dir <primary checkout>`);
  if (!mainWorktree) throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside the linked Git worktree ${toplevel}, but \`git worktree list\` reported no main worktree — instance homes must live in the soul-owning repo's primary checkout; re-run from it or pass --dir <primary checkout>`);
  if (!existsSync(mainWorktree)) throw oatsError("E_NO_CANONICAL_ROOT", `${abs} is inside the linked Git worktree ${toplevel}, whose primary checkout ${mainWorktree} does not exist — instance homes must live in the soul-owning repo's primary checkout; restore it or pass --dir <primary checkout>`);
  // Map the root's position within the linked tree onto the primary checkout.
  // A root OUTSIDE the work tree (sibling agents/ beside the repo) is not a
  // worktree artifact and is left exactly where it is.
  const rel = relative(realOf(toplevel), realOf(abs));
  if ((rel === "" && !self) || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return abs;
  const canonical = join(realOf(mainWorktree), rel);
  const back = relative(realOf(mainWorktree), canonical);
  if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw oatsError("E_NO_CANONICAL_ROOT", `canonical root for ${abs} would escape the primary checkout ${mainWorktree}`);
  }
  return canonical;
}
