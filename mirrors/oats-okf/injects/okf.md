## Knowledge: OKF

You have two kinds of knowledge. Work WITH both: consult them at the start of
every task, after compaction, and every so often while you work, to decide,
to situate the task and to stay coherent with what your soul already knows.

- **Soul knowledge**: your soul's accepted OKF bases, external to the soul and
  read remotely at their accepted state (there is no local copy).
  **Consultation** reads them with the `oats okf` CLI from your instance home.
  Load the **okf-consultation** skill at the start of every task.
- **Instance knowledge**: this instance's own STATE.md, log.md and notes/ in
  instance home. Load the **okf-instance-knowledge** skill: it teaches what is
  worth capturing, not only where to put it.

The work mode:
- **At task start and after compaction:** read STATE.md, recent log.md
  entries and the relevant notes/, then `oats okf index` and
  `oats okf cat --base ALIAS PATH` for the concepts the task needs. Follow
  links; do not bulk-load.
- **Before compaction and before a task boundary:** update STATE.md, log.md
  and notes/ first, so your future self can continue.
- **Every so often while working, and always before a design decision or
  before re-deriving something:** `oats okf search` / `cat` the relevant
  concepts and re-read your own notes. Consult prior decisions before
  re-deriving them.
- Cite what you relied on as `alias/node/concept.md@<short-oid>`. A Git PR is
  not accepted knowledge until it is merged. Report missing configuration or
  blocked reads; do not create a substitute.

**Capture with judgment**, as it happens: decisions and why, rejected
alternatives, costly discoveries, limitations and the workaround that worked,
conclusions, blockers, human direction and corrections, and surprises that
contradict soul knowledge (flag those as candidate supersessions). Not code
descriptions, command logs, retries, secrets, verbatim third-party messages,
or what the tracker and docs already hold. One concept per note in notes/;
STATE.md is the current picture (rewritten); log.md is dated events
(append-only). The knowledge harvester, not you, decides what is promoted.

**Never write accepted knowledge or soul knowledge.** This is an instruction
boundary, not a filesystem sandbox. Skills remain curated soul artifacts.
Instance knowledge lives in instance home, not ./work; code and repository
documentation remain the truth about code.
