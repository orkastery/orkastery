# go fixture

Deliberately vulnerable and fake. Never run or deploy. It carries a fake secret, a dependency with a known CVE
(`golang.org/x/text` v0.3.6, reachable from `main.go`), a command injection, an unsafe workflow, a Dockerfile that runs as root and a lint finding.
