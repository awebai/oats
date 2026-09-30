---
name: integration-authoring
description: >-
  Route custom OATS capability-package and integration work to the framework's
  integrations expert. Use when building, adapting, or debugging a reusable
  capability, new tasks/messaging/knowledge core capability, oats.json manifest,
  lifecycle hook, or operational command—not merely activating an existing
  package. Triggers: "custom integration", "capability package", "integrate
  our tracker", "new messaging integration", "write an oats.json".
---

# Capability and integration authoring — delegate

A capability package may ship skills, instance instructions, requirements,
namespaced commands, and declared hooks. A core capability is the constrained
kind that fills one of the knowledge, messaging or tasks positions (its
manifest's `layer` field names which). Building either requires
manifest, security, targeting-boundary, collision, and probe discipline; use
the framework's **integrations-expert** soul rather than improvising.

If the user only wants an existing package, declare it and give it to souls;
no build is needed:

```yaml
# oats-workspace.yaml (host repository): declaring the package is the trust decision
packages:
  vendor.review: git:github.com/vendor/review@v1.0.0
# a soul's soul.yaml, or the workspace defaults: a capability the package exports
# (a package may export several; the soul names each one it wants)
capabilities:
  vendor.review: { from: package }
```

Then run `oats sync` (fetch, verify integrity, lock). The oats.setup
capability's **oats-package-pins** skill has the procedure.

## 1. Verify the expert is available

Run `oats souls` in the deployment and confirm it resolves the
`integrations-expert` soul (a member repository or package provides it). If it
is absent, ask the human which OATS deployment owns reusable package work;
never locate or import private kernel files.

## 2. Spawn the expert against the package's repository

The package lives in its own repository. Make that repository a member of the
workspace (or use the member that already holds it), then spawn the expert on
it:

```bash
oats spawn integrations-expert --preview \
  --purpose <package-slug> \
  --repo <member clone of the package repository> \
  --work worktree \
  --task '<capability intent; layer if any; skills/instructions/commands/hooks; external tools; which souls should get it; distribution path>'
# review the preview, then run the same command without --preview
```

Use `--relation child --relative-to <your-instance>` only when the documented
workflow makes the expert your child; otherwise leave the spawn unrelated. A
package is distributed from its own repository as `oats-package/` with a
version tag; a framework contribution belongs in the framework's repository.

## 3. Brief the design boundary

Tell the expert:

- whether it is additive or implements exactly one of knowledge/messaging/tasks;
- external requirements and executable surfaces (commands, hooks);
- intended distribution and version/compatibility;
- which souls or workspace defaults should receive it, and its settings; and
- expected skill/instruction collisions (a duplicate skill name fails the spawn).

Which souls get a capability is declared by the workspace (`defaults`) and the
souls (`soul.yaml` `capabilities`), never in the manifest. The expert must
test exact pi/Claude/Codex instance materialization, generated instructions,
command gating, deterministic hooks, and the lock's integrity check as
applicable.

## 4. Hand off

Report the new instance (`oats status`). The expert follows its
package/integration craft, runs a preview-only probe, and leaves the
`packages:` pin and the `oats sync` for the user.
