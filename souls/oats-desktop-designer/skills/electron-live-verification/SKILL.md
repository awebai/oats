---
name: electron-live-verification
description: "Use when verifying OATS Desktop behavior that DOM tests cannot prove, including real terminal input, wheel scrollback, exact attachment, native integration or viewer cleanup."
---

# Live evidence requires owned native resources

## Admit a safe probe before launching

Confirm operator permission, tested source/artifact, host and runtime prerequisites, and exact cleanup ownership. Use a dedicated fixture workspace and isolated session backend. For tmux use a private socket through the supported saved-socket path; never run resource tests on the operator's default server. A separate Electron user-data profile alone does not isolate ports, tmux, processes or credentials.

Read the current `packages/desktop/package.json`, `main.mjs`, backend target modules and `scripts/dist-smoke.mjs` before choosing launch arguments. Record the exact argv and resource ledger. Do not invent a fixture flag or launch another application against live operator work. Bind any debugging endpoint to loopback with a dedicated port and close it afterwards; CDP is privileged control, not a public service.

## Prove the boundary

1. Record fixture source/viewer window and pane identity, host/socket, process IDs and baseline resource counts. Use only generated probe data.
2. Drive the rendered UI to the exact fixture instance. Use native input or CDP `Input.dispatchMouseEvent` for wheel events, not JavaScript-created DOM events. Locate the active terminal bounds before sending input.
3. Independently query the session owner. For tmux, record exact window/pane identity, copy mode, history and scroll position before/after wheel-up and wheel-down. Visual scrolling alone is insufficient.
4. Test stale target refusal and source loss without allowing a sibling to appear. Test navigation restrictions while preserving scrollback. Remote/Herdr targets must be tested through their own supported seams; local tmux success is not evidence for them.
5. Close the viewer and prove its ephemeral resources disappear while the durable fixture source survives. Exercise reuse/cap rejection in the owning process, not only UI dedupe.
6. Clean up only resources proven to be created by the probe, on the exact socket/host. Recheck the baseline; uncertain cleanup is a reported failure, not permission for broad process-name killing or profile deletion.

## Evidence tiers

- Unit/DOM: policy and controlled completion order.
- Packaged smoke: artifact inventory, ABI and signature where applicable.
- Live GUI/native input: actual operator interaction and external session observations.
- Real agent task: runtime/learning acceptance, separately assigned.

Report tiers separately. `OATS_SMOKE_SKIP_LAUNCH=1 OATS_SMOKE_BUILD_VERIFY=1 npm run dist:smoke` from the Desktop package is build verification only. Strict ad-hoc signature checks do not prove notarization, and CI without an interactive desktop does not prove GUI usability. Keep screenshots and raw probe logs outside reusable knowledge after redaction review.
