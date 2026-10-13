## Changed

- Remote and refused-reference diagnostics remove URL user information from messages, `details.ref`, `details.url`, `details.value`, `provenance.value`, reference-bearing schema problems and workspace `cannot-read` fields, including bare users such as `ssh://git@host` becoming `ssh://host`, while scp-style references display as `ssh://host/path` and Git still receives the original transport reference.
