## Upgrade

- **On every host where `oats setup` was run, run `oats setup` once more
  after upgrading the CLI, as the same user
  ([#1003](https://github.com/awebai/oats/issues/1003)).** The capture hooks
  in `~/.claude*/settings.json` and the capture watcher's unit still name the
  `node` that ran the earlier setup, and nothing else rewrites those files:
  no `oats update`, spawn, start or restart. The run replaces its own hooks
  and unit and adds no second one. `oats setup --dry-run` first prints the
  `node` it would record and changes nothing. The same step follows a change
  of Node version wherever the recorded path does not outlast it
  ([Upgrading](../upgrading.md#after-a-change-of-node-version)).

## Fixed

- **`oats setup` records a `node` that survives an upgrade of Node, and
  quotes what it writes
  ([#1003](https://github.com/awebai/oats/issues/1003)).** It wrote the path
  of the `node` it ran under into the capture hooks of every
  `~/.claude*/settings.json` and into the capture watcher's unit. On Homebrew
  that is the versioned keg, which `brew upgrade node` removes: the hooks
  then failed at every stop of every Claude Code session of that user, and
  launchd or systemd kept restarting a watcher that could not start. Now:
  - **It records the path the kernel hands every hook (`OATS_NODE_BIN`):** on
    Homebrew the `opt` link, else a `node` on `PATH` that is the same file,
    else the path as it is.
  - **When there is no stable path it says so,** once, a dry run included:
    the capture hooks and the watcher stop when that `node` goes away, and
    `oats setup` is to be run again after installing a `node` with a stable
    path.
  - **Each path is quoted for what reads it:** a shell word in the hook's
    command, systemd's quoting in `ExecStart`, XML text in the launchd plist.
    A `node` or an install under a path with a space in it no longer splits.
    A path of plain characters is written as before.
  - `turn-record setup`, run without the kernel, records the `node` it runs
    under, as before, with the same quoting.
  - For installs that already exist, see Upgrade above.
