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
the known normal banner, and their hashes. It contains no harness binary,
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
bytes must equal the captured normal banner, and only its directory line may
vary. Candidates are the exact home, a home-directory-relative `~` spelling,
and `~/…/` followed by nonempty whole-component suffixes within the user home.
Every complete line must fit 110 columns. Only conservative ASCII path components
without traversal or empty segments qualify. These variants can only terminate
observation; none can authorize a key or assert harness/channel readiness.

Synthetic controller fixtures exercise state-machine behavior; they are not
production rendering evidence.
