---
name: check-quality
description: "CHECK phase (F4): verification against the baseline, the five review axes, security and performance audits, a delegation audit and a single verdict. Routes to ork verify and to the four reviewer skills."
bucket: phases
roteia: "ork verify <thread> | ork gate request <thread>"
license: MIT
---

# CHECK, verification

## What this skill is

A thin router for the CHECK phase. It consolidates what `ork` measured and what the four reviewers
found, and produces **exactly one verdict**: PASSOU (passed), PRECISA DE MUDANCA (needs changes) or BLOQUEADO (blocked). It does not
fix what it finds: fixing is GO's job.

## How to route

```bash
ork verify <thread>                  # reexecuta claims e verify contra a baseline
ork phase list <thread>              # o ledger, para a auditoria de delegacao
ork worktree audit <thread>          # a worktree confere no proprio git
ork gate request <thread>            # o pedido da pausa; o humano responde pelo canal autenticado
```

- Waits: never start verify, build or the suite with `&` inside the command, because the process gets lost and the session waits for a notice that never comes; prefer asynchronous `ork_verify` and query `ork_verify_status` every 30–60 s; without it, run `ork verify` in the foreground, with `timeout` (it waits its turn in the heavy-resource queue), or use the host's background execution, which tells you when it finishes; never wait with `pgrep -f` whose pattern shows up in the command itself, because the loop finds itself and never ends: wait for the output file with a deadline, or for the saved PID.

When the verdict is PRECISA DE MUDANCA, the GO-FIX / CHECK-REVERIFY sub-loop of block B3 is
what conducts the way back, and it does not depend on a human until the final verdict:

```bash
ork fix open <thread>                # deriva a spec exata de cada correcao do verify real
ork fix list <thread>                # as correcoes da rodada, com o tipo A ou B de cada uma
ork fix reverify <thread>            # veredito POR correcao, mais o verify completo
ork retry plan <thread>              # o que o ork faria pelo ultimo gate reprovado, e por que
```

Two guards the core enforces for you: a PARTIAL rerun is REFUSED when the round
has a type B fix, and the manifest's escalation limit (`retry.max_tentativas`) sends the
verdict up to a human in any mode, including `#Auto`.

The catalog's four reviewers come in here: `code-reviewer`, `security-auditor`, `test-engineer`
and `web-performance-auditor`. Each one runs in its own scope and returns categorized findings.

## What CHECK delivers

1. **Comparison against the baseline**, separating regression from pre-existing debt. Without that
   separation, the report blames the thread for what was already broken.
2. **The five axes**, each with findings or an explicit "none": correctness, security,
   performance, maintainability, style.
3. **Zero security blockers**, a hard condition, valid in any mode, including `#Auto`.
4. **Delegation audit**, hunting under-classification and undue escalation with equal weight.
5. **Fixes classified honestly:** type A is one line or equivalent, recorded, with
   the affected checks rerun; type B sends the task back to GO, and the next CHECK is a
   full rerun, never a partial one.
6. **A single verdict**, in the thread directory, with every accepted warning carrying its record.

## With `verify.security_scan` declared

Without `verify.security_scan`, nothing in this section applies and CHECK is the usual one. With the key, `ork verify` runs `ork security-scan` and the verdict consolidates the scan:

