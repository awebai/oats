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
  other machines registered on this machine, in one list, opens agents'
  terminals as tabs, spawns an agent on this machine, and stops, starts, restarts
  and retires an agent after a confirmation.** The registered machines are
  the ones `oats server list` names. It follows the instances as they
  start, stop and wait for you. It cannot spawn an agent on another machine
  or with another harness, model or task, start one with another harness or
  model, or add, check or remove a machine: [what it does not do
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
 fixture                                                              3 stopped
  Instances   Souls   Capabilities                                read 20:02:02
──────────────────────────────────────┬─────────────────────────────────────────
> ■ dev ·2                            │   dev
  ■ reviewer ·1                       │   dev fixture soul.
                                      │   from     ws
                                      │   works    works in directory
                                      │   harness
                                      │     Harness    Pi
                                      │     Model      Pi's default model
                                      │     Chosen by  no preference set: the
                                      │                host default
                                      │   instances here
                                      │     ○ alpha  ○ beta
                                      │     i shows them in the Instances view.
```

- **The header** starts with the workspace's name, then what the view holds of
  other machines, then the counts. Beside a deployment of this machine the
  other machines are counted: `+1 machine`, `+2 machines`. A view that holds
  no deployment of this machine names its one machine, `on garnet`, or
  counts them when there are two or more, `2 machines`. The counts are over
  every row of the view: instances running, instances that need input,
  stopped, state unknown, and rows the kernel reported that were withheld (a
  home outside its soul's directory, or one reported twice). A count of zero
  is left out. The second row names the views, `Instances   Souls
  Capabilities`, the open one drawn in reverse video. `1`, `2` and `3`
  open them in the list, and [the leader](#the-leader) then `1`, `2` or `3`
  from anywhere; the leader's hint, [the palette](#the-palette) and the
  help name those keys. [The Souls view](#the-souls-view) lists the open
  workspace's souls; the Capabilities view says what it will hold and what
  to run until then, `oats capabilities`. On the right is the time of the
  read of this machine that the screen shows: it moves with every read.
- **The footer** is one row of keys from the first column, with no rule
  above it. It names `C-\ commands` first, in every focus: the leader,
  which reaches every action. Then come the actions that apply now, as many
  as fit, `help` and `quit` last; a narrow footer gives the others up first.
  While the leader waits for its key the row is the leader's hint.
- **The list** is the roster the Desktop draws: the same groups in the same
  order, from the same code. It is in name order, by each group's top
  instance, so starting or stopping an instance moves nothing. An instance
  that others were spawned from has them indented under it, and keeps its
  place when it gains or loses one. An empty row stands between each run
  of instances related to no other and the group before or after it. The
  indent alone says which instance is under which: no mark is drawn for
  it. A row whose instances are folded away (`h`) says how many after its
  name: `+1`.
- **Each row** is the mark of its state and the name, then `!` at the
  right when it needs input. The harness and the state in words are in
  the detail. A row has a word, dim, only where its mark cannot say it: the
  state of a home a spawn or a retire holds (`Retire didn't finish`), or
  the shared words for why an instance cannot be reached or opened:
  `gone from garnet`, `garnet not reached`, `not reachable on garnet`,
  `Herdr no longer supported`, `state unknown`.
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
- **Opening an agent.** `Enter` on an instance that runs opens its terminal
  beside the list, where the detail was, as a tab: see
  [Open an agent's terminal](#open-an-agents-terminal) and [Tabs](#tabs).

**A view of more than one deployment** (this machine and another, or two
deployments on one machine) is one list, grouped as the Desktop groups it:

- **Each deployment has a heading**, and its instances stand under it,
  grouped as above. The heading is `This machine` or the machine's name,
  with the end of the deployment's path when one machine holds two of the
  view. A heading cannot be selected or folded: the movement keys pass over
  it. A view of one deployment has no heading.
- **A machine's heading is its name.** When its rows were read at another
  time than the one in the header, that time stands at the right of the
  heading: `read 14:03:21`. A row of another machine shows what its host
  reported at that time.
- **A deployment that is not live carries its state and a short reason**
  on its heading, and no time: `garnet  remembered  Not reached`. The rows
  a machine last reported are kept when it is not reached, and each of them
  reads `garnet not reached`, with the `?` mark, in the list and in the
  detail: nothing reads as stopped, or as running, that is only not
  reached.
- **An instance gone from its machine** is one this computer keeps a route
  to, which its machine no longer has. It reads `gone from garnet`, with
  the `?` mark, in the list and in the detail. The detail says so in a
  sentence, with the command that removes it from this computer:
  `oats server forget <id> --instance <name>`. It cannot be opened,
  and `Enter` says why in the same sentence.
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
`other  on garnet` for one machine, `2 machines` after the name for
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
| `◆` | `#` | held by a spawn or a retire: under way (Retiring…), failed or not finished ([below](#held-rows)) |
| `+n` | `+n` | after a name: n instances folded away below it |
| `!` | `!` | needs input |
| `!N` | `!N` | N instances folded away below it need input |
| `>` | `>` | the selected row (also drawn in reverse video), and the pane the movement keys act on |
| `*` | `*` | in the switcher: the workspace that is open |

Every state has a mark of its own shape, so nothing is told by colour alone.

<a id="held-rows"></a>**A held row** says in its word what holds it, by the
Desktop's rule:

- `Setting up worktree…`: a spawn is running its worktree setup.
- `Spawn didn't finish`: a spawn left the home for a retire to clean up.
- `Retiring…`: a retire is in progress, never shown as a failure. OATS
  reports it running, or cannot tell whether the process holding it still
  runs; or the instance's OATS does not report a retire's state yet and
  the instance has a retire pending; or this `oats tui` sent the retire and
  has not read the list since its answer. A retire the kernel refused, or
  whose plan had changed, runs nothing: the row reads as the list says at
  once.
- `Retire failed`: a self-retire's completion recorded an error. The detail
  gives its reason after `OATS says:`, in OATS's words with its code,
  through the display filter. With a code and no message, the reason is
  its code after `OATS says:`, the same way.
- `Retire didn't finish`: a scheduled completion is gone and left no
  outcome.

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
| after it succeeded once | each machine keeps its place and its heading, with its state and a short reason in place of the time; its rows are kept and read `<machine> not reached` |

The next read that succeeds shows the machines as they then report.

Names are cut by terminal cells with `…` (`...` in ASCII) when they do not
fit; the detail shows them whole. The TUI's own words end the same way:
**Retiring…** reads `Retiring...` in ASCII.

## Open an agent's terminal

```
 acme-platform                                                        2 running
  Instances   Souls   Capabilities                                read 14:03:27
──────────────────────────────┬─────────────────────────────────────────────────
> ● backend-lead              │ backend-lead
  ● docs-writer               │$ make docs
                              │Building the reference...
                              │
                              │
C-\ commands   C-\ C-\ back to the list
```

- **`Enter` on an instance that runs** opens its terminal on the right of
  the body, where the detail was, with the list on the left. Its top row
  names the agent (and `on <machine>` for one of another machine); under it
  is the agent's screen, as the agent draws it, in its own colours. While a
  terminal is open the list keeps 30 columns at most, also while the
  detail stands in the terminal's place, and a name longer than its row is
  cut with `…` (`...` in ASCII).
- **The terminal has the focus.** What you type, what you paste and every
  key go to the agent exactly as typed, `Ctrl+C`, `Ctrl+Z`, `Esc` and `q`
  among them, but for **[the leader](#the-leader)** (`Ctrl+\` unless
  [`tui.json`](#change-the-keys-tuijson) names another), the one key the
  TUI takes from the agent. The leader twice gives the focus to the list;
  the leader then another key does what that key does from anywhere. While
  the terminal has the focus the footer names it, and the leader twice:
  `C-\ commands   C-\ C-\ back to the list`. A leader inside a bracketed
  paste is pasted, not taken.
- **With the list focused** the terminal stays open, and the agent's screen
  is still drawn as it changes. The footer names the keys for it:
  `Enter focus terminal` on its row, `z zoom` and `c close terminal`.
  - `Enter` on the shown terminal's row gives it the focus again.
  - `z` gives it the focus and the whole body: the header and the footer
    stay, the list is hidden. The leader twice brings the list back beside
    it, and the leader then `z` zooms it out and in without leaving it.
  - `c` closes it: the agent keeps running. The tab beside it is shown;
    with no other tab the right side is the detail again.
  - `Tab` shows the detail in its place until `Tab` or `Esc`. Nothing of
    the terminal is drawn meanwhile, and its screen is read afresh when it
    shows again.
- **Up to four terminals are open at a time, each a tab.** `Enter` on
  another instance that runs opens its terminal in a new tab, and the
  others stay open: see [Tabs](#tabs).
- **Under 80 columns** the terminal is always shown with the whole body
  when it has the focus. With the list focused the list is shown alone; the
  terminal stays open, unseen, and `Enter focus terminal` in the footer
  shows it again. Beside the list the terminal is never narrower than 40
  columns.
- **A terminal also closes by itself** when its viewer ends, shown or
  hidden ([which tab is shown then](#tabs)): the agent's
  window ended, its session went away, or the link to its machine dropped.
  It closes within a second of that (tmux tells `oats tui` of a viewer's
  end once a second), or a second more when tmux took a moment more to
  have the viewer's exit status: once tmux has reported the viewer ended,
  `oats tui` waits ten seconds at most for that status, and closes the
  terminal without it when it has not come. A tmux built with libutempter
  (Ubuntu's and Debian's are) can lose that status: while it waits,
  `oats tui` has tmux look for it again once a second, so the terminal
  still closes within a second or two with the line its status calls for. The instances are then read again at once, and one line above the panes
  says what happened: that it could not be opened, that the connection to
  its machine ended, or that the viewer ended without saying why. What the
  viewer printed on its error output stands under that line in quotation
  marks, without saying who printed it: OATS, tmux and ssh all can. When
  the viewer ended cleanly there is no line, and a terminal you closed
  yourself says nothing. **A terminal is never opened again by itself**:
  `Enter` opens it.
- **`Enter` on an instance that cannot be opened** opens nothing and says
  why: it does not run, whether it runs is not known, or the detail's
  reason holds it (an instance gone from its machine, say). An agent on another machine is asked first whether it
  can be opened (`Esc` gives that up); a machine whose OATS cannot open its
  sessions is said then.
- **No scrollback but the viewer's own, and no mouse.** The panel shows
  what the agent's window shows now; what has scrolled away is reached as
  the agent's own terminal reaches it.
- **How it works.** The terminal is the kernel's own viewer,
  `oats session attach`, run in a pane of a tmux server private to this run
  of `oats tui`: its socket is in a directory of the run's own (mode 0700,
  under the system's temporary directory), it reads no tmux configuration
  of yours, and it has no prefix key, no key binding and no status line.
  `oats tui` reads that pane's screen when tmux says it changed, never on a
  timer: an idle terminal costs no frame. Inside tmux nothing changes: the
  agent opens in the TUI's panel, and `oats tui` makes no window and no
  split in your tmux.

## Tabs

```
 acme-platform                                                        3 running
  Instances   Souls   Capabilities                                read 14:03:27
──────────────────────────────┬─────────────────────────────────────────────────
> ● backend-lead              │ backend-lead  docs-writer•  qa-runner
  ● docs-writer               │$ make test
  ● qa-runner                 │ok 41 of 41
                              │
                              │
C-\ commands   C-\ C-\ back to the list
```

Each terminal open in the panel is a tab, and the panel holds up to four.

- **The tab strip** is the panel's top row: each tab's agent, in the order
  the tabs were opened. With one tab the row reads as
  [above](#open-an-agents-terminal), the agent's name alone.
  - **The shown tab** is the one whose screen the panel draws. Its name is
    in reverse video while the terminal has the focus, and bold otherwise.
  - **The other tabs are hidden**, their names plain. A hidden tab whose
    agent wrote since it was last shown has `•` after its name (`*` in
    ASCII); the mark goes when the tab is shown. A hidden tab's screen is
    not read: only that its agent wrote.
  - **An agent of another machine** reads `<name>`, then a dim
    `on <machine>`.
  - **A strip longer than its row is cut** in this order: the hidden tabs'
    `on <machine>`, then the hidden tabs' names, each to an equal share,
    with `…` (`...` in ASCII), then the shown tab's `on <machine>`. The
    shown tab's name stays whole.
- **Opening.** `Enter` on a row, an instance in
  [the palette](#the-palette), the leader then `Up` or `Down`, and a
  [spawn](#spawning-an-agent)'s new agent open a terminal the same way:
  - an instance that has a tab: that tab is shown, with the focus in it;
  - any other: a new tab, after the shown one, is shown with the focus in
    it. The other tabs stay open.
  - **One open at a time.** While a tab is starting, or an agent of another
    machine is asked whether it can be opened, another open does nothing,
    and neither does a key that shows another tab.
  - **At four tabs nothing closes by itself.** The open does nothing, and
    the line above the panes says `4 terminals are open; close one with C-\ w.`
    (with your leader, when [`tui.json`](#change-the-keys-tuijson) names
    another). A tab still starting, and an agent of another machine while
    it is asked, hold a place among the four. An instance that cannot be
    opened says why, as it does with no tab open.
- **Switching.** `[` and `]` in the Instances view, from the list or the
  detail, show the tab before or after the shown one. The leader then
  `Left` or `Right` does the same from any focus, and from another view
  goes to the Instances view first.
  - The strip does not wrap: on the first tab `[` does nothing, and on the
    last `]`.
  - The focus does not move: in the terminal it stays in the terminal,
    zoomed or not, and in the list it stays in the list.
  - **Showing a tab selects its instance's row** in the list and brings it
    into view: a filter that hides the row is cleared, and an instance
    folded over it is opened.
- **The palette** lists the instances most recently opened or shown first,
  as the Desktop's does. When the first of them is the shown tab's, the
  palette opens with the second selected, so the palette then `Enter` goes
  back to the terminal shown before it.
- **Closing.** The leader then `w`, or `c` in the Instances view, closes the
  shown tab: its agent keeps running. The tab to its right is shown, else
  the one to its left.
  - After the leader then `w` from a terminal, the tab shown next has the
    focus, and is zoomed when the one closed was. After `c`, or the leader
    then `w` from anywhere else, the terminal does not take the focus.
  - Closing the last tab closes the panel: the right side is the detail
    again, and the list has the focus.
- **A tab that closes by itself**, when its viewer ends, says so on the line
  above the panes in the words [above](#open-an-agents-terminal), for that
  tab's agent (no line when it ended cleanly).
  - The shown tab: the tab to its right is shown, else the one to its left,
    and the list takes the focus.
  - A hidden tab: the shown tab and the focus stay as they were.
- **Zoom** (`z`, or the leader then `z`) gives the shown tab the whole body.
  The strip stays its top row, and the other tabs stay open.
- **The tabs are the open workspace's.** Opening another workspace in
  [the switcher](#the-switcher) closes them all, and so does the open
  workspace no longer being listed; their agents keep running. Coming back
  opens none of them again.

## The Souls view

`2`, or the leader then `2`, shows the souls of the open workspace: the
ones `oats spawn` can make an instance of here, as the OATS Desktop lists
them, from the same code.

```
 acme-platform                                        2 running  1 stopped
  Instances   Souls   Capabilities                                read 14:03:27
──────────────────────────────────────┬─────────────────────────────────────────
> ■ dev ·2                            │   dev
  ■ ops !                             │   Builds and ships the platform.
  ■ reviewer ·1                       │
                                      │   from     oats-core
                                      │   works    works in its own worktree
```

- **A row** is the soul's colour mark (`■`, `#` in ASCII; its colour is the
  Desktop's for that soul, uncoloured when it has none), its name, and a
  count of its instances on this machine, `·2`. A soul a spawn here would
  refuse is drawn dim, with `!` after its name. The list keys move, and `/`
  filters by name, description or where the soul comes from.
- **The detail** beside it, top to bottom: the name and the description;
  where it comes from (its member, or its package and version); where it
  works; why a spawn here would be refused, when it would be; the harness
  and model a spawn would use and where that choice is set (a launch
  problem as the kernel reports it); its teams, the default first; its
  capabilities; and its instances on this machine, eight at most and then
  `+n`. `Enter` gives the detail the focus (under 80 columns it takes the
  list's place), and the movement keys then scroll it.
- **`i`**, or `Enter` in the detail, shows that soul's instances in the
  Instances view: an exact filter, shown where a kept filter stands in
  the footer, `soul dev`.
  An instance of another soul whose name holds `dev` is not listed. `Esc`
  clears it, and `/` replaces it with a text filter.
- **`r`** reads the souls again; while a read is under way it starts
  nothing. `Esc` closes the detail, then clears a kept filter, then goes
  back to the instances.
- **When it reads:** the first time the view is shown, never before: a run
  that never shows it never runs `oats souls`. After that, a read of the
  workspace reads the souls again only when the workspace changed (its
  commit, a member's, its externals), and `r` does. While the first read is
  under way the view says `Reading souls…`. A read that fails says why,
  with `r` to try again; one that fails after a good one keeps the souls it
  had, under a heading that says it failed and when the souls were read;
  the selected soul's detail says why in full, under its name.
- **What is kept:** the selected soul and the filter, when the view is left
  and shown again, for the run.
- **Only this machine's:** the view lists the souls of a workspace of this
  machine. With none open it says so.

`n` or `N` spawns an agent of the selected soul: [Spawning an
agent](#spawning-an-agent).

## The switcher

`w` opens the switcher: what this run can show, over the whole body of the
screen.

```
 workspaces
  Instances   Souls   Capabilities
────────────────────────────────────────────────────────────────────────────────
> * acme-platform               This machine · garnet
    ledger                      quartz
  Not matched to a workspace
    basalt                      ssh needs a prompt
  On this machine, not opened
    acme-docs                   ~/Agents/acme-docs
    sandbox                     ~/Agents/sandbox




C-\ commands   Enter open   / filter   r refresh   Esc close   ? help   q quit
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
none; one whose spawn stopped half way, and one whose retire failed or
didn't finish, offers only to be retired; a running one offers restart and
not start, a stopped one start and not restart. One that is `Retiring…`
offers no start, stop, restart or open: `D` still opens its retire
confirmation, but the footer does not name it, since the kernel refuses a
second retire while one runs and it is needed only when the first one's
holder can't be read. The
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

## Spawning an agent

`n` spawns an agent of a soul of the open workspace, on this machine, with
one screen to read and one `Enter` to press.

- **`n`** in the list of instances (or the leader then `n`, from any focus,
  a terminal's too) opens the soul picker over the list: the souls of
  [the Souls view](#the-souls-view), read with `oats souls` if they were
  not read yet (`Reading souls…` until then). Typing filters them with the
  palette's subsequence match; `Up`/`Down` move, `Enter` picks the selected
  soul, `Esc` closes. A soul a spawn here would refuse is listed with `!`
  and why, and cannot be picked.
- **`N`** (or the leader then `N`) spawns another of the selected instance's
  soul (from a terminal's focus, that terminal's instance): it opens the
  preview at once. In the Souls view `n` and `N` both open the preview of
  the selected soul. The palette lists `Spawn an agent` and, with an
  instance selected whose soul the catalog lists, `Spawn another <soul>`.
- **The preview** is the OATS Desktop's, read with the kernel's
  `oats spawn <soul> --preview --json` and worded by the same shared
  readers: the name the agent will have, its home, where it works, its
  harness and model and where that choice was made, its team, its
  relationship, its worktree setup, where it runs; then the launch-prompt
  policy, the capabilities' warnings and the modules, each folded to one
  row.
- **One focus ring:** `Spawn` (where the focus starts), `name`, `child of`
  (when an instance of this machine was selected), then each folded part.
  `Tab` moves along it, `Shift+Tab` back. `Enter` does what the focus says,
  and the footer names it:
  - on `Spawn`, spawns what the preview shows;
  - on `name`, keeps the name typed and reads the preview again with it:
    the instance is named `<soul>-<name>` (`--purpose`). Only the letters,
    digits and dashes of a name are typed; `Esc` puts back the name the
    preview was read with;
  - on `child of`, switches between no parent and the instance that was
    selected when the prompt opened, and reads the preview again;
  - on a folded part, opens or closes it.

  `Esc` on any other focus gives it to `Spawn`; on `Spawn` it goes back to
  the picker (to the list for `N` and from the Souls view). The movement
  keys scroll a preview taller than the screen.
- **Nothing else is chosen here:** the harness and the model are the
  soul's and this machine's launch preferences (`oats soul launch set`),
  and there is no task: the new agent starts with none, and you type to it
  in its terminal.
- **A paste cannot spawn.** An `Enter` in the same read of input as the
  key that opened the prompt does nothing; `Enter` on `Spawn` spawns only
  once the preview was read for exactly the choices shown, a frame that
  shows it ready with its `Spawn` button was written to the terminal, and
  only from a read of input later than that frame. A pasted `n`, a soul's
  name and two `Enter`s stop at the preview.
- **`n` and `N` are of the view they are pressed in**: the leader's too.
  From the Souls view (its list, its filter or its detail) both are of its
  selected soul, whatever the list of instances has selected.
- **One spawn at a time.** While one is under way the line above the
  panes says `Spawning <name>…`, and the TUI goes on working: `n` and `N`
  say a spawn is under way and open nothing.
- **Only on this machine.** On another machine's row or workspace `n` and
  `N` (from their keys, the leader or the palette) say that spawning on
  another machine is not offered here, and that `oats spawn` there makes
  one.

**What follows the spawn** is said in the shared words, the Desktop's, and
the TUI adds only what to do next, naming its keys or an `oats` command:

| Outcome | What follows |
|---|---|
| created and started | the instances are read at once; when the new row appears it is selected and its terminal opens beside the list in a new [tab](#tabs), with the focus in it. With four tabs open the line says it was created, then `4 terminals are open; close one with C-\ w.`, and nothing opens. Not running after two reads: the line says it is not visible yet, and nothing opens later by itself |
| created, but not started, or its wake not saved, or not finished | the line says so; nothing opens. A home the spawn left reads as [held](#held-rows) |
| not known (the answer was lost, or still running at the deadline) | the line says so, and `C` checks its result once, without spawning again: it is offered only then |
| its cleanup is owed | the line says so and names the retire |
| refused, rolled back, never submitted, or changed since you looked | the preview again, read anew, with the line in it: change the choices or press `Enter` again |

**Quitting with a spawn under way** lets it go: the spawn finishes, or the
kernel's own limits bound it; `oats tui` neither waits for it nor ends it.
The line after leaving says so and names `oats status` to see it.

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
| `2` | [the Souls view](#the-souls-view); `Esc` or `1` goes back |
| `3` | the Capabilities view, which says what it will hold and what to run until then; `Esc` or `1` goes back |
| `w` | opens [the switcher](#the-switcher) |
| `Enter` | in the list of instances, opens the selected agent's terminal in a new [tab](#tabs) beside the list, or shows its tab when it has one, with the focus in it; in the switcher, opens the selected row; in a confirmation, presses the button with the focus |
| `z` | gives the shown terminal the focus and the whole body |
| `c` | closes the shown terminal's tab and shows the tab beside it; the agent keeps running |
| `[`, `]` | in the Instances view, shows the tab before or after the shown one |
| `Ctrl+\` | [the leader](#the-leader), from every focus ([`tui.json`](#change-the-keys-tuijson) can name another key) |
| `Ctrl+K` | opens [the palette](#the-palette); `Ctrl+K` again closes it |
| `X`, `D`, `S`, `R` | stop, retire, start, restart the selected agent, [after a confirmation](#stopping-starting-restarting-and-retiring) |
| `n` | [spawns an agent](#spawning-an-agent): the soul picker, then the preview |
| `N` | spawns another of the selected instance's soul: its preview |
| `C` | checks the result of a spawn whose outcome is not known, while one is |
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
always lists the keys that work, the leader's among them, with the marks
and with what this version does not do. The movement keys scroll it. While
a terminal has the focus the table's keys are the agent's: the leader alone
is the TUI's.

### The leader

Every action is reached by keys from every focus, a terminal's too: the
leader, `Ctrl+\` (tui.json's `open.detachKey`), then one plain key.

| The leader, then | Does |
|---|---|
| `k` or `Space` | opens [the palette](#the-palette) |
| `1`, `2`, `3` | the Instances, Souls and Capabilities views |
| `Up`, `Down` | opens the terminal of the instance before or after, in the list as it is drawn, the focus in it: from the shown terminal's instance, or from the selection when none is open. It shows the instance's tab when it has one, else opens a new [tab](#tabs). Rows that cannot be opened are passed over, and the list does not wrap |
| `Left`, `Right` | shows the tab before or after the shown one; the strip does not wrap, and the focus stays where it was |
| `z` | zooms the shown terminal in or out; with the list focused, gives it the focus and the whole body |
| `w` | closes the shown terminal's tab and shows the tab beside it; the agent keeps running |
| `X`, `R`, `S`, `D` | stop, restart, start, retire, [after a confirmation](#stopping-starting-restarting-and-retiring): from a terminal's focus on that terminal's instance, which has the focus again when the confirmation closes |
| `n`, `N` | [spawns an agent](#spawning-an-agent); `N` of the shown terminal's soul from its focus |
| `/` | the filter |
| `o` | [the switcher](#the-switcher) |
| `?` | the help |
| `Esc`, or the leader again | gives the list the focus; with the list focused, only closes the hint |

- **While the leader waits** for its key the footer row is its hint, which
  names these keys (`z` and `w` only while a terminal is open, `Left` and
  `Right` only with two tabs or more). It waits
  with no time limit. A key not in the table cancels it and is dropped:
  nothing is typed.
- **Only a key in a later read counts.** A key that came in the same read of
  input as the leader cancels it and is dropped, with the rest of that
  read, so a paste can never run a command. In a terminal the bytes before
  the leader in that read still go to the agent. A leader inside a
  bracketed paste is pasted text.
- **In the list no leader is needed:** the plain keys work as they always
  have, and the leader works there too.
- **What was open under it is settled first,** from whatever view: a
  filter field keeps its filter, as `Enter` does, and a confirmation
  closes. `Up`, `Down`, `Left`, `Right`, `z`, `w` and the acts then go to
  the Instances view, from Souls, Capabilities, the help or the switcher
  too; with no workspace open they do nothing, and `Left`, `Right`, `z` and
  `w` do nothing with no terminal open.
- **The table is fixed** in this version: `keys` in `tui.json` rebinds the
  plain keys, and `open.detachKey` the leader.

### The palette

The leader then `k` (or `Space`), or `Ctrl+K` in the list, opens one input
over a list, as the OATS Desktop's ⌘K does. It takes the body, and while it
is open no terminal is drawn and the TUI reads the keys.

- **It lists, in this order:** the instances that can be opened, the most
  recently opened or shown in this run first (when the first is the shown tab's,
  the second is selected as it opens), then the list's order, each with its
  state mark, its name and, for another machine, `on <machine>`; the souls
  of the open workspace, once [the Souls view](#the-souls-view) has read
  them (choosing one shows that view with it selected; the palette never
  reads them); the views, Instances, Souls and Capabilities; the acts the
  instance offers now (the shown terminal's when the palette was opened from
  its focus, else the selected one's), with `Spawn another <soul>` once the
  catalog lists its soul; then Spawn an agent, Workspaces, Refresh and Help.
  Each row says at its right edge what kind it is: `instance`, `soul`,
  `view`, `act` or `command`.
- **Typing filters it** with the Desktop's subsequence match, a prefix
  first: each kind keeps the rows that match, the best first.
  `Backspace` removes a character, and a paste adds its first line.
  `Up`/`Down` (and `PageUp`/`PageDown`) move, `Enter` runs the selected
  row, `Esc` closes it.
- **Running a row** settles what was open under the palette, as the leader
  does: an instance shows its tab, or opens its terminal in a new one, in
  the Instances view, the focus in it ([Tabs](#tabs)); an act opens its
  confirmation; a view shows
  it; a command does what its key does.
- **An `Enter` in the same read as the palette's opening runs nothing**, so
  a paste cannot open it and run a row.
- Closed, it gives the focus back to the terminal it was opened from.
  Recency is kept for the run only: nothing is written.

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
  `souls`, `capabilities`, `workspaces`, `palette`, `open`, `soul-instances`, `zoom`, `close-terminal`,
  `tab-previous`, `tab-next`, `stop`, `retire`, `start`, `restart`, `spawn`, `spawn-another`,
  `spawn-check`, `help`, `close`, `quit`, `suspend` and `redraw`. `workspaces` (`w`) opens the switcher and `open` (`enter`)
  opens the selected agent's terminal in the list of instances, the
  selected row in the switcher and the detail in the Souls view;
  `soul-instances` (`i`) shows the selected soul's instances. `zoom` (`z`) and `close-terminal` (`c`) act
  on the shown terminal, and `tab-previous` (`[`) and `tab-next` (`]`) show
  the tab before and after it. In an open filter field `Enter` keeps the filter,
  whatever key `open` has.
- A key is written as the help shows it, in lower case: `q`, `G`, `?`,
  `space`, `enter`, `tab`, `escape`, `backspace`, `up`, `pageup`, `f5`,
  `ctrl+c`, `alt+x`, `shift+tab`, `ctrl+alt+up`. Modifiers come in the order
  `ctrl+`, `alt+`, `shift+`. A terminal sends `Ctrl+H`, `Ctrl+I`, `Ctrl+J`
  and `Ctrl+M` as `backspace`, `tab` and `enter`, so those four are not
  keys of their own.
- `ascii: true` is `--ascii`.
- `open.detachKey` is **[the leader](#the-leader)**, `C-\` when you name
  none. It is `oats tui`'s own and never reaches the agent or the kernel.
  It is read as a key wherever the TUI reads keys, so it may not be a key
  an action has: `C-l` is `redraw`'s `Ctrl+L`, `C-k` the palette's
  `Ctrl+K`, `C-j` is `Enter`. It is one of
  these, written as shown: `C-` with a letter but `h`, `i` and `m` (a
  terminal sends those as `Backspace`, `Tab` and `Enter`) or one of `\`
  `]` `^` `_`; `M-` with a lower-case letter or a digit; or `F1` to `F12`,
  alone or with one of `C-`, `M-`, `S-` (`C-F5`). These are the keys a
  `tui.json` written for an earlier version could name, with the same
  meaning for the key.

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
| gives `open.detachKey` anything but one of the keys above | `open.detachKey must be one key: …`, with the keys it can be |
| gives `open.detachKey` a key an action has | `open.detachKey … is read as …, the key of …; give the leader a key no action has, or give … another` |
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
- **The souls are one more read**, `oats souls --json` for the open
  workspace, by the same kernel, with 60 seconds and 4 MiB: only once [the
  Souls view](#the-souls-view) was shown, then only when the workspace
  changed, and on `r` there.
- **A spawn's preview is one more read**, `oats spawn <soul> --preview
  --json` with the choices shown, by the same kernel, with 30 seconds: only
  while [the spawn prompt](#spawning-an-agent) is open, and again when a
  choice changes. An answer is reused for a minute, as the Desktop reuses
  it, until a spawn is applied or the workspace changes.
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
  <home>`, by the same kernel, in a pane of the run's private tmux server
  ([above](#open-an-agents-terminal)), with no key of its own. For an agent
  on another machine `oats session inspect --server <id> --home <home>
  --json` is asked first (20 seconds), then `oats session attach --server
  <id> --home <home>`. The reads go on while a terminal is open, and the end
  of a viewer reads at once.
- **The private tmux server** is `tmux` found on `PATH`, 3.2 or later. It
  is started at the first open of a run, with `-f /dev/null` and the
  environment's `TMUX` and `TMUX_PANE` removed, and its socket in the run's
  own directory. The control client that `oats tui` keeps for the run
  starts it, with `exit-unattached` set in the same command. Its first window is a keeper: it
  watches `alive`, a FIFO in the run's directory (0600, made with the
  system's `mkfifo`) that `oats tui` holds open for writing until it ends.
  When `oats tui` is gone, whatever ended it and at any moment, the keeper
  kills the server. The keeper needs two things from the base system,
  found on `PATH` like `tmux`.
  - **`mkfifo`** makes `alive`. Without it an open is refused: the line
    says the terminal could not be opened, with what was said under it.
  - **A way to tell that the server is still its parent.** The keeper reads
    that from `/proc` where the system has one (Linux), and otherwise asks
    `ps -o ppid= -p` (macOS). With neither (no `/proc`, and no `ps` or one
    that refuses `-p`, like BusyBox's), the keeper kills nothing. A normal
    end is not affected. An `oats tui` killed with SIGKILL can then leave
    its private server running, with its tabs' viewers still
    attached to their agents, until you end it with `tmux -S
    <run directory>/tmux kill-server`. The next run's sweep leaves that
    directory alone while its socket answers.

  Each tab is a window of the server, whose process is the viewer itself,
  with no shell between them. Beside the keeper it holds up to four, one
  of them shown, and every one has the panel's size: a resize resizes each tab's
  window. Only the shown tab's pane is captured and typed into. tmux tells
  `oats tui` of every pane's output: a hidden tab's output captures
  nothing, and only sets that tab's mark, once until the tab is shown and
  hidden again. The panel refuses a fifth open (`E_PANEL_FULL`, an open
  still under way counted) and a second open while one is under way
  (`E_PANEL_BUSY`); the TUI asks for neither, since it refuses such an open
  itself ([Tabs](#tabs)). It is closed with `kill-pane`, which hangs up
  the viewer's terminal: the viewer gets SIGHUP at once and removes its own
  session on the agents' server. The viewer's error output goes to a file
  of the run's directory (0600), read back when it ends and deleted. Its
  exit status is the one tmux keeps for a pane whose process ended
  (`remain-on-exit`), which the server reports to `oats tui` within a
  second; `oats tui` then closes that pane. tmux can report a pane ended
  before it has that status (3.4 does, when the viewer's terminal hangs up a
  moment before its process is reaped): `oats tui` then waits for the
  status, which follows at the next report, for ten seconds at most (2.5
  on tmux 3.2, which never says which signal ended a pane). A tmux built
  with libutempter can lose a status for good: as it destroys a pane at
  the hang-up, libutempter holds back SIGCHLD while its helper runs, and
  tmux, which reaps only on a SIGCHLD, leaves a viewer that exited in that
  moment unreaped (tmux 3.4). So while `oats tui` waits it sends the server
  `run-shell true` at once and every second: that child's end makes tmux
  reap the viewer too, and its status follows at the next report. A pane whose
  status has not come by then is taken as ended without one, and closed:
  the terminal closes with the line that the viewer ended without saying
  why. What the shown terminal
  shows is captured into `capture` in that directory, which the server
  writes and `oats tui` reads back, so nothing an agent prints passes
  through the stream on which `oats tui` reads the server's answers. An
  answer the server would never give ends that stream, and every tab
  closes with it. The server is ended
  on every way out a process can handle. At its start a run also removes
  what a run that is gone left (below), and nothing else: it signals
  nothing.
- **Every read runs in a session of its own** and is ended when the TUI
  ends, on every way out a process can handle (for SIGKILL see
  [below](#what-it-changes-in-your-terminal-and-restores)). Every tab's
  viewer ends with the private server. A read that was
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
- **A spawn runs the kernel's own `oats spawn`**, as the Desktop does: the
  prepare (a read, with the choices on screen) and then the apply of the
  decision on screen (`--expect-decision`, `--idempotency-key`), a change
  like the acts', with its output in the same directory. It has the
  deadline the shared apply gives it, as the Desktop's has: 60 seconds,
  more for each worktree setup a capability runs. Past it, the spawn is
  sent SIGTERM (by `oats tui`, through the shared apply), and on an OATS
  that rolls a spawn back on it, SIGKILL 20 seconds later if it still
  runs: the outcome is then not known, and `C` checks it. Those timers are
  the run's: once `oats tui` has gone, no deadline of a spawn it let go
  signals it, and none keeps the process waiting. The shared apply
  writes the task file `oats spawn --task-file` reads, empty, under the
  system's temporary directory (`oats-desktop-task-*`, mode 0600), and
  removes it when the spawn answers; a spawn let go on the way out leaves
  it.
- It runs no other command that changes a deployment or a registration, and
  it writes no other file but the private server's: its socket `tmux`, the
  keeper's FIFO `alive`, `capture` (the shown terminal's screen, which the
  server writes there for `oats tui` to read), and `owner.json` (`{ "tool":
  "oats-tui", "pid": …, "started": … }`), which lets a later run tell a
  directory a run that is gone left. A run that ends normally removes all
  four. A later run removes such a directory, these four files included, when its `pid` is not alive
  and its socket answers no tmux; it looks only at directories named `oats-tui-*` in the
  system's temporary directory, yours, of mode 0700, holding that file.

## What this version does not do

| To | Run |
|---|---|
| start an agent with another harness or model | `oats session start --home <home>` with its options |
| spawn an agent on another machine | `oats spawn <soul> --server <id>` |
| spawn an agent with another harness, model or task | `oats spawn <soul>` with its options |
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
  machine's heading when it is not the header's time. A view of one machine
  has no heading: there the header names the machine (`on garnet`) and
  carries the time.
- The Souls view lists a workspace of this machine's souls, and
  Capabilities, when it comes, is this machine's too.
- There is no sorting and no mouse, and a deployment's heading cannot be
  folded. An open terminal has no scrollback but the viewer's own.
- Up to four terminals are open at a time, as tabs. A tab cannot be moved
  or split, and no tab is kept from one run to the next, or across a switch
  of workspace.
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

While it draws:

- **every frame is one synchronized update**: it begins with
  `CSI ?2026h` and ends with `CSI ?2026l`, so a terminal that knows the
  mode shows the frame whole and one that does not ignores it. The mode is
  set and reset inside each frame and is never left on; a frame with
  nothing to change writes nothing;
- **while an agent's terminal has the focus the cursor is shown**
  (`CSI ?25h`) where the agent's is, when the agent shows one, and hidden
  again (`CSI ?25l`) when the focus leaves it.

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

**While an agent's terminal is open** the terminal stays `oats tui`'s: the
viewer draws into the private server's pane, never into your terminal, and
`oats tui` draws what the shown tab's pane shows. Every way out in the
table above ends the private server and with it every tab's viewer, with
that status. A suspend
leaves the server and its viewers running; `fg` draws the terminal afresh.

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
read that was in flight runs to its own end. The open terminals' private
server is ended by its keeper as soon as `oats tui` is gone, so each tab's
viewer has its terminal hung up and removes its own session. A stopped `oats tui`
(`Ctrl+Z`, SIGSTOP) still holds the keeper's FIFO, so its server is left
alone. The next run removes the directory that is left, with its `tmux`,
`alive`, `capture` and `owner.json`.

## What it never does

- It switches on **no mouse reporting, no focus reporting, no keyboard
  protocol and no keypad or cursor-key mode**, and leaves no synchronized
  update on between frames.
- It writes **no window title, no clipboard sequence, no bell**, and no query
  that expects the terminal to reply.
- **Its own words and marks use only your terminal's own sixteen colours**
  and bold, dim, underline and reverse: no 256-colour or RGB value and no
  background fill, so your theme stays the theme. An open terminal shows
  the agent's screen in the agent's own colours (256-colour and RGB
  included) and attributes: those are the agent's. With `NO_COLOR` set and
  not empty it uses no colour at all, the agent's included; the agent's
  bold, underline, reverse and the like stay. Nothing is told by colour
  alone.
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
- It changes nothing in your tmux or the agents': no option, key binding,
  server, session, window or pane. Its probe only lists panes. An agent's
  own session is started, ended or restarted only by the kernel's commands
  of an act you confirmed
  ([above](#stopping-starting-restarting-and-retiring)), and an agent's
  terminal is opened by `oats session attach`, which makes its own viewer
  session on the agents' tmux server and removes it. The one tmux server
  `oats tui` runs is its own private one
  ([above](#open-an-agents-terminal)), and it never looks at another's
  socket but to ask whether a dead run's still answers.
- It starts no daemon, and writes no file but the output of a change and
  its private server's own, in its own directory
  ([above](#what-it-reads-and-what-it-runs)), and a spawn's empty task file
  ([above](#what-it-reads-and-what-it-runs)). The processes it starts are
  the reads above, when you open an agent its private tmux server and the
  viewers in it, one for each tab, and the acts you confirm. No read, server or viewer
  outlives it on every way out a process can handle; after SIGKILL a read
  in flight runs to its own end, and the private server and its viewers end
  by themselves. An act you confirmed is never ended by `oats tui`: it runs
  to its own end. A spawn is ended only at its deadline, while `oats tui`
  runs ([above](#what-it-reads-and-what-it-runs)): never on the way out,
  and never after it.

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
