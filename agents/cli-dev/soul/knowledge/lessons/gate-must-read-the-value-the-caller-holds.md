---
type: Lesson
title: A capability gate must read the field the caller actually holds
description: A Desktop remote gate keyed on cli.remote could never open, because its caller holds the /api/cli HTTP projection rather than the locator's discovery state, and that projection enumerates its fields.
tags: [desktop, cli-locator, fail-closed, review, test-seams]
timestamp: 2026-09-05
---

Reviewing b91a36c (Desktop remote-session gating) I found a gate that can never
open. The shape is worth remembering because both halves were individually
correct and individually tested.

`discover()` in `packages/desktop/cli-locator.mjs` was extended to retain
`payload.remote` from the `oats version --json` probe, and
`requireRemoteSupport(cli, "session")` throws unless `cli.remote` includes the
operation. But the only caller, `term:open` in `packages/desktop/main.mjs`, does
not hold the locator's discovery state — the locator runs inside the bundled
server process, and main fetches `GET /api/cli` and passes the parsed HTTP body.
That body is built by `cliStatus()` in `packages/desktop/server/oats-web.mjs`,
which **enumerates its fields explicitly**. `remote` was not added to the
enumeration, so `cli.remote` is `undefined` at the gate for every CLI version.

The sibling gate is the tell: `requireExecutionSupport` is called *in the server*
against the raw `cliState`, which does carry `runtimes`/`sessionBackends`/
`launchOptions`. Same module, same fail-closed style, different process — and the
process boundary is where the field was lost.

Two general rules:

1. **When a gate and its input live in different processes, the review question
   is not "is the gate right" but "what object does the caller actually hold".**
   An explicitly-enumerated projection (as opposed to a spread) silently drops
   every field nobody remembered to add, and drops it in exactly one direction:
   toward fail-closed, which looks like the gate working.
2. **A test per layer is not a test of the seam.** Here one new test asserted
   `discover()` retains the field and another handed `prepareRemoteTerm` a
   hand-built `{bin, version, remote:["session"]}`. Both pass; 24/24 green; the
   feature is dead in production. The test that would have caught it asserts that
   the `/api/cli` payload satisfies `requireRemoteSupport` — it spans the
   projection instead of re-checking either side of it.

Related: [/lessons/generous-stub-fail-closed-open-gate.md](/lessons/generous-stub-fail-closed-open-gate.md)
(a gate that passed for the wrong reason) and
[/lessons/single-implementation-guarantee.md](/lessons/single-implementation-guarantee.md)
(hardening one of two paths).
