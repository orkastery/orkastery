---
name: plan-specification
description: "PLAN phase (F2): a plan with sliced tasks, queryable touch_paths, decisions D1..Dn with a single home and an executable verify per task. Routes to ork phase run PLAN and ork lease acquire."
bucket: phases
roteia: "ork phase run <thread> PLAN | ork lease acquire"
license: MIT
---

# PLAN, specification

## What this skill is

A thin router for the PLAN phase. It does not write the plan's code and does not decide on its own what is the
human's tradeoff: it dispatches the phase through `ork` and turns the plan into tasks with a verify.
**PLAN does not implement.**

## How to route

```bash
ork phase run <thread> PLAN --prompt "<pedido do builder>"
ork lease acquire "path:<glob>" --thread <thread> --motivo "PLAN reservou a regiao"
ork gate request <thread>
ork handoff export <thread> --proxima-fase GO
```

## What PLAN delivers

1. **Tasks sliced until they fit in one atomic commit.** At most five files per task.
   A task larger than that goes back to slicing before GO, not during it.
2. **`touch_paths` per task.** The path the task will touch is declared up front, and it is what
   justifies the `path:<glob>` lease. An undeclared region is a collision waiting to happen.
3. **One executable verify per task.** Every task carries the command that proves it is finished.
   A task without a verify is a wish, not a task.
4. **Decisions D1..Dn with a single home.** Each decision lives in one place only, and once decided
   it is locked. Reopening is a new decision with a record, never a silent edit of the previous one.
5. **What stays out of scope**, written down, so that CHECK can call scope creep whatever
   shows up beyond that.

## What the core checks for you

The `path:<glob>` lease of `ork` refuses two threads in the same region and queues the second with a
position; the typed handoff carries the closed decisions to the next phase without depending on the session
remembering them.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "The plan is already in my head, writing it down slows me down" | A plan that is not on disk does not survive a context window rotation, and the next phase starts by guessing. |
| "This task is big but cohesive, leave it whole" | A task larger than five files goes back to slicing. An atomic commit is what makes whatever goes wrong reversible. |
| "I'll decide that tradeoff later, in the middle of GO" | A tradeoff decided in the middle of GO is decided in a hurry and without a record. A decision has a single home and locks when closed. |
| "Writing a verify per task is ceremony" | A task without a verify is a wish. Without a command, "done" becomes the agent's opinion and CHECK has nothing to compare against. |
| "I don't need to declare touch_paths, it's obvious where I'll make changes" | The lease comes from `touch_paths`. An undeclared region is the normal way for two threads to run over each other. |

## Bandeiras vermelhas (Red flags)

- A task without a verify command.
- A task that touches more than five files.
- A decision repeated in two places in the plan, with different wording.
- `touch_paths` missing on a thread that runs in parallel with another.
- A PLAN that already brings the finished code: PLAN does not implement.

## Verification before leaving the phase

Tasks sliced with a verify, `touch_paths` declared, decisions with a single home and locked,
out of scope written down, and the assumptions gate resolved by the path the mode requires. See
`DoD 19` and `DoD 20`.
