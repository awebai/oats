# Desktop keyboard: the keymap, regions and reach

The whole Desktop works from the keyboard, with a keymap that is sane on Linux
(Omarchy, GNOME, KDE) and Windows as well as macOS. This page is the reference
for the default chords, the rules that chose them, how focus moves between the
window's regions, and how each interactive element is reached and operated.

Code: `renderer/keybindings.mjs` (the engine, `DEFAULT_KEYMAP`,
`TERMINAL_ALLOWLIST`), `renderer/focus-regions.mjs` (F6),
`renderer/surface-return.mjs` (back to where you were), `renderer/shell.mjs`
(action registration). Tests: `test/keymap-linux.test.mjs`,
`test/keybindings.test.mjs`, `test/focus-regions.test.mjs`,
`test/spawn-dialog-keyboard.test.mjs`.

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
   terminal, but it is never terminal-allowlisted. On Linux/Windows an
   application chord that must work while a terminal has focus uses
   **Ctrl+Shift+key**, the convention of GNOME Terminal, Alacritty, Ghostty and
   kitty (and of Terminator/Tilix for splits); Omarchy's terminals follow it.
3. **macOS keeps ⌘.** ⌘ never reaches the pty, so the macOS column changes only
   where a chord is wrong for macOS users too.
4. **Every default goes through the collision review** in the keyboard lesson
   (`keyboard-focus-and-action-ownership`). That includes shifted punctuation:
   `KeyboardEvent.key` reports the shifted character (Shift+\ arrives as `|`),
   so the engine aliases it (`KEY_ALIASES`) and the test dispatches the real
   shifted event, not a parse round-trip.

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
  action keeps their choice in the terminal. On macOS only ⌘ chords fire in a
  terminal (⌘ never reaches the pty), plus one structural shape checked by
  action id *and* shape: Ctrl+Tab / Ctrl+Shift+Tab.
- Unmodified chords never fire from an editable field; a view's own keys (the
  overview canvas, the Souls grid) stay local to that view.

## The keymap as shipped

| Action (id) | macOS | Linux / Windows | Works in a terminal (Linux/Win) |
|---|---|---|---|
| Command palette (`app.palette`) | ⌘K | Ctrl+Shift+P | yes |
| Quick open a soul (`app.quickOpenSouls`) | ⌘P | Ctrl+P | no (shell history) |
| Spawn instance: choose a soul in Workspace (`app.chooseSoul`) | ⌘N | Ctrl+Shift+N | yes |
| Close tab (`tabs.close`) | ⌘W | Ctrl+Shift+W | yes |
| Next / previous tab (`tabs.next`, `tabs.prev`) | ⌃Tab / ⌃⇧Tab | Ctrl+Tab / Ctrl+Shift+Tab | yes |
| Next / previous tab, second chord (`tabs.nextPage`, `tabs.prevPage`) | none | Ctrl+PgDn / Ctrl+PgUp | no (vim, weechat) |
| Go to tab 1–8, last tab (`tabs.goto1`…`tabs.goto9`) | ⌥⌘1–⌥⌘9 | Alt+1–Alt+9 | no (readline, irssi/weechat, tmux) |
| Split right (`split.vertical`) | ⌘\ | Ctrl+Shift+E | yes |
| Split down (`split.horizontal`) | ⌘⇧\ | Ctrl+Shift+O | yes |
| Close the split (`split.close`) | ⌥⌘W | Ctrl+Shift+Alt+W | yes |
| Active overview / Workspace / Automations (`stage.hierarchy`, `stage.spawn`, `stage.automations`) | ⌘1 / ⌘2 / ⌘3 | Ctrl+1 / Ctrl+2 / Ctrl+3 | no |
| Focus next / previous region (`focus.nextRegion`, `focus.prevRegion`) | F6 / ⇧F6 | F6 / Shift+F6 | no (mc, htop, nano) |
| Leave the terminal for the next region (`focus.leaveTerminal`) | ⇧⌘F6 | Ctrl+Shift+F6 | yes |
| Sidebar (`sidebar.toggle`) | ⌘B | Ctrl+B | no (tmux prefix) |
| Filter instances (`sidebar.focusFilter`) | ⌘F | Ctrl+F | no |
| Instance panel (`panel.toggle`) | ⌥⌘B | Ctrl+Alt+B | no |
| Theme cycle (`app.themeToggle`) | none | none | – (the palette keeps it) |
| Keyboard shortcuts (`app.shortcuts`) | ⌘, | Ctrl+, | no |
| Terminal zoom (`terminal.fontBigger`, `…Smaller`, `…Reset`) | ⌘= ⌘- ⌘0 | Ctrl+= Ctrl+- Ctrl+0 | no |
| Open a file read-only (`app.openFile`) | ⌘O | Ctrl+O | no |

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

