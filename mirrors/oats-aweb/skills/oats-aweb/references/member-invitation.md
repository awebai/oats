# Issue and accept a LOCAL hosted member invite

The following provider act needs the provider 1.23.0 composition (#71); pinned native
contract evidence is aw 1.36.23. Use an authorized selected deployment D and
messaging soul S, selected-kernel `OATS_TEAM_SCOPE` dispatch and public
`teams --dir D --json` with `teamsApi: 2` (verified at OATS 0.42 source
`bb2ba8c9`, not an earliest-release claim). Unsupported schema refuses before
minting; other acts retain the general package floor. It issues an **agent member** invite, not a human admission
invite. Do not infer an owner/admin role from membership or `can_spawn`.

| Act / context | Exact command | Writes / success / one next step | Error → remedy |
|---|---|---|---|
| Plan LOCAL hosted member invite in D; declared L or selected soul default and matching root membership | `oats aweb invite --soul S --label L --plan --json` | Reads only; returns root/team and server-decides-authority statement, no token or permission promise. Next: authorized issuance below. | `E_INVITE_TEAM_QUERY`, `E_INVITE_TEAM`, `E_INVITE_ROOT`, `E_INVITE_MEMBERSHIP` → repair selected kernel/declaration/root membership; no ambient-principal fallback. |
| Issue once in D under the same selection | `oats aweb invite --soul S --label L --json` | Native/server decides permission at issuance; JSON success has exactly one `result.token`. Capture privately, never echo/log or send as ordinary mail. Token is not alias-bound. Next: intended recipient's labelled stdin acceptance below. | `E_INVITE_DENIED` → native HTTP 401/403 refused; static body-withheld detail, no inferred role. Other status/transport/unknown errors are `E_INVITE_NATIVE`; malformed successful output is `E_INVITE_OUTPUT`. Privately reconcile uncertain issuance before any deliberate retry. |
| Accept at the recipient deployment with intake-selected D/S/L, alias and service | `oats aweb setup --soul S --join L --invite-stdin --name <chosen-root-alias> --service <selected-url>` | Supply the private token on stdin, never provider argv/history/logs. Existing labelled join creates/connects/records its separate LOCAL root; verify matching canonical membership. Next: `/oats-teams` mapping/default readback. | Use `/oats-aweb` §8 **LOCAL team join and resume** for errors and tokenless resume; never redeem again to repair recording. |

Omit `--label` only to use the selected soul's default. A positional recipient
is `E_INVITE_ARGUMENT`; accepting alias belongs only on the acceptance command.
Without `--json`, apply stdout is the token alone. Native accept still puts it
in target-host argv temporarily. Never use issuance success as receive readiness.
`roots[T]` takes precedence; an invalid explicit override fails closed. Native
issuance runs at that root with explicit team, isolated HOME and no external
identity-home or inherited credentials/routing. Controller-only/BYOT and GLOBAL
issuance are unsupported here; no ambient controller fallback or auto-retry.