1. Read `report.md` and `report.json` in `.orkastery/security-scan/<sha>/`, in the main tree; the SHA is the verified HEAD's.
2. Zero security blockers becomes: no `new` loop finding without a resolved verdict from the `security-auditor` (real and fixed, false positive dismissed with a recorded decision, or inconclusive with the `ork gate request` answered).
3. A `new` finding with `loop: false` (`warn` in the report, such as quality, license or severity below the cut) goes to the right axis as a registered warning, with the name of who accepted it, never as a hidden blocker.
4. A tool `unavailable` or `failed` is declared in the verdict and never counts as clean; with `ORK_SECURITY_SCAN_REQUIRED=1` it makes the scan exit 1.
5. A fix coming from the scan goes back through GO-FIX, with the `security-remediation` skill; the proof is `ork fix reverify`, which reruns verify and the scan.
6. The per-finding verdict reaches GO-FIX through the CHECK claim (`--fase CHECK`), one per real or false-positive finding, as the `security-auditor` skill says. `ork fix open <thread>` reruns verify and opens one correction per failed claim, type B for a real one (`claims.failed`) and type A for a false positive (`claims.unverifiable`), next to the type B correction of the `security_scan` command; `ork fix list <thread>` shows them to GO-FIX with the verdict text.
7. Inconclusive does not open the request from inside the CHECK session: `ork gate request` refuses while the observer has not recorded the phase conclusion (`a conclusao da fase precisa estar registrada antes da pausa`), and `--motivo` only accepts a typed escalation already recorded in the ledger (`escalacao tipada nao comprovada`). The short question goes into the report, the session ends, and whoever conducts runs `ork gate request <thread> --formato telegram`, which opens the pause at the end of the block that ends at CHECK, with the report in the evidence. Among the live modes, only #Classic has that pause (GO-CHECK block); #Look and #Ork also paused at CHECK, but they are retired (I-43) and the request refuses for them. The request carries the gate's generic question (`Qual e o veredito sobre evidencias...?`): whoever conducts points the owner to the report's question, with the finding id. The owner's answer becomes a CHECK claim as the `security-auditor` skill says, before `ork fix open`. In a mode without that pause (#Maestro, #Auto), the request refuses (`modo nao preve pausa humana nesta fase`): the verdict is BLOQUEADO, with the question written, and nothing proceeds until the owner answers.

## What the core checks for you

The typed reasons of `ork` keep the verdict from being just talk: `claims.failed`,
`verify.regression`, `verify.failed`, `policy.violation`, `cost.violation`, `tree.blocked`,
`lease.busy`, `runtime.rate-limited`. All of them fail in any mode, because **the mode relaxes
the pause, never the verification**. Each one has a deterministic retry action in
`ork retry policy`, and `cost.violation` is the only one that NEVER gets an automatic retry.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "It's just a warning, we can let it through" | A warning passes with a named record of who accepted it and why. A warning accepted without a record is a hidden warning. |
| "The fix was small, no need to run everything again" | A type B fix sent the task back to GO: the next CHECK is a full rerun. A partial rerun after type B is not a CHECK. |
| "That test was already failing, ignore it" | "It was already failing" is a verifiable statement: the baseline is what answers it, and the debt goes into the report as declared. |
| "The security blocker is theoretical" | Zero blockers is a hard condition. A blocker downgraded to a warning because the delivery was close is the process defect CHECK exists to expose. |
| "Since I found it, I'll fix it right here" | CHECK does not fix. A finding becomes a GO task, with its own commit, or the reviewer ends up reviewing itself. |
| "The thread is `#Auto`, so CHECK can be lighter" | The mode relaxes the pause, never the verification. `#Auto` runs the same CHECK; what it waives is waiting for the human. |

## Bandeiras vermelhas (Red flags)

- A report with two verdicts, or with none.
- A review axis with no finding and no written "none".
- A type B fix followed by a partial rerun.
- A warning accepted without the name of who accepted it.
- CHECK run without a baseline to compare against.
- A `new` loop finding without a verdict passed off as zero blockers.
- An inconclusive `new` scan finding carried by `ork gate request` from inside the CHECK session, or with a free-text `--motivo`.

## Verification before leaving the phase

Suite rerun on the real HEAD, five axes filled in, security with zero blockers,
performance audited or waived in writing, delegation audited, a single verdict recorded and the evidence
gate resolved by the path the mode requires. See `DoD 6` to `DoD 11`, `REVIEW 6` and `SEC 16`.
