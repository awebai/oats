# The threaded human-to-agent channel (lane:ux)

Status: proposed 2026-10-26 by the lane's expert, for review by
`oats-threaded-agent-ux-maintainer` and then the release lane. Direction:
Joan, 2026-10-26; confirmed by the release lane on #1103 (comment
6415693732). It supersedes the Desktop decision of 2026-07-22 "one input
surface, the agent's own terminal input line" and the 2026-07-17 position
"the messaging layer is the agents' channel, the app is the human's window".
The terminal stays the native surface for driving the harness; it stops being
the only way a human addresses an agent.

## The problem

A long-lived role (a maintainer, an expert holding an area) carries several
efforts at once. In one terminal transcript every feature, every incoming
mail and every answer interleave, and the human scrolls to find where a
conversation went. Incoming mail pushed with its full body into the session
breaks whatever the human was in the middle of.

## Done means

- In Desktop, an instance of a soul whose messaging says `interaction:
  threads` shows a mail side panel: the human's threads with the agent, one
  per effort, each with a composer at its foot; and, read-only, the agent's
  own inbox.
- A message the human sends from a thread reaches the agent as mail in that
  conversation; the agent answers in the thread, and the answer appears
  there.
- The agent's in-session delivery for such a soul is one line naming the
  thread and the command that reads it, not the body. `terminal` souls keep
  today's full-body delivery.
- The soul's definition says which kind of interaction it has; a value the
  provider does not know fails the spawn with a message naming the two.