Ctrl+Shift+E (split right on Linux) is also IBus's emoji hotkey on GNOME. The
Desktop keeps it, after Terminator and Tilix; if IBus takes it first, rebind
split right in the shortcuts editor or change IBus's hotkey (IBus Preferences →
Emoji).

F1 was considered as a second palette chord and left out: in a terminal F1
belongs to programs such as htop and mc.

Actions without a default (bind them in the shortcuts editor): the workspace
switcher, Connections, focus mode, focus the active terminal, return to
terminal groups, explicit themes, and the instance menu's Open in split / Open
pull request.

Rebinding applies everywhere a chord is shown: tooltips, the footer hints, the
palette's command details and the spawn dialog's Spawn button.

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
   its first control. The tab strip and split controls belong here.
4. **Instance panel**: its selected tab; when collapsed, its rail's pressed
   button. A collapsed panel stays in the cycle on purpose: inside a terminal
   Tab belongs to the program, so the region cycle is the way out to it.

Inside a terminal F6 belongs to the program (mc, htop, nano). **⇧⌘F6 /
Ctrl+Shift+F6** (`focus.leaveTerminal`) leaves the terminal for the next region
in the same order; from there plain F6 and Shift+F6 cycle as usual.

Then back to the nav. A hidden region is skipped (the sidebar while hidden or
in focus mode, the panel when it has nothing to show), and so is a region with
nothing focusable at that moment: focus never lands on `<body>`. While a modal
dialog or the palette is open, F6 and the tab switches (Ctrl+Tab, Ctrl+PgDn/PgUp,
go to tab) do nothing; the dialog keeps focus.

Tab switches from the keyboard (Ctrl+Tab, Ctrl+PgDn, go to tab) keep focus in
the new tab's content when it was in content, and on the strip when it was on
the strip. A stage switch from a chord, the palette or a nav button leaves
focus where it was when that is still shown, else on the stage's first
control.

## Quick Open and the spawn dialog

- **⌘P / Ctrl+P** finds a soul; picking it opens the spawn dialog scoped to that
  soul, exactly as its card's Spawn does (the Workspace stage behind it). A soul
  that can't be spawned here (attached only, refused, no verified CLI) opens
  its soul page instead, which says why. Focus lands in Name.
- Dismissing the dialog (Cancel, Esc, ×, the backdrop) returns to where the
  operator was before Quick Open: the same tab re-activated (its terminal
  focused when that is where they were), or the same stage and control, else
  that region's current item. If they moved on while the dialog was open (a
  workspace switch, another stage or tab), the return is not forced and the
  dialog restores focus itself. A successful spawn closes the dialog at once and,
  when the instance runs, opens its terminal unless the operator moved on, is
  typing or has an overlay open (`docs/desktop-spawn-preview.md`, Background spawn).
