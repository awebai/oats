# The maintainer's state file

One file, rewritten on every intake, in this order. Keep it where your working state lives
(your instance home, or wherever your soul says), not in the repository. Empty sections
stay, with "none", so a reader can tell "nothing" from "not checked".

```markdown
# Maintainer state: <repositories> (swept <date and time>)

## Waiting on me
| What | From | Since | Reference | Next action |
|---|---|---|---|---|

## Efforts in flight
| Effort | Lead expert | Asked by | Launched by (me / directly) | Since | Waiting for |
|---|---|---|---|---|---|

## Open PRs
| PR | Owner | Head | CI | Review (me / peer) | Hold: reason, scope | Next |
|---|---|---|---|---|---|---|

## Waiting on others
| What | Who | Since | Reference | Last chased |
|---|---|---|---|---|

## Release in flight
Version, PRs in (with the reason for each one left out), merge order, release-prep PR,
gates run and still to run, what users must do.

## Decisions pending
| Question | Who decides | Asked | Recommendation |
|---|---|---|---|

## Follow-ups
The honest list from /keep-it-clean: what, why, where it's tracked, owner.

## Since the last sweep
Merged (with SHAs), released, retired, decided, recorded in knowledge.
```

Rules:
- Exact references only: `repo#PR @ <sha>`, message ids, issue numbers, tags. Never "the
  latest".
- A hold names its scope (which PR, which action) and who can lift it. GO lifts only the
  scope it names.
- What you merged or released appears once under "Since the last sweep", with the
  observed result (merge commit, CI on it, the published version), not the intent.
