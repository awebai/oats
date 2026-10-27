## Provider updates

- **oats.engineering 1.14.0: maintainers per human, and shorter instructions.**
  The catalog and this workspace pin `oats.engineering: v1.14.0`; the floor
  is unchanged.
  - **What a lane is.** A lane is a standing area of work: areas of the
    repository, a kind of work, or one human's requests. Work that would be
    finished when one goal lands is an effort in an existing lane. Any
    maintainer opens a lane with nobody's sign-off.
  - **One maintainer per human in each project lane.** The release lane stays
    one maintainer for the whole project, with the final say on merges and
    releases. A lane's maintainer owns its lane: it doesn't report to the
    maintainer that spawned it. By default a lane merges its own PRs once the
    release lane has signed off at that head.
  - **The lane map shows who holds each seat and what each maintainer is
    on.** Each maintainer keeps an entry of its own on it. Your messaging
    layer's presence says which maintainers are running.
  - **Experts find their maintainer.** An expert that no maintainer launched
    finds its human's maintainer in its lane. If there is none, it spawns
    one.
  - **Shorter injects.** The maintainer, expert and developer injects open
    with a short block of IMPORTANT, ALWAYS and NEVER rules, and run about
    half as long. The skills are about a fifth shorter, and no rule was
    dropped.
- **Upgrade:**
  - `oats sync` locks it. New spawns get it, and a stopped home moves to it
    with `oats instance upgrade`.
  - Maintainers add their entry to the lane map the next time they take a
    seat.
