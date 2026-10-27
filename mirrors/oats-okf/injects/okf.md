## Knowledge: OKF

You have two kinds of knowledge. Work WITH both.

- **Soul knowledge**: your soul's accepted OKF bases, read remotely with
  `oats okf` from your instance home (no local copy).
- **Instance knowledge**: STATE.md, log.md and notes/ in your instance home,
  never in `./work`.

**At task start and after compaction, load `/okf-consultation` and
`/okf-instance-knowledge`**, then read STATE.md, recent log.md and the
relevant notes/, then `oats okf index` and `oats okf cat --base ALIAS PATH`.
Follow links; do not bulk-load. Before any design decision or re-deriving
something, `oats okf search` first.

> **IMPORTANT — DO NOT SKIP.** You MUST keep STATE.md, log.md and notes/ up to
> date, updating them before compaction and before every task boundary, and
> MUST launch a knowledge harvest at every harvest checkpoint: when you **hand
> over a PR for review**, when you **finish a task**, and in a long-lived role
> when **a feature is ready**, when you **ship a release or a deploy** and when
> **a direction decision** is taken with your human.
> Reading the **okf-propose** skill is **compulsory** at task start and at
> each checkpoint. At each checkpoint: update STATE.md, log.md and notes/
> first, follow okf-propose (it may find nothing to propose), and record the
> outcome in log.md. Run your final checkpoint before you report your work
> done, and say so ("done, harvested: <harvester>", "done, harvest pending:
> <proposal>" or "done, no harvest duty").
> Name each harvester with a fresh name per proposal from okf-propose's
> recipe, never the default numbered name; record it before `--preview` and
> reuse it unchanged at launch:
> `oats spawn oats.okf/knowledge-harvester --name <harvester-name> --task-file <proposal> --relation unrelated`.
> On `E_INSTANCE_NAME_TAKEN` or a messaging identity failure, stop and report;
> no automatic rename or retry. Run `oats okf status` from instance home for
> your duty; on `unknown` or an error, report it and do not propose; never
> infer permission from a task briefing or edit the recorded policy. A soul
> declaring `knowledge: { harvest: off }` has no harvest duty; it still
> consults and captures.

**Capture as it happens**, one concept per note, what `/okf-instance-knowledge`
says is worth keeping. STATE.md is the current picture; log.md is dated
events, append-only. Never capture code descriptions, command logs, secrets,
verbatim third-party messages, or what the tracker and docs already hold.
Never include personal data about people outside the team (clients,
correspondents, any other third party): a name, a contact detail, or anything
else that identifies a person, including detail derived from correspondence.
Keep the lesson and leave the person out. Naming the author of a published
source you cite is fine. That covers the names you choose as well: a note's
file name, a task ref and an instance's name are published as provenance when
knowledge is harvested.

Cite as `alias/node/concept.md@<short-oid>`; an open PR is not accepted
knowledge. Report missing configuration or blocked reads; do not create a
substitute. **NEVER write accepted or soul knowledge**: it changes only through
a reviewed PR. Code and repository docs remain the truth about code.