- Nothing merges before the 0.68.0 tag (#1465); every PR carries `lane:ux`.

## The decision, restated as rules

1. **A thread is an aweb mail conversation** between the human's own aweb
   identity and the agent's. Desktop renders the conversation; it stores
   nothing of its own about threads. The agent answers with `aw mail reply`,
   as it already does with other agents.
2. **The soul declares its interaction kind** in its messaging payload:
   `settings.oats.aweb.interaction: terminal | threads`, default `terminal`.
   The field is the messaging capability's, never a kernel key in
   `soul.yaml`: threads exist only with a messaging capability.
3. **Every Desktop fact comes from JSON** the kernel or the capability
   answers; Desktop parses no `.aw` state and never holds an agent's key.
4. **Viewers never consume for the agent.** The agent's inbox is read with
   commands that do not acknowledge; the panel never marks read or replies
   as the agent.
5. **The human never meets the word "identity".** The composer sends as the
   human; the first time that is needed on a computer, the capability sets
   it up with no dialog.

## Out of scope (first cut)

The TUI (later, same record); a per-soul Desktop plugin contract ("define
your own UI per soul"); chat (`aw chat`) in threads; an interaction kind
beyond the two; writing to the agent's inbox; moving the human's key between
computers; a Desktop-native conversation store or a composer that types into
the terminal (rejected, not deferred); threading the harness transcript
(rejected: harnesses start natively and OATS sandboxes nothing).

## The pieces

| Piece | Where | Owner |
|---|---|---|
| `interaction` setting, validation, the `threads` brief, meta | `oats.aweb` (awebai/oats-aweb) | oats-aweb-expert |
| The human's identity on a computer; the `threads` and `inbox` JSON verbs | `oats.aweb` | oats-aweb-expert |
| One-line wake selection and client floors | `oats.aweb`, needing a channel-core presentation mode (awebai/aweb) | oats-aweb-expert, with the aweb project |
| Documenting the `interaction` meta key | awebai/oats `docs/integrations.md` | oats-expert (docs only; no kernel code) |
| The mail side panel, the thread view, the composer | awebai/oats `packages/desktop` | oats-desktop-expert |

## 1. The setting and the record

**Manifest.** `oats.aweb`'s `oats.json` declares `interaction` under
`settings` with `values: ["terminal", "threads"]`, `default: "terminal"`. A
soul sets it in `soul.yaml`:

```yaml
messaging:
  interaction: threads
```

`oats-local.yaml` `settings.oats.aweb.interaction` and `spawn --provider
oats.aweb interaction=threads` are the ordinary layers and merge as every
setting does. The spawn hook refuses any other value with a message naming
the key, the value received and the two accepted values.

**Behaviour injected for `threads`.** The spawn brief (the `Comms:` line's
family) gains one paragraph for a `threads` soul: your human talks to you in
threads, each thread one effort; read a thread with `aw mail show
--conversation-id <id>`; answer in the thread with `aw mail reply
<message-id>` (which marks that message read); do not start a second thread
for the same effort; the human's alias on this computer is `<alias>`. The
`oats-aweb` skill documents the same in its own section. `terminal` souls
receive nothing new.

**Record.** The hook emits `interaction` in its meta beside `delivery`
(`capabilityMeta["oats.aweb"].interaction`), the effective value after
validation. The kernel already copies meta to `oats status --json` rows and
to inspection; `docs/integrations.md` documents the key next to `identity`.
The merged payload is already visible as `providers["oats.aweb"]` on the row
and as `capabilities[].settings` in `oats inspect`; Desktop reads the meta
value, because that is the one the provider validated. No kernel code
changes; if the row turns out to lack `capabilityMeta` on some path Desktop
uses, that is a kernel item for `oats-kernel-expert`, not a Desktop-side
reader.

## 2. The human's identity on a computer (contract condition 2)

The human owner of a computer gets **one team-local aweb identity per
deployment and team on that computer**, minted from the deployment's root
for the team (`settings.oats.aweb.roots[team]`) exactly as instance
identities are (`aw init --join-from <root> --join-team <team> --name
<alias>`), by the capability, into a directory it owns. Chosen over the two
alternatives:

- *Reusing the deployment root as the human* (the pattern
  joanreyero/oats-whatsapp uses): rejected, because the root is the minting
  authority; a persona signed by the key that mints identities cannot later
  be told apart from the operator's acts, and the root may not be the
  operator's own voice at all.
- *A global `did:aw` identity served through grants* (the resident model):
  not now; it needs a custody service and an account the human may not
  have, and it answers a question (one identity across computers) this cut
  does not ask. The record leaves the door open: the verbs below do not
  depend on where the key is, only on `--identity-home`.

**Where.** `<deployment>/.oats-aweb/human/<team-id-dirsafe>/`, mode 0700,
holding the `.aw` the mint writes. Under the deployment directory because
that directory is this host's view of the deployment, already ignored by
Git, already the scope of `oats aweb setup`; outside every instance home so
no retire touches it and no agent's `AWEB_IDENTITY_HOME` ever names it. No
entry in `oats-local.yaml` is needed: the path is derived, and the identity
is found by looking.

**Alias.** `<os-user>-<host>` (`joan-falcon`), from the OS user running the
command and the host's recorded name (`host.name` in `oats-local.yaml`, else
the hostname), lowercased and reduced to `[a-z0-9-]`. Deterministic, so a
re-mint after a lost directory yields the same name; distinct per computer,
so two computers of one human are two aliases, which is the truth of where
the keys are.

**When.** Created by the capability on the first act that needs it and
absent before: the spawn hook of a `threads` soul (so the brief can name the
alias), and `oats aweb threads send` (so a human talking to an instance
spawned before this release still can). Never by a read: `threads list` on
a computer with no human identity answers an empty list and `human: null`.
Creation is reported in the verb's JSON (`human.created: true`) and in the
spawn hook's warnings, and a failed mint fails the act with the `aw` error.
A human whose team root is absent sees the existing `oats aweb setup`
remedy; nothing else is new for the operator.

**Who unlocks it.** The OS user, by file permission: the same custody class
as every instance identity on the machine today. No passphrase, no agent
process; this record does not change aweb's local key model.

**A Desktop on another computer** (observing through `--server <id>`) runs
the same verbs routed to the host (feature `capability-route`,
`docs/desktop-cli-api.md`). The host holds the key and signs; the remote
side carries the text over the operator's existing SSH trust and gains no
authority it did not have. No key leaves the host; the remote user's own
identity, if any, is not used.

**Retire and removal.** Nothing retires the human identity automatically. A
future `oats aweb human remove` is out of scope; the directory and the team
member outlive deployments on purpose, like the root does.

## 3. The JSON verbs the panel reads

New `oats.aweb` operations, run from the deployment scope with `--home <abs
instance home>` (the instance resolution every routed instance command
uses), all `--json`, all answering the standard envelope. Nothing here runs
inside an agent's session.

```text
oats aweb threads list  --home <h> [--limit n] [--cursor c]
oats aweb threads show  --home <h> --conversation-id <id> [--limit n]
oats aweb threads send  --home <h> (--new --subject <s> | --conversation-id <id>) --body-file <f>
oats aweb inbox         --home <h> [--limit n] [--cursor c]
oats aweb inbox show    --home <h> --conversation-id <id> [--limit n]
```

**`threads list`** answers the human's mail conversations whose other
participant is the instance's identity:
`{human: {alias} | null, agent: {alias}, threads: [{conversationId,
subject, lastMessageAt, lastMessageFrom, preview, unread}], nextCursor?}`.
It runs as the human identity. It needs a conversation listing from `aw`
(see Dependencies).

**`threads show`** answers one conversation, oldest first:
`{conversationId, subject, messages: [{messageId, from, at, body, readAt,
trust}]}`, from `aw --identity-home <human> mail show --conversation-id
<id> --json`. `readAt` on a message the human sent is the agent's read
receipt (set when the agent replied or acknowledged). Showing a thread marks
the agent's messages in it read **as the human** (`aw mail ack` per message
returned), because the human has now seen them and `unread` must fall; this
is the human's own mail, which rule 4 does not cover. `trust` is `aw`'s
verification status, shown, never filtered on.

