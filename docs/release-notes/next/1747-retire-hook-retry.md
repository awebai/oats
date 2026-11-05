## Upgrade

- **A home left half-retired now makes `oats doctor` report a
  `retire-incomplete` problem** (oats-project/oats#1747). That covers a
  quarantined home, and a self-retire that failed or was interrupted. Each
  problem names the command that finishes the retirement and the capability
  whose retire hook failed last. Doctor's exit status does not change: it
  exits 0 with problems, as before. A deployment with no open retirement sees
  no change.

## Changed

- **A self-retire retries a cleanup that retire hooks alone left incomplete**
  (oats-project/oats#1747). When the completion of `oats retire --self` ends
  with the home quarantined, owing retire hooks and nothing else, it runs the
  retire again up to three times: about 1, 5 and 15 minutes after each
  failed attempt.
  - A retry whose hooks pass removes the home and leaves nothing behind.
  - After the last failed attempt the outcome is as before, plus `attempts`.
    The marker, the quarantine and the one `retire-refused` event stay.
  - Every attempt records its own `retired` event with its hooks.
  - A quarantine that also owes Git steps, directory preservation or an
    orphaned work directory is not retried.
  - While the completion waits, `oats status` reads the retire as `running`.
    Another retire of the home is refused with `E_LIFECYCLE_BUSY`, for up to
    about 21 minutes after a hook failure. The refusal names the next attempt
    and the earliest time the last one starts.
  - Plain retires are unchanged
  ([Self-retire](../souls-and-instances.md#self-retire-hook-retry)).

## Added

- **`oats doctor` and `oats doctor --json` list each retirement left open**
  as a `retire-incomplete` problem in `problems[]`, `{code, message,
  remedy}` (oats-project/oats#1747). The remedy is `oats retire <name> --home
  <home>`, shell-quoted, and names the capability whose retire hook failed
  last. A retire that is running, or whose state cannot be read, is not
  listed. Neither is a spawn in progress, or an outcome whose home is gone,
  which `oats status` still lists
  ([doctor `problems[]`](../desktop-cli-api.md)).
