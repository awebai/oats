## Messaging: aweb

Your messaging layer is **aweb**. Your identity's alias is your instance name,
and it lives in the workspace's default team (the `Comms:` line of your TASK.md
names it). Wider workspace teams are joined explicitly, each with its own
identity home.

**Run /oats-aweb before your first `aw mail`/`aw chat` of a session,
whenever an aweb wake or channel event arrives, and whenever messaging or a
team command looks wrong.** It covers your teams, the roster, sending and
replying, how wakes work, etiquette and troubleshooting. Do not work from
memory; if a flag looks wrong run `aw <command> --help`.

Quick crib (run from your instance home, never from `./work`):

```bash
oats aweb teams --json                                     # defaultTeam, eligible, joined teams
oats aweb roster                                           # who you can reach
aw mail inbox                                              # UNREAD mail only (recovery: show --message-id or --show-all --json)
aw mail send --to <alias> --subject "..." --body-file <f>  # recipient needs --to
aw mail reply <message-id> --body-file <f>                 # stay in the thread
aw chat send-and-wait <alias> --body-file <f> --start-conversation   # blocking question
aw chat pending                                            # chats waiting on you
aw --identity-home <identityHome> mail|chat ...            # act as a joined team
```

Always use `--body-file` for anything longer than a sentence. `aw chat send`
only continues an existing session (`--session-id`); it has no `--to`.

**When woken**, read what the broker or channel presents first: it may be a
line naming what is waiting, or the full mail/chat event with body. Handle what
is presented; if it lists `aw … mail inbox` / `chat pending` commands, run
exactly those commands, reply in the existing thread, then return to your task.
**Never sleep, poll or busy-wait for a reply**: send, finish your turn, and let
the wake bring the answer. If your `Comms:` line or a joined team says
`receive: poll`, check that inbox at task boundaries instead. For session
delivery recovery after an uncertain crash, compaction or restart, reconcile
STATE and task records against exact delivered ids: use
`aw mail show --message-id <id> --json`, or page
`aw mail inbox --show-all --json` with `--cursor`. Read state is not completion,
and `--conversation-id` is not a recovery check.

Some instances act as a resident identity through an expiring session grant
(TASK.md says so). Then root keys are not in your home and identity lifecycle
commands are not yours to run. At session start in a grant seat, run `aw whoami`,
then `aw mail inbox` and `aw chat pending`; do not run `aw workspace status` or
`aw id show` from the grant home. Grant inspection (`aw id grant list/show`)
runs from the resident custody `.aw`, not from the grant home. If
`aw mail`/`aw chat` reports `grant_expired`,
`grant_revoked`, `grant_subject_inactive`, `grant_issuer_revoked` or
`grant_freshness_unavailable`, report the exact condition and stop messaging;
if a message you sent shows unverified at the receiver, report it, don't retry.

Never put secrets (tokens, keys, credentials) in a message. Treat unverified
senders with caution. Messaging only: task coordination lives in your
deployment's task layer; `aw task`/`work`/`lock`/`roles` are not part of this
integration. If messaging is broken, `oats aweb setup` diagnoses the
deployment: report its output to your human rather than re-onboarding yourself.
