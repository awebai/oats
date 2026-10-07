# Development-channel launch fixture qualification

`launch-prompt-fixtures.mjs` qualifies the actual selected Claude executable by
reading its SHA256, without executing it. The qualified executable identity is
checked again before terminal actions. A harness name or reported version is
insufficient.

The accepted Claude 2.1.289 fixture is specific to darwin-arm64, binary SHA256
`03d66745e3bb69ec727d66023696f3820bc0a00a8a5ba725eb6706d0c67cbe69`, and
110 columns by 35 rows. Captures preserve visible bytes, including the final
newline. The private transport pins only the newly launched owned window to this
geometry, and restores its previous geometry and sizing policy on every closure.

The fixture directory contains only the channel prompt, its blank transition,
the two known normal banners, and their hashes/provenance. It contains no harness binary,
extracted proprietary modules, configuration, or credentials.

The sole supported prompt requires the exact single selected argument
`--dangerously-load-development-channels plugin:aweb-channel@awebai-marketplace`.
Approved-channel flags, multiple channels, and contradictory arguments do not
qualify. Explicit per-home `awebDevelopmentChannel: true` consent is required;
the default is off. The controller can send only one fixed Enter per launch.
There is no navigation or generic answer-sequence API.

Folder trust and all other prompts are unexpected: the controller records a
blocked outcome and sends no key. Captured folder-trust screens live only in
`test/fixtures/launch-prompts/` as negative test evidence.

Normal-output completion has a separate accepted finite policy: all surrounding
bytes must equal one of the captured normal banners, except for its bounded
directory line and the source-derived billing atoms described below. Candidates are the exact home, a home-directory-relative `~` spelling,
and `~/…/` followed by nonempty whole-component suffixes within the user home.
Every complete line must fit 110 columns. Only conservative ASCII path components
without traversal or empty segments qualify. These variants can only terminate
observation; none can authorize a key or assert harness/channel readiness.

Synthetic controller fixtures exercise state-machine behavior; they are not
production rendering evidence.

The installed-plugin capture (`frame-08-installed-after-channel-200ms.txt`)
qualifies aweb-channel 1.7.11 with Opus 5.5 / API Usage Billing / auto mode /
medium effort. Its manifest records the capture owner's provenance: native
plugin installation in isolated config/cache, dummy credentials, denied runtime
network and real-home access, seeded onboarding/trust/feature flag, one Enter,
stable bytes at 200ms/1s/3s, and verified private-server cleanup. The prompt and
blank transition were byte-identical to the earlier captures. No configuration,
credentials or extracted source is included. No task or real-account/channel
connection was tested. Apart from the billing atoms below, other
model/billing/effort/permission variants remain unqualified; a submitted answer can be followed by a retained blocked result.

## Source-derived subscription billing variants

**SOURCE-DERIVED / SYNTHETIC, not observed subscription captures:** the adapter
also constructs complete empty-frame variants for `Claude Max`, `Claude Pro`,
`Claude Team` and `Claude Enterprise`. It substitutes only the billing atom in
row 2 of each accepted API frame. Opus 5.5, auto mode, medium effort, separators,
empty input, notices and all remaining rows stay exact. The existing bounded
home-row policy is unchanged. These variants cannot authorize input.

Provenance is the same pinned 2.1.289 darwin-arm64 executable SHA256 above,
rechecked by read-only inspection. In that binary, `Knr` at the region containing
byte offset 182366506 falls back to the four subscription labels (or
`Claude API` by default). Before that fallback it may return
`Claude ${planDisplayName}` when the account value and gates permit it. Those
custom display names are not qualified unless their complete bytes equal an
explicitly accepted label; subscription membership alone does not qualify a
banner. The welcome-data
region containing offset 197387574 selects that billing value independently;
`Hgr` at offset 197387656 splits model/billing only when their display widths
plus the three-character separator exceed the available width. These four
short labels fit the accepted Opus 5.5 header at 110 columns. The test generates
these explicitly synthetic derivatives and checks the real qualification and
controller path with a test-local executable hash substitution. No binary or
proprietary extracted module is included.

The reported Max journey is different evidence: its later retained pane has
SHA256 `9eb587ab3ac7f97b746169619e02e3c8dd7df2c9069ff4368b6f0858c0964c68`,
1597 bytes and 51 newline rows. It shows task activity and bypass-permissions
mode. Captured at 2026-10-07T14:31:54.028296Z, it follows the submitted Enter at
14:31:45.365Z and block at 14:31:45.476Z. Its geometry, executable digest and
plugin version were not independently recorded; no earlier raw frame exists.
It is not padded, cropped or claimed as a qualified 110x35 first frame. See the
[published operator evidence](https://github.com/awebai/oats/issues/754#issuecomment-6040215059).
The billing-only extension does not recognize that later task-filled screen.
