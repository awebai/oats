# oats desktop — renderer views (webpanel-dev)

Ports of the retired browser panel's functionality as desktop renderer views,
per the desktop-app contract: each view is a plain ES module exporting
`mount(el, ctx)` / `unmount()`, where `ctx = { api(pathname, opts),
openFile(path), openTerminal(instance) }` is provided by the shell.
No frameworks, no dependencies; data comes from the bundled backend HTTP API.

## Views (`views/`)

- **spawn.mjs** — **Workspace**, with Souls / Capabilities / Sources subtabs.
  Souls come from `GET /api/agents` (the kernel's `oats souls` catalog),
  grouped by **Repo** (the default: the member repository, the host first,
  then packages with their pinned version, then external souls) or **Team**
  (the default team). A card names its harness · model (only as the kernel
  reports them), clamps the description to two lines, labels its chips
  (*Team oats · default* for its default team, other teams plain; grouped by
  team, *Repo …* instead of the group's team; no work-mode chip, that is the
  soul page's and the spawn preview's) and says what runs in its foot (*N
  instances running*, *N stopped*, *No instances*); a soul a spawn here would
  refuse says why in `--warn`, with that count as a muted second line.
  Selection opens the soul's page — read-only: a v2 soul is edited in its
  repository and the inspector never writes it in place; there are no layer bindings
  (`oats use` was removed by workspace model v2). Its Spawn action opens the Spawn dialog
  (see below), which previews through the kernel and applies through the
  confirmed `/api/spawn?ws=` transaction. An empty opening instruction waits
  for instructions; attached-mode souls cannot launch standalone. The shell's
  **Spawn instance** footer navigates to soul selection; it does not launch.
  Capability facts and source provenance use negotiated read-only inspection,
  never inferred membership, installation or remote discovery. Shared CLI recovery
  stays visible across subtabs; incompatible installations are observation-only.
- **cli-status.mjs** — shared CLI degradation state + the ONE card
  (detected path/version, required range, **Choose oats…**, **Retry**, docs
  link, copyable install command). Views subscribe via `onCliChange`;
  re-probe triggers: launch, app focus, Retry, choose (contract).
- **common.mjs** — shared helpers: escaping, mini-markdown, ctx.api JSON
  wrappers, roster grouping, and workspace switching (`?ws=`) — the selected
  workspace is shared across this window's views via `onWorkspaceChange`, so a
  shell-level switcher can drive it too. One window per workspace: the
  window's workspace is its URL's hash (`#ws=<id>`, window-binding.mjs),
  rewritten with `history.replaceState`; localStorage only holds the default
  a new window takes when main says no other window has it (`startWindow`).
  Every switch goes through `switchWorkspace`, which main binds first
  (`window:claim-workspace`): a workspace another window has brings that
  window to the front and leaves this one unchanged. Claims run one at a
  time and a switch commits only after main's yes (`setWorkspace`). Main may
  move a window ahead of it: a window bound to a deployment whose view is
  observed later is registered under the view at once (main's
  `noteServed`), and the window's next roster read follows it there. A
  window with no workspace is `choosing`
  (`windowState`): the shell shows the switcher with main's choices and
  reads nothing.
  A persisted selection the server no longer serves is **stale**
  (`staleWorkspaceSelection`: non-empty and absent from the reply's
  `workspaces` plus `workspace`); both roster paths (hierarchy refresh and
  the shell's context roster) treat it like an empty selection and silently
  `adoptWorkspace` the served id, without a generation bump. Without a
  served list nothing is guessed. A selection that IS served and gets a reply
  for another workspace stays a refused mismatch. A deployment id saved before
  workspace views (a path, `remote:<server>:<target>`) is stale once a view
  holds it: the server answers it with that view, whose id is adopted.

`theme.css` carries semantic WCAG AA tokens for **White** (default),
**Solarized**, and **Dark**. A fourth choice, **This computer** (`host`), has no
palette of its own: it shows the theme of the computer that runs Desktop. Theme
actions are available in the command palette; cycling follows that order (White,
Solarized, Dark, This computer). Existing valid `oatsweb.theme` preferences
survive; missing/invalid preferences mean White regardless of OS, and This
computer is never chosen for the operator. Views use tokens only, scoped under
`.oats-view`. Orange selection is distinct from error/success.

**This computer.** On a computer with an Omarchy theme, the chrome and every
terminal (local and remote instances alike: they share the two creation sites)
take the current Omarchy theme and follow a theme change without a restart.
Anywhere else the choice follows the system's appearance: Dark when the system
is dark, White when it is light, each exactly as it is, with nothing imported.

- **The source** is Omarchy's own `colors.toml`
  (`~/.local/state/omarchy/current/theme/colors.toml`; Omarchy hard-codes that
  directory, so `XDG_STATE_HOME` is not consulted). It is the file every terminal
  config is generated from, every theme has one, and it alone carries the
  polarity and the accent; a generated terminal config is per-terminal output a
  theme can replace. The main process (`../host-theme.mjs`) reads it with a small
  line parser (no TOML dependency, at most 64 KiB, a regular file) and resolves
  the colours Desktop uses the way Omarchy's own resolver does. It never runs a
  host program to read colours.
- **Following a change.** `omarchy-theme-set` replaces `current/theme/` with a
  new directory, so main watches the parent `current/`, never `theme/` or the
  file (that watch would end at the first change). An event is debounced, then
  read; a missing file is read once more before it is reported, so the moment
  between the removal and the move never shows as a problem. App focus and a
  system appearance change re-read too, which corrects a missed or failed watch.
  A computer with no `current/` at start is not watched: Omarchy installed
  later is picked up at the next start.
- **What crosses to the renderer** is plain state, on `host-theme:get` (asked
  once per window) and `host-theme:changed` (pushed to every window): a palette
  (`source: "omarchy"`, the mode and the colours), or the system appearance
  (`source: "system"`), with a `problem` when an Omarchy theme exists but its
  colours are missing, unreadable or invalid. No path, name or file content.
  `host-theme.mjs` validates it again before use.
- **Base plus overrides.** The choice (`currentTheme()`, what is saved and
  cycled) is separate from what is applied (`appliedTheme()`): `data-theme`
  stays a built-in id, Dark or White by the host's polarity, so every rule in
  `theme.css` applies as it does for that theme, and the palette is a set of
  custom properties set inline on the root. Leaving the choice removes all of
  them. `theme.mjs` applies what the host source answers and imports nothing
  (tests evaluate its source on its own); the shell hands the source to
  `initTheme()`.
- **The derivation** (`deriveHostTokens` in `host-theme.mjs`) maps the host's
  colours to tokens: the surfaces are the host's (background, the darker canvas,
  and mixes of background towards foreground, accent and yellow for raised,
  border, selected and attention surfaces), and each text colour starts from the
  host's (foreground and its mixes for the text ramp, accent, and green, yellow,
  red and magenta for the status colours).
- **First paint.** The last state shown is kept in `localStorage`
  (`oats.desktop.hostTheme`) and applied synchronously by `initTheme()`, then
  reconciled with main's answer, so a dark host does not flash White at launch.
  A push that arrives before that answer wins over it.
- **Several windows.** Every window gets each push and applies it only while
  This computer is its own choice. A window reads the saved choice when it
  loads (there is no storage listener), so two windows can show different
  themes until one reloads.
- **When it falls back.** A problem state, or a palette the derivation refuses,
  applies no override at all and shows Dark or White (by the system's
  appearance, or by the palette's own polarity when it resolved but could not be
  derived). One sticky notification says so, once per episode: an episode is a
  reason plus the base shown. It is replaced when either changes and dismissed
  by a usable state or by choosing another theme.

What keeps an imported palette inside the quality bar:

