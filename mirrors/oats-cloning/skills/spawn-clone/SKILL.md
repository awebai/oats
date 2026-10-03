---
name: spawn-clone
description: >-
  The cloner's last step: preview the clone with `oats cloning spawn --plan
  … --preview`, read the decision, apply it, handle each error code, report
  to the requester (name, home, relation, brief size and sha, redactions,
  what was not carried, caveats) and retire yourself. Use when clone/brief.md
  and clone/plan.json are written.
---

# Spawning the clone

## 1. Preview

```bash
oats cloning spawn --plan "$OATS_INSTANCE_HOME/clone/plan.json" --preview --json
```

Nothing is created. Read the decision:

- `preview.soul` is the source's soul;
- `preview.relation` and `relativeTo` are the requester's;
- `preview.base`, for a worktree soul, is the start point you meant;
- `preview.harness`, `model`, `launchConfig` and `yolo` match the source's
  posture;
- `redactions`: each `{line, pattern}` the redaction pass replaced. If any
  are in your body, a secret slipped past your selection: remove it from
  `clone/brief.md` and preview again. Redaction is the seatbelt, not the
  policy.
- `warnings`: for example, the source's launch configuration no longer
  exists here.

## 2. Apply

```bash
oats cloning spawn --plan "$OATS_INSTANCE_HOME/clone/plan.json" --json
```

The command previews again, applies the same decision, and then:

1. spawns the clone unlaunched, with a TASK.md that holds only the generated
   preamble (provenance block, "You are a clone", and a pointer to the
   brief);
2. attaches the redacted brief as `.oats-attachments/clone-brief.md` (mode
   0600) and sets TASK.md to 0600. The brief never goes through TASK.md or a
   command line;
3. starts the clone;
4. verifies: home, soul, relation, the provenance byte for byte, file modes,
   the attachment's sha256, `oats status`, and that the clone's aweb identity
   is its own (alias = its name; identity home and did differ from the
   source's).

It writes `clone/receipt.json` and then deletes everything else in `clone/`:
your brief and plan, the dossier, the source copies and the temporary
transcript record. That happens whether the checks pass or not.

A refusal **before** the apply (any error below except the unverified and
post-spawn identity ones) keeps your brief and plan so you can fix them and
retry. It does delete the transcript record, so if you still need the
transcript, run `oats cloning dossier <source> --json` again first.

## 3. Errors

| Code | Meaning | What you do |
|---|---|---|
| `E_CLONE_PLAN` | plan malformed, or it differs from the request or the source's posture | fix plan.json (the message names the field and the expected value) |
| `E_CLONE_SOUL` | plan.soul is not the source's soul | use `dossier.instance.soul.name` |
| `E_CLONE_RELATION` / `E_CLONE_ANCHOR` | relation or anchor differs from the request, the anchor is gone, or it is you | use the request's; if the anchor is gone, ask the requester |
| `E_CLONE_HARVEST` | harvest off not carried, or harvest turned on | carry exactly `oats.okf harvest=off` when the source has it off |
| `E_CLONE_BRIEF` | headings, the goal verbatim, size, UTF-8 | fix brief.md; distil, never truncate |
| `E_CLONE_SOURCE` | the source no longer resolves to the home you read | run dossier again; if it is gone, report |
| `E_CLONE_IDENTITY` (before spawning) | the clone would get a global (resident) identity: the source's seat | report; nothing was created |
| `E_DECISION_STALE` and other kernel codes | the kernel refused (`error.details.kernel`) | read the message; a stale decision means preview again |
| `E_CLONE_UNVERIFIED` | the clone exists but a check failed (`details.checks`) | report exactly what failed; **do not retire the clone**; leave it to the requester |
| `E_CLONE_IDENTITY` (after spawning) | the clone exists but its identity is not confirmed as its own | as for unverified |

## 4. Report

To the requester by aweb mail; in your own terminal when the request came
from the operator or you have no messaging (no `Comms:` line in TASK.md):

- the clone's name, home and relation;
- the brief's bytes and sha256, and the number of redactions;
- what was not carried, and why, in a line or two;
- caveats: transcript excluded or incomplete, uncommitted work left behind,
  checks that failed.

Never put secrets or brief contents in the report.

## 5. Retire

```bash
oats retire "$OATS_INSTANCE" --self
```

Also on `E_CLONE_UNVERIFIED` and a post-spawn `E_CLONE_IDENTITY`: report,
then retire yourself, but **never** retire the clone. Your `work/` stays
empty.

Retirement keeps a changed home in recovery storage. Once the apply has run,
`spawn` has already emptied `clone/` except `receipt.json`, which holds no
source text. If you stop **without** spawning (a refusal you cannot resolve, a
withdrawn request), first delete what you gathered, then retire:

```bash
rm -rf "$OATS_INSTANCE_HOME/clone"
oats retire "$OATS_INSTANCE" --self
```
