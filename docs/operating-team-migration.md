# Full operating-team migration

Operating record, updated 2026-09-06. Juan asked lead to discuss the migration with
Merlin and plan for all teams on this machine to be managed by OATS, with
harvesting fully working. This expands the earlier release/configuration
rollout. It does not describe an already completed migration.

The cjr runbook is owned by Merlin at
`~/cjr/agents/docs/2026-09-05-oats-migration.md`. This document records the
shared framework work and the wider rollout.

Fresh identities are authorized for continuing seats as well as specialists and
reviewers. Preserve the accepted retained-identity choice where it is useful.
Merlin retains
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

The installed CLI baseline is published OATS 0.22.7 on this Mac and `aweb-agents`,
including native Pi/Claude/Codex, tmux/Herdr, shared `yolo`, remote Desktop
roster/actions, retained-authority binding and corrected deferred retirement.
The installed Mac Desktop 0.22.7 passed published ZIP checksum and strict deep
codesign. Its controlled single-instance check passed and the app was closed
afterwards, with all owned processes verified gone. The previous 0.22.6 app
is preserved for rollback; earlier renderer/PTY checks remain version-specific.
Official oats.okf 1.5.1 is published after independent
review, adding harvest-runtime selection and detection of unadvanced record
plans. Each deployment selects an authenticated harness; without an explicit
harvest-model, that harness uses its own configured default. Some prepared
teams still use the compatible 1.5.0 package; preserve the exact versions of
each earlier qualification.

BeadHub, Minerva and Merlin now have managed standing executions with retained
identities. BeadHub and Minerva passed separate mail/chat checks; Merlin verified
his identity and preserved claims, then received and replied to Minerva's real
mail through the host wake path. Frontend also has a managed execution with
separate mail/chat proof and reviewed knowledge promotion. This is not completion
of all teams: TSM is held, Docflow still has a running backfill, and the coordinator
handovers remain outstanding. See the current status below;
older evidence records keep the version and outcome of each earlier check.

## Current status and operating limits (2026-09-06)

Juan requires completion without exhausting the machine again. **Do not disturb
TSM until its deployment is finished.** No TSM runtime, configuration, identity,
or handover operation is authorized during that boundary. Wait for Zeus's
explicit deployment-complete report; earlier cutover sequencing below is
superseded by this condition.

The first broad rollout produced overlapping record-capture processes: each
could index the large local store, with individual processes exceeding 2 GB
RSS. The capture watcher was about 1.7 GB. The experimental mind follow service
also consumed substantial CPU/memory and launched model runs. These are observed
contributors, not a complete accounting of the reported GUI memory incident;
no OATS Desktop process remained when lead took the incident snapshot.

Lead stopped the capture watcher and residual capture passes, disabled their
exact Claude hooks, and stopped the experimental mind follow service. Settings,
service definitions, raw records and learning state are preserved. Continue
with one bounded operation at a time, checking memory between
launches; declining swap alone does not prove sustained stability. Published
0.22.6 prevents overlapping capture passes with a conservative lock that never
steals an existing owner; interrupted owners require explicit recovery. Its
measured full pass still exceeded a 2 GiB RSS budget during indexing and was
stopped by the monitor. The follow-up streams journal entries instead of loading
whole arrays. The independently reviewed candidate completed the real index of
1.74 million turns in 41.6 seconds, at 809.5 MiB peak RSS with normal memory
pressure, under a 256 MiB Node old-space budget. That fix is now published and
installed in 0.22.7. The replacement launchd job runs one background pass every
15 minutes, without per-tool hooks or a permanent watcher. Its first real pass
completed in 101 seconds at 746 MiB peak RSS, with index completion and zero
aw-log projection failures. The reviewed operator wrapper stops its own child
on a 2 GiB RSS limit, two elevated memory-pressure samples, or a five-minute
deadline. It records each run atomically in
`~/.local/state/oats/capture/status.json`, retaining the previous success time
through failures. Idle between passes is normal. Interrupted capture locks
still need explicit owner-checked recovery; the wrapper reports the remedy.
Experimental mind follow remains paused.

