---
type: Lesson
title: A dependency version bump must sweep test pins before the push, and the gate must be read before pushing
description: Bumping a mirrored package ref (catalog, soul source, mirror inventory) also changes hard-coded version assertions in tests; grep the whole repo for the old version string and never chain the push behind an unread test result.
tags: [release, review, tests, catalog, mirror, discipline]
timestamp: 2026-09-20
---

# What happened

Releasing OKF 2.1.1 required bumping the framework's `package-catalog.json`
ref, the transitional soul's `oats.okf@vX` source and the byte-mirror
inventory. The maintainer ran the focused tests and the push in one shell
chain (`node --test … && git commit && git push`); the tests reported 2
failures but the `rg` filter on the output swallowed the exit code, so the
commit and push happened with red tests. Both failures were hard-coded
version pins (`release-packaging`, `workspace-repository-layout`,
`okf-mirror-parity`) that assert the exact OKF version and catalog ref.

# Rule

- A catalog ref bump for a bundled capability (`capabilities/<id>/` copies of
  `oats.okf`, `oats.aweb`) is not complete until the bundled copy is byte-synced
  to the newly pinned payload — `test/capabilities.test.mjs` "bundled
  capabilities carry the versions package-catalog.json pins" enforces the
  version, and the clean-room smoke uses the copy as the official payload. The
  0.24.2 cut was recut once for exactly this after the aweb 1.11.0 pin.

- Before committing any version/ref bump: `rg -n "<old-version>"` across the
  WHOLE repo (`test/`, `scripts/` — the clean-room smoke pins the mirrored OKF
  version too —, `docs/`, `README.md`, mirrors, CI workflows), and update every
  intentional pin in the same commit. The same release later failed CI's
  tarball smoke on a pin in `scripts/clean-room-smoke.mjs` that a `test/`-only
  sweep missed; the tag had to be recut (allowed only because publish had not
  run).
- Never chain `git push` behind a test command whose output is piped through
  a filter; read the summary first, then commit and push as a separate step.
- Pinned-version tests are a feature (they catch silent drift); the cost is
  that every release touches them — treat that as part of the release
  checklist, not noise.
