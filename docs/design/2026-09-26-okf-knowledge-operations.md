# OKF knowledge operations: harvest, maintenance, triggers, and the working-soul surface

**Status:** APPROVED by the human, 2026-09-26 ("perfect, I like it … get it moving and implemented and deployed as fast as possible"). Planned by the lead; the co-lead's amendments are folded in as they arrive.
**Targets:** kernel **0.28.0**, oats.okf **4.0.0**, oats.framework **1.2.0**. okf **3.0.0** (the remote consult, in flight) ships first and unchanged in scope.

## 0. The human's direction, restated

1. **Knowledge operations are split across three capabilities.**
   - **oats.okf**: the working-soul surface.
   - **oats.okf-harvest**: the harvester.
   - **oats.okf-maintenance**: the maintainer.
   - The harvester and the maintainer share a renamed **knowledge-theory** skill (today `memory-harvest`), and each has its own skills too.
   - **oats.okf ships no harvest doctrine at all.**
2. **Working souls using OKF get exactly two okf skills and one inject.**
   - A skill for *instance knowledge maintenance* (STATE/log/notes), **teaching the judgment and theory of what useful instance knowledge to capture** (amended by the human, 2026-09-26).
   - A skill for *soul knowledge consultation* (`okf-consultation`).
   - The inject teaches the work mode: query both before starting a task, before compaction, and every so often while working, to decide, situate and work coherently with the soul's knowledge.
3. **The harvester**:
   - reads the harvested instance's **session transcript** (not only its notes), so its judgment has full context;
   - opens a PR to the knowledge-base repo;
   - **stays alive until that PR is merged (or closed), then self-retires.**
4. **The maintainer**: a **knowledge-maintainer soul** reviews each harvest PR.
   - It situates the addition in the base.
   - It reads the harvested instance's tasks, if that instance had a tasks capability.
   - It reads the existing soul knowledge.
   - It judges soundness, amends whatever needs amending, and merges.
5. **Triggers** (new concept).
   - A deployment (laptop or server) can declare "on an event, spawn a NEW instance of soul X with this instruction, in these teams".
   - The first use: *on a harvest PR opened → spawn the knowledge maintainer to review it.*
6. **Fully defined in the okf repo.**
   - The maintainer (and harvester) souls live in oats-okf.
   - Users who onboard with the defaults get the trigger that launches the maintainer, **sourced from the okf package**.
   - The skills insist the trigger runs on a deployment whose GitHub credentials can approve/merge PRs on the KB repo.
7. **An `okf` team.**
   - Workspaces using OKF get an `okf` team, so harvesters and maintainers talk without polluting the working teams.
   - The okf onboarding teaches it.

## 1. What already exists (verified 2026-09-26)

- **Scheduler** (`docs/schedules.md`).
  - Committable definitions per deployment scope.
  - One host timer runs `oats schedule tick --host` every minute; there's no daemon.
  - Kinds: `spawn`, `command`, `wake`.
  - Scheduled spawns materialize exactly like `oats spawn`.
  - okf already registers one `command` job per source (`oats okf run-source`).
- **Transcript capture.** okf's custody already copies **notes AND the record** (bounded `recall` windows of the session transcript, full text) into `<stateDir>/sources/<uuid>/inputs/<hash>.json`. It excludes privacy-excluded sessions. The harvester therefore needs no live source home. The gap is **doctrine and procedure**: the current skill does not make reading the transcript windows mandatory and systematic.
- **PR delivery.** okf's `complete` pushes a branch and runs `gh pr create` on the base's repository (title `memory-harvest: <run>`). It already tracks PR state by `gh pr view/list`.
- **The harvester today is a *capability agent*** (`agents/memory-harvest` in the okf manifest).
  - It gets the whole oats.okf module (so every okf skill), no okf inject, and no hooks, so no messaging identity.
  - It retires as soon as the completion receipt is written.
