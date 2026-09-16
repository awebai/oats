---
type: Decision
title: Messaging capabilities consume kernel contracts and own provider behavior
description: OATS supplies provider-neutral messaging intent and lifecycle contracts while the selected capability implements native identity, membership, transport and qualification.
tags: [messaging, capabilities, portable-souls, architecture]
timestamp: 2026-09-16
---

# Messaging capabilities consume kernel contracts and own provider behavior

## Decision

Messaging runs through the selected messaging capability. The kernel defines the
contracts it consumes; the aweb capability implements them using aweb's supported
native mechanisms. Do not embed aweb account, team or API logic in the kernel or
create a parallel OATS messaging subsystem.

## Kernel responsibility

Provide captured, validated intent and invocation authority: deployment/resolution,
source and instance identity, qualified workspace or explicit standalone context,
responsible-human reference, private floor and explicit wider choices, requested
action/lifecycle event and prior opaque provider receipts. Preserve human ownership
for children and scheduled work. Use existing provider binding, messaging choice,
approval, resolver and manifest-owned command/hook contracts; version any missing
generic invocation fields explicitly rather than invent provider-specific inputs.

Retain nonsecret choices and credential lookup references, not credential values
or a claim that mutable membership/access is frozen. Keep readiness, action
results and cleanup obligations explicit.

## Capability responsibility

Resolve native human/identity references, use native credential facilities,
provision or reuse the correct private team, reconcile requested wider membership,
provide transport and report provider-specific receipts and qualification evidence.
These mechanisms and any provider-owned mapping state belong to the capability;
they must not become an OATS user database or hosted control plane.

Read-only checks do not provision. Explicit setup/lifecycle actions may provision
when admitted by their action-specific preconditions; admission to setup is not a
claim of completed enrollment. Preserve idempotency, ambiguity refusals and cleanup
custody, then establish the resulting readiness separately.

## Qualification discipline

Catalog visibility, live-instance visibility, contact and history are deliberately
separate grants. They need not share one native provider API. Verify the actual
mechanism for each; contact is not permission to read history.

A missing field in one CLI response is not proof of missing provider capability.
First investigate supported resolution/resources/APIs inside the adapter; escalate
only a concrete unavoidable backend gap. Never substitute an OS user, agent alias
or guessed identity, and never turn fixture/configuration success into a privacy
claim.

This refines the [kernel/provider separation](/decisions/kernel-and-providers.md)
and [capability extension seams](/decisions/capability-extension-seams.md), without
changing the accepted two-authority resolution or private-first target.
