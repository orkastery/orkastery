# security-scan fixtures

Deliberately vulnerable projects, one per stack (`js`, `python`, `go`). Everything in them is fake and unsafe on purpose:
the secrets are random strings that are not credentials, the dependencies are pinned to versions with known CVEs, the
code has injection patterns and each workflow is unsafe. Never run, install or deploy them.

They exist so the real output of every `ork security-scan` tool can be recorded (see
`core/test/fixtures/security-scan/README.md`) and tested without a network or Docker.