- **Souls from a non-member repo** exist only as `external:` (commit-pinned, not versioned with a package). **Packages cannot ship souls today.** This is the one real kernel gap for (6).
- **Teams:**
  - labels are declared in `teams:`;
  - `join=` at spawn exists (0.27.x);
  - a soul's label must be declared, or it's `E_TEAM_UNKNOWN`.

## 2. Target design

### 2.1 Capabilities in the oats.okf package (4.0.0)

| Capability | Who gets it | Skills | Inject | Commands, hooks and the rest |
|---|---|---|---|---|
| **oats.okf** (knowledge slot) | every working soul with OKF knowledge | `okf-consultation` (soul knowledge: bases/index/cat/ls/links/search, receipts, citing); **`okf-instance-knowledge`** (instance memory: **the theory and judgment of what is worth capturing**, plus STATE.md/log.md/notes form and compaction discipline; §2.5a) | **the work-mode inject** (§2.5) | the consult commands; `setup`/`init`/`migrate`/binding; the spawn hook (source registration) and retire hook (custody) |
| **oats.okf-harvest** (additive) | the harvester soul only | **`knowledge-theory`** (the doctrine, renamed from `memory-harvest` §3.x); **`knowledge-harvest`** (the procedure: read input fully, transcript windows first-class, situate, stage, PR, lifecycle until merged); **`okf-authoring`** (OKF Markdown craft, today's `okf` skill) | a harvester inject: you are a judge, not a worker; the staged roots are your only write surface; stay alive until the PR is merged/closed | `complete`, `harvest-status`; no source registration |
| **oats.okf-maintenance** (additive) | the maintainer soul only | **`knowledge-theory`** (identical copy); **`knowledge-review`** (situate a PR, read provenance, the source soul's knowledge, its tasks, verdicts, amend, merge, notify); **`okf-authoring`** (identical copy); **`okf-trigger-setup`** (install/verify the review trigger on a host with merge-capable GitHub credentials) | a maintainer inject: one PR per instance; never merge what fails the doctrine; supersede, never silently overwrite | `review-context` (the PR's provenance → the reading list), `notify-harvester` |

**Shared skills are shipped as identical copies** in each capability (a package is a Git tree; there's no build step). A package test fails if the copies differ. There's no `E_SKILL_DUPLICATE` risk, because no soul composes both harvest and maintenance.

**Removed from oats.okf:** `memory-harvest` (it becomes `knowledge-theory` + `knowledge-harvest` in oats.okf-harvest), the `okf` authoring skill (→ `okf-authoring`, maintenance/harvest only), and the `agents/memory-harvest` capability agent (→ a package soul).

**Name note:** oats.framework already ships a *capability* `oats.knowledge-theory` (the skill `knowledge-capability-authoring`, for capability authors). The new *skill* `knowledge-theory` is unrelated and lives in okf's namespace. Its description must say "OKF promotion doctrine" so triggering doesn't confuse the two.

### 2.2 Package souls (kernel 0.28.0), the enabler for "sourced from the okf package"

- A package manifest may declare `souls: ["souls/knowledge-maintainer", "souls/knowledge-harvester"]`.
- Each is an ordinary soul directory (`soul.yaml`, `AGENTS.md`, `skills/`).
- **Versioned and locked with the package:** one pin (`packages: { oats.okf: 4.0.0 }`) versions the capabilities *and* the souls. Nothing drifts, unlike `external:` commit pins.
- **Discovery:** they're listed with `origin: package` (`oats status --workspace`, and the Desktop Souls page shows "from package oats.okf 4.0.0").
- **Spawn:** by name. A package soul's instances live in a qualified directory (not shared with a same-named member soul).
  - Package souls are namespaced `oats.okf/knowledge-maintainer` to avoid collisions with member souls.
  - A bare name works when unambiguous.
- **Resolution:**
  - `from: here` inside a package soul means *this package*.
  - Workspace/team defaults apply as for any soul (the soul can opt out with `off`/`none`).
- **Workspace control:** `disabled:` in `oats-local.yaml` works as for member souls.
- **Trust:** the same as the package's capabilities. Declaring the package is the trust decision.
- **This replaces capability agents** (`agents:` in a capability manifest) once okf 4.0.0 is pinned. Removing the capability-agent path is a separate kernel PR, per "v2 becomes the classic" (no dual path), after the okf 4.0.0 mirror.

### 2.3 Triggers (kernel 0.28.0)

**The concept:**
- A trigger is **an event-driven schedule**: "when EVENT matches, spawn a NEW instance of SOUL with TASK, in TEAMS".
- It lives beside schedules: the same deployment scope, file and host tick (`oats schedule tick --host`), and the same spawn path. There's no new daemon, and it runs only on the host that holds the scope.
- Triggers are **per-deployment by design**: they need that machine's credentials.

**Definition** (stored in the schedules file as `kind: "trigger"`, managed by `oats trigger …`):

```json
{ "id": "okf-harvest-review", "enabled": true, "kind": "trigger",
  "on": { "source": "github.pull_request", "repo": "github.com/acme/knowledge",
          "events": ["opened", "reopened", "ready_for_review"],
          "labels": ["okf-harvest"], "base": "main", "poll": "2m" },
  "spawn": { "soul": "oats.okf/knowledge-maintainer", "purpose": "review-pr-{number}",
             "task": "Review knowledge-base PR {repo}#{number}. Load knowledge-review first.",
             "teams": ["okf"], "harness": "claude", "model": "opus" },
  "concurrency": { "max": 2, "perKey": 1 } }
```

- **Sources, v1:** `github.pull_request` only (polled with the host's `gh` auth; a laptop has no webhook). The shape is open to `github.issue`, `aweb.mail` and `okf.harvest` later.
- **Dedup and delivery:**
  - An event key (`<trigger>:<repo>#<number>:<event>:<updated_at>`) is recorded in the trigger state; each key spawns at most once.
  - The key is recorded *after* a successful spawn, so a failed spawn is retried on the next poll.
  - `perKey: 1` means one live instance per PR.
- **The event reaches the instance** as `OATS_TRIGGER_EVENT_FILE` (a JSON file in the home: `{trigger, source, repo, number, url, event, headSha, labels}`), plus the templated task.
- **Templates substitute ONLY whitelisted structured fields** (`{repo} {number} {url} {event} {headSha}`). PR titles and bodies are **never** interpolated into the task. They're untrusted data, which the soul reads from the event file and GitHub.
- **Teams:** `spawn.teams` → the spawn's `join=` (0.27.x) for the messaging provider.
- **CLI:**
  - `oats trigger add --from <package>:<template> | --file <json>`;
  - `list`, `show`, `enable`/`disable`, `remove`;
  - `test <id>` (a dry run: check gh auth, repo access and the soul's resolvability, and list what WOULD fire now);
  - `status` (the last polls, fired keys, live instances).
  - Also in `--json` and `oats capabilities` (`features: ["triggers"]`) for the Desktop.
- **Package trigger templates:** a package may declare `triggers: [{ id, file }]`; `oats trigger add --from oats.okf:harvest-review` instantiates one after asking for the repo. This is how okf ships the default.
- **Safety:** a trigger spawns only a soul that resolves in this workspace. A disabled soul refuses. The trigger runs with the host's own credentials, and there's no credential in the definition.

### 2.3a Workspace automations: triggers and schedules declared in Git (the human, 2026-09-26)

Triggers and schedules are defined at **one of two levels** (the canonical folders are `oats-triggers/` and `oats-schedules/`; any file following the contract is picked up):
- **the workspace level**, committed in any member repo and shared through Git: the default for anything a team relies on;
- **locally**, in the deployment (§2.3 as built: `oats trigger add`, `oats schedule add`): machine-private, for personal or experimental jobs.

**A human is a GitHub account** (a person or a machine user). Every workspace automation says **which machine runs it** and **which account it acts as**.

**The canonical contract:**
- **Where it lives (the human, amended):**
  - **Canonical folder:** `oats-triggers/` (and `oats-schedules/`) at a member's root. Every `*.yaml`/`*.yml` there is a candidate.
  - **Also picked up anywhere in the repo:** any file that follows the contract by name, `*.oats-trigger.yaml` / `*.oats-schedule.yaml` (`.yml` too), e.g. `services/billing/nightly.oats-schedule.yaml` beside the code it concerns.
  - **The contract is self-describing:** the file carries `kind: oats-trigger` (or `oats-schedule`) + `schemaVersion: 1`. A candidate without the right `kind` is an `E_AUTOMATION_SCHEMA` discovery problem, not silently ignored.
  - **The id** is the file's `id:`, else the filename stem (without `.oats-trigger`). Two files in one member with the same id → `E_AUTOMATION_DUPLICATE`, naming both paths.
  - **Discovery cost:** one recursive tree listing per member commit (names only, no blobs; cached per commit), then blob reads of the candidates only.
  - **Never scanned:** `oats-package/` (package templates are not workspace automations), `.git/`, `node_modules/`.
- **Discovery:** they're discovered like souls (over the remote, from CONFIRMED members only), named `<member>/<id>`, and listed by `oats workspace status` / `oats trigger list` / `oats schedule list` with `origin: { kind: "workspace", repoKey, commit }`.

```yaml
# <member>/oats-triggers/okf-harvest-review.yaml
kind: oats-trigger
schemaVersion: 1
description: Review every harvest PR on the knowledge base
from: oats.okf:harvest-review        # optional: a package template (§2.3), then overrides
set: { repo: github.com/acme/knowledge }
runsOn: kb-bot-server                # the host name (oats-local.yaml host.name) that runs it
owner: github.com/acme-kb-bot        # the GitHub account it acts as (a person or a machine user)
# …or a full definition (on/spawn/concurrency) as in §2.3, instead of from/set
```

```yaml
# <member>/oats-schedules/nightly-digest.yaml   (or anywhere: …/nightly-digest.oats-schedule.yaml)
kind: oats-schedule
schemaVersion: 1
run: spawn                           # spawn | command | wake, as today
cron: "0 7 * * *"
tz: Europe/Madrid
agent: digest-writer
task: Write the nightly digest.
runsOn: ana-laptop
owner: github.com/ana
```

**Host identity:** `oats-local.yaml` gains `host: { name: <slug> }`. It's a machine fact, never in Git.

**Who runs it:** a host runs a workspace automation ONLY when BOTH are true:
- `runsOn` equals its `host.name`;
- the host's authenticated `gh` account equals `owner` (`gh api user`, cached per tick).

**Otherwise** it's listed with the reason:
- `assigned-elsewhere` (another host);
- `owner-mismatch` (this host is named but logged in as someone else; nothing runs, and `oats trigger test` says so);
- `host-unnamed` (the host has no `host.name`).

That makes "exactly one machine" a declared fact, and **consent** explicit: a machine acts for an account only when its operator named it AND is logged in as that account. Declaring the automation in a member is the trust decision for its *definition*, like souls.

**Opting out:** `oats-local.yaml` `automations.disabled: [<member>/<id>, …]` stops a named host from running one, without a commit.

**Refresh:**
- The host tick reads a snapshot of the workspace automations taken by `oats sync`, and refreshed by the tick at most every 10 minutes.
- A definition change reaches the host within ~10 minutes; no fetch happens every minute.
- The run state (dedup keys, the last poll) stays per host and local.

**Local automations are unchanged:** machine-private, implicitly this host and its own `gh`, so no `runsOn`/`owner`. The ids are namespaced: `local/<id>` vs `<member>/<id>`.

**Safety:** everything in §2.3 still holds (the soul must resolve here; only whitelisted fields are templated; PR text is never interpolated; there's no credential in any definition).

**Schedules are the same contract as triggers** (the human, 2026-09-26):
- A workspace schedule (`oats-schedules/<id>.yaml`, or `*.oats-schedule.yaml` anywhere) carries `runsOn` + `owner` and runs ONLY on the named host logged in as that account.
- The same `assigned-elsewhere` / `owner-mismatch` / `host-unnamed` reasons, the same `automations.disabled` opt-out, the same snapshot refresh, and local schedules as `local/<id>`.
- One rule set for both kinds; the kernel implements them together.

**Desktop, Automations** (the human, 2026-09-26):
- The user sees **every workspace trigger and schedule defined in the member repos they can read**, plus their own machine's local ones.
- **Each row:**
  - the kind (trigger/schedule) and the id (`<member>/<id>` or `local/<id>`);
  - **the owner** (the GitHub account);
  - **where it runs** (`runsOn`, and whether that's THIS machine, with the reason when not);
  - **the soul** it spawns (with its origin: member/package);
  - **the prompt** (the task template, shown verbatim, with the whitelisted fields highlighted);
  - the event (a trigger's `on`) or the cron+tz (a schedule);
  - teams, harness/model, concurrency;
  - enabled/disabled here;
  - the last run/fire and the next due (for automations this machine runs).
- **Where it comes from:** the repo + path + commit of the file, linking to the file.
- **Actions:**
  - `test` (a dry run on this host);
  - disable/enable here (`automations.disabled`);
  - open the defining file;
  - for local ones: add/edit/remove.
- **Visibility follows repo access:** a member the user can't read contributes nothing (the standalone rule), so the Desktop never shows automations the user couldn't read in Git.
- **Data:** `oats trigger list --json` / `oats schedule list --json` (workspace + local, with origin, owner, runsOn, runsHere + reason, soul, task, and the last/next run). This JSON is part of PR 2b's contract, so the Desktop renders it and never re-derives it.

**Onboarding / okf:**
- The review trigger becomes a **workspace file** (`oats-triggers/okf-harvest-review.yaml` in the host repo, `from: oats.okf:harvest-review`, with `runsOn` + `owner` naming the merge-capable host and account).
- `oats trigger add --from … --workspace <member>` writes it (or prints it when that repo isn't the current checkout).
- `oats trigger test <member>/<id>` runs on the named host. This supersedes "install on ONE host" by hand.

**Delivery:**
- **PR 2b (kernel):** after #205. Discovery + the host identity + the owner/host matching + the snapshot + the CLI/JSON + docs.
- The target is **0.29.0**, released with okf 4.0.0, whose `okf-trigger-setup` teaches the workspace form first. The floor becomes `oats >= 0.29.0`.
- 0.28.0 ships the local triggers (#205) as the mechanism.

### 2.4 The harvester and the maintainer (oats.okf 4.0.0)

**`knowledge-harvester` soul** (a package soul; `work: directory`; `team: okf`; `knowledge: none`, so there's no recursive harvest; capability `oats.okf-harvest`).
1. okf's `run-source` job captures custody (unchanged) and **spawns the harvester soul** (not a capability agent) with the frozen input, joining `okf`.
2. **Reads the input fully:** notes AND the **transcript windows**. This is mandatory, and the judgment receipt must cite the turn ids it relied on.
   - It also extracts **task references** (ticket ids/URLs seen in the transcript, notes and the source's `instance.json` tasks provider).
3. Judges with `knowledge-theory`; stages edits on the owned nodes; `complete` opens the PR:
   - label `okf-harvest`;
   - a **provenance block** in the body: a fenced `okf-harvest` JSON block, `{ run, input, source: { soul, soulId, instance, ownedNodes, readNodes, bases }, tasks: { provider, refs[] }, harvester: { instance, alias } }`.
4. **Stays alive** (idle; woken by messages in `okf`):
   - It answers the maintainer's questions and pushes amendments on request.
   - It retires on **merged/closed** (the maintainer's message, or its own PR check on each wake).
   - A **max-age** (the setting `harvester-max-age`, default 7d) retires it after telling the team. It never closes the PR itself.

**The harvest switch (lead decision, 2026-09-26; L2 implements it):**
- **A setting, not a job toggle:** `harvest: on|off` for oats.okf, **default `off`**.
- **Where it's set:**
  - Deployment-wide, in `oats-local.yaml` `settings.oats.okf.harvest` (a machine fact: the operator decides whether this host harvests).
  - Per soul, as the opt-out: `soul.yaml` `knowledge: { harvest: off }`.
  - **Effective = on only if the deployment says `on` AND the soul does not say `off`.** A soul's `off` cannot be overridden by the host. This deliberately departs from the usual later-wins merge, and L2 must implement it explicitly.
- **When it's off:** the spawn hook registers no source, and no capture or custody happens. Private transcripts are never accumulated "for later", and nothing drains when the switch flips; harvest starts from the next session. The per-source `run-source` job exists only when harvest is effectively on.
- **The verbs:**
  - `oats okf setup --harvest on|off` writes the local setting (else it prints the line to add);
  - `oats okf harvest-status [--soul X]` reports the effective value and why (the deployment/soul row), plus the registered sources.
  - `oats schedule enable|disable <job>` remains the per-source emergency brake, not the switch.
- **The review trigger is independent of the switch:** a trigger host can review PRs from other hosts' harvesters without harvesting itself.

**`knowledge-maintainer` soul** (a package soul; `work: directory`; `team: okf`; `knowledge: none` in v1; capabilities `oats.okf-maintenance` + the workspace's tasks slot, **read-only use**).
1. Spawned by the trigger, one per PR. It reads `OATS_TRIGGER_EVENT_FILE`, clones/fetches the KB repo and `gh pr checkout`s the PR in its `./work`.
2. **Situates** the addition:
   - the provenance → the source soul's owned/read nodes at the accepted base;
   - the whole node index and neighbouring concepts (duplicates, supersession candidates, the canonical home);
   - the source soul's other knowledge.
3. **Tasks:** if the provenance names a tasks provider and refs, it reads those tickets through its own tasks capability (when the workspace's tasks slot matches). Otherwise it notes "tasks unavailable" in the verdict. This is never a blocker.
4. **Verdict** (recorded as a PR review comment, as structured JSON + prose):
   - `merge`;
   - `amend+merge` (it pushes commits to the PR branch: fixes, supersession edits in other concepts of the same base, index/log);
   - `request-changes` (it messages the harvester in `okf`; waits bounded);
   - `close` (with the reason).
   - The doctrine's two-part test, one canonical home, explicit supersession, and provenance are all checked.
5. **Human-accepted decisions are never superseded silently.** If a PR would supersede a concept with human acceptance evidence, the maintainer does not merge. It labels `okf-needs-human` and messages the workspace's human channel.
6. Merges with the host's `gh` (squash); notifies the harvester (`merged`/`closed`); self-retires.

**GitHub credentials:** the maintainer's host must be able to **merge** on the KB repo. `okf-trigger-setup` and `oats trigger test` verify it (`gh api repos/{repo} --jq .permissions`). **If the harvester and maintainer use the same GitHub account, GitHub forbids self-approval.** The skill says so: either use a separate reviewer account/bot on the maintainer's host, or rely on merge permissions without required approvals on the KB repo's `main`.

### 2.5 The working-soul inject (oats.okf 4.0.0)

It extends the 3.0.0 inject into a *work mode*:
- **At task start and after compaction:** read instance memory (`STATE.md`, recent `log.md`, relevant `notes/`), then consult soul knowledge (`oats okf index`, then `cat` what's relevant).
- **Before compaction:** update `STATE.md`/`log.md`/`notes/` first.
- **Every so often while working, and always before a design decision or re-deriving something:** `oats okf search`/`cat`, and re-read your own notes.
- Use both to situate the task and stay coherent with the soul's accepted decisions. Cite what you relied on.
- **Capture with judgment** (§2.5a). The harvester still decides what is *promoted*. Never write accepted knowledge.

### 2.5a Instance-knowledge judgment (the human, 2026-09-26)

`okf-instance-knowledge` teaches **what useful instance knowledge is**, not only where to put it. This replaces "capture without judging importance" in today's inject. The **capture bar** is lower than the **promotion bar** (`knowledge-theory`), and they don't compete.

- **The capture test:** *would my future self after compaction, or the harvester judging this session, decide or act better for having it, and is it absent from the code, the tracker and the repo docs?*
- **Capture:**
  - decisions taken, and **why**;
  - alternatives rejected, and why;
  - discoveries that cost effort;
  - limitations and the workaround that worked;
  - conclusions of an investigation (not its transcript);
  - blockers, with what unblocks them;
  - human direction and corrections, as the instance understood them;
  - surprises (the world behaved differently from what the soul's knowledge says: a *candidate supersession*, flagged as such);
  - process and environment lessons.
- **Don't capture:**
  - descriptions of the code, and maps of the repo;
  - command logs and tool output;
  - retries that taught nothing;
  - secrets;
  - third-party messages verbatim;
  - things already in the tracker or the docs (link instead).
- **Form:**
  - `STATE.md` = the current task picture (rewritten);
  - `log.md` = dated events (append-only);
  - `notes/` = **one concept per insight**, with type (Decision / Rejected / Discovery / Limitation / Conclusion / Lesson / Blocker), a one-line claim, the *why*, the evidence and provenance (what was observed, when, from what), and its **generality** (instance-only vs likely true for the soul, a hint to the harvester, not a verdict).
- **Timing:** capture as it happens, at the decision, not reconstructed at the end; update before compaction and before task boundaries.
- **Relation to soul knowledge:** consult first; a note that confirms, refines or contradicts an existing concept cites it (`alias/node/concept.md@oid`). That is what lets the harvester situate it.
- **The theory it teaches in brief:** decision vs description (descriptions drift and lie; decisions are superseded explicitly), code is truth about code, and indexical residue dies with the instance. This is a short version of `knowledge-theory`, taught from the capture side. **Working souls do NOT get the full promotion doctrine**, so there's no duplicate judge.

### 2.6 The `okf` team

- Onboarding (the oats.framework `oats-onboarding` skill + okf's `okf-trigger-setup`) adds `teams: { okf: { description: Knowledge operations } }` and the `messaging.byTeam.okf` mapping.
- The package souls carry `team: okf`. A workspace that does not declare `okf` gets the `E_TEAM_UNKNOWN` discovery problem on them (listed with the remedy; as for member souls it's not a spawn refusal, but their instances then land in no messaging team, so harvester↔maintainer talk fails). So onboarding must add it, and `oats trigger test` checks it.
- The label organises and gates nothing (the teams contract).

## 3. Delivery plan

**Order:** 3.0.0 (in flight) → kernel 0.28.0 contracts (C1, C2) frozen → the three lanes in parallel → okf 4.0.0 → the 0.28.0 release with the mirror + pin + onboarding.

**Contracts frozen first** (in this doc, by the lead; the co-lead ACKs):
- **C1, package souls:** §2.2.
- **C2, triggers:** §2.3 (the definition, the event file, the dedup, the CLI).
- **C3, the harvest provenance block:** §2.4.3.
- **C4, the okf-team messages:** `question`/`amend-request`/`amended`/`merged`/`closed` (a subject prefix `okf:` + a PR URL). This is prose-level and is owned by the skills.

**L1, kernel.** A **Claude kernel developer** (`cli-dev`, a new instance, Opus), in a worktree. Three PRs, each Class B, reviewed by the lead:
1. **Package souls** (C1): discovery, resolution, spawn by name, status/Desktop JSON `origin: package`, `oats capabilities` feature `package-souls`.
2. **Triggers** (C2): `kind: "trigger"`, `github.pull_request` polling in the host tick, dedup state, `OATS_TRIGGER_EVENT_FILE`, `oats trigger …`, package trigger templates, feature `triggers`.
3. **Remove capability agents** (after okf 4.0.0 is mirrored): `agents:` in manifests is refused with a remedy naming package souls.

Gates:
- test-first;
- scaffold-only probes;
- a real `gh` poll against a scratch repo in the PR's evidence;
- the full glob + `smoke:tarball` (kernel dev).

**L2, okf** (oats-okf; **the okf expert**, a new `integrations-expert` instance, or the 3.0.0 child continuing once 3.0.0 is tagged, lead's pick; the co-lead reviews and tags):
- the three capabilities (§2.1);
- the skill rework:
  - rename memory-harvest → knowledge-theory;
  - new knowledge-harvest, knowledge-review, okf-instance-knowledge, okf-trigger-setup;
  - okf → okf-authoring;
- the two package souls;
- the trigger template `harvest-review`;
- the harvester lifecycle (spawn as a soul, stay alive, retire on merge);
- the provenance block (C3);
- the inject (§2.5);
- the identical-copy test;
- no symlinks.

Gate: **a real end-to-end run** against a scratch KB repo: a source is harvested → the PR opens with provenance → the trigger spawns the maintainer → it amends + merges → the harvester retires. Every step is read back. It requires kernel ≥ 0.28.0.

**L3, onboarding** (oats.framework `oats-setup`; **the Phase D driver** `oats-expert-phase-d`):
- `oats-onboarding` gains "Knowledge operations with OKF":
  - the package pin;
  - the `okf` team + mapping;
  - where to install the trigger (a host with merge-capable credentials; `oats trigger add --from oats.okf:harvest-review`; `oats trigger test`);
  - harvest stays opt-in.
- `docs/knowledge.md`, `docs/schedules.md` (triggers) and `docs/packages.md` (package souls) get updated.
- A framework 1.2.0 PR.

**L4, Desktop (later):** a Triggers section under the deployment (list, status, test, enable/disable), and package souls on the Souls page with their package origin.

**Review:**
- The lead reviews L1 and L3 and cross-reviews L2.
- The co-lead reviews and tags L2 and cross-reviews L1.
- The release: 0.28.0 = L1 + the L2 mirror/pin + L3 pin.

## 4. Decisions taken (lead, delegated authority), revisit on request

1. **Package souls, not `external:`**, for "sourced from the okf package". One pin versions everything.
2. **Triggers are schedules of `kind: trigger`**: the same store, tick and spawn path. There's no daemon and no webhook in v1.
3. **The harvester becomes a package soul** (it needs messaging + a lifetime past its PR). Capability agents are removed after okf 4.0.0.
4. **The maintainer merges autonomously** when the doctrine passes, **except** where it would supersede a human-accepted decision (`okf-needs-human`).
5. **The harvester and the maintainer hold no knowledge slot in v1** (no recursive harvest). Revisit when a maintainer's own lessons are wanted.
6. **okf 3.0.0 is not widened.** The working-soul skill split lands in 4.0.0 with the new capabilities. Removing `memory-harvest` from oats.okf before the harvester has another home would break harvest.
7. **Harvest stays OFF on the development deployment** until 0.28.0 + okf 4.0.0 pass the end-to-end gate.

## 5. Open questions

- The maintainer's `work` mode: `directory` + `gh pr checkout` (planned) vs a registered KB clone in worktree mode. The L2 implementer confirms in the first PR.
- Multi-base PRs: v1 keeps one base per PR (today's delivery). The maintainer's cross-base supersession is out of scope.
- `aweb.mail` as a trigger source (e.g. "on a mail to `okf-review`") is left for after v1.
