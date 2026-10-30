---
name: go-implementation
description: "GO phase (F3): slice-by-slice implementation inside the thread's worktree, one atomic commit per task, baseline recorded before starting. Routes to ork worktree ensure, ork verify --baseline and ork phase run GO."
bucket: phases
roteia: "ork worktree ensure | ork verify --baseline | ork phase run <thread> GO"
license: MIT
---

# GO, implementation

## What this skill is

A thin router for the GO phase. **The presenting layer never writes product code:** the
orchestra does the writing, dispatched by `ork`. This skill ensures the worktree, records the baseline,
dispatches and then reruns the verification in the real world.

## How to route

```bash
ork worktree ensure <thread>                  # worktree isolada, base resolvida pelo ork
ork verify <thread> --baseline                # o estado do mundo ANTES de implementar
ork phase run <thread> GO --prompt "<tarefa>"
ork claims add <thread> <arquivo> --claim "<...>" --verificar "<comando>" --fase GO
ork verify <thread>                           # reexecuta no HEAD real
```

- Waits: never start verify, build or the suite with `&` inside the command, because the process gets lost and the session waits for a notice that never comes; prefer asynchronous `ork_verify` and query `ork_verify_status` every 30–60 s; without it, run `ork verify` in the foreground, with `timeout` (it waits its turn in the heavy-resource queue), or use the host's background execution, which tells you when it finishes; never wait with `pgrep -f` whose pattern shows up in the command itself, because the loop finds itself and never ends: wait for the output file with a deadline, or for the saved PID.

## What GO delivers

1. **One atomic commit per task**, with the thread and the task in the message, at most five files.
2. **Work inside the thread's worktree.** The main tree is not a work area for any thread
   whatsoever, and the base stamped in `thread.json` is what says where the thread started from.
3. **Baseline recorded before the first line.** Without a baseline, a later failure cannot tell
   regression from pre-existing debt, and the thread either takes someone else's blame or hides what broke.
   On codex, whose sandbox does not write the thread state, `ork phase run` records the baseline before
   releasing the block with GO: check the `baseline` field in `ork_thread_status` and carry on instead of stopping.
4. **One claim per statement.** Every cited file, every cited test, every function said to be done becomes
   a claim with a command. A pass reported by an agent is not a pass.
5. **Nothing outside the PLAN's tasks.** An opportunistic improvement with no task is scope creep: it becomes
   a proposal, never a commit hidden in the middle of the delivery. Whatever the diff does beyond what was agreed, the
   reviewer has to discover alone, and that is how a small delivery turns into an expensive review.

## With `verify.security_scan` declared

Without `verify.security_scan`, this phase is the usual one. A fix that comes from a security scan finding uses the `security-remediation` skill: it fixes only the finding, and the proof is the scan rerun by `ork fix reverify`, not the agent's report. The spec carries one correction per finding triaged by CHECK, with the type and the verdict text (`ork fix list <thread>`): type A closes by writing the dismissal and attaching the command that proves it with `ork claims verificar <thread> <claim> --comando "<comando>"`.

## What the core checks for you

`ork verify` reruns claims and manifest commands on the real HEAD and compares against the baseline:
a command that passed before and fails now comes out as `verify.regression`; what was already failing comes out as
declared debt. A citation without backing comes out as `claims.failed`. All three fail in any mode.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "I ran it and it passed, you can trust me" | A reported pass is not a pass. `ork verify` reruns on the real HEAD, and the real output is what counts. |
| "Let me commit everything together at the end" | One commit per task. A giant commit cannot be reverted, cannot be reviewed and does not tell which piece broke. |
| "I'll work straight in the main tree, it's faster" | The main tree is not a thread work area. An isolated worktree is what allows N threads without collision. |
| "Baseline is a waste of time, the repo is green" | If it really were green, the baseline would cost one command. Without it, every failure turns into an argument over whose fault it is. |
| "While I was at it, I fixed something else along the way" | An improvement outside the PLAN's tasks is scope creep: it becomes a proposal, never a commit hidden in the middle of the delivery. |
| "The failing test was already failing before" | That is exactly what the baseline answers by command, instead of by memory. |

## Bandeiras vermelhas (Red flags)

- A commit with dozens of files and a generic message.
- Work happening outside the thread's worktree.
- No baseline recorded before the first commit.
- A file cited in the runtime summary that does not appear in `git show --stat`.
- A test disabled or an assertion loosened to close the task.
- A change in the diff that does not match any PLAN task.

## Verification before leaving the phase

Worktree checked by `ork worktree audit`, baseline recorded before GO, one commit per task,
claims with a command for everything that was stated, and `ork verify` green or with the debt declared. See
`DoD 1`, `DoD 2`, `DoD 3` and `DoD 4`.
