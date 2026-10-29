## Changed

- `oats status` and `oats workspace status` do less work per read, with the same answers ([awebai/oats#1630](https://github.com/awebai/oats/issues/1630)). `status` shares each instance home's `instance.json`, as its listing read it, with its legacy-home check and its waiting-claim read instead of each parsing it again, and `workspace status` asks git for a member clone's remotes once, where it verified the clone an automation lives in twice. Nothing is kept between reads, in the CLI or in the warm reader (`oats reader --stdio`).
