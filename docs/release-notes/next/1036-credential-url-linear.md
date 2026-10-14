## Fixed

- The kernel's check that keeps a value carrying a URL with credentials out
  of the parsed cache now takes time in proportion to the value's length.
  Before, a long run of dotted, hyphenated or plus-joined words in a
  repository value (such as `a.b.c.…`) made the check take time growing with
  the square of the run: a fraction of a second at 16 KiB, several seconds at
  64 KiB, on every read that wrote that value to the cache. Which values are
  kept out of the cache is unchanged.
  ([#1036](https://github.com/awebai/oats/issues/1036))
