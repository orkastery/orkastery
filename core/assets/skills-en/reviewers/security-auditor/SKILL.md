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

## With `verify.security_scan` declared

Without `verify.security_scan`, this skill does what it always did: the whole checklist by reading, and the manual pass remains valid. With the key declared, the scan report (`.orkastery/security-scan/<sha>/report.json`, in the main tree) is the evidence for `SEC 1`, `SEC 2` and `SEC 10`, and the triage below applies.

1. **Declare the scan scope:** `base`, `head`, the stacks and each tool with its state (`ran`, `failed` or `unavailable`) and the `reason`.
2. **A tool `unavailable` or `failed` never counts as clean.** Declare it as such; its `SEC` items fall back to manual reading, marked as such. The manual pass is only valid with the scan declared `unavailable`.
3. **Triage: one verdict per `new` finding of the loop** (`loop`), none without a verdict:
   - **real:** type B correction, with the rule, `arquivo:linha`, the real output **redacted (never the secret value; only the rule, `arquivo:linha` and `fingerprint`)**, the `SEC n` and the reach (`reachable` from govulncheck); the way back is the `security-remediation` skill;
   - **false positive:** type A correction, `acrescentar <fingerprint> ao .ork-security/dismissals.json, motivo <m>`, plus `ork decisao registrar`;
   - **inconclusive:** no correction; the short question goes into the report, the verdict is not PASSOU and the finding stays open until the owner answers through `ork gate request` (the path is in the `check-quality` skill).
4. **The verdict reaches GO-FIX as a CHECK claim, one per finding.** `ork fix open` derives the GO-FIX spec only from `ork verify`, and verify re-runs the claims: each failed claim becomes a correction carrying its text.
   - real: `ork claims add <thread> <arquivo> --fase CHECK --claim "<veredito>" --verificar "<comando de verify.security_scan>"`; the command fails on HEAD and the correction is born type B (`claims.failed`). The claim fails and passes with the whole scan, not with this finding (the `fingerprint` stays in the text), costs one extra HEAD scan per claim at every verify and goes into the `.ork-ci` bundle with the other claims;
   - false positive: `ork claims add <thread> .ork-security/dismissals.json --fase CHECK --claim "<veredito>"`, without `--verificar`; the claim with no command is born type A (`claims.unverifiable`). A claim the core reads as negative fails with no command and becomes type B without warning: `ehAlegacaoNegativa` in `core/src/claims.ts` looks, without accents and even inside words, for `nenhum`, `nenhuma`, `nunca`, `sempre`, `zero`, `todos`, `todas`, `nao ha`, `nao existe`, `nao resta`, `sem nenhum`, `100%`, `totalmente`, `completamente` (`metodos` contains `todos`). Check the `ork claims add` output: the false positive only holds with the `negativa` line at `nao` and the `estado` line at `nao-verificavel`; otherwise, `ork claims retirar <thread> <claim> --motivo "<motivo>"` and register it again with neutral wording;
   - the `<veredito>` carries the finding id, the tool, the rule, `arquivo:linha`, the `fingerprint`, the type and the correction, and for a false positive the reason and the `eventId` of `ork decisao registrar`;
   - the owner's answer to an inconclusive finding becomes a claim the same way, registered by whoever conducts or by a new CHECK, before `ork fix open`.
5. **The auditor does not edit:** neither code nor `.ork-security/dismissals.json`. It returns the verdict, and whoever writes the fix is GO.
6. **Secret material never goes to the session output.** With a `new` Gitleaks finding, the finding's line and the content of the commit that brought it do not go to the output through any tool: Read, `sed`, `head`, `grep -n`, editor, `git log -p`, `git show`, `cat`, diff. The output goes to the transcript and to the provider, and it is a second leak. What counts is the report's `rule`, `arquivo:linha` and `fingerprint`. Context is read without the finding's line (`awk -v n=<linha> 'NR>=n-5 && NR<=n+5 && NR!=n' <arquivo>`), and comparing the value with another is done by hash (`sha256sum`), printing neither.
7. `existing` and `dismissed` go in the report as declared debt, never as a new blocker.

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
| "Since I found it, I will fix it right here" | The auditor does not edit. An auditor who fixes ends up auditing its own work; the verdict goes to GO and the fix comes back through CHECK. |

## Bandeiras vermelhas (Red flags)

- A security report with no scope and no history range.
- A real secret pasted into the report or the ledger.
- A finding without the `SEC n` it violates.
- "Nothing found" without saying what was examined.
- A new dependency without justification in the PLAN.
- A Gitleaks secret value pasted in the correction, the verdict or the ledger.
- A `new` loop finding without a verdict, or a `failed` tool counted as clean.
- The line or commit of a `new` Gitleaks finding in the session output, through any tool (Read, `sed`, `grep -n`, `git log -p`, `git show`, `cat`, diff).
- A verdict on a `new` scan finding only in the report, without the CHECK claim that carries it to `ork fix open`.

## Verification before leaving the audit

Scope declared, tree and history scanned, thread artifacts read, each finding with a category
and `SEC n`, no credential printed, and zero blockers for the PASSOU (passed) verdict. See `SEC 15` to
`SEC 17` and `DoD 9`.
