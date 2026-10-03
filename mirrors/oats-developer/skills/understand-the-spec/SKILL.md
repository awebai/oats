---
name: understand-the-spec
description: Evaluate the spec you were given before implementing it, or write one carefully when you have none. Use at the start of every piece of work, when a spec seems ambiguous or incomplete, or when the task is only a one-line request.
---

# Understand the spec

Most rework comes from building the wrong thing well. Spend the time here.

## If you have a spec
Read it twice, then check:
- **Done when:** can each outcome be checked? Could you write its test now?
- **Contracts:** do you know every interface you must keep or change, and who consumes it?
- **Edge cases:** walk the inputs, the failures and the unusual states. Which does the spec
  not decide?
- **Consistency:** does it contradict the code as it is, the repository's docs, or itself?
- **Scope:** what's out of scope? What files must you not touch?
- **Size:** is it one piece of work, or several that should be split?

Read the code it touches before deciding the spec is right: specs are written from a model
of the code, and the model can be wrong.

**Questions** go to your expert, batched, each with your proposed answer:
> "The spec doesn't say what happens when the key is already revoked. I propose
> refusing with 409 `key_revoked`, as `rotate` does. OK?"

Don't start on the parts a question affects until it's answered. Other parts can go ahead.

## If you have no spec
Write one in the standard shape (goal, done when, design, contracts, edge cases, tests, out
of scope, files) after reading the code. Send it to whoever gave you the task and wait for a
yes on anything that changes a contract or a user-visible behaviour. A small, contained fix
can proceed with the spec stated in your first commit message.

## Record your understanding
Keep a short note of the decisions and answers in your working notes, so a reviewer, your
expert or a successor can see why the code is shaped as it is.
