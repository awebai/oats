## Provider updates

- **oats.framework 1.13.1, oats.setup 2.8.1: record capture setup is a
  person-run step** ([#1108](https://github.com/awebai/oats/issues/1108)).
  From OATS 0.62.0, `/oats-setup-model` and the setup briefing name the record
  capture conversion `oats setup` as the third install the person runs from
  their own shell, beside the host wake broker and the host timer, and say how
  to read `turn-record capture --health` and `oats doctor`'s capture warnings.
  Every new line names the release it starts in. Instruction text only; the
  floors are unchanged. A deployment gets it by pinning
  `oats.framework: v1.13.1` and running `oats sync`.
