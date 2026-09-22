# Workspaces, repositories and portable souls

A **workspace definition** describes a shared agent setup in Git. A **local deployment** is one operator's realization of it. A **portable soul** declares its role, requirements and software sources independently of either operator's directory layout.

This is the current OATS architecture. Start here for the model, then use [first-team onboarding](first-team.md) and the version-scoped [configuration](configuration.md) and [packages](packages.md) guides for operations. The [0.24 release notes](release-notes/v0.24.0.md) distinguish shipped foundations from unqualified profiles; an accepted architecture is not proof that every capability is ready.

## Four independent things

| Thing | What it decides | What it does not imply |
|---|---|---|
| Workspace | Intended repository membership, shared defaults, source imports and provider declarations | Installed software, executable approval, messaging enrollment or a shared live session |
| Source repository | The soul/package/store definitions it actually exports | Membership of every consumer in the publisher's workspace |
| Local deployment | Local mappings, retained artifacts/resolutions, operator inputs and execution state | Permission to change source requirements or copy another operator's credentials |
| Work target | Where an instance is assigned to work | Where its soul must be published, where knowledge must live or which team it joins |

A workspace needs no OATS account, registry or OATS-operated control plane. Git hosting, messaging and model providers retain their own access and authentication requirements.

## The three declaration files

### `oats-workspace.yaml` — the shared workspace

The workspace names intended members and may provide defaults, knowledge-store declarations, team aliases, catalogs and external soul imports. Omitted lists admit or activate nothing.

A workspace is a role, not a requirement for a separate repository. It can live in a dedicated repository or beside project code. For OATS development, the selected home is the `oats` framework repository; `oats-dev` remains a development-capability repository.

This schematic example uses placeholder sources, not a runnable published team:

```yaml
schemaVersion: 1
name: example-development
members:
  - source: git:github.com/example/service
imports:
  - source: git:github.com/example/experts
    soul: souls/domain-expert
    revision: reviewed-source-ref
    alias: domain-expert
```

Use actual reviewed source revisions when preparing work. When a repository reference omits its optional revision, discovery observes the hosting provider's intended default branch; it must not guess `main` or silently reuse unrelated local branch state.

### `oats.yaml` — a repository's advertised exports

A repository advertises the souls, package roots and provider-owned knowledge declarations it actually supplies. A member also points back to its workspace:

```yaml
schemaVersion: 1
workspace:
  source: git:github.com/example/workspace
exports:
  souls:
    - path: souls/domain-expert
      definition: souls/domain-expert/soul.yaml
  packages:
    - path: oats-package
```

Only include exports that exist at the selected revision. A repository need not export every kind. A package export identifies a real directory containing `oats-package.json`; it is not an arbitrary npm package directory.

`oats-workspace.yaml` and `oats.yaml` may coexist. If the workspace host also participates as a member, it is explicitly admitted and has a matching backlink just like another member.

### `soul.yaml` — a source-complete specialist

A portable soul is an authored definition, not a dependency on whatever happens to be installed on its publisher's machine. It contains canonical `AGENTS.md`, a relative `CLAUDE.md` alias, its reviewed skill/resource closure and a versioned declaration.

For example, this declaration excerpt requires a particular knowledge capability **and names where it comes from**:

```yaml
schemaVersion: 1
name: domain-expert
requires:
  knowledge:
    capability: oats.okf
    source: git:github.com/awebai/oats-okf@v2.1.3#oats-package
```

This illustrates software selection, not complete OKF provisioning: the chosen capability also needs its own valid knowledge declaration, bindings and accepted base.

- `requires` expresses hard requirements. A fundamental provider can be required by presence or as a concrete capability/source selection.
- `defaults` supplies choices that remain rebindable within those requirements.
- Additive capabilities are named under `requires.capabilities` or `defaults.capabilities`; each concrete selection has a `source`, with optional provider-owned settings.
- `git:` selects versioned software from a repository/package root. `repo:` refers to a contained path in the declaring source repository, not the caller's working directory. `path:` is an explicitly authorised local development choice, not a remotely portable ambient fallback.
- Capability IDs alone do not establish software origin. An old `from: installed` config entry is not a substitute for a portable source declaration.
- A source may contain authored knowledge snapshots or resources, but retained artifacts are not writable knowledge stores. Learning locations and procedures belong to the selected capability.

See the [soul schema](soul.schema.json) and [declaration contract](design/2026-09-15-portable-declarations.md). Classic fields such as `kind`, `type` and a machine-local `repo` are not portable declaration fields; do not relabel an old file without validating it.

## Membership and adoption are different

**Repository membership is reciprocal:** the workspace admits the repository and the repository's `oats.yaml` points back to that workspace. Both observations must have compatible identity, access context and revision evidence. A copied backlink, neighbouring folder or URL is not admission.

