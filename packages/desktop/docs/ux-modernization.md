# Desktop UX modernization — audit and delivery plan

Status: proposed design direction; workspace correctness and read-only file-viewing
increments implemented on the Desktop branch. Workflow reviews and partial browser
verification completed; broader UX work and real Electron/PTY verification remain.
Owner: Desktop engineering. Visual/interaction sign-off: ux-designer.

## Product brief

OATS Desktop should be the everyday place to work with OATS: durable souls,
related disposable instances, and real runtime terminals. Improve that workflow
before pursuing competitor feature parity. The maintainer's September 13 request
prioritizes polish, simpler spawning, scoped Pi models, readable relationships,
controllable panels, workspace memory, and mouse-free instance switching.

This extends the existing [UX plan](../../../docs/design/desktop-ux-plan.md).
It does not replace the soul/instance model or move lifecycle logic into Desktop.

## Audit evidence

Window-specific screenshots were captured locally on September 13, 2026 (not
committed: they contain live workspace content). OATS was showing its light-theme
terminal workspace; ORCA was showing its empty-project screen. ORCA supports a
visual comparison of aligned chrome, consistent iconography, generous row spacing,
and visible shortcut hints. Its working-session/panel behavior has **not** been
verified; no projects or agents were created in ORCA for this audit.

Code findings:

- `renderer/shell.mjs` explicitly resets `split = null` on workspace changes.
  Only the most recently active terminal is remembered, not the workspace layout.
- `workspace-tabs.mjs` scopes terminals but not brain/file artifacts; the brain
  view subscribes to the global workspace and changes content under the same tab.
- `split-resize.mjs` stores proportions in DOM styles only, so hiding a split
  behind an artifact destroys its remembered sizes.
- Groups have independent tab lists, but the shell offers no general move/reorder
  control. Only a newly opened terminal or an explicit empty-group fill can move.
  Splits are terminal-only, flat rows/columns, capped at four groups.
- Sidebar clustering already consumes `parentInstance` and `siblingInstance`.
  Multi-member clusters intentionally have invisible separators. This is a
  presentation/discoverability problem to review, not a reason to invent lineage.
- Spawn exposes relation, runtime, backend, permissions, model, launch
  configurations, execution server, and scheduling in one flow. These deserve
  progressive disclosure rather than being prerequisite decisions.
- Pi suggestions currently come from `pi --list-models`, not an explicit scoped
  model seam. Runtime/model preferences remain advisory at the CLI boundary.
- Existing palette, shortcuts engine, overlay picker, semantic themes and
  contrast tests are foundations to reuse, not parallel systems to replace.

## Delivery sequence

### 1. Workspace and panel correctness (engineering first)

- Give each workspace its own open-tab selection and split state.
- Hide all foreign workspace tabs and panes synchronously, before any fetch.
- Restore group membership, order, selected tabs, focused group, orientation and
  sizes on A → B → A, retaining existing terminal attachments rather than
  duplicating viewers or killing sessions.
- Pin artifact content to its owning workspace; discard stale opens on both
  success and rejection, including A → B → A races.
- First increment: memory within the current app session. Restart restoration is
  separate: persist validated descriptors, never runtime handles or credentials;
  re-resolve instances and mark stale/missing targets without silently attaching.

Acceptance: two workspaces with same-named instances/files; independent layouts;
empty destination; switching during delayed/rejected loads; close and switch-back;
resize then cover/uncover; no foreign pane visible or eligible for activation.

### 2. Deliberate editor-group control

Proposed interaction contract for UX review:

- Every group has stable, aligned chrome and a clear focused state.
- Reorder tabs within a group; move tabs between any groups (not only empty ones).
- Pointer drag/drop plus equivalent named commands and keyboard operation.
- Split right/down, focus adjacent group, move active tab, close group, join groups.
  Closing UI tabs/groups must never mean retiring an instance.
- Files and brains can sit alongside terminals. Generalized nested layouts should
  replace the flat orientation switch only after reviewing the interaction model.
- Empty groups are explicit destinations with an accessible picker, not dead space.

Acceptance: no extra PTY on moves; no detached live panes lost by DOM projection;
correct close successor and focus; no input redirected by layout changes; keyboard
and pointer produce the same model transitions. CDP plus tmux before/after checks.

### 3. Shared controls and shell alignment (UX-led)

- Inventory dropdowns: workspace, instance actions, spawn, runtime/model, relation,
  server and brain selectors. Use one accessible popover/listbox vocabulary where
  custom behavior is justified; don't replace native semantics with styled divs.
- Shared control heights, padding, icon sizes, focus/hover/disabled states, menu
  alignment, collision handling, long-label truncation and escape/focus return.
- Align workspace header, flat/group tab strips and view toolbars to one rhythm.
- Consistent monochrome icon set; bundled provider logos with text labels and a
  neutral fallback. Logos must not be required to identify an option.
- Preserve semantic tokens, both themes, reduced motion, and AA computed contrast.

Acceptance: light/dark screenshots at compact and large window sizes, 200% zoom,
long names, keyboard-only menus, screen-reader labels, no focus loss on polling.

