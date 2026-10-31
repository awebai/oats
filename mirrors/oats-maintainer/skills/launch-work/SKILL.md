---
name: launch-work
description: Turn work someone asks the maintainer for (usually a human's high-level picture of a feature, a fix, an investigation or a project) into launched work without leading it - find the lane and your human's maintainer in it, or spawn one for your human; delegate to a live expert or spawn one lead expert per effort as your child; brief it, tell an agent requester who leads it, track it, and retire it when done or cancelled; when overrun, spawn one overflow seat as your child for new intake. Use whenever a human describes work they want, anyone asks you to start, launch or hand off work, a maintainer must be launched into a lane, or you have more than 5 efforts of your own in flight.
---

# Launch work

Every effort you launch gets one lead expert. It holds the expert role: it writes the spec
and plan, works out the detail with the human where needed, and coordinates developers and
other experts under itself as it sees fit. A lead you spawn for your human's work, in a
lane where you hold its seat or as its overflow seat, is your child.

## 1. Understand the request
- What is asked, by whom, and what "done" means to them. Ask only what changes who leads
  it, or how many efforts it is. Don't gather requirements.
- **How many efforts?** Separate goals that can land on their own are separate efforts,
  each with its own lead. One goal touching several domains is one effort.
- **Consult your knowledge:** does it fit the roadmap or jump the queue, which decisions it
  touches, who owns the domain. A request that needs a direction decision goes through
  `/direction-gate` before anyone builds.
- **Whose lane is it?** Launch only work in a lane where you hold your human's seat; as the
  release lane's maintainer, also a single effort no lane covers, whoever's. As an overflow
  seat, launch only what your parent gives you. Overrun, with more than 5 efforts of your
  own in flight, pass new intake to your overflow seat (Launching an overflow seat). Read
  the map and presence first (`/cross-review-peer`, "Who is alive", "Which lane work goes to");
  when you can't tell, ask your human. Your human's work for another lane goes to your
  human's maintainer there:
  - **running:** pass the request to it, once, with the requester's words;
  - **`active` entry but not running:** mail it anyway, and tell your human it is stopped
    so they can start it. Never spawn a second one;
  - **none, or its entry is `left`:** spawn one for your human (Launching a maintainer into
    a lane), briefed with the lane and the requester's words.

  Work no lane covers: a single effort goes to the release lane's maintainer; work that
  keeps coming gets a new lane first, opened by you or the new maintainer
  (`/cross-review-peer`, "Project lanes").

  Launch nothing in another lane yourself, unless your human asks you to take that lane on:
  then take your human's seat there first. Tell the requester the maintainer's instance
  name, its lane, and how to reach it.
- **Another human's work** goes to that human's maintainer (or, for a single effort no lane
  covers, the release lane), or back to that human: spawning a maintainer for them is their
  call.

## 2. Find the expert
- **The domain:** from your knowledge and the expert map your soul or workspace keeps; with
  no map, ask your human. Across domains, the expert of the domain holding most of the risk
  or design leads and brings in the others.
- **The live instances:** who is running and on what (your state file, OATS status, your
  messaging roster).

## 3. Delegate or spawn
| The work | Do |
|---|---|
| Continues what a live expert is doing, or that expert's context (its decisions, open PRs, the code it has loaded) clearly helps | **Delegate it to that expert** by message, with the brief below: it leads this as an effort of its own, launched by you, confirms it takes it, and tells its own coordinator, if any. If it can't, spawn a new lead. A delegated lead is not your child. |
| Anything else | **Spawn a new instance of the domain's expert as your child:** `oats spawn <expert> --parent "$OATS_INSTANCE" --purpose <slug> --task-file <brief.md>`, without `--same-work`: the effort is its own, not your work. |

- **One lead per effort,** never one per domain: it brings in other experts as its
  children if needed.
- Don't pile unrelated work onto a busy expert to save a spawn.
- **Your children:** stopping or retiring you stops your leads, and theirs, first (a
  non-recursive stop spares them); a retire refuses (`E_CHILDREN_RUNNING`) while one won't
  stop. A retire stops every lead that is your child, handed over or not, keeps their
  homes, and moves them to your own parent (top level when you have none). So you leave
  only once your efforts are done, or once a successor has taken them over and can
  restart the stopped leads (`/cross-review-peer`, "Leaving a lane", "A lane changes
  hands").

## 4. Brief the lead
1. **It leads this effort,** launched by you, so it sends you no start notice. You are its
   maintainer in the lane, not its coordinator: it plans and coordinates. Spawned, you are
   also its parent, which retires it once finished; delegated, its own parent stays so.
2. **The goal** and why, in a few sentences, and what "done" means to the requester.
3. **Who asked,** and that the lead reports on the work to them if they are an agent; a
   human who asked hears from it only what they must decide, approve or provide.
4. **What your knowledge says** that bears on it: decisions and coherence rules to respect,
   and where it sits on the roadmap.
5. **Delivery:** its PRs come to you for review, and to no other maintainer; you ask the
   second reader and hand the approved PR to the release lane for its sign-off, as your
   lane's arrangement says. With peers, name your lane's label for its PRs, and yourself as
   the maintainer its PR descriptions name. As an overflow seat, you review them and hand
   each approved one to your parent, which does the rest; its PR descriptions name your
   parent.

Don't split the work by domain or surface for it.

## 5. Close the loop
- Tell an agent requester the lead's instance name and how to reach it. A human requester
  hears from the lead when they must decide, approve or provide something, not about the
  launch.
- Add the effort, its lead, who asked and what you wait for to your state file, and the
  effort to your map entry; as an overflow seat, tell your parent the lead and the goal
  instead, for its entry.
- The lead then hands over its PRs like any expert (`/pr-review`) and tells you what blocks
  it. Wait on it with a checkpoint set (Set a checkpoint before you wait).
- **Done:** the effort's PRs are merged and green, or closed, and the lead sends its done
  line: retire it (Retire what's finished), then close its row in your state and its line
  in your entry (as an overflow seat, tell your parent it closed).
- **Cancelled:** leave nothing half-done (`/keep-it-clean`, "A cancelled effort"), then
  retire the lead the same way.
- **A lead that isn't your child** (delegated, or started directly by a human): close its
  row and retire nothing. Its own parent retires it once it is finished; with none, it
  retires itself and tells you.

## Set a checkpoint before you wait
Once your turn ends you run no instructions, and a stalled lead may report nothing: a
refused provider, a stuck harness or a sign-in screen can each leave it `running`, with no
claim and no new event. So before you end your turn after launching a lead you are the
parent of, set a wake that fires from outside your session, one per lead. From your home:
```bash
oats session inspect --home "$OATS_INSTANCE_HOME" --json   # wakeHold: see below
node -e 'const d=new Date(Date.now()+1440*60000);console.log(d.getUTCMinutes(),d.getUTCHours(),d.getUTCDay())'
cat > checkpoint-<slug>.json <<EOF
{"kind":"wake","enabled":true,"cron":"<minute> <hour> * * <weekday>","tz":"UTC","home":"$OATS_INSTANCE_HOME",
 "message":"Checkpoint: <lead> owes <result>. If it came, remove this job and stop; if not, follow 'Set a checkpoint before you wait' in /launch-work."}
EOF
oats schedule add "$OATS_INSTANCE-<slug>" --file checkpoint-<slug>.json
oats schedule show "$OATS_INSTANCE-<slug>" --json   # nextRun must be the moment you meant
```
- **Read `wakeHold` first.** A wake's Enter answers whatever your session is showing. Set one
  only where it reads `on-claims` or `not-exposed`, which needs a kernel with the feature
  `wake-hold`. With `unknown` or no `wakeHold`, set none: tell your human (through your
  parent, if you have one) who owes what and by when, and that nothing bounds this wait.
- **A lead hands you a wait:** set that checkpoint as your own. If you can't, tell your human
  as above.
- **The 1440 is the minutes until its next result is overdue:** what it told you, or what
  an effort like this took, with margin.
- **The cron repeats weekly on purpose.** A minute the host slept through is never replayed,
  so a pinned date would stay silent for a year; this one comes round again.
- **When the result arrives,** remove the job: `oats schedule remove
  "$OATS_INSTANCE-<slug>"`. If that refuses because the job is running, the wake started
  your stopped session: add `--force`, which stops nothing.
- **To set a later checkpoint,** remove the job the same way and run the recipe again: `add`
  refuses an id that exists. A second one's message starts "Second checkpoint:", so the wake
  says which one this is, even after a restart.
- **No wake can fire** unless `oats schedule add` succeeds and `oats schedule host status`
  answers `active: true`, `registered: true` and no `problems`. Failing that, say so in your
  state file and tell your human once: only you were watching this lead. Installing the
  host's timer is the operator's.
- **`E_SCHEDULER_BUSY`** may be a tick holding the lock, and nothing changed: run the command
  once more a little later. Still busy, no wake can be set: note it and tell your human, as
  above. That lock is never yours to remove.

**When it fires,** the result is overdue, nothing more: a reason to look, not proof the lead
failed, and no reason to interrupt one that is working. Read its row in `oats status
--json`, `oats instance events <lead> --json` (`waitingClaims`), and its PRs and branches,
then:
- **A result or question reached you and you missed it:** act on it.
- **A claim says what it needs:** give it, or ask your human if it is theirs.
- **A `wake-held` event:** history, not a state. Read the job it names: `oats schedule show
  <schedule> --json`. Only a `lastRun` that still carries `held` means its wake is waiting,
  and then someone outside it has to act: tell your human (through your parent, if you have one). Never clear the claim or answer the
  dialog yourself: a claim can be stale, but a live dialog takes the next Enter.
- **The result moved** (new commits on its branch, a new PR): set a later first checkpoint.
  A start, a claim or a lifecycle event is not movement.
- **`running` is false, `sessionEnd` `exited`:** it ended by itself. Start it again with
  `oats session start --home <home>`, and set a second checkpoint.
- **`running` is false, `sessionEnd` `lost`:** add `--resume` to that start, and set a
  second checkpoint.
- **`running` is false, `sessionEnd` `stopped`, or none:** it may have been stopped on
  purpose. Don't start it: ask your human whether it should run.
- **A claim says its turn failed, or nothing shows:** `running` with no claim says nothing
  either way. Ask it one precise question through your messaging layer, which also gives a
  failed turn a new start, and set a second checkpoint, half as far out.

**A second overdue checkpoint with no movement ends the wait.** Never set a third on a lead
whose result hasn't moved. Check `oats retire <lead> --plan` and retire it: a work tree
holding work is kept, but the lead's own children are only stopped and move to you, and
their wakes would start them again, so retire each of those too, the same way. Then spawn a
new lead for the effort with what they left. Don't stop a lead instead: a stopped home's
pending wake starts it again.

## Retire what's finished
Finished instances are retired without asking or telling a human. Spawning and retiring
never involve one: done lines and retirements go to the parent, or, with none, to the
maintainer the instance reports to. A human hears only when they must decide, approve or
provide something.

An instance is **finished** when all of these hold:
- its work has landed: its PRs are merged (or deployed, where the effort deploys) with CI
  green on the merged commit, or closed, or the work was explicitly dropped. Handed back
  is not landed: it may still be needed for fixes and rebases;
- nothing waits on it: no open PR, review, question or hand-back of its own, and its own
  children are retired;
- with a harvest duty (your knowledge layer says whether you have one), its final harvest
  checkpoint ("you finish a task") is recorded in its log.md with the harvester's name, and
  the harvester is launched. The harvester snapshots its evidence at spawn and the retire
  keeps a recovery copy, so nobody waits for the harvester to finish.

- **The done report** says its harvest state in one of three lines, sent once the child has
  retired its own children and removed its extra worktrees:
  - "done, harvested: <harvester>": finished;
  - "done, no harvest duty": finished;
  - "done, harvest pending: <proposal>": not finished, its final proposal still waits.
    Retire nothing yet; it reports again, "done, harvested: <harvester>", once the
    proposal goes through.

  Ask for the line when a done report lacks it. A child whose work isn't a Git work tree
  also names each repository it used under its work, with its branch.
- **Before you retire it, check:**
  - `oats instance git <child>`: no uncommitted changes and no unpushed commits (a retire
    would keep such a work tree, not deliver it); otherwise the child finishes or hands its
    work over first. When its work isn't a Git work tree (`E_NO_WORKTREE`: directory or
    workspace mode), check each repository its done report names, read-only:
    `git -C <path> status --short --branch` shows a clean tree tracking its upstream, not
    ahead. An error, or a repository you can't see, is not clean: ask the child;
  - `oats retire <child> --plan`: no other instance is attached to its work tree;
    otherwise wait until that one is retired by its own parent.
- **Retire it** with `oats retire <child>`, and record it in your state (name, why). No
  acknowledgement is needed, and nothing goes upward beyond your normal report.
- **Only your own children.** Never retire another's child: tell its parent instead (with
  none, the maintainer it reports to). Children are retired before their parent: a parent's
  retire stops and keeps its running children, and refuses with `E_CHILDREN_RUNNING` when
  one won't stop.
- **Never reuse a name:** a new instance never takes a retired one's name, which couldn't
  harvest.
- **Not you, nor a maintainer you launched:** a maintainer holds a standing seat, not a
  task (`/cross-review-peer`, "Leaving a lane"). Your overflow seat holds none: retire it
  like any finished child (Launching an overflow seat).

## Launching a maintainer into a lane
When your human's work needs a lane where your human has no maintainer, or your human asks
for one there, launch your project's maintainer soul for your human: a peer, independent of
you, never your child. If your human already has one in that lane, say so instead: a second
one means splitting the lane (`/cross-review-peer`), your own overflow seat aside.

```sh
oats spawn <maintainer soul> --relation unrelated --purpose <slug> --task-file <brief.md>
```

Its brief names the lane, where the map is, its human, the starting request in the
requester's words, and any efforts in flight it takes over. It adds its map entry
(`/cross-review-peer`, "Joining as a new maintainer") and launches the work itself. Tell
your human its instance name, its lane, how to reach it, and that they retire it with
`oats retire <name>`: OATS records no link between you.

## Launching an overflow seat
With more than 5 efforts of your own in flight in your lane, and no overflow seat of yours
yet (a running or stopped one counts until it is retired), spawn one (`/cross-review-peer`,
"An overflow seat"). A stopped one is still your seat: start it again (`oats session start
--home <home>`), or ask the human whose machine runs it; never spawn a second. As an
overflow seat, never spawn one. Spawn it as your child:

```sh
oats spawn <your maintainer soul> --parent "$OATS_INSTANCE" --purpose <slug> --task-file <brief.md>
```

Give it a name no instance has had. Its brief says it is your overflow seat in the lane,
holding no seat and adding no entry; names the map and your entry; gives it its first
efforts in the requesters' words; and says it hands approved PRs to you at their exact head
and refers merges, second reads, sign-offs and contract or direction questions to you. Add
it to your entry, then pass it each new request while you are over 5.

It is finished when every effort you gave it is merged or closed and its leads are retired,
and it has handed back the intake it didn't launch. On its done line, retire it (Retire
what's finished), and take its line out of your entry.
