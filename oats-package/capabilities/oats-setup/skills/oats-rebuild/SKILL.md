---
name: oats-rebuild
description: >-
  Use when moving an existing deployment from an earlier OATS line to the
  workspace model, or rebuilding a deployment from scratch: sequencing the
  cutover, starting fresh provider state, converting declarations, and
  verifying the rebuilt deployment before relying on it.
---

# Rebuilding a deployment

The step-by-step guide is `docs/rebuild-to-v2.md` in the installed kernel
(`"$(oats root)/docs/"`); follow it, section by section, and treat each
behavioural sentence in it as a contract — if the kernel or a provider does
something else, stop and report it rather than working around it. The judgement behind the order is the
operator knowledge node (`oats/oats-operator-expert`); consult the concept
named at each step.

## Before touching anything

- **Sequence per deployment, not per machine.** Keep the previous kernel
  until the last deployment you still care about is rebuilt; for every old
  home the new kernel could launch, decide explicitly whether it may.
  *Rationale:* playbook "cutover is sequenced per deployment".
- **Retire self-custodial messaging identities from inside their homes
  before a home or its repository moves.** *Rationale:* lesson
  "self-custodial identity retires from inside the home".
- **Rehearse first** in a scratch deployment against local copies of the
  repositories, and label it a rehearsal: it is not the acceptance.

## The rebuild, in the guide's order

1. Decide the one workspace and its host (the hosting rule — see
   oats-onboarding).
2. Convert the shared declarations: the workspace file, a membership file in
   every member, souls moved to `souls/<name>/` with `soul.yaml` rewritten, a
   knowledge declaration (`okf.json`) beside each knowledge-owning soul. A
   soul left at an old path is invisible and nothing warns; enumerate the
   old paths (`git grep`) and the tests or scripts that globbed them.
3. Label every soul (or its repository's membership) with its team — an
   unlabelled soul silently receives only the base provider payload.
4. Write `oats-local.yaml` on each machine, with **fresh provider state**: a
   new knowledge state directory (and bindings file if the old one names the
   old state root). The previous state directory is frozen custody — read,
   never edited or re-pointed. *Rationale:* playbook "rebuild starts fresh
   provider state".
5. Place the messaging root inside the deployment directory (oats-onboarding
   step 6). *Rationale:* lesson "messaging root placement decides the team".
6. `oats sync`, approve packages (oats-package-pins), clone work targets.

## Accept it

Verify by positive enumeration on the rebuilt deployment (oats-onboarding
step 8), then prove the knowledge owner pin across a member move:

```bash
oats spawn <knowledge-owning soul> --purpose check --no-launch
# commit anything to that soul's member repository and push it, then:
oats sync
oats status                         # the first instance shows its soul source as moved
oats spawn <same soul> --purpose check2 --no-launch
```

The second spawn must succeed with the same owner. A single spawn proves
nothing about the pin. The rebuild is **accepted** only when an operator who
did not write the guide reproduces it on the published kernel and packages;
anything else is a rehearsal. *Rationale:* playbook "outsider verification
of a rebuild".
