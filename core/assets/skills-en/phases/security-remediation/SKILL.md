---
name: security-remediation
description: "Fixing a security scan finding in GO: fixes only the finding triaged as real, requires a declared rotation for a secret, raises a dependency to the lowest fixed version and proves it by the rerun scan. Routes to ork fix and ork security-scan."
bucket: phases
roteia: "ork fix open | ork fix reverify | ork security-scan"
license: MIT
---

# Security remediation

## What this skill is

A thin router for the fix that comes from a `new` loop finding of `ork security-scan`, after the `security-auditor` triaged it as real. It applies only with `verify.security_scan` declared and runs inside GO, in the thread worktree, with the conduct of [go-implementation](../go-implementation/SKILL.md).

## How to route

```bash
ork fix open <thread>
ork security-scan
ork fix reverify <thread>
ork decisao registrar <thread> ...
```

## What the remediation delivers

1. **Only the finding.** The fix changes what the finding points at (rule, `arquivo:linha`) and nothing around it: neighbouring refactoring is scope creep and hides the fix inside the diff.
2. **The secret leaves the code AND has a declared rotation.** Removing it from the file does not undo the leak (`SEC 2`): history is not cleaned by fixing the code. The fix only closes with the rotation declared to the credential owner, dated and verified, not promised. The secret value never goes to the report, the commit or the prompt.
3. **A dependency goes to the lowest fixed version**, the one the report indicates, with the justification of the choice in the commit. Jumping to the latest brings changes nobody asked for.
4. **The proof is the rerun scan.** The proof is the scan rerun by `ork fix reverify`, which `ork` runs on the real HEAD; the agent's statement that it "fixed it" is not proof. The finding must be gone from the new report, and no `new` may have come in.
5. **A dismissal is a type A fix**, and only when the triager classified a false positive. The entry goes to `.ork-security/dismissals.json` with `fingerprint`, `tool`, `rule`, `file`, `reason`, `decidedBy`, `decisionRef` (the reference of the decision recorded with `ork decisao registrar`) and `date`; without a reason and a recorded decision, the config is invalid and the scan exits 1.
6. **An excluded file is not fixed.** A finding in a path the scan config excludes goes back to triage: either the finding is in another file, or the exclusion is wrong, and changing the exclusion is a recorded decision, not a shortcut.

## What the core checks for you

`ork security-scan` exits 1 on a `new` loop finding (every new secret; new dependency, SAST, IaC and workflow findings at `high` or `critical`) and on an invalid dismissal. `ork fix reverify` gives the verdict per fix and refuses a partial rerun after type B. A tool `unavailable` or `failed` never counts as clean.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "I took the secret out of the code, it is resolved" | The secret is still valid and still in the history. The rotation declared to the owner and verified is missing. |
| "Since I am here, I will tidy the rest of the file" | The fix is only the finding. The rest becomes a proposal, with its own task and commit. |
| "I will go to the newest version, it is safer" | The lowest fixed version, with a justification. The newest brings changes nobody assessed. |
| "It worked here, the finding must be gone" | The proof is the rerun scan, not the impression of whoever fixed it. |
| "It is a false positive, I dismiss it and done" | A dismissal requires the triage, the reason and the recorded decision. Without them the config goes invalid. |

## Bandeiras vermelhas (Red flags)

- A secret removed from the file with no rotation declared to the owner.
- A fix closed without `ork fix reverify` and without a new scan.
- A diff with a change that is not the finding.
- A dependency that skipped several versions with no justification.
- An entry in `.ork-security/dismissals.json` without `reason` or without `decisionRef`.
- A secret value pasted in the commit, the report or the prompt.

## Verification before leaving the fix

Diff restricted to the finding, rotation declared when it was a secret, version justified when it was a dependency, a complete dismissal entry when it was type A, and `ork fix reverify` green with the finding out of the new report. See `SEC 1`, `SEC 2` and `SEC 10`.
