## Changed

- **A Git failure the kernel cannot classify reads `unknown`, with Git's own
  line, where it read `network`**
  ([#1059](https://github.com/awebai/oats/issues/1059)). `E_REMOTE_UNREADABLE`
  called every failure it did not recognise `network`, which sent people to
  look at a network that was fine. `details.reason` is now `network` only for
  what Git's text shows to be the network, and `unknown` otherwise; the
  message of an `unknown` failure ends with Git's last line (`cannot read
  remote <url> (unknown): <line>`), one line of at most 300 characters with
  control characters and the user information of any URL removed. No value
  was added to `details.reason` and no field changed
  ([Workspace](../desktop-cli-api.md#workspace)). The Desktop shows "Couldn't
  reach <host>" for `network` and `timeout` only, and the message in full for
  the rest.

## Fixed

- **A commit is fetched into the remote cache whatever the cache already
  holds** ([#1059](https://github.com/awebai/oats/issues/1059)). A spawn, a
  preview, `oats souls` or `oats workspace status` could fail with
  `E_REMOTE_UNREADABLE … (network)` in a second or two, every time, on a
  network that was fine: the fetch of a pinned package's commit, or of a
  member's new head, into a cache that held another commit of the same
  repository. It needed one file under 64 KiB at the wanted commit whose
  version at a commit the cache held was over 64 KiB, which a file that grows
  or is split produces in any repository. Git then received a pack it could
  not complete and the fetch died; a cache in that state could stay in it until
  it was deleted. The kernel now makes that fetch once more, whole, and it
  succeeds. Nothing needs to be done on a host that was affected: the next
  read fetches the commit.
- **The pack of a fetch that failed no longer stays in the cache for good**
  ([#1059](https://github.com/awebai/oats/issues/1059)). Each failed fetch
  left a temporary pack file in the cache's object store, which nothing
  removed; a host that retried for an hour held dozens. Every fetch into a
  cache now first removes the temporary files there that are older than the
  longest fetch (11 minutes). It goes by age and not at once, because a file
  that appeared during a fetch cannot be told from one another Git process
  is still writing.
