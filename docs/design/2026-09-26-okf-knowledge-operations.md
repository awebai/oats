# OKF knowledge operations: harvest, maintenance, triggers, and the working-soul surface

**Status:** decided and implemented (kernel 0.28.0 and 0.29.0, oats.okf 4.x). This record decides how knowledge operations are split across the oats.okf package and which kernel mechanisms carry them: package souls, triggers and workspace automations. The reference pages ([knowledge.md](../knowledge.md#knowledge-operations), [schedules.md](../schedules.md#triggers), [packages.md](../packages.md#package-souls)) win on operator-visible behaviour.

## 2. Design

### 2.1 Capabilities in the oats.okf package

The package ships three capabilities, two package souls (§2.2) and one trigger template (`harvest-review`, §2.3).

| Capability | Who gets it | Skills | Inject | Commands and hooks |
|---|---|---|---|---|
| **oats.okf** (knowledge slot) | every working soul with OKF knowledge | `okf-consultation` (soul knowledge); `okf-instance-knowledge` (what instance knowledge is worth capturing, and its form; §2.5a) | the work mode (§2.5) | the consult commands; `setup`, `init`, `migrate`, the binding; `run-source`, `complete`, `harvest-status`; the spawn hook (source registration) and retire hook (custody) |
| **oats.okf-harvest** | the harvester soul only | `knowledge-theory` (the OKF promotion doctrine); `knowledge-harvest` (the procedure); `okf-authoring` (OKF Markdown craft) | a judge, not a worker; the staged roots are the only write surface; stay alive until the PR is merged or closed | `complete`, `harvest-status` |
| **oats.okf-maintenance** | the maintainer soul only | `knowledge-theory` and `okf-authoring` (identical copies); `knowledge-review` (situate, judge, amend, merge, notify); `okf-trigger-setup` (declare and verify the review trigger) | one PR per instance; never merge what fails the doctrine; supersede explicitly | `review-context`, `notify-harvester` |

- **Shared skills are identical copies** (a package is a Git tree with no build step); a package test fails if they differ. No soul composes both capabilities, so they never collide.
- **oats.okf ships no harvest doctrine.** Working souls get consultation and capture judgment only; the promotion doctrine belongs to the harvester and the maintainer.
- **Naming:** oats.framework ships an unrelated *capability* `oats.knowledge-theory` (for capability authors). The okf *skill* `knowledge-theory` describes itself as the OKF promotion doctrine so triggering does not confuse the two.

### 2.2 Package souls

A package ships souls beside its capabilities, so "sourced from the okf package" is one versioned pin.

- A package manifest declares `souls: ["souls/knowledge-harvester", "souls/knowledge-maintainer"]`. Each is an ordinary soul directory (`soul.yaml`, `AGENTS.md`, `skills/`).
- **Versioned and locked with the package:** one pin (`packages: { oats.okf: <version> }`) versions the capabilities and the souls. The lock records each soul's name, path and digest; nothing drifts, unlike an `external:` commit pin.
- **Listed** with `kind: "package"` and its package origin (`oats souls`, the Desktop Souls page).
- **Named** `<package>/<soul>` (`oats.okf/knowledge-maintainer`); a bare name works when unique, otherwise `E_SOUL_AMBIGUOUS`. It homes in `agents/<package>--<soul>/`, never shared with a same-named member soul.
- **Resolved** like any soul (workspace defaults, `off`, `<slot>: none`, `souls.disabled`); `from: here` means *this package* at the locked commit.
- **Trusted** as the package's capabilities are: declaring the package is the trust decision.
- **Package souls replace capability agents.** A capability manifest that declares `agents:` is refused (`E_CAPABILITY_AGENTS_REMOVED`) with a remedy naming package souls.

### 2.3 Triggers

A trigger is an **event-driven schedule**: "when EVENT matches, spawn a NEW instance of SOUL with TASK, in TEAMS".

- It lives beside schedules: the same deployment scope and file (`oats-schedules.json`, `kind: "trigger"`), the same host tick (`oats schedule tick --host`) and the same spawn path. There is no daemon and no webhook; it runs only on the host that holds the scope.
- Triggers are per-host by design: they act with that machine's `gh` credentials, and a definition carries none.

```json
{ "id": "okf-harvest-review", "enabled": true, "kind": "trigger",
  "on": { "source": "github.pull_request", "repo": "github.com/acme/knowledge",
          "events": ["opened", "reopened", "ready_for_review"],
          "labels": ["okf-harvest"], "base": "main", "poll": "2m" },
  "spawn": { "soul": "oats.okf/knowledge-maintainer", "purpose": "review-pr-{number}",
             "task": "Review knowledge-base PR {repo}#{number} ({url}). Load the knowledge-review skill first.",
             "harness": "claude", "model": "opus" },
  "concurrency": { "max": 2, "perKey": 1 } }
```

- **Source:** `github.pull_request` only, polled with the host's `gh` every `poll` (default `2m`, at least `1m`). Events are inferred poll over poll: `opened`, `reopened`, `ready_for_review`, `labeled`, `synchronize`. The shape stays open to other sources.
- **Dedup and delivery:** each event has a key `<trigger>:<repo>#<number>:<event>:<stamp>`. A key is recorded as fired only after a successful spawn, so a failed spawn is retried on the next poll. Delivery is at least once; `concurrency.perKey` (default 1) keeps one live instance per PR, and `concurrency.max` (default 1) bounds the trigger.
- **The event reaches the instance** as `OATS_TRIGGER_EVENT_FILE` (`<home>/.oats/trigger-event.json`: `{trigger, source, repo, number, url, event, headSha, labels, observedAt, key}`), plus the templated task.
- **Templates substitute only whitelisted structured fields:** `{repo} {number} {url} {event} {headSha} {trigger}`. A template naming any other field is refused. PR titles and bodies are never interpolated: they are untrusted data the soul reads from the event file and GitHub.
- **Teams:** `spawn.teams` becomes the messaging capability's `join=` provider setting at spawn.
- **CLI:** `oats trigger add | list | show | enable | disable | remove | test | status`, all with `--json`; `test` is a dry run (gh auth, repository permissions, the soul resolves, what would fire now). The kernel advertises feature `triggers` in `oats version --json`.
- **Package trigger templates:** a package declares `triggers: [{ id, file }]`, each file `{ parameters, definition }`. `oats trigger add --from oats.okf:harvest-review --set repo=…` instantiates one at the locked commit. This is how okf ships the review trigger.
- **Safety:** a trigger spawns only a soul that resolves in this workspace; a disabled soul refuses. The trigger runs with the host's own credentials.

### 2.3a Workspace automations: triggers and schedules declared in Git

Triggers and schedules are defined at one of two levels:

- **the workspace level**, a file committed in a confirmed member repository and shared through Git, named `<member>/<id>`: the default for anything a team relies on;
- **locally**, in the deployment's `oats-schedules.json` (`oats trigger add`, `oats schedule add`): machine-private, named `local/<id>`. A local schedule row keeps its bare `id` plus `qualifiedId: local/<id>`.

Triggers and schedules are separate modules sharing only the kind-neutral pieces (`lib/automations.mjs`): one contract, one rule set, one layout.

**Where a file lives:** every `*.yaml`/`*.yml` under the canonical folders `oats-triggers/` and `oats-schedules/` at a member's root, and any file named `*.oats-trigger.yaml` or `*.oats-schedule.yaml` anywhere in the member (beside the code it concerns). `oats-package/` (package templates are not workspace automations), `.git/` and `node_modules/` are never scanned. Discovery costs one tree listing per member commit, then blob reads of the candidates.

**The file describes itself.** It carries `kind: oats-trigger` (or `oats-schedule`) and `schemaVersion: 1`; a candidate without the right kind is an `E_AUTOMATION_SCHEMA` problem, never silently skipped. The id is `id:`, else the filename stem; the same id twice in one member and kind is `E_AUTOMATION_DUPLICATE`, naming both paths.

```yaml
# <member>/oats-triggers/okf-harvest-review.yaml
kind: oats-trigger
schemaVersion: 1
description: Review every harvest PR on the knowledge base
from: oats.okf:harvest-review        # a package template, then its parameters
set: { repo: github.com/acme/knowledge }
runsOn: kb-bot-server                # the host.name that runs it
owner: github.com/acme-kb-bot        # the GitHub account it acts as, <host>/<login>
# …or a full definition (on, spawn, concurrency) as in §2.3, instead of from/set
```

A workspace schedule has the same header with `run: spawn | command`, `cron`, `tz`, `agent`, `task` and the spawn options; `wake` targets an instance home on one machine, so it stays local.

**Who runs it.** A GitHub account (a person or a machine user) acts; a named host runs. A host runs a workspace automation only when both hold:

- `runsOn` equals its `oats-local.yaml` `host: { name }` (a machine fact, never in Git);
- its authenticated `gh` account equals `owner` (asked once per tick).

Otherwise it is listed with the reason `assigned-elsewhere`, `owner-mismatch` (named here but logged in as someone else; nothing runs, and `oats trigger test` says so) or `host-unnamed`. So exactly one machine runs it, and consent is explicit: its operator named the host and is logged in as the account. Declaring the automation in a member is the trust decision for its definition, as for souls. A workspace trigger's `owner` and `on.repo` must be on the same GitHub host.

**Opting out** without a commit: `oats trigger disable <member>/<id>` and `oats schedule disable <member>/<id>` write `triggers.disabled` / `schedules.disabled` in `oats-local.yaml`. A workspace definition is never edited or removed locally (`E_AUTOMATION_WORKSPACE`): change the file in Git.

**Refresh.** `oats sync` discovers the workspace automations into a snapshot (`.agents/automations/snapshot.json`); the host tick reads it and refreshes it (`oats automations refresh`) when it is more than ten minutes old, so a change in Git reaches the named host within about ten minutes. A trigger template is instantiated when the snapshot is taken, at the locked commit. The run state (dedup keys, last poll, last run) stays per host and local.

**Writing one:** `oats trigger add` / `oats schedule add --workspace <member> --runs-on <host> --owner <host>/<login>` writes the file into a checkout of that member, or prints it. Everything in §2.3 still holds for workspace triggers.

**Data and Desktop.** `oats trigger list --json` and `oats schedule list --json` carry workspace and local items together, each with its origin, owner, `runsOn`, `runsHere` and reason, soul, task and last/next run. The Desktop renders these rows and never re-derives placement: one Automations item, Schedules and Triggers subtabs in one layout, rows grouped by where they run and marked with their origin. A member the user cannot read contributes nothing.

**okf onboarding.** The review trigger is a workspace file (`oats-triggers/okf-harvest-review.yaml`, `from: oats.okf:harvest-review`, with `runsOn` and `owner` naming the merge-capable host and account). `okf-trigger-setup` teaches this form first, and `oats trigger test <member>/<id>` verifies it on the named host.

### 2.4 The harvester and the maintainer

**`knowledge-harvester`** (a package soul; `work: directory`; `knowledge: none`, so there is no recursive harvest; capability `oats.okf-harvest`).

1. okf's per-source `run-source` job captures custody and spawns `oats.okf/knowledge-harvester` with the frozen input, as a child of the source instance. Its harness is the oats.okf `harvest-runtime` setting (optionally `harvest-model`).
2. It reads the input fully, the notes and the transcript windows; the judgment receipt cites the turn ids it relied on. It also extracts task references (ticket ids and URLs).
3. It judges with `knowledge-theory`, stages edits on the owned nodes, and `complete` opens the PR (title `okf-harvest: <run>`, label `okf-harvest`) with a **provenance block** in the body: a fenced `okf-harvest` JSON block, `{ version: 1, run, input[], source: { soul, soulId, owner, instance, ownedNodes, readNodes, bases }, tasks: { provider, refs[] }, harvester: { instance, alias } }`.
4. It stays alive, woken by messages, to answer the maintainer and push amendments. It retires when every PR is merged or closed (`oats okf-harvest harvest-status` says `retire`), or at `harvester-max-age` (default 7d) after telling its operator. It never closes the PR.

**The harvest switch.**

- `harvest: on|off` is an oats.okf setting, **default `off`**: a host fact, set in `oats-local.yaml` `settings.oats.okf.harvest`.
- A soul may only opt out, with `soul.yaml` `knowledge: { harvest: off }`, and that opt-out is absolute. **Effective = on only if the deployment says `on` and the soul does not say `off`.** A soul `on` is ignored. This departs deliberately from the later-wins settings merge, so okf reads the soul's own value from its `soul.yaml` and fails closed when it cannot read it with certainty.
- **Off** means no source registration, capture or custody (and no `run-source` job): private transcripts are never accumulated for later.
- **The verbs:** `oats okf setup --harvest on|off` writes the local setting; `oats okf harvest-status [--soul X]` reports the effective value, why, and the registered sources. `oats schedule enable|disable <job>` remains the per-source emergency brake, not the switch.
- **The review trigger is independent of the switch:** a trigger host can review PRs from other hosts' harvesters without harvesting itself.

**`knowledge-maintainer`** (a package soul; `work: directory`; `knowledge: none`; capability `oats.okf-maintenance`, plus the workspace's tasks capability when there is one, used read-only).

1. The trigger spawns one per PR. It reads `OATS_TRIGGER_EVENT_FILE`, fetches the knowledge-base repository and checks out the PR in its `./work`.
2. It **situates** the addition: from the provenance, the source soul's owned and read nodes at the accepted base, the neighbouring concepts (duplicates, supersession candidates, the canonical home) and the source soul's other knowledge.
3. **Tasks:** if the provenance names a tasks provider and refs, and its own tasks capability matches, it reads those tickets. Otherwise the verdict records `tasks: "unavailable"`. This is never a blocker.
4. **Verdict**, recorded as a structured `okf-review` PR comment: `merge`; `amend+merge` (it pushes fixes, supersession edits in other concepts of the same base, index and log to the PR branch); `request-changes` (it messages the harvester and waits, bounded); `close` (with the reason); `needs-human`. It checks the doctrine's two-part test, one canonical home, explicit supersession and provenance.
5. **Human-accepted decisions are never superseded silently.** A PR that would supersede a concept with human acceptance evidence is not merged: the maintainer labels it `okf-needs-human` and asks a human. That label is a hard stop that only a human removes.
6. It merges with the host's `gh` (squash, pinned to the reviewed head), notifies the harvester (`merged` or `closed`) and retires.

**Messaging:** the harvester and the maintainer talk through the soul's messaging capability, in the deployment's default team like every instance. There is no dedicated team to declare; a deployment that wants them in another team opts them in locally, as for any soul (see [the team model](2026-09-27-team-model-v2.md)).

**GitHub credentials:** the maintainer's host must be able to merge on the knowledge-base repository (`oats trigger test` checks). GitHub forbids self-approval, so with one account for both, either `main` requires no approving review or the trigger's `owner` is a separate reviewer account.

### 2.5 The working-soul inject

The oats.okf inject teaches a work mode over both kinds of knowledge:

- **At task start and after compaction:** read instance memory (`STATE.md`, recent `log.md`, relevant `notes/`), then consult soul knowledge (`oats okf index`, then `cat` what is relevant; follow links, do not bulk-load).
- **Before compaction and before a task boundary:** update `STATE.md`, `log.md` and `notes/` first.
- **Every so often while working, and always before a design decision or re-deriving something:** `oats okf search` / `cat`, and re-read your own notes.
- Use both to situate the task and stay coherent with the soul's accepted decisions. Cite what you relied on (`alias/node/concept.md@<short-oid>`).
- **Capture with judgment** (§2.5a). The harvester decides what is promoted. Never write accepted knowledge or soul knowledge.

### 2.5a Instance-knowledge judgment

`okf-instance-knowledge` teaches **what useful instance knowledge is**, not only where to put it. The capture bar is lower than the promotion bar (`knowledge-theory`); they do not compete.

- **The capture test:** would my future self after compaction, or the harvester judging this session, decide or act better for having it, and is it absent from the code, the tracker and the repository docs?
- **Capture:** decisions and why; rejected alternatives; costly discoveries; limitations and the workaround that worked; conclusions (not the investigation's transcript); blockers; human direction and corrections; surprises that contradict soul knowledge (flagged as candidate supersessions); process and environment lessons.
- **Do not capture:** code descriptions or repository maps; command logs and tool output; retries that taught nothing; secrets; third-party messages verbatim; what the tracker or docs already hold (link instead).
- **Form:** `STATE.md` is the current task picture (rewritten); `log.md` is dated events (append-only); `notes/` holds one concept per insight, with a type (Decision, Rejected, Discovery, Limitation, Conclusion, Lesson, Blocker), a one-line claim, the why, the evidence and provenance, and its generality (instance-only or likely true for the soul: a hint to the harvester, not a verdict).
- **Timing:** capture as it happens, at the decision; update before compaction and before task boundaries.
- **Relation to soul knowledge:** consult first; a note that confirms, refines or contradicts an existing concept cites it, which lets the harvester situate it.
- **The theory, from the capture side:** decisions versus descriptions (descriptions drift; decisions are superseded explicitly), code is the truth about code, and indexical residue dies with the instance. Working souls do not get the full promotion doctrine, so there is no second judge.

## 4. Decisions

1. **Package souls, not `external:`**, for "sourced from the okf package": one pin versions everything.
2. **Triggers are schedules of `kind: trigger`:** the same store, tick and spawn path; no daemon and no webhook.
3. **Workspace automations are placed by declaration:** `runsOn` names the one host, `owner` the account it acts as, and a host runs one only when both match.
4. **The harvester is a package soul** (it needs messaging and a lifetime past its PR); capability agents are removed.
5. **The maintainer merges autonomously** when the doctrine passes, except where it would supersede a human-accepted decision (`okf-needs-human`).
6. **The harvester and the maintainer hold no knowledge slot** (no recursive harvest).
7. **Harvest is opt-in per host and opt-out per soul**, and the soul's opt-out is absolute.
