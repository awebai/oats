# Full operating-team migration

Planning record, 2026-09-05. Juan asked lead to discuss the migration with
Merlin and plan for all teams on this machine to be managed by OATS, with
harvesting fully working. This expands the earlier release/configuration
rollout. It does not describe an already completed migration.

The cjr runbook is owned by Merlin at
`~/cjr/agents/docs/2026-09-05-oats-migration.md`. This document records the
shared framework work and the wider rollout.

Fresh identities are authorized for specialists and reviewers. Merlin retains
both `cjr.aweb.ai/merlin` and his existing durable DID. Aweb clarified that
re-minting the same address changes identity and breaks continuity; the supported
path is an explicit transfer of his existing authority with one live process.
Other teams' retained identities follow the same requirement where applicable.

An isolated check against installed 0.22.1 confirmed that an explicit
existing spawn destination is refused without changing its instructions or
uncommitted notes. Purpose-based naming chooses an unused suffix. The old
cjr respawn-clobber report therefore is not reproduced by this journey;
identity adoption and concurrent handover still need their own tests.

## Completion means operating teams

Every continuing seat must have a supported OATS launch, composition,
status, handover and retirement path. Its outstanding work, knowledge and
required skills must survive a change of runtime session; identity/address
continuity follows the explicit policy for that seat.
Every remembering role must have a tested learning path; reviewers retain
their explicit exclusion from accumulated memory. Config discovery alone
establishes none of this.

The published 0.22.1 release supports useful Pi/Claude worker work and
notes-based harvest. Its observed qualifications included operator-assisted
retirement. Standing-agent adoption, automatic service retirement and
record-fed learning remain work, not shipped guarantees.

## Scope inventory

Reconfirm the live inventory with each owner at handover; process presence
and old directories are evidence to investigate, not the authoritative list
of continuing seats.

| Scope | Starting point | Required disposition |
| --- | --- | --- |
| `~/awebai/oats` | Live Claude coordinator and Codex lead; managed review workers also running | Oats owns coordinator handover; lead owns lead handover; preserve established identities |
| `~/cjr` | Knowledge/config preparation landed at `5afb3e8b`; managed developer pilot running; legacy Merlin and Minerva observed live | Merlin owns pilot and safe handovers; preserve his DID and address; harvest acceptance remains pending |
| `~/awebai/aweb` | Live Claude coordinator and frontend in legacy homes | Oats owns coordinator handover; lead coordinates frontend with aweb after its current work; preserve identities and cover child repositories |
| `~/tsm` | Five live seats: Zeus, Prometeo, Argos, Themis on Claude; Hermes on Codex. No OATS config/souls found | Lead coordinates with Zeus; cross-team handoff currently rejected by local identity routing; establish a supported route, then prepare souls/knowledge and safe handovers |
| `~/prj/beadhub-all` | Live Codex session, despite stale offline roster | Lead sent handover request to Beadhub; preserve its established identity and current work; no billing/production changes |
| `~/prj/docflow` | Live Claude session; credential workspace alias `alice` on `docflow:juan.aweb.ai` | Lead and Merlin establish responsible owner and handover; that alias is not proof of a globally routable address |
| `ai.aweb` on `aweb-agents` | Athena last seen 53 days ago; remote legacy home exists in inventory | Aweb and oats own archival inspection; do not resurrect as a continuing seat |
| `~/awebai/demo-aweb/bob` | Live Pi demo | Aweb owns safe stop and archival disposition; it is not an operating-team migration |
| `~/.turn-record` | Live Pi capture service under launchd | Retain as infrastructure; qualify record capture separately from standing seats |

The live inventory above was checked on 2026-09-05 using harness process
working directories, without interrupting them. Old aweb presence timestamps
are insufficient to decide whether a harness is alive. A migration plan or
new soul directory does not establish that the corresponding seat moved.

