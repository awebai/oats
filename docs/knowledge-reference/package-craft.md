# Packaging the authoring result

This guide combines the framework's soul-craft/skill-craft rules with the
approved optional-theory boundary. It covers the local closure needed for a
knowledge-authoring hand-off; it does not invent a native provider API.

## Distribution and capability are different units

An OATS distribution has `oats-package.json` at its selected root, conventionally
`oats-package/` in a Git repository. It enumerates dedicated capability roots.
Each root contains `oats.json` and **all** its declared resources. Acquisition
materializes those capabilities independently; sibling repository docs do not
magically appear in installed agents. Config templates, if supplied, are source
material adopted explicitly, never ambient installed behavior.

A minimal distribution shape (replace example identities/descriptions):

```json
{
  "package": "example.knowledge",
  "version": "1.0.0",
  "description": "Example knowledge integration.",
  "compatibility": { "oats": ">=0.22.19" },
  "capabilities": ["capabilities/knowledge"]
}
```

A knowledge implementation's capability manifest might begin:

```json
{
  "capability": "example.knowledge",
  "version": "1.0.0",
  "description": "Native knowledge integration.",
  "compatibility": { "oats": ">=0.22.19" },
  "layer": "knowledge",
  "skills": ["skills/native-reader", "skills/native-harvest"],
  "inject": "injects/knowledge.md",
  "agents": ["agents/native-harvester"]
}
```

This is an incomplete authoring example, not a working provider. Author every
referenced file; declare actual host/runtime requirements, settings, commands,
operations and lifecycle hooks only once verified. Choose a compatibility floor
that covers the APIs actually used and test that version. The example floor is
not a claim every future implementation works on that kernel. Use the selected
kernel's real manifest validation, not this example as a complete schema.

The optional `oats.knowledge-theory` capability is deliberately **different**:
it is additive, declares no layer, injection, command or hook, and supplies
only an expert and its authoring skill. It neither selects knowledge policy nor
depends on OKF. A runtime integration should not depend on it just to inherit
mandatory doctrine. Explicit versioned reuse is a choice, not a requirement.

## Soul craft

A capability's `agents/<name>/` contains `soul.yaml`, canonical `AGENTS.md` and
relative `CLAUDE.md -> AGENTS.md`. Keep role instructions to a screen or two:
role and boundaries, operating loop, verification, local skill pointer,
escalation. Do not bury an entire curriculum in always-loaded instructions.

Ground the role in a real authoring/review task and its corrections. Mark an
untested role as such rather than inventing expertise. Omit deployment paths,
accounts, credentials and pending work. Packaged souls are read-only resources;
instances home locally. A knowledge-disabled expert must not assume `STATE.md`,
`notes/`, a soul knowledge bundle or a harvest command exists. Do not silently
pin a model or runtime if the role does not need that choice.

## Skill craft

Use `skills/<name>/SKILL.md` with YAML frontmatter:

- `name`: directory-matching lowercase alphanumerics/hyphens, at most 64 chars;
  no leading, trailing or doubled hyphens.
- `description`: nonempty, at most 1024 chars; describe tasks that should load
  the skill. A `>-` block scalar avoids colon-space YAML mistakes.
- Body: one coherent procedure, grounded gotchas, clear verification; keep it
  below 500 lines. Put detailed material in local `references/` with explicit
  “read when” links rather than loading it all every time.

Always-loaded role instructions, on-demand procedures and external accumulated
knowledge serve different purposes. A packaged reference curriculum is released
authoring material, not a mutable deployment knowledge base.

Check realistic trigger prompts and near-misses. Evaluate actual authoring
outputs with and without the skill before asserting agent effectiveness.
Syntax, link and package checks do not replace these agent trials.

## Complete installed-reference closure

Every normative reference needed by an installed expert must ship inside its
capability root. Prefer local relative links, resolved from each containing
file, and one maintained source with generated/checkable copies. Do not tell
an installed expert to read framework docs from its assigned work tree, reach
through a source checkout symlink, import private kernel files, or fetch mutable
web documentation as a hidden policy update. Provider investigation can still
use explicitly supplied versioned evidence; distinguish that from curriculum.

Keep canonical docs in the repository and verify copied bytes at release.
Check missing links, escaping symlinks, orphaned references, stale copies and
actual acquisition after removing the source tree. A package-level README does
not satisfy a skill's missing reference if it is outside the capability root.

## Acquisition, activation and trust

At an explicitly chosen *test* scope, acquisition and activation are separate:

```bash
oats install /path/to/source/oats-package --dir /path/to/test-scope
oats use example.knowledge --global --dir /path/to/test-scope
```

These are illustrative user operations, not instructions to change a live
deployment. The `oats`, `oats-config` and `oats-packages` kernel skills describe
the installed kernel's operational commands. Installation exact-locks the
package closure and activates nothing. Capabilities with executable commands or
hooks require per-artifact trust before execution. A skills-only package needs
lock integrity, not executable approval. Official catalog identity is not trust.
Targets belong in config, not manifests. A manifest with `layer: knowledge`
occupies that exclusive slot; an additive authoring aid must not replace it.

Use isolated fixtures for all probes, with no inherited capabilities, user
credentials, host timers or real runtime launch. No-launch can still run hooks.
Verify the capability's real acceptance cases separately from the generic
[package and closure cases](acceptance.md).
