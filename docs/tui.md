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
  other machines registered on this machine, in one list, and changes
  nothing.** The registered machines are the ones `oats server list` names.
  It follows the instances as they start, stop and wait for you. It cannot
  open an agent's terminal, stop, start, restart or retire one, spawn one,
  or add, check or remove a machine: [what it does not do
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
- **The detail** shows the selected instance: its soul, its state (and the
  reason the kernel or the terminal probe gave, when there is one), what it
  needs from you with how long it has waited and its own message, harness
  and model, work mode and branch, team, parent, when it last started, and
  its home. From 80 columns up it stands beside the list; on a narrower
  terminal `Tab` opens it as a page.

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
| `Enter` | in the switcher, opens the selected row |
| `?` | opens the help; `?` again closes it |
| `Esc` | closes, in this order: the help, the filter field, a kept filter, then the detail or the switcher |
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

In the list of instances `Enter` does nothing. The help screen is generated
from the table the program acts on, so it always lists the keys that work,
with the marks and with what this version does not do. The movement keys
scroll it. `Ctrl+\` does nothing.

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
{ "keys": { "quit": ["q"], "refresh": ["r", "f5"], "suspend": [] }, "ascii": false }
```

- `keys.<action>` is the list of keys of that action. It **replaces** the
  action's keys; an empty list leaves the action with no key. An action you
  do not name keeps its keys.
- The actions are `up`, `down`, `top`, `bottom`, `page-up`, `page-down`,
  `collapse`, `expand`, `detail`, `filter`, `refresh`, `instances`,
  `workspaces`, `open-workspace`, `help`, `close`, `quit`, `suspend` and
  `redraw`. `workspaces` (`w`) opens the switcher and `open-workspace`
  (`enter`) opens its selected row. In an open filter field `Enter` keeps
  the filter, whatever key `open-workspace` has.
- A key is written as the help shows it, in lower case: `q`, `G`, `?`,
  `space`, `enter`, `tab`, `escape`, `backspace`, `up`, `pageup`, `f5`,
  `ctrl+c`, `alt+x`, `shift+tab`, `ctrl+alt+up`. Modifiers come in the order
  `ctrl+`, `alt+`, `shift+`. A terminal sends `Ctrl+H`, `Ctrl+I`, `Ctrl+J`
  and `Ctrl+M` as `backspace`, `tab` and `enter`, so those four are not
  keys of their own.
- `ascii: true` is `--ascii`.

**A file it cannot honour stops the start.** Each problem is one line on
stderr, the status is 1 and nothing is drawn; it resolves no conflict and
guesses nothing. It refuses:

| The file | The line says |
|---|---|
| is not a regular file (a link to one is read), or cannot be read | `it is not a regular file`, `it cannot be read` |
| is larger than 64 KiB | `it is larger than 64 KiB` |
| is not one JSON object | `it is not valid JSON`, `it is not one JSON object` |
| has a setting other than `keys` and `ascii`, or one of the wrong kind | `unknown setting …`, `keys must be an object`, `ascii must be true or false` |
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
- **Every child runs in a session of its own** and is ended when the TUI
  ends, on every way out a process can handle (for SIGKILL see
  [below](#what-it-changes-in-your-terminal-and-restores)). A read that was
  running when the TUI is suspended is dropped, not shown: its answer could
  arrive cut. That holds for the read of the other machines too. The return
  reads again.
- It reads only. It runs no command that changes a deployment or a
  registration, and it writes no file.

## What this version does not do

| To | Run |
|---|---|
| open an agent's terminal | `oats session attach --home <home>` (the detail shows the home) |
| stop an agent | `oats instance stop <instance>` |
| start or restart an agent | `oats session start --home <home>` |
| retire an agent | `oats retire <instance>` |
| see souls, spawn an agent | `oats souls`, `oats spawn <soul>` |
| see capabilities | `oats capabilities` |
| add a machine to this workspace | `oats server connect <id> --ssh <alias>` |
| check a machine | `oats server check <id>` |
| remove a machine | `oats server remove <id>` |
| open a deployment outside `~/Agents` | `oats tui --dir <path>` |

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
read that was in flight runs to its own end. It only reads.

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
  or the TUI's own words.
- It changes nothing in tmux: no option, key binding, server, session,
  window or pane. Its probe only lists panes.
- It starts no daemon, opens no socket and writes no file. The processes it
  starts are the reads above, and none outlives it on every way out a
  process can handle; after SIGKILL a read in flight runs to its own end.

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

With a registered machine it has been run only against one that did not
answer: the switcher lists it by its own name with the reason, and its view
says that it was not reached. A machine that answers is drawn in the
automated tests, from the kernel's answer handed to the client; so far no
person has checked one in a real terminal.
