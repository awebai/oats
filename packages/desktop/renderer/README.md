# oats desktop — renderer views (webpanel-dev)

Ports of the retired browser panel's functionality as desktop renderer views,
per the desktop-app contract: each view is a plain ES module exporting
`mount(el, ctx)` / `unmount()`, where `ctx = { api(pathname, opts),
openFile(path), openTerminal(instance) }` is provided by the shell.
No frameworks, no dependencies; data comes from the bundled backend HTTP API.

## Views (`views/`)

- **spawn.mjs** — **Workspace**, with Souls / Capabilities / Sources subtabs.
  Souls come from `GET /api/agents`; selection opens the side inspector. Explicit
  **Launch…** opens Spawn (`POST /api/spawn`), with purpose/task fields and
  inherited CLI defaults, not launch-configuration controls. An empty task waits
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
  the newer inventory/catalog surfaces. Sources retains its existing read-only
  provenance projection; portable soul enumeration waits for the kernel K4 DTO.

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

## Context panel and focus mode

The shell owns one right-side **Details** region outside all editor groups.
A selected terminal shows reported Instance / Soul metadata; Git & GitHub is a
clearly unavailable integration in this slice, awaiting its qualified CLI/provider
contracts (no inferred zero changes, PRs or checks). Empty groups and file/brain
tabs do not inherit another terminal's context. Roster refresh matches the exact
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
