## Changed

- **A stop whose claim cannot be written reads it instead, and stops (#946).**
  Since 0.52.0 a stop holds the home's claim, so a stop whose claim could
  not be written was refused before it signalled anything
  (`E_LIFECYCLE_FAILED`). A full disk is the likely case, and one of the
  reasons a person presses Stop. Now `oats instance stop --apply`, and it
  alone, reads the claim where it cannot write it, and goes on when nobody
  holds it.
  - **When:** the write fails with `ENOSPC` (the file system is full),
    `EDQUOT` (the quota is spent), `EROFS` (it is read-only), or `EACCES` or
    `EPERM` (the claims directory is not writable by this user). What stops
    this stop from writing there stops a retire or another stop of the same
    user as well. Any other failure is refused as before.
  - **Beside a holder nothing changes:** a retire or a stop that holds the
    claim, a holder whose liveness cannot be read, and a file that is no
    readable claim are answered with the same code, sentence and `details`
    as for a stop that can write, and nothing is signalled. The claim is
    read once more just before the first signal.
  - **It says so.** One line per such target on stderr, in text and in JSON
    mode: `oats: warning: <instance>: stopping without its claim: <lock>
    could not be written (<CODE>), and nobody holds it. A retire or a stop
    of <instance> that starts while this one runs will not see it.` The
    receipt has no new field. Through `--server` the warning does not reach
    the caller, as no warning of a stop does (#952).
  - **The limits.** Nothing on the home shows such a stop, so a retire or a
    stop that starts while it runs and that can write its claim is not
    refused: space freed a moment later, or a process of another user. If
    the warning says `EACCES` or `EPERM`, fix the permissions of the claims
    directory (`<instances>/.oats-retirement/claims`); do not live with the
    warning.
  - **On a full disk** the stop cannot write its own record and receipt
    either. The session is stopped, and that target's row is `ok: false`,
    `E_SESSION_STOP_FAILED`, `… its harness was signalled (SIGTERM) and has
    exited`, `stillRunning: []`: read `stillRunning`. The receipt is not
    stored, so the same key is not replayed: the same apply again answers
    `E_PLAN_STALE`, and with the fresh revision `alreadyIdle`.
  - A retire, and a retire's stop of a recorded child, need their claim as
    before.
  - A claim that could not be written leaves no private file
    (`<lock>.tmp-<pid>-<nonce>`) behind when its write fails after the file
    was created, as on a full disk.

  [A stop whose claim cannot be written reads it instead](../desktop-cli-api.md#stop-claim-write).
