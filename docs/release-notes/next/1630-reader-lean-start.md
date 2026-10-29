## Changed

- The warm reader (`oats reader --stdio`, #1630) starts with only the code
  its reads use: the CLI no longer loads its whole command set for it first.
  On a real deployment its hello comes in about 140–180 ms instead of about
  300, and it holds about 20 MiB less memory while it answers a poll. Its protocol, its answers
  and its install stamp are unchanged; a client needs no change
  ([The warm reader](../desktop-cli-api.md#the-warm-reader)).