Grace's missing old local path and the offline retirement, docs, bertha,
cowork, federation, membership-review, aazb-reviewer, id-bugs, billing and
claweb entries are archival investigations, not launch requests. Preserve
homes until their work and authority have a recorded disposition. Do not
bulk-delete aliases based on roster age; certificate cleanup belongs to the
aweb lifecycle fix and its verified recovery procedure.

## Shared prerequisites and owners

Oats coordinates framework/package work and the machine-wide inventory.
Lead independently reviews the design and concrete journey evidence. Merlin
owns cjr's repository changes, task selection and eventual handovers. Other
teams' owners control their work and handover sequence; oats records those
owners before scheduling each migration. Oats accepted ownership of
`aweb-abep` (service self-retirement), followed by `aweb-abfz` (record-fed
learning). Self-retirement merged at 568eeae; record-fed learning is implemented
and under independent review, with package publication pending. Lead owns
the full-machine plan and runtime/wake qualification, including the Codex
support requirement. The aweb coordinator owns identity continuity and route
semantics, with oats coordinating the rehearsal and package changes.

### Recreate or retain identities according to the actual requirement

Cjr's default is a new OATS-minted identity and an explicit handover of
outstanding work, knowledge, contacts and task responsibility. Old identities
are retired only after that handover is accepted. Pilot identities remain
uniquely named so no existing address has to be removed for the experiment.

Merlin is the exception. Oats owns the explicit source-authority binding in the
messaging capability; aweb supplied this supported handover:

1. Rehearse using a disposable self-custodial global identity and a second-team
   contact, checking DID, address, conversations and write attribution.
2. Stop the old process. Copy authority only: signing.key, identity.yaml,
   teams.yaml, team certificates, encryption.yaml and encryption keys. Keep
   private files owner-only; exclude workspace.yaml and caches.
3. In the new home run `aw workspace connect --service <url> --team <team>` to
   rebind the existing identity. Do not mint or join as a new identity.
4. Verify the same DID/address, host/path binding, heartbeat, message routes and
   task writes. Preserve the old home for rollback until acceptance, then remove
   its old credential copy. Never have two processes using the identity.

Do not delete Merlin's global workspace as part of handover: aweb reports that
this is unsupported and can release claims. Retiring a managed execution with
retained authority must release the execution without destroying the identity.
Never put credentials in Git or manufacture instance.json for adoption.

### Make harvest finish without an operator

Kernel issue `aweb-abep` is real in 0.22.1: bare `retire --self` is refused,
while the harvester's instructions tell it to use that command. Oats owns
the supported service-exit path, with lead review. A deferred external
retirement is a candidate; the live agent must not inspect and delete its
own working state. Completion requires an actual harvester to finish,
report and clean up without operator retirement, with visible recoverable
failure rather than silent loss. Do not release capabilities while the
runtime can still act, or make the read-only status command delete homes.

Review cjr's local `memory-harvest` override before the pilot: selected
implementation, required skill, authenticated model, source worktree,
promotion destination and self-harvest exclusion. The configured model is
OpenAI via `openai-codex/gpt-5.5`, already used by the local record/mind setup.
Pi is needed even for Claude workers. A model setting is not proof of a run.

### Finish temporary identity retirement

The aweb owner must resolve the remote lifecycle defect tracked under
`aweb-aaum.6`; oats coordinates package integration. The five leaked release
identities are a reproduction. Independently verify coordination cleanup,
claims and certificate state. Admin cleanup is a recovery procedure, not
proof of automatic retirement. This gates temporary-worker completion;
adopted standing executions instead must preserve their durable identity.

### Recover standing executions after reboot

Tmux and Herdr keep agents alive when a viewer disconnects; a machine reboot
ends those executions. Replaying `instance.json.command` manually does not
refresh OATS's independent session receipt and is not a supported recovery.
The first planned recovery reuses the tested retained-authority handover:
preserve the stopped home, knowledge and identity, then create its replacement
with a new receipt and one active holder. That capability binding is not built
yet; until qualified, rebooted standing seats remain down. A terminal-only
restart operation may follow; it must refresh the receipt without rerunning
resource-provisioning hooks. No automatic supervisor is required for the first
supported manual recovery.

