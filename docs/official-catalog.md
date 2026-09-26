# The official OATS catalog

The official catalog is the reviewed [package-catalog.json](../package-catalog.json)
list in [awebai/oats](https://github.com/awebai/oats), not a separate registry
service. **A package listed there is official.** A name, logo, repository owner
or workspace membership alone does not make a package official.

## Find and use packages

- Browse the catalog for the kernel/source version you use. Each package entry
  identifies its repository, release ref and payload root; capability aliases
  can point to the package that supplies them.
- A workspace pins an official package by **bare version** in its
  `packages:` map (`oats.okf: v2.1.3`); `oats sync` resolves it through the
  catalog to an exact commit, fetches it, verifies its integrity and locks it.
  A package outside the catalog is written `git:<repo>@<ref>`.
  Pinning does not enroll a team or adopt the publisher's workspace. See
  [packages](packages.md).
- The Desktop catalog view/search is **planned for the parity phase**, not
  shipped by this policy. There is no catalog CLI verb.
- **Discoverable ≠ declared.** A catalog listing grants nothing; a
  `packages:` pin is the workspace's decision to trust that package at that
  version, and the lock pins it to an exact commit and integrity. Nothing is
  installed.
  Official status never grants trust, credentials or permission to run code.
- Listing also does not prove that every harness, provider combination or
  deployment profile is supported. Check the package's declared compatibility,
  requirements and current readiness limits.

## How a package becomes official

1. Publish a source-complete release and open a PR to `package-catalog.json` in
   `awebai/oats`, giving the package's URL, immutable tag ref and payload path.
2. Include evidence for the acceptance criteria below. External packages go
   through the same process as packages maintained in the OATS repositories.
3. An OATS maintainer reviews the entry, its exact release and trust posture.
   Officialness follows the reviewed list change, not an unmerged proposal.

### Acceptance criteria

- **Complete source:** a valid `oats-package.json` at the declared payload root,
  with all exported capabilities, instructions, skills, references and required
  runtime files contained in the supported package closure.
- **Immutable release:** a real published tag resolving to the reviewed commit,
  with reproducible payload/integrity evidence. Do not list a floating branch,
  invent a future ref or move an already published tag.
- **Valid declarations:** capability manifests validate against the supported
  schema and state truthful identities, compatibility and requirements.
- **Honest execution surface:** commands, hooks, launch environment and other
  executable contributions are declared accurately. Review their effects: a
  workspace that declares the package trusts exactly the locked version, not
  its official name.
- **Maintainership:** a documented, reachable maintainer contact or maintained
  issue/security-reporting route.
- **License:** clear redistribution terms for the package and its dependencies,
  with required license notices included in the distributed payload.
- **No secrets:** no credentials, signing keys, tokens or private instance state;
  only supported nonsecret configuration and credential references where needed.
- **No hidden prerequisites:** host/runtime requirements use the supported
  manifest fields; external services, network access and operator setup/consent
  are documented. Do not conceal an installation or host mutation in setup code.

Contact and license evidence may live in the package/repository documentation;
this policy does not invent new catalog or manifest fields.

## Listed first set

- Listed capabilities: `oats.okf`, `oats.okf-harvest`, `oats.okf-maintenance`,
  `oats.aweb`, `oats.authoring`, `oats.jira`, `oats.linear`, `oats.dev`,
  `oats.knowledge-theory`, `oats.core` and `oats.setup`. `oats.okf-harvest` and
  `oats.okf-maintenance` select the `oats.okf` package (4.0.0).
- **`oats.framework` 1.3.1** is listed at tag `oats-framework/v1.3.1` in
  `awebai/oats`, payload root `oats-package`. The `oats.core`, `oats.setup` and
  `oats.knowledge-theory` aliases select that distribution; package identity is
  distinct from capability identity. Core supplies operation/soul guidance;
  setup supplies OATS Soul Setup, configuration and package guidance. The
  package also ships the `knowledge-theory-expert` package soul.

These entries are in the current repository catalog. An older installed CLI keeps
its bundled catalog; publication here does not update that installation or rewrite
locks or tags. No package is silently added to an existing workspace.

## Updates, deprecation and removal

Use the same catalog PR and maintainer-review path to update, deprecate or remove
an entry. State the reason, affected releases and supported replacement or hold,
and assess existing locks/restores before changing discovery. Preserve immutable
release history. A list change is not permission to rewrite a deployment's locks,
change what a workspace declares, uninstall packages or delete retained resources.
