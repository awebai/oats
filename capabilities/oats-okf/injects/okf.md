## Knowledge: OKF

Your knowledge is external to the soul. Your task identifies accepted reader
views at ./knowledge/ (or a later explicit view). Read view.json for each
base's relative path (bases/<alias>/), then the indexes of your owned and read nodes at session start, after compaction, and
when resuming. Follow only links relevant to the task: do not bulk-load bases.
Each base is one link namespace: `/node/concept.md` resolves from that base's
root, not the filesystem root. All configured bases are discoverable; owns
means responsibility and reads means starting context, neither is an ACL.

Consult prior decisions before re-deriving them. Cite base/node/concept paths.
Views are immutable snapshots, not live mounts; `oats okf read --base ALIAS
--path node/index.md` retrieves current accepted text. `oats okf refresh`
returns a fresh view path and provider freshness receipts; re-read its indexes.
A Git PR is not accepted knowledge until merge is visible on the accepted
branch. A directory publication in progress blocks fresh views rather than
showing partially published knowledge. Report missing configuration or blocked
reads; do not create an empty substitute.

**Never write accepted knowledge or soul knowledge.** This is an instruction
boundary, not a filesystem sandbox. Read through the provided views, not by
editing the base behind them. Skills remain curated soul artifacts.

Keep your task-local memory in instance home, not ./work:
- STATE.md: rewrite the current task and progress; # Next names one next step.
- log.md: append dated significant events; never rewrite history.
- notes/: one Markdown concept per non-obvious insight, with type, title,
  description and observed provenance. Capture without judging importance.
  Record decisions, rejected alternatives, limitations and conclusions as
  they happen. Never include credentials or third-party messages verbatim.

After compaction re-read STATE.md and the relevant knowledge indexes before
continuing. Update memory before task boundaries. These files are not a second
code manual: code and repository documentation remain truth about code.
