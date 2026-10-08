# Seat and evidence

## Keep the seat boundary

A LOCAL identity or GLOBAL resident with its own custody is distinct from a worker
grant seat. Only the authorized resident operator installs/approves an app, once,
from its own selected home through the native supported workflow. Host plugin bytes
are discovery; resident approval is authority for later delegation. This package
never performs installation, approval, minting, renewal, or selector changes.
A grant seat never installs, updates or removes a plugin, including as error recovery.

A successful next mint/re-mint incorporates actual valid resident approvals. With
`renew: off`, restarting does not update the grant snapshot. Removing resident approval
affects future mints, not existing grants. Ask the responsible resident operator to
resolve a missing prerequisite; do not mint or renew as an authority probe.

## Manual read-only assessment

1. Identify the selected seat and team from its existing briefing and authorized
   public metadata. Do not read keys or search other identity homes. If selection
   or seat type is unclear, report it as unknown and obtain that information.
2. Separate these observations in the report: CLI version/host discovery, resident
   approval evidence, historical inclusion at mint, and current authority. Do not
   run a Folio business request, signing endpoint probe, install or mint to fill a gap.
3. For a grant, use historical metadata only when its schema/version is recognized,
   complete and valid, and its grant ID **and** team ID match this exact selection.
   Valid empty inventory means none included at mint. Missing, legacy, malformed,
   partial or mismatched metadata means historical evidence unavailable. Scope names
   such as `folio:write` alone are not the finite per-tool snapshot.
4. Report current delegation as yes/no/unknown separately. Released aw 1.36.26 has
   no worker-local read-only app inventory/freshness query: aggregate **delegated now
   = unknown** unless a supported current authority read proves it. A known expiration
   or a validated matching exclusion (an app listed in `skipped_apps` of mint output for
   this exact grant and team) can establish **no for that specific condition**. Empty
   inventory is not an exclusion; do not turn an unrelated missing tool into a blanket
   denial. Historical inclusion does not prove current revocation status, freshness or
   service availability.
5. For a resident, report delegation **unknown / not-a-grant**, and discuss resident
   approval separately. A past install receipt with `approved: true` is historical;
   no public command in this pinned contract lists the resident approval catalog.

`aw plugin list` is host discovery only. Grant show/list is resident registry metadata,
not app inventory, and belongs in the resident's authorized context. `grant.yaml` has
no app snapshot and does not prove current revocation/freshness. Never walk from a worker
into resident custody: same-OS-user filesystem access is not authorization.

The resident keeps its own snapshot of the tools approved at mint. It is not the mint
output's per-app tool list and is not copied to the worker. Mint output's `skipped_apps`
names each approved app excluded from that grant, with a reason code; it is not stored in
that snapshot. Resident approvals are resident-local. None of this authorizes reading
resident files. Never read signing keys as part of assessment.

Use public `oats inspect` for captured app inventory only after verifying that the
actually composed `oats.aweb` version supports that recorded metadata. Planned provider
support is not installed adoption. Full records stay in explicitly authorized operator
JSON; agent-facing reports contain identifiers/counts/codes only.

## Evidence examples

| Observation | Historical inclusion at mint | Current delegation |
|---|---|---|
| Valid matching snapshot includes requested tool | Included | Unknown without supported current read |
| Valid matching empty inventory | None included | Unknown |
| Matching mint output lists `folio` in `skipped_apps` | Excluded at mint | No for that exclusion; other authority unproven |
| Missing/legacy/malformed/partial or wrong grant/team | Unavailable | Unknown |
| Valid matching snapshot, grant known expired | Included (historical) | No for expiration |
| Host plugin installed; past approval receipt only | Unavailable for this grant | Unknown |
| Resident rather than worker | Not-a-grant | Unknown / not-a-grant; approval separate |
| Network error or anonymous success | No new evidence | Unknown |

These are reasoning instructions, not an implemented readiness check. Authority
assessment is separate from a user-authorized document action; unknown is not a
reason to silently escalate to a resident or run a diagnostic business request.
