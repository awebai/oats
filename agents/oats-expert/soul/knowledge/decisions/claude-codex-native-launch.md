---
type: Decision
title: Claude Code and Codex use normal native launch with explicit permission bypass
authority: human
status: accepted
description: Claude Code and Codex retain ordinary native context, skills and permission behavior; OATS adds bypass flags only for an explicit user opt-in.
tags: [architecture, runtime, claude, codex, context, permissions]
timestamp: 2026-09-18
---

**Accepted by the human 2026-09-18.** This narrows the earlier universal
[strict runtime curriculum](/decisions/strict-instance-curriculum.md) requirement
for Claude Code and Codex. It does not change the selected strict Pi profile.

# Decision

## Normal native context

Launch Claude Code and Codex normally. Preserve their ordinary context and skill
discovery, native settings, plugins, profiles, tools and authentication behavior.
OATS still builds the COMPLETE resolved instance home: selected skills,
capabilities and their normal resources/setup, composed instructions, task,
metadata, work placement and normal lifecycle wiring. Supply them through the
usual instance files and briefing, including canonical AGENTS.md and its
CLAUDE.md alias. The human explicitly reaffirmed full home construction; native
launch does not mean an empty/minimal home, omitted capabilities or skipped
resolution/approval/hooks.

Do not require either harness to expose only OATS-provided context or skills.
Do not suppress native discovery, replace HOME/profile directories, or build a
Pi-like isolation adapter merely to obtain that exclusivity. Their launch must
not depend on installing or selecting Pi. Additional native context is expected,
not a failed OATS isolation check.

OATS still records and validates the composition it supplies. That is provenance
of the OATS-managed subset, not a claim that every instruction visible inside
these native harnesses was supplied by OATS.

## Permission bypass is explicit opt-in

With no user opt-in, retain native permission, approval, sandbox and trust
behavior. OATS must not automatically add Claude's
`--dangerously-skip-permissions`, Codex's `--yolo`, equivalent bypass/sandbox-
disabling options, or automatic trust overrides.

An explicit user launch choice or user-configured opt-in can request the existing
bypass behavior. An unattended/background launch is not itself consent. Preserve
explicit false; do not manufacture a true default or mistake a missing setting
for permission to bypass. Selecting ordinary launch is not permission to rewrite
existing user configurations or frozen execution records.

Omitting OATS bypass flags leaves native user settings in force; it does not
silently force a different native policy or repair authentication. The
[native authentication boundary](/decisions/harness-native-authentication.md)
continues to apply to all harnesses.

# What does not change

- Pi-specific strict resource loading remains scoped to the selected Pi adapter.
- Canonical OATS composition, source integrity, captured runtime/model selection,
  helper edges, execution admission/retry and history attribution/custody retain
  their existing contracts. Native context coexistence does not authorize a
  current-OATS-config fallback or another model.
- Knowledge and messaging remain provider-neutral capabilities. A Pi-first
  implementation slice is not full Claude Code/Codex feature qualification.
- This is not permission for broader record redesign, secret handling, implicit
  runtime-package installation or a new harness service.

# Verification

Use focused launch/default/override regressions: normal Claude/Codex commands
must lack OATS-only context isolation and implicit permission bypass; explicit
user opt-in must retain its documented behavior. Preserve the harness's normal
profile/auth environment. Unit or scaffold-only checks do not claim live model
or complete captured harvesting parity across all runtimes.
