## Provider updates

- **oats.aweb 1.27.3:** fixes false `wake-status-stale` / `unavailable`
  readiness on Codex, `delivery: session`, and joined-team broker routes
  ([oats-aweb#116](https://github.com/awebai/oats-aweb/issues/116),
  [provider fix](https://github.com/awebai/oats-aweb/pull/117)). Broker
  timestamps are judged against a clock read after `aw wake status` returns,
  not the readiness phase's start. No skew allowance is added: invalid and
  genuinely future timestamps still fail, and inspection ordering and
  observation-age warnings remain intact. The catalog, reference workspace,
  docs and generated mirror now take published `v1.27.3`.
  Both floors remain OATS >=0.52.0 and aw >=1.36.33; this fix needs no new aw
  upgrade or service restart. Keep the existing upgrade order: meet the
  kernel/aw floors (restart custody services and the wake daemon after an aw
  upgrade), update the provider pin, then `oats sync`. New compositions take
  the fixed provider; existing homes keep their captured module bytes.
  Readiness does not prove actual message delivery.
