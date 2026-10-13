## Changed

- **`oats tui` (preview): an instance's reason says who gave it (#855).**
  In an instance's detail, the reason under `state` was a quote in
  quotation marks that named nobody. It now reads after the words that say
  who gave it: `OATS says: …` for a kernel,
  `oats tui's terminal check says: …` for the check of the terminals, and
  `oats tui's read of other machines says: …` for the read of the other
  machines. A reason whose speaker is not known is still in quotation
  marks. A reason that is withheld is `[withheld]` alone, with no speaker
  in front and no quotation marks. One sentence stands as it is, with
  neither: the one about a session backend OATS no longer has, for an
  instance whose OATS is too old to give its own. It is still a preview:
  its screens and its configuration file may change without notice.
  [docs/tui.md](../tui.md) has the rest.
