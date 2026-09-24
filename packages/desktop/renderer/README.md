# oats desktop — renderer views (webpanel-dev)

Ports of the retired browser panel's functionality as desktop renderer views,
per the desktop-app contract: each view is a plain ES module exporting
`mount(el, ctx)` / `unmount()`, where `ctx = { api(pathname, opts),
openFile(path), openTerminal(instance) }` is provided by the shell.
No frameworks, no dependencies; data comes from the bundled backend HTTP API.

## Views (`views/`)

- **spawn.mjs** — **Workspace**, with Souls / Capabilities / Sources subtabs.
  Souls come from `GET /api/agents` (the kernel's `oats souls` catalog);
  selection opens the side inspector — read-only: a v2 soul is edited in its
  repository, so the inspector names where (**Edit this soul in its
  repository**: path and repository from the `oats souls` source, a web link
  for hosted keys) and never writes it in place; there are no layer bindings
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
  workspace is shared across views via `setWorkspace`/`onWorkspaceChange`
  (persisted in localStorage), so a shell-level switcher can drive it too.

`theme.css` carries semantic WCAG AA tokens for **White** (default),
**Solarized**, and **Dark**. Theme actions are available in the command palette;
cycling follows that order. Existing valid `oatsweb.theme` preferences survive;
missing/invalid preferences mean White regardless of OS. Views use tokens only,
scoped under `.oats-view`. Orange selection is distinct from error/success.

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

## Active overview — slice 7a, reported roster only

The existing `hierarchy` stage consumes **GET `/api/panel` only**. Relation groups
are connected components of the shared parent/sibling resolver across roots and
repositories, never repository buckets. Groups remain anonymous/count-labeled;
reported context is metadata, not a derived group name. Header counts distinguish
multi-member groups from independent instances and keep unknown runtime state
separate from stopped. Parent/child elbows and dotted sibling lines do not rely
on color alone. The 220px cards show reported context/runtime/branch—not guessed
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
adopted over an explicit selection. Failures retain an explicitly stale last
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
focus trap, Esc/backdrop close, the `spawn.submit` binding and the terminal
handoff). Souls come from the kernel's spawn catalog (`oats souls --json` via
`GET /api/agents`), never from the roster. The chooser is grouped by source
(alphabetical, externals last) and keyed by `agentsRoot + name + server`;
switching soul keeps the typed name and instruction.

Main form, in order: **Name** (the `<soul>-` prefix plus a purpose, with the
kernel's final name shown below; when the CLI advertises `spawn-name`, a
**Prefix with the soul name** switch sends `--name` instead of `--purpose`),
**Runtime** and **Model** (always visible, showing the kernel's real defaults
with a *default* pill), **Relationship** (None / Child of / Sibling of /
Parent of; choosing one reveals the instance picker) and the **Opening
instruction**. **Developer settings** is collapsed: work area (base | branch,
the worktree path relative to the deployment, *Use a worktree instead* for
checkout souls), permissions, launch configuration, session backend, Run on
and the wake schedule. The footer (Cancel, Spawn ⌘↵) is sticky.

Every value shown is the kernel's own preview: the dialog reads
`POST /api/workspace-spawn-preview` in the background (debounced, one latest
intent, owner-checked on success and rejection) and never resolves a default
itself. **Spawn** is one click: prepare → the server checks the prepared
decision still matches what was shown → apply with the bound revision and key.
If the kernel decided differently at Spawn time nothing is applied and the
dialog shows the new values for review. An unknown outcome offers **Check
result** on the same intent. A completed receipt hands off to the terminal
only after an exact composite roster match; partial wake results stay
created with **View schedules**. Execution-server spawns (Run on, or a remote
soul) use the host's own defaults and naming. The `spawn.submit` chord hint
lives on `data-chord`, not `data-shortcut`, so the shell's shortcut titling
never hides the Spawn button.