### 4. Calmer, relation-aware instance sidebar (UX-led)

- Keep souls/instances—not runtime brands—as the main identity.
- Increase legibility without turning each row into a card full of metadata.
- Primary name + restrained secondary context; keep actions discoverable on focus
  as well as hover. Remove redundant start buttons/chips only with design review.
- Make related roots/siblings visibly belong together without implying parentage.
  Reuse identity-safe connected components; ambiguous links remain unresolved.
- Preserve filter, tree navigation, collapse state and focus across roster updates.

Acceptance: unrelated roots, root siblings, children/shared-parent siblings, missing
anchors, duplicate names across roots/workspaces, deep trees and crowded rosters.

### 5. Simple soul spawning and scoped model suggestions

Proposed default flow: choose soul → optional task → Spawn. Show the effective
runtime/model as a compact summary with an override affordance. Keep launch
configuration **management out of the spawn dialog**; do not delete or change
existing CLI configuration semantics as a side effect of simplifying the UI.

- Only reveal relations/execution location/scheduling when relevant or requested.
- Pi's normal picker must offer only scoped models, grouped/labeled by provider,
  with search and bundled logos. Define “scoped” against Pi's actual settings/API
  before implementing; an all-authenticated-model catalog is not equivalent.
- Preserve valid configured defaults and preference lists without silently
  rewriting them. Any custom preference escape hatch needs maintainer/UX agreement;
  it must not turn the normal picker back into an unbounded model list.
- Empty/unavailable scope gets an explanatory state, not an implicit global fallback.
- Coordinate any CLI/settings seam with cli-dev; no new privileged endpoints,
  config readers or security-boundary changes without coordinator approval.
- Preserve observation-only mode without a compatible installed OATS CLI; loading
  model suggestions must never block observing souls or accidentally start work.

Acceptance: no task, inherited defaults, runtime switch races, missing scoped
model/provider, unavailable Pi/CLI, remote execution, inherited launch configuration,
attached souls and invalid relation targets. No launch occurs just by selecting.

### 6. Keyboard-first everyday operation

- Fast instance picker with recent/current-workspace ordering.
- Next/previous instance, previous active instance, focus/move between groups,
  workspace switcher, tab reorder/move, and focus terminal all in the command map.
- Surface shortcut hints in menus and empty states; keep bindings configurable.
- Translate herdr/tmux navigation *intent* into Desktop actions. Do not send
  select-window commands into locked viewers or consume terminal control bytes.
- Keep Ctrl-B and normal shell/runtime editing keys intact; platform-specific
  defaults require terminal passthrough and conflict tests.

## Verification and review gates

Each increment needs model + shipped-layer DOM tests, controlled async races
(success AND rejection, mutation-verified), renderer syntax, full Desktop tests,
and root gates: `npm test`, `npm run check`, `npm run check:pi`,
`npm run validate`, `npm run validate:okf`, `npm run pack:check`,
`npm run smoke:tarball`.

Visual work needs UX review and before/after evidence. Terminal/panel work also
needs live CDP verification with exact tmux target/window state before and after.
Do not launch packaged-app smoke on the operator machine or manipulate an existing
operator app/session to obtain evidence. Use an explicitly coordinated development
app and disposable targets. Missing live evidence must be reported, not inferred
from passing DOM tests.

## First increment — verification record

Implemented: session-local workspace layout/selection memory; synchronous foreign
pane hiding; workspace-scoped file/brain tabs and keys; independent pinned brain
mounts; model-owned resize proportions; latest-intent/workspace-generation guards
for tab opens. General tab moves, nested splits, restart persistence and visual
changes are not part of this increment.

- Desktop suite: **480 passed** (including shipped-shell transition/race tests).
- Mutation checks: removing workspace generations, latest-open ownership, or brain
  selection generations causes the corresponding success/rejection tests to fail.
- Renderer syntax, contrast inventory, Electron node-pty rebuild: passed.
- Root check, check:pi, validate, validate:okf, pack:check, smoke:tarball: passed.
- Latest full root tests: 1,466 passed, 4 failed, 1 skipped. Failures are in the unchanged
  CLI JSON/harvest, remote server, session restart and session start suites. A
  sequential recheck with instance environment variables removed fixed the harvest
  case but still failed in server/start/restart tests (43/48 passed). These need
  CLI/coordinator investigation; no kernel or test-environment repair is included.
- Live CDP/tmux verification: **pending**. The operator's running app has no CDP
  listener; it was neither restarted nor replaced. Passing DOM tests is not a
  substitute for live terminal evidence.

## Second increment — dynamic workflow implementation and browser evidence

The user explicitly requested dynamic workflows, clarified that ORCA is a UI
reference rather than a product model, and requested supporting read-only file
tabs plus a future agent-facing CLI open command.

Implemented in this increment:

- Removed all launch-configuration UI/bindings from **Spawn** while retaining
  CLI-owned inheritance, explicit non-configuration overrides and empty tasks.
  Start/Restart configuration behavior is unchanged. The remaining Spawn fields
  are not yet the proposed task-only/progressive-disclosure redesign.
