# Moving heads, holds and merges

1. Identify the repository, the PR, the base ref and the head ref. Observe the remote SHA;
   `git ls-remote` doesn't refresh a local tracking ref.
2. Fetch the head ref and compare the fetched commit with what you observed. If they
   differ, report the movement and wait for the owner's next hand-over. Inspect explicit
   SHAs with `git show <sha>:<path>` and `git diff <base-sha>...<head-sha> -- <paths>`.
3. After a force push, don't assume the old head is an ancestor: check
   `git merge-base --is-ancestor <old-sha> <head-sha>` and report the result. A grep that
   finds nothing doesn't prove behaviour.
4. Honour the scope a HOLD actually names; if it's unclear, stop changing anything and ask.
   GO lifts only the scope it names. Report what is pushed, unpushed and uncommitted
   without undoing it.
5. A fix handoff names the new head, the full delta from the reviewed head, the tests run
   and what remains. Never approve an unpinned, moving tip.
6. Before merging, compare the PR head, the remote branch and the head the checks ran on,
   then follow the skill's Merge section.

Handoff template:

```text
Repository / PR:
Base / head SHA:
Prior reviewed SHA / ancestry:
Scope and delta since the prior review:
Tests run:
Findings:
HOLD/GO scope / next action:
Verdict at SHA:
Second reader's verdict at SHA (a hand-over to the release lane):
```
