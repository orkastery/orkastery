# security-scan recorded outputs

Real output of every tool in `core/assets/security-scan/tools.json`, run through Docker as the catalog says (image by
digest, non-root user, source mounted read-only, writable output directory, `--network none` where the catalog says
so) against the deliberately vulnerable projects in `eval/fixtures/security-scan/<stack>/` and against a clean project.
Tests of the normalizers and of the executor (with a fake `docker`) read these files; none of them needs a network.

Regenerate everything with `node core/scripts/gravar-saidas-security-scan.cjs` (maintainer only, needs Docker, git
and network for the rule and database downloads; about 8 minutes). Options: `--tool <name>`, `--stack js|python|go`.

## Naming

`<report-file>.<case>.json`, where `<report-file>` is the file name the catalog tool writes in `{out}` (`expect.files`
or `stdoutFile`) and `<case>` is:

- `js`, `python` or `go`: run against that stack's fixture. Tools that read the whole tree (Gitleaks, Trivy, zizmor,
  actionlint) were run on all three fixtures; tools of one stack only have that stack's file.
- `empty`: run against a clean project (nothing to report) of the tool's own stack, or of `js` for a tool that applies
  to every stack. It is the "ran and found nothing" case.

Gitleaks has two report files per case: `gitleaks-dir.<case>.json` (tree scan) and `gitleaks-git.<case>.json`
(`base..HEAD` scan). For the git case the script builds a temporary repository whose base commit is the clean project
and whose HEAD adds the fixture (for `empty`, a harmless note).

## What each fixture holds

- A fake secret in a source file (`generic-api-key` rule of Gitleaks). It exists only in the fixture source and in
  the Gitleaks reports; tests asserting that a secret never leaks use it.
- A dependency with a known HIGH CVE pinned in the lockfile (`lodash` 4.17.20, `requests` 2.19.1,
  `golang.org/x/text` v0.3.7, the last one called from `main.go`).
- An injection pattern flagged by the Semgrep ruleset of the stack, a lint finding (ESLint, Ruff, golangci-lint),
  a Dockerfile that runs as root (Trivy config) and a `pull_request_target` workflow that checks out the PR head
  (zizmor, actionlint).

Paths in the files are the container paths (`/src/...`), as the tools print them. Two edits are made to the recorded
text: U+2014 (quoted in advisory descriptions) becomes a hyphen, because the repository forbids that character, and
every e-mail address outside the reserved example domains (the reporter credited in an advisory, a distribution
mailing list in a reference) becomes `pessoa@example.com`, because the private-data barrier (RM-062) rejects real
addresses in the public repository. No normalizer reads those fields.
`trivy-license.python.json` and `trivy-license.go.json` have no license entries: Trivy only reads licenses from
lockfiles that carry them (npm) or from installed packages.