- Added **File: open read-only… / Mod+O**, a native browser File chooser feeding
  ordinary workspace-scoped Markdown/code tabs. No file editor, file sidebar,
  new IPC/endpoint, filesystem writes or basename-based identity guessing.
- Added visible syntax colors using existing semantic tokens and contrast tests
  against the composited Markdown code-block background.
- Unified explicit selection/focus ownership across tab, pane, cycle, close,
  sidebar and deferred attachment paths. Picker handoffs retain one modal and
  recover logical focus after roster DOM replacement.
- Fixed identity-safe ancestry guides, file-restoration navigation projection,
  and compressed tab chrome using the existing scrollable-strip behavior.
- Made the Souls toolbar wrap after a live narrow-width overflow observation.
  This last CSS correction is unit-tested but **not recaptured in the browser**.

Verification of the current increment:

- **834 Desktop tests passed** after the final picker-to-shortcuts handoff fix;
  renderer syntax and AA inventory included.
- Root check/check:pi/validate/validate:okf/pack:check/smoke:tarball passed.
- Last full root run (before that final handoff-only follow-up): **1,818 passed,
  5 failed, 1 skipped**. Failures remain in the
  unchanged CLI JSON/harvest, remote-server and session start/restart suites.
- Two live runs used the real renderer and existing dev harness with synthetic
  roster/CLI/terminal bridges, plus a real confined read-only backend observation.
  The corrected run captured **29 screenshots**, including actual Spawn dialogs
  in both themes, native File objects, syntax colors, keyboard focus and A/B
  workspace layouts. It is **not real Electron/PTY/tmux verification**.
- Corrected run: 446/448 assertions passed, 13/15 scenarios completed. Two narrow
  toolbar checks failed before the CSS follow-up; narrow-tab scenarios also hit a
  driver-side `innerWidth` error. DPR/viewport reflow is not native 200% zoom.
- The apparent terminal nav highlight in the first run was diagnosed as **hover**,
  not active selection. A separate file-restoration highlight bug was reproduced
  and fixed; no blanket asynchronous nav reset was added.
- Capture environment incident: isolated Google Chrome launched its updater,
  which recorded host updater-directory writes and an external update-service
  POST despite isolation flags. Owned capture processes were reaped; operator
  process identities remained present. No host repair was attempted. Further
  browser runs are on hold pending containment review. Renderer/API mutation
  attempts were zero, which does not imply host-wide containment.

Private screenshots, driver scripts, measurements, logs, source hashes and cleanup
records remain under instance-home `artifacts/desktop-ux/`, not in the package.
See `live-corrected/REPORT.md` and `live-corrected/runs/run-NSLJ4n/REPORT.md` there.

Still not implemented: generalized tab moves/nested or mixed-content splits,
restart layout persistence, scoped Pi/provider picker, broad dropdown/sidebar
redesign, and external CLI file-open delivery. The latter has a separate
[proposed boundary](desktop-file-opening-contract.md), not an executable command.

## Reported split reopen and crowded-roster correction

The user's real-app sequence (open terminal → split → close terminal tab → select
empty destination → reopen instance) failed with both one and several initial
tabs. Closing discarded an empty layout or fallback selection pulled focus back
to the source group; empty cells had no independent selection handler.

The correction makes panels persist until explicit **Close split**. Every empty
panel has a stable focusable placeholder, selecting it sets the focused group and
clears the globally active tab, and reopening uses that destination. Existing
terminal tabs can fill an empty panel without creating another PTY. Empty panels,
proportions and selection survive workspace/stage round-trips; a palette action
returns to a covered terminal layout without adding a new default shortcut.

The sidebar now has 56px minimum auto-height rows, 48px minimum auto-height
instance controls, 4px internal/gap spacing and 8px filter separation. Guide elbows
track row centers instead of the former fixed offset. Typography scale, identity,
menus and semantic colors are unchanged; fixed-height label clipping is removed.
The selected group uses an existing-accent inset outline.

- **857/857 Desktop tests pass**, including exact shipped-shell reproductions,
  stale success/rejection, cleanup, empty controls, workspace recall and AA checks.
- Root gates check/check:pi/validate/validate:okf/pack:check/smoke:tarball pass.
- Full root run: **1,843 passed, 4 failed, 1 skipped**; failures remain in unchanged
  CLI JSON/harvest, servers, session-restart and session-start suites.
- Workflow integration review found no concrete blockers. This correction has
  not yet been exercised through native CDP/tmux or recaptured in screenshots.
- Both the main-checkout and isolated Development app/server remain running;
  permission to reload only the Development window was requested.

## Coordination needed

The user declined enlisting new OATS agents and authorized dynamic workflows.
Independent workflow audits/reviews have been used; no OATS instances or messaging
configuration were created. Role-owned new UX decisions and privileged/CLI changes
remain proposals requiring their prescribed review; explicit requirements and
existing-contract correctness work have proceeded. Aweb/OKF integration is absent
here. Do not repair infrastructure or bypass those boundaries to fill the gaps.
