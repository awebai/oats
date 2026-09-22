# oats desktop — renderer views (webpanel-dev)

Ports of the retired browser panel's functionality as desktop renderer views,
per the desktop-app contract: each view is a plain ES module exporting
`mount(el, ctx)` / `unmount()`, where `ctx = { api(pathname, opts),
openFile(path), openTerminal(instance) }` is provided by the shell.
No frameworks, no dependencies; data comes from the bundled backend HTTP API.

## Views (`views/`)

- **spawn.mjs** — **Workspace**, with Souls / Capabilities / Sources subtabs.
  Souls come from `GET /api/agents`; selection opens the side inspector. Explicit
  **Launch…** opens the two-column Spawn modal (`POST /api/spawn`), with a
  source/context-grouped soul chooser and inherited CLI defaults. Named launch
  configuration selection/read-only preview is restored on the existing seam.
  An empty opening instruction waits for instructions; attached-mode souls
  cannot launch standalone. The shell's
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

## Spawn modal — slice 6a, existing seams only

Frame 02 uses an 860px responsive dialog, 320px soul chooser, 52px header and
independently scrollable chooser/configuration columns. The chooser uses reported
context labels with disambiguating root suffixes, and keys selection by
`agentsRoot + name + server`. Selecting another soul creates a new modal owner;
opening-instruction/purpose/search drafts survive, but named configurations and
runtime/model overrides do not silently cross scopes. Roster polls retain the
form; a vanished or ambiguous exact soul cannot be submitted.

`spawn-dialog.mjs` composes the actual existing fields, not copies. **More options**
is expanded by default and preserves purpose, relationship + anchored root,
execution server, backend, permission choice and wake schedule. The opening
instruction remains a normal multiline textarea. Provider/model popups consume
selection keys and Escape before the dialog. A modal-local, engine-owned
`spawn.submit` binding defaults to **Mod+Enter**, with rebind/unbind-aware hints,
IME/composition/229, repeat, consumed-event, owner and in-flight guards. It adds
no terminal shortcut interception. Ordinary Enter never submits the launch.

`spawn-launch.mjs` reads only existing scoped launch-config **list/preview** and
capability **inspect** routes. There is no configuration editor or set/remove
operation in this modal. `launchConfig` is forwarded through the already-supported
server-gated Spawn property only when explicitly selected. A failed/foreign list
never authorizes a named choice. Lists and previews have separate feedback,
retries and request ownership; a late list cannot overwrite/replay a newer model
preview. Preview success is not launch readiness or a reservation.

Provider choices use `/api/cli`'s runtime list. The additive Desktop diagnostics
field `runtimesSource: "reported" | "assumed"` distinguishes actual CLI reports
from the existing legacy `pi`/`claude` fallback. Fallbacks are labeled assumed;
an older Desktop response without provenance says so. Support lists never prove
runtime installation, version or executable approval. Model suggestions remain
advisory and local-only; custom entries remain valid. A remote execution target
never borrows local model/configuration/inspection facts. An explicitly selected
remote soul needs its registered execution workspace and negotiated read support.

The default model choice is **Use resolved defaults**: empty values are omitted,
not transformed into an override. The displayed model and `modelSource` come from
a qualified preview; **native default** is claimed only if reported. A true
force-native override is disabled until K6. No proposed model object is sent.

Installed/trusted counts describe only the exact, actually inspected capability
set, with unknown for incomplete/missing/foreign observations or an empty set.
Configured/enrolled remain **unknown**. No all-green or overall “Ready” verdict is
manufactured. Future work-area name/suggestion, canonical worktree path, base/new
branch, knowledge attachment/count, child-spawn authority and auto-PR controls
remain visible but disabled with their seam notes. No fake paths, `main` base,
node counts, child-policy defaults or K6 request fields are sent. These become
functional only in slice 6b after reviewed kernel/provider contracts land.

## Souls and Sources: negotiated declarations, not launch readiness

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