**Source adoption is by reference:** an import identifies `source`, exported `soul` path, `revision` and a local `alias`. It may carry supported adoption choices. Importing does not create an adopter-maintained copy of the soul or automatically follow the publisher's workspace backlink.

A team can therefore use a public expert without joining its publisher's organization. One source can serve several workspaces or an explicit standalone context, with different legitimate work targets and knowledge bindings.

Publish source/export revisions before pinning imports to them. Do not use invented future SHAs or require two repositories to contain each other's not-yet-created commit IDs.

## How requirements and defaults meet

The kernel uses one resolver:

- Workspace defaults establish shared fallback choices.
- The soul's own defaults can specialise them.
- Explicit adoption/operator choices select supported alternatives or supply missing inputs.
- Hard source requirements remain constraints; a conflicting override is an error, not a reason to discard the requirement.

Provider-owned declarations remain opaque to the kernel until the selected provider interprets them through its contract. There is no portable repository-level capability policy tier silently inherited from the publisher, and no mandatory agent-type hierarchy replacing a soul's own requirements.

Repository briefing/worktree setup remains work-target behavior with its own supported authority. Merely placing a repository `AGENTS.md` nearby does not guarantee it is composed into every harness's instructions.

## From a definition to a running instance

1. Select an explicit workspace or standalone context, source reference, deployment location and work target.
2. Observe actual source identities/revisions and check requested reciprocal membership.
3. Resolve requirements, defaults and operator inputs; retain the selected source and software closure.
4. Review and approve exact executable artifacts before provider code runs.
5. Obtain honest provider readiness and a retained resolution; missing configuration or unsupported behavior remains visible.
6. Scaffold and start through the supported captured lifecycle. Preserve the exact source/resources and evidence needed for continuation.

An existing instance does not silently adopt a new upstream commit, changed workspace default or different curriculum. Updates prepare new choices deliberately; required knowledge refresh and native credential rotation are separate from rewriting its retained software.

A successful lookup is not execution, an accepted dispatch is not completed work, and a declared knowledge destination is not accepted learning.

## What each operator shares or keeps local

Share reviewed definitions, relevant nonsecret configuration/provenance, published source references and accepted knowledge through their chosen Git repositories. Keep credentials, private runtime evidence, instance homes and machine-specific realization local. A messaging roster does not replicate any of these.

An adopted package config template is an editable local snapshot, not live inheritance from the package. Updating the kernel or package does not rewrite it, migrate a knowledge base or update a running instance's loaded instructions.

## Compatibility and current readiness

Classic `oats-config.yaml` scopes, `oats init`, `oats use`, local `agents/` lookup and lock-v2 package restore still have their own supported contracts. They are not renamed portable workspace commands. See [configuration](configuration.md) and [packages](packages.md) for that compatibility surface; do not apply classic lifecycle commands blindly to captured instances.

At the documented0.24 baseline, workspace/declaration/retained-execution foundations are shipped. The released `oats.aweb`1.10.3 package lacks the captured provider-binding interface, so its legacy messaging success does not qualify a new captured profile requiring it. Capability adaptation is implementation work, not a YAML setting that can honestly turn readiness green. Follow current [release scope](release-notes/v0.24.0.md) and the provider's actual version/readiness rather than removing requirements.

The project's [adoption plan](design/2026-09-20-workspace-and-portable-adoption-plan.md) puts workspace/source adoption first, centralised knowledge and five experts second, and full Desktop parity afterward.

## How a soul knows OATS (accepted direction, not yet shipped)

An agent's knowledge of OATS itself — how to check status, spawn and retire, find other souls — is ordinary capability content, not kernel magic:

- **`oats.core`** carries day-to-day operation (skills `oats-operate`, `oats-souls`, the "you run on OATS" briefing). Every soul gets it **by default at creation, written explicitly into its definition**; you can remove or replace it.
- **`oats.setup`** carries deployment/workspace configuration and package knowledge ("OATS Soul Setup"). Onboarding a workspace creates and starts an **`oats-setup-expert`** soul with both, which then adopts repositories and creates the team's other souls.
- The **official marketplace** is the reviewed package list in the `oats` repository; a package becomes official through an approved PR to that list, and official packages are discoverable from the CLI and Desktop. Discoverable is not installed; installed is not approved.

At the0.24 baseline these skills still ship inside the kernel. Work packages D1–D4 of the [adoption plan](design/2026-09-20-workspace-and-portable-adoption-plan.md) track the move.

## Related references

- [Souls and instances](souls-and-instances.md)
- [Capability contracts](layers.md) and [capability authoring/distribution](capabilities.md)
- [Knowledge model](knowledge-theory.md) and [version-scoped operations](knowledge.md)
- [Workspace schema](oats-workspace.schema.json) and [repository export schema](oats-member.schema.json)
- [Design/contract navigation](design/README.md)
