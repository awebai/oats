## Added

- **`oats.core`: the skill `/oats-token-saving`, and three lines of its
  briefing** ([#1103](https://github.com/awebai/oats/issues/1103)). A message
  between instances costs twice: the sender writes it, and the receiver is
  woken, reads it with its whole context and often answers. The skill gives
  one test before sending, "who will do something different because of this,
  and what?", and the rules that follow from it:
  - **to whom:** only the instance that will act on it, with no copies and no
    sending to every holder of a role;
  - **what not to send:** acknowledgements and courtesy, progress and status,
    what a shared record already shows, someone else's words passed along, and
    the story of how the sender got there. A message that needs a confirmation
    says so and gets one line back;
  - **don't ask for what you can read,** and never ask for progress reports or
    set a helper up to send them;
  - **what a message holds:** first what the receiver must do, exact
    references, one topic, one message per task boundary. A spec, a brief or a
    review's findings is the long message, sent once as a file or a link;
  - **what is never cut:** what moves work, what a role owes, and what is owed
    on a record (a verdict on the pull request, a decision on its issue, the
    evidence of a hand-over, the report of a fault or of one's own mistake).

  The skill is provider-neutral: it names no messaging capability, and how to
  send stays with that capability's own skill. The `oats.core` briefing, which
  every instance with `oats.core` reads, gains the test in three lines, so it
  applies before the skill is loaded. An instance spawned before the release
  that carries this keeps its briefing; new spawns get it
  ([`oats.core`](../souls-and-instances.md)).
