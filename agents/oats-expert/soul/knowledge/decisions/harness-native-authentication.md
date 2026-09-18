---
type: Decision
title: Harness authentication remains native and user-managed
status: accepted
description: OATS launches the selected harness in its existing authenticated context and delegates credential resolution and lifecycle to the harness rather than managing authentication itself.
tags: [architecture, runtime, harnesses, authentication, boundaries]
timestamp: 2026-09-18
---

**Status: accepted by the human 2026-09-18.** Users authenticate their harnesses
on their machines. OATS launches those harnesses using their normal native
authentication context. This applies across supported harnesses, not only Pi.

# Context

A proposed first captured Pi SDK host introduced an explicit auth-file argument,
a custom read-through CredentialStore and an API-key-only restriction. That
would put OATS in charge of credential selection, formats and lifecycle, and
could exclude an already authenticated OAuth/subscription installation.

The human rejected that responsibility split. OATS should not require a new key,
a different login method or an OATS-managed credential layer merely to launch
an already authenticated harness.

# Decision

## The harness owns authentication

- Users perform harness login/configuration through the harness's own supported
  mechanisms, independently of OATS.
- OATS launches the selected harness with its normal native authenticated
  context. A thin SDK host uses the harness's supported native authentication
  facilities rather than replacing them.
- The harness retains its normal credential resolution, configured credential
  helpers, OAuth refresh and native credential persistence where applicable.
  Those operations are performed by the harness, not reimplemented by OATS.
- OATS does not parse, filter, copy, convert, inject or store harness credentials;
  implement a CredentialStore wrapper; create an auth service; impose an API-key-
  only subset; or ask users to supply secrets to OATS.
- Do not add an OATS auth-file selector or credential-format contract as a
  prerequisite to captured launch. Preserve the user's ordinary native harness
  profile selection instead of introducing a parallel account-selection model.
- Missing/expired/invalid authentication follows the harness's supported error
  behavior. Surface an appropriate nonsecret failure and let the user resolve
  it with the harness; do not silently log in, repair accounts, create keys,
  borrow identities or claim readiness from model metadata.

## Resource composition and authentication are different boundaries

The [strict curriculum](/decisions/strict-instance-curriculum.md) still requires
only the selected OATS instructions and skills, with existing managed-runtime
resource approvals and source/helper/native custody preserved. It does not
require isolating, cloning or replacing the user's native harness authentication.

Do not change HOME, native profile directories or authentication environment to
an empty/private surrogate merely to make resource-isolation evidence pass.
Keep selected curriculum and owned session/history placement independent of the
normal native authentication context. Private/in-memory test fixtures remain
valid inert tests, but are not production authentication policy or live readiness.

Native authentication is not a current-OATS-config fallback. OATS still honors
the captured runtime/model selection and must not substitute an unrelated model,
source or managed resource. Native credential resolution follows the harness's
normal semantics; OATS does not impose its own replacement fallback chain.

If a supported SDK interface cannot preserve both normal native authentication
and the required resource/history boundaries, identify the precise interface
limitation. Do not work around it with private APIs, copied credentials, a
credential wrapper or unselected curriculum.

# Immediate application and limits

The Pi zero-plugin host proposal must remove the custom credential view,
auth-file argument and API-key-only restriction. Its explicit host selection,
execution mode, supported public SDK assembly and native-history custody still
need their existing bounded review. This decision is not approval of those
remaining implementation details or permission for new live operations.

Real execution acceptance uses a harness the operator has already authenticated
normally. It must not create, copy or reformat credentials just to make a test
pass. Inert SDK construction is not a real model/account success claim.

This decision does not approve optional runtime-bundle grants, managed plugin
loading, launch secret contributions, new account provisioning or messaging
team administration. Harness authentication and external-service authorization
are separate axes of the [provider-neutral architecture](/decisions/provider-agnostic-specialization-and-curated-context.md);
being logged into a harness does not establish a messaging principal's human,
context, team or grant authority.
