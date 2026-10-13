## Documentation

- **Upgrading: the Desktop goes before the CLI
  ([#1107](https://github.com/awebai/oats/issues/1107)).**
  [Upgrading OATS on a host](../upgrading.md) now says so, and why: a
  Desktop refuses a CLI of a newer minor version, so with the CLI moved
  first it lists no instance until it is replaced. The Upgrade section of
  the [0.53.0 notes](v0.53.0.md#upgrade) gained that step, and one for a
  host that comes from 0.51 or earlier: 0.52.0's steps first, the aw client
  among them, before `oats sync`.
