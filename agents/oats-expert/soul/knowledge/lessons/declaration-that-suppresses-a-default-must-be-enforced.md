---
type: Lesson
title: A declaration that suppresses a default must be enforced, or it produces a hollow result
description: When writing a declaration causes the kernel to withhold a default (e.g. a soul's declared operational capability suppresses legacy skill injection), the kernel must refuse when the declared replacement is absent — otherwise the honest declaration yields a silently worse outcome than no declaration at all.
tags: [kernel, requirements, refusal, first-team-path]
sources: [second-operator finding on 0.24.6; fix PR55]
---

# A declaration that suppresses a default must be enforced

## The pattern

A creation path writes a *declaration* (soul `requires.capabilities: {oats.core}`)
whose meaning the composer honours by **withholding the legacy default** (kernel
skill injection). Nothing on that path *provisions* the declared replacement —
by design, declaration is not acquisition. If the spawn path does not check that
the declared thing is actually active, the instance starts with **neither** the
default nor the replacement: a hollow agent, with no warning, on the very path a
first-time operator takes.

## The rule

Whenever the kernel withholds a default because of a declaration, the same kernel
must **refuse** when the declared replacement is not present — attributed, before
any side effect (home, worktree, identity), with the exact remedy and the
supported opt-out (remove the declaration). "Declared but inactive" is an unmet
requirement, and unmet requirements refuse; they never degrade silently.

Corollaries:
- The creating command should state the follow-up step up front (`next-step`
  note), so the later refusal is never a surprise.
- A read-only projection of the same fact (inspect: `readiness.requirements[].active`)
  is not a substitute for enforcement at the point of consequence.
- Test fixtures that "happened to work" under the hollow behaviour are
  themselves the defect surfacing; make them opt out explicitly rather than
  weakening the check.

## Why it was missed

Each half was correct in isolation: composition honoured the declaration; create
deliberately did not acquire; install deliberately did not activate. The gap was
between them, and only an operator walking the whole path end to end saw it —
which is what a second operator is for.
