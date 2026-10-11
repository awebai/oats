# Launch completion after the development-channel Enter

## Boundary and accepted risk

This is still reporting only, never input authority. After OATS sends its one
Enter to Claude's development-channel confirmation (see
[configuration](configuration.md#the-development-channel-confirmation) and the
[tolerance list](../lib/launch-prompt-fixtures/README.md)), the controller keeps
observing the same pane, within the same 30 s bound at 100 ms, only to report
how the start ended. No second key is ever sent, whatever it sees.

An unknown dialog that shows none of the markers below can be reported as
completed. The contract accepts that reporting risk. Completion closes input
authority permanently; it does not establish the absence of every dialog, idle
state, account admission, channel readiness or task success.

## The rule

Before the Enter, an unknown screen is a verdict only once it has held
unchanged for the settle window, `SETTLE` (2 s, in `lib/launch-prompts.mjs`),
because Claude paints transient frames while it starts: then it is `blocked:
unexpected prompt`. A screen still changing at the 30 s bound never settled, and
is `blocked: observation timeout`, never a prompt; see
[configuration](configuration.md#the-development-channel-confirmation). After
the Enter, completion takes the same `SETTLE`:

- **completed:** `SETTLE` (2 s) of consecutive clean captures. A clean capture
  is non-blank, carries no question marker and equals no tolerance entry after
  normalization. The screen is free to change: a working session repaints all
  the time (a spinner, a counter). The last capture is retained as private
  evidence (recognition `stable-screen`).
- **blocked:** a capture inside the window that carries a question marker
  (`blocked: unexpected prompt`). A marker never restarts the window. Also
  blocked: the confirmation coming back (`blocked: repeated or unsupported
  prompt`), after another screen was shown, or still showing 2 s after the
  Enter. Until then it may still be painted, and observation goes on. The
  blocked capture is retained as private evidence (recognition `unmatched`), and
  the receipt row says what `differed` against the nearest entry.
- **blocked: observation timeout:** no complete clean window by the 30 s bound.
  The answers record the one Enter that was sent, and the error and readiness
  remedy say so; no other key is ever sent.

A blank capture restarts the window and never blocks. The rule does not depend
on pane geometry, Claude's footer, mode, model, billing or effort.

**The remaining limit:** a question first painted more than 2 s after the
session is working is the session's own question, not a launch prompt, and the
start has already completed.

## Question markers

Only after the one submitted Enter, each listed string is matched **case-sensitively as exact contiguous text anywhere in the visible capture** (`CLAUDE_QUESTION_MARKERS` in `lib/launch-prompt-completion.mjs`, the single list). It can conservatively block a transcript quoting a known question. No regex/question-word heuristic, case folding, line joining, general `?`, general `Esc`, or exemption for an unknown question. Wrapped or customized unknown questions remain within the explicitly accepted risk. The confirmation itself carries markers; before the Enter they do not apply, and the confirmation is answered only by equality with a tolerance entry. The source references are to Claude Code 2.1.289.

| Exact forms (each independently tested) | Pinned source reference |
|---|---|
| `Accessing workspace:`; `Quick safety check:`; `Yes, I trust this folder`; `No, continue without these permissions`; `No, exit` | trust / TrustDialog |
| `WARNING: Loading development channels`; `I am using this for local development` | channel confirmation |
| `Managed settings require approval`; `Yes, I trust these settings`; `No, exit Claude Code` | managed-settings |
| `Do you want to use this API key?`; `Detected a custom API key in your environment` | api-key |
| `Select login method:` | login |
| `Do you want to proceed?` | permission-question / o5 default question |
| `Do you want to allow this connection?` | connection-question |
| `Waiting for permission…` | permission-wait / QVe |
| `Enter to confirm`; `Esc to cancel` | confirmation-guide and key-hint B renderer; gateway/selection-dialog corroborate cancel literal |
| `esc to cancel` | lower-cancel + key-hint B with lower keyCase |
| `Enter to select` | selection-dialog literal |
| `Esc to exit` | managed-settings + key-hint B |

This is the whole marker set, **not a claim that these are all possible native questions**. Generic custom title/confirm labels can evade it. `? for shortcuts` and `esc to interrupt` are explicitly normal UI, never markers. No case-insensitive expansion to `enter to confirm`, `esc to exit`, etc. without another reviewed table update.

Private retention and receipt-v2 collection rules are documented in
[execution targets](execution-targets.md#private-unmatched-launch-evidence).
