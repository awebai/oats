---
type: Playbook
title: Route independent reviews and land reviewed work that sits above unreviewed work
description: Spawned reviewers replace an offline default reviewer; their briefing protects the operator checkout; ACKed commits above an unreviewed one land by diff-identical cherry-pick.
timestamp: 2026-09-05
---

When the team's default reviewer workspace is offline, spawn a reviewer
instance from the cli-dev soul with main checked out in the operator
checkout (spawn creates the review branch from the current HEAD). The
briefing names the exact SHA and non-merge commit count, the focused tests
(never the full suite), the rule that every git command runs with
`git -C "$OATS_INSTANCE_HOME/work"` and the operator checkout is never
touched, and asks for the verdict as "reviewed <sha>, N non-merge commits,
ACK" or findings with file:line. Under the
legacy native-channel launch, a reviewer's first Claude launch shows a
development-channels prompt that needs Enter (tmux send-keys); with the
published aw wake and session delivery there is no channel flag and no such
prompt. Look at the pane before sending any key; never type Enter blindly
at a prompt you have not read.

Reviewers retire after the verdict, so they include any notes in the mail;
promote the ones that teach something into the reviewing soul's knowledge
on a knowledge-only branch with its own ACK. Every round needs a fresh
reviewer instance.

When ACKed commits sit above an unreviewed commit on a teammate's branch,
do not wait and do not rewrite their branch: cherry-pick the ACKed commits
onto main from a detached worktree in review order and prove each landed
diff equals the ACKed diff (`git show <orig> --format=` against
`git show <new> --format=`). After the teammate merges main, the
cherry-picked originals still appear in `git log origin/main..<branch>`
(they are distinct commits); their changes cancel in the three-dot diff,
which then shows only the unreviewed commit's content. Keep counting the
commits in that list and account for each one at the next landing rather
than assuming the ancestry holds only the unreviewed commit.
