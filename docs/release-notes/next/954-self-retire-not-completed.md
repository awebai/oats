## Changed

- **A scheduled self-retire that does not complete says so, and no longer
  leaves the instance reading as retiring when nothing of its home was
  changed (#954).** `oats retire <instance> --self` only schedules: a
  detached completion runs the retire a few seconds later, with nobody at a
  terminal. A completion that was refused or that failed left its pending
  marker behind, so the instance read `RETIRING` in `oats status`, and `oats
  instance stop --apply` and `oats session start` answered
  `E_INSTANCE_RETIRING`, for a retire that was not happening.
  - **The marker follows how far the retire got.** It stays when a retire
    hook was started or the removal of the home began: the home is owed a
    retire, and `oats retire <instance>` continues. Otherwise the completion
    removes it, and the instance is a stopped or a running instance like
    any other: a start works, and a wake schedule may start it.
  - **The outcome stays, as before:** `.oats-retired-<instance>.json` and
    its log beside the home, listed by `oats status` (`retireFailures`)
    until a retire of the instance completes. Nothing retries by itself.
  - **A new event kind, `retire-refused`,** `data: {code, homeChanged,
    reason}`, written once by such a completion and by nothing else.
    `code` is a kernel code, or `null` for a cleanup that did not finish.
    `reason` is the sentence the retire answered, on one line and at most
    2048 UTF-16 code units. The row is in the workspace's log. A client
    that does not know the kind reads the row as any unknown kind.
  - **A scheduling that the host held up** for longer than its completion
    waited for it (3 s) made that completion give up: the self-retire did
    not happen, and the marker, written afterwards, stayed. A completion now
    waits for its own scheduling for up to ten minutes, then retires the
    instance. A `--self` whose completion has already ended when the
    marker is written (it was killed, or the ten minutes passed and its
    retire was refused) answers `E_SELF_RETIRE_SCHEDULE_FAILED`, removes
    the marker it wrote, and schedules nothing.
  - **A retire hook of a scheduled self-retire no longer inherits
    `OATS_RETIRE_INTENT`:** the variable is the completion's own input, and
    the completion takes it out of its environment before it runs anything.
  - **Homes already stuck by a completion refused under 0.52.0 or earlier**
    keep their marker. To retire such an instance after all, run `oats
    retire <instance>`. To keep it, no command does this: once the
    completion the marker names is gone (its pid is `completionPid` in the
    marker), remove by hand `.oats-retire-pending-<instance>.json`,
    `.oats-retired-<instance>.json` and `.oats-retired-<instance>.log`
    beside the home. The kernel does not do this for a home whose refusal
    it cannot date.

  [A completion that does not complete](../souls-and-instances.md#self-retire-not-completed),
  [the `retire-refused` event](../desktop-cli-api.md#retire-refused-event).
