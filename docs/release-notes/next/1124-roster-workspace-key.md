## Added

- **`oats server roster --workspace-key <key>`** (feature
  `roster-workspace-key`, repeatable) probes and returns only the groups that
  can belong to the given workspaces: a registration recorded for one of
  them, a registration whose workspace is not known yet, and a server known
  only from saved routes, which is always probed because its workspace is
  unknown. A host registered for another workspace is not asked, so a
  switched-off host no longer delays the roster of every other workspace's
  window. The answer's shape is unchanged; without the flag it is exactly as
  before. A key is compared exactly with the registration's `workspaceKey`;
  an empty, missing or malformed value is `E_BAD_ARGS`
  ([the flag](../desktop-cli-api.md#roster-workspace-key),
  [#1124](https://github.com/awebai/oats/issues/1124)).
