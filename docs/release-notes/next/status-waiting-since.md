## Changed

- Plain `oats status` now shows when a running instance's needs-input claim
  started, in the CLI machine's local time, and how long it has waited
  (`under a minute`, minutes, hours or days). A start in the future shows
  only its time; an unparseable start keeps the previous line without time.
  JSON output is unchanged.
