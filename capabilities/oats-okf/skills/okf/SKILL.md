---
name: okf
description: >-
  Open Knowledge Format (OKF) craft: how to author, maintain, consume, and
  validate OKF knowledge bundles (directories of markdown concepts with YAML
  frontmatter, per Google Cloud's OKF v0.1 spec). Use when writing or editing
  concepts in a knowledge bundle or notes/, adding or renaming concept files,
  updating index.md or log.md, answering questions from a bundle, triaging a
  knowledge inbox, or when asked to validate a bundle. To consult your own
  soul's knowledge with `oats okf`, load the okf-consultation skill instead.
  Instance session protocol lives in the okf AGENTS.md injection, and
  promotion judgment in the memory-harvest skill.
---

# OKF craft — author, maintain, consume

An OKF **bundle** is a directory tree of markdown files. Each non-reserved `.md`
file is **one concept**; links between files form the knowledge graph. No
database, no SDK — plain git-versionable text. Spec: OKF v0.1 (Google Cloud).
An external base is one bundle and link namespace. Owned nodes are
nonoverlapping subdirectories, not separate root-link namespaces. Instance
`notes/` files are task-local concepts; no knowledge lives in the soul.

## Consulting your knowledge

Your soul's knowledge is read remotely with `oats okf` (`index`, `cat`, `ls`,
`links`, `search`, `bases`): there is no local copy. The **okf-consultation**
skill teaches the procedure; load it at the start of every task and whenever
you look something up. This skill is about the format itself.

## The format in one screen

- **Concept = one file.** Concept ID = path minus `.md`. Small and specific
  beats long and general — split rather than grow.
- **Frontmatter** (`---` delimited): only **`type`** is required (short,
  freeform — the spec ships no vocabulary. Fleet core: `Lesson`, `Decision`,
  `Playbook`, `Reference`; souls also grow role-specific types like
  `Area Guide` or `Roadmap` — see the memory-harvest skill for routing).
  Recommended,
  in order: `title`, `description` (ONE sentence — it's what index listings
  and skimming agents see), `resource` (URI, only if a real asset backs the
  concept), `tags` (YAML list), `timestamp` (ISO date of last meaningful change).
- **Links** are ordinary markdown, keep the `.md`, prefer bundle-root-absolute:
  `[clearing playbook](/node/playbooks/clearing-fields.md)`. Links are untyped
  directed edges; the surrounding prose carries the relationship's meaning.
- **Reserved files** at any level: `index.md` (navigation) and `log.md`
  (history). They carry **no `type`**; only the bundle-root `index.md` may
  have frontmatter, and only `okf_version: "0.1"`.
- **Conventional headings** when applicable: `# Schema`, `# Examples`,
  `# Citations` (numbered external sources backing claims).

## Honesty rules (non-negotiable)

- **Never invent** a `resource`, `timestamp`, or `description` — leave a field
  out rather than guess it.
- Every claim you write down should be something you verified or observed;
  cite sources under `# Citations` when the claim came from outside.
- Never create a link to a concept you didn't create or verify exists —
  except deliberate not-yet-written knowledge, which is allowed by spec but
  should be rare and intentional.
- **Supersede, don't silently rewrite.** When a concept's meaning changes,
  update it AND log the change; when it's wrong, correct it and say so in
  log.md (`**Fix**: …`). History must stay reconstructible.

## Maintaining a bundle

