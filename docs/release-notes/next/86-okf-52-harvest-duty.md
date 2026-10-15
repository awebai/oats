## Upgrade

- **Pin `oats.okf: v5.2.0` and run `oats sync`; only new spawns get the
  capability-owned harvest duty.** Existing homes keep their copied provider
  and instructions, including across session restarts. Deployments whose
  task briefings never mentioned harvests now propose eligible knowledge at
  finished tasks or PR hand-overs. Souls not ready for that must declare
  `knowledge: { harvest: off }`; consultation and working-memory upkeep
  remain. OATS >=0.49.0 is still required.

## Provider updates

- **oats.okf 5.2.0:** the IMPORTANT inject block requires current instance
  knowledge and compulsory reading of `okf-propose`. The skill holds the
  bounded checkpoint procedure, promotion/search checks, proposal format and
  memory/concurrency gates. No harvest or proposal direction remains in the
  working instance's TASK brief. At most one proposal per completed task or
  PR hand-over, one harvester per instance, and no spawn under memory pressure
  or below 8 GB available; most checkpoints propose nothing. An unrelated
  harvester can outlive its proposer. These limits are instructions, not a
  scheduler or resource reservation.
- `oats okf status` exposes the duty written by the provider at spawn (`on`,
  `off`, or missing-state `unknown`). An unknown answer or failure permits no
  proposal. Shared inject/skill text explicitly exempts opted-out souls, and
  the harvester independently refuses their recorded source material. No
  kernel composition mechanism is added.

## Documentation

- [Knowledge operations](../knowledge.md#the-flow) now describes the
  capability-owned flow, opt-out/status answer, narrow checkpoints and
  deferred hand-back. Catalog/workspace pins, package examples, mirrors and
  clean-room composition assertions move together to 5.2.0.
