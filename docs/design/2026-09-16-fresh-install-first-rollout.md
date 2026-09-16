---
type: Decision
status: accepted
title: Fresh-install-first Portable Souls rollout
description: Prioritize fresh provisioning over automatic historical migration while preserving target architecture and user custody.
timestamp: 2026-09-16
---

# Fresh-install-first Portable Souls rollout

The rollout can use fresh framework installations in controlled early deployments.
General in-place migration and historical reconstruction are therefore **not on the
current release-critical path**. This amends delivery sequencing in the
[implementation handoff](2026-09-15-portable-souls-handoff.md), not the underlying
[retention/evidence contract](2026-09-14-artifact-retention-contract.md).

## Priorities

1. Complete fresh source/workspace discovery and explicit deployment preparation.
2. Complete new-instance captured work placement, managed runtime/launch, lifecycle
   and independent-work consumers, using one resolver and retained authority.
3. Qualify real provider behavior, including private-first messaging, then release
   and deliberately provision the new deployment.
4. Deliver Desktop functional/UI parity after infrastructure deployment.

Park additional historical conversion, reconstructed-record publication and
migration-facing CLI development. Keep already delivered bounded partial/unknown
evidence and refusal safeguards; do not delete them or call deferred work complete.
Fresh setup should reuse existing discovery/preparation mechanisms, not introduce
another config engine, registry or broad installer subsystem.

## Unchanged architecture and custody

Source-complete souls, by-reference imports, two authorities/one resolver,
immutable captured execution, exact approval, provider-neutral external knowledge
and no new hosted control plane remain required. A clean install does not waive
source-deletion/A-versus-B execution acceptance or actual provider/privacy checks.

Fresh OATS state does not require deleting an existing project repository. It is
not permission to wipe knowledge, native transcripts, unfinished work, identities
or credentials. Use explicit fresh state/deployment locations; preserve old data
and running sessions until replacement is qualified. Cleanup/retirement remains
explicit and custody-preserving.

If historical migration is revisited later, missing evidence stays partial/unknown;
old trust or current files cannot be used to invent historical authority. This is
a scoped deferral, not a second permanent resolution engine or a weakened contract.
