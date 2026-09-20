# Framework capability payload

The Git-distributed **oats.framework 1.1.0** source candidate exports three
independently selected resource capabilities. Package identity/version and
capability identities/versions are separate; see `oats-package.json` and each
`oats.json` for the exact metadata. The former distribution identity was
`oats.knowledge-theory`; that capability id is unchanged. This rename does not
migrate old locked package identities: preserve their exact published sources
and catalog compatibility, and never hand-edit an existing lock to force it.

| Capability | Resources | Authority |
| --- | --- | --- |
| `oats.core` | `oats-operate`, `oats-souls`, and the capability-owned “You run on OATS” injection | Operation/discovery guidance only; no hooks, commands or fundamental layer |
| `oats.setup` | `oats-config`, `oats-packages`, `oats-workspace-setup` | Setup/approval guidance only; no automatic provisioning or fundamental layer |
| `oats.knowledge-theory` | `knowledge-capability-authoring` and `knowledge-theory-expert` with their complete local references | Optional authoring theory; no mandatory runtime doctrine, harvester or OKF dependency |

The knowledge-theory capability keeps its existing 1.0.1 identity/content and
>=0.22.19 capability floor. The expanded distribution and the two new capabilities
require OATS>=0.24.0. This source change needs coordinated publication/catalog
updates; an older published package does not acquire these exports retroactively.
Do not invent a release tag or claim install-by-ID before its catalog entry exists.

## Acquire and select deliberately

The selected Git source must be an actual reviewed/published revision containing
these exports. Its package root is `oats-package/`, not the npm root. For a bounded
local development fixture use the complete directory:

```bash
oats install /absolute/reviewed-source/oats-package --dir /absolute/test-scope
```

Acquisition activates nothing. Resource-only capabilities have no executable
surface to approve, but still require exact integrity and explicit selection.
For a portable soul, declare the selected capability and actual package source in
`requires.capabilities`; the dependency is visible and removable. The kernel does
not gain permission to add it secretly. Classic activation/configuration remains
version-scoped compatibility behavior, described in the setup skills.

The 0.24 classic kernel still supplies `oats-config` and `oats-packages`; D1 does
not remove those copies. Explicit duplicate-skill resolution or the separately
reviewed kernel transition is needed before claiming coexistence in that path.
No stored composition/live instance is edited by packaging this content. Creation
of an `oats-setup-expert`, soul defaults and catalog entries are separate work;
this package does not implement new workspace init/adopt commands.

This is a **Git payload**, not part of the kernel npm tarball. Git preserves the
canonical theory expert's `CLAUDE.md -> AGENTS.md` alias. Acquisition/integrity
verification must not synthesize an alias missing from a partial npm copy.

## Content movement and qualification

The core skills move the existing `skills/oats` lifecycle/relations material and
relevant `oats-getting-started` creation/discovery procedure, with the existing
portable operation procedure so the new skill names do not imply a legacy
fallback. The injection moves from `injects/oats.md`. Setup moves `oats-config`
and `oats-packages`, corrects stale ambient-skill/bundled-provider claims, and
distills `docs/workspace-adoption.md` into a capability-owned workspace skill.
Kernel originals stay in place for the separate transition; no deleted kernel
setup skill is recreated here.

The skills state release-scoped limitations. In particular, oats-aweb 1.10.3
lacks portable binding support; **oats-aweb 1.11.0** (requires OATS >=0.24.2)
adds it; **1.11.1** (OATS >=0.24.4) declares its fixed reasons so the kernel can show them. It and qualifies only an input-capable Claude/Codex profile with explicit
`delivery: session` — a strict-Pi print primary still reports
`needs-configuration`. Required messaging cannot be disabled to make an
adoption pass. Metadata, preparation, native readiness,
message delivery, worker completion and accepted Git knowledge publication are
not interchangeable evidence. No runtime/identity/team/credential behavior is
implemented by these resource-only capabilities.

The optional theory curriculum begins at
[the local authoring guide](capabilities/oats-knowledge-theory/skills/knowledge-capability-authoring/references/knowledge-capability-authoring.md).
Its generated reference bytes and canonical source alias are unchanged. Maintainers
use `node scripts/check-knowledge-theory-package.mjs` for the full three-capability
manifest/inventory gate; `--write` still only synchronizes the theory references
from canonical docs. Installed skills do not need the source checkout or that
maintainer script to perform their documented procedures.
