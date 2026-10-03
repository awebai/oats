# Instance cloning: the `oats.cloning` package

Status: **DECIDED 2026-10-01** by the maintainer with the steward (the transcript handling revised
2026-10-02 by the human: "cloning just works"). Shipped as `oats.cloning` 1.0.0
([awebai/oats-cloning](https://github.com/awebai/oats-cloning)), compatibility `oats >=0.34.0`.

## Context
[Knowledge theory](../knowledge-theory.md#reusing-working-understanding-context-handoffs-and-cloning)
accepted cloning in principle and left it open: harvesting preserves individual lessons, not the
combined working picture of a long-running instance. A clone should carry selected references,
verified observations and provisional reasoning marked as such, under its own identity, credentials
and ownership, and copying it promotes nothing to shared knowledge.

## Decision
1. **A capability, not a kernel change.** Everything cloning needs already exists in the kernel:
   `oats status` and `instance.json` to find and describe the source, `oats capture`/`oats recall`
   for its transcript, `oats spawn` with `--relation`/`--relative-to`, the launch flags and `--base`,
   `--preview` then `--expect-decision`, `oats session upload`/`session start`, and
   `oats retire --self`. No config key, manifest field, hook variable or lock format changes. The
   capability has no lifecycle hooks, so it cannot break a composing soul's spawn.
2. **Three roles.** The *requester* (an instance with the capability, or the operator from the
   deployment with `--soul oats.cloning/cloner`) runs
   `oats cloning request <source> --goal … --relation independent|child|sibling|parent`. That spawns
   a short-lived *cloner* (the package soul `oats.cloning/cloner`, `knowledge: none`), which reads the
   source (`dossier`), writes a brief and a plan (`/plan-clone`), spawns the *clone* (`spawn`:
   preview, apply, verify), reports and retires itself. The clone is an ordinary instance of the
   source's soul; nothing about it is special to the kernel.
3. **The requester chooses only what is theirs:** the goal, the relation and its anchor (the source
   by default, never the cloner, which retires), the name, whether the transcript is read, and the
   work base. `independent` is the kernel's `unrelated` and takes no anchor. The cloner decides what
   the clone carries, and asks the requester only when a choice is genuinely theirs.
4. **The clone carries a curated brief, not a copy.** A generated preamble (a provenance block and
   fixed "you are a clone" text) and the cloner's body under fixed headings: the goal verbatim,
   what is verified (each with its evidence), decisions and why, working understanding marked
   provisional, open threads and who owns them, work state, where to look (transcript turn ids are
   citations), and what was not carried. Inherited material is not new evidence: the clone notes it
   only after re-verifying it. Its commitments, PRs, threads and children stay with the source
   unless the brief says they were handed over.
5. **Read-only on the source, bounded.** `dossier` copies a filtered `instance.json` (never the
   command, environment, hooks, `capabilityMeta` or any credential locator), `TASK.md`, `STATE.md`,
   `log.md` and `notes/**/*.md` as regular files contained in the home, with size budgets. It never
   reads identity material, `.oats*`, attachments or the regenerated `AGENTS.md`. Work state is read
   with read-only git: branch, HEAD, ahead/behind, commit subjects, changed paths and a diffstat,
   never diff content; a directory work tree is only listed.
6. **The transcript is included by default, through a temporary record.** `--transcript exclude`
   opts out. The cloner captures the source into a private record in its own home
   (`oats capture --root`, 0700), copies the host's capture ignore list into it (and captures nothing
   if that list exists but cannot be read), reads it with `oats recall --root`, and deletes it. The
   host's own record is never written, so a source the host chose not to capture stays uncaptured.
7. **Security requirements, each tested.**
   - *Redaction, not refusal.* Before the clone can see anything, `spawn` redacts the whole assembled
     brief, preamble included: PEM private keys, provider tokens and keys, JWTs, Bearer tokens,
     credentials in URLs and `secret=…` assignments become `[redacted:<pattern>]`. The receipt and
     the answer list `{line, pattern}`, never the value. Redaction errs toward over-redacting, never
     toward a leak. The `/plan-clone` exclusions stay the policy; redaction is the seatbelt.
   - *The brief lives only in the clone's home, mode 0600.* `claude` and `codex` launches pass
     `TASK.md` as an argument, visible to other local users. So the clone is spawned `--no-launch`
     with only the preamble and a pointer in its task, the brief is attached with
     `oats session upload` (0600), `TASK.md` is made 0600, and only then is the session started.
     `spawn` verifies the modes, the attachment's sha256 and the provenance block byte for byte.
   - *A fresh messaging identity.* `spawn` never passes identity settings, and after the start checks
     that the clone's alias is its own instance name and its identity differs from the source's
     (`E_CLONE_IDENTITY` otherwise; a resident identity tied to the source's is refused before the
     spawn).
   - *The plan cannot escalate.* `spawn` enforces that the plan matches the request and the source:
     the soul, relation, anchor and name; the source's launch settings (yolo and child spawns are never
     escalated); `oats.okf harvest=off` carried when the source had it, never turned on; a base only
     for worktree souls.
8. **Cleanup survives retirement.** Retirement keeps a changed home in recovery storage, so the
   cloner cannot rely on its home being deleted: once the apply has run, it empties `clone/` except
   `receipt.json` (which holds no source text), and a later run first removes an earlier run's
   leftovers. A refusal before the apply deletes the temporary record and keeps the brief and plan
   for a retry. Known limit: a cloner killed mid-run and then retired from outside leaves its
   `clone/` (0700) in recovery storage.
9. **Packaging.** Its own repository and package, `oats.cloning`, mirrored and pinned in this
   repository like the other official packages, with a member expert soul (`oats-cloning-expert`)
   beside the package soul. **Not a workspace default:** only the souls that request clones compose
   it (`oats.cloning: { from: package }`), and it becomes a default later on evidence of use. The
   workspace pins it as `git:github.com/awebai/oats-cloning@v1.0.0` until every deployment's CLI
   carries the catalog entry, because a bare version is `E_PACKAGE_MISSING` on a CLI without it.

## Rejected
- **A raw transcript fork** (resuming or forking the source's harness session). It copies identity
  statements, home paths, secrets and half-finished reasoning as if settled, is harness-specific,
  and carries no notion of what is still true. The brief is a curated reading, not a replay.
- **Copying `notes/` into the clone.** Notes are the source's evidence; copied, they would be
  harvested a second time as the clone's own.
- **The brief in `TASK.md`.** World-readable by default and passed on the command line.
- **A refuse-on-match secret scan.** It stops a clone over one stray token; redaction removes the
  value and still reports where it was.
- **An operator consent step per clone** (dropped by the human), and an acknowledgement flag for
  sources the host does not capture. Both are procedural gates: same-user agents can already read
  the host record, and the temporary record makes neither necessary.
- **Shipping inside `oats.framework`** (deployable with a bare pin today). Rejected for a standalone
  package identity, as the human asked. **A second package inside this repository** was rejected
  too: a `git:` pin always reads `oats-package/`, so it would carry the costs of both options.
- **A workspace default** in v1: no evidence yet that every soul needs it.

## Out of scope (v1)
Cloning across machines or from a retired instance; cloning into a different soul (that is a
handoff); asking a live source to write its own handoff; carrying work-tree content, uncommitted
changes, attachments, schedules, joined teams or children; a Desktop "Clone" action; kernel
provenance fields such as `clonedFrom`; the knowledge harvester skipping inherited material in a
clone's transcript (the preamble marks it instead).
