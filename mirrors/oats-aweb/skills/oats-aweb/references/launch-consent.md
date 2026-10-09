# Launch consent and retained recovery

Read before enabling section 4's opt-in or interpreting a blocked/incomplete
launch. These are kernel acts; the provider never writes consent or answers
prompts. OATS [v0.44.0](https://github.com/awebai/oats/releases/tag/v0.44.0)
at `b6d34780748bdcf24b209284cfa7840957060b87` releases this contract.
Verify the actual selected kernel supports it; source/release records are not
installation, adoption, operator authorization or receive acceptance.

## Selection and authorization

This reference covers only the development fallback. The recommended unattended
route is approved mode with the host's managed policy admitting the plugin
(section 4's approved route), which shows no development prompt and needs no
consent. New Claude/channel compositions still default to development; frozen
homes retain their captured mode. There is no automatic flip-back, migration or
approved-to-development fallback; a future default change requires an explicit
reviewed release. Authorized session delivery may be selected for unattended use,
preserving any explicit native requirement. Source changes do not enroll a
channel or recover a runtime.

The section 4 recipe belongs only in the HOST's `oats-local.yaml`, after explicit
authorization for that exact home. The key is a strict boolean, absent/false OFF.
No symlink alias, wildcard, dot segment, trailing separator, ancestor or soul-wide
default is accepted. A future home's resolved existing ancestor plus intended
suffix is checked again after creation. Workspace/soul declarations, environment,
spawn flags and saved launch recipes cannot grant consent. Removing the entry
disables it for future launches; no existing home is enabled automatically.
`workspaceTrust` is unsupported. Never bypass a folder-trust prompt to reach
the development-channel prompt; no API-key or other prompt answering is covered.

## Qualified preview and launch

Card: explicitly authorized operator, exact selected home and kernel with the
released contract. Use the onboarding/lifecycle owner's spawn preview; inspect
`launchPromptAnswers: {awebDevelopmentChannel: boolean, consentSource: string|null}`.
Preview reports policy with no terminal input, not an observed prompt. False may
still have provenance. Missing fields on an older kernel mean unreported or
unsupported, never consent. Next: the already-authorized qualified launch through
the lifecycle owner, or report the missing prerequisite. Do not invent an opt-in
flag or replacement provider setting. `--no-launch` never answers.

Qualification is Claude 2.1.289, darwin-arm64, executable SHA256
`03d66745e3bb69ec727d66023696f3820bc0a00a8a5ba725eb6706d0c67cbe69`,
110 columns by 35 rows, exact development-channel argv for only
`plugin:aweb-channel@awebai-marketplace` and complete accepted prompt frame.
Version text alone is insufficient. Only the invocation-owned new process/pane
qualifies; a reused pane additionally needs a changed PID and fresh visible bytes.
Already-running processes, stale screen and scrollback provide no input authority.
The kernel rechecks home/target/process/geometry/frame and permits at most one
Enter, with no uncertain-input retry. Approved/multiple/contradictory plugin
arguments cannot qualify. Provider, broker and ordinary agents never supply keys.
See the [tagged qualification contract](https://github.com/awebai/oats/blob/v0.44.0/docs/configuration.md#exact-home-launch-prompt-consent)
and [target guards](https://github.com/awebai/oats/blob/v0.44.0/docs/execution-targets.md#launch-prompt-outcomes)
for the complete fixture and restoration rules.

Released completion is narrower than successful startup: the tagged complete
empty banners name Opus 5.5, API Usage Billing, auto mode and medium effort.
A healthy subscription or task-filled pane may be retained blocked after Enter.
The limitation remains open in [oats#754](https://github.com/awebai/oats/issues/754);
issue closure is not evidence of a released general fix. Interim
[PR756](https://github.com/awebai/oats/pull/756), merged at
`90ca5500ac0ca5ab3bc738823fd71e67bd591a60`, adds billing atoms only on qualified
complete empty frames. That source progress does not qualify arbitrary transcript,
bypass/task-filled output or prove selected-kernel release/adoption.
Neither opt-in nor a completed launch proves installation, channel admission,
connection, message presentation or model consumption.

## Read receipts, then inspect

Card: a launch result for the exact retained home, read-only interpretation.
`launchPrompts.status` is `completed|blocked|incomplete`; preserve `reason`
as diagnostic text, not a closed enum or permission. `answers` contains at most
one `{class: awebDevelopmentChannel, signatureId, status: submitted}`.
Submitted is not readiness; empty answers do not prove no input if audit failed.
`receipt` is an ARRAY of `{ok, row?, results: [{path, ok, reason?}]}`.
Partial logs and empty results are possible. Count actual results, not receipt
array length; never fabricate a row or infer writes from an empty results array.
See [tagged result fields](https://github.com/awebai/oats/blob/v0.44.0/docs/desktop-cli-api.md#launch-prompt-results).
Next: inspect the retained session before choosing any recovery action.

`E_SPAWN_INCOMPLETE` preserves `instance`, `home`, `launched: "unknown"`,
`unconfirmed: true` plus retained `target`, `parentLineageCommitted` and
`launchPrompts`. Target fields may be incomplete. Retained metadata may say
`launched:false` while the process is live; neither representation means nothing
started. Provider effects and lineage may already be committed.

Card: authorized operator at the selected deployment, exact retained home.
Run `oats session inspect --home <home> --json`; this is read-only and succeeds
when it identifies the actual session/target state. Next: operator attaches to
that retained target if necessary. Do not automatically resend a key, replay
spawn, allocate a replacement or restart after blocked/incomplete outcomes.
Start only once inspection proves the session gone; a live target may return
`E_SESSION_RUNNING`. Any live prompt intervention requires separate explicit
operator authorization, never broker/ordinary-agent automation. Missing or
ambiguous inspection is a blocker, not permission to recreate the session.
Keep submitted-answer and partial audit evidence; do not translate it to success
or to “nothing happened.” Receive verification still follows section 4's exact-ID
exchange; Codex and joined `receive:native` use the broker, while Claude/Pi primary
native delivery remains distinct.
