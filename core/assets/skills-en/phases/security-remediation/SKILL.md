---
name: security-remediation
description: "Fixing a security scan finding in GO: fixes only the finding triaged as real, requires a declared rotation for a secret, raises a dependency to the lowest fixed version and proves it by the rerun scan. Routes to ork fix and ork security-scan."
bucket: phases
roteia: "ork fix open | ork fix list | ork claims verificar | ork fix reverify | ork security-scan"
license: MIT
---

# Security remediation

## What this skill is

A thin router for the fix that comes from a `new` loop finding of `ork security-scan`, after the `security-auditor` triaged it as real. It applies only with `verify.security_scan` declared and runs inside GO, in the thread worktree, with the conduct of [go-implementation](../go-implementation/SKILL.md).

## How to route

```bash
ork fix open <thread>
ork fix list <thread>
git ls-remote --heads <remoto> <branch>
ork security-scan
ork claims verificar <thread> <claim> --comando "<comando>"
ork fix reverify <thread>
ork decisao registrar <thread> ...
```

## What the remediation delivers

1. **Only the finding.** The fix changes what the finding points at (rule, `arquivo:linha`) and nothing around it: neighbouring refactoring is scope creep and hides the fix inside the diff.
2. **The secret leaves the code AND has a declared rotation.** Removing it from the file does not undo the leak (`SEC 2`): history is not cleaned by fixing the code. The fix only closes with the rotation declared to the credential owner, dated and verified, not promised. The secret value never goes to the report, the commit or the prompt.
   - **Whoever fixes also never prints the value.** The auditor's rule applies in GO: the finding's line, its neighbours and the commit that brought it do not go to the session output through any tool (Read, `sed -n`, `head`, `cat`, `grep -n`, editor, `git show`, `git log -p`, diff). Edit without reading, by the report's line number: delete the line (`sed -i '<n>d' <arquivo>`) or replace it whole (`sed -i '<n>s/.*/<substituto>/' <arquivo>`, with the replacement reading the credential from the environment or the vault, never with the value). A multi-line secret (a PEM key): the end of the block comes out only as a number (`command grep -n -- '-----END' <arquivo> | cut -d: -f1`) and the range is deleted with `sed -i '<n>,<m>d' <arquivo>`. Check by the scan, not by eye: the finding's `fingerprint` leaves the new report. In the history rewrite below, redo the commits the same way, without `git diff` or `git show` of the secret's commit.
   - **A secret that entered in the thread leaves the thread history.** Gitleaks scans the commits of `<base>..HEAD`, and the finding stays `new` while a thread commit carries the value. Never just delete the line in a new commit. With the thread branch on no remote (`git ls-remote --heads <remoto> <branch>` exits 0 and empty for every `git remote`; a non-zero exit is doubt, not absence), rewrite only the thread commits from the one that brought the secret: `git reset --soft <commit anterior ao segredo>`, with the target at the thread base or after it (`git merge-base --is-ancestor <base> <alvo>`), and the commits again without the value, without `push --force`. Rewriting a thread commit not yet published is the path the method already uses, and `ork ship publicar` pushes without force: rewritten history that was already published would be refused at push anyway.
   - **A branch already published is not rewritten.** The finding stays `new`, because the commit remains in `<base>..HEAD`. The rotation declared and verified is still mandatory, and the way out is a dismissal citing the declared rotation, decided by the owner: the finding goes back to CHECK as inconclusive and, with the answer, becomes type A like any dismissal.
3. **A dependency goes to the lowest fixed version**, the one the report indicates, with the justification of the choice in the commit. Jumping to the latest brings changes nobody asked for.
4. **The proof is the rerun scan.** The proof is the scan rerun by `ork fix reverify`, which `ork` runs on the real HEAD; the agent's statement that it "fixed it" is not proof. The finding must be gone from the new report, and no `new` may have come in. **The scan reads only the committed HEAD:** the scanned tree is a checkout of the HEAD commit, so a fix, a dismissal entry or a config not yet committed is invisible to it. Commit before rerunning.
5. **A dismissal is a type A fix**, and only when the triager classified a false positive. The entry goes to `.ork-security/dismissals.json` with `fingerprint`, `tool`, `rule`, `file`, `reason`, `decidedBy`, `decisionRef` (the reference of the decision recorded with `ork decisao registrar`) and `date`; without a reason and a recorded decision, the config is invalid and the scan exits 1.
6. **An excluded file is not fixed.** A finding in a path the scan config excludes goes back to triage: either the finding is in another file, or the exclusion is wrong, and changing the exclusion is a recorded decision, not a shortcut.
7. **One correction per finding.** The `ork fix open` spec carries, next to the correction of the `security_scan` command, one correction per CHECK claim, with the type and the verdict text (`ork fix list <thread>`): type B for a real one, type A for a false positive. Type A closes with the dismissal entry and with the command that proves it attached to the claim (`ork claims verificar <thread> <claim> --comando "<comando>"`); the real finding's claim fails and passes with the whole scan, so type B closes when the rerun scan exits with no `new` loop finding, not only when this `fingerprint` is gone.

## What the core checks for you

`ork security-scan` exits 1 on a `new` loop finding (every new secret; new dependency, SAST, IaC and workflow findings at `high` or `critical`) and on an invalid dismissal. `ork fix reverify` gives the verdict per fix and refuses a partial rerun after type B. A tool `unavailable` or `failed` never counts as clean.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "I took the secret out of the code, it is resolved" | The secret is still valid and still in the history. The rotation declared to the owner and verified is missing. |
| "I deleted the line in a new commit, the finding goes away" | Gitleaks scans `<base>..HEAD`: the old commit still carries the value and the finding stays `new`. Rewrite the unpublished thread history and declare the rotation. |
| "Since I am here, I will tidy the rest of the file" | The fix is only the finding. The rest becomes a proposal, with its own task and commit. |
| "I will go to the newest version, it is safer" | The lowest fixed version, with a justification. The newest brings changes nobody assessed. |
| "It worked here, the finding must be gone" | The proof is the rerun scan, not the impression of whoever fixed it. |
| "It is a false positive, I dismiss it and done" | A dismissal requires the triage, the reason and the recorded decision. Without them the config goes invalid. |

## Bandeiras vermelhas (Red flags)

- A secret removed from the file with no rotation declared to the owner.
- A thread secret fixed only by a new commit, with the commit that brought it still in `<base>..HEAD`.
- `push --force` to clean the history of a published branch.
- A fix closed without `ork fix reverify` and without a new scan.
- A diff with a change that is not the finding.
- A dependency that skipped several versions with no justification.
- An entry in `.ork-security/dismissals.json` without `reason` or without `decisionRef`.
- A secret value pasted in the commit, the report or the prompt.
- The secret's line read or printed to edit it (Read, `sed -n`, `cat`, `git show`) instead of the edit by line number.
- The scan rerun with the fix or the dismissal still uncommitted.

## Verification before leaving the fix

Diff restricted to the finding, rotation declared and the thread history without the secret's commit when it was a secret, version justified when it was a dependency, a complete dismissal entry when it was type A, and `ork fix reverify` green with the finding out of the new report. See `SEC 1`, `SEC 2` and `SEC 10`.
