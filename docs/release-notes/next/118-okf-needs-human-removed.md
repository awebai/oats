## Provider updates

- **oats.okf 5.7.0: the knowledge maintainer never parks a harvest PR**
  ([awebai/oats-okf#118](https://github.com/awebai/oats-okf/issues/118)).
  When a deployment pins oats.okf 5.7.0, a PR that would supersede a
  human-accepted decision is settled at review instead of waiting for a
  human under the `okf-needs-human` label. The OATS floor is unchanged.
  - It is closed when it cites no acceptance (who accepted the change, when
    and where).
  - A cited record on GitHub (an issue or PR comment, or a commit) is
    checked: it must exist at the cited link, under the account the citation
    names, and say the cited thing. Confirmed, the PR merges as an explicit
    supersession with the acceptance recorded as verified at its link, which
    shows the account and the record, not that the human typed it: agents
    may post under their human's account. Otherwise it is closed.
  - A cited record the maintainer cannot read (mail, a session, a call), or a
    record that presents itself as a relay (an agent reporting the human's
    words), is trusted without a check: the PR merges as an explicit
    supersession with the acceptance recorded as source-reported (a relay
    with its link).
  - `oats okf-maintenance review-context` no longer reports `blocked`, and
    `settled` now means only that the PR is not open.
  - **Re-review each parked PR.** A label left in place is inert, but the
    PR is reviewed again only on a new `harvest-review` event. The trigger
    polls: a close it never saw is no reopen. On the trigger's review host,
    once its lock has 5.7.0:
    1. Retire the knowledge-maintainer instances left from older reviews,
       running or stopped: a retained home holds a concurrency slot (`max`
       2, `perKey` 1), and one composed from an older package keeps the old
       behaviour.
    2. Remove `okf-needs-human` from each parked PR, then close it.
    3. Wait until `oats trigger status <id>` shows a poll that completed
       after the closes (every 2m). `oats trigger test` does not count: it
       records nothing.
    4. Reopen each PR, and check that `oats trigger status <id>` lists a
       `reopened` event for each, pending or fired. At most two reviews run
       at once; the rest wait as `held` until a maintainer retires.

    Never clear the trigger's dedup state.
  - [Knowledge operations: the flow](../knowledge.md#the-flow), step 4,
    says what holds before and after 5.7.0.
