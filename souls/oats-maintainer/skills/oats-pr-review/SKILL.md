---
name: oats-pr-review
description: "The OATS repository's part of a review: which consumers to read, the security surfaces specific to OATS, this repository's test gate and its release notes. Load it with /pr-review whenever you review an OATS pull request, verify fixes or assess merge readiness."
---

# Reviewing an OATS pull request

`/pr-review` (from `oats.maintainer`) is the method: exact heads, four gates, the verdict on
the PR, the guarded merge and the check that what landed is what you reviewed. This skill
adds what is specific to the OATS repository.

## Correctness: OATS's usual consumers
Besides what the search finds, check these every time: the pi adapter (`packages/pi`),
the Desktop's bundled server (`packages/desktop`), and the capabilities, including the
package mirrors in `mirrors/`.

## Security: OATS's surfaces
Package trust and lock integrity, path containment, exact instance and host identity, and
how user content is rendered in the Desktop.

## The gate
OATS's pull-request CI runs the full suite (sharded), `check`, `validate`, `pack:check`
and the clean-room smoke. Expect the author to have run the affected test files plus
`npm run validate` and `npm run check`, and `npm run smoke:tarball` when the change touches
the smoke script or packaging. For a knowledge change, run the OKF validator over the
whole base and read its warnings.

## Mergeability: notes
Every behaviour change carries its release-notes entry as one file under
`docs/release-notes/next/` and updates the `docs/` page that owns the rule. Its entry
does not go into `docs/release-notes/<next version>.md`: the release-prep PR moves the
entries there. The pull request touches that file in one case only: it makes an entry
already there untrue, and corrects it in place. Then check that it changes only the
sentences it makes untrue, that its description names them, and that no released notes
file is changed. `test/release-notes-entries.test.mjs` holds the entry file to its form
(the name, the section headings, nothing else), not to what it says: read the entry.
`docs/release-lane.md`, "Release-notes entries", is the rule.
