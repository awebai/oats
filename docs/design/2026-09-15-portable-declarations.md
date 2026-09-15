# Portable declaration codecs — implementation contract

The new parser modules implement the accepted two-authority architecture's data
boundary. They do **not** yet change legacy CLI composition, acquire packages or
select a workspace. Captured-record primitives exist separately; complete
preparation and public consumer migration remain integration work.

## One safe syntax reader

`lib/config-data.mjs` reads new portable YAML and JSON with byte/depth/entry limits,
raw-byte integrity and JSON-pointer origins. It uses the exact locked `yaml` 2.9.1
runtime dependency instead of extending a hand-written partial YAML parser; the
shared strict JSON reader handles JSON input. New kernel manifests/locks include
that dependency. No dependency install scripts are used.

The automatic syntax choice treats a flow-root `{`/`[` as JSON. Callers reading
explicit YAML may select `format: yaml`; ordinary block YAML supports inline maps,
sequences of maps, quotes and block scalars. No line or nested mapping is silently
dropped. YAML anchors, aliases, explicit tags, merge syntax, duplicate/coercive keys,
non-finite numbers and multiple documents refuse. Quoted metacharacters remain data.
Lexer/CST processing is budgeted before AST composition; duplicate decoded keys
are checked with a linear own-key lookup rather than a quadratic composer scan.
Decoded maps have null prototypes. Origins refer to the original document and
pointer; optional spans are character offsets, not byte offsets.

## Soul v1

Canonical authored fields are in [soul.schema.json](../soul.schema.json); runtime
source semantics are centralized in `lib/source-spec.mjs`. The schema describes
shape and does not certify acquisition, containment, credentials or enrollment.

```text
schemaVersion: 1
name: research-expert
requires:
  capabilities:
    example.research:
      source: git:github.com/example/tools@main#packages/research
  messaging: any
defaults:
  tasks:
    capability: example.tasks
    source: repo:packages/tasks
knowledge:
  contract: alternate.documents
  version: 1
  payload:
    collection: research
teams: [experts]
resources: [references]
work: directory
```

`requires.capabilities` are intrinsic hard selections. Fundamental requirements are
`any` or a source-complete provider selection. Defaults supply source-complete
fallbacks or explicit `none`; optional additive defaults may disable a nonrequired
entry with `false`. Contradictions and workspace/operator choices belong to the
single resolver, not a second precedence implementation in the parser.

A provider selection has `capability`, `source`, optional non-secret `settings`.
An additive map entry obtains its ID from the key and has `source` plus optional
settings. The parser returns the unchanged declaration, normalized source entries
keyed by their original pointers, document origins and byte integrity. It does not
invent omitted defaults or providers.

Knowledge declarations use an opaque `{ contract, version, payload }` envelope.
Provider-owned validation supplies node/store or alternative semantics; this parser
must not require OKF fields. Parsing an arbitrary payload does not certify that its
contents are non-secret or that required external resources are configured.

Teams are offered aliases, not enrollment or wider-team consent. Extra resources
are canonical source-repository-relative paths; source projection later verifies
containment and complete retention. Work/runtime/model/yolo, `launch-config` and
`backend` are typed execution hints, not an inferred work repository or a policy
tier. Launch-config keeps the current 1–64-character name grammar; backend remains
tmux or herdr. This codec does not look up a named configuration, check host tools
or launch a backend.

The versioned format rejects `agent-types`, `type`, authored internal annotations,
and the old machine-local `repo` field rather than silently dropping them. Legacy
flat declarations remain migration inputs until the coordinated cutover. A local
capability path requires explicit local adoption authorization and an absolute
local base when relative; remote declarations cannot silently use the caller's cwd.

## Workspace, repository exports and external imports

`lib/workspace-definition.mjs` validates `oats-workspace.yaml`, repository `oats.yaml`
and the identical standalone/workspace external-soul reference. The schemas are
[oats-workspace.schema.json](../oats-workspace.schema.json) and
[oats-member.schema.json](../oats-member.schema.json); they reuse the soul schema's
selection/provider-envelope definitions. Runtime checks additionally enforce source
and path semantics, definition containment and duplicate aliases/repositories.
Both authorities share `portable-policy.mjs` selection-shape validation; neither
parser implements precedence or acquisition.