| Scope | Verified state | Next boundary |
| --- | --- | --- |
| Host services | Published aw 1.36.1 installed; normal launchd wake service on Mac and enabled user service on `aweb-agents`; private broker stopped | Investigate repeated reconnect hints and reported read timing without assuming the broker acknowledged mail |
| BeadHub | `beadhub-seat`, retained DID/address and claims; native Codex; independent mail/chat; first reviewed knowledge PR merged at `70c839e` | Repeat harvest exposed a retained merged-branch collision; operator updated the linked soul and removed only the verified merged branch; next cycle waits for a bounded launch slot |
| Cjr | `accountant-minerva` and `coordinator-merlin` live on retained identities; old holders stopped first; claims preserved; real delivery and reviewed learning recorded | Reviewed log update `5bfeefd1` landed with user edits preserved; the idle librarian has the sole slot for its ordinary harvest; no financial authority changes |
| Aweb | Coordinator remains live; `frontend-oats` passed independent mail/chat and reviewed knowledge promotion `d649d729`; failed-join cleanup completed using oats.aweb 1.10.3 | A separately resumed old frontend was confirmed idle and stopped with its channel child; absence verified 2026-09-06 01:03:15 UTC; coordinator handover awaits its slot |
| TSM | Prepared souls and owner checkpoints; Themis setup failed before the current hold | **No migration work until Zeus reports deployment finished**; re-inventory with its owner afterwards |
| Docflow | Legacy seat and actual mail backfill remain running | Finish backfill and register checks; owner restores mail-ingest afterwards; accountant-sync remains unloaded under its separate export fence |
| Oats/lead | Existing coordinators remain active | Last handovers, with actual stop receipts and all unresolved work carried forward |
| Remote qualification | Published host service delivered native Claude mail/chat through Herdr; corrected knowledge independently reviewed; source retired with `aliasReusable: true` | Earlier separate fresh-reader cycle passed; latest corrected wake-specific retrieval is still pending |

Published aw 1.36.1 is tagged at `bfdb20886080e4ffe1f02b266f6116d12bd100fd`.
All 46 release targets have passing results for that source: targets 1–41 in
one run, followed by an explicitly accepted continuation of 42–46 after a Go
download failure. This was not one atomic run. Evidence is archived under
`~/awebai/bookshelf/records/2026-09-05-aw-1.36.1-split-gate/`.
Production same-alias join/delete/rejoin passed, and official oats.aweb 1.10.2
reports the released alias result truthfully. Retained standing-seat retirement
must still preserve authority.

Desktop has six validated team roots saved as workspace suggestions,
not six running GUI instances. It starts with one workspace and can add others.
It is currently closed; visual QA and sustained multi-workspace memory behavior
are not claimed. Version 0.22.6 added a single-instance guard and 0.22.7 runs the
packaged backend as Node. An installed 0.22.7 check served the Oats workspace API;
a second launch exited successfully while the primary remained, with both
owned process groups peaking at 589 MiB and normal memory pressure. All test
processes were stopped and verified absent. The full release gate and all three
Desktop builds passed on hosted runners; publication succeeded, and the bot's
version-bump PR permission failure was resolved through reviewed manual PR #8.
Native remote Pi authentication and remote Codex remain
unqualified; the accepted remote harness is Claude.

## Scope inventory

Reconfirm the live inventory with each owner at handover; process presence
and old directories are evidence to investigate, not the authoritative list
of continuing seats.

| Scope | Starting point | Required disposition |
| --- | --- | --- |
| `~/awebai/oats` | Live Claude coordinator and Codex lead; managed review workers also running | Oats owns coordinator handover; lead owns lead handover; follow the explicit fresh or retained identity choice |
| `~/cjr` | Preparation `5afb3e8b`; developer pilot landed on master `062e2c75`; legacy Merlin and Minerva live | Merlin owns safe handovers; preserve his DID/address; automatic harvest completion and successor use are proven; prepare standing seats |
| `~/awebai/aweb` | Live Claude coordinator and frontend in legacy homes | Oats owns coordinator handover; lead coordinates frontend with aweb after its current work; handover task responsibility and cover child repositories |
| `~/tsm` | Five live seats: Zeus, Prometeo, Argos, Themis on Claude; Hermes on Codex. All five souls integrated, official capabilities installed and trusted, owner checkpoints prepared | Paused by Juan until deployment complete; owner rechecks all seats afterwards; preserve schedules and production authority |
| `~/prj/beadhub-all` | Live Codex session, despite stale offline roster | Beadhub accepted preparation and is at a safe boundary; retain its global identity, native Codex and separate canonical code roots under `~/awebai/beadhub`; billing remains separately gated |
| `~/prj/docflow` | Live Claude seat identified itself as local `juan.aweb.ai/alice` on `docflow:juan.aweb.ai` | Owner Juan; finish running mail backfill and register checks before transfer; retain identity, memory and Minerva route; accountant-sync remains deliberately unloaded |
| `ai.aweb` on `aweb-agents` | Aweb confirms Athena intentionally inactive; remote legacy home retained | Aweb and oats own archival inspection; do not resurrect as a continuing seat |
| `~/awebai/demo-aweb/bob` | Live Pi demo | Aweb owns safe stop and archival disposition; it is not an operating-team migration |
| `~/.turn-record` | Guarded periodic capture enabled and measured; per-tool hooks and experimental mind follow remain disabled | Preserve records; monitor the run artifact; no blind watcher restart |

