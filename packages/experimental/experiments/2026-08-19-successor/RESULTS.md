# Successor experiment — results

Date: 2026-08-19. Scored against the frozen PROTOCOL.md. Code verdict
pending independent review at time of writing; metrics M1/M2/M4/M5 are
final.

## What happened

A fresh agent, whose only project context was the 99,853-char dress
briefing (opener + 15 pinned conclusion turns + 5 frontier turns, 160
omitted-but-listed), implemented the capture ignore feature in an isolated
worktree: `lib/ignore.mjs` + 13 tests + integration across all capture
paths, suite 63/63 green, in 7m19s.

## Contamination disclosure

The incumbent staged PROTOCOL.md in the same directory as the briefing;
the successor read it before registering the "successor never sees this"
line — and disclosed this unprompted in its report. This was a staging
error by the incumbent, not misbehavior by the successor. Consequence: M3
(acceptance criteria) is evidentially weakened — the successor saw the
rubric. M1/M2 (measured from its transcript, about information-seeking
behavior) and M4/M5 are unaffected by rubric knowledge.

## Metrics

- **M1 — recall calls: 2, both targeted** (verified from the transcript,
  matching self-report exactly). Both checked the record for prior design
  decisions about this very feature before finalizing — the correct use.
  The second found the incumbent's original one-line intent and confirmed
  the implementation matched it. Zero floundering.
- **M2 — re-derivations: 0.** No strategy/SOT/architecture re-reads at
  all; every file read was the briefing or code being modified (allowed by
  protocol). The successor never re-established a fact the briefing
  carried.
- **M3 — acceptance criteria: 7/7 provisionally** (per its report and
  diff; independent review pending), **discounted for contamination**. The
  successor states its design predates the protocol read; plausible from
  the transcript ordering but not provable.
- **M4 — context hallucinations: 0.** Its one claim about prior work (the
  incumbent's ignore-list remark) checks out verbatim against the record.
- **M5 — cost**: 135,453 subagent tokens, 49 tool uses, 7m19s wall.

## Review round (post-scoring addendum)

Independent review of the successor's first submission found one CRITICAL
defect (ReDoS: alternating-wildcard ignore patterns compiled to
catastrophically backtracking regexes — one typo-adjacent line could hang
the whole capture pipeline) plus an unactionable fail-closed error path.
**Calibration matters here: every one of the incumbent's own review rounds
on this package also came back NEEDS-CHANGES on first pass** (concurrent
-append data loss, shell/plist injection, a brute-forceable 32-bit
signature). One critical finding per submission is parity with the
incumbent under the same reviewer, not evidence of degraded capability.

The successor's fix round, on briefing context alone: replaced the regex
layer with a linear-time tokenizer + DP matcher (the structural fix, not
the symptom patch), typed actionable errors, doc/README hardening, two new
regression tests (hostile shapes measured 1.4ms vs 956ms-to-hang before),
suite 65/65 — and it caught a flaw in its own first-draft hostile test
during self-review. Zero recall calls in the fix round (findings were
fully specified), consistent with targeted-use behavior throughout.

## Pre-registered interpretation

The sufficiency bar (M3 ≥ 6, M4 = 0, M1 ≤ 5 all targeted) is met.
Because M3 is contaminated, the load-bearing evidence is M1/M2 — the
uncontaminated behavioral signals — and they are unambiguous: the
successor neither floundered nor re-derived; it read its briefing, went
straight to work, and used the record exactly as the escape-hatch design
intends (checking for prior decisions, not for bearings).

**Conclusion: structural selection (goal + pinned conclusions + frontier +
recallable omissions) was sufficient spawning context for this task.** No
evidence for needing an intelligent tagger — real-time or at-rest — on
this class of task. Per the agreed sequence, distill-at-rest stays
unbuilt until observed misses justify it. One task is one data point;
the next successor spawn should fix the staging error (briefing in its own
directory) and can drop the amendment risk by measuring pin size before
freezing the budget.

## Incidental findings

- **Capture coverage gap**: background subagent transcripts live under the
  session scratchpad (`tasks/*.output`), outside every capture root — the
  successor's own session was NOT captured by the watcher, and metrics had
  to be measured from the raw transcript file. If subagent sessions should
  be part of the record (they arguably are the record's most interesting
  sessions), the scratchpad tasks directory needs to become a capture root
  or the harness transcripts need a different home. Backlog.
- Pinned conclusion turns alone were 2.8x the planned briefing budget —
  conclusions written by this incumbent are long. Either budgets should be
  sized after measuring pins, or conclusions need a terser convention.

Note: briefing.md is deliberately not committed — it contains session
content and is reproducible deterministically from the record via the dress
manifest turn t1:9cb1081d0e72a37cc1c7f9d57b5d522b51cf7253cbed91ea1dab00e41febd4d9
(the manifest records the exact selection and the briefing digest).
