## Changed

- Remote and refused-reference diagnostics remove URL user information from messages, `details.ref`, `details.url`, `details.value`, `provenance.value`, reference-bearing schema problems and workspace `cannot-read` fields, including bare users such as `ssh://git@host` becoming `ssh://host`, while scp-style references display as `ssh://host/path` and Git still receives the original transport reference.

- Repository and package refusal messages explain when user information was omitted to keep credentials out of diagnostics and direct the operator to give credentials to Git instead of embedding them in the reference; existing message slots retain that explanation when forwarding a refusal, while admission, reference/data fields and field shapes are unchanged.
