---
type: Lesson
title: Consumers gate on advertised features, never on optimistic invocation — an unknown flag on an older CLI is not a no-op
description: A GUI that "tries" a new flag against whatever CLI is installed can trigger the OLD behaviour of the command — an older `retire` ignores an unknown `--plan` and retires. Every new command or mode ships with a positive advertisement in the version probe (feature name + API integer), and destructive applies carry a plan revision the kernel revalidates.
tags: [kernel, desktop, contracts, versioning, safety]
sources: [Desktop engineer pins on K3, fixed in PR66]
---

# Consumers gate on advertised features, never on optimistic invocation

## The hazard

New flags are additive on the kernel side, but a consumer talks to *whatever
CLI is installed*. Argument parsers that ignore unknown flags turn
`oats retire x --plan` on an older CLI into **`oats retire x`** — the read-only
intent becomes the destructive action. "Try it and see" is therefore not a
detection strategy for anything with side effects.

## The rules

1. **Every new command/mode ships with a positive advertisement** in
   `oats version --json`: a feature name in `features[]` and, for typed
   payloads, an API integer (`lifecycleApi`, `instanceGitApi`…). The consumer
   gates on the *name*, not on a version string (versions lie across forks and
   local builds) and never on "the call worked".
2. **Destructive applies carry the plan they were shown**: a `planRevision`
   the kernel revalidates against a fresh plan (`E_PLAN_STALE` with the fresh
   plan attached, nothing done) and an `idempotencyKey` that replays the
   recorded receipt on retry. Retention or re-home semantics are *what* the
   action does, never *authorization* to do it.
3. Absent feature → the view is **unavailable**, not degraded to the old
   command.

## How it surfaced

The Desktop engineer, reading the merged K3 head before wiring, noticed that
`retire --plan` had no advertisement and that `retireInstance` took no
revision/key — and refused to wire Remove until both existed. The producer
had shipped the plan and the semantics but not the two things that make a GUI
safe to drive them.
