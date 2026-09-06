---
type: Lesson
title: Assertions need an independent measurement of the claimed quantity
description: A test that computes expected bytes with the same expression as the implementation pins the formula, not whether the emitted document actually fits the promised size.
tags: [testing, review, assertions]
timestamp: 2026-09-05
---

# The trap

`recall --ids-only` reported the number of bytes a turn occupies in the `--json`
answer. The implementation estimated it with a standalone pretty-printed JSON
string plus framing bytes:

```js
bytes: Buffer.byteLength(JSON.stringify(full, null, 2), "utf8") + 8
```

The test asserted the same expression against the emitted turn:

```js
assert.equal(sized.turns[0].bytes,
  Buffer.byteLength(JSON.stringify(emitted, null, 2)) + 8,
  "bytes is what the turn occupies in the --json answer");
```

That pins implementation drift, but it does not measure the message's claim.
Any formula change that actual and expected share still passes.

# The hidden gap

In the real emitted answer the turn is an element of a `turns` array inside an
object, so each line carries four more spaces than the standalone
`JSON.stringify(x, null, 2)` estimate. On 60 turns of ordinary prose, the
estimate was 64,320 bytes while the actual document was 68,148 bytes — about 6%
low. That case had enough headroom, but the truthful-number regression was real.

# The rule

When expected and actual use the same computation, ask what independent quantity
the assertion message claims. For byte limits, write the real answer to a file
and measure the file:

```js
execFileSync("/bin/sh", ["-c", `${RECALL} --thread t --json --until ${id} > ${f}`]);
assert.ok(statSync(f).size <= cap);
```

Redirect and `statSync` when the file size is the measurement: that measures the
artifact itself rather than whatever the capture path handed back.

One observation from this command and output path, cause unestablished: reading
the same answer through `execFileSync(..., { encoding: "utf8" })` returned
65,536 bytes despite an explicit larger `maxBuffer`. Do not read that as a
general limit of Node's subprocess capture. An independent control on Node
v26.8.1 received all 262,144 bytes with UTF-8 and a 2 MiB `maxBuffer` when the
child wrote synchronously, so the short read does not reproduce on the flag
combination alone. What produced it here — child exit and flush timing, the
shell layer, the transport — was never isolated, and nothing in this note
measures it. Keep it as a reason to prefer the file measurement when size is the
fact under test, not as a documented behaviour of `execFileSync`.