The starting inventory above was checked on 2026-09-05 using harness process
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
both failed Pi tests were retired normally. No rotating login tokens were copied.
Official oats.okf 1.5.1 now selects the already authenticated native Claude
runtime on that host. A real note-fed harvest promoted an operational lesson,
self-retired, and a fresh successor retrieved and used the lesson. This proves
that alternative harness path; it does not claim the Pi login was repaired.

### Finish temporary identity retirement

The aweb owner must resolve the remote lifecycle defect tracked under
`aweb-aaum.6`; oats coordinates package integration. The leaked release identities are a reproduction; reconcile the exact
owner-side list before naming or deleting them. Alias-release fixes are in
aweb source; production same-alias join/delete/rejoin acceptance passed on published aw 1.36.1. Independently verify coordination cleanup,
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

## Earlier operating evidence (2026-09-05)

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
  authorized production operator. Zeus remains last. Juan's current direction
  authorizes completing the migration while he is away; the earlier
  presence-only pause does not override it. Actual job and production boundaries
  remain. Themis's ten-commit packet landed at `46cf2083`; its installed
  oats.aweb 1.10.1 and oats.okf 1.5.0 passed the actual doctor. All five souls
  are now integrated through Prometeo's `103e534c`, with owner-approved private
  startup briefs and checkpoints. Those checkpoints must be refreshed at the
  actual stop; Zeus's deployment and scheduled-job boundaries remain binding.
- BeadHub configuration/soul commit `3ee13a8` in `awebai/beadhub-saas`
  (`~/awebai/beadhub/beadhub-saas`) was independently ACKed by lead and
  landed on `main`. Its tracked deployment template is materialized at the canonical
  parent workspace, with trusted official capabilities and a clean actual
  doctor result. The soul retains SaaS Git provenance and uses workspace mode
  as a coordinator across the three canonical repositories. Its legacy holder
  remains live; authenticated harvest-model configuration is installed and
  verified. The published broker service precedes activation. Stripe and
  production gates remain separate.
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
  installed remote CLI serves the real registered roster. Native Claude
  harvesting subsequently completed with official oats.okf 1.5.1, as recorded
  below. No standing remote seat is declared migrated.
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
  fixes `a0b0e14` and `0260ea9` shipped in 0.22.4, adding UTF-8 mode to
  lifecycle/input and viewer calls. The host service also specifies
  `LC_ALL=en_US.UTF-8`. Existing Claude plugin 1.7.8 also consumed mail before
  the broker wake; updating to 1.7.9 eliminated that competing delivery path.
  The deployed oats.aweb 1.10.1 floor now rejects the incompatible version.

- Cjr's second and third worker cycles completed on published kernel 0.22.3
  and oats.okf 1.4.1 (note-fed). The
  second promoted three reviewed concepts; the third read them before working,
  produced the normal host-service health reader (`3dfe3acf`) and completed
  its own reviewed harvest. Both harvesters self-retired without operator
  completion. Each worker's ordinary retirement took four seconds and removed
  its temporary alias. A post-merge fixture mismatch was corrected forward in
  `e8a87c71`, with 47 tests green on a clean export. The reader's real service
  check awaits installation of `ai.aweb.wake`.
- A record-only harvest of the fresh Claude wake-test session completed with
  official oats.okf 1.5.0. It read its 27-turn source window, found no durable
  lesson to promote, advanced the completed watermark and self-retired. The
  first attempt exposed an unnecessary SQLite index write during pure journal
  reads; reviewed fix `f100320` shipped in 0.22.4. The shared capture service
  and its large index were preserved. Completion is proven; this run does not
  claim a knowledge promotion.
