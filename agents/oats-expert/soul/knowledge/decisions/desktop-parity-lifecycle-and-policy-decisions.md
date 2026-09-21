---
type: Decision
title: Desktop parity — lifecycle, enrollment, permission and automatic-PR decisions
status: accepted
description: Five policy questions the redesign forces on the kernel, decided by the lead under delegated human authority (2026-09-22). Remove retains worktree/branch/PR by default with the worktree re-homed outside the instance; Stop becomes a first-class recursive lifecycle action; "Enrol" means workspace member admission with a receipt and "signed by" means a verified Git signature or nothing; child-spawn permission is enforced by the spawn route; automatic PR is provider-owned, default off, triggered by the first pushed commit, opened as a draft.
tags: [decision, desktop, lifecycle, retire, stop, enrollment, trust, signature, child-spawns, pull-request, s8]
timestamp: 2026-09-22
---

Decided 2026-09-22 by the redesign lead. The human delegated these five
decisions explicitly ("do whatever you think is best, I am giving you
permission") after the Desktop engineer's plan
(`docs/design/2026-09-22-desktop-parity-seams.md`) named them as blockers.
Principle applied throughout: **the design's semantics win where they are
safe; where they imply authority OATS does not have, the UI tells the truth
instead of inventing it.**

# 1. Remove retains work by default; the worktree outlives the home

The redesign's Remove deletes the *instance* and retains worktree, branch and
remote PR unless the operator ticks "also delete …". Today retirement removes
owned worktrees with the home, and a worktree living under `H/work` cannot
survive `H` being deleted.

**Decision.** Adopt the design's default. Retirement gains a retention plan:
when the worktree is retained, the kernel **re-homes** it — `git worktree
move` to the deployment-level `worktrees/<repo>/<branch>` root (the design's
`~/.oats/worktrees/<workspace>/<name>` shape) — records the move in the
retirement receipt, and only then removes `H`. Branch and PR are never
touched unless the corresponding option is explicitly on; deleting a branch
uses the **verified current ref of the worktree**, never the spawn-time
recorded name; "has open PR" is a warning from P1 when available and
`unknown` otherwise (never silently "no PR"). Fail-closed recovery
(`E_WORK_PRESERVATION_FAILED`) is unchanged.

*Rejected:* keeping current semantics and relabelling the UI — it makes the
design's central safety promise ("your work survives removing the agent")
false. *Rejected:* leaving the worktree in place under a deleted home path.

# 2. Stop is a first-class, recursive lifecycle action

**Decision.** Add `stop` beside `retire`: quiesce the session (same exact
endpoint authority retirement uses), retain home, worktree, transcript and
launch configuration for `restart`, and apply to children by default with an
opt-out that lists them. "Mid-task" in the confirmation is reported activity
(dirty files, running operation) — when unknown, the text says unknown. Plan
→ apply with plan revision and idempotency key, revalidated under the
lifecycle lock (K3).

# 3. "Enrol workspace" = member admission; "signed by" = verified signature or nothing

**Decision.** Enrollment is **workspace member admission**: this deployment's
repository is recorded as a member of the workspace definition
(`oats-workspace.yaml` members + the member's `oats.yaml` backlink), through
the existing reciprocal-membership contract, producing a receipt with both
documents' revisions. It is not team registration, not native login, not
`oats onboard`. Until admission exists, the check reads `enrolled:
not-applicable` for standalone deployments and `fail` with the exact command
for workspace-scoped ones. "Skip" leaves it `not-applicable`, never `pass`.

"Trusted · signed by X" renders **only** when the acquired artifact's
source commit or tag carries a **verified Git signature** whose signer the
kernel can name (`signature: verified, signer: {id,label}`); otherwise the
row says "Trusted · unsigned" or "signature unknown". A catalog URL,
repository owner or byte hash is never a signer. "Policy allows child
spawns and worktrees" renders from the **enforced** policy (item 4) with its
origin; advisory or unknown policy renders as unknown.

# 4. Child-spawn permission is enforced by the spawn route

**Decision.** "Allow child spawns" becomes a captured per-instance policy the
**kernel spawn route enforces**: a spawn with `--relation child --relative-to
<parent>` (or `--parent`) is refused (`needs-configuration`, attributed to the
parent's policy) when the parent's policy is off. Default follows the soul's
declaration, overridable at spawn; the policy is recorded in the instance
metadata and the resolution. It is a lifecycle-authority claim, not an OS
sandbox, and the UI says so.

# 5. Automatic PR: provider-owned, default off, first pushed commit, draft

**Decision.** "Open PR automatically" is a P1 (Git/GitHub capability)
feature, **default off**, recorded at spawn. Trigger: the **first non-empty
commit pushed** to the instance's branch (the provider observes pushes; OATS
never commits or pushes on the operator's behalf). It opens the PR as a
**draft** against the selected base, titled from the opening instruction,
idempotently updates the same PR on later pushes, and records the PR id in
the instance's typed events (K2). Publishing (undrafting) is a human action.
A prompt asking the model to open a PR is not this feature and is not
labelled as such.

# Also confirmed

- The prototype's "Gemini" provider is illustrative; no kernel work. The
  provider dropdown lists the runtimes the CLI reports, nothing else.
- Frames 05 Knowledge and 06 Tasks stay excluded (human direction); their
  navigation entries state unavailability.

# Consequences

- Kernel: retention plan + worktree re-homing in retire; `stop` route;
  reciprocal-membership admission command + receipt; signature
  verification on acquired artifacts; enforced child-spawn policy; typed
  lifecycle events. Each lands as its own reviewed PR; the engineer's slices
  2c/5/6 wait on them.
- Provider: P1 (`oats.git`, GitHub backend) is a new official capability —
  spec'd as a separate Decision (dispatch contract for additive-capability
  structured views, credential policy, auto-PR).
- Desktop: renders these semantics and nothing stronger.
