# OATS TUI (preview)

`oats tui` is the OATS terminal client: one full-screen, keyboard-only program
for people who work in terminals and on machines with no display, such as a
build host reached over ssh. The [OATS Desktop](desktop.md) is the client for
people who want a window; `oats tui` is the same kind of client for a
terminal. It ships inside the `oats` package: there is nothing else to
install.

## It is a preview

`oats tui` is marked **preview**. That means:

- **This version shows one deployment's instances on this machine, and
  changes nothing.** It follows them as they start, stop and wait for you.
  It cannot open an agent's terminal, stop, start, restart or retire one,
  spawn one, or read another machine: [what it does not do
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
holds a regular `oats-local.yaml`. That directory is the deployment. With
none at or above the start it prints one line (`E_NO_DEPLOYMENT`) and exits
1 without touching the terminal.

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
refused: this version reads this machine only.

**Start it again after you upgrade OATS.** It asks the kernel it shipped
with for its version once, at the start, and does not ask again while it
runs.

## What it shows

```
 oats  lfx-workspace                               21 running  2 need input  1 unknown  1 withheld
 1 Instances   2 Souls   3 Capabilities                                           read 14:03:27
 ───────────────────────────────────────────────┬──────────────────────────────────────────────
>▾ ● oats-kernel-expert-retire      claude      │   oats-kernel-expert-retire
     ● oats-kernel-developer-note   claude     !│   soul     oats-kernel-expert
       ○ oats-code-reviewer-note    stopped     │   state    running
   ▸ ● oats-desktop-expert-readers  claude    !2│   harness  claude, claude-opus-5-5 (soul)
                                                │   work     worktree, agents/oats-kernel-exp…
   ● oats-expert-tui                claude      │   home     …instances/oats-kernel-expert-retire
 ───────────────────────────────────────────────┴──────────────────────────────────────────────
 / filter   Tab detail   r refresh   ? help   q quit
```

- **The header** has the workspace's name and the counts: instances running,
  instances that need input, stopped, state unknown, and rows the kernel
  reported that were withheld (a home outside its soul's directory, or one
  reported twice). A count of zero is left out. The second row names the
  views; `2 Souls` and `3 Capabilities` are dim because they cannot be
  opened yet. On the right is the time of the read the screen shows.
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

| Mark | ASCII | Means |
|---|---|---|
| `●` | `*` | running |
| `○` | `-` | stopped |
| `◌` | `~` | stopped, with a shell left in its terminal |
| `?` | `?` | state unknown: the kernel or the terminal probe could not tell |
| `◆` | `#` | held by a spawn or a retire that is not finished |
| `▾` `▸` | `v` `>` | has instances below it: shown, folded away |
| `!` | `!` | needs input |
| `!N` | `!N` | N instances folded away below it need input |
| `>` | `>` | the selected row (also drawn in reverse video), and the pane the movement keys act on |

Every state has a mark of its own shape, so nothing is told by colour alone.

**When the deployment cannot be read,** the list says so in words. A read
that fails after a good one keeps the last rows and marks them `stale`,
with the time they were read and the reason on rows of its own; a
deployment that could not be observed at all shows `not observed` and the
reason, and no rows. Which of the two a failure becomes is one rule, shared
with the Desktop. The reason is shown as the kernel or the reader gave it.

Names are cut by terminal cells with `…` (`...` in ASCII) when they do not
fit; the detail shows them whole.

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
| `?` | opens the help; `?` again closes it |
| `Esc` | closes, in this order: the help, the filter field, a kept filter, the detail |
| `q`, `Ctrl+C` | quits, with status 0 (a SIGINT from outside answers 130) |
| `Ctrl+Z` | suspends: the shell gets the terminal back as it was; `fg` returns, redraws and reads at once |
| `Ctrl+L` | redraws the whole screen, and sets the terminal's modes again if something reset them |

`Enter` does nothing in this version. The help screen is generated from the
table the program acts on, so it always lists the keys that work, with the
marks and with what this version does not do. The movement keys scroll it.
`Ctrl+\` does nothing.

**The filter.** `/` opens a field on the last row. What you type narrows the
list to the instances whose name, soul or repository contains it, with the
instances they were spawned from, whatever is folded away. In the field
every printable key is text, so `q` and `j` can be typed; `Backspace`
removes a character, `Enter` keeps the filter and returns to the list
(the last row then shows it as `/text`), `Esc` clears it. `Ctrl+C`, `Ctrl+Z`
and `Ctrl+L` still do what they do. The filter holds at most 200
characters.

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
  `collapse`, `expand`, `detail`, `filter`, `refresh`, `instances`, `help`,
  `close`, `quit`, `suspend` and `redraw`.
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
| gives one key to two actions, your lists and the kept keys together | `the key … is given to … and to …; a key does one thing` |
| leaves `quit` with no key | `quit has no key; give it one` |

A name from the file is repeated in a line only when it is plain printable
ASCII of at most 40 characters. More than twenty problems are counted, not
listed.

## What it reads, and what it runs

`oats tui` decodes no kernel answer itself: it runs the readers it shares
with the Desktop (`packages/client/`).

- **Every read is two kernel commands**, `oats status --json` and
  `oats workspace status --json` for the deployment, run with **the kernel
  it shipped with** (the `bin/oats.mjs` of the same install, with the Node
  that runs the TUI), never an `oats` found on `PATH`. Each has 30 seconds
  and 4 MiB.
- **Then one probe of the terminals**: a small program of the shared readers
  asks tmux which instances have a live pane (`tmux list-panes`, and `ps`
  for what runs in them). It has 30 seconds. An instance the kernel itself
  reported as unknown is not probed and stays unknown.
- **How often:** 5 seconds after the last read ended; 30 seconds once ten
  minutes have passed without a key; at once on `r` and on the return from a
  suspend. A read in the background may reuse what the kernel observed of
  the workspace's remotes in the last 60 seconds; `r` asks for a fresh one.
- **Every child runs in a session of its own** and is ended when the TUI
  ends, by any way out. A read that was running when the TUI is suspended is
  dropped, not shown: its answer could arrive cut. The return reads again.
- It reads only. It runs no command that changes a deployment.

## What this version does not do

| To | Run |
|---|---|
| open an agent's terminal | `oats session attach --home <home>` (the detail shows the home) |
| stop an agent | `oats instance stop <instance>` |
| start or restart an agent | `oats session start --home <home>` |
| retire an agent | `oats retire <instance>` |
| see souls, spawn an agent | `oats souls`, `oats spawn <soul>` |
| see capabilities | `oats capabilities` |
| see other machines | `oats server roster` |

The help screen (`?`) carries the same list. Also not in this version: a
second deployment in one run (start it once per deployment), saving what is
folded away or the filter, sorting, and a mouse.

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
  starts are the reads above, and none outlives it.

## Errors

| Error | When | What to do |
|---|---|---|
| `E_NO_TERMINAL` | stdin or stdout is not a terminal, or `TERM` is unset, empty or `dumb`. One line on stderr, nothing on stdout, exit 1 | run it in a terminal; `oats status` prints the instances once |
| `E_BAD_ARGS` | `oats tui --json`: it is interactive and has no JSON form. The usual failure envelope, exit 1 | `oats status --json` is the machine view |
| `E_BAD_ARGS` | any argument other than `--dir <path>`, `--ascii` and `--help`, or `--dir` with no path. One line on stderr with the usage, exit 1 | `oats tui --help` |
| `E_TUI_CONFIG` | `tui.json` cannot be honoured. One line per problem on stderr, exit 1 | fix the file as the line says, or remove it |
| `E_NO_DEPLOYMENT` | no directory at or above the start holds an `oats-local.yaml`. One line on stderr, exit 1 | `oats tui --dir <path>`, or `cd` into the deployment |
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
