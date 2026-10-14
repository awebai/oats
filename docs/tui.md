# OATS TUI (preview)

`oats tui` is the OATS terminal client: one full-screen, keyboard-only program
for people who work in terminals and on machines with no display, such as a
build host reached over ssh. The [OATS Desktop](desktop.md) is the client for
people who want a window; `oats tui` is the same kind of client for a
terminal. It ships inside the `oats` package: there is nothing else to
install.

## It is a preview

`oats tui` is marked **preview**. That means:

- **This version shows a workspace's instances, on this machine and on the
  other machines registered on this machine, in one list, opens an agent's
  terminal, and stops, starts, restarts and retires an agent after a
  confirmation.** The registered machines are the ones `oats server list`
  names. It follows the instances as they start, stop and wait for you. It
  cannot spawn an agent, start one with another harness or model, or add,
  check or remove a machine: [what it does not do
  yet](#what-this-version-does-not-do) names the `oats` command for each.
- **Its screens and its configuration file may change without notice** while
  it is a preview.
- **It leaves preview when three things hold:** the readers it shares with
  the Desktop are in their shared home (`packages/client/`), a person has
  used it for a working day, and both maintainers agree to drop the mark.

Every other `oats` word keeps its contract. Nothing gates on `oats tui`:
`oats version --json` lists no feature for it.

## Start it

```bash
oats tui                  # in or under a deployment, in a terminal of 80x24 or more
oats tui --dir <path>     # the deployment at or above <path>
oats tui --ascii          # rules and marks in ASCII, whatever the locale
oats tui --help           # the usage; needs no terminal
```

**Which deployment.** It starts from `--dir` (also `--dir=<path>`), else
from the directory you are in, and walks up to the first directory that
holds a regular `oats-local.yaml`. That directory is the deployment, and
the view it opens is that deployment's workspace: its instances on this
machine and on every registered machine that reports the same workspace.
Another deployment is opened from [the switcher](#the-switcher), in the
same run.

**Outside every deployment.** Started with no `--dir` in a directory that
is in no deployment, it looks directly inside `~/Agents`. When a deployment
is there it starts with the switcher, and nothing is open until you open a
row. When none is there it prints one line (`E_NO_DEPLOYMENT`) and exits 1
without touching the terminal. With `--dir`, nothing is offered in place of
a path that is in no deployment: the same line, and exit 1.

**From inside an agent's pane it still reads the deployment you asked
for.** An instance session carries variables that make a kernel command
answer for that instance (`OATS_INSTANCE_HOME` and seven others).
`oats tui` removes all eight from its own environment before it starts
anything. Two of them, `OATS_RESOLUTION` and `OATS_DEPLOYMENT`, are set only
in a home captured before OATS 0.26: there `oats` refuses every command but
`version`, this one included, with a line that names the variable and says
what to do.

It needs a terminal on both stdin and stdout, and a `TERM` that is set and is
not `dumb`. It draws from 60×15 up; on a smaller terminal it shows one line
with the size found and the size needed, and draws the view again, as it
was, as soon as the terminal is large enough. It follows a resize.

`--dir`, `--ascii` and `--help` are the only arguments. `--server` is
refused like any other argument (`E_BAD_ARGS`): no machine is named at the
start. It reads every machine registered on this machine.

**Start it again after you upgrade OATS.** It asks the kernel it shipped
with for its version once, at the start, and does not ask again while it
runs.

## What it shows

```
 oats  acme-platform  +1 machine                            4 running  1 needs input  2 stopped
 1 Instances   2 Souls   3 Capabilities                                           read 14:03:27
──────────────────────────────────────────────┬─────────────────────────────────────────────────
 This machine                                 │   api-lead
 ▾ ● backend-lead                 claude      │   soul     tech-lead
     ● backend-dev-auth           claude     !│   machine  garnet
                                              │   state    running
   ○ docs-writer                  stopped     │   harness  claude, claude-opus-5-5 (soul)
 garnet                         read 14:03:21 │   work     worktree, agents/api-lead
>▾ ● api-lead                     claude      │   home     …agents/tech-lead/instances/api-lead
     ● api-dev-export             claude      │
                                              │
   ○ reviewer-api                 stopped     │
──────────────────────────────────────────────┴─────────────────────────────────────────────────
 / filter   Tab detail   r refresh   w workspaces   ? help   q quit
```

- **The header** has the workspace's name, then what the view holds of
  other machines, then the counts. Beside a deployment of this machine the
  other machines are counted: `+1 machine`, `+2 machines`. A view that holds
  no deployment of this machine names its one machine, `on garnet`, or
  counts them when there are two or more, `2 machines`. The counts are over
  every row of the view: instances running, instances that need input,
  stopped, state unknown, and rows the kernel reported that were withheld (a
  home outside its soul's directory, or one reported twice). A count of zero
  is left out. The second row names the views; `2 Souls` and
  `3 Capabilities` are dim because they cannot be opened yet. On the right
  is the time of the read of this machine that the screen shows: it moves
  with every read.
- **The list** is the roster the Desktop draws: the same groups in the same
  order, from the same code. An instance that others were spawned from
  comes first, and the ones below it are indented under it; instances
  related to no other follow, after an empty row.
- **Each row** has a mark for its state, the name, then the harness when it
  runs, else its state in a word, then `!` when it needs input.
- **The detail** shows the selected instance: its soul, its state, and
  under it the reason when there is one, after the words that say who gave
  it: `OATS says:` for a kernel (this machine's, or the instance's
  machine's as this machine's kernel relayed it),
  `oats tui's terminal check says:` for the check of the terminals, and
  `oats tui's read of other machines says:` for the read of the other
  machines. Three reasons stand without such words. The sentence about a
  session backend OATS no longer has, when the instance's kernel is too old
  to give its own, stands as it is. A reason whose speaker is not known is
  shown in quotation marks, and names nobody. A reason that is withheld is
  `[withheld]` alone. Then it shows what it needs from you with how long
  it has waited and its own message, harness and model, work mode and
  branch, team, parent, when it last started, and its home. From 80
  columns up it stands beside the list; on a narrower terminal `Tab` opens
  it as a page.
- **Opening an agent.** `Enter` on an instance that runs gives your terminal
  to that agent's own terminal, through `oats session attach`: you see what
  the agent shows, and what you type goes to it. `Ctrl+\` brings `oats tui`
  back, and the agent keeps running. The key is yours to change
  ([`tui.json`](#change-the-keys-tuijson)), and the footer names it whenever
  `Enter` would open.
  - Inside tmux the agent opens in the same pane. `oats tui` makes no window
    and no split.
  - After the return the instances are read again at once, and one line
    says what happened: that you left and the agent keeps running, that it
    could not be opened, or that the connection to its machine ended. When
    the agent's own terminal ended while you were in it, you are back with
    no line: the list shows the agent as it now is.
  - What `oats session attach` printed when it failed stands under that line
    in quotation marks. It is not said who printed it: OATS, tmux and ssh
    all can.
  - `Enter` on an instance that cannot be opened opens nothing and says why:
    it does not run, whether it runs is not known, the detail's reason holds
    it, or its machine's OATS is older than 0.51.0 and has no key to leave a
    viewer.
  - For each time you open an agent, one line of tmux's own stays on your
    screen and is there after you quit: `[detached (from session …)]`, or
    `[exited]`.

**A view of more than one deployment** (this machine and another, or two
deployments on one machine) is one list, grouped as the Desktop groups it:

- **Each deployment has a heading**, and its instances stand under it,
  grouped as above. The heading is `This machine` or the machine's name,
  with the end of the deployment's path when one machine holds two of the
  view. A heading cannot be selected or folded: the movement keys pass over
  it. A view of one deployment has no heading.
- **A machine that answered carries the time its rows were read** on its
  heading, at the right: `read 14:03:21`. A row of another machine shows
  what its host reported at that time.
- **A deployment that is not live carries its state and a short reason**
  on its heading, and no time: `garnet  remembered  Not reached`. The rows
  a machine last reported are kept when it is not reached, and each of them
  reads `unknown`, with the `?` mark, in the list and in the detail:
  nothing reads as stopped, or as running, that is only not reached.
- **A deployment that is not live and has no rows** is named after the
  others: the machine, the deployment's path, its state and the short
  reason on one row, and the whole reason on the rows under it.
- **A deployment's note** is a sentence of the shared rules about that
  deployment, such as `garnet now reports workspace other.` for a machine
  that reported another workspace before, or that a deployment's teams are
  local only. It stands under the deployment's heading. In a view of one
  deployment, which has no heading, it stands above the list.
- **The detail has a `machine` line**, the machine the selected instance is
  on. When that deployment is not live, the whole sentence that says why
  follows it.

**A view that holds no deployment of this machine** says so in its header:
`oats  other  on garnet` for one machine, `2 machines` after the name for
two or more. The time in the header is then the time the machines' rows
were read. A view of one machine has no heading, so its state, when it is
not live, is said above the list with the reason, as for a deployment of
this machine. When no row of that machine is kept either, nothing is drawn
under the reason: no list and no detail.

**A machine that has not answered in this run is not in its workspace's
list.** `oats tui` keeps nothing on disk, so it cannot tell which workspace
a machine belongs to before the machine has said so in this run. Such a
machine is listed in [the switcher](#the-switcher) by its own name, under
`Not matched to a workspace`. The OATS Desktop, which remembers what each
machine last reported, can place it. Once a machine has answered, it stays
in its workspace for the rest of the run, also while it is not reached.

| Mark | ASCII | Means |
|---|---|---|
| `●` | `*` | running |
| `○` | `-` | stopped |
| `◌` | `~` | stopped, with a shell left in its terminal |
| `?` | `?` | state unknown: the kernel or the terminal probe could not tell, or the instance's machine was not reached |
| `◆` | `#` | held by a spawn or a retire that is not finished |
| `▾` `▸` | `v` `>` | has instances below it: shown, folded away |
| `!` | `!` | needs input |
| `!N` | `!N` | N instances folded away below it need input |
| `>` | `>` | the selected row (also drawn in reverse video), and the pane the movement keys act on |
| `*` | `*` | in the switcher: the workspace that is open |

Every state has a mark of its own shape, so nothing is told by colour alone.

**When a read fails,** what the view then shows is one rule, shared with the
Desktop, and `oats tui` decides none of it. Depending on the failure the
last rows stay as they were; or they stay and are marked `stale`, with the
time of the last read that succeeded (a remote that could not be read
again); or the
deployment is `not observed` and no row is drawn. A state that is not live
is said in words above the list, with the reason on rows of its own. When
the kernel refused the read and no rows are kept, the reason says so and
quotes it: `OATS answered with an error (<code>). It says: <message>`. When
the last rows are kept as `stale`, the reason says so and then quotes the
kernel:
`This deployment's last read failed. It shows what was last observed. OATS says: <message>`.
Any other reason is the reader's own sentence.

**When the read of the other machines fails,** this machine's rows are not
touched: they are read on their own. What is shown of the machines depends
on whether that read has succeeded before in this run:

| The read failed | The view shows |
|---|---|
| before it ever succeeded in this run | after the list and an empty row, the row `Other machines were not read.` and under it the failure: `Remote roster unavailable: <message>`, or the kernel's own message when it answered with an error |
| after it succeeded once | each machine keeps its place and its heading, with its state and a short reason in place of the time; its rows are kept and read `unknown` |

The next read that succeeds shows the machines as they then report.

Names are cut by terminal cells with `…` (`...` in ASCII) when they do not
fit; the detail shows them whole.

## The switcher

`w` opens the switcher: what this run can show, over the whole body of the
screen.

```
 oats  workspaces
 1 Instances   2 Souls   3 Capabilities
────────────────────────────────────────────────────────────────────────────────
> * acme-platform               This machine · garnet
    ledger                      quartz
  Not matched to a workspace
    basalt                      ssh needs a prompt
  On this machine, not opened
    acme-docs                   ~/Agents/acme-docs
    sandbox                     ~/Agents/sandbox



────────────────────────────────────────────────────────────────────────────────
 Enter open   / filter   r refresh   Esc close   ? help   q quit
```

It lists, in this order:

- **The workspaces this run knows**, one row each: the name, the machines
  its deployments are on, and at the right edge how many of its deployments
  are not live (`1 deployment not live`). A workspace here is what the
  rules shared with the Desktop make of the deployments opened in this run
  and of what the registered machines answered: the ones that report the
  same workspace are one row. `*` marks the workspace that is open.
- **`Not matched to a workspace`**: what those rules matched to no
  workspace, each by its own name with a short reason. A machine that has
  not answered in this run is listed here.
- **`On this machine, not opened`**: the deployments directly inside
  `~/Agents` that this run has not opened, each by its folder's name and
  its path. Nothing is read from one before it is picked. `~/Agents` is
  looked at up to its first 200 entries; when it holds more, a last row says
  `More folders than are listed here.`

| Key | Does |
|---|---|
| `Up` `k`, `Down` `j`, `g` `Home`, `G` `End`, `PageUp`, `PageDown` | move the selection among the rows; a heading is passed over |
| `Enter` | opens the selected row |
| `/` | filters the rows by what they show: a name, the machines, a path |
| `r` | reads now, and lists `~/Agents` again |
| `Esc` | clears a kept filter; else closes the switcher, back to the view that was open |
| `1` | closes the switcher, back to the view that was open |

**Enter on a workspace** opens its view. **Enter on a folder** opens that
deployment in this run: from then on it is read with the others, and its
workspace is the open view. A folder that stopped being a deployment since
it was listed is not opened: its row says
`Not an OATS deployment any more.` where its path stood.

**Each view keeps its place while the run lasts:** the selected instance,
where its list and its detail were scrolled, and what was folded away are
found again when the view is opened again. A filter is not kept from one
view to another, and nothing is kept after the run ends.

**When the open workspace stops being listed** (it was a machine, and the
kernel's answer stopped naming it), the switcher is shown with
`That workspace is no longer listed.` Until a row is opened there is no
view to go back to, and `Esc` and `1` do not close the switcher. The same
holds after a start outside every deployment, which opens the switcher with
nothing open.

## Stopping, starting, restarting and retiring

With an instance selected, a capital letter acts on it, always after a
confirmation:

| Key | Does |
|---|---|
| `X` | stops it: its session ends, and its home, work and launch are kept |
| `D` | retires it |
| `S` | starts a stopped instance as it was last launched |
| `R` | restarts a running instance as it was last launched |

The rules are the Desktop's, from the readers both clients share: an
instance offers what the Desktop offers for it, and nothing else. One that
is still being spawned, and one its machine reports it cannot reach, offers
none; one whose spawn stopped half way offers only to be retired; a running
one offers restart and not start, a stopped one start and not restart. The
footer names the keys the selected instance offers now, after `Enter`, and
on a narrow terminal they are the first hints it gives up. A key for an act
the instance does not offer opens nothing, and the line above the panes
says why. The keys are yours to change in
[`tui.json`](#change-the-keys-tuijson): the actions are `stop`, `retire`,
`start` and `restart`.

**The confirmation** opens over the list, with the focus on `Cancel`.
`Left`/`Right` and `Tab`/`Shift+Tab` move between its buttons and `Enter`
presses one. No letter moves the focus, and an `Enter` that arrives in the
same read of input as the move onto the act's button is ignored, so pasted
text can open a confirmation but never act in it. `Esc` closes it. `q` and
`Ctrl+C` still quit. The help (`?`) is not shown over a confirmation.

- **Stop and retire read the kernel's plan first** (`oats instance stop
  <instance> --plan`, `oats retire <instance> --plan`) and show what the act
  will do, in the Desktop's words. `Space` switches the plan's choice (for a
  stop: whether the instances spawned from it stop too), which reads a new
  plan. The act's button applies exactly the plan on the screen: when the
  instance changed since, the kernel refuses it and the confirmation shows
  the new plan. For an agent on another machine the plan is read through
  that machine's kernel, and a machine that does not answer gives no plan:
  the confirmation says so.
- **`Review again`** reads the plan again. **`Check again`** asks what
  became of an apply whose answer did not come, or came in a form
  `oats tui` cannot read: it never applies a second time.
- **Start and restart have no plan.** The confirmation says what will
  happen and shows the agent's home (and its machine). A restart ends the
  agent's session and starts it again: what it is doing is interrupted.
  Both run `oats session start --home <home>` (or `restart`) with the launch
  recorded for the instance and no choice of harness, model or
  configuration: for those, run `oats session start --home <home>` with
  its options yourself.
- Once an act has answered, the confirmation shows the answer, and the list
  is read again at once.

**One act at a time per instance from this `oats tui`.** While a start or
restart it sent is still running, whether or not the confirmation is still
open, no act of that instance opens: the line says
`The start of <name> is still running.` While a stop or retire it sent is
still running, another stop or retire from it is refused, with the time
the running one started.

**An act you sent runs to its end.** Closing the confirmation, quitting,
`Ctrl+Z`, a signal to `oats tui`, or the terminal going away never ends
it: `oats tui` sends no signal to the kernel command it started, which runs
in a session of its own and writes to files of its own (below), never to
`oats tui`. When you leave while one is still running, one line per act is
printed after the screen is left, on standard error, when that is a
terminal or a file:

    oats: the stop of dev-1 is still running; `oats status` shows its result.

The exit status never depends on it.

**Limits.**

- Another `oats tui`, the Desktop, and `oats` run by hand can act on the
  same instance. The kernel's answers hold: from OATS 0.52.0 a stop and a
  retire of one instance refuse each other before either changes anything.
  A stop or a retire does not see a start in flight, and a start does not
  see a retire in flight
  ([#866](https://github.com/awebai/oats/issues/866)).
- An `oats tui` started again knows nothing of the acts an earlier one
  sent: `Check again` there answers that the plan expired, the list shows
  what the kernel reports, and against an earlier one's start still running
  the kernel's start lock is the only guard.
- An agent on a machine whose OATS is older than 0.52.0: a stop interrupted
  there can leave `.oats-stop-pending.json` in the agent's home, and then
  the agent can be started but not stopped while that file exists.

## Keys

| Key | Does |
|---|---|
| `Up` `k`, `Down` `j` | move the selection; with the detail focused, scroll it |
| `g` `Home`, `G` `End` | first row, last row |
| `PageUp`, `PageDown` | one page |
| `Left` `h` | fold the instances below the row away; on a row with none, or already folded, go to its parent |
| `Right` `l` | show them again; on a row already open, go to its first child |
| `Tab` | move between the list and the detail; under 80 columns, open and close the detail page |
| `/` | filter |
| `r` | read now |
| `1` | the Instances view |
| `w` | opens [the switcher](#the-switcher) |
| `Enter` | in the list of instances, opens the selected agent's terminal; in the switcher, opens the selected row; in a confirmation, presses the button with the focus |
| `X`, `D`, `S`, `R` | stop, retire, start, restart the selected agent, [after a confirmation](#stopping-starting-restarting-and-retiring) |
| `Left`/`Right`, `Tab`/`Shift+Tab` | in a confirmation, move between its buttons |
| `Space` | in a confirmation, switches the plan's choice |
| `?` | opens the help; `?` again closes it |
| `Esc` | closes, in this order: a confirmation, the help, the filter field, a kept filter, then the detail or the switcher |
| `q`, `Ctrl+C` | quits, with status 0 (a SIGINT from outside answers 130) |
| `Ctrl+Z` | suspends: the shell gets the terminal back as it was; `fg` returns, redraws and reads at once |
| `Ctrl+L` | redraws the whole screen, and sets the terminal's modes again if something reset them |

The selection stands on instances only, and in the switcher on its rows: a
heading, a reason and a note are passed over. What stands above the first
instance or under the last one comes into view with it. When a movement key
has no instance to go to (the selection is on the first or the last one, or
the list has none), it scrolls the list instead, so the rows after the last
instance can always be read, however many they are. The selection stays
where it is, and the list returns to it at the next key that moves it.

The help screen is generated from the table the program acts on, so it
always lists the keys that work, with the marks and with what this version
does not do. The movement keys scroll it. While `oats tui` has the screen,
`Ctrl+\` does nothing.

**The filter.** `/` opens a field on the last row. What you type narrows the
list to the instances whose name, soul or repository contains it, with the
instances they were spawned from, whatever is folded away. In the field
every printable key is text, so `q` and `j` can be typed; `Backspace`
removes a character, `Enter` keeps the filter and returns to the list
(the last row then shows it as `/text`), `Esc` clears it. `Ctrl+C`, `Ctrl+Z`
and `Ctrl+L` still do what they do. The filter holds at most 200
characters. The switcher has a filter of its own, with the same field: it
narrows the rows to the ones whose name, machines or path contain the text.

**Pasted text is never read as keys.** A paste into the list is dropped
whole. A paste into the filter field adds its first line, and only when
that line is plain text; otherwise it adds nothing.

The mouse is never needed and never captured: your terminal's own selection
and scrolling keep working.

## Change the keys: `tui.json`

`oats tui` reads `$XDG_CONFIG_HOME/oats/tui.json` when `XDG_CONFIG_HOME` is
an absolute path, else `~/.config/oats/tui.json`, once, at the start. It
never writes it. With no file the keys are the ones above.

```json
{ "keys": { "quit": ["q"], "refresh": ["r", "f5"], "suspend": [] }, "ascii": false, "open": { "detachKey": "F12" } }
```

- `keys.<action>` is the list of keys of that action. It **replaces** the
  action's keys; an empty list leaves the action with no key. An action you
  do not name keeps its keys.
- The actions are `up`, `down`, `top`, `bottom`, `page-up`, `page-down`,
  `collapse`, `expand`, `detail`, `filter`, `refresh`, `instances`,
  `workspaces`, `open`, `help`, `close`, `quit`, `suspend` and `redraw`.
  `workspaces` (`w`) opens the switcher and `open` (`enter`) opens the
  selected agent's terminal in the list of instances and the selected row
  in the switcher. In an open filter field `Enter` keeps the filter,
  whatever key `open` has.
- A key is written as the help shows it, in lower case: `q`, `G`, `?`,
  `space`, `enter`, `tab`, `escape`, `backspace`, `up`, `pageup`, `f5`,
  `ctrl+c`, `alt+x`, `shift+tab`, `ctrl+alt+up`. Modifiers come in the order
  `ctrl+`, `alt+`, `shift+`. A terminal sends `Ctrl+H`, `Ctrl+I`, `Ctrl+J`
  and `Ctrl+M` as `backspace`, `tab` and `enter`, so those four are not
  keys of their own.
- `ascii: true` is `--ascii`.
- `open.detachKey` is the key that leaves an agent's terminal, written as
  `oats session attach --detach-key` takes it: `C-\` when you name none.
  [Execution targets](execution-targets.md) has the keys that can be chosen.
  `oats tui` does not check it: a key OATS refuses is said when you open an
  agent. A key that tmux's copy mode binds leaves the viewer once that mode
  is left.

**A file it cannot honour stops the start.** Each problem is one line on
stderr, the status is 1 and nothing is drawn; it resolves no conflict and
guesses nothing. It refuses:

| The file | The line says |
|---|---|
| is not a regular file (a link to one is read), or cannot be read | `it is not a regular file`, `it cannot be read` |
| is larger than 64 KiB | `it is larger than 64 KiB` |
| is not one JSON object | `it is not valid JSON`, `it is not one JSON object` |
| has a setting other than `keys`, `ascii` and `open`, or one of the wrong kind | `unknown setting …`, `keys must be an object`, `ascii must be true or false`, `open must be an object` |
| has a member of `open` other than `detachKey` | `unknown member … of open; open has detachKey` |
| gives `open.detachKey` something that is not 1 to 16 printable ASCII characters | `open.detachKey must be 1 to 16 printable ASCII characters` |
| gives `open.detachKey` a value that begins with `-` | `open.detachKey cannot begin with -` |
| gives `open.detachKey` a value the help would draw as another key (a run of spaces, a space at an end) | `open.detachKey is a key the help cannot name` |
| names `open-workspace`, the action's name before it became `open` | `open-workspace is called open now; rename it` |
| names an action that does not exist | `unknown action …`, with the list of actions |
| gives an action something that is not a list of strings | `… must be a list of key ids` |
| has a string that is not a key | `the key … of … is not a key id` |
| names a key whose character cannot be shown (a bidi override, a combining mark on a space) | `… is a key the help cannot name` |
| gives one key to two actions, your lists and the kept keys together | `the key … is given to … and to …; a key does one thing` |
| leaves `quit` with no key | `quit has no key; give it one` |

A name from the file is repeated in a line only when it is plain printable
ASCII of at most 40 characters. More than twenty problems are counted, not
listed.

## What it reads, and what it runs

`oats tui` decodes no kernel answer itself: it runs the readers it shares
with the Desktop (`packages/client/`).

- **Every read of a deployment is two kernel commands**,
  `oats status --json` and `oats workspace status --json` for that
  deployment, run with **the kernel it shipped with** (the `bin/oats.mjs` of
  the same install, with the Node that runs the TUI), never an `oats` found
  on `PATH`. Each has 30 seconds and 4 MiB.
- **Then one probe of the terminals**: a small program of the shared readers
  asks tmux which instances have a live pane (`tmux list-panes`, and `ps`
  for what runs in them). It has 30 seconds. An instance the kernel itself
  reported as unknown is not probed and stays unknown.
- **Every deployment opened in the run is read each time**, at most two at
  a time.
- **How often:** 5 seconds after the last read ended; 30 seconds once ten
  minutes have passed without a key; at once on `r`, on the return from a
  suspend and when a row is opened in the switcher. Every read asks tmux
  anew and reads the instances anew, and the time in the header is that
  read's. What a read in the background may reuse is the kernel's own look
  at the workspace's remotes, for up to 60 seconds; `r` asks the kernel to
  look again.
- **The other machines are one more read**, `oats server roster --json`,
  by the same kernel: one answer for every machine registered on this
  machine. It has 60 seconds and 4 MiB.
  - It is begun together with a read of this machine and never waited for:
    a machine that answers slowly does not hold this machine's rows.
  - One runs at a time. While one is on its way, `r` reads this machine
    again and starts no second one.
  - The next one begins no sooner than 15 seconds after the last one
    ended. Once ten minutes have passed without a key that is 30 seconds,
    because the reads of this machine it begins with are then 30 seconds
    apart.
  - It begins at once, when none is on its way, on `r`, on the return from
    a suspend and when a row is opened in the switcher.
  - A kernel whose version record lists no read of other machines is never
    asked for one, and no other machine is shown.
- **Two looks at the file system serve the switcher**, and neither reads a
  file's content. At a start outside every deployment with no `--dir`, when
  the switcher opens, and on `r` in it, the entries of `~/Agents` are
  listed: at most 200, and each directory among them is asked for a regular
  `oats-local.yaml`. An entry that is a link is not followed. When a folder
  is opened, that one directory is asked again.
- **Opening an agent runs one more command,** `oats session attach --home
  <home> --detach-key <key>`, by the same kernel, with your terminal as its
  terminal. For an agent on another machine `oats session inspect --server
  <id> --home <home> --json` is asked first (20 seconds), then `oats session
  attach --server <id> --home <home> --detach-key <key>`. Nothing is read
  while the agent has the terminal, and the return reads at once.
- **Every read runs in a session of its own** and is ended when the TUI
  ends, on every way out a process can handle (for SIGKILL see
  [below](#what-it-changes-in-your-terminal-and-restores)). The viewer
  shares your terminal, and is ended first when `oats tui` is ended while an
  agent has the terminal. A read that was
  running when the TUI is suspended is dropped, not shown: its answer could
  arrive cut. That holds for the read of the other machines too. The return
  reads again.
- **Stopping, starting, restarting and retiring runs the kernel's own
  commands**, by the same kernel: for a stop or a retire, the plan
  (`oats instance stop <instance> --plan --json`, `oats retire <instance>
  --plan --json`; 30 seconds, 45 for another machine), a read like the
  others, then, when you press the act, the apply of that plan
  (`--plan-revision`, `--idempotency-key`); for a start or a restart,
  `oats session start` or `oats session restart --home <home> --json`. An
  agent on another machine is reached with `--server <id>`. An apply, a
  start and a restart are changes: each runs in a session of its own, with
  no time limit and no signal from `oats tui`, and its output goes to two
  files in a directory of `oats tui`'s own (made with mode 0700 under the
  system's temporary directory), read back when it ends and deleted. On the
  way out the files of a change still running are deleted (it goes on
  writing to them), and the directory is removed. `oats tui` waits for an
  apply's answer for 10 minutes and for a start's for 60 seconds; then it
  says so, and the change goes on.
- It runs no other command that changes a deployment or a registration, and
  it writes no other file.

## What this version does not do

| To | Run |
|---|---|
| start an agent with another harness or model | `oats session start --home <home>` with its options |
| see souls, spawn an agent | `oats souls`, `oats spawn <soul>` |
| see capabilities | `oats capabilities` |
| add a machine to this workspace | `oats server connect <id> --ssh <alias>` |
| check a machine | `oats server check <id>` |
| remove a machine | `oats server remove <id>` |
| open a deployment outside `~/Agents` | `oats tui --dir <path>` |
| open an agent in a tmux window or split of its own | `oats session attach --home <home>` in that window (the detail shows the home) |

The help screen (`?`) names the same commands. What else holds for this
version:

- **It keeps nothing on disk.** A machine it has not reached in this run is
  listed by its own name, in no workspace. What is folded away and each
  view's place last as long as the run, and no filter is saved.
- **Of this machine's deployments, the switcher lists only the ones opened
  in this run and the ones directly inside `~/Agents`.** Any other is
  opened with `oats tui --dir <path>`.
- **A row of another machine shows what its host reported at the last
  read,** not what is true at this moment. The time of that read is on the
  machine's heading. A view of one machine has no heading: there the header
  names the machine (`on garnet`) and carries the time.
- Souls and Capabilities, when they come, are this machine's.
- There is no sorting and no mouse, and a deployment's heading cannot be
  folded.
- With an OATS older than 0.52.0, after an interrupted stop the instance can
  be started and then cannot be stopped while `.oats-stop-pending.json` exists
  in its home.

## What it changes in your terminal, and restores

This is the complete list. On start, in this order:

1. raw mode on the terminal (keys arrive unbuffered and unechoed);
2. the alternate screen (`CSI ?1049h`), so your scrollback is untouched;
3. the cursor hidden (`CSI ?25l`);
4. autowrap off (`CSI ?7l`);
5. bracketed paste on (`CSI ?2004h`).

On the way out, the reverse: bracketed paste off, autowrap on, the style
reset (`CSI 0m`), the cursor shown, the alternate screen left, raw mode off.

Two of these have a reason worth stating:

- **Autowrap is off** so that no row can wrap when your terminal and the
  TUI's width table disagree about how wide a character is (some emoji and
  some scripts). Each row is positioned on its own and erased to its end, so
  a disagreement stays inside its row.
- **Bracketed paste is on** so that the terminal marks pasted text as a
  paste, and the TUI can drop it instead of acting on it.

The terminal is restored after every way out that a process can handle:

| Way out | Exit status |
|---|---|
| `q` or `Ctrl+C` | 0 |
| an internal error (its message is printed after the alternate screen is left) | 1 |
| SIGINT | 130 |
| SIGTERM | 143 |
| SIGHUP, or the terminal going away | 129 |
| SIGQUIT | 131 |

A suspend (`Ctrl+Z`, or SIGTSTP from outside) restores the terminal in full
before the process stops, and sets the same modes again when it continues.
It stops the whole foreground process group, as a `Ctrl+Z` does for any
other program, so `oats tui` started through a wrapper (`sh -c`, `npx`)
suspends as one job.

**While an agent has the terminal** `oats tui` has put the terminal back in
full, as for a suspend, and draws nothing. The viewer is OATS's own: it sets
what it needs, the mouse for scrolling among it, and puts that back when it
ends. Then `oats tui` sets its modes again. A SIGQUIT does not end
`oats tui` while an agent has the terminal (a second `Ctrl+\`, pressed as the
viewer leaves, is that signal). SIGINT, SIGTERM and SIGHUP end the viewer
first and then `oats tui`, with the status of the table above. A viewer
that has not ended 3 seconds after it was asked, or at a second signal, is
left as it is, and `oats tui` ends without it.

`Ctrl+C` is the quit key: in raw mode the terminal sends it as a byte, not as
a signal, so it answers 0. A SIGINT sent from outside (`kill -INT`) answers
130. A script that wraps `oats tui` meets that difference.

**SIGKILL cannot be handled.** No process can restore a terminal after
SIGKILL: the terminal is left in the alternate screen with the cursor hidden
and autowrap off. Run `reset`. Inside tmux also run `tput rmcup`: measured
on tmux 3.7c, `reset` brought back the cursor and autowrap, and the pane
stayed in the alternate screen until `tput rmcup`. Nothing else is left in
tmux: `oats tui` creates no session, window, option or key binding.
Nor can it end a read after SIGKILL: nothing of the TUI runs any more, so a
read that was in flight runs to its own end. After a SIGKILL while an agent
has the terminal, the viewer still has it: leave it with the key and you are
in your shell.

## What it never does

- It switches on **no mouse reporting, no focus reporting, no keyboard
  protocol, no keypad or cursor-key mode and no synchronized output**.
- It writes **no window title, no clipboard sequence, no bell**, and no query
  that expects the terminal to reply.
- It uses **only your terminal's own sixteen colours** and bold, dim,
  underline and reverse: no 256-colour or RGB value and no background fill,
  so your theme stays the theme. With `NO_COLOR` set and not empty it uses no
  colour at all. Nothing is told by colour alone.
- It draws its rules and marks in UTF-8 when `LC_ALL`, else `LC_CTYPE`, else
  `LANG` names UTF-8, and in ASCII otherwise or with `--ascii`. No icon font,
  no emoji. When the locale is not UTF-8, a character outside ASCII in text
  it shows is drawn as `?`.
- It **never writes an escape byte to anything that is not a terminal**.
- It **never writes text it did not author straight to the terminal.** A
  terminal acts on what is written to it, so every string from a kernel
  answer, a repository, an agent or another machine passes one filter before
  it is drawn: text holding a control character or a secret shape is shown
  as `[withheld]`, and bidi controls, invisible characters and C1 controls
  are replaced. The screen accepts only text that went through that filter
  or the TUI's own words. The words that name who gave a reason are the
  shared home's (`packages/client/`), and the TUI writes none of its own
  for a speaker. They never stand before a withheld text: a reason that is
  withheld is `[withheld]` alone.
- It changes nothing in tmux itself: no option, key binding, server,
  session, window or pane. Its probe only lists panes. An agent's own
  session is started, ended or restarted only by the kernel's commands of
  an act you confirmed
  ([above](#stopping-starting-restarting-and-retiring)), and an agent's
  terminal is opened by `oats session attach`, which makes its own viewer
  session on the agents' tmux server and removes it; `oats tui` builds no
  viewer and runs no tmux command for either.
- It starts no daemon, opens no socket and writes no file but the output of
  a change, in its own directory ([above](#what-it-reads-and-what-it-runs)).
  The processes it starts are the reads above, when you open an agent the
  viewer, and the acts you confirm. No read and no viewer outlives it on
  every way out a process can handle, except a viewer that does not end
  when asked (see [above](#what-it-changes-in-your-terminal-and-restores));
  after SIGKILL a read in flight runs to its own end, and a viewer stays
  until you leave it. An act you confirmed is never ended by `oats tui`: it
  runs to its own end.

## Errors

| Error | When | What to do |
|---|---|---|
| `E_NO_TERMINAL` | stdin or stdout is not a terminal, or `TERM` is unset, empty or `dumb`. One line on stderr, nothing on stdout, exit 1 | run it in a terminal; `oats status` prints the instances once |
| `E_BAD_ARGS` | `oats tui --json`: it is interactive and has no JSON form. The usual failure envelope, exit 1 | `oats status --json` is the machine view |
| `E_BAD_ARGS` | any argument other than `--dir <path>`, `--ascii` and `--help`, or `--dir` with no path. One line on stderr with the usage, exit 1 | `oats tui --help` |
| `E_TUI_CONFIG` | `tui.json` cannot be honoured. One line per problem on stderr, exit 1 | fix the file as the line says, or remove it |
| `E_NO_DEPLOYMENT` | no directory at or above the start holds an `oats-local.yaml`; and, for a start without `--dir`, `~/Agents` holds no deployment. One line on stderr, exit 1 | `oats tui --dir <path>`, or `cd` into the deployment |
| `E_TUI_KERNEL` | the kernel it shipped with did not answer `version --json` with a record it accepts; the line gives the reason. One line on stderr, exit 1 | reinstall `oats`: the client and the kernel are one package |

These lines are written before the terminal is touched, in this order: the
arguments, the terminal, `tui.json`, the deployment, the kernel. None of the
codes on stderr appears in a JSON envelope. A path is repeated in a line
only when it is plain printable ASCII.

## Where it has been run

So far `oats tui` has been run in tmux only: not in a terminal emulator
without tmux, and not over ssh.
The automated tests run the real `oats tui` in tmux (a pane is a real
terminal: keys and screen are bytes through a pty), on a private tmux server.
Other terminals and multiplexers are untested so far: that is a statement
about the tests, not a list of what is supported. If it misbehaves in yours,
that is a bug worth reporting, with the terminal's name and `TERM`.

Another machine is reached only through the kernel's own read
(`oats server roster`): `oats tui` opens no connection of its own.

Opening an agent has been run in the automated tests only, in two private
tmux servers: one holds the agent's window, as a deployment records it, and
the other plays your terminal, with the real `oats tui` and the real
`oats session attach` in its pane. No real terminal emulator, no ssh and no
other machine reached for real were used: an agent of another machine is
opened in the tests from the kernel's answer handed to the client. So far no
person has opened an agent from `oats tui` in a real terminal.

With a registered machine it has been run only against one that did not
answer: the switcher lists it by its own name with the reason, and its view
says that it was not reached. A machine that answers is drawn in the
automated tests, from the kernel's answer handed to the client; so far no
person has checked one in a real terminal.
