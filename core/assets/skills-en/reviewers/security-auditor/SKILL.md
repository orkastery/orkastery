---
name: security-auditor
description: "Security auditor for CHECK: goes through security-checklist.md on the diff, the branch history and the thread artifacts, with the hard condition of zero blockers. Never prints the secret it finds."
bucket: reviewers
roteia: "ork verify <thread> | references/security-checklist.md"
license: MIT
---

# Security Auditor

## What this skill is

A thin router that applies [security-checklist.md](../../../references/security-checklist.md) to the
thread's scope. The pass condition is hard: **zero security blockers, in any conduction
mode, including `#Auto`.**

## How to route

```bash
git diff <base>...HEAD               # a arvore de trabalho
git log -p <base>..HEAD              # o historico atras da branch
ork phase list <thread>              # policies e gates ja registrados
ork doctor                           # provider e ambiente da maquina
```

## Scope and conduct

1. **The scope is declared before the findings:** which directories, which history range,
   which artifacts. An audit without a declared scope does not count as evidence.
2. **Test fixtures and example configs are in scope.** A credential in a test is a leaked
   credential, made worse by the fact that nobody looks there; `SEC 1` includes `.env`, fixtures and examples.
3. **History is in scope.** A secret committed and then deleted is still leaked; the audit
   reads the range, not only the tree.
4. **The report does not print credentials.** The finding names the pattern, the file and the line, in redacted
   form. **A leak report that prints the secret is a second leak.**
5. **Absence is asserted as a result**, with what was examined: "nothing found" without a scope is
   different from "audited and clean", and the difference is written down.

## What the core checks for you

The `segredo_em_prompt` policy runs at the `phase.dispatch` gate **before the prompt is written to
disk**: a rejected prompt never comes to exist as a file. The `provider` policy blocks dispatch
through a paid provider under `subscription-only`, and `push_direto_na_base` blocks a delivery without a thread
branch. All three reject in any mode.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "The key is only in the test fixture" | Fixtures are in the scope of `SEC 1`. A credential in a test is a leaked credential, made worse by the fact that nobody looks there. |
| "I deleted the commit that had the token" | Deleting from the tree does not delete from history. A blocker until the credential is rotated and the rotation verified, not promised. |
| "I will paste the snippet in the report so the team can see it" | A leak report that prints the secret is a second leak. Name the pattern and the line, redacted. |
| "This blocker is theoretical, nobody would exploit it" | Zero blockers is a hard condition, not negotiable by a probability estimated by eye. |
| "The thread is `#Auto`, the audit can be lighter" | The mode loosens the pause, never the verification. The list is the same; what changes is who waits for the verdict. |

## Bandeiras vermelhas (Red flags)

- A security report with no scope and no history range.
- A real secret pasted into the report or the ledger.
- A finding without the `SEC n` it violates.
- "Nothing found" without saying what was examined.
- A new dependency without justification in the PLAN.

## Verification before leaving the audit

Scope declared, tree and history scanned, thread artifacts read, each finding with a category
and `SEC n`, no credential printed, and zero blockers for the PASSOU (passed) verdict. See `SEC 15` to
`SEC 17` and `DoD 9`.