**Adding a concept:**
1. Write the file in the right section dir with valid frontmatter.
2. Link it to/from related concepts (edit those files' bodies).
3. Add a line to the section's `index.md`: `* [Title](file.md) - description`.
4. Append to the bundle's `log.md` (see conventions below).

**Renaming/moving a concept:** update **every inbound link** — search the
whole bundle for the old path (`grep -rn "old-name.md" <bundle>`) — EXCEPT
links inside historical `log.md` entries: never rewrite log history; dangling
links there are expected.

**Removing:** delete the file, remove its index.md line, fix inbound links,
log a `**Removal**` or `**Deprecation**` entry saying why.

**log.md conventions** (newest first, `## YYYY-MM-DD` headings):
`* **Creation|Update|Removal|Fix|Deprecation|Harvest|Triage**: prose with
[links](/path.md).` One line per event; the bold word makes logs greppable.

**index.md discipline:** every concept reachable from an index; descriptions
in listings match the concept's frontmatter `description`. Indexes are
navigation, not content — keep them to listings.

## Consuming a bundle (answering from knowledge)

1. **Index-first, always.** Start at the root `index.md`; follow only links
   relevant to the question. Never bulk-read a bundle — progressive
   disclosure is the point of the format.
2. Frontmatter (`type`, `tags`, `description`) is the quick filter layer;
   open bodies only for concepts that survive the filter.
3. `log.md` answers "what changed recently" — check it when freshness matters.
4. Cite concepts by path when reporting answers.
5. Tolerate imperfect concepts: unknown types and stale links are
   never a reason to reject or ignore a bundle — that permissiveness is spec.

## Validating

Run the bundled validator (node, no deps) after non-trivial maintenance:

```bash
node <skill-dir>/scripts/okf-validate.mjs <bundle-dir>            # conformance
node <skill-dir>/scripts/okf-validate.mjs <bundle-dir> --strict   # + producer lints
```

- **Conformance errors** (must fix): unparseable/missing frontmatter, missing
  or empty `type`, reserved files carrying a `type`.
- **Producer lints** (`--strict`, should fix in bundles you produce): broken
  intra-bundle links (log.md exempt), links missing `.md`, concepts
  unreachable from any index.md, missing `title`/`description`.

Lints in a bundle you're *consuming* are noise — read on regardless.

## Portable source and store declarations

When the portable binding interface is active (planned OATS >=0.24.0; not yet a
published provider baseline), treat the source declaration as policy and the
captured ProviderBinding as execution authority:

- In `oats.okf.locations@1`, `fixed` is source-owned, `default` is rebindable,
  and `inherit` requires an external binding such as `write.default`.
- Qualify every read and owned node by its declared store. A read grants no
  write authority. Never infer the sole readable store as a destination.
- Workspace store envelopes put concrete provider choices under
  `payload.bindings`. Workspace, adoption, and operator values remain separate
  inputs to the shared resolver; OKF does not select their precedence.
- Durable placement is explicit selected settings: physical absolute
  `bindings-file` and `state-dir`, plus selected `harvest-runtime`, optional
  `harvest-model` and optional `git-timeout` (seconds for remote Git
  operations, default 600). Never derive state from an instance home.
- Provider codecs run only after exact retained executable approval. Their
  populated binding is not proof of readiness, enrollment, credentials, privacy
  or publication authority. Respect typed non-ready results.
- Captured source descriptors freeze binding/runtime/source identity. Later
  reads and workers use those bytes after source/config deletion. Never replace
  them with today's soul, workspace, settings or bindings file.
- `responsibleHuman: null` means messaging was explicitly disabled. Missing is
  unknown, not disabled.
- New captured source schedules are definition v2 with `capture`, explicit
  deployment/resolution selectors and saved `--json`; they do not use `--soul`.
- Captured `setup`, `init`, `migrate`, and `unlock` are deliberate refusals.
  Provisioning/migration remains a separate explicit operator path.

The broker-owned `binding-normalize`, `binding-bind`, and `binding-check`
manifest commands are not manual recipes. Do not invoke them from a working
agent or copy transient `OATS_BINDING_FILE`/`OATS_SOURCE_RECEIPT_FILE` paths.
Those private mode-0600 files exist only for one synchronous captured invocation.

## External bases and native tools

Ordinary working agents consult with `oats okf index` / `cat` / `search`
(the okf-consultation skill). When inspecting a source, treat the additive `authority`
object literally: `captured` includes recorded qualified identity/execution;
`legacy` or `invalid` means migration/evidence is still required. A
responsible-human status of `disabled` comes only from explicit null; `unknown`
is not permission to assume messaging is off. The summary deliberately omits
opaque bindings, provenance, credential references and transient snapshot paths.

Staged writers use native file tools only under roots
listed in work/staging.json. Always validate the WHOLE base, not an isolated
node: absolute Markdown links can cross node boundaries. Complete performs this
validation again and refuses any errors or producer warnings.
