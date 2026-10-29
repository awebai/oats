## Changed

- The warm reader (`oats reader --stdio`, #1630) starts with only the code
  its reads use: the CLI no longer loads its whole command set for it first.
  Its hello comes about twice as fast (139 ms instead of 299 on a real
  deployment), and it holds about 30 MiB less memory for its whole life
  (104 MiB instead of 133 while it answers a poll). Its protocol, its answers
  and its install stamp are unchanged; a client needs no change
  ([The warm reader](../desktop-cli-api.md#the-warm-reader)).
