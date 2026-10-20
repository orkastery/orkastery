# python fixture

Deliberately vulnerable and fake. Never run or deploy. It carries a fake secret, a dependency with a known CVE
(`requests` 2.19.1 in `requirements.txt`), a command injection, an unsafe workflow, a Dockerfile that runs as root and a lint finding.