### Include noncoding learning and all actual runtimes

`aweb-abfz` is the open record-fed learning epic. Its bounded acceptance is
a standing session that wrote no notes and made no code commit producing a
reviewed knowledge proposal with provenance to exact recorded turns, then a
successor reading that knowledge. Notes-based harvest must continue working.
Oats owns this after service self-retirement: select the source instance's
own recorded turns through a record helper, feed them to existing OKF
judgment, and deliver proposals through the same review path. Verify exact
source provenance, correct soul destination and safe repeat processing.
Storing transcripts or running the mind daemon alone does not satisfy this
gate.

The inventory includes Codex sessions. Main now includes reviewed native Codex launch (b7d4159), alongside Pi
and Claude; released Codex launch/status/stop/composition support is required
unless a seat's owner explicitly chooses a runtime change. No silent fallback
to Pi. Test channel delivery with the installed runtime and selected config;
manual polling is not wake-up. Establish any actual machine-policy change
needed before making it. Include daemon health and restart/recovery behavior
in the operating instructions.

## Rollout sequence

1. **Prepare without disturbing sessions.** Record each seat's identity,
   home, work path/branch, outstanding tasks/messages, notes, skills and
   launch mechanism. Review/commit the isolated config changes. Give every
   knowledge store a disposition, preserving source material; migrate needed
   context into indexed soul knowledge and team rules. Materialize required
   skills explicitly instead of depending on a user's Claude skill links.
2. **Rehearse required identity transitions on test identities.** Prove
   temporary retirement and Merlin-style retained-authority handover, including
   cross-team routing. If another team requires retained-key adoption, test
   its write binding, exclusivity, failure recovery and retained-identity
   retirement separately. Do not use the active Codex lead or a standing
   coordinator as the initial experiment.
3. **Run cjr's useful worker pilot.** Merlin selected extending
   `kb/tools/kb-jobs-check.py` to cover the machine's launchd jobs. Limit the
   task to health reporting; do not enable/disable jobs. Use a fresh named
   developer in a worktree and a fresh code reviewer. Verify required skills,
   aw communication, a reviewed task commit, a real harvested promotion on
   the correct branch, and a second developer reading the promoted lesson
   through the soul's index. Verify harvester and worker retirement. A
   workaround-assisted run is recorded as partial, not automatic completion.
4. **Transfer cjr seats at agreed safe boundaries.** Prove the never-run
   roles with new managed workers. Then hand Hermione's and Dumbledore's work
   to fresh identities, followed by Minerva's work; Merlin goes last using the
   verified address-continuity procedure. Checkpoint work/mail/notes and
   explicitly transfer responsibilities. Avoid duplicate owners of the same
   task. Preserve old homes until successor acceptance; retire old identities
   through the supported remote path. Every remembering role gets the learning
   check; reviewers get the exclusion check.
5. **Repeat across the inventory.** Prepare other scopes in parallel with
   framework work; apply the proven handover with each team owner. Oats/aweb,
   tsm, beadhub and docflow all need explicit outcomes. Offline homes receive
   an explicit disposition. Retire old launch scripts only after no continuing
   seat depends on them.
6. **Qualify continuous operation.** Prove record-fed promotion for noncoding
   sessions, successor knowledge use, wake-up and recovery, and working health
   checks. Document one supported operator path to start, inspect, hand over,
   harvest and retire each role. Close the full migration only then.

## Evidence and progress

Keep separate milestones per team: config ready; skills/knowledge ready;
new workers qualified; standing seats transferred; learning qualified;
retirement/recovery verified. Record exact published versions and relevant
commits. Preserve failed-step evidence and outstanding limitations; do not
substitute a green `doctor`, a roster row or a successful hook report for
the corresponding live check. Keep credentials and private case data out of
the shared rollout record.
