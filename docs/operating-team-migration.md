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
Every remembering role must have a tested learning path. Preserve each role's
explicit policy: Cjr reviewers exclude accumulated memory; Themis uses
reviewed learning. Config discovery alone establishes none of this.

The installed baseline is published OATS 0.22.3 on this Mac and `aweb-agents`,
including native Pi/Claude/Codex, tmux/Herdr, shared `yolo`, remote Desktop
roster/actions, retained-authority binding and corrected deferred retirement.
The downloaded Mac Desktop app passed codesign, packaged renderer and PTY
launch checks. Official oats.okf 1.5.0 provides record-fed harvesting; each
deployment must select its authenticated provider. Version 1.5.1, adding
harvest-runtime selection and detection of unadvanced record plans, remains
under independent review and is not yet published.

No standing seat has transferred yet. Cjr's worker pilot has landed reviewed
code and knowledge; ordinary retirement passed using the next-patch candidate.
A real harvester's automatic deferred completion and successor knowledge use
remain explicit acceptance checks. The reviewed aweb broker candidate passed
real harness delivery; installation of its published release as the normal
host service remains a prerequisite for standing cutover.

## Scope inventory

Reconfirm the live inventory with each owner at handover; process presence
and old directories are evidence to investigate, not the authoritative list
of continuing seats.

| Scope | Starting point | Required disposition |
| --- | --- | --- |
| `~/awebai/oats` | Live Claude coordinator and Codex lead; managed review workers also running | Oats owns coordinator handover; lead owns lead handover; preserve established identities |
| `~/cjr` | Preparation `5afb3e8b`; developer pilot landed on master `062e2c75`; legacy Merlin and Minerva live | Merlin owns safe handovers; preserve his DID/address; prove automatic harvest completion and successor use |
| `~/awebai/aweb` | Live Claude coordinator and frontend in legacy homes | Oats owns coordinator handover; lead coordinates frontend with aweb after its current work; preserve identities and cover child repositories |
| `~/tsm` | Five live seats: Zeus, Prometeo, Argos, Themis on Claude; Hermes on Codex. First-seat Themis config/soul packet under owner review | Zeus prepared the five-seat handover plan; begin with Themis at a safe boundary, Zeus last; preserve session-local schedules and production authority |
| `~/prj/beadhub-all` | Live Codex session, despite stale offline roster | Beadhub accepted preparation and is at a safe boundary; retain its global identity, native Codex and separate canonical code roots under `~/awebai/beadhub`; billing remains separately gated |
| `~/prj/docflow` | Live Claude seat identified itself as local `juan.aweb.ai/alice` on `docflow:juan.aweb.ai` | Owner Juan; finish running mail backfill and register checks before transfer; retain identity, memory and Minerva route; accountant-sync remains deliberately unloaded |
| `ai.aweb` on `aweb-agents` | Aweb confirms Athena intentionally inactive; remote legacy home retained | Aweb and oats own archival inspection; do not resurrect as a continuing seat |
| `~/awebai/demo-aweb/bob` | Live Pi demo | Aweb owns safe stop and archival disposition; it is not an operating-team migration |
| `~/.turn-record` | Live Pi capture service under launchd | Retain as infrastructure; qualify record capture separately from standing seats |

The live inventory above was checked on 2026-09-05 using harness process
working directories and exact custom tmux sockets, without interrupting them.
TSM uses its aweb tmux socket, BeadHub the awebai socket, and Docflow the
main socket. Lead delivered explicitly attributed coordination messages to
those identified harnesses and read their replies; no coordination command
was run as another seat. Old aweb presence timestamps
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
learning). Deferred retirement shipped in 0.22.2; record-fed learning shipped
in oats.okf 1.5.0. Their presence does not replace the end-to-end acceptance
checks below. Lead owns
the full-machine plan and runtime/wake qualification, including the Codex
support requirement. The aweb coordinator owns identity continuity and route
semantics, with oats coordinating the rehearsal and package changes.

### Recreate or retain identities according to the actual requirement

Cjr's default is a new OATS-minted identity and an explicit handover of
outstanding work, knowledge, contacts and task responsibility. Old identities
are retired only after that handover is accepted. Pilot identities remain
uniquely named so no existing address has to be removed for the experiment.

Merlin retains his identity; other continuing seats follow their accepted
policy. Oats implemented explicit source-authority binding in oats.aweb 1.10.0,
reviewed and shipped with OATS 0.22.3. Published oats.aweb 1.10.1 additionally
requires an installed ambient Claude channel to be at least 1.7.9 for session
delivery, matching the existing Pi extension floor of 0.3.10. A disposable rehearsal verified
stable identity/address, existing conversations, heartbeat, exclusive holder
refusal, rollback and authority-preserving retirement. Aweb supplied this
supported handover:

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

The deferred external retirement mechanism shipped in 0.22.2. Completion
still requires an actual harvester to finish, report and clean up without
operator retirement, with visible recoverable failure. The detached worker
stops the runtime before releasing capabilities; status remains read-only.

Cjr archived its local harvester override and uses official oats.okf 1.5.0.
Its authenticated Pi model is `openai-codex/gpt-5.5`. The remote qualification
host's equivalent provider login fails refresh with `invalid_refresh_token`;
spawning that harvester is not successful learning. Both failed test sessions
were retired normally. Do not copy rotating login tokens from another host.
An explicit `harvest-runtime` setting is planned in oats.okf 1.5.1 so an
already authenticated Claude or Codex runtime can do the same work.

### Finish temporary identity retirement

