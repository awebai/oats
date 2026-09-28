# Team model v2 decoder fixtures: STAND-INS

`teams.json` and `soul-teams.json` are copied verbatim from the JSON examples in
`docs/desktop-cli-api.md` § "Team model v2 (feature team-model-2)" on the kernel
branch `feat/030-team-model` @8dd82158 (K1's shapes doc, the contract; the kernel
code had not landed). They are PROVISIONAL: replace them with captures from the
real 0.30 kernel (`oats teams --json`, `oats soul teams <soul> --json`) and point
`test/team-model-v2-decoders.test.mjs` at the capture.

The preview, inspect and souls cases are the REAL 0.29 captures
(`workspace-v2/f7`, `workspace-v2/teams`, `workspace-v2/desktop-facts`) with the
v2-removed keys deleted and the v2 keys added, as named in each test.
