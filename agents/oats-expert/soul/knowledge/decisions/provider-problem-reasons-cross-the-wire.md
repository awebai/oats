---
type: Decision
title: Provider problem reasons cross the binding wire as whitelisted fixed text
status: accepted
description: The kernel keeps a provider's `error.message` on the binding wire when it is one of the provider's declared fixed safe reasons, and surfaces it in preparation problems next to slot/capability/origins; free text is still refused. Adopted after an independent operator needed six runs and adapter-source reading to learn "messaging workspace must declare private: per-human".
tags: [kernel, providers, binding-wire, diagnostics, second-operator, contract]
timestamp: 2026-09-21
---

Decided 2026-09-21 by the lead from the second-operator gate (Juan's machine,
OATS 0.24.3); the human is informed through the program board because this
amends a wire contract.

# Context

The provider binding wire v1 lets a codec return `error: {code, message}`.
The kernel's decoder (`lib/provider-binding-wire.mjs`) deliberately dropped
`message` — "free text never leaves the provider boundary" — and the
preparation layer substituted a template: `<capability> <slot> <phase>
binding could not be prepared`. Meanwhile aweb 1.11.0 already restricts its
own messages to a whitelist of fixed safe reasons (`safeReasons` in its
binding wire), and OKF 2.1.2 is doing the same.

Result on the gate: three failures with three different causes rendered as
one template with the slot swapped. The operator could see *where*
(attribution is complete: slot, capability, document, pointer, span,
integrity) but not *what*; finding "the workspace lacks `private:
per-human`" took six runs and reading the adapter's source. The kernel was
discarding a message the provider had already made safe.

# Decision

1. **Whitelisted reasons cross the wire.** A provider's `error.message` is
   accepted only if it is byte-equal to one of the fixed reasons the
   provider declares (manifest `binding.reasons: [...]`, or, for providers
   without the declaration, a kernel-bundled list per capability id shipped
   with the mirror). Anything else is dropped exactly as today and the
   template is used. No interpolation, no operator values, no paths.
2. **Surface it.** Preparation problems keep `slot`, `capability`,
   `origins` and gain the provider's reason as the `message`, with the
   template as fallback. The CLI prints it.
3. **Both sides matter.** Providers must send a reason (OKF 2.1.1 sends
   code-only → OKF 2.1.2 names the missing setting; aweb 1.11.0 sends
   reasons but 1.11.1 also serializes them on every refusal path).

# Compatibility and rollout (added 2026-09-21 after P's floor question)

`validateBindingInterface` (`lib/provider-binding.mjs`) is closed: every
released kernel rejects a manifest whose `binding` block carries an unknown
field, at manifest load (`core.mjs`), not only in preparation. Therefore:

- **Kernel first.** 0.24.4 opens the validator to optional `binding.reasons`
  (and `binding.keys`, see the ownership decision) with these bounds:
  array, unique, 1–64 entries, each a non-empty string ≤ 200 chars,
  printable ASCII, no `{}`/`${}` interpolation markers. Kernel keeps a wire
  `message` iff byte-equal to an entry; check `result.problems[].message`
  follows the same rule.
- **Providers that declare the field floor on the kernel that reads it**:
  OKF 2.1.2 and aweb 1.11.1 set `requires.oats: ">=0.24.4"`. A provider
  release is never published with a field the floor kernel cannot load.
- **Fallback list is not a compatibility shim.** The kernel-bundled
  per-capability constants exist for providers that have not declared the
  field yet (OKF 2.1.1 code-only, aweb 1.11.0), not to let manifests skip
  the declaration.
- Ordering of the 0.24.4 wave: kernel 0.24.4 tag → OKF 2.1.2 + aweb 1.11.1
  releases (floor 0.24.4) → mirror/catalog/edition pins → second-operator
  re-run on all three.

# Amendment 2026-09-21 — `check` needs a reason per cause, not one code

The first second-operator publication was followed by OKF 2.1.2's `check`
refusing `needs-configuration / provider-not-qualified` with no message. The
kernel side is done (check `result.problems[].message` passes the same
filter), but OKF's `check` phase is code-only and folds at least four
distinct causes into `provider-not-qualified`: an unadmitted or unsupported
action, more than 64 Git bases, and any of `E_OWNER` / `E_BASE` /
`E_VALIDATION` / `E_DIRECTORY_GIT` / `E_CONFIRM` while staging or validating
a base. The operator published two resolutions and still could not tell which.

Rule: **every `problems[]` entry a provider returns from `check` carries a
fixed reason distinct per cause**, declared in `binding.reasons`, chosen so
the operator knows which document or setting to change (e.g. "knowledge base
staging failed for a declared git base", "declared base is not a validated
knowledge tree", "check action is not an admitted knowledge operation").
Codes remain the contract; reasons make them actionable. Applies to aweb
too (its check path already names its reasons).

# Consequences

- The security boundary is unchanged in kind — only provider-declared
  constant strings pass — but the operator learns the cause in one run.
- Acceptance for the specificity half of seam 5 becomes testable: the
  recorded second-operator fixtures must show `messaging workspace must
  declare private: per-human` / `setting bindings-file is required`.
- Adds a small manifest field (`binding.reasons`) — earned by the gate
  evidence; providers without it fall back to the bundled list.

# Rejected

- Raw passthrough of `error.message` (free text from executable code into
  operator output; the original refusal was right).
- Kernel-hardcoded messages per provider (the kernel would guess provider
  semantics; breaks the neutrality rule).
