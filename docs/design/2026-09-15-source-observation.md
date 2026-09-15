# Repository observation and source custody

`lib/repository-observation.mjs` implements real repository observations for the
forthcoming preparation transaction. It does not yet constitute workspace admission,
complete preparation, approval or runtime dispatch.

## One transaction, one observed snapshot

`createRepositoryTransaction` requires an explicit scratch directory and opaque
access-context key. Credentials remain in the host's native Git/gh facilities;
they are not extracted into source records. Caches are transaction-local, never
shared across authorization contexts. Original repository/index/object environment
is scrubbed without copying credential stores.

`observe(source, {revision, origin, expectedIdentity})` validates through the shared
source codec and records exact repository identity, selector and commit. GitHub
identity is obtained with the native gh API; other supported Git hosts use canonical
remote identity. An existing canonical identity is preserved explicitly rather than
silently upgraded. Unavailable identity, changed IDs and redirected/renamed GitHub
locators refuse, not silently fall back. No repository can assert its own hosting ID
in an authored descriptor.

Omitted revision means the hosting default branch or Git's actual symbolic remote
HEAD, never a guessed main. Requests and failed observations are memoized. The
resolved default branch and an explicit request for that same selector share one
snapshot; qualified provider identity also unifies transport aliases. Each returned
observation preserves the requested locator and origin. Changing an upstream ref
mid-transaction cannot advance an already observed identity/selector pair.

## No source checkout or source execution

The adapter uses an owned bare repository and fetches one shallow selected snapshot,
requesting blob filtering. It never checks out source files, runs source hooks,
loads source scripts, initializes submodules or applies checkout/smudge filters.
Git hooks are directed to an empty owned directory, external transports and automatic
HTTP redirects are disabled, and interactive Git prompts are disabled. Host credential
helpers/SSH remain the explicitly selected host execution boundary.

`readFile` reads only issued transaction handles and exact Git objects, with a 1 MiB
metadata-file bound. Optional absence is explicit. Descriptor symlinks/non-files are
not treated as alternate declarations. Return values include raw bytes and the exact
source document/revision/byte witness for the common parser.

`materialize` uses the shared `source-projection.mjs` writer (also used for explicit
local package snapshots) to write a selected repository-root-relative projection into a NEW tree,
never merging with an existing destination. It preserves literal links and Git owner-
execute state, refuses Git administrative paths, unsupported submodules/object kinds,
missing required roots and escaping/broken links. Parent directories are created and
checked component-by-component without recursive mkdir through source links. Case or
normalization aliases cannot turn an earlier source symlink into a later write parent;
existing directory spellings must belong to this projection. Final names must round-trip
exactly. Windows device/alternate-stream/trailing-dot aliases refuse before writing.
A filesystem unable to retain owner-execute state refuses rather than certifying lost
mode information. The caller retains
and verifies this projection before closing the scratch transaction. A failed projection
is reported by staging path; it is not a complete captured resolution.

## Budgets and limits

Defaults bound snapshot count (32), request aliases (128), inspected entries (10,000),
selected blob bytes (256 MiB), descriptor bytes (1 MiB), command output and command
duration (Git 60 seconds, GitHub metadata 30 seconds). Blob data is cached by exact
object within the transaction. These are application read/materialization limits,
NOT a network-pack or disk-quota guarantee: a Git server can decline blob filtering.
Git/host resource limits still apply to transport acquisition. No persistent source
cache, background refresh, organization-wide scan or hostile-host isolation is claimed.

`close` removes only the transaction's owned scratch directory, checks ownership and
invalidates its handles. Materialized projections outside it remain intact. There is
no force cleanup of another owner, live home or unrelated process.

## Evidence and remaining integration

Native-Git tests cover observed non-main default and same-selector caching after
upstream changes, alias identity/counterfeit-handle refusal, exact materialized bytes/
links/execute mode without filters, byte budgets and escaping links. Local fixture
transport mappings preserve production portable-identity rules. A separate read-only
native GitHub probe resolved this framework repository's stable ID/default branch using
existing credentials; it is not messaging/provider privacy qualification.

Review found a real pre-refusal write escape using valid case-aliasing Git tree entries
on a case-insensitive filesystem. A raw-tree regression reproduced the outside write
in an owned temporary fixture before the correction; it now proves rejection without
that write. The final containment check is defense-in-depth, never the first boundary
protecting materialization side effects.

## Reciprocal discovery and imports

`lib/workspace-discovery.mjs` now connects the native transaction to the shared
workspace/member/soul parsers. `identify` resolves hosting identity without cloning
unrelated allowlist repositories. Discovery views are frozen and transaction-issued;
a serialized or mutated client object cannot substitute for a read workspace.

`readWorkspace` reads the exact oats-workspace.yaml. `checkMember` qualifies the
candidate and matches the workspace allowlist by repository identity, using the
workspace-declared member revision (or observed hosting default), not the caller's
work-tree branch. The observed member's oats.yaml must point back to that workspace.
The backlink's workspace observation must match the selected workspace commit;
mismatches remain stale rather than silently admitted. Missing/wrong backlinks,
unlisted forks and inaccessible observations remain distinct blocked results.
Eligibility records both descriptor witnesses and revisions, not live enrollment.

`importSoul` instead reads the selected source's advertised export and exact soul
metadata without following its publisher-workspace backlink. It returns qualified
identity, alias/reference, explicit definition, minimum required source roots and
adopter-owned policy inputs for the same planner. No adopter-maintained soul copy is
created. Optional extra selected roots are finalized during preparation. Required
repo: package roots remain source-repository-relative.

The shared Origin enum now names workspace-admission, member-backlink and source-export
facts explicitly. These are provenance labels, NOT new policy precedence tiers or
approval authority. The generated schema consumes the runtime enum. Three focused
discovery tests cover reciprocity/forks/revisions/immutable views and public import
independence; a native Git smoke exercises the complete observation/discovery/import/
projection path. The no-filter test also has an executable positive control.

Source-aware package preparation, retained record publication and public consumer/
migration integration still follow. They must use these observations and shared
codecs, not a second Git/source resolver or mutable checkout.
