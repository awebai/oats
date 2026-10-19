# Desktop keyboard: the keymap, regions and reach

The whole Desktop works from the keyboard, with a keymap that is sane on Linux
(Omarchy, GNOME, KDE) and Windows as well as macOS. This page is the reference
for the default chords, the rules that chose them, how focus moves between the
window's regions, and how each interactive element is reached and operated.

Code: `renderer/keybindings.mjs` (the engine, `DEFAULT_KEYMAP`,
`TERMINAL_ALLOWLIST`, `SIDEBAR_KEYS`), `packages/client/keymap.mjs` (the leader,
its table and the plain keys, the TUI's), `renderer/leader.mjs` (the
leader's wait), `renderer/leader-keys.mjs` (which rows apply, the Desktop's
labels), `renderer/leader-dispatch.mjs` (what each key does),
`renderer/leader-hint.mjs` (the hint), `renderer/focus-regions.mjs` (F6),
`renderer/surface-return.mjs` (back to where you were),
`renderer/instance-recency.mjs` (the palette's last-focus record),
`renderer/shell.mjs` (action registration). Tests: `test/keymap-linux.test.mjs`,
`test/leader.test.mjs`, `test/leader-dispatch.test.mjs`, `test/keymap-shared.test.mjs`,
`test/sidebar-keys.test.mjs`, the root `test/keymap-parity.test.mjs` (the table is the TUI's),
`test/keybindings.test.mjs`, `test/focus-regions.test.mjs`,
`test/spawn-dialog-keyboard.test.mjs`, `test/palette-tree.test.mjs` (the palette's tree rows, connectors and cycling),
`test/palette-recency.test.mjs` (its recency order, first-row opening and focus record), `test/tab-strip-reveal.test.mjs`,
`test/roster-scrollport.test.mjs` (a focused roster row is revealed inside the list),
`test/roster-reveal-row.test.mjs` (an active terminal tab reveals its roster row),
`test/theme-picker.test.mjs` (the theme picker's keys), `test/shell-design.test.mjs` (Show sidebar,
Show instance panel and the closed sidebar and panel).

## Principles

1. **Super/Meta belongs to the window manager on Linux.** Omarchy (Hyprland),
   GNOME and KDE bind Super+* heavily. The Desktop never binds Super on
   Linux/Windows: `Mod` is ⌘ on macOS and Ctrl everywhere else.
2. **A default chord never takes a key that a program inside the terminal
   reads.** Plain Ctrl+letter: Ctrl+W deletes a word, Ctrl+K kills to the end
   of the line, Ctrl+\ is SIGQUIT, Ctrl+P is shell history, Ctrl+B is the tmux
   prefix. Function keys: F1 and F6 in htop, mc and nano. Alt+digit (ESC and a
   digit): readline's numeric argument, irssi/weechat windows, a common tmux
   select-window binding. Ctrl+PgUp/PgDn in vim and weechat. On macOS the
   ⌃digits, which are control bytes (⌃3 ESC, ⌃4–⌃7 FS/GS/RS/US, ⌃8 DEL; ⌃6 is
   vim's alternate file). Such a key may stay bound for focus outside a
   terminal, but it is never terminal-allowlisted. On Linux/Windows a chord
   fires in a terminal only when xterm sends nothing for it, or when what it
   sends is a byte the program still gets from a plainer key. Mostly that is
   **Ctrl+Shift+key**, the convention of GNOME Terminal, Alacritty, Ghostty and
   kitty (and of Terminator/Tilix for splits); Omarchy's terminals follow it.
   xterm also sends nothing for Ctrl+1, Ctrl+2, Ctrl+, and Ctrl+= Ctrl+-
   Ctrl+0. The allowlisted defaults that do send something:

   | Chord | xterm sends | The program still gets it from |
   |---|---|---|
   | Alt+O (the leader) | ESC o | Esc, then o; and the leader pressed twice sends it |
   | Ctrl+3 (Automations) | ESC | Esc (Ctrl+[ stays the program's too) |
   | Ctrl+Tab (next tab) | Tab | Tab |
   | Ctrl+Shift+Tab (previous tab) | ESC [ Z | Shift+Tab |
   | Ctrl+Shift+Alt+W (close the split) | ESC Ctrl+W | Ctrl+Alt+W |
   | Ctrl+Shift+F6 (leave the terminal) | ESC [ 17 ; 6 ~ | no plainer key: the one deliberate exception, because without it F6 cannot get out of a terminal |

   `test/terminal-xterm-bytes.test.mjs` presses every allowlisted default in
   the installed xterm.js and pins exactly what it sends, so an xterm upgrade
   that changes one fails CI.
3. **macOS keeps ⌘.** ⌘ never reaches the pty, so the macOS column changes only
   where a chord is wrong for macOS users too. One named exception: the leader,
   ⌃\ (the TUI's), fires in a terminal, checked by action id *and* shape (⌃
   alone, key `\`), as Ctrl+Tab is. ⌃\ is SIGQUIT's byte, 0x1c; the leader
   pressed twice gives the program exactly that. A rebind of the leader to a ⌘
   chord fires by the ⌘ rule; a rebind to another ⌃ chord stays the program's.
4. **Every default goes through the collision review** in the keyboard lesson
   (`keyboard-focus-and-action-ownership`). That includes shifted punctuation:
   `KeyboardEvent.key` reports the shifted character (Shift+\ arrives as `|`).
   A chord that holds ⌘, Ctrl or Alt aliases it back (`MODIFIED_ALIASES`:
   `|` is `\`, `+` is `=`), so ⌘⇧\ matches. A plain chord keeps its
   character: one printable non-letter key (`?`, `|`, `[`, `/`) matches with
   whatever Shift the layout needed and is stored without Shift, so plain `|`
   never fires on plain `\`; a letter keeps its case (`N` is Shift+N). The
   tests dispatch the real shifted event, not a parse round-trip.

## How the engine holds it

- `DEFAULT_KEYMAP` has one entry per action id: a chord string (the same on
  every platform) or `{ mac, other }` when the platforms differ; `null` is "no
  default here". `defaultBinding(id, isMac)` reads it; `getBinding(id, isMac)`
  is override → platform default → a view's registration default.
- **Stored overrides win**, on every platform. Action ids never changed, so an
  override saved before this keymap still applies. The shortcuts editor shows
  the platform's effective chord and offers Reset when it differs from the
  platform default. A stored rebind that now shares its chord with another
  binding (a new default, say) is never changed for you: `keymapConflicts`
  finds it at load and on every keymap change, the footer's shortcuts button
  carries a warn dot and a description, and the editor names each clash at the
  top and on its row until you rebind or reset one side.
- One chord per action. Where the table has two (Ctrl+Tab and Ctrl+PgDn; F and
  0 on the overview canvas), the second is its own action (`tabs.nextPage`,
  `hier.fitZero`), rebindable and unbindable on its own.
- **Terminal policy.** On Linux/Windows only the action ids in
  `TERMINAL_ALLOWLIST` fire while a terminal has focus; everything else reaches
  the program. The rule is by action id, so a user who rebinds an allowlisted
  action keeps their choice in the terminal; the allowlist is chosen by the
  defaults (principle 2). On macOS only ⌘ chords fire in a
  terminal (⌘ never reaches the pty), plus two shapes, each checked by
  action id *and* shape: Ctrl+Tab / Ctrl+Shift+Tab (`tabs.next`, `tabs.prev`)
  and the leader's ⌃\ (`app.leader`, principle 3's exception).
- Unmodified chords never fire from an editable field; a view's own keys (the
  overview canvas, the Souls grid) stay local to that view.

## The leader

New in 0.65.0. The leader is the TUI's: one chord, then one key from the TUI's
table. The Desktop reads it from `LEADER_TABLE` in `packages/client/keymap.mjs`;
the TUI still keeps its own copy (`LEADER` in `packages/tui/lib/actions.mjs`),
and the root `test/keymap-parity.test.mjs` fails when the two part. It is
**Alt+O** on Linux and Windows and **⌃\** on macOS (`app.leader`, rebindable
like any action; the table after it is fixed, as in the TUI).

**The leader and the keys after it are the TUI's; the direct shortcuts are
Desktop extras.** So the two can differ, on purpose: leader then 1 is
Instances and leader then 3 is Capabilities, while ⌘1 / Ctrl+1 stays
Deployments and ⌘3 / Ctrl+3 stays Automations. The shortcuts editor says the
same on those rows.

**Where it works.** From every focus, a terminal and an editable field
included. It is inert while a modal dialog or the palette is shown, as F6 and
the tab switches are: the chord then goes where it goes without the leader.
The sidebar footer's first control, the leader's chord and "commands", is a
button that starts it too; pressed again while it waits, it closes the hint.

**While it waits** (there is no time limit), the next keydown that is not a
lone modifier settles it:

- A key in the table runs what the table below says, once, and is consumed:
  no phase of it (keydown, keypress, keyup, repeats) reaches the terminal or
  the focused control.
- The leader again: in a terminal, that second press is the program's, so it
  gets exactly what the chord sends (Alt+O ESC o, ⌃\ 0x1c). Elsewhere it only
  closes the hint.
- Any other key cancels it and is dropped: nothing is typed, nothing else runs.
- A key is matched by what it types (`KeyboardEvent.key`: Shift+x is `X`,
  Shift+\ is `|`), whatever Shift or AltGr produced it. A key held with Ctrl,
  ⌘ or Alt (AltGr aside) is not in the table, as in the TUI, and cancels.
- A click, a paste, the window losing focus, a modal opening or the focused
  element leaving the document cancels it, with nothing run.

**The hint.** While it waits, a quiet panel at the bottom of the main area
lists the keys that apply now, key then label, and is announced once ("Leader:
press a key, Esc for the instances list"). It never takes focus. The rows the TUI
marks as terminal rows (`z`, `w`, the tab and split keys) show only while a
terminal tab is open; besides, ←/→ need two tabs or more, `|`/`-` an active
tab that can split that way, and Tab and `x` tabs that are split. When a key cannot act (no target
instance, an act the instance's menu would not offer, nothing to split), the
panel says why in one line, which stays until the next key, click or focus
change.

**The target instance** of `X` `R` `S` `D` `N` and the roster moves: the
terminal's instance when the leader was pressed in a terminal; else the
focused roster row's; else the active terminal tab's; else none.

| Leader, then | Desktop does |
|---|---|
| `k`, Space | the command palette (`app.palette`) |
| `1` | Instances: the workspace's terminals again when any is open, else Deployments |
| `2` | Workspace › Souls |
| `3` | Workspace › Capabilities |
| ↑, ↓ | opens the terminal of the roster row before / after the target, as the roster is drawn (filter applied, collapsed rows absent), passing over rows whose Enter would not open a terminal; no wrap. With no target, ↓ opens the first and ↑ the last |
| ←, → | previous / next tab (`tabs.prev`, `tabs.next`; the Desktop's cycling wraps, the TUI's does not) |
| `z` | focus mode on or off (`app.focusMode`), and the active terminal takes focus |
| `w` | closes the active tab (`tabs.close`); the agent keeps running |
| `\|`, `-` | split right / split down (`split.vertical`, `split.horizontal`) |
| Tab | focuses the next editor group's active tab, or the group when it is empty, wrapping (`split.focusNextGroup`) |
| `x` | closes the split, every tab kept (`split.close`) |
| `X`, `R`, `S`, `D` | Stop… / Restart… / Start… / Retire… for the target: the same dialogs and availability as its roster menu |
| `n` | Quick Open: pick a soul, then the spawn dialog (`app.quickOpenSouls`) |
| `N` | the spawn dialog for the target's soul, as Quick Open opens it |
| `/` | the roster filter (`sidebar.focusFilter`) |
| `o` | the workspace switcher (`app.workspaces`) |
| `?` | the shortcuts editor (`app.shortcuts`), the Desktop's help |
| Esc | the instance roster, its one tab stop; a hidden sidebar or focus mode is shown first |

**Cannot apply:** `m` (move the tab to the other group). The Desktop has no
way to move a tab between groups; the key cancels like any key not in the
table, and the hint leaves it out.

## The keymap as shipped

| Action (id) | macOS | Linux / Windows | Works in a terminal (Linux/Win) |
|---|---|---|---|
| Command palette (`app.palette`) | ⌘K | Ctrl+Shift+K | yes (plain Ctrl+K, kill to the end of the line, stays the program's) |
| Quick open a soul (`app.quickOpenSouls`) | ⌘P | Ctrl+Shift+P | yes (plain Ctrl+P, shell history, stays the program's) |
| Spawn instance: choose a soul in Workspace (`app.chooseSoul`) | ⌘N | Ctrl+Shift+N | yes |
| Close tab (`tabs.close`) | ⌘W | Ctrl+Shift+W | yes |
| Next / previous tab (`tabs.next`, `tabs.prev`) | ⌃Tab / ⌃⇧Tab | Ctrl+Tab / Ctrl+Shift+Tab | yes |
| Next / previous tab, second chord (`tabs.nextPage`, `tabs.prevPage`) | none | Ctrl+PgDn / Ctrl+PgUp | no (vim, weechat) |
| Go to tab 1–8, last tab (`tabs.goto1`…`tabs.goto9`) | ⌥⌘1–⌥⌘9 | Alt+1–Alt+9 | no (readline, irssi/weechat, tmux) |
| Split right (`split.vertical`) | ⌘\ | Ctrl+Shift+E | yes |
| Split down (`split.horizontal`) | ⌘⇧\ | Ctrl+Shift+O | yes |
| Close the split (`split.close`; no button since spec F) | ⌥⌘W | Ctrl+Shift+Alt+W | yes |
| Deployments / Workspace / Automations (`stage.hierarchy`, `stage.spawn`, `stage.automations`) | ⌘1 / ⌘2 / ⌘3 | Ctrl+1 / Ctrl+2 / Ctrl+3 | yes (Ctrl+3 is ESC, which Esc still sends) |
| Focus next / previous region (`focus.nextRegion`, `focus.prevRegion`) | F6 / ⇧F6 | F6 / Shift+F6 | no (mc, htop, nano) |
| Leave the terminal for the next region (`focus.leaveTerminal`) | ⇧⌘F6 | Ctrl+Shift+F6 | yes |
| Sidebar (`sidebar.toggle`; also the footer's sidebar button, and Show sidebar while it is hidden) | ⌘B | Ctrl+Shift+B | yes (plain Ctrl+B, the tmux prefix, stays the program's) |
| Filter instances (`sidebar.focusFilter`) | ⌘F | Ctrl+Shift+F | yes |
| Instance panel (`panel.toggle`; also Show instance panel while it is closed, and the panel's own close button) | ⌘I | Ctrl+Shift+I | yes (plain Ctrl+I, the Tab byte, stays the program's) |
| Theme picker (`app.themePicker`; also the theme button and **Theme: choose…**) | ⇧⌘Space | Ctrl+Shift+Space | yes |
| Theme cycle: White, Solarized, Dark, This computer (`app.themeToggle`) | none | none | – (the palette keeps it) |
| Keyboard shortcuts (`app.shortcuts`) | ⌘, | Ctrl+, | yes |
| The leader, then one key (`app.leader`; see "The leader") | ⌃\ | Alt+O | yes (Alt+O sends ESC o, which Esc then o still sends; on macOS by principle 3's exception) |
| Focus the next editor group (`split.focusNextGroup`; the leader's Tab) | none | none | – |
| Copy the terminal selection (`terminal.copySelection`) | ⌘C (Edit › Copy, the menu role; the action has no macOS default) | Ctrl+Shift+C | yes |
| Terminal zoom (`terminal.fontBigger`, `…Smaller`, `…Reset`; also Settings → Terminal; reset lands on 15px) | ⌘= ⌘- ⌘0 | Ctrl+= Ctrl+- Ctrl+0 | yes |
| Open a file read-only (`app.openFile`) | ⌘O | Ctrl+O | no (Ctrl+O is a byte programs read) |
| New window, with no workspace (`app.newWindow`) | ⌘⇧N (File → New Window, the menu's accelerator) | none (the palette's **Window: new window**) | – |
| Cycle the app's windows | ⌘\` (macOS's own, Window menu) | none (the window manager's) | – |

Changed in 0.57.0 on Linux/Windows: the palette is Ctrl+Shift+K (was
Ctrl+Shift+P), and Quick Open is Ctrl+Shift+P (was Ctrl+P) and now works from
a terminal. Ctrl+Shift+P, which opened the palette since 0.30.3, opens Quick
Open. A binding you set yourself is kept as it is; when it is a chord a
default now takes, the shortcuts editor shows the clash. A Quick Open binding
you set yourself now fires from a terminal too, so a plain Ctrl+letter there
takes that key from the program.

Changed in 0.56.0 on Linux/Windows: the sidebar (was Ctrl+B) is
Ctrl+Shift+B, the instance panel (was Ctrl+I) Ctrl+Shift+I, and filter
instances (was Ctrl+F) Ctrl+Shift+F; these, the stages (Ctrl+1/2/3), the
shortcuts editor (Ctrl+,) and terminal zoom now work from a terminal. A
binding you set yourself is kept as it is.

Changed from 0.30.1 on Linux/Windows: the palette (was Ctrl+K), close tab (was
Ctrl+W), the splits (were Ctrl+\ and Ctrl+Shift+\, Ctrl+Alt+W), and Spawn
instance (was Ctrl+N). The theme cycle lost ⌘⇧T / Ctrl+Shift+T on both
platforms: it means "reopen closed tab" in browsers and "new tab" in Linux
terminals. New: go to tab, Ctrl+PgDn/PgUp, ⌘3/Ctrl+3, F6, and ⇧⌘F6 /
Ctrl+Shift+F6 to leave a terminal.

On macOS the "works in a terminal" column is simpler: every ⌘ chord works there
(⌘ never reaches the pty), and so does ⌃Tab; ⌃digits and F6 are the program's.
From a terminal, Ctrl+Tab switches tabs on every platform, and ⌥⌘digit goes to
a tab on macOS; on Linux/Windows leave the terminal first (Ctrl+Shift+F6), then
Alt+digit.

Copy and paste in a terminal (#672). A drag, double-click or triple-click is
xterm's own selection. Ctrl+Shift+C (`terminal.copySelection`, allowlisted)
writes it to the clipboard on Linux/Windows; with nothing selected it does
nothing and sends nothing to the pty, and Ctrl+C, which xterm sends as the
interrupt, stays the program's. On macOS ⌘C is Edit › Copy, the menu's role,
not a keymap action. Right-click › Copy works on every platform. Paste is not
a keymap action either: ⌘V (Edit › Paste) on macOS and Ctrl+Shift+V on
Linux/Windows are Chromium's own paste into the terminal's input, which xterm
sends as one bracketed paste when the program asked for it; right-click ›
Paste does the same, and so does middle-click on Linux, which pastes the
primary selection a drag sets.

Ctrl+Shift+E (split right on Linux) is also IBus's emoji hotkey on GNOME. The
Desktop keeps it, after Terminator and Tilix; if IBus takes it first, rebind
split right in the shortcuts editor or change IBus's hotkey (IBus Preferences →
Emoji).

The theme picker's chord is the in-app counterpart of Omarchy's theme menu
(Super+Ctrl+Shift+Space). Linux/Windows leave out Super, which belongs to the
window manager (principle 1); macOS puts ⌘ in Super's place and leaves out ⌃,
because on macOS a chord that holds ⌃ never fires while a terminal has focus
(Ctrl+Tab aside).
xterm.js sends no byte for either chord (its Ctrl+Space → NUL needs Shift up),
so the picker takes nothing from a program, and plain Ctrl+Space stays the
program's. On Omarchy, Super+Ctrl+Shift+Space opens Omarchy's own theme menu,
which changes the computer's theme (the one This computer follows), and
Ctrl+Shift+Space opens Desktop's picker. On Linux the engine ignores Super, so
where the window manager lets Super+Ctrl+Shift+Space through, it opens
Desktop's picker as well. A held chord does not open and close the picker over
and over. The theme button opens the picker too; the theme cycle stays in the
palette.

Inside the theme picker: ↑/↓ move between the themes (wrapping), Home/End go to
the first and last, Enter, Space or a click chooses (nothing applies before
that), Escape, the close button or the backdrop closes with nothing changed,
and Tab / Shift+Tab stay inside it; a background shortcut that moves focus
(⌘F / Ctrl+Shift+F to the roster filter) cannot take it out. Focus returns to what had
it, also to a control in a dialog that stays open under the picker (Stop or
Retire, Connections). The picker is on the palette layer, so it never opens where it
cannot be seen: while a dialog above that layer is shown (the spawn dialog,
the workspace dialog, the start dialog), the chord and **Theme: choose…** do
nothing, and the theme button is behind that dialog's scrim.

F1 was considered as a second palette chord and left out: in a terminal F1
belongs to programs such as htop and mc.

Ctrl+Shift+N stays Spawn instance on Linux/Windows: New Window has no default
chord there, and the app installs no menu there, so it takes no Ctrl
accelerator from the terminal.

Actions without a default (bind them in the shortcuts editor): the workspace
switcher, New window (Linux/Windows), Connections, focus mode, focus the active terminal, return to
terminal groups, focus the next editor group, explicit themes (`app.theme.light`, `app.theme.solarized`,
`app.theme.dark`, and `app.theme.host` for This computer), and the instance menu's Open in split / Open
pull request.

Rebinding applies everywhere a chord is shown: tooltips, the footer hints, the
palette's command details and the spawn dialog's Spawn button.

### Sidebar keys

New in 0.65.0. While focus is in the sidebar (the nav, a roster row, the
footer), the TUI's plain keys work there too (`PLAIN_KEYS` in
`packages/client/keymap.mjs`). Each is its own action in the `sidebar`
context (`sidebar.key.*`, `SIDEBAR_KEYS`), rebindable and unbindable in the
shortcuts editor's **Sidebar keys** group, and each does what the same key
does after the leader. They never fire in an editable field (the roster
filter types them) or inside a menu or list popup open there (an instance's
actions menu, the workspace switcher's menu), and never with focus outside the
sidebar.

| Key | Action id | Does |
|---|---|---|
| `1` `2` `3` | `sidebar.key.instances`, `…souls`, `…capabilities` | Instances, Workspace › Souls, Workspace › Capabilities |
| `w` | `sidebar.key.workspaces` | the workspace switcher |
| `/` | `sidebar.key.filter` | the roster filter |
| `r` | `sidebar.key.refresh` | reads the instance roster now |
| `z` | `sidebar.key.zoom` | focus mode on or off, then the active terminal |
| `c` | `sidebar.key.closeTerminal` | closes the active tab |
| `[` `]` | `sidebar.key.tabPrevious`, `…tabNext` | previous / next tab |
| `\|` `-` | `sidebar.key.splitRight`, `…splitDown` | split right / split down |
| `X` `D` `S` `R` | `sidebar.key.stop`, `…retire`, `…start`, `…restart` | Stop… / Retire… / Start… / Restart… for the focused roster row (on a nav or footer control, the active terminal tab's instance) |
| `n`, `N` | `sidebar.key.spawn`, `…spawnAnother` | Quick Open; the spawn dialog for the focused row's soul |
| `?` | `sidebar.key.help` | the shortcuts editor |

A key that cannot act says why in one line at the bottom of the main area, as
the leader does. While focus is in the sidebar the tab layer's (or a stage's)
shortcuts are on too, so a sidebar key and a tab shortcut on the same chord
clash: the shortcuts editor shows it, as it shows any clash with a stored
rebind. A one-character non-letter key (`?`, `|`, `[`, `/`) matches
whatever Shift the keyboard layout needs for it; a letter keeps its case, so
`x` is not Stop.

On a roster row the tree also reads the TUI's `k` `j` (up, down), `g` `G`
(first, last), `h` `l` (collapse or go to the parent, expand), beside the
arrows, and PageUp/PageDown move by the rows that fit the list. These stay the
tree's own keys, as the arrows are, and are not in the shortcuts editor.

**Not taken, and why:**

- Tab: the sidebar's own focus order.
- Esc: keeps closing what it closes today.
- `q`, Ctrl+C (quit): a stray letter must not close a window; the window
  manager and ⌘Q own that.
- Ctrl+Z, Ctrl+L: a terminal program's suspend and redraw; nothing to do in a
  window.
- Ctrl+K: the Desktop's palette is ⌘K / Ctrl+Shift+K, and plain Ctrl+K is the
  program's in a terminal, so it would work in only half the places; the
  leader's `k` is the shared key.
- `C` (check an unknown spawn): the Desktop reports a spawn's outcome in its
  own notification; there is no command to put on a key.
- `i`, and the Souls and Capabilities views' own keys: those views keep their
  local keys.

## Regions (F6)

F6 moves focus to the next region, Shift+F6 to the previous one, in this order:

1. **Sidebar nav**: the current view's nav item (`aria-current`), else the
   first. The workspace switcher and the footer tools are in this region and
   are reached with Tab and Shift+Tab from there.
2. **Instance roster**: its one tab stop, the selected row (the one whose
   terminal is the active tab), else the first row that matches the filter,
   else the filter.
3. **Main**: with tabs open, the active tab's content (a terminal's input,
   through the same selection intent as any explicit terminal focus), else a
   focused empty split group, else the active tab in the strip; on a stage,
   its first control. The tab strip, the split controls, Show sidebar and Show
   instance panel belong here.
4. **Instance panel**: its selected tab (a stage's content, such as the soul
   inspector: its first control), while the panel is open.

Inside a terminal F6 belongs to the program (mc, htop, nano). **⇧⌘F6 /
Ctrl+Shift+F6** (`focus.leaveTerminal`) leaves the terminal for the next region
in the same order; from there plain F6 and Shift+F6 cycle as usual.

Then back to the nav. A hidden region is skipped (the sidebar while hidden or
in focus mode, the panel while closed or when it has nothing to show), and so
is a region with nothing focusable at that moment: focus never lands on
`<body>`. From a terminal the closed panel is opened by `panel.toggle`'s chord.

**A closed sidebar or panel leaves nothing behind** (no strip, rail or edge).
Two buttons reopen them, at the two ends of the main area's top bar (the tab
strip with tabs open, else the stage's header): **Show sidebar** at its start,
shown while the sidebar is hidden or focus mode is on (`sidebar.toggle`, which
also leaves focus mode), and **Show instance panel** at its end, shown while the
panel is closed, or hidden by focus mode, and has something to show
(`panel.toggle`; with the Developer page's change dot, "Show instance panel,
Developer has changes"). They are ordinary buttons in the Main region's tab
order, Show sidebar first and Show instance panel last, each with
`aria-controls` and `aria-expanded="false"`, and their tooltips name the live
chord. Focus follows them: hiding the sidebar with focus in it moves focus to
Show sidebar; closing the panel with focus in it moves focus to Show instance
panel; opening the panel with that button moves focus to the panel's selected
tab; a chord pressed in a terminal opens or closes either and leaves focus in
the terminal. Entering focus mode is the exception: focus that was in the
sidebar goes to the active tab, the content focus mode is for. Opening an instance's terminal never opens the panel: whether it
is open is the user's, kept on this computer, and it starts closed. While a modal
dialog or the palette is open, F6 and the tab switches (Ctrl+Tab, Ctrl+PgDn/PgUp,
go to tab) do nothing; the dialog keeps focus.

Tab switches from the keyboard (Ctrl+Tab, Ctrl+PgDn, go to tab) keep focus in
the new tab's content when it was in content, and on the strip when it was on
the strip. Whenever another terminal tab becomes active (any of these, a click
or an arrow on the strip, a close's successor, a pane of another split group),
and on a click on the tab that is already active, its roster row reads as
selected and the roster scrolls just enough to show it, without taking focus.
It does not scroll while the sidebar is hidden or in focus mode, nor for a row
the filter hides; under a collapsed parent it shows the nearest visible
ancestor's row and leaves the parent collapsed. A stage switch from a chord, the palette or a nav button leaves
focus where it was when that is still shown, else on the stage's first
control.

## The command palette (⌘K)

- **⌘K / Ctrl+Shift+K** opens the palette: the sidebar's tree, in the modal,
  ordered by last focus. Every instance of the window's workspace is listed
  once, in the sidebar's deployment sections, relation groups and runs of
  independent instances, indented by depth (the sidebar's collapsed state is
  ignored). Then up to twelve commands. `>` restricts to commands.
- **The order is last focus.** An instance is focused when its tab becomes the
  active tab, by any path, or its terminal takes keyboard focus. At every level
  a node sits where the most recently focused instance of its subtree puts it:
  a relation cluster or a single instance by its most recent member, a
  cluster's roots and each parent's children the same way, and, with several
  deployments, each deployment's section by its most recent instance. So a
  child focused after its parent lifts the parent's group and the parent above
  its siblings. A child always stays under its parent. Instances never focused
  keep the sidebar's order (name), after the rest; with no record at all the
  palette lists exactly the sidebar's order. Groups form again after ordering
  by the sidebar's rule, so an instance focused a minute ago is not held behind
  a stale run of independent ones. The sidebar roster keeps its stable name
  order; only the palette is ordered by focus.
- **The palette opens on its first row.** With an empty query the active row
  is the top of the list: by the order above, the root of the most recently
  focused path. ⌘K again moves down from there. (Until #1391 it opened on the
  agent you were on before, often a row in the middle of the list.)
- The focus record is per machine: one `localStorage` key
  (`oats-desktop-instance-recency`), keyed by workspace and by the instance's
  exact identity (the terminal tab's key), the 200 most recent per workspace.
  It survives a restart and is never written to a deployment or sent to the
  server. A missing or corrupt value reads as empty; an entry for an instance
  no longer in the roster is not listed.
- **With a query** each match is listed with its non-matching ancestors shown
  dimmed for context, in the same order as the unfiltered list: the order is
  decided on the full roster and the query only decides which rows show, so a
  group's place never changes while you type. A match stays in its relation
  group, as in the filtered sidebar: one match out of a group of five is listed
  under that group's name, not under independent. The active row is the first
  match. A context row is `aria-disabled`: the arrows, the chord and the pointer
  skip it, and it opens nothing.
- **The rows look like the sidebar's.** Each instance row draws the sidebar's
  connectors, from the sidebar's own code (`treeConnectors` and its DOM builder
  `treeGuides`, `renderer/instance-tree-view.mjs`, and the same `.ctx-guide`
  rules): the dotted line joining the roots of one group (sibling links) on the
  dot column, and the solid parent→child elbows and pass-throughs to its right.
  Its dot is the sidebar's state dot: running, stopped or unknown. A context row
  keeps its lines; only its text is dimmed.
- **Relations in words.** A nested row's option reads "…, under <parent>" and an
  instance at either end of an explicit sibling link reads "…, sibling of
  <name>", visually hidden and read once with the option; the lines show both,
  so no relation text is drawn. Only direct links within one deployment count,
  and a sibling's name does not match the row.
- **While the palette is open, its own chord cycles**: ⌘K moves the active row
  down, ⇧⌘K up, both wrapping past the ends. Releasing commits nothing:
  **Enter** opens the active row and **Esc** closes. The arrows move too and
  stop at the ends. The cycle follows a rebind of `app.palette`. A chord that
  already holds Shift (Ctrl+Shift+K, the Linux/Windows default) has no Shift
  form, so ArrowUp moves up there. A plain-key binding never cycles: typing
  belongs to the input. Quick Open's chord does not cycle: a second ⌘P /
  Ctrl+Shift+P closes it.
- For assistive technology each relation group is a named `role=group`
  (announced once, on entry); the lines and dots are `aria-hidden`, and the
  relations are read as the words above. Options carry no `aria-level`, which
  is not an option's attribute.

## Quick Open and the spawn dialog

- **⌘P / Ctrl+Shift+P** finds a soul, from a terminal too; picking it opens
  the spawn dialog scoped to that soul, exactly as its card's Spawn does (the
  Workspace stage behind it). A soul
  that can't be spawned here (attached only, refused, no verified CLI) opens
  its soul page instead, which says why. Focus lands in Name.
- Dismissing the dialog (Cancel, Esc, ×, the backdrop) returns to where the
  operator was before Quick Open: the same tab re-activated (its terminal
  focused when that is where they were), or the same stage and control, else
  that region's current item. If they moved on while the dialog was open (a
  workspace switch, another stage or tab), the return is not forced and the
  dialog restores focus itself. A successful spawn closes the dialog at once and,
  when the instance runs, opens its terminal unless the operator acted since the
  press (a key other than a lone modifier, a paste, a focus move, a navigation) or
  an overlay is open (`docs/desktop-spawn-preview.md`, Background spawn).
- **Focus on open:** Name, whenever the dialog opens for a chosen soul (a card,
  the soul page, Quick Open, Reopen spawn), with the caret at the end of a
  restored name (never selected), without scrolling. Quick Open from a tab opens
  the dialog just before the Workspace stage is shown; Name takes focus once it
  is, unless the operator has focused something else by then.
- **Spawn: Mod+Enter (⌘↵ / Ctrl+Enter) from any field**, the Opening
  instruction and the segmented controls included; plain Enter in Name does
  not spawn, Enter or Space on the focused Spawn button does. The button
  shows the effective chord.
- **Tab order** is the visual order: Name → Prefix switch → Harness → Model (its
  field, then its suggestions button) → Relationship (one stop) → its target
  when shown → Teams (one stop) → Opening instruction → Developer settings →
  (Details, when a problem shows it) → Cancel → Spawn, then the header's Change
  soul and Close. Tab is trapped in the dialog.
- Segmented controls and radio groups are one tab stop: Arrow keys move (and
  choose, in a radio group), Home/End go to the ends (`roveSegment`).
- The Harness and Model pickers open with Enter, Space or Alt+Down and close
  with Escape back on their trigger. Escape closes an open picker first; with
  none open it closes the dialog.
- **Change soul** shows the soul list, focus on the selected soul (the search
  when the filter hides it): a listbox with Arrow/Home/End. Typing on the list
  filters it through its search; Enter in the search picks the best match;
  Enter, Space or a click on a soul picks it. Every pick moves focus to Name.
- **Section keys** (Spec E), from any field of the dialog:

  | Section | macOS | Linux / Windows | Lands on |
  |---|---|---|---|
  | Name (`spawn.jumpName`) | ⌘1 | Ctrl+1 | the Name field |
  | Harness (`spawn.jumpHarness`) | ⌘2 | Ctrl+2 | the Harness picker |
  | Model (`spawn.jumpModel`) | ⌘3 | Ctrl+3 | the Model field |
  | Relationship (`spawn.jumpRelationship`) | ⌘4 | Ctrl+4 | the selected segment |
  | Teams (`spawn.jumpTeams`) | ⌘5 | Ctrl+5 | the first team that can be ticked (nothing when Teams is not shown) |
  | Opening instruction (`spawn.jumpTask`) | ⌘6 | Ctrl+6 | the instruction |
  | Developer settings (`spawn.toggleAdvanced`) | ⌘7 | Ctrl+7 | opens it on its first control; again closes it back on its summary |

  A closed disclosure holding the target opens first. Each chord shows as a
  quiet hint beside its section's label (`aria-hidden`; the control carries
  `aria-keyshortcuts`). They are actions of the `spawn-dialog-local` context
  (`renderer/spawn-dialog-keys.mjs`, with Mod+Enter): the shortcuts editor
  lists them under **Spawn dialog** from the start and they can be rebound,
  but only the open dialog dispatches them. While it is open these chords are
  the dialog's: it stops them, held or not, so ⌘1–⌘3 never switch the stage
  behind the modal. A modal dialog's own context clashes only with itself in
  the editor (`findConflict`), never with a global key it shadows.
- ⌘N / Ctrl+Shift+N goes to Workspace › Souls; it never spawns.

## Keyboard audit

Walked with the keyboard only (static review of every renderer surface, then
the rig). "Fixed" marks a gap this change closed.

| Element | How it is reached | How it is operated |
|---|---|---|
| Workspace switcher (`#ws-trigger`) | Tab (first stop of the sidebar); F6 lands next to it on the nav | Enter/Space/Down open the menu; Esc closes it back on the trigger |
| Switcher menu: search, workspaces, Add | Focus starts in the search; Down enters the options, **Up from the first returns to the search (fixed)** | Enter/Space select; Home/End; **Tab out closes the menu (fixed)**; Home/End in the search move its caret (fixed) |
| A workspace's **Open in new window** button (beside each option, not inside it) | Right Arrow from its option (not a Tab stop); Left Arrow or Esc returns to the option, menu still open; Up/Down move between options as from the option | Enter/Space open the workspace in its own window (or bring that window to the front). On the option itself, ⌘Enter (macOS) / Ctrl+Enter (Linux/Windows) does the same; the option's description says so |
| Add / onboard workspace dialog | From the menu's Add | Radio-style suggestions with arrows; Esc; trapped; returns to the trigger |
| Sidebar nav (Deployments, Workspace, Automations) | F6 (current item); Tab; ⌘1/⌘2/⌘3 | Enter/Space |
| Roster filter | Tab; ⌘F / Ctrl+Shift+F; **Down from it enters the rows (fixed): while filtering, at the first match, never a parent kept only to show its tree path** | Typing filters |
| Roster rows | One roving stop, **the selected row, else the first filter match (fixed: was the first enabled)**; F6; the leader then Esc; Up/Down/Home/End (and the TUI's `k` `j` `g` `G`), PageUp/PageDown by the rows that fit; Right (`l`) expands, Left (`h`) collapses or goes to the parent; the sidebar keys (see "Sidebar keys"). A collapse or a filter never moves a row to another group: a root collapsed over its whole group stays under that group's name, and the selected row stays where it is. The list shows no scrollbar (the wheel and the touchpad scroll it): a row that takes keyboard focus (these keys, the filter's Down, F6) is revealed whole, its tools included, by scrolling the list alone, never an ancestor | Enter/Space open the terminal (running) or Start (stopped) |
| Rows whose state is unknown or that the kernel does not report addressable | **Focusable, `aria-disabled` with the reason as a description (fixed: were `disabled`, which hid their tools from the keyboard)** | Activation does nothing; their tools work |
| Row tools: PR link, Start…, actions menu | Tab from the focused row (shown on focus) | Enter/Space; the menu: arrows, Home/End, Esc back on its trigger, Tab closes |
| Start / Restart dialog, lifecycle dialog | From the row or its menu | Esc (Cancel before anything is sent, Close or Done after); trapped; the lifecycle dialog starts on Cancel and focuses Close or Done when it ends; **focus returns to the row when its tool is hidden again (fixed: fell to `<body>`)**, and after a retire to the row that followed it |
| Sidebar footer: the leader ("Alt+O commands"), Spawn instance, sidebar, theme, shortcuts, settings, palette | Tab | Enter/Space run the same registered actions as the chords; the leader's button starts the leader (its hint opens, the next key settles it) and, pressed again, closes it |
| Show sidebar (start of the main area's top bar, while the sidebar is hidden or in focus mode) | Tab, first in the Main region; hiding the sidebar moves focus to it | Enter/Space: `sidebar.toggle` (leaves focus mode too) |
| Tab bar | One roving stop per tablist (per group when split); F6 (main). Tabs shrink to fit (spec F); the active tab is scrolled fully into view in its own strip on every activation, close and strip resize, and a focused control is revealed in its strip, never by scrolling an ancestor | Left/Right/Home/End select; Delete closes the focused tab, and the keymap's `tabs.close` (⌘W / Ctrl+Shift+W, rebindable; the close button's tooltip names it) closes the active one; Ctrl+Tab from anywhere in the tab layer, and Ctrl+PgDn/PgUp and go-to-tab outside a terminal (⌥⌘digit also inside one on macOS), **keeping focus in the content (fixed: fell to `<body>`)** |
| Terminal | Enter on its roster row; F6 (main) | Every key reaches the program except the terminal-allowlisted chords; ⇧⌘F6 / Ctrl+Shift+F6 leaves for the next region; ⌘C / Ctrl+Shift+C copy the selection and ⌘V / Ctrl+Shift+V paste |
| Tab close buttons | Tab | Enter |
| Split right / down (the only buttons after the tabs: closing the split and the instance panel are on their chords and the palette) | Tab (shown for a terminal) | Enter; their chords |
| Split separator | Tab | Arrows resize, Home/End to the ends, **Enter resets to even (fixed: double-click only)** |
| Empty split group | Tab; F6 (main) | Focus selects the group |
| Deployments: Retry (no Spawn button: `S` on the canvas, the sidebar, ⌘N, Quick Open and the soul cards spawn) | First stops of the stage; F6 (main) | Enter; `S` on the canvas |
| Deployments tabs (All, then one per deployment) | Tab (the selected tab) | ←/→ move and select; Home/End; the choice is remembered per workspace |
| Overview canvas | Tab | Arrows walk the tree; **Up/Down move between rows when there is no parent/child, so every Independent node is reachable (fixed)**; `[` `]` hop groups; Enter opens the terminal (Start when stopped); `T` `B` `O`; Esc clears; **the selected node is panned into view (fixed)** |
| Overview zoom − + fit | Tab after the canvas; **`-` `=` `0` on the canvas (fixed: `0`)**; `F` also fits | Enter |
| Overview node popup | Tab after the zoom buttons; `O` | Native buttons; Esc back to the canvas |
| Workspace tabs (Souls, Capabilities, Setup, Teams) | One roving stop; F6 (main) | Left/Right/Home/End |
| Souls search, Group by | Tab; `/` from the grid | Typing; Enter |
| Soul cards and their Spawn | One roving stop; the card's Spawn follows it | Arrows; Enter/Space open the soul page; `B` files; Spawn: Enter |
| Teams board cards | One Tab stop per card: its team's name | Enter/Space on the name open the team's page; a click anywhere on the card that is not another control opens it too |
| Soul page, capability page, team page | Opening focuses Back | Esc goes back and restores focus; from a team page, Esc and Back return to the board with focus on that team's name |
| Capability page: Contents navigation (one tree: Instructions, Skills) | One roving stop: the open file, else the focused item | Up/Down move through visible items, Home/End; Right opens a skill, then enters it; Left closes it, or climbs from a file to its skill; Enter/Space open a file or toggle a skill; Esc still goes back |
| Capability page: Contents reader | Tab (a labelled scrollable region) | Arrows/PgUp/PgDn scroll; Enter on a link: a listed file opens in place (and is selected on the left), `https:` opens in the browser, `#heading` scrolls; any other link is plain text |
| Capabilities: Workspace owned's repository pills ("Show capabilities from") | One roving stop: the pressed pill | Left/Right (and Up/Down) move along the pills, wrapping; Home/End go to the ends; Enter/Space choose. Moving never chooses. Focus stays on the same repository's pill when the list repaints |
| Capabilities rows; Setup list/graph; Teams forms; Sync | Tab | Native controls; the sync sheet traps and closes on Esc |
| Automations tabs, origin filter, search, on/off switch, rows | Roving tabs; Tab | Native |
| Automations row menu | Tab (its summary) | Enter/Space open; **Esc closes it back on its summary, choosing an item keeps focus on the row, Tab out closes it (fixed: stayed open, focus fell to `<body>`)** |
| New schedule form | New schedule | **A modal dialog with a Tab trap (fixed: Tab walked out behind the scrim)**; Esc closes back on the opener |
| Schedule delete confirm | Its row action | Trapped; Esc |
| Brain: a running instance's heading | **Tab (fixed: a clickable heading, now a button)** | Enter/Space open its terminal |
| Instance panel tabs | F6 (selected tab); roving | Left/Right/Home/End |
| Show instance panel (end of the main area's top bar, while the panel is closed and has something to show) | Tab, last in the Main region; closing the panel moves focus to it | Enter/Space: `panel.toggle`, then focus on the panel's selected tab |
| Panel sections: soul link, copy, details, Open soul page, Teams, Git, lifecycle Restart…/Start…/Stop…/Retire… | Tab | Native buttons and summaries |
| Spawn dialog | Spawn on a card, a soul page, Quick Open | See above |
| Command palette, Quick Open | ⌘K / Ctrl+Shift+K, ⌘P / Ctrl+Shift+P (from a terminal too) | Type, arrows, Enter, Esc; Tab stays in the input; in the palette its chord cycles rows (⇧ + it: up), skipping context rows (see "The command palette") |
| Shortcuts editor | ⌘, / Ctrl+, (from a terminal too); focus starts in its search | The **Leader** group comes first (the leader's own row, then one fixed row per key after it), then **Sidebar keys**; typing in the search filters by name, group or keys (`shift+b` and `ctrl shift b` find Ctrl+Shift+B, `alt+o k` finds the leader's `k`), and the count is announced; Down enters the rows, Up/Down move between them, Up from the first returns to the search; Tab reaches each row's shortcut and Reset; Enter records, Esc cancels a recording, Backspace unbinds; Esc clears the search, then closes; trapped, the search its first stop. A row shows "terminal" when its shortcut works while a terminal has focus and "changed" when it differs from the default |
| Settings (Connections, Terminal) | Footer settings | Trapped, through the Terminal size field too; the sign-in terminal has an explicit Shift+Tab exit; the font size stepper's − and + stay focusable at 9 and 28 (aria-disabled) and a typed size applies on Enter or on leaving the field |
| Notifications | Tab (they come last in the document) | Open and Dismiss are buttons; focus moves on after dismissing |

Known limits, left as they are: the overview has no keyboard pan without a
selection (selecting a node pans to it); node dragging is pointer-only and
cosmetic; notifications have no chord of their own.
