---
type: Decision
title: Selected instance curriculum and runtime-specific visibility
status: accepted
description: OATS materializes an exact selected curriculum, with strict Pi visibility and normal native context coexistence for Claude Code and Codex.
tags: [architecture, skills, context, runtime, providers, composition]
timestamp: 2026-09-18
---

**Status: accepted 2026-07-26, explicitly narrowed by the human 2026-09-18.**
[Claude Code and Codex now use normal native launch](/decisions/claude-codex-native-launch.md),
including ordinary native context and skills; their adapters need not enforce
OATS-only visibility. Pi's selected strict profile remains unchanged. The original
rejection of [ambient coexistence](/decisions/config-authorship-and-ambient-skills.md)
is therefore no longer universal. Exact OATS composition and
[skill layering](/architecture/skill-layering.md) remain common contracts.

# Original context

The following rationale motivated the original universal target. The later
human decision retains exact OATS composition but deliberately allows normal
native context coexistence for Claude Code and Codex.

A specialized agent should not start with a catalog of a hundred unrelated
skills and hope the model ignores ninety-five of them. OATS already knows the
soul being instantiated, its agent type, its local config chain, and the
capabilities selected for it. Spawn can therefore construct the relevant
curriculum rather than exposing every personal, workspace, harness-package, or
ancestor skill.

OATS temporarily allowed harness-ambient skills to coexist to reduce adoption
friction. That made the OATS-managed set exact but the full visible skill set
non-deterministic: different machines could expose different skills, ambient
content could collide with selected content, and “no skill noise” could not be
an honest runtime claim.

The founder confirmed that curation at soul instantiation is fundamental OATS
value. Users who want a skill available to an agent should make that choice
explicitly through the soul or an assigned capability, not through accidental
ambient discovery.

# Decision

## Strict composition at instantiation

When OATS instantiates a soul, it resolves and materializes exactly:

1. kernel skills and baseline instructions required by every instance;
2. soul-private skills and canonical soul instructions;
3. skills and instruction injections from capabilities active for that soul
   under the resolved local config; and
4. explicit config-owned instruction blocks and approved overrides.

Runtime adapters expose this instance-local OATS composition. The selected
strict Pi profile disables unrelated ambient skill/instruction discovery.
Claude Code and Codex retain ordinary native discovery alongside it; OATS does
not claim exclusive visibility there. Pre-workspace bootstrap remains distinct
from composition of an existing OATS instance.

`instance.json` records the selected OATS skill/injection surface and provenance,
not every native resource visible in Claude Code or Codex. Duplicate names inside
the OATS-managed set follow the explicit override contract; native coexistence
and native discovery precedence are not a second OATS resolver.

## Scope of “only what it needs”

Strict curriculum applies to discoverable agent skills and instruction
injections controlled by the OATS/runtime integration. It does not hide:

- the source files in the instance's assigned work tree;
- the explicit task briefing or prompts sent during the session;
- built-in tools and native interaction features of the selected harness; or
- provider-native workflows deliberately invoked by that specialist.

This distinction preserves provider strengths. A Claude Code developer may
still use Claude Code's native development workflow and tools; a Pi-based
coordinator keeps Pi's interaction model. The strict Pi profile excludes the
unselected ambient catalog; Claude Code and Codex intentionally retain their
normal native context under the later decision.

A provider plugin, channel, or runtime extension required by an active
capability is not ambient: it is part of the selected capability's declared,
locked, trusted composition and must appear in provenance.

## How users add skills

A skill enters the OATS-managed composition through an explicit source:

- put role-private behavior in the soul;
- distribute reusable behavior in a package capability and assign it in
  `oats-config.yaml`; or
- add an explicit config-owned instruction block where appropriate.

This makes OATS-managed relevance, portability, review and diagnosis explicit.
Claude Code and Codex may also discover native skills normally. Package profiles
may recommend OATS assignments, but local config remains authoritative and every
capability stays independently targetable.

## Runtime adapter requirement

The selected Pi adapter must provide a verified strict launch mode:

- disable ambient skill and instruction discovery;
- expose only the instance-local OATS composition;
- preserve the runtime's built-in tools and native workflows;
- report unsupported or incomplete isolation as a launch/doctor error rather
  than silently falling back to ambient discovery; and
- carry parity tests proving the visible selected surface for each supported
  runtime.

Use supported Pi interfaces. Claude Code and Codex instead follow their
[normal native launch contract](/decisions/claude-codex-native-launch.md), without
OATS-only isolation checks or default permission bypass. The kernel remains
provider-neutral; exact OATS composition does not require identical native
visibility policies.

# Consequences

- The OATS-supplied curriculum remains selected and auditable for every runtime.
- Full visible skill/instruction exclusivity is a Pi-profile claim, not a
  universal claim about Claude Code or Codex.
- Claude Code and Codex preserve native personal/workspace context and skills;
  no extra isolation adapter or Pi dependency is required for normal launch.
- Native tools, workflows and user permission policy remain available.
- Adapter tests verify the policy selected for that runtime, rather than impose
  Pi's stricter visibility on all harnesses. README claims must match actual
  implementation and released qualification.

# Original options considered

These are historical reasons for the 2026-07-26 decision. The later explicit
Claude Code/Codex native-launch decision supersedes their universal application.

1. **Keep ambient coexistence and scope “no noise” to OATS-managed skills.**
   Rejected: the agent still sees unrelated skills and machine-specific
   collisions, weakening specialization at the actual runtime boundary.
2. **Make strict isolation optional.** Rejected as the default architecture:
   it turns the central curation promise into a deployment accident. A future
   explicit escape hatch would have to identify itself as leaving strict OATS
   composition and must not be silent.
3. **Remove provider-native tools and workflows too.** Rejected: OATS curates
   agent curriculum; it does not replace or deliberately cripple the chosen
   runtime. Provider strengths are part of why mixed-provider specialization
   is valuable.