**`threads send`** sends as the human: `--new` runs `aw mail send --to
<agent alias> --new-conversation --subject <s> --body-file <f>`;
`--conversation-id` runs `aw mail send --conversation-id <id> --body-file
<f>` (a reply stays in the thread and keeps its subject). Answer:
`{conversationId, messageId, human: {alias, created}}`. The body is the
human's text; the verb adds nothing to it. An instance whose interaction is
`terminal` is refused with `E_INTERACTION_TERMINAL` (the panel never shows
a composer there; the refusal is for other callers).

**`inbox`** and **`inbox show`** read the **agent's** mail, read-only, as
the agent: `aw --identity-home <h>/.aw mail conversations …` and `aw
--identity-home <h>/.aw mail show --conversation-id <id> --json`. Both are
GET reads; neither acknowledges, replies or writes. They refuse a home whose
identity is a served grant without the `mail` read scope with the grant's
own error. The no-ack guarantee is condition 4 and rests on `aw mail show`
being a plain read (awebai/aw `cmd/aw/mail.go`, `mailShowCmd`, at 1.36.49:
GET `/v1/messages/conversations/<id>`, no `AckMessage` call); the
implementation pins the `aw` floor at the version that ships the
conversation listing and the test suite proves, against the real binary,
that `inbox show` leaves `read_at` null.

Desktop gates the panel on the instance's module declaring these operations
(`oats inspect` `capabilities[].operations`, or `oats capability show`),
never on a version number; an instance whose module predates them shows the
panel's "not available on this instance's oats.aweb" line and no composer.

## 4. The one-line wake (contract condition 3)