Sources renders `result.sources` only when its own `soulsApi` marker is1:
`recorded-provenance` lists the recorded source addresses, revisions, payload
paths, workspace revisions and reported soul names; `none-recorded` explicitly
reports that no portable source address is recorded. It does not imply that all
souls are authored locally: a packaged definition can record its origin kind
without recording a source address. Malformed v1 is unavailable, not an empty
inventory or silent legacy fallback. Older/unnegotiated CLIs keep the separately
labeled capability-origin rows and their “reported” count, not a portable-source
count. Source paths/URLs/names are inert text, never links, file-open authority,
import/install actions, inferred memberships or name-only action targets.

These additions reuse existing inspection lifetimes and latest-intent guards;
there is no per-card request fan-out or polling inspection command. Routine
roster/CLI polls preserve the settled Sources DOM and text selection. Explicit
refresh/filter/scope changes own new projections; stale successes and rejections
cannot overwrite current observations. Native visual acceptance is not inferred
from the DOM/CSSOM and computed-token AA tests.

## Capabilities: three independent observations

Workspace's Capabilities tab keeps these separately qualified surfaces:

- **Local CLI catalog** (`official-catalog.mjs`): read-only `POST /api/catalog`
  with `{}` and no query arguments. The backend invokes only the discovered,
  accepted local CLI's `catalog --json`, with an additional released-version
  floor of **0.24.6**. The catalog remains explicitly local even when a remote
  workspace is selected. A bundled official snapshot and an operator override
  are distinguished; neither establishes acquisition, executable approval,
  verified signatures, export inventory or readiness. Catalog tags remain refs,
  not inferred versions; aliases remain mappings, not complete exports.
- **Classic deployment inventory** (`deployment-inventory.mjs`): read-only
  `POST /api/capabilities?ws=<id>` with `{action:"list",selector:{}}` or an exact
  admitted `{context}` selector. The server resolves the classic scope and uses
  only `list --dir <scope> --json`. No soul/home/captured-resolution selector or
  remote-to-local fallback is permitted. Packages, capability exports, health,
  integrity, executable approval and legacy lock reports retain their reported
  acquisition scopes. Same-named exports at different scopes remain separate;
  no package-level trust or bare-name join with catalog/activation is invented.
  Invalid locks (including unsupported captured locks) are errors, not an empty
  successful inventory. A compatible CLI is required; operations API support
  is not required for this list read.
- **Capability inspection**: the existing `inspect` action reports activation
  and scope/soul/home observations. It is not substituted for a failed inventory
  read. A compatible CLI change invalidates pending scope inspection as well as
  the newer inventory/catalog surfaces. Sources uses the negotiated K4 portable
  source context, or retains the older capability-origin projection when that
  contract is not negotiated (see below).

Catalog and list reads use bounded child execution (15 seconds, 4 MiB stdout),
fixed argv without a shell, and in-flight coalescing, never a persistent response
cache. The existing loopback Host/Origin and privileged sender-frame guards still
apply. The new read adapters refuse success envelopes from a failed process exit;
existing mutation exit semantics are unchanged. Catalog and capabilities bodies
are parsed as JSON objects with a 64 KiB byte limit; malformed/oversized requests
are rejected rather than silently converted to empty objects.

Each section degrades and retries independently. Roster polls do not refetch the
catalog/list or rebuild their controls; CLI, workspace and classic-scope changes
revoke pending ownership on **both** success and rejection. These are independent
CLI observations, not one atomic snapshot. K5 readiness is explicitly **Unknown**,
including configured/enrolled facts, verified signatures and enforced policy;
reported byte installation and executable approval are not readiness passes.

**Add/acquire is review/copy only.** The only copyable command is the catalog's
exact `['oats','install',package]` tuple, with literal POSIX shell quoting and
refusal of malformed/option-shaped/control-character arguments. URLs, refs and
extra arguments are never substituted into the command. Copying neither executes,
acquires nor trusts anything, and does not choose a workspace: the operator must
run it in the intended CLI context. Failed clipboard access leaves a selectable
command rather than claiming success. No new main/preload IPC, native auth,
filesystem access or Electron dependency is introduced.

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
probe the catalog, change the model or launch. Late owned catalog fills refresh
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
Workspace still owns its requests, editor and lifetime. Collapse or covering the
stage with a terminal preserves the inspector's DOM, unsaved values and in-flight
content; a late response cannot reclaim foreground visibility. True stage unmount
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
