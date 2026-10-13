---
name: oats-token-saving
description: Use before you message another instance, before you ask anyone for status or progress, and when you set up how a helper reports to you. Covers who a message is for, whether it is worth sending, what to read instead of asking, what a message holds and how long it is, when to reply, and what must never be cut to save tokens. Part of oats.core, day-to-day operation from inside an instance; how to send (addresses, threads, verification) is your messaging capability's skill, and the setup and config of an OATS workspace is oats.setup.
---

# Save tokens when instances talk

A message costs twice. You spend tokens writing it; the receiver is woken, reads it with
its whole context loaded, and often answers. A message that changes nothing the receiver
does is all cost. Between a handful of instances, that cost becomes most of the day.

## The test

Before you send anything, answer: **who will do something different because of this, and
what?**

- Nobody: don't send it.
- One instance: send it to that one.
- You can't say what they would do differently: it is a status report. Don't send it.

## To whom

- **Only the instance that will act on it.** No copies for visibility, and no sending to
  every lead, maintainer or peer when one of them owns the matter.
- When you don't know who owns it, ask one instance who does. Don't ask all of them.
- When a role in your workspace has several holders, your brief or the workspace's rules
  say which one is yours. Report to that one.

## What not to send

- **Acknowledgements and courtesy:** "received", "on it", "will do", "thanks", "sounds
  good". A message that asks nothing needs no reply.
- **Progress and status:** "started", "halfway", "tests running", "still waiting".
- **What a shared record already shows:** the pull request, the tracker, `oats status`, a
  file both of you can read. The reader reads the record. When the receiver must act on
  something in it, send the reference and the one thing you need.
- **Someone else's words, passed along.** Pass on a human's or another instance's decision
  only when they ask you to, or when the receiver must act on it and can't read it
  anywhere.
- **The story:** how you got there, what you tried, a recap of the receiver's own message.

One exception, by construction: **a message that needs a confirmation says so, and gets one
line back.** A stop or a hold is the usual case: the sender must know the work stopped.

## Don't ask for what you can read

- Read the state yourself first: `oats status`, `oats instance events <instance>`, the
  pull request, the tracker, the file.
- **Never ask for progress reports, and never set a helper up to send them.** Agree what it
  sends when you launch it: the result, or the question that blocks it. Nothing between.
- Ask a question only when the answer changes what you do next.

## What a message holds

- **First, what you need from the receiver,** or the result they are waiting for.
- **Exact references,** not descriptions: the pull request at its commit, the issue, the
  message id, the file.
- **One topic.**
- **One message per task boundary, not one per event.** Three things that happened since
  your last message are one message, or none.
- **As long as acting on it needs, and no longer.** A spec, a brief or a review's findings
  is the long message, and that is fine. Send it once, as a file or a link, and don't
  restate it in the messages that follow.

## What this does not cut

- **What moves work goes at once:** a blocking question, a hand-over, a review request, a
  result someone waits for, a stop.
- **What your role owes, once:** the report your briefing requires, a decision only a human
  can make.
- **What is owed on a record is never shortened to save tokens:** a verdict on the pull
  request, a decision on its issue with what was rejected, the evidence of a hand-over, the
  report of an infrastructure fault or of your own mistake. This skill is about messages
  between instances, not about the record.

How to send (addresses, threads and subjects, verified senders, what must never be in a
message) is your messaging capability's skill.
