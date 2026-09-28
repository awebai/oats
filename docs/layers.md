# The OATS contracts

OATS supplies common contracts; capabilities supply behaviour. The kernel
discovers souls and capabilities, resolves what each soul gets, copies it into
an instance home and runs the lifecycle; it implements no knowledge, messaging
or task model of its own.

```text
workspace (oats-workspace.yaml)      members, packages, shared teams, defaults, stores
  └── soul (soul.yaml)               role, work mode, capabilities, slot choices
        └── resolution               exact commits and digests, recorded at spawn
              └── instance home      soul + copied capabilities + its own work view
                    ├── knowledge capability
                    ├── messaging capability
                    ├── tasks capability
                    └── any additional capabilities
```

The forms are in [workspaces.md](workspaces.md) and the schemas beside it;
capability manifests, hooks and readiness in [capabilities.md](capabilities.md).

## The three core capabilities

Knowledge, messaging and tasks are **slots**: a soul has at most one
capability in each, and `none` empties a slot. Any number of other
capabilities compose beside them. A slot provider declares `layer:` in its
manifest and may answer the kernel's [readiness check](capabilities.md#readiness-check-bindingcheck).

### The knowledge contract

The kernel supplies selection, the copied modules, the lifecycle hooks and
their environment. The knowledge capability owns everything else: where
knowledge lives, who reads and owns what, how evidence is captured and judged,
and how accepted knowledge is delivered. The official provider is `oats.okf`
([knowledge.md](knowledge.md), [knowledge theory](knowledge-theory.md)); the
boundary is the [knowledge and messaging capability contract](design/2026-09-16-knowledge-capability-contract.md).

### The communication contract

The slot is named **`messaging`**. The capability owns identity, addressing,
team membership, transport and wake delivery. The kernel supplies each soul's
teams in the hook environment ([capabilities.md](capabilities.md#teams-in-the-provider-environment))
and never joins a team itself. A team in a workspace file is a declaration,
not proof that an agent is enrolled. The official provider is `oats.aweb`.

### The tasks contract

The tasks capability owns assignment, claims, status, blockers and handoff.
`oats.jira` and `oats.linear` are the official providers. Messaging is
conversation, not task state.

## What the kernel does not own

- **The harness.** pi, Claude Code and Codex start normally, with their own
  authentication, models and permissions ([execution-targets.md](execution-targets.md)).
- **Operating knowledge.** How to operate and configure OATS is capability
  content: `oats.core` and `oats.setup` from the `oats.framework` package
  ([souls-and-instances.md](souls-and-instances.md#oats-operational-knowledge-is-a-capability)).
  The kernel writes only the home-versus-work and work-mode briefings.
- **Proof of readiness.** A valid manifest or a declared team is not a working
  provider; `oats readiness` asks the provider.
