## Added

- **`/oats-upgrade`, an oats.setup skill for "upgrade OATS" and "update to
  the latest".** It takes the latest version from
  `npm view @awebai/oats version`, reads [Upgrading](../upgrading.md) and
  the `## Upgrade` section of every release after the installed one at the
  tag `v<latest>`, never the copy in the installed CLI, and walks the person
  through the Desktop, the CLI, the pi bridges, `oats doctor` and each
  release's own steps, one step on each yes. On a tag whose page does not
  open with the latest version yet (up to v0.67.0), it takes the order from
  the page and the version and the Desktop's CLIs from the latest release's
  notes. `/oats-setup-model` points at it instead of the installed copy. It
  ships with the next oats.framework release
  ([#1440](https://github.com/awebai/oats/issues/1440)).

## Documentation

- **[Upgrading](../upgrading.md) opens with "Upgrading to the latest
  version":** the latest version, the CLIs its Desktop accepts and the
  steps. What each older release asks of a host that comes from it is under
  "Coming from an older version", one line per release, newest first, each
  linking its notes; the capture service's release order is there too. The
  page states only the latest Desktop's CLIs; the earlier ones stay in
  their notes ([#1440](https://github.com/awebai/oats/issues/1440)).
- **The release-prep pull request updates that section with the notes**
  ([Release lane](../release-lane.md#for-the-tag-owner)), and
  `test/release-packaging.test.mjs` checks that it names the version the
  manifests carry, and no other.
