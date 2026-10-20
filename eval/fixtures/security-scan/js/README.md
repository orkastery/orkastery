# js fixture

Deliberately vulnerable and fake. Never run or deploy. It carries a fake secret, a dependency with a known CVE
(`lodash` 4.17.20 in `package-lock.json`), a command injection, an unsafe workflow, a Dockerfile that runs as root and a lint finding.
