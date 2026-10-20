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
  terminals as tabs, in one group or two ([Splits](#splits)), spawns an agent
  on this machine, and stops, starts, restarts
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
is in no deployment, it reads this computer's list of deployments,
`oats deployments --json` ([This computer's
deployments](workspaces.md#this-computers-deployments)), through the kernel
it shipped with. When the list holds a row it starts with the switcher, and
nothing is open until you open a row. When the list holds none it prints
one line (`E_NO_DEPLOYMENT`) and exits 1 without touching the terminal, and
when the list cannot be read it prints the kernel's code and message
instead, which say what to do. With `--dir`, nothing is offered in place of
a path that is in no deployment: the `E_NO_DEPLOYMENT` line that names
`--dir`, and exit 1.

**Opening a deployment lists it.** The deployment a run starts in, from
where you are or from `--dir`, is added to this computer's list once, as the
TUI's (`oats deployments add <path> --via tui --json`), also when you had
removed it from the list. It is best effort: a failure opens nothing less,
and is said once, in the line under the title, in the kernel's words. When
it comes while the switcher, the help, a confirmation, the palette, the
spawn prompt, a detail or a terminal has the screen or the focus, it is said
once a view's list has the focus again, so no screen that covers the
sidebar hides it. A deployment opened from the switcher is
on the list already.

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
 acme-platform                        │   dev
                                      │   soul     dev
 Instances                          1 │   state    running
> ● dev                               │   harness  claude, claude-opus-5-5 (so…
                                      │   work     worktree, agents/dev
  ● reviewer              Needs input │   team     eng
    ○ helper                          │   started  11:00
──────────────────────────────────────│   home     …oy/agents/dev/instances/dev
 Souls                              2 │
 Capabilities                       3 │
──────────────────────────────────────│
 Alt+O    commands                    │
 Ctrl+K   palette                     │
 Enter    open                        │
 n        spawn                       │
 w        workspaces                  │
 ?        help                        │
 q        quit                        │
                                      │
```

The screen is the sidebar on the left and the main area on the right, with
a rule between them over every row. There is no header and no footer. From
80 columns the sidebar takes about half the width (36 to 60 columns, 30
while a terminal is open); under 80 columns it has the whole width.

- **The title** is the sidebar's first row: the workspace's name, then what
  the view holds of other machines. Beside a deployment of this machine the
  other machines are counted: `+1 machine`, `+2 machines`. A view that holds
  no deployment of this machine names its one machine, `on garnet`, or
  counts them when there are two or more, `2 machines`. While
  [the switcher](#the-switcher) is shown the title is `workspaces`.
- **Under the title** stands what the view needs to say first, wrapped to
  the sidebar's width: a deployment's state when it is not live, with
  `since …` and its reason on rows of its own; the note of a view of one
  deployment; and the line that says what happened after an open, an act or
  a spawn. Then an empty row.
- **The views** follow as an accordion, always in this order: `Instances`,
  `Souls`, `Capabilities`, each with its key dim at the right edge. The open
  view's heading is bold and its list stands under it, with a rule between
  it and the views before and after it. `1`, `2` and `3` open them in the
  list, and [the leader](#the-leader) then `1`, `2` or `3` from anywhere;
  the leader's hint, [the palette](#the-palette) and the help name those
  keys. [The Souls view](#the-souls-view) lists the open workspace's souls,
  and [the Capabilities view](#the-capabilities-view) its capabilities. A
  workspace with no instances reads `No agents yet: n spawns one`, with the
  key `spawn` has (`No agents yet.` when it has none).
- **The cheat sheet** comes last, under a rule: a few keys, one per row,
  the key in bold and what it does beside it. Its first row is the
  leader, `Alt+O commands`, which reaches every action (but while a
  terminal has the focus under the kitty keyboard protocol, below); then
  `Ctrl+K palette`. In a view's list it names what `Enter` does now
  (`open`, `focus terminal` on the row whose terminal is open, `detail`
  in the Souls and Capabilities views), then `n spawn` where it spawns,
  `w workspaces` (the [switcher](#the-switcher)) in the Instances view,
  and `? help` and `q quit` last; with the detail's focus `Tab back`
  comes before `Enter`. The other keys (the acts, `/`, `Tab`, `r`,
  and a terminal's `z`, `c`, `[` and `]`) are not listed there:
  the leader's hint, the palette and the help name them. While the
  terminal has the focus, in an overlay and in the filter field it names
  the keys that work them. While the leader waits for its key the rows are
  the leader's hint.
  Everything flows from the top, so empty rows are at the bottom. On a
  short screen the list keeps its rows first: the cheat sheet gives up rows
  from its end, down to the leader alone, then the empty row under the
  title goes, and the list scrolls in what is left.
- **The main area** holds the selected row's detail, an
  [open terminal](#open-an-agents-terminal), or an overlay: the switcher,
  the palette, the spawn prompt, the help or a confirmation. From 80
  columns an overlay covers the main area and the sidebar stays beside it,
  its cheat sheet naming the overlay's keys. Under 80 columns the detail
  and every overlay cover the whole screen, and their first row carries
  their keys at the right, dim: the detail's `Tab back` first.
- **The counts and the time of the read are not on the screen.** The help's
  top row has the time of the read of this machine that the screen shows,
  `read 14:03:27`, which moves with every read, and how many rows the
  kernel reported that were withheld (a home outside its soul's directory,
  or one reported twice), `2 withheld`, when there are any.
- **The list** is the roster the Desktop draws: the same groups in the same
  order, from the same code. It is in name order, by each group's top
  instance, so starting or stopping an instance moves nothing. An instance
  that others were spawned from has them indented under it, and keeps its
  place when it gains or loses one. An empty row stands between each run
  of instances related to no other and the group before or after it. The
  indent alone says which instance is under which: no mark is drawn for
  it. A row whose instances are folded away (`h`) says how many after its
  name: `+1`.
- **Each row** is the mark of its state and the name, then, when it needs
  input, a tag at its right edge in the Desktop's words: `Needs input`. A
  folded row with waiting instances among those it folds away says how
  many: `3 below`, and `99+ below` past 99. A row that needs input itself
  and folds waiting ones away says `Needs input`, as the Desktop's row
  does: the detail's `below` line names the others. The tag is in reverse
  video in the waiting colour, and on the selected row, which is in reverse
  video already, it is the waiting colour not reversed, a gap in the
  selection's bar; under `NO_COLOR` the reverse video alone carries it. On
  a narrow row the tag gives way first: it says its words only where the
  whole name, its `+1` and the row's word in its column all fit beside them,
  and else shrinks to `!`, or the count alone (`3`, `99+`), still in
  reverse video, in the cells every row keeps at its right edge. So the
  tag never cuts a name, a word or a mark: those give way as on a row
  that does not wait. The harness and the state in words are in
  the detail. A row has a word, dim, only where its mark cannot say it: the
  state of a home a spawn or a retire holds (`Retire didn't finish`), or
  the shared words for why an instance cannot be reached or opened:
  `gone from garnet`, `garnet not reached`, `not reachable on garnet`,
  `Herdr no longer supported`, `state unknown`. The words stand in a
  column of their own. The name comes first: on a narrow sidebar, where
  the column would leave the name less than 16 cells, the word is cut to
  what the name leaves, or left out when that is under 6 cells; the mark
  and the detail still say it.
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
  branch, team, parent and siblings, when it last started, and its home.
  The siblings are the instances at the other end of an explicit sibling
  link, either way, as the Desktop reads them: `sibling of a`, `sibling of
  a and b`, `sibling of a, b and c`. They are read inside the instance's
  own deployment, and a name that is no instance there, or two of them, is
  not shown. From 80 columns up it stands beside the sidebar; on a narrower
  terminal `Tab` opens it as a page over the whole screen.
- **Opening an agent.** `Enter` on an instance that runs opens its terminal
  beside the sidebar, where the detail was, as a tab: see
  [Open an agent's terminal](#open-an-agents-terminal) and [Tabs](#tabs).

**A view of more than one deployment** (this machine and another, or two
deployments on one machine) is one list, grouped as the Desktop groups it:

- **Each deployment has a heading**, and its instances stand under it,
  grouped as above. The heading is `This machine` or the machine's name,
  with the end of the deployment's path when one machine holds two of the
  view. A heading cannot be selected or folded: the movement keys pass over
  it. A view of one deployment has no heading.
- **A machine's heading is its name.** When its rows were read at another
  time than this machine's (the one on the help's top row), that time
  stands at the right of the heading: `read 14:03:21`. A row of another
  machine shows what its host reported at that time.
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
  deployment, which has no heading, it stands under the title.
- **The detail has a `machine` line**, the machine the selected instance is
  on. When that deployment is not live, the whole sentence that says why
  follows it.

**A view that holds no deployment of this machine** says so in its title:
`other  on garnet` for one machine, `2 machines` after the name for
two or more. The time on the help's top row is then the time the machines'
rows were read. A view of one machine has no heading, so its state, when it
is not live, is said under the title with the reason, as for a deployment
of this machine. When no row of that machine is kept either, nothing is drawn
under the reason: no list and no detail.

**A machine that has not answered in this run is not in its workspace's
list.** `oats tui` keeps nothing on disk of its own, so it cannot tell which workspace
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
| `Needs input` | `Needs input` | needs input: a tag in reverse video at the row's right edge, `!` where the whole name does not fit beside the words |
| `N below` | `N below` | N instances folded away below it need input, `N` where the whole name does not fit beside the words |
| `>` | `>` | the selected row (also drawn in reverse video), and the pane the movement keys act on |
| `*` | `*` | in the switcher: the workspace that is open |

Every state has a mark of its own shape, so nothing is told by colour alone.

**An instance's colour** (feature `instance-color`; set with
`oats instance color <instance> <colour>`, [desktop-cli-api.md](desktop-cli-api.md#an-instances-colour-oats-instance-color))
colours its mark, in the list and in a soul's detail: a running mark in it, a
stopped one and one with a shell left in it dim in it. `?` and `◆` keep their
own look whatever the colour, and an instance with no colour looks as above.
The six colours are the terminal's: `sand` yellow, `sage` green, `slate` blue,
`mauve` magenta, `clay` red, `olive` cyan, the souls' own map. Which colour a
row shows is the Desktop's rule (`instanceColor` in `packages/client`); an
older kernel reports none. Setting a colour from the TUI is not in this
version.

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
is said in words under the title, with the reason on rows of its own. When
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
 acme-platform                │[backend-lead]
                              │$ make docs
 Instances                  1 │Building the reference...
> ● backend-lead              │
  ● docs-writer               │
──────────────────────────────│
 Souls                      2 │
 Capabilities               3 │
──────────────────────────────│
 Alt+O         commands       │
 Alt+O Esc     the list       │
 Alt+O Alt+O   types Alt+O    │
```

- **`Enter` on an instance that runs** opens its terminal on the right of
  the sidebar, where the detail was, over every row. Its top row is the
  [tab bar](#tabs), here one tab: the agent's name in brackets (and
  ` · <machine>` for one of another machine); under it is the
  agent's screen, as the agent draws it, in its own colours. While a
  terminal is open the sidebar keeps 30 columns at most, also while the
  detail stands in the terminal's place, and a name longer than its row is
  cut with `…` (`...` in ASCII).
- **The terminal has the focus.** What you type, what you paste and every
  key go to the agent exactly as typed, `Ctrl+C`, `Ctrl+Z`, `Esc` and `q`
  among them, but for **[the leader](#the-leader)** (`Alt+O`, `Ctrl+\` on
  macOS, unless [`tui.json`](#change-the-keys-tuijson) names another), the
  one key the TUI takes from the agent, and the [chords](#chords) (the
  Ctrl+Alt ones, or the Ctrl+Shift ones under
  [the option](#switch-to-ctrlshift), while your terminal sends them). Under the kitty keyboard protocol every key reaches
  the agent as the bytes it sends without it. The leader then `Esc` gives the
  focus to the list; the leader twice types the leader into the agent; the
  leader then another key does what that key does from anywhere. While the
  terminal has the focus the cheat sheet names those three:
  `Alt+O commands`, `Alt+O Esc the list`, `Alt+O Alt+O types Alt+O`.
  While the terminal confirms the kitty keyboard protocol
  ([Chords](#chords)) the chords come first: `Ctrl+Alt+K palette`,
  `Alt+Shift+Up/Down agent`, `Alt+Shift+Left/Right tab` (with two tabs or
  more), `Ctrl+Alt+W close`, `Ctrl+Alt+Z zoom` (`Ctrl+Shift+K`,
  `Ctrl+Shift+W` and `Ctrl+Shift+M` under the option), then the leader's three.
  Without it the leader's three lead, and the Alt+Shift arrows follow them.
  On a short screen the sheet gives up rows from its end, and the leader's
  `commands` last of all. A leader inside a bracketed paste is pasted, not
  taken.
- **With the list focused** the terminal stays open, and the agent's screen
  is still drawn as it changes. The cheat sheet names `Enter focus terminal`
  on its row; the leader's hint names `z zoom` and `w close terminal`.
  - `Enter` on the shown terminal's row gives it the focus again.
  - `z` gives it the focus and the whole screen: the sidebar is hidden. The
    leader then `Esc` brings the sidebar back beside it, and the leader then
    `z` zooms it out and in without leaving it.
  - `c` closes it, and the leader then `w` from anywhere: the agent keeps
    running. The tab beside it is shown; with no other tab the right side
    is the detail again.
  - `Tab` shows the detail in its place until `Tab` or `Esc`. Nothing of
    the terminal is drawn meanwhile, and its screen is read afresh when it
    shows again.
- **Up to four terminals are open at a time, each a tab.** `Enter` on
  another instance that runs opens its terminal in a new tab, and the
  others stay open: see [Tabs](#tabs).
- **Under 80 columns** the terminal is always shown with the whole screen
  when it has the focus. With the list focused the sidebar is shown alone;
  the terminal stays open, unseen, and `Enter focus terminal` in the cheat
  sheet shows it again. Beside the sidebar the terminal is never narrower
  than 40 columns: with less room it has the whole screen too.
- **With the whole screen** (zoomed, or a narrow terminal) no cheat sheet is
  drawn. The terminal's tab bar carries the keys at its right, dim:
  `Alt+O commands   Alt+O Esc the list`, after the chords under the kitty
  keyboard protocol, as many as fit, and while the leader waits, the
  leader's hint, as many keys as fit, `Esc the list` last. The agent's
  screen keeps every row under it.
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
  still closes within a second or two with the line its status calls for. The instances are then read again at once, and the line under the title
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
 acme-platform                │[backend-lead]│ docs-writer• │ qa-runner
                              │$ make test
 Instances                  1 │ok 41 of 41
> ● backend-lead              │
  ● docs-writer               │
  ● qa-runner                 │
──────────────────────────────│
 Souls                      2 │
 Capabilities               3 │
──────────────────────────────│
 Alt+O         commands       │
 Alt+O Esc     the list       │
 Alt+O Alt+O   types Alt+O    │
```

Each terminal open in the panel is a tab, and the panel holds up to four.

- **The tab bar** is the panel's top row whenever a terminal is open, with
  one tab or many, as a terminal's own tabs read: each tab's agent, in the
  order the tabs were opened, a dim `│` (`|` in ASCII) between two tabs.
  - **The shown tab** is the one whose screen the panel draws, the front
    tab. It stands in brackets, `[backend-lead]`, a mark that needs no
    style, so it reads the same under `NO_COLOR` and in ASCII. Its name is
    bold, and the whole tab is in reverse video while the terminal has the
    focus.
  - **The other tabs are hidden**, dim, a cell on each side of the name. A
    hidden tab whose agent wrote since it was last shown has `•` after its
    name (`*` in ASCII), not dim; the mark goes when the tab is shown. A
    hidden tab's screen is not read: only that its agent wrote.
  - **An agent of another machine** reads `<name> · <machine>` inside its
    tab, the machine dim (`-` for `·` in ASCII): `[billing-lead · garnet]`.
  - **A bar longer than its row is cut** in this order: the hidden tabs'
    machines, then the hidden tabs' names, each to an equal share of what
    the shown tab leaves, with `…` (`...` in ASCII), then the shown tab's
    machine; then the hidden tabs farthest from the shown one are left out
    of the row with their dividers (they stay open). The shown tab's name
    stays whole while the row can hold it, and is cut last.
  - The TUI takes no mouse input: a tab is shown with the keys below.
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
    the line under the title says `4 terminals are open; close one with Alt+O w.`
    (with your leader, when [`tui.json`](#change-the-keys-tuijson) names
    another). A tab still starting, and an agent of another machine while
    it is asked, hold a place among the four. An instance that cannot be
    opened says why, as it does with no tab open.
- **Switching.** `[` and `]` in the Instances view, from the list or the
  detail, show the tab before or after the shown one; the help names them,
  and the leader's hint names the leader's own while two tabs or more are
  open. The leader then
  `Left` or `Right` does the same from any focus, and from another view
  goes to the Instances view first.
  - The bar does not wrap: on the first tab `[` does nothing, and on the
    last `]`; the leader then `Left` or `Right` there leaves even the focus
    where it was.
  - The focus does not move: in the terminal it stays in the terminal,
    zoomed or not, and in the list it stays in the list.
  - **Showing a tab selects its instance's row** in the list and brings it
    into view: a filter that hides the row is cleared, and an instance
    folded over it is opened.
- **The palette** groups the instances as [The palette](#the-palette) says,
  the group last used first, as the Desktop's does. When the first of them
  is the shown tab's, the palette opens on the instance shown before it,
  wherever its group puts it, so the palette then `Enter` goes back to that
  terminal.
- **Closing.** The leader then `w`, or `c` in the Instances view, closes the
  shown tab: its agent keeps running. The tab to its right is shown, else
  the one to its left.
  - After the leader then `w` from a terminal, the tab shown next has the
    focus, and is zoomed when the one closed was. After `c`, or the leader
    then `w` from anywhere else, the terminal does not take the focus.
  - Closing the last tab closes the panel: the right side is the detail
    again, and the list has the focus.
- **A tab that closes by itself**, when its viewer ends, says so on the line
  under the title in the words [above](#open-an-agents-terminal), for that
  tab's agent (no line when it ended cleanly).
  - The shown tab: the tab to its right is shown, else the one to its left,
    and the list takes the focus.
  - A hidden tab: the shown tab and the focus stay as they were.
- **Zoom** (`z`, or the leader then `z`) gives the shown tab the whole
  screen. The tab bar stays its top row, and the other tabs stay open.
- **The tabs are the open workspace's.** Opening another workspace in
  [the switcher](#the-switcher) closes them all, and so does the open
  workspace no longer being listed; their agents keep running. Coming back
  opens none of them again. Opening the same workspace again, with its
  deployment of this machine now opened beside another machine's, keeps
  them.

## Splits

```
 acme-platform                │ backend-lead  docs-writer              │ qa-runner
                              │$ git log --oneline -2                  │$ make test
 Instances                  1 │4be1c0d Fix the reader                  │ok 41 of 41
  ● backend-lead              │9a03e7f Add the roster                  │
  ● docs-writer               │                                        │
> ● qa-runner                 │                                        │
──────────────────────────────│                                        │
 Souls                      2 │                                        │
 Capabilities               3 │                                        │
──────────────────────────────│                                        │
 Alt+O         commands       │                                        │
 Alt+O Esc     the list       │                                        │
 Alt+O Alt+O   types Alt+O    │                                        │
```

The panel can be split in two **groups**, side by side or one above the
other. Each group is a panel of [tabs](#tabs) of its own: a tab bar, a shown
tab and the marks of its hidden ones.

- **Splitting.** The leader then `|` splits the panel side by side, and the
  leader then `-` one above the other; in the Instances view `|` and `-`
  do the same without the leader. The tabs open stay in the first group
  (left, or top). The second group starts empty and is the focused group.
  - A split needs a tab open, and none starting.
  - **There are at most two groups.** With two, the split keys do nothing,
    and the line under the title says `The panel has two groups already.`
  - **Each group needs 40 columns side by side, and 8 rows one above the
    other**, its tab bar counted. The panel beside the sidebar then needs 81
    columns (a terminal of 112), or 17 rows. A split that would leave a
    group smaller does nothing, and the line says so:
    `No room to split side by side: each group needs 40 columns.` or
    `No room to split one above the other: each group needs 8 rows.`
- **What is drawn.** A rule separates the groups. Both groups' shown tabs
  are drawn as their agents write; hidden tabs only set their marks.
  - The focused group's tab bar is drawn as with one group: its shown tab in
    reverse while its terminal has the focus, bold otherwise. The other
    group's shown tab is bold, never in reverse, so one terminal at a time
    reads as the one you type into.
  - **An empty group** says `Enter on an agent opens it here`, in reverse
    while it is the focused group, and the leader's keys to go to the other
    group or to close it. It never takes keys: while it is the focused
    group, the keys are the list's.
  - A resize gives each group its share and reaches every tab's window in
    it. **When the terminal becomes too small for both groups,** the split
    stays and the focused group is drawn alone; the other group's shown tab
    is not drawn, only marked, until there is room again.
  - **Under 80 columns** the terminal's focus gives the whole screen to both
    groups, and the list's focus shows the sidebar alone, as with one group.
  - **Zoom** (`z`, or the leader then `z`) gives the focused group's shown
    terminal the whole screen, and the same key brings the split back. With
    the empty group focused it does nothing.
- **Opening.** `Enter`, the palette, the leader then `Up`/`Down` and a
  spawn open as with one group:
  - an instance that has a tab, in either group: that tab is shown in its
    group, and that group takes the focus;
  - any other: a new tab in the focused group, after its shown tab, or as
    the first tab of the empty group.
  - **The four tabs are counted across both groups.** At four, the line
    says `4 terminals are open; close one with Alt+O w.` as with one group.
- **Moving between the groups.** The leader then `Tab` from a terminal goes
  to the other group's shown terminal, or to the other group when it is
  empty. From the list it goes to the focused group's terminal, or, with
  the focused group empty, to the other group's. Showing a tab selects its
  row in the list. `[`, `]` and the leader then `Left`/`Right` show the tab
  before or after within the focused group only.
- **Moving a tab.** The leader then `m` moves the focused group's shown tab
  to the other group, after that group's shown tab, and shows it there with
  the focus. The group it leaves shows its neighbour, or stays, empty.
- **Closing.** Closing a tab (`c`, or the leader then `w`) shows its
  neighbour in its group: the tab to its right, else the one to its left.
  - **A group's last tab closed removes the group:** the other takes the
    whole panel and the focus. When the other group was empty, the panel
    closes, as when the last tab of the only group closes.
  - The leader then `x` closes the focused group while it is empty: the
    other takes the whole panel and is the focused group, and the keys stay
    the list's. With tabs in the group, `x` does nothing.
  - **A tab that closes by itself** shows its neighbour in its group. A
    group's last tab closing by itself removes the group, and the list
    takes the focus; when what is left is an empty group, the panel closes.
- **The palette** lists `Split right` and `Split down` while there is one
  group, then `Move tab to the other group` while the focused group shows a
  tab, or `Close the empty group` while it is empty.
- **Another workspace** closes every tab and the split.
- The split cannot be resized or nested, and is not kept from one run to
  the next.

## The Souls view

`2`, or the leader then `2`, shows the souls of the open workspace: the
ones `oats spawn` can make an instance of here, as the OATS Desktop lists
them, from the same code.

```
 acme-platform                        │   dev
                                      │   Builds and ships the platform.
 Instances                          1 │   from     oats-core
──────────────────────────────────────│   works    works in its own worktree
 Souls                              2 │   harness
> ■ dev ·2                            │     No default harness: you choose one
  ■ ops !                             │     when you launch it.
  ■ reviewer ·1                       │   instances here
──────────────────────────────────────│     ● dev-1  ● dev-2
 Capabilities                       3 │     i shows them in the Instances view.
──────────────────────────────────────│
 Alt+O    commands                    │
 Ctrl+K   palette                     │
 Enter    detail                      │
 n        spawn                       │
 ?        help                        │
 q        quit                        │
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
  whole screen), and the movement keys then scroll it.
- **`i`**, or `Enter` in the detail, shows that soul's instances in the
  Instances view: an exact filter, named where a kept filter stands, on
  the view's heading: `Instances  soul dev`.
  An instance of another soul whose name holds `dev` is not listed. `Esc`
  clears it, and `/` replaces it with a text filter.
- **`r`** reads the souls again; while a read is under way it starts
  nothing. `Esc` closes the detail, then clears a kept filter, then goes
  back to the instances.
- **When it reads:** the first time the view is shown, never before: a run
  that never shows it, nor [the Capabilities
  view](#the-capabilities-view) or [the spawn prompt](#spawning-an-agent),
  which need the souls too, never runs `oats souls`. After that, a read of the
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

## The Capabilities view

`3`, or the leader then `3`, shows the capabilities of the open workspace:
the ones its repositories and its packages offer, as the OATS Desktop lists
them, from the same code.

```
 acme-platform                        │   aweb Messaging
                                      │   Messaging over aweb, mail and chat,
 Instances                          1 │   for every instance of the workspace.
 Souls                              2 │
──────────────────────────────────────│   Comes from
 Capabilities                       3 │     Repository   oats
 Workspace owned                      │     Latest       bbbbbbb
  oats · member repo · host           │     Path         capabilities/aweb
>   aweb Messaging                    │
  tools · member repo                 │   Provides
    notes                             │     Skills    oats-aweb, aweb-messaging
 Packages                             │     Hooks     SessionStart
  oats-okf · package · v1.2.0         │
    okf-knowledge Knowledge           │   Used by  2 souls
──────────────────────────────────────│     ■ dev ·2 · 1 on an older version
 Alt+O    commands                    │     ■ reviewer ·1
 Ctrl+K   palette                     │
 Enter    detail                      │
 ?        help                        │
 q        quit                        │
```

- **The list** is in the Desktop's sections: Workspace owned, Repo owned
  and Packages. A section with no capability is not drawn, so Repo owned
  stands only when the workspace has one. Under a section each repository
  or package has a dim heading, its name and a note: `oats · member repo ·
  host` (`-` in ASCII). A row is the capability's name, then its layer's
  label, dim, when it has one: `Knowledge`, `Messaging`, `Tasks`. The list
  keys move among the capabilities and pass over the headings. `/` filters
  by name, and a group or a section the filter leaves empty is hidden. A
  workspace with none says so, and that `oats capabilities` says why.
- **The detail** beside it, top to bottom:
  - the name, its layer's label and the description;
  - **Comes from**, a label and a value a line: for a repository's
    capability its repository, its latest commit, its path and its
    fingerprint, and for a repo-owned one that it is that repository's
    souls' only; for a package's, the package, the version it is pinned to
    and where that comes from, the commit and the fingerprint;
  - **Provides**: its skills, commands and hooks, each kind the kernel
    reports with its names; a kind it could not list says `Not listable: a
    spawn of it would refuse.`, and one with no name `None`;
  - **Used by**, with the count of souls beside it: one line per soul, its
    colour mark (as in the Souls view), its name, a dim count of its
    instances on this machine that carry the capability, `·2` (`x2` in
    ASCII; `·0` too), and, when some of them are on an older version of
    it, `· 1 on an older version` in the warning style. Eight at most, then
    `+n`. With an OATS that reports what each soul is composed of (the
    `souls-capabilities` feature, 0.45.0), these are the souls that include
    it, and with none it says `No soul here includes it.` With an older
    OATS they are the souls whose instances carry it, and with none it says
    `No instance carries it yet.` A soul the souls catalog does not list is
    drawn uncoloured. With the feature, until the souls are read it says
    `Reading souls…`, and a read of them that fails says why, in the
    warning style.
- **`Enter`** gives the detail the focus (under 80 columns it takes the
  whole screen), with a mark, `>` in reverse video, on the first soul of
  Used by. `Up` and `Down` move the mark among the listed souls, and the
  detail scrolls to keep it in sight. Past the first or the last soul, and
  with the other movement keys, the detail scrolls; with no soul listed
  every movement key scrolls it. `Enter` on the marked soul shows it in
  [the Souls view](#the-souls-view), selected; on a soul the souls catalog
  does not list it does nothing. `Tab` moves between the list and the
  detail.
- **`r`** reads the capabilities again; while a read is under way it starts
  nothing. `Esc` closes the detail, then clears a kept filter, then goes
  back to the instances.
- **When it reads:** the first time the view is shown, never before: a run
  that never shows it never runs `oats capabilities`. It reads the souls
  too, for Used by, when they were not read yet. After that, a read of the
  workspace reads the capabilities again only when the workspace changed
  (its commit, a member's, its externals, its packages or its lock), and
  `r` does. While the first read is under way the view says `Reading
  capabilities…`. A read that fails says why, `Couldn't read this
  workspace's capabilities:` and the message, with `r` to try again; one
  that fails after a good one keeps the capabilities it had, under a
  heading that says it failed and when they were read; the selected
  capability's detail says why in full, under its name.
- **What is kept:** the selected capability and the filter, when the view
  is left and shown again, for the run.
- **Only this machine's:** the view lists the capabilities of a workspace of
  this machine. With none open it says so.

[The palette](#the-palette) lists the capabilities once they are read,
each with where it comes from; choosing one shows this view with it
selected.

## The switcher

`w` opens the switcher: what this run can show, over the main area. The
sidebar's title says `workspaces` and no view is open; under 80 columns the
switcher covers the whole screen.

```
 workspaces                                     │ > * acme-platform
                                                │       This machine
 Instances                                    1 │       garnet
 Souls                                        2 │     lfx
 Capabilities                                 3 │       This machine · not opened
────────────────────────────────────────────────│       athenea (lfx)
 Alt+O    commands                              │   Not matched to a workspace
 Ctrl+K   palette                               │     basalt                ssh needs a prompt
 Enter    open                                  │   On this machine, not opened
 /        filter                                │     acme-docs             Timed out · ~/acme-docs
 r        refresh                               │     sandbox               Not found.
 Esc      close                                 │
 ?        help                                  │
 q        quit                                  │
```

It lists, in this order:

- **The workspaces**, one row each, by name. Under each stands one dim line
  per deployment of it:
  - the machine it is on (`This machine`, `garnet`), with the folder's last
    segment when one machine holds two deployments of it;
  - then its state when it is not live: `not opened` for a deployment of
    this computer's list that this run has not opened, else the words the
    sidebar's headings use (`not observed`, `not reached`, `stale`,
    `remembered`).

  A workspace is what the rules shared with the Desktop make of the
  deployments opened in this run, of what the registered machines answered,
  and of the deployments of this computer's list whose workspace was read
  (below): the ones that report the same workspace (its key and default
  team) are one row, whichever machine they are on. Its name is the one a
  deployment of this machine gives it: the workspace's own name once one is
  opened and read, the folder's name of one that is not, else the last part
  of the workspace's key. `*` marks the workspace that is open.
- **`Not matched to a workspace`**: what those rules matched to no
  workspace, each by its own name with a short reason. A machine that has
  not answered in this run is listed here.
- **`On this machine, not opened`**: the rows of this computer's list of
  deployments (`oats deployments`) that this run has not opened and that no
  workspace took, in the list's order, each by its folder's name and its
  path. A row whose workspace is not known yet says nothing more; one whose
  read failed says why before its path (`Timed out`, `Not read`), and so
  does one whose workspace attaches to none (`Workspace not known yet`,
  `Invalid workspace reference`, `Reports no workspace`), so a narrow row
  cuts the path, not the reason; both still open.
  A row that cannot be opened says why where its path stood, and does not
  open:

  | The row says | The list's state |
  |---|---|
  | `Not found.` | `missing`: the folder is gone, or on a volume that is not mounted |
  | `Not an OATS deployment any more.` | `not-a-deployment`: the folder has no `oats-local.yaml` |
  | `Can't be read.` | `unreadable`: the check failed, for example for a permission |

  The list is read once at the start, when the switcher opens, on `r` in
  it and after a Remove. When a read fails, the rows of the last read stay,
  under a line that says the list could not be read, with the kernel's
  message.

**How a deployment of the list finds its workspace.** Each row of the list
that this run has not opened and that the kernel says is a deployment is
read for its workspace identity: `oats status --dir <path> --json`, the
same read an opened deployment gets, whose `workspace` object says which
workspace and default team it is.

- **When:** once at the start, and again each time the switcher is opened
  and on `r` in it, after the list is read. Never on a timer.
- **How:** one at a time, each with its own 30 seconds, all of them within
  60 seconds. A read still running when the 60 seconds are up is ended,
  and it and the ones not begun say `Timed out`.
- **The switcher never waits for them:** it is drawn at once, and each
  answer moves its row into its workspace's as it comes in. A later
  answer replaces an earlier one; nothing else is read from such a
  deployment until it is opened.

| Key | Does |
|---|---|
| `Up` `k`, `Down` `j`, `g` `Home`, `G` `End`, `PageUp`, `PageDown` | move the selection among the rows; a heading is passed over |
| `Enter` | opens the selected row |
| `/` | filters the rows by what they show: a name, the machines, a path |
| `r` | reads now, and reads this computer's list of deployments again |
| `Delete` | on a row of `On this machine, not opened`, asks whether to remove it from this computer's list; the cheat sheet names it while such a row is selected |
| `Esc` | while a Remove is asked, keeps the row; else clears a kept filter; else closes the switcher, back to the view that was open |
| `1` | closes the switcher, back to the view that was open |

**Enter on a workspace** opens its view. Every deployment of it on this
machine that this run has not opened is opened first: asked whether it is
still a deployment, as a row of the list is, then read with the others from
then on. The view holds it and the other machines' deployments of the
workspace at once, `not observed` until its first read. One that is no
longer a deployment is not opened, and the workspace opens on its other
deployments; with none to open, the switcher stays and the list is read
again. **Enter on a row of the list** opens that deployment in this run:
from then on it is read with the others, and its workspace is the open
view. A folder that stopped being a deployment
since the list was read is not opened: its row says
`Not an OATS deployment any more.` where its path stood.

**Remove** takes a row off this computer's list
(`oats deployments remove <path>`); nothing on disk is touched, and the
folder stays. `Delete` on the row asks first, above the rows:

```
  Remove the selected row from this computer's list?
  Enter removes it; other keys keep it. Its folder stays.
```

`Enter` removes it, and the list is read again; `Esc`, or any other key,
keeps it (the other key then does what it does). These are the keys
themselves, whatever your `tui.json` gives `open` and `close`. The question
is about the row marked when it was asked: when a read of the list no longer
holds that row, the question goes. An `Enter` that came in
the same read of input as the `Delete` is not taken. What the kernel
answered stands above the rows: that the row was removed, or why it was not,
in the kernel's words. A removed deployment is not listed again by the
kernel on its own; opening it with `oats tui --dir <path>` lists it again.
A workspace this run has open has no Remove here.

`Delete` is the key and no letter is: a new default key that your
[`tui.json`](#change-the-keys-tuijson) already gives to another action
would make the file refused at the start. To use another key, give it to
`remove` there, for example `{ "keys": { "remove": ["x"] } }`.

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
confirmation, which is needed only when the first retire's holder can't be
read, since the kernel refuses a second retire while one runs. The
palette offers the acts the selected instance offers now, and the leader's
hint and the help name their keys. A key for an act
the instance does not offer opens nothing, and the line under the title
says why. The keys are yours to change in
[`tui.json`](#change-the-keys-tuijson): the actions are `stop`, `retire`,
`start` and `restart`.

**The confirmation** opens over the main area, with the focus on `Cancel`;
the cheat sheet names its keys (under 80 columns it covers the whole screen,
its keys on its first row).
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
  a terminal's too) opens the soul picker over the main area: the souls of
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
  and the cheat sheet names it:
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
- **One spawn at a time.** While one is under way the line under the
  title says `Spawning <name>…`, and the TUI goes on working: `n` and `N`
  say a spawn is under way and open nothing.
- **Only on this machine.** On another machine's row or workspace `n` and
  `N` (from their keys, the leader or the palette) say that spawning on
  another machine is not offered here, and that `oats spawn` there makes
  one.

**What follows the spawn** is said in the shared words, the Desktop's, and
the TUI adds only what to do next, naming its keys or an `oats` command:

| Outcome | What follows |
|---|---|
| created and started | the instances are read at once; when the new row appears it is selected and its terminal opens beside the sidebar in a new [tab](#tabs), with the focus in it. With four tabs open the line says it was created, then `4 terminals are open; close one with Alt+O w.`, and nothing opens. Not running after two reads: the line says it is not visible yet, and nothing opens later by itself |
| created, but not started, or its wake not saved, or not finished | the line says so; nothing opens. A home the spawn left reads as [held](#held-rows) |
| not known (the answer was lost, or still running at the deadline) | the line says so, and `C` checks its result once, without spawning again: it is offered only then |
| its cleanup is owed | the line says so and names the retire |
| refused, rolled back, never submitted, or changed since you looked | the preview again, read anew, with the line in it: change the choices or press `Enter` again |

**Quitting with a spawn under way** lets it go: the spawn finishes, or the
kernel's own limits bound it; `oats tui` neither waits for it nor ends it.
The line after leaving says so and names `oats status` to see it.

## Keys

The keys come in three layers:

1. **In the list:** plain keys, such as `n` to spawn, `w` for the switcher, `/` to filter ([In the list](#in-the-list)).
2. **Anywhere, an agent's terminal included:** the [chords](#chords), `Ctrl+Alt+K` and the rest by default, `Ctrl+Shift+K` and the rest [as the option](#switch-to-ctrlshift). Not plain `Ctrl+K`: that is the agent's, kill to the end of the line in Claude Code, Codex, pi and the shell.
3. **Always:** [the leader](#the-leader), `Alt+O` then a key (`Ctrl+\` on macOS), in every terminal.

### Every action's keys

The same keys in `oats tui` and in OATS Desktop. A column per way in: the
list's key (the Desktop's sidebar has the same, but `Ctrl+K`), the chord in
each family on Linux and Windows, the Desktop's chord on macOS (where
`oats tui` has no chords), and the key after the leader. `–` is no key of
that kind.

| Action | In the list | Ctrl+Alt (default) | Ctrl+Shift (the option) | macOS Desktop | The leader then |
|---|---|---|---|---|---|
| the palette | `Ctrl+K` | `Ctrl+Alt+K` | `Ctrl+Shift+K` | `⌘K` | `k`, `Space` |
| spawn an agent (the Desktop's Quick Open) | `n` | `Ctrl+Alt+P` | `Ctrl+Shift+P` | `⌘P` | `n` |
| the switcher | `w` | `Ctrl+Alt+O` | `Ctrl+Shift+S` | `⌥⌘O` | `o` |
| zoom the shown terminal | `z` | `Ctrl+Alt+Z` | `Ctrl+Shift+M` | `⌥⌘Z` | `z` |
| close the shown terminal's tab | `c` | `Ctrl+Alt+W` | `Ctrl+Shift+W` | `⌘W` | `w` |
| split side by side | `\|` | `Ctrl+Alt+E` | `Ctrl+Shift+E` | `⌘\` | `\|` |
| split one above the other | `-` | `Ctrl+Alt+Shift+E` | `Ctrl+Shift+D` | `⌘⇧\` | `-` |
| the other group | – | `Ctrl+Alt+A` | `Ctrl+Alt+A` (kept) | `⌥⌘A` | `Tab` |
| the filter | `/` | `Ctrl+Alt+F` | `Ctrl+Alt+F` (kept) | `⌘F` | `/` |
| the terminal of the instance before, after | – | `Alt+Shift+Up`, `Alt+Shift+Down` | `Alt+Shift+Up`, `Alt+Shift+Down` (kept) | `⌥⌘↑`, `⌥⌘↓` | `Up`, `Down` |
| the tab before, after | `[`, `]` | `Alt+Shift+Left`, `Alt+Shift+Right` | `Alt+Shift+Left`, `Alt+Shift+Right` (kept) | `⌥⌘←`, `⌥⌘→` | `Left`, `Right` |
| the first to eighth tab, the last | – | `Ctrl+Alt+1` to `Ctrl+Alt+9` | `Ctrl+Alt+1` to `Ctrl+Alt+9` (kept) | `⌥⌘1` to `⌥⌘9` | – |
| move the tab to the other group | – | – | – | – | `m` |
| close the empty group | – | – | – | – | `x` |
| stop, restart, start, retire | `X`, `R`, `S`, `D` | – | – | – | `X`, `R`, `S`, `D` |
| spawn another of the soul | `N` | – | – | – | `N` |
| the Instances, Souls, Capabilities views | `1`, `2`, `3` | – | – | – | `1`, `2`, `3` |
| the help | `?` | – | – | – | `?` |
| the list | `Esc` | – | – | – | `Esc` |

The option moves seven chords to Ctrl+Shift. The others keep their key in
both families, marked kept: Ctrl+Shift with an arrow selects text in inputs
and editors, Ctrl+Shift with a digit is a shifted symbol on most layouts,
and Ctrl+Shift+A and Ctrl+Shift+F are taken by terminals (kitty, Ghostty,
and for F Alacritty and GNOME Terminal too) and by agents (Codex's
Ctrl+Shift+A, pi's Ctrl+Shift+F). The list's own keys for moving and
reading are in [In the list](#in-the-list). The tables come from
`packages/client/keymap.mjs` (`CHORDS`, `PLAIN_KEYS`, `LEADER_TABLE`), which
both clients read.

### Which family for my terminal

For `oats tui`, on Linux and Windows. `✓` is a family whose chords reach
`oats tui` in that terminal, `✗` one whose chords do not, with the reason.
The leader works in all of them. In OATS Desktop both families work.

| Terminal | Ctrl+Alt (default) | Ctrl+Shift (the option) |
|---|---|---|
| foot | ✓ | ✓ |
| Alacritty | ✓ | ✓ |
| Ghostty | ✓ | ✗ Ghostty closes its own tab on Ctrl+Shift+W, taking oats tui with it |
| kitty | ✓ | ✗ kitty takes Ctrl+Shift+K, P, S, W and E for itself; W closes its window, `oats tui` with it |
| WezTerm | ✓ with `enable_kitty_keyboard`; without it only the Alt+Shift arrows | ✗ WezTerm takes Ctrl+Shift+K, P, M and W for itself: clear the scrollback, its command palette, hide the window, close the tab |
| GNOME Terminal | ✗ no kitty keyboard protocol (VTE has none): only the Alt+Shift arrows arrive | ✗ no kitty keyboard protocol: a Ctrl+Shift letter reaches a program as the Ctrl letter |
| Konsole | ✓ since 26.08 | ✗ Konsole takes all seven for itself; Ctrl+Shift+W closes the tab |
| Windows Terminal | ✓, but `Ctrl+Alt+1` to `9` are its tabs, and the Alt+Shift arrows resize its split panes | ✗ Windows Terminal takes Ctrl+Shift+K, P, M, W and D for itself; W closes the pane |

Each terminal's defaults at the release
[the full matrix](#which-terminals-let-the-chords-through) names.

### Switch to Ctrl+Shift

On Linux and Windows. macOS has no option: the Desktop keeps its ⌘ chords
there, and `oats tui` the leader.

- **In OATS Desktop:** the Shortcuts page (`Ctrl+,`), at its top, **Shortcut
  family, shared with oats tui**: choose **Ctrl+Shift (foot, Alacritty)**. The Desktop writes the
  file below and switches its keys at once. **Ctrl+Alt (default)** switches
  back. A change by hand reaches the Desktop when it next gets the focus.
- **Or by hand:** write `$OATS_HOME_DIR/config/keys.json`, else
  `~/.oats/config/keys.json`, beside [`tui.json`](#change-the-keys-tuijson):

  ```json
  { "chords": "ctrl+shift" }
  ```

  `"ctrl+alt"` is the default.
- **`oats tui` reads it at its start:** restart it after a change, from the
  Desktop or by hand.
- **Nothing to fix when it is wrong.** A missing file, one that cannot be
  read or is larger than 16 KiB, one that is not a JSON object, one with no
  `chords` or another value: each means Ctrl+Alt, and the help says why
  (`keys.json: unknown chords value, using Ctrl+Alt`). The Desktop changes
  only `chords` and keeps every other key in the file; a file it cannot
  keep whole it leaves as it is, and says so.
- **It is the clients' file.** The kernel never reads it, and `tui.json`
  does not hold it.
- **Your own keys still win, row by row.** A key you give an action in
  `tui.json`'s `keys` is not bound as a chord, and an action you rebind in
  the Desktop's shortcuts editor keeps your key in either family; the
  editor shows a clash with a key the option takes.
- **In `oats tui` the option needs the kitty keyboard protocol**
  ([Chords](#chords)). Without it a Ctrl+Shift letter is the Ctrl letter,
  so the TUI binds none: only the Alt+Shift arrows are chords, and the
  leader does the rest.
- **The help says which family is in force.** In `oats tui` the help (`?`)
  opens its chords with a line: `Shortcuts: Ctrl+Alt. For Ctrl+Shift (foot,
  Alacritty), set "chords": "ctrl+shift" in keys.json and restart.`, or
  `Shortcuts: Ctrl+Shift, from keys.json.`, or, in a terminal that does not
  confirm the protocol, `Shortcuts: Ctrl+Shift, from keys.json, but this
  terminal does not confirm the kitty keyboard protocol: use the leader.`
  The Desktop's Shortcuts page shows the choice, `oats tui uses it from its
  next start.` under it, and the same note when the file was not taken.

### What the option takes from an agent

With the option on, both clients take the seven Ctrl+Shift chords from
every focus, an agent's terminal included: the agent never gets them.

- **Of the agents' own keys, that is one:** pi's Ctrl+Shift+P (previous
  model, [pi's keys](https://github.com/earendil-works/pi/blob/26293e74f664c2cfb731b22a653cccf852830e00/packages/coding-agent/docs/keybindings.md#L154))
  spawns an agent instead. No other Ctrl+Shift key of Claude Code, Codex or
  pi is among the seven.
- **The plain Ctrl letters stay the agent's:** `Ctrl+K`, `Ctrl+P`,
  `Ctrl+W` and the rest.
- **A Ctrl+Shift chord is only ever the protocol's report of it,** with
  Shift in it. Without the protocol a terminal sends Ctrl+Shift+D as
  `Ctrl+D` (end of input) and Ctrl+Shift+M as `Enter`; those stay the
  agent's, and the list's.
- **IBus 1.5.24 and older** opens its emoji picker on Ctrl+Shift+E
  ([its setting](https://github.com/ibus/ibus/blob/1.5.24/data/dconf/org.freedesktop.ibus.gschema.xml#L186);
  a newer IBus may keep an old setting) before either client sees it. There
  the leader then `|` splits side by side.

### In the list

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
| `3` | [the Capabilities view](#the-capabilities-view); `Esc` or `1` goes back |
| `w` | opens [the switcher](#the-switcher) |
| `Delete` | in the switcher, asks whether to remove the selected row from this computer's list of deployments; `Enter` removes it |
| `Enter` | in the list of instances, opens the selected agent's terminal in a new [tab](#tabs) beside the sidebar, or shows its tab when it has one, with the focus in it; in the switcher, opens the selected row; in a confirmation, presses the button with the focus |
| `z` | gives the shown terminal the focus and the whole screen |
| `c` | closes the shown terminal's tab and shows the tab beside it; the agent keeps running |
| `[`, `]` | in the Instances view, shows the tab before or after the shown one |
| `\|`, `-` | in the Instances view, [splits](#splits) the panel side by side or one above the other |
| `Alt+O` (`Ctrl+\` on macOS) | [the leader](#the-leader), from every focus ([`tui.json`](#change-the-keys-tuijson) can name another key) |
| `Ctrl+K` | opens [the palette](#the-palette); `Ctrl+K` again closes it |
| `Ctrl+Alt+K`, `Alt+Shift+Up` and the other [chords](#chords) (`Ctrl+Shift+K` and the rest [with the option](#switch-to-ctrlshift)) | what the leader then a key does, from every focus; the Ctrl+Alt and Ctrl+Shift ones where your terminal sends them. While [the palette](#the-palette) is open, `Alt+Shift+Up` and `Alt+Shift+Down` are its own |
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
always lists the keys that work, the leader's among them, the
[chords](#chords) (first of all while your terminal confirms the kitty
keyboard protocol), the palette's and the spawn prompt's, with the
marks and with what this version does not do. Its top row has the time of the read and the count of withheld rows
([What it shows](#what-it-shows)). The movement keys scroll it. While
a terminal has the focus the table's keys are the agent's: the leader and
the chords alone are the TUI's.

### The leader

Every action is reached by keys from every focus, a terminal's too: the
leader (tui.json's `open.detachKey`), then one plain key. The leader is
`Alt+O` on Linux and Windows and `Ctrl+\` on macOS, unless
[`tui.json`](#change-the-keys-tuijson) names another key, `C-\` among
them. `Alt+O` is reached with one hand on every keyboard layout, where
`Ctrl+\` is a stretch on most and needs AltGr on many. macOS keeps
`Ctrl+\` because its terminals type `ø` for Option+O unless they are set
to use Option as Meta.

| The leader, then | Does |
|---|---|
| `k` or `Space` | opens [the palette](#the-palette) |
| `1`, `2`, `3` | the Instances, Souls and Capabilities views |
| `Up`, `Down` | opens the terminal of the instance before or after, in the list as it is drawn, the focus in it: from the shown terminal's instance, or from the selection when none is open. It shows the instance's tab when it has one, else opens a new [tab](#tabs). Rows that cannot be opened are passed over, and the list does not wrap |
| `Left`, `Right` | shows the tab before or after the shown one; the tab bar does not wrap, and the focus stays where it was |
| `z` | zooms the shown terminal in or out; with the list focused, gives it the focus and the whole screen |
| `w` | closes the shown terminal's tab and shows the tab beside it; the agent keeps running |
| `\|`, `-` | [splits](#splits) the panel side by side or one above the other |
| `Tab` | goes to the other group's terminal (or to the other group, when it is empty); from the list, to the focused group's |
| `m` | with two groups, moves the shown tab to the other group, and goes there |
| `x` | closes the focused group while it is empty |
| `X`, `R`, `S`, `D` | stop, restart, start, retire, [after a confirmation](#stopping-starting-restarting-and-retiring): from a terminal's focus on that terminal's instance, which has the focus again when the confirmation closes |
| `n`, `N` | [spawns an agent](#spawning-an-agent); `N` of the shown terminal's soul from its focus |
| `/` | the filter |
| `o` | [the switcher](#the-switcher) |
| `?` | the help |
| `Esc` | gives the list the focus |
| the leader again | types the leader into the terminal that has the focus, which keeps it; with the list focused, only closes the hint |

- **While the leader waits** for its key the cheat sheet's rows are its
  hint: `Alt+O then`, then a row per key, `Esc the list` last. It names
  these keys but `n` and `N` (`z` and `w` only while a terminal is open,
  `Left` and `Right` only with two tabs or more, `|` and `-` while the
  panel has one group, `Tab` with two, then `m` while the focused group
  shows a tab or `x` while it is empty, and the leader again while a
  terminal has the focus). On a short screen it gives up rows before its
  last. It waits
  with no time limit. A key not in the table cancels it and is dropped:
  nothing is typed.
- **Only a key in a later read counts.** A key that came in the same read of
  input as the leader cancels it and is dropped, with the rest of that
  read, so a paste can never run a command. In a terminal the bytes before
  the leader in that read still go to the agent. A leader inside a
  bracketed paste is pasted text.
- **In a terminal `Alt+O` is one keypress only.** A terminal sends `Alt+O`
  as `Esc` then `o`. Those bytes count as the leader when they arrive in
  one read, or split across reads within 10 ms. An `Esc` then `o` typed as
  two keys reaches the agent unchanged: in vim that is "leave insert mode,
  open a line". Over a slow link two keys typed apart can arrive in one
  read and act as the leader, and one `Alt+O` can arrive split and reach
  the agent as `Esc` and `o`. Under the kitty keyboard protocol
  ([Chords](#chords)) there is no timing: `Alt+O` is one sequence and `Esc`
  another, so each is told exactly, in a terminal and in the list.
- **In the list no leader is needed:** the plain keys work as they always
  have, and the leader works there too.
- **What was open under it is settled first,** from whatever view: a
  filter field keeps its filter, as `Enter` does, and a confirmation
  closes. `Up`, `Down`, `Left`, `Right`, `z`, `w`, the split's keys and the acts then go to
  the Instances view, from Souls, Capabilities, the help or the switcher
  too; with no workspace open they do nothing, and `Left`, `Right`, `z` and
  `w` do nothing with no terminal open.
- **The table is fixed** in this version: `keys` in `tui.json` rebinds the
  plain keys, and `open.detachKey` the leader.

### Chords

A chord does in one keypress what the leader then a key does, from every
focus, an agent's terminal too, and never reaches the agent. The OATS
Desktop has the same chords (`CHORDS` in `packages/client/keymap.mjs`, which
both read; the TUI keeps no copy). The leader stays the key that always
works, and the one for help, the views and the acts (stop, restart, start,
retire), which have no chord.

Every chord, in both families, with what it does and the leader's key for
it, is in [Every action's keys](#every-actions-keys). While the palette is
open, `Alt+Shift+Up` and `Alt+Shift+Down` move between its groups instead
([The palette](#the-palette)).

They are one family: Ctrl+Alt with a letter or a digit acts, and Alt+Shift
with the leader's arrow moves. No terminal in the table below takes them by
default, and no agent (Claude Code, Codex, pi) reads them. Ctrl+Shift with a
letter, the obvious family, is mostly the terminals' own: kitty binds 22 of
those letters, Ghostty 13, and foot, GNOME Terminal, WezTerm, Konsole and
Windows Terminal their own. So it is the option, for the terminals that
leave the seven letters alone ([Which family for my
terminal](#which-family-for-my-terminal)). With the option a row's
Ctrl+Shift key replaces its Ctrl+Alt key, which then reaches the agent as
it would without the TUI. On macOS the TUI has no chords: the Desktop's
hold ⌘, which a terminal never passes to a program.

- **The Ctrl+Alt and Ctrl+Shift chords only where the terminal says it
  can.** Without the kitty keyboard protocol a terminal sends `Ctrl+Alt+K`
  as `Esc` then `Ctrl+K`, the same bytes as those two keys typed for the
  agent, and `Ctrl+Shift+K` as `Ctrl+K`. As
  it takes the terminal, `oats tui` asks for the protocol with flags 1 and 4
  (`CSI > 5 u`) and asks the terminal which flags it has (`CSI ? u`). Only
  when the answer holds flag 1 does it read the protocol and take the
  chords of its family. With no answer within 2 seconds, or one without flag 1,
  it pops the protocol, and the rest of the run is as without it. The
  answer may come split and late over a slow link, so until it comes (at
  most those 2 seconds) an `Esc` pressed on its own may wait for the next
  key or for the wait's end, as it may begin the answer.
- **The Alt+Shift arrows everywhere.** Each sends a sequence of its own,
  with the protocol or without it (`CSI 1;4A` for `Alt+Shift+Up`), so the
  TUI takes them in every terminal. `Ctrl+Alt+Shift` with an arrow is not
  one of them.
- **The help and the cheat sheet lead with the chords** while the terminal
  confirms the protocol: one row per chord, then the leader and its key
  ("or `Alt+O` then `k`"), and the leader's own section after them. Without
  the protocol the leader leads, and only the Alt+Shift arrows are listed
  as chords. The help's chords open with the family in force
  ([Switch to Ctrl+Shift](#switch-to-ctrlshift)). The cheat sheet names chords while an agent's terminal has the
  focus; the list's names its own keys, which need no modifier.
- **Your terminal may take some first** ([the matrix](#which-terminals-let-the-chords-through)).
  Windows Terminal takes `Ctrl+Alt+1` to `Ctrl+Alt+9` for its own tabs, and
  the Alt+Shift arrows while its panes are split. GNOME Terminal and the
  other VTE terminals, Konsole before 26.08, and WezTerm unless
  `enable_kitty_keyboard` is set have no protocol: there only the Alt+Shift
  arrows reach `oats tui`. The leader works in every terminal.
- **A character typed with AltGr stays a character.** On Windows `AltGr` is
  `Ctrl+Alt`: on a Spanish layout `Ctrl+Alt+E` types `€` and `Ctrl+Alt+2`
  `@`, on a Polish one `Ctrl+Alt+A` types `ą`. A key that arrives as text is
  never a chord: on such a layout those chords are the layout's, and the
  leader still does what they do. On Linux and macOS `AltGr` and Option are
  keys of their own.
- **Every other key reads as it does without the protocol.** `Ctrl+Shift+L`
  is `Ctrl+L`, `Ctrl+Enter` is `Enter`, and so on: the protocol only adds
  the chords of the family in force, and tells `Alt+O` from `Esc` then `o`
  exactly ([The leader](#the-leader)). Under the default family the seven
  Ctrl+Shift letters of the option are such keys too: `Ctrl+Shift+D` is
  `Ctrl+D`.
- **A Ctrl+Shift chord is read from the protocol alone,** from a report
  that holds Shift, never from the byte a terminal sends without it:
  `Ctrl+D` (end of input) and `Enter` (`Ctrl+M`) stay what they are, with
  the option on too.
- **An agent gets what it gets without the protocol.** Every key typed
  into an agent's terminal is turned back into the bytes the same key sends
  without it, the legacy encoding of xterm and the terminals that follow it:
  text, Shift, Ctrl, Alt, Esc, Tab, Enter, Backspace, the arrows, the
  function keys and the keypad, with their modifiers. The TUI types those
  bytes into the agent's viewer (`tmux attach` on the agents' server). It
  changes no tmux setting, `extended-keys` included, so the agent's program
  gets the same bytes as before. A key that sends nothing without the
  protocol (F13 and above, the media keys) is not typed.
- **One limit: Shift with Alt or Ctrl on a key that is not a letter.** With
  flag 4 the terminal says which character Shift makes on your layout, and
  the TUI types exactly that. A terminal that confirms flag 1 alone does not
  say, and then the TUI uses the US layout's character for the 21 keys that
  are not letters (`Shift+Alt+2` is `Alt+@`), which your layout may not
  make.
- **It is always popped** (`CSI < u`): on every way out
  ([below](#what-it-changes-in-your-terminal-and-restores)), at a suspend
  (and pushed again on return), and before any other program is given the
  terminal: the shell at a suspend is the only one `oats tui` ever gives
  it to.

#### Which terminals let the chords through

Each terminal's documented default key bindings, read from its source or
manual at the release named. `✗` is a chord the terminal takes for itself
by default, `~` one it takes only in a state it names, `·` one it passes on.
WT is Windows Terminal; iTerm2 and Terminal.app are on macOS, where the TUI
has no chords (above) and the column is for reference.

| Chord | foot | kitty | Ghostty | Alacritty | GNOME Terminal | WezTerm | Konsole | WT | iTerm2 | Terminal.app |
|---|---|---|---|---|---|---|---|---|---|---|
| `Ctrl+Alt+K` `P` `O` `Z` `W` `E` `A` `F` | · | · | · | · | · | · | · | · | · | · |
| `Ctrl+Alt+Shift+E` | · | · | · | · | · | · | · | · | · | · |
| `Ctrl+Alt+1` to `9` | · | · | · | · | · | · | · | ✗ its tabs | · | · |
| `Alt+Shift+` arrows | · | · | · | · | · | · | · | ~ pane resize, passed on with one pane | · | · |
| the option's `Ctrl+Shift+K` `P` `S` `M` `W` `E` `D` | · | ✗ `K` `P` `S` `W` `E` | ✗ `P` `W` `E` | · | ✗ `W` | ✗ `K` `P` `M` `W` | ✗ all seven | ✗ `K` `P` `M` `W` `D` | – | – |
| kitty protocol, flags 1 and 4 | yes, since 1.10.3 | yes | yes | yes, since 0.13 | no (VTE has none) | only with `enable_kitty_keyboard` | yes, since 26.08 | yes, since 1.25 | yes | no |
| Release read | 1.28.0 | 0.49.2 | 1.3.1 | 0.17.0 | 3.60.0 (VTE 0.84.1) | 20240203 | 26.08.2 | 1.25.2733 | 3.7 | macOS 15 |

Where a terminal has no protocol, its cells say only what it takes: the
chord does not reach the TUI there anyway. macOS has no Ctrl+Shift option,
hence `–`. What the
terminals take besides, near these chords:

- Konsole: `Ctrl+Alt+S`, `N`, `M`, `U`, `H`, `G`, `I`, `0`, `[`, `]`, `\`
  and `,`.
- Windows Terminal: `Ctrl+Alt+,`, `Ctrl+Alt+Left`, and `Alt` with an arrow
  (pane focus).
- kitty: `Ctrl+Shift+Alt+T`. Ghostty: `Ctrl+Shift+Alt+J`, and `Ctrl+Alt`
  with an arrow (split focus). WezTerm: `Ctrl+Shift+Alt` with an arrow,
  `'` and `5`.

The desktops' global keys come before any terminal's:

| Desktop (release read) | Takes, near the chords | Takes none of |
|---|---|---|
| GNOME 49 to 51 | `Ctrl+Alt` with an arrow (workspaces) and with `Shift` (move to a workspace), `Ctrl+Alt+Tab`, `Ctrl+Alt+Esc`, `Ctrl+Alt+Delete`, `Ctrl+Alt+F1` to `F12`, `Ctrl+Shift+Alt+R`, `Shift+Alt+Tab`; Ubuntu adds `Ctrl+Alt+T` | the chords above |
| KDE Plasma 6.8.1 | `Ctrl+Alt+Delete`, `Ctrl+Alt+F1` to `F12`, `Alt+Shift+Tab`, `Alt+Shift+F2`; Konsole, where installed, `Ctrl+Alt+T` | the chords above |
| Omarchy 4.0.4 (Hyprland) | `Ctrl+Alt+Delete`, `Ctrl+Alt+Tab`, `Ctrl+Alt+Shift+Tab`, `Alt+Shift+Tab` | the chords above |

From
[GNOME's window manager keys](https://gitlab.gnome.org/GNOME/gsettings-desktop-schemas/-/blob/49.1/schemas/org.gnome.desktop.wm.keybindings.gschema.xml.in),
[mutter's](https://gitlab.gnome.org/GNOME/mutter/-/blob/49.8/data/org.gnome.mutter.wayland.gschema.xml.in),
[the shell's](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/49.10/data/org.gnome.shell.gschema.xml.in)
and [the settings daemon's](https://gitlab.gnome.org/GNOME/gnome-settings-daemon/-/blob/49.1/data/org.gnome.settings-daemon.plugins.media-keys.gschema.xml.in);
[KWin's](https://invent.kde.org/plasma/kwin/-/blob/v6.8.1/src/tabbox/tabbox.cpp#L330-L335),
[the session's](https://invent.kde.org/plasma/plasma-workspace/-/blob/v6.8.1/startkde/session-shortcuts/main.cpp#L40)
and [KRunner's](https://invent.kde.org/plasma/plasma-workspace/-/blob/v6.8.1/krunner/org.kde.krunner.desktop.cmake#L135);
and [Omarchy's](https://github.com/basecamp/omarchy/blob/v4.0.4/default/hypr/bindings/tiling.lua).

Sources:
[foot](https://codeberg.org/dnkl/foot/src/tag/1.28.0/config.c#L3362-L3445)
([protocol](https://codeberg.org/dnkl/foot/src/tag/1.28.0/CHANGELOG.md#L2222-L2245)),
[kitty](https://github.com/kovidgoyal/kitty/blob/v0.49.2/kitty/options/definition.py#L3650-L4711)
([protocol](https://github.com/kovidgoyal/kitty/blob/v0.49.2/docs/keyboard-protocol.rst#L302-L309)),
[Ghostty](https://github.com/ghostty-org/ghostty/blob/v1.3.1/src/config/Config.zig#L6392-L7146)
([protocol](https://github.com/ghostty-org/ghostty/blob/v1.3.1/src/terminal/kitty/key.zig#L79-L84)),
[Alacritty](https://github.com/alacritty/alacritty/blob/v0.17.0/alacritty/src/config/bindings.rs#L430-L562)
([protocol](https://github.com/alacritty/alacritty/blob/v0.17.0/CHANGELOG.md#L243)),
[GNOME Terminal](https://gitlab.gnome.org/GNOME/gnome-terminal/-/blob/3.60.0/src/org.gnome.Terminal.gschema.xml#L362-L631)
([VTE has no protocol](https://gitlab.gnome.org/GNOME/vte/-/work_items/2601)),
[WezTerm](https://wezterm.org/config/default-keys.html)
(and [commands.rs](https://github.com/wezterm/wezterm/blob/20240203-110809-5046fc22/wezterm-gui/src/commands.rs#L109-L140),
which gives each ⌘ default a Ctrl+Shift twin;
[protocol](https://wezterm.org/config/lua/config/enable_kitty_keyboard.html)),
[Konsole](https://invent.kde.org/utilities/konsole/-/blob/v26.08.2/src/ViewManager.cpp#L120-L393)
(and [SessionController.cpp](https://invent.kde.org/utilities/konsole/-/blob/v26.08.2/src/session/SessionController.cpp#L660-L955),
[MainWindow.cpp](https://invent.kde.org/utilities/konsole/-/blob/v26.08.2/src/MainWindow.cpp#L430-L470),
where `ACCEL` is Ctrl+Shift ([Shortcut_p.h](https://invent.kde.org/utilities/konsole/-/blob/v26.08.2/src/Shortcut_p.h#L17-L25)),
and KDE's Save As, Ctrl+Shift+S;
[protocol](https://invent.kde.org/utilities/konsole/-/commit/1983d2b4735d6b61b74cf85854acc1cb4d2445d5)),
[Windows Terminal](https://github.com/microsoft/terminal/blob/v1.25.2733.0/src/cascadia/TerminalSettingsModel/defaults.json#L721-L803)
([protocol](https://github.com/microsoft/terminal/releases/tag/v1.25.622.0)),
[iTerm2](https://github.com/gnachman/iTerm2/blob/beb7cfbffeb3ae482042b08a8dd2590cd2cf4ee5/plists/DefaultGlobalKeyMap.plist)
([keys](https://iterm2.com/documentation-preferences-keys.html)),
[Terminal.app](https://support.apple.com/guide/terminal/keyboard-shortcuts-trmlshtcts/mac).
The agents' keys:
[Claude Code](https://code.claude.com/docs/en/keybindings),
[Codex](https://github.com/openai/codex/blob/e1b9c9457ceca75a99b034a5df39ac48c3998d15/codex-rs/tui/src/keymap.rs#L1673-L2003),
[pi](https://github.com/earendil-works/pi/blob/26293e74f664c2cfb731b22a653cccf852830e00/packages/coding-agent/docs/keybindings.md).
Of the shells' keys, bash's readline binds `Ctrl+Alt+E` and `Ctrl+Alt+F`
(expand the line, a word forward); under the protocol the TUI takes them
from an agent's line editor, which no agent above binds them in.

### The palette

The leader then `k` (or `Space`), or `Ctrl+K` in the list, opens one input
over a list, as the OATS Desktop's ⌘K does. From 80 columns it covers the
main area and the sidebar stays beside it, its cheat sheet naming the
palette's keys (`Enter run`, `Up/Down move`, `Esc close`, then
`Alt+Shift+Up/Down group`, which macOS has not); under 80 columns it covers
the whole screen, with those keys on its first row, as many as fit (at 60
columns `group` gives way). While it is open no terminal is drawn and the
TUI reads the keys. The help lists its keys under The palette.

- **It lists, in this order:** the instances that can be opened, in groups;
  then the souls, the capabilities, the views, the acts and the commands,
  one group each.
- **The instances are grouped as the sidebar groups them:** a cluster under
  its name, and a run of single instances under `independent`. Where the
  view has several deployments, each group is one deployment's, and its
  label names the machine first (`<machine> · <group>`).
- **Each instance group has a label row:** its label, dim, before its rows.
  It is never selected: `Up`/`Down` and `PageUp`/`PageDown` pass over it,
  and the palette opens on the first row under it. A group with no instance
  that can be opened is not listed.
- **The group last used comes first,** as in the Desktop's palette, and so
  does the cluster, the root and the child: the one with the instance opened
  or shown most recently in this run first, then the list's order (the
  sidebar keeps its own order). When the first instance is the shown tab's,
  the palette opens on the instance shown before it, wherever its group puts
  it (the second instance, when none was shown before): `Enter` goes back to
  that terminal.
- **An instance's row** has its state mark, its name, for another machine
  `on <machine>`, and, dim, its siblings as the detail names them
  (`sibling of <names>`), which are cut first when the row is short and are
  never matched by a query.
- **The other groups:** the souls
  of the open workspace, once they were read (by [the Souls
  view](#the-souls-view), the Capabilities view or a spawn), and choosing
  one shows the Souls view with it selected; its capabilities, once [the
  Capabilities view](#the-capabilities-view) has read them, each with where
  it comes from, dim, and choosing one shows that view with it selected
  (the palette never reads either); the views, Instances, Souls and
  Capabilities; the acts the
  instance offers now (the shown terminal's when the palette was opened from
  its focus, else the selected one's), with `Spawn another <soul>` once the
  catalog lists its soul; then Spawn an agent, Workspaces, Refresh and Help, and [the split's](#splits)
  rows where each applies.
  Each row says at its right edge what kind it is: `instance`, `soul`,
  `capability`, `view`, `act` or `command`. A label row says none.
- **Typing filters it** with the Desktop's subsequence match. An instance
  group keeps the rows that match, in its own order, and a group with none
  loses its label row. Each other group keeps the rows that match, the best
  first, a prefix first.
  `Backspace` removes a character, and a paste adds its first line.
  `Up`/`Down` (and `PageUp`/`PageDown`) move, `Enter` runs the selected
  row, `Esc` closes it.
- **`Alt+Shift+Down` goes to the next group, `Alt+Shift+Up` to the one
  before:** to its first row. Past the last group it wraps to the first,
  and before the first to the last; with one group, both go to its first
  row. While the palette is open these keys are its own: they win over the
  chords `Alt+Shift+Up` and `Alt+Shift+Down` ([Chords](#chords)), so they
  open no agent and leave the palette open, with or without the kitty
  keyboard protocol. The leader then `Up` or `Down` still opens one. The
  Desktop's palette has the same pair (`PALETTE_KEYS` in
  `packages/client/keymap.mjs`, which both read).
- **On macOS there is no group key:** the Desktop's hold `⌘`, which a
  terminal never passes to a program.
- **Running a row** settles what was open under the palette, as the leader
  does: an instance shows its tab, or opens its terminal in a new one, in
  the Instances view, the focus in it ([Tabs](#tabs)); an act opens its
  confirmation; a view shows
  it; a command does what its key does.
- **An `Enter` in the same read as the palette's opening runs nothing**, so
  a paste cannot open it and run a row.
- Closed, it gives the focus back to the terminal it was opened from.
  Recency is kept for the run only: nothing is written.

**The filter.** `/` opens a field on the open view's heading: while you
type, the heading is `/` and the text. What you type narrows the
list to the instances whose name, soul or repository contains it, with the
instances they were spawned from, whatever is folded away. In the field
every printable key is text, so `q` and `j` can be typed; `Backspace`
removes a character, `Enter` keeps the filter and returns to the list
(the heading then names it after the view's name, `Instances  /text`),
`Esc` clears it. `Ctrl+C`, `Ctrl+Z`
and `Ctrl+L` still do what they do. The filter holds at most 200
characters. The switcher has a filter of its own: its field stands on a
row of its own above its list while it is typed or kept, and it narrows the
rows to the ones whose name, machines or path contain the text.

**Pasted text is never read as keys.** A paste into the list is dropped
whole. A paste into the filter field adds its first line, and only when
that line is plain text; otherwise it adds nothing.

The mouse is never needed and never captured: your terminal's own selection
and scrolling keep working.

## Change the keys: `tui.json`

`oats tui` reads `~/.oats/config/tui.json` once, at the start: beside the
kernel's own files, so it is `$OATS_HOME_DIR/config/tui.json` when
`OATS_HOME_DIR` is set (the same rule as this computer's list of
deployments). `XDG_CONFIG_HOME` is not read for it. It never writes the file,
except to [move it](#the-move-from-configoats) from where earlier versions
read it. With no file the keys are the ones above. Which chord family it
binds is not here: it is `keys.json`, beside it, which the Desktop shares
([Switch to Ctrl+Shift](#switch-to-ctrlshift)).

```json
{ "keys": { "quit": ["q"], "refresh": ["r", "f5"], "suspend": [] }, "ascii": false, "open": { "detachKey": "F12" } }
```

- `keys.<action>` is the list of keys of that action. It **replaces** the
  action's keys; an empty list leaves the action with no key. An action you
  do not name keeps its keys. A [chord](#chords) whose key you give an
  action here is not bound: your key wins, row by row, in either family.
- The actions are `up`, `down`, `top`, `bottom`, `page-up`, `page-down`,
  `collapse`, `expand`, `detail`, `filter`, `refresh`, `instances`,
  `souls`, `capabilities`, `workspaces`, `palette`, `open`, `soul-instances`, `zoom`, `close-terminal`,
  `tab-previous`, `tab-next`, `split-right`, `split-down`, `group-next`, `tab-move`,
  `group-close`, `stop`, `retire`, `start`, `restart`, `spawn`, `spawn-another`,
  `spawn-check`, `remove`, `help`, `close`, `quit`, `suspend` and `redraw`. `workspaces` (`w`) opens the switcher and `open` (`enter`)
  opens the selected agent's terminal in the list of instances, the
  selected row in the switcher and the detail in the Souls view;
  `soul-instances` (`i`) shows the selected soul's instances. `zoom` (`z`) and `close-terminal` (`c`) act
  on the shown terminal, and `tab-previous` (`[`) and `tab-next` (`]`) show
  the tab before and after it. `split-right` (`|`) and `split-down` (`-`)
  [split](#splits) the panel; `group-next`, `tab-move` and `group-close`
  have no key of their own by default (the leader then `Tab`, `m` and `x`
  reach them). `remove` (`delete`) asks whether to remove the selected row
  of this computer's list of deployments, in the switcher. In an open filter field `Enter` keeps the filter,
  whatever key `open` has.
- A key is written as the help shows it, in lower case: `q`, `G`, `?`,
  `space`, `enter`, `tab`, `escape`, `backspace`, `up`, `pageup`, `f5`,
  `ctrl+c`, `alt+x`, `shift+tab`, `ctrl+alt+up`. Modifiers come in the order
  `ctrl+`, `alt+`, `shift+`. A terminal sends `Ctrl+H`, `Ctrl+I`, `Ctrl+J`
  and `Ctrl+M` as `backspace`, `tab` and `enter`, so those four are not
  keys of their own.
- `ascii: true` is `--ascii`.
- `open.detachKey` is **[the leader](#the-leader)**. When you name none
  it is `M-o` (`Alt+O`) on Linux and Windows and `C-\` (`Ctrl+\`) on
  macOS; `C-\` stays a key you can name on every platform. It is
  `oats tui`'s own: it never reaches the kernel, and it reaches the agent
  only when you press it twice in the agent's terminal.
  It is read as a key wherever the TUI reads keys, so it may not be a key
  an action has: `C-l` is `redraw`'s `Ctrl+L`, `C-k` the palette's
  `Ctrl+K`, `C-j` is `Enter`. That holds for the default too: a file that
  gives `alt+o` to an action on Linux or Windows names another leader as
  well. It is one of these, written as shown: `C-` with a letter but `h`, `i` and `m` (a
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
| gives `open.detachKey`, or the default leader, a key an action has | `open.detachKey … is read as …, the key of …; give the leader a key no action has, or give … another`, or `the default leader … is read as …` with the same end when the file names no leader |
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

### The move from `.config/oats`

Earlier versions read `$XDG_CONFIG_HOME/oats/tui.json` when
`XDG_CONFIG_HOME` is set, not empty and an absolute path, else
`~/.config/oats/tui.json`: the old file. Before it reads the new one, every
start looks at both:

| Old file | New file | `oats tui` |
|---|---|---|
| there | not there | copies the old file's bytes to the new path, then renames the old file `tui.json.migrated` beside it, then reads the new one |
| there | there | refuses: `<old> is no longer read: the TUI reads <new>. Copy what you need into <new>, then remove <old>` |
| not there | there | reads the new one |
| not there | not there | uses the defaults |

- "There" means an entry is at that path: a symbolic link counts, a link to
  nothing included, so a link to nothing as the old file is reported rather
  than guessed at.
- The copy is the file's bytes, not its settings: a file the TUI cannot use
  is moved as it is, then refused against the new path like any other. The
  new file is made with mode `0600`, and the directories it needs with
  `0700`. It is written to a file of its own beside its path, then put in
  place, by a hard link, so it is never half written and never written
  over another file.
- A link as the old file is renamed itself, not followed: what it points at
  is copied, and its target is left as it was.
- When the move cannot be made, nothing is left half done and the start
  stops: `cannot move <old> to <new> (<reason>); move it yourself`. The
  reason is a link to nothing, not a regular file, larger than 64 KiB,
  `tui.json.migrated is there already` (a backup is never written over),
  `this file system has no hard links` (FAT, exFAT, some network mounts:
  there the file cannot be put in place whole without a risk of writing over
  another, so it is not moved), or the code of the error, as `EACCES`. When the rename fails after the copy is
  made, the copy is deleted first.
- To move it yourself, put the file at the new path and remove the old one
  (or rename it to anything but `tui.json`).
- Two runs that start at once move it once. The one that finds a new file
  placed by the other since it looked asks again: once its old file is gone
  it reads the new one; while an old file is still there (the other's, not
  yet renamed, or its own, with another `XDG_CONFIG_HOME`) it refuses as for
  both files, and never reads settings it was not moving: start it again.

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
  anew and reads the instances anew, and the time on the help's top row is
  that read's. What a read in the background may reuse is the kernel's own look
  at the workspace's remotes, for up to 60 seconds; `r` asks the kernel to
  look again.
- **The souls are one more read**, `oats souls --json` for the open
  workspace, by the same kernel, with 60 seconds and 4 MiB: only once [the
  Souls view](#the-souls-view), [the Capabilities
  view](#the-capabilities-view) or [the spawn prompt](#spawning-an-agent)
  was shown, then only when the workspace changed, and on `r` in the Souls
  view.
- **The capabilities are one more read**, `oats capabilities --json` for
  the open workspace, read as the souls are: by the same kernel, with 60
  seconds and 4 MiB, only once [the Capabilities
  view](#the-capabilities-view) was shown, then only when the workspace
  changed (its packages and its lock count too), and on `r` there.
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
- **This computer's list of deployments is the kernel's**, read and changed
  through the same kernel, with 15 seconds and 4 MiB each, from `/`:
  - `oats deployments --json`, at the start (outside every deployment with
    no `--dir`, before the terminal is taken), when the switcher opens, on
    `r` in it and after a Remove. One runs at a time: one asked for while one is
    on its way runs after it, however many times it was asked, and the
    answer taken is that later one's.
  - `oats deployments add <path> --via tui --json`, once a run, for the
    deployment it started in, from that deployment.
  - `oats deployments remove <path> --json`, for a Remove you confirmed.

  An add and a remove are changes: `oats tui` never ends one, and one still
  running as it leaves is named in one line after the screen is left.
- **The workspace of each row of that list the run has not opened** is
  one more read, `oats status --dir <path> --json` with `--max-age 60`, by
  the same kernel ([the switcher](#the-switcher)): at the start, when the
  switcher opens and on `r` in it, one at a time, 30 seconds each and 60
  seconds for all of them; never from the reads' cadence above. A kernel
  that reports no workspace identities is not asked.
- **One look at the file system serves the switcher**, and it reads no
  file's content: when a row of the list, or a workspace with such a row,
  is opened, each of those directories is asked for a regular
  `oats-local.yaml`.
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
  with no shell between them. Beside the keeper it holds up to four. Up
  to two are displayed, each group's shown tab ([Splits](#splits)), and
  every tab has its group's size: a resize resizes each tab's window in the
  groups drawn. Only the displayed tabs' panes are captured, and only the
  focused group's shown tab is typed into.

  **A tab that is not drawn sends no output, from its mark on.** A hidden
  tab is heard until it prints: its first output captures nothing, sets its
  mark, and pauses its pane for `oats tui`'s control client
  (`refresh-client -A '%<pane>:pause'`, tmux 3.2 and later). From then on tmux sends none of
  that pane's output until the tab is displayed again, so a hidden agent
  that prints without pause costs one chunk of output each time its tab is
  hidden, and a quiet one nothing. The panel hidden as a whole (another
  view or an overlay over it, or the sidebar alone under 80 columns) pauses
  its displayed tabs the same way. A
  paused pane is still read by the private server, so its screen stays
  current and its viewer never waits. A tab displayed again is continued
  (`:continue`) before it is captured: tmux restarts its output from where
  the pane is then, so the first frame is the pane's screen as it is, and
  nothing written meanwhile is replayed. `pause`, not `off`: from tmux 3.4
  on, a pane the control client has turned off is no longer read at all, so
  its viewer would stall and its screen go stale. Measured with a hidden tab
  printing without pause, `oats tui` takes about 0.4% of a core instead of
  11%, and the private server 9% instead of 14%.

  The panel refuses a fifth open (`E_PANEL_FULL`, an open
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
  writing to them), and the directory is removed. A run ended by SIGKILL
  removes nothing: with a kernel that lists this computer's deployments,
  the add at the start has made the directory, and when no terminal was
  opened in that run it holds no `owner.json`, so no later run removes it. `oats tui` waits for an
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
| see a capability's skills and files | `oats capabilities show <name>` |
| add a machine to this workspace | `oats server connect <id> --ssh <alias> --dir <path on that machine>` |
| check a machine | `oats server check <id>` |
| remove a machine | `oats server remove <id>` |
| open a deployment that is not listed | `oats tui --dir <path>` |
| open an agent in a tmux window or split of its own | `oats session attach --home <home>` in that window (the detail shows the home) |

The help screen (`?`) names the same commands. What else holds for this
version:

- **It keeps nothing on disk of its own; opening a deployment lists it**
  on this computer's list, which is the kernel's. A machine it has not
  reached in this run is listed by its own name, in no workspace. What is
  folded away and each view's place last as long as the run, and no filter
  is saved.
- **Of this machine's deployments, the switcher lists only the ones opened
  in this run and the ones on this computer's list.** Any other is opened
  with `oats tui --dir <path>`, which lists it.
- **A row of another machine shows what its host reported at the last
  read,** not what is true at this moment. The time of that read is on the
  machine's heading when it is not the time of this machine's read. A view
  of one machine has no heading: there the title names the machine
  (`on garnet`) and the help's top row carries the time.
- The Souls and Capabilities views list a workspace of this machine's
  souls and capabilities: both are this machine's.
- There is no sorting and no mouse, and a deployment's heading cannot be
  folded. An open terminal has no scrollback but the viewer's own.
- Up to four terminals are open at a time, as tabs, in at most two
  groups. The split cannot be resized or nested, a tab moves only between
  the two groups, and no tab or split is kept from one run to the next, or
  across a switch of workspace.
- With an OATS older than 0.52.0, after an interrupted stop the instance can
  be started and then cannot be stopped while `.oats-stop-pending.json` exists
  in its home.

## What it changes in your terminal, and restores

This is the complete list. On start, in this order:

1. raw mode on the terminal (keys arrive unbuffered and unechoed);
2. the alternate screen (`CSI ?1049h`), so your scrollback is untouched;
3. the cursor hidden (`CSI ?25l`);
4. autowrap off (`CSI ?7l`);
5. bracketed paste on (`CSI ?2004h`);
6. the kitty keyboard protocol pushed, with flags 1 and 4 (`CSI > 5 u`), and
   the terminal asked which flags it has (`CSI ? u`); a terminal that does
   not know the protocol ignores both. With no answer in 2 seconds it is
   popped ([Chords](#chords)).

On the way out, the reverse: the protocol popped (`CSI < u`), bracketed
paste off, autowrap on, the style reset (`CSI 0m`), the cursor shown, the
alternate screen left, raw mode off.

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
`oats tui` draws what the displayed tabs' panes show. Every way out in the
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
  protocol but the kitty one with flags 1 and 4 ([Chords](#chords)), and no
  keypad or cursor-key mode**, and leaves no synchronized update on between
  frames.
- It writes **no window title, no clipboard sequence, no bell**, and no query
  that expects the terminal to reply but the kitty keyboard protocol's.
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
- It **changes this computer's list of deployments only through the
  kernel** (`oats deployments add` and `remove`,
  [above](#what-it-reads-and-what-it-runs)), and never reads or writes the
  list's file itself.

## Errors

| Error | When | What to do |
|---|---|---|
| `E_NO_TERMINAL` | stdin or stdout is not a terminal, or `TERM` is unset, empty or `dumb`. One line on stderr, nothing on stdout, exit 1 | run it in a terminal; `oats status` prints the instances once |
| `E_BAD_ARGS` | `oats tui --json`: it is interactive and has no JSON form. The usual failure envelope, exit 1 | `oats status --json` is the machine view |
| `E_BAD_ARGS` | any argument other than `--dir <path>`, `--ascii` and `--help`, or `--dir` with no path. One line on stderr with the usage, exit 1 | `oats tui --help` |
| `E_TUI_CONFIG` | `tui.json` cannot be honoured. One line per problem on stderr, exit 1 | fix the file as the line says, or remove it |
| `E_TUI_CONFIG` | the [old `tui.json`](#the-move-from-configoats) and the new one are both there: `` `oats tui`: <old> is no longer read: the TUI reads <new>. Copy what you need into <new>, then remove <old> ``. One line on stderr, exit 1 | as the line says |
| `E_TUI_CONFIG` | the [old `tui.json`](#the-move-from-configoats) could not be moved: `` `oats tui` cannot move <old> to <new> (<reason>); move it yourself ``. One line on stderr, exit 1 | move it yourself: the file at the new path, the old one removed |
| `E_NO_DEPLOYMENT` | with `--dir`, no directory at or above it holds an `oats-local.yaml`: `no OATS deployment at or above <dir>`. One line on stderr, exit 1 | `oats tui --dir <path>` with a deployment, or `cd` into one |
| `E_NO_DEPLOYMENT` | without `--dir`, no directory at or above the start holds an `oats-local.yaml`, and this computer's list of deployments holds none: `no deployment at or above <dir>, and this computer's list of deployments holds none (E_NO_DEPLOYMENT): \`oats tui --dir <path>\` opens one (and lists it), \`oats onboard <dir> --workspace <ref>\` creates one`. One line on stderr, exit 1 | as the line says |
| the kernel's code (`E_DEPLOYMENTS_BUSY`, `E_DEPLOYMENTS_INVALID`, `E_DEPLOYMENTS_VERSION`, …) | without `--dir` and outside every deployment, this computer's list of deployments could not be read: `` `oats tui` could not read this computer's list of deployments (<code>): <the kernel's message> ``. One line on stderr, exit 1 | what the kernel's message says |
| `E_TUI_KERNEL` | the kernel it shipped with did not answer `version --json` with a record it accepts; the line gives the reason. One line on stderr, exit 1 | reinstall `oats`: the client and the kernel are one package |

These lines are written before the terminal is touched, in this order: the
arguments, the terminal, `tui.json`, the deployment, the kernel, and then,
for a start without `--dir` outside every deployment, this computer's list of
deployments, which is read through that kernel. A `--dir` that is in no
deployment is answered before the kernel is asked. None of the
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
