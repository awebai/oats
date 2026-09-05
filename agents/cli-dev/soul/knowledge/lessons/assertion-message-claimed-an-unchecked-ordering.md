---
type: Lesson
title: An assertion message that describes ordering the assertion does not check
description: Counting two batch-check launches proves how many ran, not that one ran before the copy and one after; the append-ordered log makes the ordering checkable, so the message should either be trimmed or the check strengthened.
tags: [testing, review, assertions]
timestamp: 2026-09-05
---

Found reviewing `test/retire-work-safety.test.mjs`:

```js
assert.equal(launches.filter((l) => l.includes("cat-file --batch-check")).length, 2,
  "one existence check before the copy and one proof after it");
```

The assertion measures a **count**. Its message states an **order**. Both
would still read as passing if the implementation ran both batch checks up
front and copied nothing afterwards — the exact regression the "proof after
the repair" ordering exists to prevent.

The log is append-ordered, so the ordering is cheap to actually check:
compare the index of the first `--batch-check` line, the `cat-file blob` line,
and the second `--batch-check` line.

**The general rule**: an assertion's message is read as part of the test's
claim. When the message asserts more than the expression does, a later reader
believes the stronger claim is covered and will not add the check. Either
weaken the message to what is measured or strengthen the measurement to what
is written.