1. Only the surfaces, the text ramp, the accent and the status colours come
   from the host. Everything else (soul and runtime identity pairs, shadows, the
   scrim, the markdown code surface, fonts, sizes, the terminal's text weight)
   is the calibrated built-in theme of the same polarity.
2. Every imported text colour is moved towards white or black until it is 4.5:1
   on each surface it is drawn on (3:1 for the graph connectors). The whole map
   is derived before any of it is set, and a palette that cannot be made to
   pass is not applied.
3. The pairs come from one list, `contrast-inventory.mjs`: the derivation reads
   it to know each colour's surfaces, and `test/theme-contrast.test.mjs` holds
   the built-in palettes and real Omarchy palettes
   (`test/fixtures/host-theme/`) to the same list with the same arithmetic. A
   rule that paints a new foreground on a surface adds its pair there.
4. The 16 terminal colours are the host's own, unadjusted, in Omarchy's mapping
   (slot 0 is the background, as in the host's terminal). This is the one place
   the host theme does not hold the inventory (`HOST_UNADJUSTED_PAIRS`): they
   are drawn only by xterm, whose minimum contrast ratio (below) keeps them
   readable when drawn.

Outside Desktop's control: the taste of the host's palette; that an adjusted
accent or status colour is lighter or darker than the host's; that a program
painting both text and background is readable but not re-themed.

The default monospace face is **Inconsolata**, bundled (`fonts/`, SIL OFL 1.1;
source, version and checksum in `fonts/README.md`) so it is the same on every
machine. `theme.css` declares it with `@font-face` (`font-display: block`) and puts
it first in `--term-font-family` (the terminal) and `--mono` (the UI's code, paths
and chord hints), ahead of the OS monospace stack. The terminal's default size is
15px (`--term-font-size`, `TERMINAL_FONT_SIZE`; the operator's decision). A terminal
font or size the operator stored (`oats.desktop.terminal.fontFamily`, `…fontSize`)
still wins. Reset typography (⌘0 / Ctrl+0, the palette) forgets both, and Settings →
Terminal's "Reset to default" forgets the size, so the defaults apply again. Every
size control clamps to 9–28 (`clampTerminalFontSize`).

The terminal's text weight belongs to the theme, not to typography: each palette sets
`--term-font-weight` (White 475, Solarized 450, Dark 400; This computer has its base's,
so 400 for a dark host theme and 475 for a light one), which `terminalFontWeight()`
(`theme.mjs`) reads into xterm's `fontWeight` when a terminal is created and again on
every theme change, at both creation sites in `shell.mjs` (the terminal tab and the
Settings preview). Chromium renders dark-on-light text lighter than light-on-dark, while
a native macOS terminal with font smoothing (Ghostty with `font-thicken`, measured at
Inconsolata 15) inks the same in every scheme, so one fixed weight cannot match all
three palettes. A missing or unusable token means 400 (xterm's `normal`). Bold stays
xterm's 700 (`fontWeightBold` is not set), and weight never changes the cell, so
`terminalTypography()` stays `{ fontFamily, fontSize }` and no weight is stored.

Every terminal keeps a minimum contrast ratio (#602): `terminalOptions()`
(`terminal-tab.mjs`) gives xterm `minimumContrastRatio: TERMINAL_MINIMUM_CONTRAST` (4.5),
so both creation sites in `shell.mjs` get it. It is one number for every theme: not a
parameter, a setting or a token. Text that is under 4.5:1 against its cell's background
is drawn lighter or darker until it reaches it; xterm never changes the background. 4.5
is WCAG AA for text, Desktop's bar in every theme, and the highest WCAG level that
leaves the hand-calibrated palettes unadjusted on their own background: the default
foreground and the 16 ANSI colours already meet it on `--term-bg` in White, Solarized
and Dark (`test/theme-contrast.test.mjs` holds them to the constant), so xterm acts only
on combinations nobody calibrated: ANSI on ANSI backgrounds, 256-colour and truecolour
text. 7 (AAA) would redraw most of the palette, and 3 would leave mid-grey on white
below AA. Dim text asks for half the ratio (2.25), which the palette colours meet, so
dim keeps xterm's own half-opacity rendering. xterm excludes box drawing and block
elements (U+2500–259F) and powerline glyphs from the floor, so borders and bars keep
the colour a program chose. Setting `options.theme` clears xterm's contrast cache, so
after a theme change the floor is applied against the new palette with no listener of
its own. `node packages/desktop/test/fixtures/terminal-colors.mjs` prints a labelled
screen of colour cases to look at in a terminal tab, in each theme.

**Copying (#520).** A terminal tab is a tmux client with tmux's mouse on, so a plain
drag is tmux's: the viewer's locked key table (`tmux-target.mjs`
`LOCKED_TABLE_BINDINGS`; the kernel's remote viewer, `lib/session-viewer.mjs`, binds
the same) starts copy mode on `MouseDrag1Pane` unless the pane is in a mode or its
program grabbed the mouse. On release copy mode copies, and tmux (with its default
`set-clipboard external`) sends the text as OSC 52, which `terminal-clipboard.mjs`
writes to the clipboard: write-only, a query is never answered, at most 1 MiB, valid
UTF-8 only. Option-drag (`macOptionClickForcesSelection`) is still xterm's own
selection, copied by ⌘C and the right-click menu.

A terminal tab shows its program the way a native terminal would. It renders with
xterm's WebGL renderer (`@xterm/addon-webgl`, `createGlyphRenderer` in
`terminal-tab.mjs`), whose built-in glyphs draw box drawing and block elements
(Claude Code's input box, tmux borders) as thin joined strokes whatever the font;
the DOM renderer would take them from Inconsolata, at twice the weight. Every
failure falls back to the DOM renderer. Where WebGL2 is unavailable (a throwaway
probe, asked again on every show until it says yes) the addon is not activated:
addon-webgl 0.18 adds a canvas and listeners before it asks for the context, and
its dispose cannot undo a constructor that threw. An activation that throws
although WebGL2 was there is not retried for that terminal, which stays on the DOM
renderer until it is reopened. A lost context (Chromium keeps about 16) disposes the addon, and showing
the tab tries WebGL again. `fitTerminal` sizes the grid to the pane's padded box
with no width kept for xterm's scrollbar (tmux draws in the alternate screen, so it
never scrolls, and `shell.css` hides it) and centres the remainder across and down,
in whole device pixels, like a native terminal's balanced padding. It counts cells
from the renderer's device cell, never its CSS cell: xterm reports the CSS cell as
the rounded screen extent divided by the current count, so fitting from it can
flip between two counts at a fractional width.

xterm measures its cell
when a terminal is created and only re-measures on a font change, so
`terminalTypography()` (`theme.mjs`) hands out the stack without Inconsolata
until the face has loaded, then notifies the typography listeners with the full
family, and live terminals re-measure and refit.

### Control rules (selection, focus, search fields)

Three rules hold everywhere in the renderer (design v4.1 board 7; spec A implemented the
global part, views follow them in their own CSS). `test/control-rules.test.mjs` pins them.

1. **Selected = brand tint.** A selected segment/pill/toggle is `background: var(--sel);
   color: var(--accent); font-weight: 650`; unselected is transparent with `var(--muted)`.
   A segmented group is one 1px `var(--border)` frame with 2px inner padding and 6px-radius
   segments, no dividers. The shared `.ws-segmented` block in `workspace-discovery.mjs`
   (Setup List/Graph, Souls Group by) is the reference. Never "white vs grey".
2. **No ring on pointer interaction.** Visuals hang off `:focus-visible`, never `:focus`,
   so a clicked button, tab, segment, row or link stays quiet. `theme.css` styles keyboard
   focus globally: `:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px }`
   (the edge overlays a bordered control's border and is the inner pixel of a borderless
   one) plus `background: var(--sel)` on `button`, `a` and `summary`. The tint rule has
   (0,1,1) specificity on purpose: a control that paints its own opaque pair (primaries,
   danger, the toast) keeps it and shows the edge only, drawn 1px *outside* (`outline-offset:
   1px`) because inset it would sit on the control's own fill (accent on `--primary-bg` is
   1.52-3.38:1, on `--danger` about 1.1:1). `theme.css` lists those controls in one
   `:where(…):focus-visible` rule; a new opaque-fill control joins it. A control whose base rule has an
   id or two classes and should tint declares its own `:focus-visible { background:
   var(--sel) }` (`#ws-trigger`, `#tab-actions button`, `.ws-dialog-foot .secondary`).
   Do not add per-component `outline: 2px` rings. Large focusable panels (tabpanels,
   canvases, `pre` blocks) get the edge only. Padding-free text tabs and links
   (`.workspace-tabs`, `.auto-tabs`, Setup links) give the tint a layout-neutral inset
   on focus (`padding: 0 6px; margin: 0 -6px`) so it does not hug the label.
3. **Search/filter fields have one border.** A wrapped field (`.ctx-filter-field`) turns
   its wrapper border accent on `:focus-within`; the `<input>` inside has `border: 0;
   outline: none` in every state. A bare field (`.field`, `#ws-menu-search`, the palette
   input's bottom rule) turns its own border accent on `:focus-visible` and never outlines.

Contrast is checked on effective colours in all three themes: `--accent` on `--sel`
(selected text, focus tint) is AA text, and the accent edge/border is ≥3:1 on `--surface`,
`--bg` and `--sel`. Dark `--danger` on `--sel` is 4.27:1, which is why danger buttons
never tint.

Soul marks use a stable hash of the reported root/name/server identity and a
muted six-color palette. Optional top-level `color: sage` in an existing canonical
`soul.yaml` overrides the local Desktop mark. Accepted names: `sand`, `sage`,
`slate`, `mauve`, `clay`, `olive` (case-insensitive); invalid/absent values fall
back to the hash. This is display-only metadata, not a kernel identity or launch
setting, and there is no color editor or `soul.yml` alias. Current remote CLI
rosters do not report this field, so remote marks use the fallback. Change
package-owned declarations in reviewed package source, not locked installed
payloads. Colors can collide and never determine selection, status or identity.
Runtime marks show the reported runtime, not installation/authentication status.

## Workspace views (#482)

A window shows a workspace **view**: one matched workspace identity across machines
(`ws:…`), or one unattached deployment under its own id. `/api/panel` names the view's
`deployments` and tags every row with its `deployment`; `view-deployments.mjs` reads them
(validated, text only) and keeps the last deployments seen per view for surfaces that do
not read the panel.

- **Nothing above the navigation.** The sidebar lists no deployments; the Deployments
  page and the roster headings say where things run (UI spec, after the operator rejected a
  deployments block under the switcher).
- **Switcher** (`workspace-switcher.mjs`): views first, then unattached views in a
  "Not matched to a workspace" group (listbox → group → option). Each entry is its name and
  ONE muted line: a view's machines (`choice.machines`, "This Mac · altair") with a status
  mark (`deploymentMark`, words as its label) when `notLive > 0`; an unattached view's
  machine and its `short` reason. Choosing an unattached entry also calls
  `requestDeploymentTab`, so the Deployments page opens on its tab. Never an id, a path or a
  reason sentence (paths only in tooltips); twins of one name show their key. Filtering
  (shown text only) and Arrow/Home/End run over every shown option.
- **Grouping by deployment** only when a view has two or more deployments: the sidebar
  roster (`rosterSections`, a heading per deployment named by `machineLabels` in the
  cluster-label type, a status mark when not live, none for a deployment without rows) and
  the Deployments page (below). With one deployment both render exactly as before.
- **The Deployments page** (the former Active overview, stage `hierarchy`): tabs from
  `deployment-tabs.mjs` (All, then one per deployment; one deployment has only its own tab;
  the choice remembered per view); All stacks one section per deployment, a deployment's tab
  shows its tree alone. A non-live deployment's heading has a state chip, its `short` reason
  and **How to fix** (the `fix` steps, else the sentence, and any note); a live deployment's
  note shows under **Details** with no chip (`deploymentHasWords`).
- **"On <deployment>"** (`deployment-scope-line.mjs`): deployment-level surfaces read the
  view's primary deployment and say which in a line under their heading, only with two or
  more deployments (Workspace header, Automations/Schedules, the soul inspector for a soul,
  a capability page, Brain, the Sync sheet). Teams configuration, launch configurations and
  spawn are not wired here.
- **Re-homing** (`workspace-rehome.mjs`, shell `rehomeWorkspaceState`, on every roster
  read): state under a deployment id (a selection, tab layout and active-terminal memory,
  open tabs with their `term:`/view keys, collapsed rows, stored spawn jobs) moves to the view
  that holds that deployment; a terminal follows its row's deployment when that moves to
  another view; a selected view id that is no longer served follows its deployments when one
  view holds them all. A group that never reports keeps its own id, so nothing moves.
  Spawn jobs keep `deployment` (where the transaction is addressed) apart from `workspace`
  (the owner that moves).

## Deployments page (formerly the Active overview) — slice 7a, reported roster only

The existing `hierarchy` stage consumes **GET `/api/panel` only**. Relation groups
are connected components of the shared parent/sibling resolver across roots and
repositories, never repository buckets. Groups remain anonymous/count-labeled;
reported context is metadata, not a derived group name. Header counts distinguish
multi-member groups from independent instances and keep unknown runtime state
separate from stopped. Parent/child edges are OAS-style cubic S-curves from the
parent's bottom-centre to the child's top-centre; sibling edges are shallow arcs
dashed `5 4`, so the two kinds do not rely on color alone. `--graph-edge` holds
3:1 against every surface it is drawn on (WCAG 1.4.11, pinned in
`theme-contrast`); the lit lineage is `--accent`. The 220px cards show reported context/runtime/branch—not guessed
PRs, worktree health or task activity. Same-named nodes carry visible root/home
suffixes and host qualifiers; their popup exposes the full reported address.
Those are per-instance identity cues, never invented group names.

Activity and waiting-on-you are explicitly **unknown / available after K7**.
`TASK`, `STATE`, transcript prose, unnegotiated activity/group labels and the old
aggregate `instance.git` are not consumed by this projection. Git stays disabled
with a K1/P1 note; no Tasks destination or new Stop/Remove surface is introduced.

`active-observation.mjs` validates the roster/address shape and rejects duplicate
identities rather than silently losing nodes. Local request tickets and global
workspace generations guard both outcomes. Workspace switches synchronously
revoke old graph/actions/gestures; a foreign workspace reply is not silently
adopted over an explicit selection that the server still serves (a stale
selection, no longer among the served choices, is adopted like an empty one).
Failures retain an explicitly stale last
observation with actions disabled, not a false healthy empty graph. A manual
retry can supersede a read; periodic polling skips its own pending request so
slow responses are not starved.

No-op polls ignore timestamps/unconsumed metadata and preserve actual popup
controls, focus, camera, offsets and selection. Changed observations wait for
an active gesture to finish; a newer failure revokes a queued success. Window
blur/hidden ownership cancels gestures, and drag-click suppression expires after
its own native click window rather than swallowing a future intentional click. Popup
controls survive meaningful updates for the same identity and resolve the current
record, not a captured stale object. Hidden/disposed/replaced controls cannot
act or reclaim focus. Action text remains screen-sized outside the scaled stage,
bounded to the viewport during zoom/pan/resize. Terminal/Start/Restart use the
current full home/root/server and require known runtime state and an available
route; terminal key handling itself is unchanged.

**Brain is fail-closed here.** The existing Brain reader takes only a soul name,
and `/api/panel` enumerates instances, not every configured soul. Even one local
instance cannot prove there is no uninstantiated same-named soul elsewhere. The
button/keyboard explanation directs users to Workspace's exact soul selection;
the overview never guesses or adds a filesystem/IPC seam. This is a bounded7a
surface, not final K7 or native/rendered acceptance.

## Spawn dialog — workspace model v2

`spawn-dialog.mjs` owns the form; `views/spawn.mjs` is a thin host (modal,
focus trap, Esc/backdrop close, the `spawn.submit` binding and the handoff). In
the shell a confirmed local press is handed to `spawn-jobs.mjs` (`ctx.spawnJobs`)
and the dialog closes at once; the store runs the transaction, owns the roster's
pending row (`shell.mjs` `pendingSpawnRow`), the outcome notifications and the
**New** marks, and keeps the draft for **Reopen spawn** (`preselectSpawn({…, draft})`).
After the press the shell reveals the pending row without focus (`ctx.followSpawn`)
and, when the instance runs, `spawn-follow.mjs` takes the operator to its terminal
unless they acted since the press (input, a focus move, a navigation) or an overlay is
open; focus merely resting where the dialog returned it does not count. Otherwise its row says New. See
`docs/desktop-spawn-preview.md`, "Background spawn". Souls come from the kernel's spawn catalog (`oats souls --json` via
`GET /api/agents`), never from the roster. Two layouts, switched in place
(design board 6): **scoped** — opened from a soul card's Spawn or the soul
page's Spawn — heads the dialog *Spawn <soul>* with where the soul comes from
and shows the preview column (*What will be created*: name, works in, harness
and where it came from, default team; *Core capabilities* and *Capabilities*
from the preview's projected `modules`, each with its source and, when the
preview reports it, its reason; a skeleton while it reads, the footer's
refusal sentence when it fails). **Change soul** switches the same dialog to
the **picker** (the soul chooser, grouped by source, alphabetical, externals
last, keyed by `agentsRoot + name + server`); switching soul keeps the typed
name and instruction, and a soul chosen there reopens in the picker. Quick
Open (⌘P / Ctrl+P) opens the scoped layout too (`preselectSpawn`), and
dismissing that dialog returns to where the operator was.

Keyboard (spec F; `../docs/desktop-keyboard.md`): Mod+Enter (`spawn.submit`)
spawns from any field, plain Enter in Name never does; DOM order is Tab order
(Name, then its Prefix switch, drawn on the label's line by CSS grid);
Relationship and Teams are one tab stop each (`roveSegment`: arrows, Home/End);
the soul chooser is a `listbox` of `option` buttons where typing filters,
Enter in the search picks the best match and Enter, Space or a click on a soul
picks it, every pick moving focus to Name. The dialog opens on Name
(`focusName`: caret at the end, no scroll). Mod+1–Mod+7 jump to Name, Harness,
Model, Relationship, Teams, the instruction and Developer settings
(`spawn-dialog-keys.mjs` registers them with `spawn.submit` in the
`spawn-dialog-local` context, once, for the editor; the host resolves and stops
them; `jump()` and `setShortcuts()` are the dialog's).

Main form, in order: **Name** (the `<soul>-` prefix plus a purpose, with the
kernel's final name shown below; when the CLI advertises `spawn-name`, a
**Prefix with the soul name** switch sends `--name` instead of `--purpose`),
**Runtime** and **Model** (always visible, showing the kernel's real defaults
with a *default* pill), **Relationship** (Independent / Child of / Sibling of /
Parent of, a segmented control; choosing one reveals the instance picker) and the **Opening
instruction**. **Developer settings** is collapsed: work area (base | branch,
the worktree path relative to the deployment, *Use a worktree instead* for
checkout souls), permissions, **messaging identity** (Default / Local /
Global + resident, sent as `--provider <cap> identity.mode=…` to the messaging
provider the preview reports; shown only with `spawn-provider-payload` and a
messaging provider, and its hint says what the decision binds), launch
configuration, session backend, Run on and the wake schedule. The footer (Cancel, Spawn ⌘↵) is sticky.

Every value shown is the kernel's own preview: the dialog reads
`POST /api/workspace-spawn-preview` in the background (debounced; a newer
choice starts its own read at once and only the latest ticket settles,
owner-checked on success and rejection) and never resolves a default itself.
Editing never waits on it: no field is disabled or rebuilt by a read, and after
the first settle the preview column keeps the last settled facts marked
**Updating…** (`aria-busy`) while the Name fact follows the form. **Spawn** is
one click, pressable whenever the form is valid (a press before the preview for
those choices settled waits as **Checking…**, and an edit drops it): prepare →
the server checks the prepared decision still matches what was shown → apply
with the bound revision and key.
If the kernel decided differently at Spawn time nothing is applied and the
dialog shows the new values for review. An unknown outcome offers **Check
result** on the same intent. A completed receipt hands off to the terminal
only after an exact composite roster match; partial wake results stay
created with **View schedules**. Execution-server spawns (Run on, or a remote
soul) use the host's own defaults and naming. The `spawn.submit` chord hint
lives on `data-chord`, not `data-shortcut`, so the shell's shortcut titling
never hides the Spawn button.

**Deployment** (#482, decision Q2; `spawn-deployment-field.mjs`, wired in one
delimited block of `spawn-dialog.mjs`). A workspace view can hold several
deployments (`/api/panel` `deployments`). With two or more, the form shows a
**Deployment** field first, before Name, in place of *Where to run*: the form's
segmented control with two or three deployments, the Harness-style dropdown with
more (never a native select). Options are named by `machineLabels` ("This Mac",
"altair", "This Mac · oats-v2") with a state tag when not live; the preview
column's **Runs on** row gives the chosen one's `deploymentLabel`. With one
there is no field and the form is unchanged. Rules:

- **Addressing.** Every spawn request addresses a deployment, never the view:
  `?ws=<chosen id>` (else the only one, else `workspace.primary`) on the preview,
  prepare/apply and the launch-configuration list. The preview and apply echo
  that deployment.
- **Availability** is each deployment's own catalog (`/api/agents?ws=<id>`, read
  when the dialog starts, latest intent). The selector is the chosen deployment's
  catalog row (`catalogSoul`: the root differs per deployment). A deployment
  without the soul stays selectable (a deployment that isn't live is marked by
  its state). Choosing it blocks Spawn, said once, in the footer only: "<machine>
  isn't reachable right now." when a remote isn't live, "This Mac's deployment
  hasn't been read yet. Try again in a moment." for a local one not read yet, else
  "<soul> isn't available on <machine>."; nothing is read.
- **Default.** The last used in this view if it has the soul; else the first
  that has it, local before remote; else the last used (blocked). With nothing
  used yet: the first local one. Until every catalog answers, an untouched field
  holds a provisional choice and no preview is read.
- **Last used** is `localStorage['oats.desktop.spawnDeployment']`, a
  `{viewId: deploymentId}` map of at most 32 views. It is written on a created
  spawn only: the dialog's own completion, a remote reply, or `spawn-jobs`
  `created()`.
- **Changing deployment** clears the settled preview and re-reads (Spec B's
  prepare/apply/cache are unchanged). The choice key includes the deployment, so
  a reply for the previous one never settles. Relation anchors are the chosen
  deployment's rows only.
- **A remote deployment** spawns through the execution-server path: `serverId`
  is its server and `agentsRoot` comes from its catalog row. The reply's
  `workspaceId` is a view, and `doSpawn` switches only when that view is not
  the one on screen.
- **Background jobs** (`spawn-jobs.mjs`) are owned by `workspace` (the view: pending
  row, notices, in-flight) and addressed by `deployment` (every `post` and reply
  check). The deployment is kept in `sessionStorage` across a reload, and a
  created row becomes real only when its own deployment's row reports it.

*Where to run* (one-deployment views) lists the registered servers, or, with
`servers-per-workspace` and `server-connect`, only the window's machines
(`/api/servers?ws=`) followed by *Add a machine to this workspace…*
(`add-machine-dialog.mjs`; a button under the Deployment field in views of two
or more deployments). See `../docs/desktop-machines.md`. Its disabled states
come from every view holding a remote deployment (`serverFacts`, since
`/api/team-members` is view-scoped). A chosen group's relation rows are that
group's deployment only (`serverRows`).

Problems read as one plain sentence about what happened and what to do
(`spawn-messages.mjs`, keyed by the contract's stable code). The code and the
technical or kernel text — paths, hashes, the `git clone` remedy — stay
behind a **Details** toggle and in `data-code`; no decision depends on wording.

Model suggestions are advisory (`/api/models`), custom entries stay valid, and
a remote target never borrows local model/configuration facts. No capability
or readiness facts appear in this dialog; soul readiness belongs to the soul
inspector.

## The soul inspector on the workspace model (`operationsApi: 2`, `soulsApi: 2`)

`POST /api/capabilities` runs `oats inspect` for exactly one subject: the
selected **soul** (`--soul`, what a spawn of it resolves now) or the selected
**instance** (`--home`, as spawned — an instance never changes under itself).
There is no scope subject. The gate is the probe integer `operationsApi === 2`
(`inspect-contract.mjs`); a 0.25 kernel gets the "update OATS" line and no
request. The response must name exactly the selected subject, or it is not
rendered The payload's own integer is checked too: a classic scope
still answers `operationsApi: 1`, which the inspector names ("still uses the
classic layout") instead of reading.

The inspector is read-only (the soul is edited in its repository) and shows the
kernel's records: the soul row's source (`member <repo> @ <c7>`), team, path,
work, declared runtime/model; its declarations (`capabilities`, `requires`,
`defaults`, `knowledge`, `teams`, `resources`, `children`) with declaration
problems verbatim; the instructions (for a home, with the composed inject
sources); the effective layer providers; each resolved module with its version,
layer, origin (its `from`), missing requirements and merged settings; and the
layer providers' operations. Top-level `problems[]` read as one plain sentence
each (the kernel's message), the code behind **Details**. No classic field
(scope chain, activation, trust, snapshot drift, sources provenance) is read.

Provider operations are addressed `<layer>:<name>` (`oats operation run
knowledge:status --home <h> --json`). An operation that is unavailable (e.g. a
home operation on a soul: "needs a running home (--home)") or that has a
required argument shows its reason instead of a control; optional arguments are
never synthesized. A run result is read only when it is `operationsApi: 2` for
exactly the operation pressed (a classic scope's `1` is named); a view renders
its `summary` and `documents` as inert text, and an action its JSON. Kernel
refusals (e.g. `E_OPERATION_UNKNOWN`) are shown in the kernel's words.

These reuse the existing inspection lifetimes and latest-intent guards; there is
no per-card request fan-out or polling inspection. Routine roster/CLI polls keep
the settled DOM; stale successes and rejections cannot overwrite the current
observation. Native visual acceptance is not inferred from the DOM/CSSOM and
computed-token AA tests.

## Loading states (`loading.mjs`, `loading.css`)

Every data region runs on one state model, owned by the controller
`createDataState()` in `loading.mjs` (vanilla DOM, no tokens of its own):

| State | When | What is painted |
|---|---|---|
| pending | no data for this subject yet | after 150ms a skeleton shaped like the final content; `aria-busy` on the region; the status line says "Loading <noun>…" once — never an empty-state message |
| ready / empty | the last read succeeded | the content, or the surface's own empty copy after a successful zero read |
| refreshing | data present, a read in flight | the content stays interactive; "Refreshing…" with a static dot after 400ms in the surface header; no `aria-busy`, no announcement |
| stale | data present, the read failed | content kept; "Couldn't refresh <noun> · observed <age>" with **Retry** in the attention style and the cause behind a **Details** disclosure (and in the line's title); announced once through the status line, which is then clipped (`.loading-quiet`, its box kept) so the amber line is the one visible message — never the error red; actions that need current state are held by the surface with `aria-disabled` (never `disabled`: Chromium blurs a focused control that becomes disabled) and an accessible reason (`aria-description` + title: "Unavailable: roster is not current", "Unavailable: inspection is not current"), and every handler on a held control checks the mark first |
| failed | no data, the read failed | the cause, a **Details** disclosure with the code and **Retry**, where the skeleton stood |

The controller owns the two delays, `aria-busy`, the status-line text, the age
line (`observedAt` from the response, `Observed <age>` after two minutes even
on success; no age when the field is absent) and the Retry wiring. The surface
owns its latest-intent tokens and calls `begin()` / `succeed()` / `fail()`
only for the read it still owns; `reset()` on a new subject, `defer()` when a
read settled without an observation (the server's deployment is still
`pending`: its copy stands in, no skeleton, still busy), `cancel()` when a read
was abandoned. Wording is fixed in `wording`; "Reading …" and "Loading…" are
retired. Refresh and Retry controls go through `bindRefresh()`: `aria-disabled`
while a read is in flight, never `disabled`, so a focused control keeps focus.
A rebuild from new data restores focus and scroll through `captureFocusState()`,
called right before the repaint (focus may have moved while the read ran):
actionable controls carry `data-focus-key` (`remove:<label>`, `op:<layer>:<name>`,
`instance:<home>`…) and are re-found by key only — a path is never trusted onto
a button, since a repaint happens exactly when positions shift — while a
disclosure summary is re-found by its structural path; a control that vanished
hands focus to the surface's Refresh. An identical poll is skipped through a
JSON signature of what the surface paints. CLI-missing, deployment-pending and
not-observed states keep their own copy: they are separate truthful states, not
skeletons.

Skeleton shapes (`skeleton(doc, shape)` / `skeletonBlock`): `roster-row`,
`soul-card`, `table-row`, `detail-section`, plus `pill` for counts and `line`.
The roster-row and soul-card skeletons wear the real classes (`.ctx-tree-row`,
`.ctx-inst`, …; `.soul-tile > .soul-card > .sbody / .sfoot`) so shell.css and the
Souls grid's CSS own their geometry: a redesign moves the skeleton with it, and
no pixel value is copied into loading.css. The Capabilities table's skeleton
(`catalogSkeleton` in `workspace-discovery.mjs`) is a disabled, `aria-hidden`
`button.catalog-row` for the same reason. `defer({ keepSkeleton: true })` is
for a server that answers "still reading" (`refreshing: true` with nothing
held): the subject is loading, so the skeleton stays.
`loading.css` (linked from `index.html` and the harness) derives their fill
from the theme tokens (`color-mix` of `--fg` over the host), shimmers at 1.6s
and stops every animation — including the older `.spinner` — under
`prefers-reduced-motion`. Text colours are the inventoried AA pairs (muted on
bg/surface, warn on attn-bg); `test/loading-contrast.test.mjs` proves them on
the effective colours. One live region per surface: where a surface has no
visible status line (the sidebar roster, the hierarchy), `statusLine(doc,
{ visuallyHidden: true })` speaks and the visible notice is a `role=note`.

Where each surface wires it: the sidebar roster in `instance-tree.mjs`
(`createRosterLoading`, `rosterSignature`, the pending count pill,
`markStaleControl` / `staleBlocked`) and `shell.mjs` (`refreshContextRoster`;
while stale, Start…, the actions menu and a *stopped* row's own activation are
held — a stale `running:false` may be running by now — while a running row
still opens its terminal; a row of a `stale` deployment, `rowStale` in
`view-deployments.mjs`, is held the same way, and so are its actions in the
overview); the hierarchy in `views/hierarchy.mjs` (the summary
pill, its own notice keeps the stale copy with the observation's age); the soul
inspector in `soul-inspector.mjs` (while `loading.settled === 'stale'` — the settled state, so a Retry in flight over stale content keeps the hold — every
`[data-mutate]` control and the teams panel's join/leave — `createTeamsPanel`'s
`mutable` / `mutableReason` — wait with `INSPECTION_STALE_TITLE`; Launch,
Schedule and Files come from the roster and stay; a same-subject `show()` is a refresh that never runs
`frame()`: the actions are built once per subject and read the current row at
click time, the roster-derived block — lede, refusal, facts, Instances — is
repainted behind its own signature, and "Teams here" is created with the frame
so `soul teams` runs beside `inspect`) and `soul-teams-here.mjs`; readiness in `readiness-view.mjs` (the
summary line is separate from the status line so an announcement never
overwrites it).

The Workspace view (`views/spawn.mjs`): the Souls grid's controller
(`s.gridState`) paints card skeletons in the grid (one row plus one, at the
real card size), the failed block in the grid and the stale line in
`.souls-notice` above it; `settleGridState()` reads the reply — the kernel's
`catalog.reason` is a failed read (stale beside a partial list, failed with
none), an unobserved deployment defers with the deployment's own copy, and
`refreshing: true` with no souls keeps the skeleton. `renderGrid()` leaves the
grid to the controller while there is no data (the one exception is the
unobserved deployment's copy) and skips an unchanged paint behind
`s.gridSignature`. The Capabilities tab (`workspace-discovery.mjs`): the held
table is never set to null within one workspace generation — a CLI emit or a
sync re-reads it in place (live after a sync, `refresh: true`), a failed
re-read marks it stale with Retry, and spec 02's held-table shapes (`status:
'ok'` with `reason`; non-ok with `lastGood: { capabilities, observedAt }`) are
shown stale. Both tab counts reserve their width with a pill while the count is
expected (`paintCount`); a failed roster read leaves the Souls count empty and
still (`rosterUnavailable()`). The capability page (`capability-page.mjs`,
painted by `paintCapabilityPage` in `views/spawn.mjs`): opened from a soul
before the catalog is read, the lede and the Comes-from facts are skeletons
filled in place when the discovery's `onCatalog` fires; a catalog refresh
while the page is open repaints it behind a signature over the content only,
with focus kept by `data-focus-key` (`used:<soul>:<root>`, `file`; a vanished
control hands focus to Back); the catalog's age line under the page bar is
the controller's own notice (`noticeElement` / `updateNotice` in loading.mjs,
through `catalogNotice` / `updateCatalogNotice`), updated in place on every
catalog event and on the roster poll (`touchCapabilityPage`), so its Retry
keeps focus, wears the busy mark while the re-read runs, and its age ticks.
A failed read that carries data (the kernel's `catalog.reason` beside a list;
a non-ok capabilities read with `lastGood`) calls `succeed()` only when
nothing was shown yet, then `fail(error, { observedAt })`: with data on screen
`fail()` alone updates the stale line in place — one node, one announcement,
a focused Retry kept. The spawn dialog's harness, model and launch hints (`matched()` in
`spawn-dialog.mjs`) read only a preview for the choices on screen, like the
name and work hints.

**The capability page's Contents (spec C).** What an instance gets, read through
`oats capabilities show` (feature `capability-show` AND `capabilityShowApi: 1`;
gated off with a line for an older CLI, a remote workspace, an external
capability or one the catalog does not list): `capability-contents.mjs`, a
controller `views/spawn.mjs` creates per open page (`s.capOpen.contents`) and
whose one long-lived `element` `renderCapabilityPage` re-appends after
Provides on every rebuild (`hold()` puts focus and both panes' scroll back),
so a catalog repaint never touches what is open. `update()` takes the
CATALOG row (from a soul page, the catalog's row, not the resolved one): its
selector (`--member repoKey` / `--package id`) and commit key the subject; an
unchanged subject reads nothing. The decoder (`capability-show-contract.mjs`,
shared with the server) refuses a whole answer it cannot read. Every path is
relative to the capability directory (a skill's files too; the tree shows
them relative to the skill). The show read and each file read carry tickets
checked on success and failure (A→B→A safe); an answer at another commit
than the row's is never rendered (`E_CAPABILITY_MOVED`: the catalog is re-read
through `onCatalogStale`, as on `E_CAPABILITY_UNKNOWN`). A moved commit keeps
the open file while it is still listed. The navigation is ONE `role=tree`
holding two labelled `role=group`s (Instructions, Skills; an empty group is a
label and a note beside it), with a roving tab stop found again by
`data-focus-key` (`file:<path>`, `skill:<path>`). The reader renders Markdown
through `views/markdown.mjs` in its strict profile (front matter through
`front-matter.mjs` as a facts table, or as YAML code when outside its subset)
and everything else as highlighted code; links are settled after rendering
(`settleLinks`): a listed file, `https:` through `openExternal`, `#fragment`,
or plain text. `E_CAPABILITY_FILE_UNKNOWN` and `E_REMOTE_FILE_OVERSIZE` are
muted lines, not failures. The reader sits on `--bg`, the viewer's own ground,
so the viewer's checked colours hold, with a type scale kept under the page's
own (headings below the 20px title, code at 12px). The page's *Provides* is one
compact card (`providesSection`): a row per kind (Skills, Commands, Hooks; from
a soul, Commands and Settings) with every name its own code chip, wrapping.
`paintCapabilityPage` renders the page's facts and Contents from the same
current catalog row (`contentsRow`), so a refresh moves them together.

**Core capabilities and Capabilities read as one system.** Wherever the two
sections appear (the soul page, the inspector's *Modules as spawned*, the
spawn preview, the context panel's Soul tab), a core slot's provider (by
`layers.<slot>.id` or by a core `layer`) and a soul emptying a slot
(`capabilitiesOff[]` with `reason: "slot-none"`) belong to Core only: never
listed or counted under Capabilities (`compositionEntries`,
`composePreviewModules`). Core's rows come from `coreEntries` in
`capability-page.mjs`: one per slot, with the reason the kernel reports
(`layers.<slot>.from` behind `layers-from`, the emptied slot behind
`desktop-facts`, "No default" only with both and a soul subject; never a
guess), in the same words everywhere (`whyTag`, `coreNote`, `whyFact` for the
capability page's "Why" row). On the soul page both tables go through one row
builder (`renderSoulCore` / `renderSoulCapabilities`), so the grid, source chip
and why tag cannot drift; a filled core row is a `button` with
`data-focus-key="core:<slot>"`.

The terminal-side context panel's Soul tab (`instance-soul.mjs`) and its
Messaging & Teams section (`instance-teams.mjs`): the roster-derived header is the
context panel's and stays put; each section owns a body under it
(`context-panel.mjs` mounts the Soul section on `.context-panel-soul-body`;
the Teams section appends `.instance-teams-body` to its host) where the
controller paints the skeleton (rows wearing the real classes), the failed
block with Retry (`refresh: true`) and, for the soul, the stale line — never
a silent absence, nothing prepended above. Both re-read the same selection
when `instanceStatusIdentity(instance)` (`instance-status-identity.mjs`:
home, last start, running, module drift rows, soul source) changes: the soul
as a refresh that keeps its content, the teams by refreshing the card's list
(or inspecting again when there is no card). An inspection without the soul,
or without a messaging provider, is an empty read: the header stands, the
Messaging & Teams section hides. That section claims its place during the
inspection only when the roster row already reports `identityAddress` (or a
failure is on screen), never again after a no-provider answer, so nothing
under it shifts. Every controller has a `focusFallback` (the section head or
the card's Refresh; the Soul body host; the Souls search field; the
Capabilities search field): a focused Retry whose line or block leaves on
success never lands on `<body>`.

Roster-derived claims follow the roster's *settled* state
(`rosterSettledState(s)` in `views/spawn.mjs`: the controller's `settled`
while a re-read runs — a refresh over a stale roster is still stale — else
its `state`), synced after every poll, settled or failed: the soul
inspector's Instances card (`instancesState()` → `syncRoster()`) says "No
instances yet." only after a good read, shows a skeleton line while pending
and makes no claim (no count) while failed or stale; the Capabilities table's
"Used by" cell (`renderCapabilities`'s `rosterState`, through the discovery's
`syncRoster()` and render key) and the capability page's "Used by" section
show a muted "—" carrying `ROSTER_STALE_TITLE` (`loading.mjs`, re-exported by
`instance-tree.mjs`) as their accessible description instead of "Not used" /
"No instance carries it yet." while the roster is not settled-good. A
roster failure discarded because the selection moved still `cancel()`s the
grid's read, so nothing is left "refreshing". A catalog that failed with
nothing held shows the failed treatment on an open capability page
(`failedElement` / `updateFailed`, shared with the controller's own block:
cause, Details, Retry), never silence; a Retry over it paints no skeleton
(`catalogPending` only before the first read settles). The Messaging & Teams section
treats a no-provider answer as a settled absence (`cancel()`, not data), so a
later failed re-read is the failed block with Retry, never a header over an
empty body.

Spawn stays enabled over a stale Souls grid: a local spawn goes through the
dialog's live kernel preview (the preview boundary binds the choices to the
kernel's decision at spawn time), so the grid's staleness cannot make it act
on old facts. A remote spawn (`runRemote` → `doSpawn`) has no preview binding;
that path is unchanged by the loading-states work. Filed for a later a11y
pass: consolidating each surface's several live regions into one.

## Team controls on a live instance (teams contract 2026-09-25)

An instance's inspector shows a **Teams** section (after its Instance facts)
when the home's messaging provider **declares** the home operation
`messaging:teams`; Join/Leave need `messaging:join` / `messaging:leave`, whose
one required argument's name is read from the operation row (`--arg
<name>=<label>`). The gate is never a provider name or version
(`teams-panel.mjs`). No messaging provider: no section. A provider without
`messaging:teams`: "Not supported by this messaging provider." — never an
error. A soul subject has no section (home operations).

The teams document (1.16 names: `{defaultTeam{team, source}, primary, eligible[{label, team,
joined}], joined[{label, team, since, identityHome, receive}], unmapped[label],
at}`) is read only from an `operationsApi: 2` run for exactly that operation
and decoded strictly (exact keys, bounded strings, absolute identity homes,
unique labels; `source` is exactly `setting` or `root`). Rows: the workspace's default team (always on, no Leave; its id and, in words, where it comes from: "set by the workspace or host setting" or "the messaging root's active team"); each eligible
label (primary marked) with Join, or when joined its date, how its mail
arrives (`poll` → "Checks this team's mail between tasks", `native` →
"Receives this team's mail as it arrives", anything else as sent — a poll team
never reads as live delivery), its identity home and Leave; labels the
workspace does not map, unavailable. Join/Leave answer the same document (plus `actions[{action: join|leave, label,
released?, receipt?}]`, accepted on those answers only: each label an eligible or
joined row, the receipt opaque and never shown), so the panel repaints from it; a refusal (`E_TEAM_NOT_ELIGIBLE`,
`E_TEAM_DEFAULT`) shows the relayed message verbatim under its row with the
code behind **Details**, keeps the last good state and re-reads. If the re-read
no longer offers that row (e.g. the mapping was removed between read and
click), the refusal moves to the top of the panel, verbatim with its code and
"<label> is no longer offered to this instance.", and stays until the next team
action or an explicit Refresh/Retry. One action at
a time: while it runs every team control and Refresh are locked. Reads and
actions carry the inspector's selection lifetime plus their own serial, checked
on success and rejection, so an obsolete answer paints nothing and re-arms
nothing. The generic Provider operations list leaves the three team verbs to
the panel on an instance.

## Workspace view on workspace model v2 — Capabilities, Sources, sync (F2)

Every fact comes from the installed kernel; the Desktop parses no deployment
file and resolves nothing itself (`workspace-discovery.mjs`, `workspace-catalog.mjs`,
`workspace-sync-view.mjs`, server `server/workspace-sync.mjs`, `workspace-cli.mjs`).
Gate: `version --json` advertises `workspace-v2` with `workspaceApi: 2`; a remote
workspace is observed through its server and never synced from here.

- **Capabilities** is `oats capabilities --dir <deployment> --json`
  (capabilitiesApi 1), held by the server and re-read when the workspace
  state it was read under moves, or when viewed after 60 s
  (`docs/desktop-load-path.md`); the tab reads
  the held table via `POST /api/workspace-sync?ws=<id>` `{action:"read"}`
  when it opens (`refresh: true` forces a live read; after a sync the table
  is re-read). A
  segmented jump (Workspace owned / Repo owned, when the CLI lists it / Packages,
  the sections in the same order; navigation, so the
  section in view carries `aria-current`), then one 58px row
  card per capability (design board 4): a tile tinted by kind (Knowledge,
  Messaging, Tasks, other, package), the name with its kind chip over a
  one-line description, the source chip (package + pinned version, or the
  member repository at latest), *Used by* (souls whose instances record the
  module: up to three tiles and "N souls"; "Every soul" for a reported
  workspace default; "Not used") and a chevron. The whole row is one native
  button (Enter and Space are its own) named "<cap>, <kind>, from <source>"
  and described by its description and used-by (`aria-describedby`); it opens
  the capability's page with the full description; Back returns to
  the list with its scroll offset, search and filters. No Members list here.
  The **Team** and **Repo** dropdowns filter Workspace owned locally (AND);
  they name only what the rows hold (non-collapse rule: a member's
  `publishes` never absorbs its package's capabilities).
- **Teams** (kernel feature `team-model-2` or `team-model-3`, `teamModelOf`;
  `computer-teams.mjs`) is the
  *Teams* page: *Shared with the workspace* (read-only, edited by PR) and
  *Only on this computer* (add, remove, make default), one card per team with
  its address, who may join and, from the roster, the instances whose
  identity's team is that team's id (nothing when none). Those members come
  from `/api/team-members?ws=<view>` (#482, decision Q5): the view's
  deployments only. A card groups them by deployment (`memberGroups`), each
  heading labelled by `deploymentLabel` ("This Mac · ~/Agents/oats · 3",
  "altair · ~/Agents/tsm · not reached"), this Mac's first. A member's
  `workspace` is its deployment id. Its Show and Terminal actions stay in the
  view on screen (`teamMemberAction` never switches workspace). They wait for
  the row of that deployment, and the open is owned by the view
  (`instanceActionTarget(view, row)`).
  Team model 3 (`teamsApi: 2`) adds *Souls in the workspace*, the committed
  `souls:` patterns, read only; local teams take Add and Make default only
  where `localTeams` allows them, and a local team left where they are closed
  keeps Remove under the kernel's local-teams-closed failure. The soul page's
  *Teams here* (`soul-teams-here.mjs`) is read only then (`soulTeamsApi: 2`).
  Wording about where teams change is the kernel's (`LOCAL_TEAMS_CLOSED`,
  `SOULS_WHERE`, `UNMAPPED_FIX`, `UNCONFIGURED`; tests pin them to
  `lib/teams.mjs`).
- **Sources** renders the roster observation's `oats workspace status`:
  repositories (team, confirmation status + the kernel's detail), packages
  (lock, capabilities) and external souls. No extra read. With
  `servers-per-workspace` and `server-connect` it also holds the **Machines**
  box (`workspace-machines.mjs`, `../docs/desktop-machines.md`): this
  workspace's machines with Check, Remove and Add a machine, mounted once per
  workspace and passed to `renderSetup` as `machines`.
- **Notes** keep the F1 guards visible: an unreachable workspace (module drift
  not current), withheld instance rows, unsynced/stale declarations and
  workspace problems, each in the kernel's own terms.
- **Sync** (header) runs `oats sync --json`: it resolves every `packages:`
  entry, fetches it and writes the lock. There is **no package approval** —
  declaring a package is the trust decision (kernel feature
  `packages-no-approval`; a kernel without it gets the "update OATS"
  state, never a half-working view). The header says *Lock current* or *Lock
  out of date* (from `oats workspace status`). A sync that did not finish
  (`E_PACKAGE_INTEGRITY`, lock drift, an unreadable remote…) or that reports
  problems opens a sheet with one plain sentence; the kernel's code and
  message stay behind Details. One sync per deployment (`E_SYNC_BUSY`). The
  roster refreshes after a sync.
- **Onboarding** (Add workspace → Browse…): a picked folder without
  `oats-local.yaml` gets a single-use offer bound to its canonical path; the
  operator types the workspace repository and main runs `oats onboard <dir>
  --workspace <ref> --json`, then the ordinary transactional add. A refused ref
  gets a fresh offer for the same folder; `rolledBack` is reported.

**Pinned tops and one scroller per tab (spec G, `sticky-top.mjs`).** The view
is one fixed-height column that never scrolls: the tab row (`.workspace-header`,
which also carries Setup's List/Graph switch) and the Souls bar sit outside the
content scrollers (`.souls-grid`, `.workspace-discovery`). Each scroller is
positioned, `min-height:0` and `overscroll-behavior: contain`; the view root
(`.souls`) is `position:relative; overflow:clip`. Inside the Capabilities
scroller the section pills + search (`.ws-toolbar.ws-sticky`) and the Teams page
head (`.ct-page-head.ws-sticky`) are `position:sticky` on the opaque `--bg`.
Chromium insets a sticky box by its scroller's padding, so they pin at
`top: -var(--ws-pad-top)` (flush with the scrollport; nothing shows above
them) and keep an 8px inner top. Their 1px bottom edge is always there,
transparent until content has scrolled under the block (`.is-stuck`), so the
block never changes height; the Souls grid does the same with a top edge
(`.is-scrolled`). `trackStickyTop` also writes the pinned block's height to
`--ws-sticky-h`, the `scroll-margin-top` of the section heads, rows and the
Teams page's controls, so a pill jump or a focused row never lands under it.
"Filter by Team / Repo" stays in the Workspace owned header: it filters only
that section, so it scrolls with it. Section and group headers scroll. This
holds at every width: soul-inspector's narrow `@container(max-width:700px)`
block restacks only `.souls-body.inspecting` (the side inspector under the
list, scrolling together); without it the view keeps the layout above.

Why the containment matters: an absolutely positioned element with no
positioned ancestor (the shell's one `.sr-only` and the views' `workspace-sr-only` / `loading-sr` words) escapes a scroller's
clip and stretches the document; wheel chaining, `scrollIntoView` and End then
scroll the whole app, headers included. The sr-only utilities are anchored
(`top:0; left:0`) and the shell's `body` is positioned and clipped, so the
document never has anything to scroll (`workspace-sticky.test.mjs`; the
browser behaviour is verified live over CDP).

All awaited reads and mutations carry latest-intent ownership (request serial +
workspace generation) checked on success and rejection, mutation-verified in
`workspace-v2-view.test.mjs`. Fixtures are kernel captures
(`test/fixtures/workspace-v2/f2`, with provenance).

## Keybindings (shell-level)

The keymap, its per-platform defaults, the terminal policy, the F6 regions and
the keyboard audit are documented in `../docs/desktop-keyboard.md`; this
section is the module map.

- **Mod+F** reveals the sidebar and focuses the instance filter; **⌘N /
  Ctrl+Shift+N** opens Workspace's soul chooser, never automatically spawning
  an instance. Visible hints and tooltips follow the effective bindings
  (including explicit unbinds). Existing user overrides are retained.

- **keybindings.mjs** — the keymap engine: action registry
  (`registerAction`/`setActiveContexts`; a registration may carry a
  `defaultChord` that folds into the effective keymap like a
  `DEFAULT_KEYMAP` entry — override wins, explicit unbind kills it),
  `DEFAULT_KEYMAP` (one entry per action: a chord, or `{ mac, other }`
  when the platforms differ; `defaultBinding(id, isMac)`), user overrides
  persisted under `localStorage["oats-desktop-keymap"]`, chord
  parse/format/match, and dispatch (`matchEvent`/`handleKeydown`).
  `getBinding(id, isMac)` is override → platform default → registration
  default; pass the platform wherever a chord is shown. The engine
  skips already-consumed (`defaultPrevented`) events, and unmodified/
  shift-only chords never fire while an editable field (input, textarea,
  select, contenteditable) has focus. Terminal
  policy (a default chord never takes a key a terminal program reads):
  inside `.xterm`, on macOS only ⌘-resolved chords fire, plus Ctrl+Tab for
  tabs.next/prev; on Linux/Windows only `TERMINAL_ALLOWLIST` action ids may
  fire (their defaults are Ctrl+Shift+key or Ctrl+Tab) — plain Ctrl+letter,
  F6, Alt+digit and Ctrl+PgUp/PgDn belong to the attached program, and
  `focus.leaveTerminal` (Mod+Shift+F6) is the way out. `keymapConflicts`
  lists clashes that involve a stored rebind; the shell marks the footer
  shortcuts button and the editor names them. `app.quickOpenSouls` (Mod+P) is
  deliberately NOT allowlisted: ⌘P fires inside xterm on macOS via the
  ⌘-chord policy, but Ctrl+P inside xterm on Linux/Windows is the shell's
  history navigation and reaches the pty.
- **focus-regions.mjs** — F6 / Shift+F6 (`focus.nextRegion`/`prevRegion`,
  outside a terminal; `focus.leaveTerminal` from inside one): sidebar nav →
  roster → main → instance panel, hidden regions skipped, each region's
  current item focused, never `<body>`. F6 and the tab switches are no-ops
  under an open modal.
- **surface-return.mjs** — "back to where you were" after a flow that moved
  the main surface (Quick Open's spawn dialog): the same tab or stage and
  control, unless the operator moved on.
- **overlay-picker.mjs** — the shared overlay + fuzzy machinery behind the
  command palette and Quick Open: one input over a listbox
  (arrows/Enter/Esc, aria option pattern), the house subsequence scorer
  (`subsequenceScore`; `null` = no match — prefix bonuses make real scores
  negative), and the stale-load generation guard. Rows may carry a tree shape:
  consecutive rows sharing `group.key` sit in one named `role=group`, `depth`
  indents, `under` is visually hidden text read with the option, and a
  `context` row is `aria-disabled` and never active. An optional `cycleKey(e)`
  lets the picker's own chord move the active row while open (wrapping,
  skipping context rows); with it, `toggle()` on an open picker cycles.
- **palette.mjs** — the command palette's rows (`paletteRows`): instances as
  the sidebar lists them, from the sidebar's own builders (`filterInstanceTree`
  with the fuzzy matcher as its predicate, then `rosterSections`, whose groups
  are `rosterGroups`), every instance listed, then at most
  `PALETTE_COMMAND_CAP` commands. The shell hands it one panel snapshot,
  `{ instances, deployments }`: with several deployments each one is filtered
  and clustered on its own, in the panel's order, and a group's key and label
  carry its deployment, so no relation or query context crosses deployments. The shell passes
  `cycleKey` from `pickerCycleDirection(e, "app.palette")` (keybindings.mjs), so
  ⌘K cycles while open (Shift: up) and follows a rebind.
- **settings-terminal.mjs** — Settings → Terminal: the font size stepper
  (− / typed value / +, 9–28, "Reset to default (15)"), mounted by
  `connections.mjs` through its `sections` option after Connections and disposed
  on close. It reads and writes the same store as ⌘= / ⌘- / ⌘0 and the palette
  (`theme.mjs`: `setTerminalFontSize`, `resetTerminalFontSize`,
  `onTerminalTypographyChange`), so every open terminal and the control follow
  each other. A typed size applies on Enter or on leaving the field, never per
  keystroke. The font family stays on the palette's prompt.
- **quick-open.mjs** — Quick Open for souls (`Mod+P`, also “Souls: quick
  open…” in the palette): fuzzy-find a soul from the Spawn view's data
  source and hand off through `views/spawn.mjs` `preselectSpawn()`: the
  spawn dialog scoped to that soul, as its card's Spawn opens it, with focus
  in Name. Opening never spawns; Spawn stays explicit. Attached-only, refused
  and CLI pending/unavailable souls open their soul page instead, which says
  why. Dismissing the dialog returns to where the operator was
  (`surface-return.mjs`). No second spawn form exists.
- **keybindings-editor.mjs** — the shortcuts editor dialog (`Mod+,`):
  actions grouped by context, click-to-record (Esc cancels, Backspace
  unbinds), conflict warnings via `findConflict`, per-row reset + reset-all.

## Shared Components — existing-data frame 10 parity

`notifications.mjs` replaces the roster-prepended `ctx.notify` notices with one
renderer-only, viewport-bounded scroll stack. Messages are literal text, not inferred severity/activity,
links or action callbacks. There are at most three cards; capacity eviction skips
the focused card. `notify` returns a handle `{dismiss(), shown}` (or `false`).
Options add owned `buttons` (each an explicit, epoch-checked activation whose
failure says "<label> did not complete. Try again."), a `detail` behind a
Details disclosure, and `sticky` cards (background-spawn failures) that are
exempt from the cap, report the operator's × through `onDismiss`, and collapse
by `group` into one expandable "N … failed" entry when there are more than
three. **No expiry timer**: dismissal is explicit, while a workspace
visit or disposal revokes the old scope. Background arrival never focuses or
mints navigation intent. Actual notification entry does; dismissal recovery uses
the shell's projection guard, a surviving next control or a visible same-scope
return target. The polite live region is independent of roster repaints and
continues to work without a roster. Primary foreground/background pairs and
existing popover shadows adapt to White/Solarized/Dark without raw colors.
Lifecycle alerts and confirmation paths are not replaced.

`choice-popup.mjs` owns the existing provider/model popup behavior. Model search
is local to reported advisory IDs/labels; **Defaults**, **Reported suggestions**
and **Custom** are control/data groups, not model-quality claims. Arbitrary
model IDs and comma-separated preferences remain free text. Filtering does not
probe the model catalog, change the model or launch. Late owned model-catalog fills refresh
choices without rebuilding the filter, losing its query or taking foreign focus.
Keyboard/retained-option focus reveals only within the popup below its sticky
search header, never by scrolling the outer dialog/page. Notification arrival
can reveal existing focused content within its stack, but never changes focus.
Provider/host changes revoke the old scope; render epochs and DOM membership
prevent removed/reopened options from acting. Popup Enter is consumed before the
outer launch handler; spaces, caret keys and IME remain text in the filter.
Resolved defaults and the disabled force-native K6 control retain their meaning.

Workspace/model/soul chooser notices distinguish **nothing reported** from
**no matching rows**. Workspace empty notices are outside the selectable
listbox, never fake workspaces; removed options cannot select through a new
empty state. Registry transaction behavior and source/context soul grouping are
unchanged. Already-conforming badges, workspace/context menus and native titles
with live keymap chords are retained—not replaced by a new tooltip manager or
keyboard interceptor. No Stop/Remove, K6, editor/detach/PR or OS notification
surface is introduced. Tests are inert DOM/CSSOM/ownership/contrast checks, not
native rendered acceptance.

## Instance panel (context panel) and focus mode

The shell owns one right-side region outside all editor groups, the **instance
panel** (`#context-panel`, `context-panel.mjs`). A selected terminal shows its
instance in three tabs (v4.1 board 1): **Instance** (header with the soul mark,
"instance of <soul>" linking to the Soul tab, an "older build" chip only when
the kernel reports `soul.status`/`modules[].status` other than `current`, and
"Running · 42m"; then Work, Session, Messaging & Teams, Lineage and the
lifecycle footer), **Soul** and **Developer** (Git and GitHub). Work is one card:
the work mode's tile and one sentence saying what the mode means for this
instance (`WORK_MODES` in `context-panel.mjs`: an icon and a sentence builder per
mode). The roster row's own facts (repo, branch, parent) sit in it in the mono
face, and an unreported fact gets the generic words ("its soul's repository",
"its parent's tree"), never an invented name. An unknown mode hides the section.
The sentence is rebuilt only when its words change. Ahead/behind counts are the
Developer tab's alone. Under the sentence, a closed **Paths** disclosure holds
Folder and Home, each with an icon Copy. It is built once and never rebuilt, so a
repaint keeps its open state and a focused Copy. It closes when the selection
changes. The panel's visibility check treats a closed `<details>`'s content as
hidden, so focus inside it falls back. Folder is
`<home>/work`, joined from the roster row's `home` with the home's own separator:
the kernel gives every instance that folder, a real one in worktree and
directory mode and a link to the shared tree in checkout, attached and workspace
mode, where a muted "shared" tag follows the path (the link's target is not
resolved; that would need a server read). Home is the instance home, where its
own files live; without a reported `home` string there is no Paths. Messaging &
Teams' header is the label plus a tools slot the injected Teams section fills
with its icon Refresh (`createTeamsPanel(…, { compact: true, refreshHost })`).
Under it come two parts with sentence-case sub-labels. **Messaging ID** is the
identity address (`identityAddress`, else the served identity) on one mono line
with an icon Copy. **Teams** is followed by the compact card's lead line, shown
once a teams document has been read, and the card. Empty groups
and file/brain tabs do not inherit another terminal's context. Roster refresh
matches the exact workspace/terminal identity and never selects or focuses a
panel; a missing or ambiguous observation makes session state unknown.

Workspace projects its actual selected-soul inspector into that same region.
Workspace still owns its requests and lifetime. Collapse or covering the
stage with a terminal preserves the inspector's DOM, local disclosure state and
in-flight content; a late response cannot reclaim foreground visibility. True stage unmount
or workspace reset ends that selection. Standalone view hosts keep the inline
inspector fallback.

There is no status bar under the editor groups. After the tabs the editor tab bar
holds only the two split buttons (spec F). The instance panel has no tab-bar
button: `panel.toggle` (default **Mod+Alt+B**, not terminal-allowlisted, so
Ctrl+Alt+B stays with the program in a Linux/Windows terminal), the palette's
"Instance panel: show / hide" and the panel's own collapse/expand controls run
it. **Focus mode**
(`app.focusMode`: palette and a rebindable action, no default chord) hides the
sidebar and right panel without closing tabs or changing split weights; exit
restores the existing sidebar/panel preferences. Focus mode always has a visible
exit: the `#sidebar-restore` edge is shown in focus mode and runs
`sidebar.toggle`, which leaves it; `panel.toggle` also leaves it and shows the
panel.
Focus that was in the hidden sidebar moves to the active tab's trigger, else to a
stable visible control (`stableFocusTarget` in `shell.mjs`: the sidebar toggle or
the restore edge), never `<body>`; a focus-mode change made
after focus was already lost (the palette removes its input before running the
command) lands there too. Mod+F and Mod+B leave focus
mode. Panel collapse and selected tab are session-local per workspace; focus mode
is a temporary presentation override. Collapsed, the panel is a rail (a 44px column, or a
34px row when the workbench stacks): the rail centres its controls on its cross
axis, each control centres its block `.shell-icon` as a flex box, and no control
has a cross-axis auto margin (the stacked expand drops its `margin-top:auto`), so
every icon sits on the rail's centre line (`context-panel-rail.test.mjs`). Native terminal input and per-window
lifecycle policies are unchanged.

### Git inspection (slice 2a)

**Desktop Git reads = K1 route only.** The legacy background collector's Git
commands and unused aggregate parsers are retired. They ran against every
instance tree without helper controls and substituted healthy zero aggregates
on failure. Local roster `git` is now explicitly null, overriding recorded
metadata; remote legacy data stays inert. No renderer interprets it as clean.

`instance-git.mjs` is an injected, on-demand read controller. The context-panel
host projects effective visibility and the committed terminal's exact identity;
first-visible and explicit Refresh read, ordinary roster polls do not. Hiding,
covering, switching workspace/instance or disposing revokes old controls and
pending success **and** rejection. Separate observation/file tickets protect
retries and same-file reselection; global workspace generations protect A→B→A.
Focus recovery stays inside the host's projection guard, not a new terminal-open
intent. No terminal keyboard or viewer lifecycle changes.

The panel displays the actual observed worktree/branch/revision/time, recorded
branch drift, and **separate upstream/default-branch comparisons**. Missing refs
and counts remain unknown, not 0/0. File kinds/counts and rename paths are the
reported ones; there are no invented per-file line totals. A selected file's
patch is read-only, text-only and against the captured OID (or empty for an
untracked file), never the moving HEAD. Binary and 256 KiB truncation are explicit;
a 4,000-line presentation limit is separately labeled. Failed refreshes retain an
explicitly stale observation with actions disabled, never a healthy empty tree.

`POST /api/instance-git?ws=<id>` accepts only the qualified
`{instance,agent,agentsRoot,server?}` selector plus action and opaque diff
id/revisions. The server, not the renderer, supplies `--home` and `--dir` from
its exact roster/scope. The accepted installed CLI must meet the 0.24.7 floor and
return `instanceGitApi:1`; diff responses must carry the hardened `readOnly`
contract and captured-OID `against`. Unsupported/missing commands are unavailable,
not a direct-Git fallback. Remote inspection is explicitly unavailable until a
negotiated remote command exists. `E_STALE_OBSERVATION` clears the patch and
re-observes; the user selects again, never an automatically substituted file.

The single POST route is loopback Host/Origin guarded and workspace-pinned in
the privileged proxy. Reads use fixed argv, `shell:false`, 15-second / 4 MiB execution bounds,
in-flight coalescing and a four-flight cap, with no persistent server cache.
Only validated DTO fields and sanitized diagnostics cross the boundary; paths
in a patch/observation do not authorize arbitrary file opening. See
[the Desktop Git boundary](../docs/desktop-git-inspection.md) for request and
refusal details. DOM/CSSOM and computed-token AA tests do not establish native
or rendered acceptance.

## Editor groups (splits) and the hideable sidebar (shell-level)

Sidebar relationship guides use an 8px nesting step and 4px elbows, sharing the
same CSS pitch as the rows. Compact outer gutters reserve more width for instance
names without changing relationship grouping, disclosure controls, 56px row
height or the selected row's 8px content inset.

Splits follow VS Code editor-group semantics (`split-layout.mjs` is the
pure model; `split-dom.mjs` the DOM projection). A split creates PERSISTENT
GROUPS on the tab layer: each group owns an ordered tab list and its own
active tab, and renders its own tab strip (`.group-tabbar`, a per-group
tablist holding the group's REAL tab elements) above its pane inside a
`.group-cell` flex cell of `#tabhost`. The first split seeds group 1 with
ALL of the layer's current terminal tabs (its selected tab stays visible) and
creates a new empty group that takes focus with no globally active tab — the next terminal opened from
any path (sidebar roster, palette, quick-open) lands in the FOCUSED group
(`openTabInFocusedGroup`); group focus follows the active tab (`focusTab`).
Switching tabs within a group, or focusing another group, never dismantles
the split — the layout belongs to the tab layer, not to any tab. The former
pending-slot indirection (split → absorb next terminal) is gone: an empty
focused group with a placeholder plays that role directly. While the split
is visible the top `#tabstrip` row is hidden (each group has its own strip;
keeping the old row would render an empty phantom chrome bar) and the split
controls (`#tab-actions`) ride the focused group's strip. Activating a
non-terminal tab covers the split without destroying group state. Closing a tab
**does not close its panel**: empty panels retain their identities and proportions.
Each has an independent focusable placeholder; selecting it clears `activeTab`,
so tab/terminal commands cannot accidentally target the previous instance.
Reopening an instance enters that selected panel; selecting an already-open
instance into it moves the existing tab without another attachment. Closing an
active tab selects its adjacent group-mate, or leaves that panel empty.

**Close split** (`split.close`: its chord and the palette; there is no button)
explicitly joins back to the flat strip. **Split: return to terminal
groups** in the palette restores a covered layout, including an all-empty one.
There is no new default shortcut. Clickable controls mirror the chords with no duplicated
logic: the split-right/down buttons and the sidebar toggles (rail-footer button + the
thin `#sidebar-restore` edge button shown while hidden) all dispatch the
registered actions through `runAction(id)` — context-gated exactly like
chord dispatch — and their enablement dry-runs the same model transition
via `split-controls.mjs` `splitControlsState`. One chrome per tab means the
tab-a11y roving/aria/close semantics hold PER GROUP (each group strip is a
tablist with a single selected, tabbable trigger; arrows walk the group).

Tab sizing (spec F, superseding "strips scroll instead of compressing"): tabs fit
their strip like VS Code's "shrink" mode. Each `.tab` is `flex: 1 1 0px` with
`max-width: fit-content` (its natural width, which the trigger caps so a tab
never passes `--tab-max`, 280px) and `min-width: --tab-min` (168px, measured
live in bold: the status dot, the name's start and an ellipsis ("oats-…") and its
last eight characters, next to the close button).
Below the floor the strip scrolls. Names share long prefixes (the soul), so a
terminal tab truncates in the middle: `tabNameTailStart()` (`tab-a11y.mjs`)
picks a tail (the last eight characters, or what follows the soul when that is
shorter) that never shrinks, and the head before it ellipsizes, so shrunk tabs
read "oats-…palette" / "oats-…awn-flow" rather than seven "oats-…". A remote
tab's " · host" follows the tail in its own span and gives way first. The branch detail grows from zero into what the name
leaves, so it ellipsizes and disappears first; the full name stays in the
trigger's `title` and accessible name. **The selected tab is always visible**:
`revealActiveTabs()` in `shell.mjs` scrolls each strip (`#tabbar` and every
`.group-tabbar`) to its active tab after every activation and tab close, and a
`ResizeObserver` on the current strips (re-observed by `renderSplit`) does the
same when one resizes (window, sidebar, panel, split). Only the strip's
`scrollLeft` moves (`revealInStrip` in `reveal-in-scrollport.mjs`), never
`scrollIntoView`, which would also scroll the workbench's own ancestors; keyboard
focus on a tab's trigger or close uses the same helper. In a group strip the split
buttons scroll with the tabs, so they are pinned to its end (`position: sticky`)
and the strip declares their width as `scroll-padding-right`, which
`revealInStrip` honours: a revealed tab never sits under them.

### Workspace-local tab memory

`workspace-tab-memory.mjs` retains each workspace's group membership/order,
orientation, proportions, selected tabs and focused group for the current app
session. Workspace switches hide all outgoing panes synchronously and park their
DOM nodes before restoring the destination layout; existing terminal attachments
are retained, not recreated. Empty layouts and their focused destinations are
remembered too; only a workspace with neither open tabs nor a retained layout
falls back to the stage. Restart restoration of tab layouts is not implemented yet.
Memory is keyed by the view id; `rehome(map)` moves a deployment id's memory to its view
(see "Workspace views").

All artifact tabs (terminal, brain, file) are workspace-scoped, including their
activation boundary and deduplication keys. A retained brain tab has a pinned
`ctx.workspace` and per-mount lifecycle instead of changing identity with the
workspace bus. Standalone brain views without that context still follow the bus.
Open requests share a latest-selection token plus the workspace generation, so a
slow earlier open cannot steal selection or land after an A → B → A switch.

## Supporting read-only files

**File: open read-only…** in the command palette, or **Mod+O**, opens a browser
file chooser and adds a normal workspace-scoped tab. Markdown renders as a reader;
code/plaintext renders with semantic syntax colors. There is no editor or save
operation. The action is rebindable; Ctrl+O inside a Linux/Windows terminal still
belongs to its program (the action is not terminal-allowlisted).

`open-file.mjs` captures selection/workspace ownership before the chooser opens.
Each selection gets a distinct identity, even for identical basenames. Once a tab
exists, its immutable read belongs to the tab's lifetime, so selecting elsewhere
does not strand it in Loading. Browser-selected files are limited to 2 MiB and
reject NUL-bearing content. They have no authoritative absolute path; local links
and embedded resources are disabled rather than guessed. Existing guarded
`ctx.openFile(path)` links keep their path-backed behavior. Files stay alongside
terminal/brain tabs without becoming a primary navigation surface.

There is no agent-facing CLI command for opening a file. The read route's guards and the
renderer's sanitizing are in [the file viewer](../docs/desktop-file-viewer.md).

## Terminal focus discipline (shell-level)

`selectTab(id, { focusContent, intent })` is the explicit-selection boundary.
Async opens reuse their dispatch ticket; pointer, keyboard and close actions
supersede older foreground work. `activateTab()` only projects/restores state.
`selection-ownership.mjs` binds focus permission to the selected tab, request and
workspace generation. A delayed terminal attachment can initialize a retained
terminal without stealing focus from a newer selection, sidebar or workspace.
Only a current explicit content-focus request focuses its input when ready;
workspace restoration and close fallback remain focus-neutral.

`terminal.focusActive` is rebindable and editor-visible, with no default chord.
Palette/Quick Open share one modal lifetime per document. Cancellation restores
the logical opener even after roster repaint; activation hands focus to the
chosen destination without a transient return to the old control.

## Developing without the shell

`harness.html` supplies a stub `ctx` and tab chrome for ALL views — including
the Markdown tab (it prompts for a file path;
`ctx.openFile` routes into the markdown view); `harness-server.mjs`
serves it and proxies `/api/*` to a running backend server (same-origin, so
GETs and guarded POSTs both work exactly as in the real shell):

```sh
node packages/desktop/server/oats-web.mjs start --port 4821 --dir <workspace>
node packages/desktop/renderer/harness-server.mjs --port 4899 --api http://127.0.0.1:4821
open "http://127.0.0.1:4899/"
```
