# Seats and read-only evidence

Host plugin discovery, resident approval, mint history and current authority
answer different questions. `aw version` checks the CLI version;
`aw plugin list` is local host discovery only. Installed manifest help is local
and requires plugin bytes, not service contact. Neither proves approval.
Do not use a business request, signing endpoint, installation or mint as a
readiness probe. An anonymous read is useful only for the requested catalog task.

## Resident versus worker

A LOCAL or GLOBAL resident is not a delegated worker. An explicitly authorized
resident operator installs/approves once from its own selected home, following
the native/provider instructions. Plugin bytes are host-local; approvals are
resident-local and belong to that resident. The past `approved:true` install
receipt is not a current read.
There is no public aw 1.36.26 command listing resident app approvals.

A successful next mint/re-mint incorporates actual valid resident approvals.
A worker's snapshot is fixed at mint. With `renew: off`, restarting does not
refresh it. Removing a resident approval affects future mints, not existing
grants. This capability never mints, renews, installs or changes selectors.
Do not infer automatic revocation of an existing grant from resident removal.

The resident keeps its own snapshot of the tools approved at mint; it is not
the mint output's per-app tool list and is not copied to the worker.
Mint output's `skipped_apps` lists `{app_id, code}` for each approved app
excluded from that grant; it is not stored in the snapshot.
Grant workers must not walk into resident custody files, even under the same
OS user. `grant.yaml` has no app snapshot and cannot prove current revocation or
freshness. Resident grant show/list is registry metadata, not app inventory.
Never read signing keys to assess delegation.

## Manual observation procedure

1. Retain the selected seat/team. Identify whether it is a grant without
   switching context or reading resident files. If identity or team is uncertain,
   report unavailable selection evidence and current authority **unknown**.
2. In aw 1.36.26 there is **no worker-local read-only inventory/freshness query**.
   Therefore “delegated now” remains **unknown** unless a separately supported
   current authority read establishes it. No current positive test is supplied
   by this capability. A known expiration, or a validated matching exclusion (an
   app listed in `skipped_apps` of mint output for this exact grant and team),
   can establish **no for that condition**; it does not establish other rights.
3. Report historical “included at mint” separately, and only for validated
   metadata tied to this exact selected grant ID AND team ID. Use public
   `oats inspect --home <selected-home> --json` only when the captured
   `oats.aweb` module actually supports recorded inventory and its documented
   schema. Version strings or an available inspect command alone do not prove
   that support. Unsupported captures return historical **unavailable**.
4. Validate the supported record's version, shape, identity/team match and tool
   inventory. Do not reinterpret arbitrary JSON as the resident snapshot schema.
   A valid empty inventory means **none included**.
   Empty inventory is not an exclusion; only a matching `skipped_apps` entry is.
   Missing, legacy, malformed
   or mismatched metadata means **unavailable**. A valid partial inventory can
   establish only the listed tools' historical inclusion, not the missing tools'
   current rights or a whole-app grant. The three anonymous catalog tools are
   excluded from inherited grant snapshots. Scope labels `library:read/write`
   cannot substitute for the per-tool snapshot.
5. Emit only identifier/count/code summaries. Full inspect records remain in
   explicit operator JSON, not mail/knowledge. Report unsupported authority as
   unknown and route any needed authorized change to the resident operator.

| Observed evidence | Historical included-at-mint | Current delegation conclusion |
|---|---|---|
| Local/GLOBAL resident, not a grant | not-a-grant | unknown/not-a-grant; approval assessed separately |
| Missing/legacy/unsupported capture | unavailable | unknown |
| Malformed snapshot, unknown version or invalid tool shape | unavailable | unknown |
| Different grant ID or team ID | unavailable | unknown |
| Valid matching empty inventory | none included | unknown |
| Valid matching partial inventory | listed tools only | unknown |
| Valid matching full inventory | listed tools only | unknown |
| Known expired selected grant | independently validated history, if any | no: expired |
| Matching mint output for this exact grant and team lists `library` in `skipped_apps` | excluded at mint | no for that exclusion; other authority unproven |
| Transport error or unavailable current read | unchanged validated history, if any | unknown |
| Anonymous catalog read succeeds | no evidence | unknown |
| Host plugin list or old approval receipt | no evidence | unknown |

No provider adoption, approval removal, private-team service fix or current
custody acceptance is inferred from these observations. If an app operation
fails, preserve its exact nonsecret code; resolve it through the owner without
borrowing another identity. Event metadata parsing is not a subscription or
wake-delivery contract.
