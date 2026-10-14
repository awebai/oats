## Fixed

- **A session command's refusal names the file it could not read
  ([#1092](https://github.com/awebai/oats/issues/1092)).** For a home whose
  `instance.json` is not JSON, `oats session inspect`, `attach` and `input`
  said `cannot read session receipt for <home>: <the parser's words>`, though
  the receipt was intact: the file that could not be read was the record, and
  nothing in the sentence said so. The receipt and the record are now read
  apart, and each refusal names its own file by its path:
  `cannot read <home>/instance.json: <why>` for the record (`it is missing`
  for one that is not there, `it holds no JSON object` for one that is JSON
  and no object), `cannot read session receipt for <home> at <path>: <why>`
  for the receipt. The code is `E_RUNTIME_ENDPOINT_UNKNOWN` for either, as
  before. The same sentences reach the error a schedule records for a job
  whose instance's session cannot be inspected, and the row of `oats instance
  stop` for a home without its `instance.json`. `oats session start` and
  `restart` are unchanged: they refuse such a home earlier, with their own
  sentence.
