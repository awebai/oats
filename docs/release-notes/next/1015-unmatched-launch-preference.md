## Changed

- **Desktop: the Spawn dialog says an unmatched launch preference in its own
  words, and quotes OATS under Details**
  ([#1015](https://github.com/awebai/oats/issues/1015)). From 0.53.0 OATS
  refuses a spawn that names no launch while `oats-local.yaml` `souls.launch`
  holds a key that names no soul. The dialog read "OATS couldn't work out this
  soul's defaults. Try again, or see Details.", with OATS's message under
  Details and its fix nowhere. It now reads "This machine's launch
  preferences name a soul this workspace doesn't offer, so OATS won't choose
  a launch for this soul. To spawn now, pick a harness above, or a launch
  configuration in Developer settings. To fix it for every spawn, correct
  the preference (Details)." Details hold the code, then "OATS says:
  `<message>`", then the fix on its own line. Each text is one line and
  whole; one that looks like a credential reads "[Detail withheld]", and
  "OATS says:" then stands before the other.
  - **At a press**, when the key appeared after the dialog had read its
    preview, the notice read "OATS couldn't complete the spawn. Try again, or
    see Details. Nothing was created." It now reads "This machine's launch
    preferences name a soul this workspace doesn't offer, so OATS won't
    choose a launch for this soul. To spawn now, pick a harness or a launch
    configuration for this spawn. To fix it for every spawn, correct the
    preference. Nothing was created.", with the code under its details. A
    dialog still open reads the preview again and shows the first sentence.
  - **Unchanged:** a spawn routed to another machine shows that host's
    refusal as before, and a spawn already sent that OATS then refuses with
    this code still reads as an outcome to check.
  [The spawn dialog](../../packages/desktop/docs/desktop-spawn-preview.md#an-unmatched-launch-preference)
  has the whole of it.

- **Desktop: a soul's launch problem says who is speaking**
  ([#1015](https://github.com/awebai/oats/issues/1015)). The soul page and
  the soul panel show a box when a spawn of that soul with no launch chosen
  would be refused: a harness that is not installed, a launch configuration
  that is gone or ambiguous, and from 0.53.0 a launch preference that names
  no soul, which every soul with no entry of its own then carries. The box
  showed OATS's message and its fix as two paragraphs, with no word on whose
  they were. It now starts with the Desktop's own line, "A spawn of this soul
  with no launch chosen would be refused here.", then reads "OATS says:
  `<message>`" and the fix under it, with the code under Details as before.
  Each of OATS's two texts is one line and whole; one that looks like a
  credential reads "[Detail withheld]", and "OATS says:" then stands before
  the other. This is so for every launch problem, not only the new one.

## Fixed

- **Desktop: the fix OATS sends with a refused preview reaches the Spawn
  dialog** ([#1015](https://github.com/awebai/oats/issues/1015)). When OATS
  refuses the preview of a spawn it may send, beside its message, a fix: what
  to do about it. The Desktop's reader of the CLI's answer kept the code and
  the message and dropped the fix, so no fix reached the dialog from an
  installed OATS. It now keeps the fix beside OATS's own message, as one
  printable line of at most 1,024 characters, and nothing else of the
  refusal's details. What a person sees differently today is in one place:
  the three lines under Details for an unmatched launch preference (under
  Changed) are read from it. A harness that is not installed reads as it did,
  since OATS's message for it already holds its fix.
