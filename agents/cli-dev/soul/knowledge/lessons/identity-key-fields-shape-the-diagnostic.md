---
type: Lesson
title: The fields in an identity key become the vocabulary of every refusal that uses it
description: targetKey hashed sshHost, workspace and oatsPath, but E_ROUTE_CHANGED printed only host and workspace, so a registration edited in oatsPath alone refused with a message naming the same target on both sides.
tags: [cli, servers, diagnostics, review]
timestamp: 2026-09-05
---

`targetKey` in `lib/servers.mjs` hashes a route target into a stable id, used
for two different jobs: grouping the remote roster, and deciding whether a
registration has been retargeted under saved routes (`E_ROUTE_CHANGED`).

The first version hashed `sshHost`, `workspace` and `oatsPath`, and the
guard's message printed only two of the three:

    server build now points at h:/w, but 1 saved route for it (dev-r1) target h:/w;
    spawning would overwrite them. Keep the old registration and add a new server id
    for the new target, or retire those instances first

Verified verbatim for a `--replace` that changed only `--oats`. Both sides
identical, and the remedy offered was wrong for this case: it is the same
host, the same workspace and the same remote homes; only the binary path
moved.

Two rules fall out:

- A key's field set is a contract with every message that reports on it. If a
  field participates in the comparison, either the diagnostic must be able to
  name it, or the field does not belong in the key.
- Ask what each field is protecting. Host and workspace decide which machine
  and which homes; a different `oatsPath` is the same homes reached through a
  different binary, and each snapshot already carries its own
  `target.oatsPath` for later routes to run with. It bought nothing in the
  guard and cost a self-contradictory refusal, plus roster groups whose display
  lines were identical and separable only by the hash.

The same key drives the roster's grouping, so an over-specific key does not
just produce a bad message: it splits one operator-visible thing in two.
