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
  - **Re-review each parked PR** once the pin moves: remove its
    `okf-needs-human` label, then close and reopen it, so the
    `harvest-review` trigger spawns a maintainer under the new rule. A label
    left in place is inert, but the PR is not reviewed again until it is
    reopened.
  - [Knowledge operations: the flow](../knowledge.md#the-flow), step 4,
    says what holds before and after 5.7.0.
