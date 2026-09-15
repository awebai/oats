# Portable data and digest contract

Status: implementation foundation for the accepted Portable Souls architecture.
These codecs do not yet change installed locks, approvals or lifecycle dispatch.
The [retention contract](2026-09-14-artifact-retention-contract.md) and
[binding decisions](2026-09-15-portable-souls-handoff.md) govern the consumer migration.

## Explicit integrity identity

An integrity is `{ format, value }`, with a supported format name and the complete
`sha256-<64 lowercase hexadecimal digits>`. Format is part of identity and approval;
matching bare hex values from different formats cannot transfer trust.

| Format | Meaning |
| --- | --- |
| `oats.tree-exec.v1` | Complete retained tree, including materialized dependencies/provenance, with owner-execute semantics |
| `oats.package-payload-exec.v1` | Same encoding with the existing package exclusions: root oats-lock.json and all node_modules entries |
| `oats.json.v1` | Canonical UTF-8 JSON including exactly one final LF; no implicit hash prefix |
| `oats.bytes.v1` | Exact raw descriptor bytes; not canonical JSON or a tree |

Existing legacy digest functions and their exclusions/order/framing remain literal
in their current modules. They are not renamed to the new format or interpreted
as executable-mode evidence. The new format fixes both the missing executable flag
and the legacy ambiguity between arbitrary binary content and entry delimiters.
Computing a new digest does not prove historical bytes or grant approval.

## New tree encoding

The stream begins with the UTF-8 format name and one NUL. Entries are sorted by
UTF-8 bytes of their complete POSIX-relative paths, not locale or insertion order.
`L(bytes)` is an unsigned 64-bit big-endian byte count followed by those exact bytes.

```text
file:    F || L(path) || X || L(content)
symlink: S || L(path) || L(literal target)
```

F/S are single ASCII bytes. X is one binary byte, 0 or 1, from
`(mode & 0o100) !== 0`. Git and local-path materializations use this same rule.
Group/other execute bits, other permission bits, directory modes and empty
directories are outside identity. Copy/retention still preserves actual modes.
Links are not followed. Unsupported entries and invalid UTF-8 names/targets refuse;
there is no lossy normalization. Retention separately validates containment.

File reads use a descriptor and compare observed metadata before/after reading.
This is not a hostile-host or atomic whole-filesystem snapshot guarantee.
Resource limits bound traversal and bytes.

## Canonical records and strict ingress

`lib/portable-values.mjs` provides the shared canonical encoder and strict JSON
reader. The declaration decoder must use this reader for JSON, rather than another
permissive JSON.parse entry point.

- Emit object keys directly in UTF-8 byte order; rebuilding an object and calling
  JSON.stringify would reorder integer-looking keys.
- Preserve array order. Field-specific set validation/ordering belongs to the
  shared wire schema, not arbitrary provider payload normalization.
- Use ECMAScript primitive JSON serialization for finite numbers, including -0→0.
- Accept Unicode-scalar strings only. Invalid UTF-8 and escaped lone surrogates fail.
- Reject duplicate decoded JSON keys, including alternate escape spellings.
- Produce null-prototype decoded maps; consumers still use explicit own-key checks.
- Refuse cycles, sparse/extended arrays, unsupported prototypes, non-JSON values,
  symbols and accessor/non-enumerable properties. Do not invoke caller getters or
  toJSON. This is a data contract, not a sandbox for hostile JavaScript proxies.
- Apply byte/depth/entry limits. The canonical output ends with exactly one LF.

Record IDs, identity keys, source-request keys and artifact-set keys must use this
one encoding. Validate a stored record's content address before following its
references. Complete/evidence separation, graph budgets and semantic cross-reference
validation are the next record-store layer, not claims supplied by a digest alone.

## Shared portable source grammar

`lib/source-spec.mjs` is the pure new-format codec. It neither reads the filesystem
nor acquires anything, supplies credentials, observes hosting-provider identity,
or grants trust. It is not wired into legacy CLI/lock readers at this checkpoint.

- Intrinsic declarations use exactly `git:`, `repo:` or `path:`.
- Git declarations require an explicit revision selector; omitted package fragments
  use the documented `oats-package` default. `#.` and an empty fragment select root.
- The normalized source and canonical package path remain separate in lock rows.
- SSH user@host is authority, not a selector. Slash-bearing refs remain intact;
  ambiguous additional delimiters refuse rather than select another repository.
- Shorthand host/repository locators expand through the documented HTTPS/.git
  convention. Explicit repository endpoints retain their path; no .git suffix is
  invented for an explicit SSH/HTTPS/file endpoint.
- Repository/import/knowledge locators have no package-root default, ref or fragment;
  the surrounding declaration supplies revision and exported path separately.
- `repo:` is a repository-root relation at the captured soul revision, not a local
  path and not a new persisted package transport. Containment is also checked later.
- `path:` acquisition requires explicit local adoption authorization; relative local
  paths require an explicit absolute authoring base. No cwd or HOME inference.
- New-format locked values must already be canonical; reading does not repair them.
  Catalog convenience remains valid for package locks/CLI, never as the sole source
  of an intrinsic portable soul requirement. Captured provenance must preserve the
  actual resolution; a catalog ID is not immutable publisher authority.
- Existing legacy-format parsers remain literal evidence readers until their explicit
  migration. Consumer integration must route new values through this codec rather
  than adding private URL/ref splitters.
