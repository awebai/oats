## Added

- **`oats inspect --soul <soul> --composed-skills` lists every skill a spawn
  of the soul gives its instance** (feature `soul-composed-skills`,
  awebai/oats#1421): its own skills and each capability's, each with its
  `source` (`soul` or `module:<capability>`) and each file's text, from the
  same scratch composition as `--instructions`. A collision a spawn would
  refuse makes the field `null` with spawn's own message. It is opt-in, takes
  `--soul` only, and a routed host without the feature refuses it
  ([`oats inspect`](../desktop-cli-api.md#oats-inspect---home-----soul----dir----json--operationsapi-2)).

## Fixed

- **`oats spawn --preview` names each capability skill as the spawn copies
  it.** A manifest whose `skills` entry is a directory of skills (the
  documented `"skills": ["skills"]`) showed as one skill named `skills`, and
  a manifest with no `skills` showed none of the `skills/` directories the
  spawn copies. The preview now lists each of them, as `--composed-skills`
  does ([The preview](../desktop-cli-api.md#the-preview)).
