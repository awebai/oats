## Changed

- **A pull request writes its release-notes entry in a file of its own**
  ([#1018](https://github.com/awebai/oats/issues/1018)). The entry goes in
  one file under `docs/release-notes/next/`, and the pull request no longer
  touches the version's notes file, so two pull requests that share no code
  no longer conflict there. `node scripts/assemble-release-notes.mjs --tag
  vX.Y.Z`, run in the release-prep pull request, moves the entries into the
  notes file and removes the entry files. **A tag is refused while an entry
  file exists**, by the release workflow and by `scripts/release-lane.mjs
  build`, before anything is built or published.
  [Release-notes entries](../release-lane.md#release-notes-entries) has the
  rule.
