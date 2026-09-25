# @awebai/oats-pi

Pi harness bridge for [OATS](https://github.com/awebai/oats).

The runtime-neutral kernel and universal `oats` CLI live in
`@awebai/oats`. Publishes in lockstep with the kernel (same version
from the same release tag). This bridge registers no operational tools. It only:

- exposes `oats-getting-started` before an OATS workspace exists (the
  acquisition funnel);
- contributes the instance-local `.agents/skills` set inside a spawned
  instance;
- journals compaction summaries and sends resume nudges when the active
  knowledge capability created `STATE.md`/`log.md`. Knowledge ownership,
  read/capture instructions, judgment and delivery remain capability-owned.

Skill resolution itself is owned by the kernel: spawn materializes the exact
kernel + soul + active-capability set into each instance's `.agents/skills`
and launches pi with that directory as an explicit skill path. Ambient
skills (user-level, packages, work tree) coexist with the OATS-composed set.

```bash
npm install -g @awebai/oats
pi install npm:@awebai/oats-pi
```

OATS
publishes both packages from the same version tag. Reload pi after an adapter
install or upgrade.

All lifecycle/config/package operations use the shell-visible CLI: `oats
status`, `oats spawn`, `oats doctor`, `oats install`, `oats trust`, `oats use`, and
`oats retire`.

With [OKF v2](../../docs/knowledge.md), state/log/notes stay episodic while
accepted expertise lives in external bases exposed as immutable reader views.
The Pi bridge is not a harvester or knowledge store. Independent workers select
their own harness/model; source retirement relies on durable evidence custody,
not this adapter's presence. V0.23.1 integration is
[prepared, not yet a publication claim](../../docs/release-notes/v0.23.1.md).
