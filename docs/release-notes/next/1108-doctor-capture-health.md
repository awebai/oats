## Changed

- Deployment `oats doctor` delegates once to package capture health with a finite
  command timeout/output bound and validates the existing health envelope before
  mapping rows into warnings. Command/reader/timeout/invalid-response failures
  produce `capture-health-unavailable`; valid diagnosis warnings remain distinct.
  Doctor exit/output contracts and `--soul` composition inspection are retained.
  Kernel remedies say `oats`, standalone remedies say `turn-record`; paths,
  errors and receipt data are never rewritten by substring replacement.

## Upgrade

- With the service-A CLI, inspect deployment doctor warnings after authorized
  setup conversion. Preserve HOME and `TURN_RECORD_ROOT` selection when following
  `oats capture --health --json` recovery; definition bytes or no warnings do not
  establish enabled scheduling. Older 0.56–0.58 upgrade prerequisites are unchanged.
  Real-manager lifecycle/rollback, final schema delivery, current-main integration
  and audit/storage/synchronization/full-service qualification remain separate.
