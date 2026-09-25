---
name: oats-onboarding
description: "Use when helping someone adopt OATS, choose an initial setup, configure their first persistent specialist, verify a first real task or hand off an onboarding blocker."
---

# Guide one bounded first task

This curriculum serves the persistent oats-assistant. Under the workspace model a deployment is realized from files: the shared `oats-workspace.yaml` (members, packages, teams, defaults) in its host repository, `oats-membership.yaml` in each member, each soul's `soul.yaml`, and the per-machine `oats-local.yaml`, applied with `oats onboard` and `oats sync`. The step-by-step setup is the oats.setup capability's (**oats-onboarding**, **oats-package-pins**); the soul that carries it is oats-operator-expert. Consult the installed kernel's CLI help and `docs/workspaces.md` rather than an older version's procedure, and do not invent a replacement setup skill.

## Interview before mutation

Ask for the actual first task and success criterion; which repository hosts (or will host) the workspace and which directory is the deployment; existing workspace files and lock; installed OATS version; available runtime; Git or non-Git work target; knowledge/messaging/tasks choices; and what the user authorizes changing. Do not collect keys or tokens. Do not assume a team, runtime/model, permission flag or provider default.

## Qualify the setup

1. Inspect the intended context and version with supported read-only commands. From an OATS instance, operational commands run at home; an explicit resolved scope is required for another deployment. An explicit soul selector does not erase inherited instance settings. Cross-deployment provisioning belongs in a clean operator context.
2. Separate declaring a package (the trust decision: review what it runs before adding its pin), giving a capability to a soul (`soul.yaml` or workspace defaults) and host-requirement consent. Preview exact effects (`oats spawn <soul> --preview`) and ask before changes. The lock is written only by `oats sync`; never hand-edit it or fabricate identity metadata.
3. Choose work discipline explicitly. Directory is an independent non-Git mode, not permission to write the surrounding repository. A runtime permission flag does not authorize the user's task.
4. Follow the selected knowledge capability's complete binding/provisioning protocol. External ownership declarations alone do not create accepted knowledge. Do not teach legacy soul-contained bundles as the new setup. A `none` choice is valid only where the source requirements and explicit operator policy permit it; this edition's required knowledge and messaging cannot be disabled to make setup pass.
5. Diagnose identity or wake failures without replaying hooks or deleting identity state. Preserve uncertain outcomes and route version-specific recovery to the selected provider's supported procedure and operator.

## Verify adoption

Agree on one reversible low-risk task. A scaffold checks layout and curriculum but can still run hooks/schedules; obtain authorization and isolate it. A real session must use the intended work context and return the promised result. Check actual consumption of delivered work rather than merely queued/sent status.

If learning is part of the goal, separately prove capture, independent judgment, delivery, acceptance and a fresh reader using the accepted result. A capability-kind helper is ephemeral and does not become a persistent knowledge owner; create/bind a separate ordinary persistent assistant only through an approved provisioning step.

## Handoff

Report observed version/scope, intended outcome, completed evidence, remaining blocker and one next authorized action. Keep instructions short and explain what success looks like. Route overall direction to oats-expert, kernel contract issues to oats-kernel-expert, Desktop behavior to oats-desktop-expert, and comparisons to market-research-expert. Verify availability before suggesting a spawn; absence means a report/request, not a fabricated running expert.

User-specific setup and pending work remain with the deployment. No credentials, private paths or raw delivery logs enter universal expertise.
