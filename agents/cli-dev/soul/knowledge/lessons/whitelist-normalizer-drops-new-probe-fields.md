---
type: Lesson
title: A whitelisting probe normalizer makes every new probe field dead on arrival
description: checkRemote rebuilt the remote version probe from a fixed key list, so a guard reading remote.features never fired even though the probe, the fixture check and the docs all carried the new field.
tags: [servers, remote-routing, version-probe, review]
timestamp: 2026-09-05
---

Branch `servers-roster` added a `features: ["retire-home"]` list to
`oats version --json` (bin/oats.mjs), asserted it in the CLI JSON contract
test and in `scripts/check-version-probe.mjs`, documented it in
`docs/servers.md`, and gated the routed retire on it:

    const homeArgs = snap?.home && Array.isArray(remote?.features)
      && remote.features.includes("retire-home") && !oatsArgs.includes("--home")
      ? ["--home", snap.home] : [];

Every one of those passed. The guard was still dead: `checkRemote` in
lib/servers.mjs does not return the raw probe, it rebuilds a normalized
object from a fixed key list (version, schemaVersion, desktopApi, runtimes,
sessionBackends, launchOptions, remote, advertised), so `remote.features`
was `undefined` on a remote that advertised it, the `Array.isArray` guard
failed closed, and `--home` was never sent.

Why nothing caught it: the probe producer and the probe consumer were each
tested against themselves. The contract test checks what the LOCAL CLI
prints; the version probe script checks the same bytes. Neither exercises
the round trip through `checkRemote`, which is the only place the field has
to survive. A whitelisting normalizer is exactly the shape where "the field
is in the payload" and "the field reached the code that reads it" are
different claims, and only the second one matters.

What to do:

- When a normalizer whitelists keys, adding a probe field is a TWO-file
  change: the producer and the normalizer. Grep the normalizer, not the
  payload, when reviewing a new probe field.
- A one-line proof beats reading: call the normalizer with a fake
  `io.execFileSync` returning the full probe and print `Object.keys()` of
  what comes back.
- A feature-flag guard that fails closed produces no symptom at all. Any new
  `Array.isArray(x?.y) && x.y.includes(...)` gate needs a test that asserts
  the POSITIVE branch fires, or it is indistinguishable from dead code.

Related: [recording-a-disambiguator-is-not-passing-it](recording-a-disambiguator-is-not-passing-it.md).
