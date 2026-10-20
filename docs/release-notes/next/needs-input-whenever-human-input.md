## Changed

- **Agents set needs-input whenever they need anything from a human.** The
  oats.core inject and `/oats-operate` make `oats instance attention` mandatory,
  under an IMPORTANT lead, for any question, decision, approval, credential or
  other input an instance waits on, not only when it cannot go on without the
  answer, so the wait shows on `oats status` and in the Desktop. It stays out
  of FYIs and progress reports. oats.support's hand-off skill says the same,
  and `/oats-operate` says which questions the Claude Code emitter already
  reports. ([oats.core: needs input](../capabilities.md#oatscore-needs-input))