Problems read as one plain sentence about what happened and what to do
(`spawn-messages.mjs`, keyed by the contract's stable code). The code and the
technical or kernel text — paths, hashes, the `git clone` remedy — stay
behind a **Details** toggle and in `data-code`; no decision depends on wording.

Model suggestions are advisory (`/api/models`), custom entries stay valid, and
a remote target never borrows local model/configuration facts. No capability
or readiness facts appear in this dialog; soul readiness belongs to the soul
inspector.

## Souls: negotiated declarations, not launch readiness

The existing on-demand `POST /api/capabilities` inspect action carries K4 from
OATS 0.24.7+. `soul-declarations.mjs` consumes **`soulsApi === 1`**, never a
version guess, YAML parser or source-repository scanner. The selected soul must
match exactly one reported name + agents root inside the workspace-owned request;
instance snapshots do not become current soul declarations.

The inspector renders the soul's own `requires`, `defaults`, `knowledge`, `teams`
and `resources`, plus recorded provenance, exact revisions and declaration
problems. Null provenance is **Unrecorded**, not Local. Explicit null declarations
are **Not declared** only with clean declaration diagnostics; unreadable/missing
facts remain **Not reported**. Requirements retain independent installation,
executable approval, activation and version observations from the same CLI
payload. **Sources installed is not Ready**, launchability, adoption, enrolment
or a verified signature. Existing launch and editable-field gates are unchanged;
this does not add a declarations editor or widen file access.

These additions reuse existing inspection lifetimes and latest-intent guards;
there is no per-card request fan-out or polling inspection command. Routine
roster/CLI polls preserve the settled Sources DOM and text selection. Explicit
refresh/filter/scope changes own new projections; stale successes and rejections
cannot overwrite current observations. Native visual acceptance is not inferred
from the DOM/CSSOM and computed-token AA tests.

## Workspace view on workspace model v2 — Capabilities, Sources, sync (F2)

Every fact comes from the installed kernel; the Desktop parses no deployment
file and resolves nothing itself (`workspace-discovery.mjs`, `workspace-catalog.mjs`,
`workspace-sync-view.mjs`, server `server/workspace-sync.mjs`, `workspace-cli.mjs`).
Gate: `version --json` advertises `workspace-v2` with `workspaceApi: 2`; a remote
workspace is observed through its server and never synced from here.

- **Capabilities** is `oats capabilities --dir <deployment> --json`
  (capabilitiesApi 1), read on demand via `POST /api/workspace-sync?ws=<id>`
  `{action:"read"}` when the tab opens (and after a sync, or Refresh). The
  design table: *Capability* (name; `Member · <repo> · <team>` /
  `Package · <id> v<version>` / `External · <origin>`), *Status* (package:
  locked + approved/approval needed; member: confirmed; the commit; "N instances
  behind" only from the roster's own `moved` module rows) and *Used by* (souls
  whose instances record the module). No Members list here. **Team** and
  **Source** pill groups filter locally (AND); pills name only what the rows
  hold — member repositories first, then packages (non-collapse rule: a
  member's `publishes` never absorbs its package's capabilities).
- **Sources** renders the roster observation's `oats workspace status`:
  repositories (team, confirmation status + the kernel's detail), packages
  (lock, approval, capabilities) and external souls. No extra read.
- **Notes** keep the F1 guards visible: an unreachable workspace (module drift
  not current), withheld instance rows, unsynced/stale declarations and
  workspace problems, each in the kernel's own terms.
- **Sync** (header) runs `oats sync --json`; exit 2 with ok:true is "lock
  written, approvals pending" and opens the approval sheet. Each row shows id,
  version, commit, the full `executables` digest and `targets`; nothing is
  selected by default. Approve sends `{action:"approve", approvals:[{id,
  version, executables}]}`; the server admits it only when every row EXACTLY
  matches the latest sync report it holds for that deployment and CLI, then runs
  `oats sync --approve <id>@<version>…` (the version verbatim). Otherwise
  `E_APPROVAL_STALE`. One mutation per deployment (`E_SYNC_BUSY`). Refusals —
  `E_PACKAGE_INTEGRITY`, lock drift, `E_BAD_ARGS` — are shown as code: message,
  verbatim. The roster refreshes after a sync.
- **Onboarding** (Add workspace → Browse…): a picked folder without
  `oats-local.yaml` gets a single-use offer bound to its canonical path; the
  operator types the workspace repository and main runs `oats onboard <dir>
  --workspace <ref> --json`, then the ordinary transactional add. A refused ref
  gets a fresh offer for the same folder; `rolledBack` is reported.

All awaited reads and mutations carry latest-intent ownership (request serial +
workspace generation) checked on success and rejection, mutation-verified in
`workspace-v2-view.test.mjs`. Fixtures are kernel captures
(`test/fixtures/workspace-v2/f2`, with provenance).

## Keybindings (shell-level)

- **Mod+F** reveals the sidebar and focuses the instance filter; **Mod+N** opens
  Workspace's soul chooser, never automatically spawning an instance. Visible
  hints and tooltips follow the effective bindings (including explicit unbinds).
  Existing user overrides are retained. On Linux/Windows, Ctrl+F/Ctrl+N inside
  the terminal still belong to the attached program; macOS uses Cmd+F/Cmd+N.

- **keybindings.mjs** — the keymap engine: action registry
  (`registerAction`/`setActiveContexts`; a registration may carry a
  `defaultChord` that folds into the effective keymap like a
  `DEFAULT_KEYMAP` entry — override wins, explicit unbind kills it),
  `DEFAULT_KEYMAP`, user overrides
  persisted under `localStorage["oats-desktop-keymap"]`, chord
  parse/format/match, and dispatch (`matchEvent`/`handleKeydown`). The engine
  skips already-consumed (`defaultPrevented`) events, and unmodified/
  shift-only chords never fire while an editable field (input, textarea,
  select, contenteditable) has focus. Terminal
  policy: inside `.xterm`, on macOS only ⌘-resolved chords fire; on
  Linux/Windows only `TERMINAL_ALLOWLIST` action ids (palette, tab
  next/prev/close) may fire — all other Ctrl chords belong to the attached
  program. `app.quickOpenSouls` (Mod+P) is deliberately NOT allowlisted:
  ⌘P fires inside xterm on macOS via the ⌘-chord policy, but Ctrl+P inside
  xterm on Linux/Windows is the shell's history navigation and reaches the
  pty.
- **overlay-picker.mjs** — the shared overlay + fuzzy machinery behind the
  command palette and Quick Open: one input over a listbox
  (arrows/Enter/Esc, aria option pattern), the house subsequence scorer
  (`subsequenceScore`; `null` = no match — prefix bonuses make real scores
  negative), and the stale-load generation guard.
- **quick-open.mjs** — Quick Open for souls (`Mod+P`, also “Souls: quick
  open…” in the palette): fuzzy-find a soul from the Spawn view's data
  source and hand off to soul inspection through `views/spawn.mjs`
  `preselectSoul()`. Inspection does not launch an instance or open the Spawn
  dialog; **Launch…** is a separate explicit action. Attached-only and CLI
  pending/unavailable states remain visible through the existing view. No
  second spawn form exists.
- **keybindings-editor.mjs** — the shortcuts editor dialog (`Mod+,`):
  actions grouped by context, click-to-record (Esc cancels, Backspace
  unbinds), conflict warnings via `findConflict`, per-row reset + reset-all.

## Shared Components — existing-data frame 10 parity

`notifications.mjs` replaces the roster-prepended `ctx.notify` notices with one
renderer-only, viewport-bounded scroll stack. Messages are literal text, not inferred severity/activity,
links or action callbacks. There are at most three cards; capacity eviction skips
the focused card. **No expiry timer**: dismissal is explicit, while a workspace
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

## Context panel and focus mode

The shell owns one right-side **Details** region outside all editor groups.
A selected terminal shows reported Instance / Soul metadata. Its **Git & GitHub**
tab uses the qualified K1 CLI read boundary for worktree/branch/changes and a
bounded unified diff; the GitHub/PR card remains unavailable pending P1 (no
inferred PRs or checks). Empty groups and file/brain tabs do not inherit another
terminal's context. Roster refresh matches the exact
workspace/terminal identity and never selects or focuses a panel; a missing or
ambiguous observation makes session state unknown.

Workspace projects its actual selected-soul inspector into that same region.
Workspace still owns its requests and lifetime. Collapse or covering the
stage with a terminal preserves the inspector's DOM, local disclosure state and
in-flight content; a late response cannot reclaim foreground visibility. True stage unmount
or workspace reset ends that selection. Standalone view hosts keep the inline
inspector fallback.

**Details** collapses/restores the region. **Focus mode** hides the sidebar and
right panel without closing tabs or changing split weights. Its footer control
stays visible as an exit; exit restores the existing sidebar/panel preferences.
Mod+F leaves focus mode to reveal the filter. Panel collapse and selected tab are
session-local per workspace; focus mode is a temporary presentation override.
Both actions are palette/editor-visible with no new default shortcuts. Native
terminal input and per-window lifecycle policies are unchanged.

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

**Close split** explicitly joins back to the flat strip. **Split: return to terminal
groups** in the palette restores a covered layout, including an all-empty one.
There is no new default shortcut. Clickable controls mirror the chords with no duplicated
logic: the split buttons and the sidebar toggles (rail-footer button + the
thin `#sidebar-restore` edge button shown while hidden) all dispatch the
registered actions through `runAction(id)` — context-gated exactly like
chord dispatch — and their enablement dry-runs the same model transition
via `split-controls.mjs` `splitControlsState`. One chrome per tab means the
tab-a11y roving/aria/close semantics hold PER GROUP (each group strip is a
tablist with a single selected, tabbable trigger; arrows walk the group).

### Workspace-local tab memory

`workspace-tab-memory.mjs` retains each workspace's group membership/order,
orientation, proportions, selected tabs and focused group for the current app
session. Workspace switches hide all outgoing panes synchronously and park their
DOM nodes before restoring the destination layout; existing terminal attachments
are retained, not recreated. Empty layouts and their focused destinations are
remembered too; only a workspace with neither open tabs nor a retained layout
falls back to the stage. Restart restoration of tab layouts is not implemented yet.

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

The agent-facing CLI command is **not implemented**; see the
[proposed delivery contract](../docs/desktop-file-opening-contract.md).

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
