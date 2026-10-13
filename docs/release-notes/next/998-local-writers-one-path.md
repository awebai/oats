## Changed

- **`oats launch-config set|remove` and `oats schedule|trigger
  enable|disable` take the lock of `oats-local.yaml`, and answer its two
  codes ([#998](https://github.com/awebai/oats/issues/998)).** Every kernel
  command that rewrites `oats-local.yaml` now does it one way: under
  `<deployment>/.agents/locks/local.lock`, from the file as it is under that
  lock. These four commands can therefore answer what `oats teams` and
  `oats soul launch` already answer: `E_LOCAL_BUSY` (`details: {path,
  lock}`) when the lock is still held after 5 s, and `E_LOCAL_CHANGED`
  (`details: {path}`) when the file kept changing while the edit ran.
  Nothing was written in either case, and the same command can be run
  again. Their other answers are unchanged: the receipts, the codes and the
  texts. `oats launch-config set` reads and judges its arguments and its
  definition before it takes the lock, so when two refusals apply at once,
  that one is now the one answered. The text of `E_LOCAL_BUSY` no longer
  lists commands: it says to remove the lock "if no oats command that edits
  this file is running". See [`oats teams`](../desktop-cli-api.md#oats-teams)
  for what the lock covers.

## Fixed

- **Two commands that rewrite `oats-local.yaml` no longer drop each other's
  change ([#998](https://github.com/awebai/oats/issues/998)).** `oats
  launch-config set|remove` read the file when it started and wrote it back
  without the file's lock, and `oats schedule|trigger enable|disable` took no
  lock either. Either could overwrite what `oats teams`, `oats soul launch`
  or the other had written in between: a team, a soul's launch preference, a
  launch configuration or an opt-out was gone, with no error. All of them
  now write under one lock, each from the file as it is then.
- **`oats schedule|trigger enable|disable` of a workspace item writes
  `oats-local.yaml` whole, and leaves its long lines alone
  ([#998](https://github.com/awebai/oats/issues/998)).** The file was written
  in place, so a command killed during the write could leave half of it; it
  is now written beside and renamed in. A line longer than 80 columns
  elsewhere in the file was folded onto several lines by the write, and
  stays as written now. A deployment whose `oats-local.yaml` is written as
  JSON could not opt out at all (the command failed with
  `invalid-declaration` and wrote nothing): the opt-out is now written, and
  the file stays JSON.
- **A kernel command that rewrites `oats-local.yaml` keeps the file's
  permission bits ([#998](https://github.com/awebai/oats/issues/998)).**
  `oats teams`, `oats soul launch` and `oats launch-config set|remove`
  replace the file by a rename, and the new file got the bits the process's
  umask gives: a file its operator had made private (`0600`) came back
  readable by others (`0644` under the usual umask). The new file now has
  the bits of the one it replaces, from before its first byte is written.
  `oats schedule|trigger enable|disable` keeps them too, as it did when it
  wrote in place.
