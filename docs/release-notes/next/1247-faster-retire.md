## Changed

- **A retire with a large work tree is about twice as fast
  ([#1247](https://github.com/awebai/oats/issues/1247)).** On a Linux
  laptop (btrfs on dm-crypt), the retire of a home holding about 400 MiB in
  37,000 files under `work/` took 18–30 s and now takes 10–17 s. Every
  recovery copy is still written and verified before the retire hooks run,
  and every safety rule is kept.
  - **Cold reads in parallel.** A digest reads its files one at a time, and
    a tree outside the page cache read at about 40 MB/s: the copy of a
    clone just made by a reflink, or a `node_modules/` not read for a
    while. A few worker threads now read the next files ahead of it. No
    digest value changes, including those of baselines older kernels wrote,
    and no error changes. The verification still reads the copy's own bytes
    back.
  - **One read per state.** A worktree's untracked and ignored digest and
    its bytes are taken from one read of each file, both before the hooks
    and after them.
  - **A directory instance's pre-hook copy no longer reads its source a
    second time.** A file changed before the copy read it still refuses the
    retire before any hook runs. A file changed during the copy, after it
    was copied, used to refuse the retire. It is now preserved, verified,
    under `after-hooks/`, as a worktree's work already was
    ([souls-and-instances.md](../souls-and-instances.md)).
