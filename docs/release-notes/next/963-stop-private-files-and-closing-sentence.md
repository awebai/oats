## Fixed

- **A stop on a full disk leaves no private file in the home (#963).**
  `oats instance stop --apply` writes its record (`.oats-stop.json`) and the
  receipt of its key (`.oats-stop-receipt.<key>.json`) through a private file
  beside each, renamed into place. On a file system with no space the private
  file was created, its write failed, and nothing removed it: the home kept
  `.oats-stop.json.tmp-<pid>` and `.oats-stop-receipt.<key>.json.<pid>.tmp`,
  both empty, and one more of the second for each later apply. Both writers
  now remove their private file when the write or the rename fails. The error
  is the one they gave before, and so is the receipt: its row for such a stop
  is unchanged. An upgrade does not remove the files an earlier version left
  in a home.

  The record's writer is shared: an `instance.json` or a restart record that
  cannot be written leaves no `<name>.tmp-<pid>` beside it either.
- **The text of a stop no longer says that something is still running when
  nothing is (#963).** A stop that is not `ok` closed its text with `some
  targets are still running; nothing was escalated`, also under a row that
  said `its harness was signalled (SIGTERM) and has exited`: a stop on a full
  disk, which stops the session and cannot write its record. The closing
  sentence is now chosen from the rows'
  [`stillRunning`](../desktop-cli-api.md#still-running), as a client reads
  them. It is the sentence above when a row that is not `ok` names a process
  or establishes nothing (`null`, or no `stillRunning`), and `the stop did
  not complete its record; nothing is still running` when every such row
  says `[]`. The exit status is 1 in both cases, as before, and the JSON
  receipt is unchanged.

  See [a stop whose claim cannot be written](../desktop-cli-api.md#stop-claim-write).
