## Changed

- **Desktop: a roster row's message says who made it**
  ([#982](https://github.com/awebai/oats/issues/982)). A row can carry a
  message it did not get from the Desktop: OATS's own, the Desktop's check of
  the terminals, or the Desktop's read of the other machines. It was shown
  bare, so a sentence from OATS read like the Desktop's. Now its speaker
  stands in front: "OATS says: …", "Desktop's terminal check says: …" or
  "Desktop's read of other machines says: …". This is in the row's tooltip
  and description when it cannot open, in the hover card's Status, in the
  actions menu (its button when the row offers nothing, Start's reason and
  Open in split's reason on a Herdr row) and in the notice when a terminal
  cannot open. A sentence the Desktop writes itself reads as before. Such a
  message is now one line: several lines are shown as one, and a message
  that holds control characters or looks like a credential reads "[Detail
  withheld]", with no speaker in front.

- **Desktop: the start dialog says who made the message that stops a
  start.** When an instance's state is not known, the dialog's status showed
  the row's message bare. It now reads "OATS says: …" or "Desktop's terminal
  check says: …", as one line, withheld whole under the same rule.

- **Desktop: the context panel's Start says who gave a Herdr row's reason.**
  Its tooltip reads "OATS says: E_HERDR_REMOVED: …" when OATS gave the
  reason, and the Desktop's own sentence, as before, for a row of an older
  OATS.

- **Desktop: the overview says who made a Herdr row's reason.** The Terminal
  and Restart tooltips of a Herdr row read "OATS says: …" when OATS gave the
  reason.

- **Desktop: the overview's notice of a failed read with no rows puts
  OATS's message after its own sentences.** It read "Roster unavailable:
  `<message>`. No current observation." It now reads "Roster unavailable. No
  current observation. OATS says: `<message>`", the message as one line of
  at most 300 characters, and the announcement reads "Couldn't refresh
  roster. OATS says: `<message>`". A message that is withheld reads "[Detail
  withheld]" in its place with no "OATS says:"; with no message the notice
  is "Roster unavailable. No current observation." When an earlier
  observation is still on screen, "Showing the last observation, not current
  state; actions disabled." stands where "No current observation." does.
  Another machine's message has no speaker and stays inside the sentence,
  as before.

- **Desktop: the overview's note over rows kept after a failed read puts
  OATS's message after its own sentence.** It read "Roster unavailable:
  `<message>`. Showing a reported observation, not current state; actions
  disabled." It now reads "Roster unavailable. Showing a reported
  observation, not current state; actions disabled. OATS says:
  `<message>`", the message as one line of at most 300 characters. A
  message that is withheld reads "[Detail withheld]" in its place with no
  "OATS says:"; with no message the note is the Desktop's sentence alone.
  Another machine's message has no speaker and stays inside the sentence,
  as before.

- **Desktop: the roster's failure notice says who made the message it
  keeps.** When this computer's deployment could not be read again and its
  last rows are kept, the notice's tooltip and Details, the line of a cache
  problem and, with nothing observed yet, the failed block and its
  announcement now read "OATS says: `<message>`". Another machine's message
  reads as before. Either is one line, withheld whole under the same rule.

- **A stale deployment's reason puts OATS's message after the client's
  sentence.** When a deployment's re-read fails and its last rows are kept,
  its reason read "This deployment's last read failed: `<message>`. It shows
  what was last observed.", with the message as it came. It now reads "This
  deployment's last read failed. It shows what was last observed. OATS says:
  `<message>`", the message as one line. A message that holds control
  characters or looks like a credential reads "[Detail withheld]" in its
  place, with no "OATS says:". The Desktop shows the reason on its
  Deployments page and in a deployment's heading; `oats tui` shows the same
  sentence in its notice ([docs/tui.md](../tui.md)).

- **A deployment whose re-read failed is stale whatever the failure's
  message holds.** A failure with an empty message read as a live
  deployment: its rows kept their actions and no notice said the read had
  failed. Now the failed read alone decides it. The deployment is `stale`,
  its reason is "This deployment's last read failed. It shows what was last
  observed.", and the Desktop's roster and overview show their failure
  notices and disable the rows' actions, with a message, with none, and
  with one that is withheld.

- **`packages/client/`: a text a client shows carries its speaker.** For
  another client of the shared home. A row with a `runtimeError` carries
  `runtimeErrorOrigin` (`kernel`, `terminal-probe` or `roster-read`); a
  reason of `rowReason` and `instanceActs` carries `origin` exactly when its
  sentence is the row's own text, with `unattributed` for a text nobody
  attributed; the entry `failedEntry` keeps carries `errorOrigin: "kernel"`
  beside `error`, and `error` is then always a string. Each is an added,
  optional key. `originLead(origin, terms)`, new on the stable surface,
  answers the words to put in front of such a text. The keys are written by
  the shared home only and are never taken from an answer.
  [Who made a shown text](../../packages/desktop/docs/desktop-deployment-model.md#who-made-a-shown-text)
  has the speakers, their words and which text gets which.
