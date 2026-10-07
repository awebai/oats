# Qualified post-answer completion

## Boundary and accepted risk

Only after exactly one recorded **submitted** development-channel Enter, under the existing qualified executable/version/platform/argv, exact-home consent, original home identity, pane/PID and 110x35 checks, may structural recognition complete observation. It never authorizes input. Existing exact completion families remain available, subject to the marker precedence below. No structural recognition before an answer, after any terminal outcome, or after failed/uncertain input.

An unknown dialog can retain the composer and footer and evade this finite marker list. The contract explicitly accepts that completion-reporting risk. Completion closes input authority permanently; it does not establish absence of every dialog, idle state, account admission, channel readiness, or task success. The observed spinner is an in-progress task turn, not an idle prompt. No spinner word, glyph or timing grammar is introduced.

## Source provenance

Read-only pinned Claude Code 2.1.289 darwin-arm64 binary SHA256 `03d66745e3bb69ec727d66023696f3820bc0a00a8a5ba725eb6706d0c67cbe69`. [the source manifest](../lib/launch-prompt-fixtures/structural-completion.json) records exact byte intervals and SHA256s for every reference below. No extracted module enters the repository. These are source-derived rules, not additional observed captures.

## Qualified input/footer rule — non-flag footer layout

This qualifies the non-Jt footer layout (`tengu_copper_thistle` false) in the pinned source. The flag-enabled layout chooses a single hint instead of this list; it is not separately qualified. A remote flag change can alter the footer without changing the binary and reduce matches; only exact listed shapes match, never additional shapes.

Input is the same compared text object, exactly 35 newline-terminated rows at 110x35, bounded to 64 KiB. No whitespace normalization, cropping, ANSI stripping, case folding or transcript rewrite. Reject embedded CR, ESC and other C0 controls except LF. All rows after the footer must be empty. The footer must be the last nonempty row, with this immediately preceding contiguous region:

1. Exactly 110 U+2500 horizontal-line characters.
2. Exactly U+276F followed by U+00A0 (`❯` plus NBSP), and nothing else: the actual empty composer row, not a prompt-like substring in prose.
3. Exactly 110 U+2500 horizontal-line characters.
4. The finite footer below.

This accepts the region at any row where all four rows fit, not a fixed transcript height. It refuses nonempty/multiline editor drafts, shell or screen-reader selectors, annotated borders, wrapped footers, notifications between editor and footer, status rows below the footer, and footer-less states. It deliberately does not cover every normal renderer configuration.

Source: `prompt-selector` s0/qK renders Z.pointer+NBSP for the ordinary non-screen-reader input; `prompt-symbol` pins Z.pointer to U+276F. `round-border-glyphs` pins top/bottom to U+2500; `prompt-border` BA and `editor-layout` HWe give top/bottom borders with left/right borders absent. The existing raw API captures and the actual retained Max frame corroborate the exact three input rows at 110 columns. `footer-layout` YHe/Oie gives paddingX=2, row width=110, gap=1, right status marginLeft=auto. The sanitized regression frame's input region is rows 11–14; its home-only sanitized derivative is regression input, not an exact spinner matcher.

### Modes (complete list)

| Native mode | Exact left label | Allowed cycle suffix |
|---|---|---|
| default | `⏸ manual mode on` | absent only |
| plan | `⏸ plan mode on` | absent or ` (shift+tab to cycle)` |
| acceptEdits | `⏵⏵ accept edits on` | absent or same cycle suffix |
| bypassPermissions | `⏵⏵ bypass permissions on` | absent or same cycle suffix |
| dontAsk | `⏵⏵ don't ask on` | absent or same cycle suffix |
| auto | `⏵⏵ auto mode on` | absent or same cycle suffix |

`mode-map` Sr/DL/bie/qQo enumerates all six; `mode-symbols` pins the symbols; `footer-mode` kx adds literal ` on` when bare is absent. `footer-branches` dHe calls kx without bare and gates the default-keybinding cycle hint on non-default mode and ks. Unknown modes, custom keybindings and bare labels are unsupported.

After the mode/cycle label, accept only these exact suffixes, each independently enumerated: empty; ` · ← for agents`; ` · esc to interrupt`; ` · esc to interrupt · ← for agents`. For **default mode only**, also ` · ? for shortcuts` or ` · ? for shortcuts · ← for agents`. Sources: `footer-branches` dHe/EFt (escape interrupt, shortcut hint, ordering), `agent-hint` Cze (left-arrow for agents). No return-to-team-lead, task counter, voice, custom status or arbitrary suffix. The normal hints are not negative markers anywhere in the visible frame; an unsupported footer remains unsupported for structural reasons rather than because it contains a question mark or Esc.

The footer is exactly two ASCII spaces + left text + ASCII space gap + one right label from this complete list: `○ low · /effort`, `◐ medium · /effort`, `● high · /effort`, `◉ xhigh · /effort`, `◈ max · /effort`. `effort` bW/y8 and `mode-symbols` define these glyphs and labels. The right label ends at column 108 (two columns right padding are absent in tmux text); gap is exactly `108 - 2 - leftDisplayWidth - rightDisplayWidth`, and at least one. All enumerated glyphs are single-column in the qualified captured geometry. No `effort:` prefix, ultracode, missing effort, altered punctuation, or other effort value. Existing medium-only exact families remain exact; the additional finite effort rules are source-qualified here, not prior capture qualification.

## Qualified negative marker table

ONLY after exactly one recorded submitted answer, each listed string is matched **case-sensitively as exact contiguous text anywhere in the visible frame**, before either exact or structural positive completion. It can conservatively block a transcript quoting a known question. No regex/question-word heuristic, case folding, line joining, general `?`, general `Esc`, or exemption for an unknown question. Wrapped or customized unknown questions remain within the explicitly accepted risk. Input prompt matching itself is unchanged: the initial qualified channel question must still be answerable before a submitted answer exists.

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

The historical local-JSX confirmation is not claimed covered by this list; its marker composition was not separately verified and remains an example of the accepted unknown-dialog risk. Real #712 child screens with missing effort and update/focus notices below the footer remain unqualified; the retained A2 frame has the required effort and no trailing notices.

This is the whole v1 marker set, **not a claim that these are all possible native questions**. Generic custom title/confirm labels can evade it. `? for shortcuts` and `esc to interrupt` are explicitly normal UI, never markers. No case-insensitive expansion to `enter to confirm`, `esc to exit`, etc. without another qualified table update.


Private retention and receipt-v2 collection rules are documented in
[execution targets](execution-targets.md#private-unmatched-launch-evidence).
