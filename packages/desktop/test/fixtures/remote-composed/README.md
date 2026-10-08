A hand-written `oats server roster --json` answer in the RK shape agreed for
OATS 0.49.0 (feature `server-probe-features`), not captured from a kernel: the
kernel side was not merged when it was written. Each group's `probe.features`
is the host's own `oats version --json` features list as the kernel relays it:

- `g-composes`: a list naming `soul-composed-instructions`.
- `g-other`: a list without it.
- `g-none`: `[]`, a host that reported no features.
- `g-older`: `null`, a host older than 0.49.0 or a list the kernel would not relay (unknown).
- `g-failed`: a failed pull, `{ ok: false, error }` with no `features` key (unknown).

Replace it with a captured answer once the kernel part lands.
