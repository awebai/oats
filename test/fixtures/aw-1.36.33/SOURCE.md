# Real aw output used by the consumer fakes

The version and custody-status files are copied verbatim from
`awebai/oats-aweb` tag `v1.27.0` (tag object
`811b7cd1ab71f0f95ccf6b471e7a991fa78e5472`, commit
`e47569159d3714448c85945d2fa95d29913ed61b`),
`test/fixtures/resident/`. Each stdout/stderr/exit triple is one real run.

- aw 1.36.33, commit `877bbee94ce45aa1ff103912bc9850556e61dfb4`.
- Captured 2026-10-10T16:44:15Z.
- aweb local stack (`docker-compose.e2e.yml`) at
  `1d7ee6bb3519a3c940ebeb12afc86d921dc13e27`.
- Commands: `aw version`; `aw custody status --json` before and during
  `aw custody serve`, from the disposable initialized identity directory.
- Capture procedure and provenance: that tag's
  `test/fixtures/resident/capture.sh` and `test/fixtures/resident/README.md`.

The captures are fixture evidence, not proof of live service readiness.
Test-specific paths, identity names and deliberately injected faults in the
fakes are synthetic. The operation list comes from the running capture.
No aw source code was used to derive these output shapes.

## Grant captures

`grants/` is copied unchanged from the reviewed capture artifact:

- aw **1.36.33**, commit `877bbee94ce45aa1ff103912bc9850556e61dfb4`
  (`grants/aw-version.txt`).
- aweb local stack `docker-compose.e2e.yml` at
  `1d7ee6bb3519a3c940ebeb12afc86d921dc13e27`, on a GitHub runner
  (127.0.0.1 only).
- GitHub Actions run [38156966537](https://github.com/awebai/oats-aweb/actions/runs/38156966537)
  on awebai/oats-aweb (a throwaway scratch branch, since deleted).
- Captured 2026-10-11T16:48:53Z.
- Commands: `grants/COMMANDS.tsv`. The mint argv is the provider's own
  `grantMintArgv` from v1.27.0, with disposable identity
  `carol@fixture-29075.test`.

Every stdout/stderr/exit triple has exit 0. The second revoke of the same
ID succeeds with the same revoked response. Grant home `*.files` lists
filenames only: `grant-signing.key` was never copied.

`grants/REDACTIONS.txt` identifies every replacement by file, key and length.
Every redacted value is the same length of `x`, and the files are otherwise
byte for byte as aw printed them. The conservative redactor also masked
public fields: `grant_did_key` and `subject_did_aw` in lists,
`custody_socket_path` in mint stdout, and `minted_at` in grant YAML.
No credential is present.

The fake registry uses these captured fields and transitions, substituting
per-test IDs, labels, names, teams, scopes, paths and times. In particular its
mint `custody_socket_path` substitutes the test socket for the redacted value;
that substituted path is not captured evidence. Other redacted fields remain
redacted. Error responses, omitted optional fields for legacy coverage, and
mismatched identity/socket cases are explicitly synthetic fault injection.
