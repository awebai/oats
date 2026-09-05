---
type: Decision
title: Keep runtime ownership and messaging delivery separate
description: The GUI observes managed sessions while aweb delivers wake hints through OATS runtime operations.
timestamp: 2026-09-05
---

OATS owns execution lifecycle, session receipts, inspection, input, and attach.
Aweb owns identity, SSE, delivery policy, and the per-host wake daemon. Desktop
is a client of these operations. The host service continues when viewers close.
Terminal input can wake Claude, Codex, and Pi without a native channel for each
harness. Native Codex messaging, if ever needed, belongs in aweb.

A wake submits a hint to fetch work from the instance's own identity context.
Submission is not consumption. The broker must not fetch or acknowledge mail
on the agent's behalf. Qualification checks actual fetch/reply, stopped targets,
restart recovery, and the configured native-channel opt-out.

Tmux and Herdr survive viewer detach, not host reboot. Recovery needs a fresh
supported execution receipt and one identity holder; replaying a saved command
alone does not establish a supported restart. Server registration uses existing
SSH configuration and key authentication, without copying keys into OATS.

These decisions came from the operator's September 2026 runtime and migration
requests and the joint aweb/OATS implementation. Current behavior and version
requirements are in docs/integrations.md and docs/operating-team-migration.md.