The aweb owner must resolve the remote lifecycle defect tracked under
`aweb-aaum.6`; oats coordinates package integration. The leaked release identities are a reproduction; reconcile the exact
owner-side list before naming or deleting them. Alias-release fixes are in
aweb source; production same-alias join/delete/rejoin acceptance is pending. Independently verify coordination cleanup,
claims and certificate state. Admin cleanup is a recovery procedure, not
proof of automatic retirement. This gates temporary-worker completion;
adopted standing executions instead must preserve their durable identity.

### Recover standing executions after reboot

Tmux and Herdr keep agents alive when a viewer disconnects; a machine reboot
ends those executions. Replaying `instance.json.command` manually does not
refresh OATS's independent session receipt and is not a supported recovery.
The first planned recovery reuses the tested retained-authority handover:
preserve the stopped home, knowledge and identity, then create its replacement
with a new receipt and one active holder. The retained-binding rehearsal
passed, but the installed standing-seat recovery journey remains to qualify. A terminal-only
restart operation may follow; it must refresh the receipt without rerunning
resource-provisioning hooks. No automatic supervisor is required for the first
supported manual recovery.

### Include noncoding learning and all actual runtimes

`aweb-abfz` tracks record-fed learning; oats.okf 1.5.0 ships its record path. Its bounded acceptance is
a standing session that wrote no notes and made no code commit producing a
reviewed knowledge proposal with provenance to exact recorded turns, then a
successor reading that knowledge. Notes-based harvest must continue working.
Oats owns this after service self-retirement: select the source instance's
own recorded turns through a record helper, feed them to existing OKF
judgment, and deliver proposals through the same review path. Verify exact
source provenance, correct soul destination and safe repeat processing.
Storing transcripts or running the mind daemon alone does not satisfy this
gate.

The inventory includes Codex sessions. Native Codex launch/status/stop shipped
in 0.22.2 alongside Pi and Claude; preserve each seat's selected runtime.
The shared `yolo` default is enabled on this machine and maps to the runtime's
permission flag. Aweb owns the per-host `aw wake` service; OATS supplies
session inspection/input and capability registration, while Desktop is a
client. Installing the broker service and proving mail/chat delivery after
GUI closure is required before channel-free standing-seat adoption. Manual
polling and successful terminal submission are not consumption evidence. Establish any actual machine-policy change
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

## Latest operating evidence (2026-09-05)

- Cjr's pilot landed five useful task commits and eleven promoted concepts
  from four harvests, with independent code and knowledge reviews. Ordinary
  retirement using candidate `b73918f` exited successfully in four seconds:
  changed home bytes preserved, no redundant repository clone, worktree/home
  removed, merged branch retained and temporary aweb alias retired. The
  prior large-index failure led to the batch restore and home-only fixes.
  Redundant failed repository copies were removed only after every file and
  object was proven recoverable elsewhere; all home snapshots remain.
- TSM's owner plan is `~/tsm/history/2026-09-06-tsm-oats-handover-plan.md`.
  Preserve the five seats' worktrees, skills and knowledge; re-arm Zeus's
  session-local schedules. Production credentials remain solely with the
  authorized production operator. His plan reserves Zeus's final cutover
  for Juan's presence; the other seats can prepare in the meantime.
- BeadHub configuration/soul commit `3ee13a8` was independently reviewed and
  landed. Its tracked deployment template is materialized at the canonical
  parent workspace, with trusted official capabilities and a clean actual
  doctor result. The soul retains SaaS Git provenance and uses workspace mode
  as a coordinator across the three canonical repositories. Its legacy holder
  remains live; authenticated harvest-model configuration and the published
  broker service precede activation. Stripe and production gates remain separate.
- Docflow supplied its own identity and handover through its terminal. Its
  backfill and register verification define the safe boundary. Preserve its
  Claude memory and existing credentials in place; verify filesystem/TCC
  access and the Minerva conversation before accepting the successor. Stop
  the old harness before activating retained authority in the successor.
- Local-scope aweb identities on different teams cannot contact one another
  directly. Contacts require a globally resolvable target; the failed
  lead/Zeus and lead/Docflow exchanges expose that intentional boundary.
  Preparation proceeded through identified terminal coordination. Establish
  the cross-team coordinator identity/contact policy explicitly before
  relying on those routes; do not silently replace retained identities.
- Real remote Claude launch, terminal input and detach survival passed.
  Remote Desktop projection and exact-home lifecycle shipped in 0.22.3; the
  installed remote CLI serves the real registered roster. Remote harvester
  completion remains blocked by provider authentication, and no standing
  remote seat is declared migrated.
- The aweb broker candidate `30469e22` ran as a private launchd service against
  published OATS 0.22.3. Real Claude and Codex sessions in tmux and Pi
  in Herdr, with Claude channel 1.7.9 and Pi extension 0.3.10, fetched mail and replied with exact qualification tokens,
  with all GUI viewers closed. Pi also answered a sender-waiting chat. Mail
  sent while the broker was stopped was recovered after restart. After the
  Codex harness stopped, its registration became inactive and a subsequent
  message remained unread. Pause also survived a daemon restart, keeping mail
  unread until resume, after which the agent replied. The candidate does not
  fetch or acknowledge mail.
  Published aw installation and standing-seat acceptance are still separate.
- Qualification found that tmux output loses tab separators in a minimal
  launchd environment without a UTF-8 locale. Independently reviewed kernel
  fix `a0b0e14` adds tmux UTF-8 mode; until it ships, the host service specifies
  `LC_ALL=en_US.UTF-8`. Existing Claude plugin 1.7.8 also consumed mail before
  the broker wake; updating to 1.7.9 eliminated that competing delivery path.
  The deployed oats.aweb 1.10.1 floor now rejects the incompatible version.
