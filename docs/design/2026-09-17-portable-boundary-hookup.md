# Captured boundary resource hookup

This integrates the [IC1 resource-only correction](2026-09-17-portable-boundary-resources.md) into actual captured preparation. It is not a change to legacy injections, provider memory behavior or native launch readiness.

`completePreparedResources` now inventories and selects:

| Stable block label | Retained file |
| --- | --- |
| `kernel:oats-portable` | `injects/oats-portable.md` |
| `kernel:instance-boundary` | `injects/portable-instance-boundary.md` |
| `work-mode:directory` | `injects/portable-work-directory.md` |

Labels and order are unchanged. The captured resource bundle no longer includes the old instance-boundary or work-directory files. Other modes retain their own resource mapping rather than receiving directory behavior; unsupported materialization still refuses before creating a home. No old captured record or retained artifact is rewritten.

The existing `ResourceRef`/`InstructionComposition` schema supports these exact file references without a wire change. Full persistent and helper records are validated against the shared structural schema, then their composed text and resource ownership/path/bytes are checked through the actual captured loader.

The focused source-deleted composition regression verifies the combined portable kernel + boundary + directory doctrine: explicit execution binding and owned incarnation, canonical aliases, read-only retained source, authorized work surface, and no cwd/repo configuration authority or unsupported lifecycle/recovery promise. It asserts exact retained bytes and paths for both subject kinds, unchanged block order, absence of the specific old operative clauses, and refusal—not current-package fallback—after a retained boundary file is removed from the isolated fixture.

The new resources' own retention tests remain resource-only evidence. The complete preparation/composition regression supplies the additional IC1 integration evidence. Existing legacy scaffold-only layout/retire coverage remains separate. Neither proves real provider privacy, managed runtime/helper start, or production acceptance.
