# Frame 10A — remaining non-dialog components

This slice uses existing renderer state and existing K1/P1/terminal/spawn paths.
It adds **no main/preload IPC, HTTP endpoint, kernel/CLI command, OS/editor launch,
workspace mutation or terminal window**. It follows disposition06c89787.

## Context rail

The collapsed context panel is44px wide. Instance, Git & GitHub, Soul and Expand
are native controls with labels, keyboard toolbar navigation and existing theme
tokens. Selecting a section expands the existing page. Knowledge and Tasks are
absent, not disabled placeholders. Stage-attached inspectors retain their real
DOM/leases/drafts and get Expand, not a fabricated instance context.

A Git changes dot means **changes in the last accepted K1 observation**, not
waiting-for-human, a PR, health or a live filesystem watch. Its owner includes
workspace/tab key/home/root/agent/server/reported incarnation and connection
epoch. Invalidated, unknown or foreign observations cannot light it. Collapsing
preserves a qualified summary but starts no read. Explicitly opening Git uses its
existing visible-reader path. Connection/reincarnation changes revoke both
completion paths and the summary; no automatic connection-driven Git read was
added. User rail/tab navigation participates in shell selection intent; passive
metadata updates do not restore focus.

## Instance menu

The menu retains existing inspect, Start/Restart and plan-backed Stop/Remove
controllers. New actions are registered as `instance.openSplit` and
`instance.openPullRequest`, scoped to an **open, owned, focused instance menu**.
There is no new default chord. Mouse and keyboard invoke the same guarded action;
hints use the live registered keymap. No new action is terminal-allowlisted and
no terminal Ctrl byte is intercepted. Context, DOM membership, visibility and
pending keys include workspace/composite identity/reported birth. Both successful
and rejected old actions lose UI authority; a stale action cannot unlock a
successor workspace's control.

### Open in split

The action plans a destination using the existing split model, without changing
layout during the roster/key-cleanup waits. The exact instance is freshly
resolved before tab dedupe and checked against its captured identity. Selection,
connection, caller lifetime and the layout fingerprint must still match before
committing a destination.

An already-open target **moves into the selected/new empty group**, retaining
its existing terminal/PTY; it is not opened twice. Source-group survivors and
empty groups remain. New targets use the existing bounded terminal attach path.
Existing orientation and group caps remain. A hidden terminal layer, no source,
unselected existing empty group, changed layout, unknown identity or missing
live terminal yields a precise unavailable/refusal state, not an arbitrary first
workspace/group/instance. Closing UI remains detach-only.

### Open pull request

One explicit user action performs existing K1 then P1 reads for the exact local
target. No roster-row polling and no guessed repository/branch/PR number. K1
scope/home/root identity, observation key and parsed state are checked; the P1
target/key/revision/branch and projected URL/number must match before requesting
external open. No PR, not connected and unavailable remain different outcomes.
No sign-in, token lookup or remote-to-local fallback is introduced.

The callback checks latest user intent, target/incarnation, workspace generation
and connection on both outcomes, and copies its request subject before awaiting.
The external-open request uses the existing URL mechanism; it is not a claim
that an OS browser actually opened successfully.

## Workspace switcher

Rows use stable decorative workspace marks, selected checks, qualified labels,
paths and only reported team/server metadata. No invented instance counts or
online/offline state. Search and none-reported/no-match messages remain. The
existing provenance/native-picker-gated add transaction is untouched.

The label is **Add local workspace…**. There is **no Join or Manage control**.
K11 is outside this slice, not advertised as a coming feature. Registry
forget/removal semantics are with the human; add/switch remain the existing
management surface. `Mod+,` still belongs to Shortcuts.

## Receipt-backed Open notification

The existing max3 explicit-dismissal notification stack keeps literal text,
polite announcements, focused-card eviction protection and focus-neutral arrival.
Its only action descriptor is inert data:

```
{kind:"open-instance", target:{workspace,instance,agent,agentsRoot,home,server,
 incarnation}, connectionEpoch}
```

Unknown fields, command/IPC/executable/URI strings in the descriptor, missing
incarnation or mismatched scope/connection do not create an action. A separate
renderer callback owns execution; the descriptor is not a command and crosses no
new IPC boundary. It is copied before use.

A successful spawn can publish Open after the existing readiness observation
has supplied one exact admitted roster row with a reported birth. Guarded APPLY
and legacy completion check connection ownership; partial/unknown/unqualified
results cannot create an actionable guess. Readiness polling is the existing
post-spawn handoff, not a new notification watcher. The click freshly re-resolves
that exact home/root/name/server and checks the incarnation in the existing
terminal-opening flow. Removed/reinserted cards, scope/connection changes,
hidden/disposed owners and overlapping action intents revoke old callbacks on
both outcomes. No message parsing, branch-renamed synthesis, Logs action,
transcript access or lifecycle mutation is added.

## Verification and next boundary

Tests execute actual renderer components and shipped shell/menu/spawn functions
with inert DOM, API, xterm and IPC recorders. They cover composite identity,
reincarnation, both stale outcomes, duplicate prevention, layout preservation,
keyboard contexts/rebinding, theme contrast and notification custody. Guard
mutations use in-memory module/source substitutions; repository bytes remain
unchanged. Full Desktop +focused suites are local; seven root gates remain PR CI.

These are **not** native Electron, PTY/tmux, external-browser or visual acceptance
receipts. Native CDP plus exact tmux before/after checks remain maintainer-owned.

Next, separately: propose10B-0 terminal owner leases (HIGH), then the closed
Code/Cursor/Zed +reveal editor boundary, then a MOVE-viewer detach transaction.
No terminal-owner security fix or detach/editor UI is silently bundled into10A.
The PTY is main-owned; parsed xterm screen/scrollback is renderer state and needs
explicit custody in that later transaction. Those actions remain real parity
gaps, not permanent exclusions or completed work.
