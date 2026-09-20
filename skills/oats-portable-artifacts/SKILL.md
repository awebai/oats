---
name: oats-portable-artifacts
description: >-
  Use when inspecting or approving exact retained artifacts for a portable OATS
  composition, reviewing approval-required preparation, comparing retained A/B
  revisions, or diagnosing missing and damaged captured resources. Triggers:
  "artifact set", "captured approval", "available unapproved", "retained
  resolution", "source deleted". Do not use legacy mutable installed-store trust
  as captured execution authority.
---

# Captured artifacts and approvals

Retention, selection, and approval are distinct:

- Retention keeps exact source, capability, and resource trees.
- A captured resolution selects one immutable managed composition.
- Approval authorizes an exact executable capability artifact revision.
- Current provider/credential/host readiness is checked again per action.

Artifact presence is never approval. A newer available artifact does not replace
an existing captured instance's artifact, and "available" does not mean latest,
approved, or selected.

## Implemented inspection and approval

Inspect one exact record without executing capability code:

```bash
oats inspect --deployment <absolute-deployment> --resolution <sha256-id> --json
oats inspect --deployment <absolute-deployment> --resolution <sha256-id> --composition --json
```

Approve a capability already selected by a complete captured record:

```bash
oats trust <capability-id> \
  --deployment <absolute-deployment> --resolution <sha256-id> --json
```

When preparation cannot complete because provider codec execution itself needs
approval, approve the exact prospective artifact set:

```bash
oats trust <capability-id> \
  --deployment <absolute-deployment> --artifact-set <sha256-id> --json
```

Both selectors are explicit local deployment addresses. Never look up a captured
artifact by capability ID in today's lock, current installed directory, catalog,
or source checkout.

## Failure posture

- Missing retained input and damaged retained input are different failures.
- Damaged state is never repaired during dispatch.
- Approval cannot cross integrity formats or revisions.
- Source/config deletion must not change an existing record's selected bytes.
- Partial or unknown historical evidence is inspectable but never executable.
- No unattended approval, background refresh, or automatic advancement exists.

Use **oats-soul-setup** to create a new preparation transaction. Use
**oats-portable** to invoke the resulting exact record.