- Docflow's two-commit preparation at `4458097` is independently ACKed: native
  Claude, retained authority, session delivery and 18 valid curated OKF concepts.
  Its role and package preparation is integrated. The running backfill
  and FY2025 register checks still determine its activation boundary.
- The tracked aweb coordinator soul at `0a3a9a91` is independently ACKed; the
  frontend soul at `b3985edb` is owner-reviewed and landed. They preserve the
  coordinator's workspace and the frontend's managed primary SaaS worktree plus
  explicitly assigned secondary OSS tree. Lead and Oats coordinator souls are
  also reviewed and landed. Concrete deployment configuration and final
  checkpoints precede each launch.
- OATS 0.22.4 is published at tag `0260ea9`, with npm packages and six Desktop
  installers. CI retried once after a disappearing Git maintenance lock in a
  fixture; kernel and Desktop gates then passed. A manual reviewed version-bump
  PR completed the bot's permission-blocked post-publication step. Published
  npm JavaScript bytes match the tag. OATS 0.22.5 subsequently shipped the
  package-selector CLI and oats.okf 1.5.1 pin; its manual version-bump PR #5
  completed at `91ef541`. Aweb 1.36.1 remains unpublished: candidate `bfdb2088`
  passed targets 1–41, then a Go dependency download failed in target 42.
  Its coordinator explicitly accepted completing targets 42–46 on that same
  candidate and environment, preserving both logs and recording the loss of
  single-run atomicity. The remainder is running; the private broker is not
  being represented as the permanent published service.

- Cjr's retained declaration/runbook packet is independently ACKed through
  `6dc6efc8` (three commits); its source authority remains in place and operator
  stop-before-start applies to rollback as well as cutover. Its two soul startup
  corrections also landed after independent review at `bd981b3a`. Official
  oats.aweb 1.10.1 and oats.okf 1.5.0 are now installed and trusted for both
  standing souls. These newer pins do not relabel the earlier worker proofs.
- TSM's Argos packet is integrated at `f20c54bb` after both independent and
  owner ACKs; actual doctor resolves the two retained reviewer seats. BeadHub
  and Themis supplied final private startup briefings and idle checkpoints.
  Hermes and Prometeo were explicitly woken to read unseen followups; their
  legacy channels had not delivered those requests reliably. Both subsequently
  approved their souls and final handover checkpoints.
- A locked-selector update gap found during actual team setup was corrected
  at `d95018e` (two independently reviewed commits) and shipped in 0.22.5.
  It supports `oats update <package> --to <ref>` or a positional catalog
  spec. A hermetic CLI test exercises the version transition, trust reset and
  invalid arguments, including refusal to enter the kernel self-updater when
  a package is missing. The installed remote 0.22.5 CLI accepted the selector
  and preserved the already-correct 1.5.1 lock and its trust.

- Herdr 0.8.2 is installed on both hosts. Published OATS 0.22.4 launched a
  real remote Claude session through the saved server route; a separate
  session-input request elicited an actual reply. The source and its successor
  then completed native Claude harvesting and knowledge use with official OKF
  1.5.1. The harvester consumed its source note, promoted one PATH-resolution
  lesson, passed strict validation, and self-retired. A fresh instance read the
  indexed lesson before checking every resolved tool path and comparing runtime
  and login shells. Both source instances were retired normally with their
  changed home files preserved. This is local-soul promotion and retrieval,
  not a repository PR cycle or remote broker-wake acceptance.
- The remote host now has shared `yolo: true`, updated Pi installations,
  Claude channel 1.7.9, and the published OATS 0.22.5 capture hooks and enabled
  user service. Its existing record-owner name was preserved and the initial
  capture/index pass completed. The Mac capture service was left in place.
- Coordinator scope is explicit: Oats and Aweb retain their global identities
  through the rehearsed authority-transfer path. Fresh local lead/frontend
  identities relay cross-team requests through a verified global coordinator;
  an alias containing a domain does not itself establish global reach. The
  final briefs preserve conversations or hand off unresolved threads according
  to that identity choice, require an actual old-process stop, and distinguish
  startup context from a separate incoming-message wake check.
