---
type: Lesson
title: Content-addressed turn IDs do not authenticate native session capture
description: Native transcript turns get content hashes without signatures, while signed aweb projections preserve their source signatures verbatim.
tags: [documentation, turn-record, signatures, provenance]
timestamp: 2026-09-05
---

# Content-addressed turn IDs do not authenticate native session capture

A content-derived turn ID proves that the stored core matches its hash. It does
not authenticate who produced that core.

The native transcript path in `packages/record/lib/capture-cc.mjs` builds an
unsigned core with `eventTurnCore`. It then passes that core to `finishTurn`.
In `packages/record/lib/canonical.mjs`, `finishTurn` adds only the `t1:` SHA-256
content ID. It does not add `sig` or `signature`.

Signed aweb mail and chat follow a different path. `projectSignedRow` in
`packages/record/lib/project-aweb.mjs` copies the source `signed_payload` and
`signature` into the projected turn verbatim. Documentation should therefore
call native session turns **content-addressed**, not signed. It should describe
aweb signatures as preserved source signatures rather than authentication
created by turn capture.
