## Provider updates

- **oats.framework 1.13.5: oats.core 2.6.6, oats.support 1.0.1.** Text
  only: neither floor (`compatibility.oats`) changes.
  - **Instances are named for their work, with the soul's role last.**
    `/oats-operate` and `/oats-souls` (oats.core) teach
    `--name <descriptive>-<role>`, the role being the last word of the soul's
    name: `--name desktop-improvements-expert` for an `oats-desktop-expert`,
    not `oats-desktop-expert-desktop-improvements`. `--purpose` still derives
    `<soul>-<purpose>`, for automations and scripts that know only the soul.
    [Souls and instances](../souls-and-instances.md) states the convention
    ([#1421](https://github.com/awebai/oats/issues/1421)).
  - **Agents set needs-input whenever they need anything from a human.** The
    oats.core inject and `/oats-operate` make `oats instance attention`
    mandatory, under an IMPORTANT lead, for any question, decision,
    approval, credential or other input an instance waits on, not only when
    it cannot go on without the answer, so the wait shows on `oats status`
    and in the Desktop. It stays out of FYIs and progress reports.
    oats.support's hand-off skill says the same, and `/oats-operate` says
    which questions the Claude Code emitter already reports
    ([oats.core: needs input](../capabilities.md#oatscore-needs-input)).