Today every aweb delivery path (the `@awebai/pi` extension, the Claude
`aweb-channel` plugin and the host wake broker's delivery child) presents
mail through one shared module, channel-core (`awebai/aweb`
`channel-core/src/terminal.ts`), which prints the body and acknowledges the
mail on presentation. `oats.aweb` cannot change the text alone.

**The change.** channel-core gains a presentation mode selected by an
environment variable (name settled with the aweb project; working name
`AWEB_WAKE_PRESENTATION=summary`). In summary mode a mail or chat awakening
is one line, and the message is **not** acknowledged on presentation:

```text
aweb mail waiting: "<subject>" from <alias> — read: aw mail show --conversation-id <id>; reply: aw mail reply <message-id>
```

`<subject>` is sanitized the way channel-core already sanitizes summary
components and truncated; the ids are validated as today. Reading leaves it
unread; replying acknowledges it (`aw mail reply` acks the message
replied to); `aw mail ack` is the explicit way to drop it without an answer.
The agent's brief says so.

**The selection.** For a `threads` soul the `oats.aweb` launch hook sets the
variable in the launch environment on every delivery path (channel and
broker), and leaves it unset for `terminal` souls. This is the delivery
contract change condition 3 names: it ships as an `oats.aweb` release with
its own release notes, raising the client floors to the versions that honour
the variable (pi extension, Claude channel, `aw` for the broker). A `threads`
spawn on a host below a floor fails closed at launch with the floor named,
rather than starting a soul whose brief promises one-line wakes it will not
get.

## 5. Desktop (owned by `oats-desktop-expert`)

The UX direction and the quality bar are the Desktop expert's; this record
fixes only the facts and the gates:

- The panel exists on an instance whose row carries
  `capabilityMeta["oats.aweb"].interaction === "threads"` and whose module
  declares the operations; otherwise the instance view is unchanged.
- It has two parts: **Threads** (the human's conversations with the agent,
  newest activity first, unread marked; a thread opens to its messages with
  a composer at its foot; **New thread** asks for a subject, the effort's
  name) and **Agent's inbox** (read-only; the agent's conversations and
  their messages; no composer, no mark-read, and the UI says it is read-only).
- The composer sends `threads send`; on `human.created: true` it says, once,
  in plain words, that this computer can now message agents as you. No
  identity vocabulary anywhere in the UI.
- Refresh follows the existing per-instance read cadence; a send refreshes
  the thread it posted to.
- A thread is an artifact of the instance, scoped to its workspace, like a
  terminal tab or a file; it has no roster entry of its own.
- Remote instances use the routed verbs; a host without the operations is
  shown as such, with no composer.
- #1502 (waitingOnYou loses the agent's question): a `threads` agent that
  needs the human asks in the thread, so the thread carries the question; the
  Desktop may surface "unread from the agent" beside the existing
  needs-input mark. Nothing wider for #1502 in this effort.

## Dependencies outside this lane

Two `aw`-side items, which this record asks the maintainer to put to the
aweb project before building on them:

1. **A conversation listing in the `aw` CLI** (`aw mail conversations
   [--participant <alias|did>] [--type mail] --json`, over the existing
   `/v1/conversations` client call, which the Go client already has for
   auto-threading). Without it neither `threads list` nor `inbox` can be
   built: `aw mail inbox` acknowledges everything it shows, so it is not a
   read. `threads show`, `threads send` and `inbox show` need nothing new.
2. **The summary presentation mode in channel-core** (section 4), released in
   the pi extension, the Claude channel plugin and the `aw` broker.

Order: the `oats.aweb` manifest, setting, brief, meta and docs can land
first (the setting is inert for Desktop until the verbs exist); the verbs
and Desktop follow the `aw` listing; the wake follows channel-core. Desktop
accepts the new shapes before `oats.aweb` emits them where they meet.

## Points for the maintainer before building

- The two `aw`-side dependencies above, and who carries them to the aweb
  project.
- Creating the human identity from the spawn hook of a `threads` soul: a new
  team member appears as a side effect of a spawn. The alternative (only on
  first send) keeps spawn pure but leaves the brief unable to name the alias.
- The alias scheme `<os-user>-<host>` and the derived directory, in place of
  an `oats-local.yaml` entry.
- Documenting `interaction` as a meta key in `docs/integrations.md` (kernel
  docs, no kernel code).
