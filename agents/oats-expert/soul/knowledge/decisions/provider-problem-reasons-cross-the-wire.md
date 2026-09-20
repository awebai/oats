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
