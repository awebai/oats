# okf-consultation — reference detail

The okf-consultation skill's detail. Read this when navigating links, when a search is noisy or empty, when a
receipt says `STALE`, or when a command errors. Run every command from your
instance home (`oats okf …` resolves your registered source there).

## Navigation, worked example

Task: "change how retries back off". Your soul owns `project/expert`.

```sh
oats okf index                      # ## project/expert (owns) … ## project/peer (reads)
#   * [Retry policy](decisions/retry-policy.md) - Why retries back off exponentially.
oats okf cat --base project /expert/decisions/retry-policy.md
#   … "superseded the fixed delay; see [the incident](../lessons/fixed-delay-storm.md)"
oats okf links --base project /expert/decisions/retry-policy.md
#   ok        /expert/lessons/fixed-delay-storm.md  (../lessons/fixed-delay-storm.md)
#   MISSING   /expert/decisions/jitter.md
oats okf cat --base project ../lessons/fixed-delay-storm.md \
  --from /expert/decisions/retry-policy.md
```

- `index` with a node name (`oats okf index expert` or `project/expert`) prints
  one index; `--base A` alone prints the base's root `index.md`.
- A link in a concept is relative to **that concept's directory**: pass the
  concept as `--from`, or use `links` to see every target already resolved.
- `/node/x.md` is always from the base root; a bare `node/x.md` without
  `--from` is also from the root.
- `ls --base A /node/decisions` shows each concept's `type`, `title` and
  `description` — use it to pick what to `cat`, not to read everything.
- `MISSING` in `links` is a dangling link (allowed by OKF; not an error).
  `REFUSED` is a link that would leave the base or is malformed.

## Search

```sh
oats okf search "backoff"                     # your nodes' bases, case-insensitive
oats okf search --node expert "jitter"        # one of your nodes
oats okf search --base project --node peer "rate limit"
oats okf search --all "idempotency"           # every bound base
oats okf search --regex "retr(y|ies)"         # opt-in regex
```

- Fixed string, case-insensitive by default (`--case-sensitive` to change);
  `--regex` is extended regex in Git bases, JavaScript RegExp in directory ones.
- Only `.md` files inside the base root; results are `{base, path, line,
  snippet}`, capped at 50 with "and N more" — narrow with `--node` or a longer
  phrase rather than paging.
- Search finds words, not meaning: when it's empty, try a synonym, then
  navigate from the index. A hit is a pointer; `cat` the concept before
  relying on it.
- Git bases search with `git grep` at the accepted commit (the first search of
  a node fetches its blobs in one batch); directory bases walk the files in
  place, bounded to 20000 files.

## Citing

Cite what you relied on as `alias/node/concept.md@<short-oid>`, the oid from
the receipt line (`— project@1a2b3c4d5e6f (fetched 2m ago)`). A directory base
cites its digest (`project@dir:9f8e…`). Cite in notes/, PR descriptions and
answers so a reader can see which accepted state you saw.

## Freshness

- Reads use the host cache's accepted commit if it was fetched within
  `consult-max-age` seconds (setting, default 300); older, the accepted branch
  is fetched first. `--fresh` fetches now. Neither ever selects another
  branch or commit: only the accepted one is served.
- Fetch failed (offline, auth, timeout): the last fetched accepted commit is
  served with `stale: true` and the reason in the receipt (`STALE:` in text).
  Say so if it matters to your answer; retry later with `--fresh`.
- No cached commit and no network → `E_BASE_UNAVAILABLE`: report it, don't
  guess from memory or from an old `./knowledge/`.
- Merged a PR a minute ago? `--fresh` sees it once it is on the accepted branch.

## Errors

| Code | Meaning / what to do |
| --- | --- |
| `E_BASE_UNKNOWN` | alias not bound; the message lists the bound aliases (`oats okf bases`) |
| `E_NOT_FOUND` | no such file at the accepted commit; the message lists the nearest directory |
| `E_NOT_MARKDOWN` | `cat` reads `.md` concepts only; use `ls` for a directory |
| `E_PATH` | escapes the base root, filesystem path, URL, hidden path, symlink or submodule |
| `E_RECOVERY` | a directory-base publication is pending; retry after it completes |
| `E_BASE_UNAVAILABLE` | the base can't be read and nothing is cached; report it |
| `E_REMOVED` | `refresh` no longer exists; use `index` / `cat` |
