## Added

- **A soul's own skills, before a spawn.** `oats inspect --soul <soul>
  --skills --json` adds `souls[0].skills`: the skills a spawn of the soul
  copies (not its capabilities' skills), each with its `description` and
  every file's text, by the rules of `oats capabilities show`. The whole
  field carries at most 1 MiB of text; the files past that are listed with
  `omitted: true`. Nothing is read without the flag. No symbolic link is
  followed, and a skill whose files cannot all be listed and read has
  `files: null` with a problem. `--skills` combines with `--instructions`,
  refuses `--home`, and is routed with `--server` to a host that advertises
  the new feature `soul-skills`
  ([`oats inspect`](../desktop-cli-api.md#oats-inspect---home-----soul----dir----json--operationsapi-2),
  [#1144](https://github.com/awebai/oats/issues/1144)).
