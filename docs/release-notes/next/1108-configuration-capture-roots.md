## Changed

- Capture setup registers each deployment's effective named launch-configuration
  transcript roots, including absent absolute directories. Registration is
  durable and independent across deployments; removed roots remain retired for
  discovery until explicitly forgotten. No capture history or custody changes.
- Root coverage warnings alone preserve setup exit 0 after independent setup
  work succeeds. Text/JSON summaries retain warnings and partial changes;
  registry/publication and unrelated setup failures remain nonzero. Existing-root
  busy admission has no effects; a losing first setup can leave only its exact
  checked/synced record-root prefix, reported as partial initialization. Health names
  `capture-roots-invalid`, `capture-roots-unavailable` and
  `capture-roots-refresh-required` with inspection/repair/setup remedies; retired
  root warnings include the exact scoped forget command. Resolved unreadable
  diagnostics retain their exact registered path; health suppresses only that
  matching warning on an observed readable or proven-absent path, without
  rewriting the inventory. Future consumers must
  render generic code/message rows without a root-code allow-list.

## Upgrade

- Run `oats setup` once in each deployment after upgrading and after changing a
  launch configuration's transcript location or referenced location environment.
  Use absolute locations; pi's native `~/` form is supported. Relative,
  unresolved and malformed selectors produce per-configuration warnings.
- Rolling back to an old binary loses this additional coverage: old services do
  not read the inventory. Entries and history remain; upgrading and running
  setup restores coverage. Current configuration snapshots do not cover
  provider-generated locations or differing frozen-home recipes.
- Relevant framework skill updates require a separately tagged framework
  release; existing homes do not update automatically.