Workspace fields are schemaVersion, name, members, defaults, knowledge, teams,
catalogs and imports. Only schemaVersion/name are required; omitted lists admit
or activate nothing. Repository references have source and optional revision;
the parser leaves an omitted revision unresolved, not guessed as main. Discovery
must observe the intended hosting default branch and retain the exact observation.
Catalog references may additionally name an explicit contained index path.

An external import requires source, soul (exported path), revision and alias.
Its optional adoption object contains teamAliases, providers and bindings. Provider
choices use the same source-complete default-selection shape; the single resolver
later checks hard requirements. A team alias mapping is not wider-team consent.
The parser returns normalized references without creating an adopter-owned soul
or pretending the source repository is a member.

Workspace teams map aliases to provider/id pairs, with the reserved private entry
accepting only per-human. Knowledge stores and exported stores use provider-owned
contract/version/payload declarations; there is no imposed OKF node schema here.
No parser result claims enrollment, private-team identity or privacy qualification.

Repository exports contain souls, packages and knowledge lists. A soul export gives
an identity path plus an explicit definition path inside it, accommodating direct
and nested soul layouts without guessing. Package exports give their contained
package root. A public source index may omit workspace; that is not organizational
admission. Duplicate import aliases/member locators report both origin pointers.
Qualified hosting identity and reciprocal admission are the next discovery layer.
`lib/portable-identity.mjs` validates their value shapes: host/provider/repository ID
or an explicitly canonical remote; a soul adds its exported path; a workspace names
its oats-workspace.yaml. Alias, revision and local checkout placement are not parts
of a Git soul identity. Local-only souls have explicit canonical path identities.
These validators do not turn authored IDs into observed hosting authority or grant
membership; the discovery adapter must establish the actual facts.

## One choice engine

`lib/portable-choices.mjs` resolves field-level inputs through one algorithm. A
requirement is either equality with a concrete value or required presence. Candidate
kinds are workspace-default, soul-default, import-adoption and operator. This is
constraints plus bounded fallbacks, not a repository policy tier or a general
expression/version solver.

A concrete requirement seeds selection; an incompatible ordinary fallback is
recorded as overridden, not a false conflict. Incompatible adoption/operator choices
or conflicting hard/equal-authority inputs report both origins. Abstract presence
with no concrete binding reports needs-configuration. Results include selectedBy,
constraints and considered origins; they are choice plans, not installed/trusted/
enrolled readiness or captured-resolution authority.

Choice keys are JSON-pointer-shaped field names. Field codecs normalize disabled or
unbound selections to null; the generic engine does not guess from strings such as
none. False, zero and empty arrays can be legitimate data bindings. The source-aware
preparer must supply validated typed selections and retain the authored provenance.
No I/O or provider-specific payload interpretation belongs in this engine.

## Source-aware software plan

`lib/portable-composition.mjs:planSoftwareChoices` now compiles validated soul and
workspace parser results, qualified import adoptions, explicit operator policy and
provider-supplied hard fields into that SAME engine. `soul-constraints.mjs` supplies
the hard facts used by both planning and captured-record verification. It does not
implement another precedence algorithm.

Selections and settings retain their original document/pointer. The plan exposes
selected capability sources, zero/one providers per fundamental slot and per-setting
choice references. Inactive alternatives remain explanatory history, not executable
configuration. Two selected fields cannot assign different sources to one capability
ID. A required provider with no selection remains needs-configuration; no repository
capability-default tier or implicit provider is introduced.

A repo: choice carries its declaring source locator and exact Git revision or explicit
local context alongside the relative path; retained local bytes have separate witnesses. The same path in workspace and soul repositories is not
the same package. Operator repo: inputs need an explicit source context, never cwd.
The shared source codec validates normalized choice fields against their source/path
rather than allowing a contradictory URL or extra annotation. Local-path selection
still requires explicit authorization and is never executable trust.

Discovery must supply qualified adoption identities; aliases do not select the
upstream soul. Matching canonical-remote identities must agree with the import source.
Contradictory adoption fields for the same identity report both origins. Binding
values and team-alias maps are retained as data, not provider execution or enrollment.

This is a private SOFTWARE plan, not public readiness or a completed captured
composition. Provider declarations/stores stay opaque. Their non-secret classification,
concrete binding resolution and fixed-field constraints must join the same pipeline
before a public preview or complete capture; do not dump unclassified provider input.
No fetch, package materialization, trust write, membership claim or native dispatch
occurs here. Four focused planner tests cover anchors/hard seeds, precedence/missing
providers, qualified adoption conflicts and cross-field source collisions.
