# Portable declaration codecs — implementation contract

The new parser modules implement the accepted two-authority architecture's data
boundary. They do **not** yet change legacy CLI composition, acquire packages or
select a workspace. Captured records, preparation and consumer migration remain
separate integration work.

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
containment and complete retention. Work/runtime/model/yolo are typed execution
hints, not an inferred work repository or a capability-policy tier.

The versioned format rejects `agent-types`, `type`, authored internal annotations,
and the old machine-local `repo` field rather than silently dropping them. Legacy
flat declarations remain migration inputs until the coordinated cutover. A local
capability path requires explicit local adoption authorization and an absolute
local base when relative; remote declarations cannot silently use the caller's cwd.
