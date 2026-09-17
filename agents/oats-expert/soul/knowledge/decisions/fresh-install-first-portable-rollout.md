---
type: Decision
title: Prioritize fresh Portable Souls deployments over historical migration
description: Controlled Portable Souls rollouts use fresh provisioning while historical migration is deferred without discarding state or changing target invariants.
tags: [portable-souls, rollout, migration, architecture]
timestamp: 2026-09-17
---

# Prioritize fresh Portable Souls deployments over historical migration

## Context

Portable Souls changes declaration, retained-artifact and execution-authority
contracts. Building a general in-place converter for historical deployments can
consume the critical path without helping a small, controlled early rollout whose
operators can provision fresh framework state.

## Decision

Use fresh installation/re-provisioning as the current rollout path. Complete the
new deployment and new instance lifecycle first. Automatic historical
reconstruction, comprehensive legacy conversion and additional migration-facing
CLI features are deferred, not release prerequisites for this rollout.

Keep the already delivered bounded, unselectable partial/unknown evidence tools
and refusal safeguards. Do not expand them merely to make old state look complete.
Park unfinished migration-only work rather than delete it or force it into the
new-install release. Redirect implementation effort to fresh setup/discovery and
the remaining captured runtime/lifecycle/provider acceptance.

## What this does not change

- Source-complete souls and by-reference imports; source identity, revision and
  local alias remain distinct.
- Two policy authorities, one resolver; explicit choices cannot erase hard
  requirements.
- Immutable per-execution authority and exact executable approval; no ambient
  source/config/lock substitution for captured consumers.
- Provider-neutral external knowledge and private-first messaging with actual
  provider qualification before privacy claims.
- No OATS-hosted registry, discovery daemon or user database.
- Partial/unknown history is never a reconstructed complete record. If historical
  migration is resumed, the accepted evidence and custody contract still applies.

## Preservation boundary

A fresh framework install is **not** permission to erase user repositories,
knowledge, native histories, unfinished work, identities or credentials. Prefer an
explicit fresh deployment/state location and preserve existing sessions until the
new path is qualified. Any cleanup or retirement remains explicit and uses normal
custody-preserving mechanisms, not a migration shortcut or forced wipe.

The [external knowledge custody decision](/decisions/external-knowledge-custody.md)
and [expert knowledge rebuild](/decisions/expert-souls-and-knowledge-rebuild.md)
remain in force. Runtime Git knowledge publication still uses PRs.

## Acceptance

Judge this rollout on a working fresh source/workspace → preparation/approval →
instance/lifecycle path, source-independent execution and real provider acceptance.
Track deferred historical conversion explicitly; do not mark it complete. Desktop
feature parity still follows infrastructure deployment rather than substituting
screenshots for these functional gates.

The captured execution path must work with **both tmux and Herdr**, using the existing
native backend abstraction rather than a second launch engine. Primary/helper dispatch,
restart and applicable lifecycle/recovery paths retain the same binding, incarnation,
intent, target and cleanup guarantees on both. Backend-specific request/receipt shapes
must reflect their actual adapters; no silent fallback to tmux or reinterpretation of
an admitted endpoint is acceptable. Backend parity is part of rollout acceptance, not
an optional deferred feature. Distinguish inert adapter tests and dispatch acceptance
from real native/model/helper and provider qualification.
