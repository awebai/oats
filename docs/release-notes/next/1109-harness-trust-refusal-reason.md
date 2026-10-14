## Fixed

- When `oats harness trust` refuses a configuration file, the refused row now
  says which check refused it (for example a macOS extended-attribute marker,
  more than one hard link, another owner, or an unsupported format), without
  repeating the file's content. A refused row no longer prints an empty current
  value and "missing" digests, which read as if the file had no trust, and the
  error message lists every refusal (#1109).

## Documentation

- [Harness trust](../harness-trust.md#when-the-writer-refuses) explains each
  refusal and the way forward on macOS when the file carries an attribute such
  as `com.apple.provenance`: leave the file as it is, accept Claude's own
  folder-trust dialog for the deployment folder under the configuration
  directory the launch uses, and check the `harness-trust` item of
  `oats readiness`. A refusal does not hold back `oats sync`, `oats readiness`
  or `oats doctor` (#1109).
