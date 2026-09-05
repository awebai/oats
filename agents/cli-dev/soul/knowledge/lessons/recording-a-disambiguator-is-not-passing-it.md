---
type: Lesson
title: Recording a disambiguator in a deferred intent is not the same as passing it
description: scheduleDeferredSelfRetirement started writing options.home into the retire intent, but completeDeferredRetirement never read it, so the detached completion hit the new ambiguity refusal it was meant to satisfy.
tags: [kernel, retire, deferred-retirement, review]
timestamp: 2026-09-05
---

`retireInstance` gained a refusal: a name that resolves to several homes
throws `E_AMBIGUOUS_INSTANCE` unless the caller passes `o.home`. The same
commit taught `scheduleDeferredSelfRetirement` to record the resolved home
in the intent it hands the detached child:

    options: { home: found.home, deleteBranch: ..., tmuxSession: session }

But `completeDeferredRetirement` still reconstructed the options by hand
(deleteBranch, keepDir, tmuxSession) and `home` was not in that list. So a
self-retiring instance whose name was ambiguous resolved its own home
correctly in-process, scheduled the deferral, and then the completion threw
the very refusal the recorded home existed to satisfy. The home and its
pending marker stayed; `oats status` reported a deferred-retirement failure
whose printed retry hint, `oats retire <name>`, failed the same way.

The shape to watch for: a hand-written option-forwarding list at a process
boundary is a silent whitelist. The producer grows a field, the consumer
does not, and nothing type-checks the gap. This was the second instance of
the same shape in one branch (the other was a version-probe normalizer).
Both were introduced by adding a field on one side of a boundary and
reading it on the other.

When reviewing a change that adds a field to a serialized intent, envelope
or probe, follow the field to its reader and confirm the reader is not
enumerating keys. Grep the field name across the repo: two hits (writer and
schema) instead of three (writer, schema, reader) is the tell.

Related: [whitelist-normalizer-drops-new-probe-fields](whitelist-normalizer-drops-new-probe-fields.md).
