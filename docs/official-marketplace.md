# The official OATS marketplace

The marketplace is the reviewed [package-catalog.json](../package-catalog.json)
list in [awebai/oats](https://github.com/awebai/oats), not a separate registry
service. **A package listed there is official.** A name, logo, repository owner
or workspace membership alone does not make a package official.

## Find and use packages

- Browse the catalog for the kernel/source version you use. Each package entry
  identifies its repository, release ref and payload root; capability aliases
  can point to the package that supplies them.
- Today, `oats install <capability-or-package-id>` resolves official short names
  through the CLI's catalog. For example, `oats install oats.okf --dir /absolute/scope`
  selects the listed package; it does not enroll a team or adopt
  the publisher's workspace. See [package operations](packages.md).
- The Desktop marketplace view/search is **planned for the parity phase**, not
  shipped by this policy or by OATS 0.24. There is no new marketplace CLI verb.
- **Discoverable ≠ installed ≠ approved.** Acquisition and exact locking are
  separate from capability selection and per-capability executable approval.
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
  executable contributions are declared accurately. Review their effects;
  approval still binds to each capability's exact artifact, not its official name.
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

## Planned first set

- Already listed: `oats.okf`, `oats.aweb`, `oats.authoring`, `oats.jira`,
  `oats.linear`, `oats.dev` and `oats.knowledge-theory`.
- **Planned, not yet listed:** `oats.core` for OATS operation/soul guidance, and
  `oats.setup` for OATS Soul Setup, configuration and package guidance. Add their
  catalog entries only after their actual D1 package releases exist and pass
  review. They are not available merely because this document names them.

The [workspace adoption guide](workspace-adoption.md) describes the separate
planned setup-expert flow. No package is silently added to an existing soul.

## Updates, deprecation and removal

Use the same catalog PR and maintainer-review path to update, deprecate or remove
an entry. State the reason, affected releases and supported replacement or hold,
and assess existing locks/restores before changing discovery. Preserve immutable
release history. A list change is not permission to rewrite a deployment's locks,
revoke or grant local approvals, uninstall packages or delete retained resources.
