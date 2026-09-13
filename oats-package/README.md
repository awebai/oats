# Optional OATS knowledge theory — 1.0.0

`oats.knowledge-theory` is an optional distribution exporting one additive
capability, `oats.knowledge-theory`. It provides `knowledge-theory-expert` and
`knowledge-capability-authoring`, including their complete local reference set.
It declares no knowledge layer, injection, hook, command, dependency or template.
It is not a runtime harvester or mandatory doctrine package. OKF is not required.

This is a **Git-distributed OATS package**, not part of the kernel npm tarball.
The npm kernel ships public documentation and the CLI; this optional payload
is acquired separately through normal Git sources (or a catalog entry once
pinned). Git preserves the canonical source `CLAUDE.md -> AGENTS.md` alias.
Because npm omits symlinks, shipping a partial copy there is not supported;
neither acquisition nor integrity verification synthesizes a missing alias.

After the immutable framework `v0.23.0` tag is published, select a scope and
opt in explicitly:

```bash
oats install git:github.com/awebai/oats@v0.23.0 --dir /path/to/scope
oats use oats.knowledge-theory --soul <author-soul> --dir /path/to/scope
```

The default Git package path is `oats-package/`. A catalog shortcut can follow
only after the immutable tag exists; there is no prerequisite catalog pin.
For local development, acquire the complete source directory with
`oats install /path/to/source/oats-package --dir /path/to/test-scope`.
Acquisition alone activates nothing. Integrity is locked, but there are no
executable surfaces to approve. The expert becomes discoverable on capability
declaration and carries its own skill even with soul-targeted use. No memory
files are assumed when the deployment selects `knowledge: none`.

The curriculum begins at
[the local authoring guide](capabilities/oats-knowledge-theory/skills/knowledge-capability-authoring/references/knowledge-capability-authoring.md).
Installed experts use the copy materialized in their skill, never assume an
OATS checkout under their work tree, and never fetch mutable doctrine at runtime.

Compatibility is conservatively set to OATS >=0.22.19, the existing package,
capability-agent and exact-skill materialization baseline. No unreleased generic
knowledge runtime API is required. The package version is independent of the
framework's release version; a Git source selects this repository's
`oats-package/` subtree at the maintainer's actual release tag/commit.

Canonical reference sources are `docs/knowledge-capability-authoring.md` and
`docs/knowledge-reference/` in the framework repository. Maintainers synchronize
with `node scripts/check-knowledge-theory-package.mjs --write`, then run the
checker without `--write` and `node --test test/knowledge-theory-package.test.mjs`.
These maintainer commands are not needed in an installed expert's work tree.
