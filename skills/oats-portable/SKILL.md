---
name: oats-portable
description: >-
  Use when operating a newly prepared captured OATS instance, invoking an exact
  retained command or provider operation, inspecting its immutable composition,
  or creating an explicit fresh no-launch scaffold. Triggers: "captured OATS",
  "portable soul", "resolution ID", "exact retained command", "fresh captured
  spawn". Do not use for legacy config-chain deployments.
---

# Operating a captured OATS instance

A captured instance executes one immutable managed composition identified by an
explicit deployment and resolution. Its source soul, adopter alias, capability
artifacts, settings, provider bindings, curriculum, helpers, and executable
resources come from that record—not from the current checkout or config chain.
Credentials, provider readiness, memberships, knowledge contents, the work target,
and host tools remain separately checked mutable inputs.

## Authority checklist

1. Read `instance.json.executionBinding` for the exact deployment and resolution.
2. Pass both selectors together. Never infer either from cwd, a source path, a
   package lock, an OS user, or another instance.
3. If the record, retained resource, approval, binding, or host requirement is
   missing or invalid, stop. Do not retry through an unqualified legacy command.
4. Treat `responsibleHuman: null` only as explicit messaging-disabled state. It
   is not an anonymous human or a private-team identity.

## Implemented commands

```bash
oats inspect --deployment <absolute-deployment> --resolution <sha256-id> --json
oats inspect --deployment <absolute-deployment> --resolution <sha256-id> --composition --json
oats <namespace> <command> --deployment <absolute-deployment> --resolution <sha256-id> -- [provider-args]
oats operation run <knowledge|messaging|tasks>:<name> \
  --deployment <absolute-deployment> --resolution <sha256-id> \
  [--home <absolute-instance-home>] [--arg name=value ...] --json
```

For capability helpers, inspect the source's captured helper map and resolve one
exact key before selecting a helper record:

```bash
oats inspect --deployment <source-deployment> --resolution <source-id> \
  --helper <exact-map-key> --composition --json
```

Keep `sourceExecutionBinding` for provider completion commands and the returned
`executionBinding` for the helper. Do not complete through a worker's inherited
selector or use legacy helper-name discovery. Helper inspection is not worker
launch; a running-helper request must remain blocked until launch is supported.

A fresh captured directory scaffold is available only with explicit placement
and no launch:

```bash
oats spawn <captured-subject> \
  --deployment <absolute-deployment> --resolution <sha256-id> \
  --home <absolute-new-home> --no-launch --json
```

The subject must match the retained soul alias or helper name. The home must be
new and its parent physical. This command materializes retained instructions and
skills, creates owned directory work, and runs captured spawn hooks. It does not
select a work repository, launch a model, or infer a team.

## Current refusal boundary

Captured start, restart, wake, retire, managed runtime packages, non-directory
work targets, and launch are not yet public. Do not strip selectors or call the
legacy forms as a workaround. A scaffold marked `spawn-failed-cleanup-required`
may contain external hook effects; preserve it and escalate rather than deleting
it. A scaffold marked `spawned-launch-pending` is not a running instance.

Use **oats-portable-setup** for preparation and context choices. Use
**oats-portable-artifacts** for exact approval and retained A/B diagnostics.
