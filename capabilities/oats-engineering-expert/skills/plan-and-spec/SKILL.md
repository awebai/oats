---
name: plan-and-spec
description: Turn a goal into a plan and one executable spec per surface (code area, package or service) for developers to implement. Use when starting a feature, fix or project in your domain, when a developer needs a spec, or when work must be split across developers.
---

# Plan and spec

A developer should be able to implement a spec without coming back to ask what you
meant. If they would have to guess, the spec is not done.

## 1. Frame the goal
- **The problem**, in one or two sentences, and who has it.
- **Done means:** observable outcomes, not activities ("`oats teams add` refuses a
  duplicate label with E_TEAM_EXISTS", not "improve team handling").
- **Constraints:** compatibility promises, contracts other parts rely on, security
  boundaries, performance limits, deadlines.
- **Out of scope:** what this work deliberately does not do.

## 2. Design at your level
- Choose the design. Record the alternatives you rejected and why, in one line each.
- Name every contract the change touches (APIs, file formats, CLI output, env vars,
  events) and whether it changes. A contract change needs its consumers named and an
  order ("the consumer accepts the new shape first").
- Prefer the smallest change that meets "done". If a simpler design meets 90% of the
  goal, raise it with the requester before choosing the bigger one.

## 3. Split by surface
- A **surface** is a part of the system one developer can own: a package, a service, a
  module group. Split so that each developer's work can be built and tested on its own.
- Where surfaces meet, write the **interface first** (the shape, the error cases). Both
  specs cite it.
- Sequence the pieces: what can run in parallel, what must land first.

## 4. Write each spec
Use this shape, and keep it as short as the work allows:

```
# Spec: <title>
Goal:            <one paragraph: the problem and the outcome>
Done when:       <checkable outcomes>
Design:          <the approach; the key decisions and why>
Contracts:       <what must not break; what changes, and for whom>
Edge cases:      <inputs, failures and states the code must handle>
Tests:           <what proves it: unit, integration, a real run>
Out of scope:    <what not to do>
Surface / files: <where the work lives; what to leave alone>
Delivery:        <branch, PR target, who reviews>
```

## 5. Check the plan before launching
- Every "done when" is covered by some spec's tests.
- No two developers edit the same files without an agreed order.
- The riskiest assumption is tested first (a spike, a real run), not last.