- **Focus on open:** Name, whenever the dialog opens for a chosen soul (a card,
  the soul page, Quick Open, Reopen spawn), with the caret at the end of a
  restored name (never selected), without scrolling.
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
| Add / onboard workspace dialog | From the menu's Add | Radio-style suggestions with arrows; Esc; trapped; returns to the trigger |
| Sidebar nav (Active overview, Workspace, Automations) | F6 (current item); Tab; ⌘1/⌘2/⌘3 | Enter/Space |
| Roster filter | Tab; ⌘F / Ctrl+F; **Down from it enters the rows (fixed): while filtering, at the first match, never a parent kept only to show its tree path** | Typing filters |
| Roster rows | One roving stop, **the selected row, else the first filter match (fixed: was the first enabled)**; F6; Up/Down/Home/End; Right expands, Left collapses or goes to the parent | Enter/Space open the terminal (running) or Start (stopped) |
| Rows whose state is unknown or that the kernel does not report addressable | **Focusable, `aria-disabled` with the reason as a description (fixed: were `disabled`, which hid their tools from the keyboard)** | Activation does nothing; their tools work |
| Row tools: PR link, Start…, actions menu | Tab from the focused row (shown on focus) | Enter/Space; the menu: arrows, Home/End, Esc back on its trigger, Tab closes |
| Start / Restart dialog, lifecycle dialog | From the row or its menu | Esc; trapped; **focus returns to the row when its tool is hidden again (fixed: fell to `<body>`)** |
| Sidebar footer: Spawn instance, sidebar, theme, shortcuts, settings, palette | Tab | Enter/Space run the same registered actions as the chords |
| Sidebar restore edge | Tab, while the sidebar is hidden (hiding moves focus to it) | Enter |
| Tab bar | One roving stop per tablist (per group when split); F6 (main) | Left/Right/Home/End select; Delete closes the focused tab, and the keymap's `tabs.close` (⌘W / Ctrl+Shift+W, rebindable; the close button's tooltip names it) closes the active one; Ctrl+Tab from anywhere in the tab layer, and Ctrl+PgDn/PgUp and go-to-tab outside a terminal (⌥⌘digit also inside one on macOS), **keeping focus in the content (fixed: fell to `<body>`)** |
| Terminal | Enter on its roster row; F6 (main) | Every key reaches the program except the terminal-allowlisted chords; ⇧⌘F6 / Ctrl+Shift+F6 leaves for the next region |
| Tab close buttons | Tab | Enter |
| Split right / down / close, panel toggle | Tab (shown for a terminal) | Enter; their chords |
| Split separator | Tab | Arrows resize, Home/End to the ends, **Enter resets to even (fixed: double-click only)** |
| Empty split group | Tab; F6 (main) | Focus selects the group |
| Active overview: Retry (no Spawn button: `S` on the canvas, the sidebar, ⌘N, Quick Open and the soul cards spawn) | First stops of the stage; F6 (main) | Enter; `S` on the canvas |
| Overview canvas | Tab | Arrows walk the tree; **Up/Down move between rows when there is no parent/child, so every Independent node is reachable (fixed)**; `[` `]` hop groups; Enter opens the terminal (Start when stopped); `T` `B` `O`; Esc clears; **the selected node is panned into view (fixed)** |
| Overview zoom − + fit | Tab after the canvas; **`-` `=` `0` on the canvas (fixed: `0`)**; `F` also fits | Enter |
| Overview node popup | Tab after the zoom buttons; `O` | Native buttons; Esc back to the canvas |
| Workspace tabs (Souls, Capabilities, Setup, Teams) | One roving stop; F6 (main) | Left/Right/Home/End |
| Souls search, Group by | Tab; `/` from the grid | Typing; Enter |
| Soul cards and their Spawn | One roving stop; the card's Spawn follows it | Arrows; Enter/Space open the soul page; `B` files; Spawn: Enter |
| Soul page, capability page | Opening focuses Back | Esc goes back and restores focus |
| Capability page: Contents navigation (one tree: Instructions, Skills) | One roving stop: the open file, else the focused item | Up/Down move through visible items, Home/End; Right opens a skill, then enters it; Left closes it, or climbs from a file to its skill; Enter/Space open a file or toggle a skill; Esc still goes back |
| Capability page: Contents reader | Tab (a labelled scrollable region) | Arrows/PgUp/PgDn scroll; Enter on a link: a listed file opens in place (and is selected on the left), `https:` opens in the browser, `#heading` scrolls; any other link is plain text |
| Capabilities filters, rows; Setup list/graph; Teams forms; Sync | Tab | Native controls; the sync sheet traps and closes on Esc |
| Automations tabs, origin filter, search, on/off switch, rows | Roving tabs; Tab | Native |
| Automations row menu | Tab (its summary) | Enter/Space open; **Esc closes it back on its summary, choosing an item keeps focus on the row, Tab out closes it (fixed: stayed open, focus fell to `<body>`)** |
| New schedule form | New schedule | **A modal dialog with a Tab trap (fixed: Tab walked out behind the scrim)**; Esc closes back on the opener |
| Schedule delete confirm | Its row action | Trapped; Esc |
| Brain: a running instance's heading | **Tab (fixed: a clickable heading, now a button)** | Enter/Space open its terminal |
| Instance panel tabs | F6 (selected tab); roving | Left/Right/Home/End |
| Collapsed panel rail | F6 (pressed button); Tab | Up/Down/Home/End; a rail button expands to its page |
| Panel sections: soul link, copy, details, Open soul page, Teams, Git, lifecycle Restart…/Start…/Stop…/Retire… | Tab | Native buttons and summaries |
| Spawn dialog | Spawn on a card, a soul page, Quick Open | See above |
| Command palette, Quick Open | ⌘K / Ctrl+Shift+P, ⌘P / Ctrl+P | Type, arrows, Enter, Esc; Tab stays in the input |
| Shortcuts editor | ⌘, / Ctrl+, | Trapped; Enter records, Esc cancels, Backspace unbinds |
| Connections | Footer settings | Trapped; its terminal has an explicit Shift+Tab exit |
| Notifications | Tab (they come last in the document) | Open and Dismiss are buttons; focus moves on after dismissing |

Known limits, left as they are: the overview has no keyboard pan without a
selection (selecting a node pans to it); node dragging is pointer-only and
cosmetic; notifications have no chord of their own.
