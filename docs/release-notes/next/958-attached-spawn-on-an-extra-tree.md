## Changed

- **An attached spawn on an extra tree derives its owner and its repository
  (#958).** `oats spawn <soul> --work attached --work-dir
  <home>/.work-<purpose>` was refused twice: first for the repository
  (`pass --repo`), then, with that given, for the owner (`--parent
  <instance>`). For `<home>/work` the kernel derived both. An extra tree of
  a home is that home's tree too, so the same command now spawns with
  neither flag: the owner is the instance in whose home the tree is, the new
  instance is its child, and its repository is the repository of the tree
  it is attached to (for an extra tree the one Git names for it, which can
  be another member repository than the owner's own). `--parent <owner>`
  and `--repo` given explicitly still work, so a command that passes both
  runs on this kernel and on earlier ones. The tree is an extra tree by the
  kernel's own test (a registered linked worktree in a home), never by the
  shape of its path. Nothing changes for `<home>/work`, and no flag, key or
  field changes. One limit: when the owner is retired, an instance attached
  to one of its extra trees is not repointed as one attached to its `work/`
  is, so its `work` link then points at a path that is gone (#964).

  A tree of no known instance still needs both flags. Its refusal is now
  one, `E_BAD_ARGS`, and names every flag still missing: `attached workDir
  <path> is not a known instance's <home>/work or an extra tree of a known
  instance's home (<home>/.work-<purpose>), so neither its owner nor its
  repository is derived — pass both: --parent <instance> (the owning
  instance) and --repo <repository>`. With one of the two given it names
  the other. Before, the missing repository was refused first (`no
  repository for a attached instance — pass --repo (the work tree's owner
  records none)`), and the missing owner only on the retry, under the code
  `E_SPAWN_FAILED`. See
  [`attached`](../souls-and-instances.md#attached--another-instances-tree).
