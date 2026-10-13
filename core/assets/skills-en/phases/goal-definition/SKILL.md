---
name: goal-definition
description: "GOAL phase (F1): a verifiable goal, exploration of the real repository, explicit assumptions, impact map, risks and observable success criteria, all tied to claims with a verification command. Routes to ork phase run GOAL and ork claims add."
bucket: phases
roteia: "ork phase run <thread> GOAL | ork claims add"
license: MIT
---

# GOAL, goal definition

## What this skill is

A thin router for the GOAL phase. It does not explore the repository on its own and does not implement
anything: it dispatches the phase through `ork` and turns the result into claims that `ork` reruns.
**GOAL does not implement.**

## How to route

```bash
ork thread new "<nome>" --mode <modo>
ork phase run <thread> GOAL --prompt "<pedido do builder>"
ork claims add <thread> <arquivo> --claim "<alegacao>" --verificar "<comando>" --fase GOAL
ork verify <thread> --so-claims
ork gate request <thread>
```

## What GOAL delivers

1. **A goal in three paragraphs, at least.** Even a one-line fix gets a GOAL of
   three paragraphs: compact means smaller, never absent.
2. **Exploration of the real repository.** The exploration targets the actual repository, not the model's
   memory. Cite concrete files and excerpts or the exploration did not happen.
3. **Explicit assumptions.** An implicit assumption is the biggest source of rework and is treated as a
   process defect. Writing the assumption costs one line; finding out in GO that it is wrong costs the
   thread.
4. **Impact map.** What changes, what it touches and what stays out, with what stays out written down.
5. **Observable success criteria.** Latency, coverage, verifiable behavior: never
   an adjective. In a fix request, reproducing the defect is a mandatory GOAL criterion.
6. **Risks and ambiguities**, each with what would turn it into a blocker.

## What the core checks for you

Every success criterion becomes `ork claims add ... --verificar "<comando>"`, and `ork verify` reruns
the command on the real HEAD. A statement without a command comes back as `claims.unverifiable`; a statement that fails
comes back as `claims.failed`, a typed reason that fails in any mode.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "I already know this framework, we can skip the exploration" | The exploration targets the real repository, not the model's memory. Without a cited file and excerpt, the GOAL is a plausible summary of code nobody opened. |
| "Listing assumptions is red tape, they are obvious" | An implicit assumption is the biggest source of rework. What is obvious to the writer is usually a surprise in GO. |
| "The criterion is that it works well and the user likes it" | An adjective is not a metric. A criterion that does not become a command gates nothing, and the gate is where autonomy is lost. |
| "The repository is empty, there is nothing to explore" | Exploring an empty repository is still exploring: write down what was verified as absent, or the absence becomes an implicit assumption. |
| "The bug is obvious, I don't need to reproduce it first" | A fix whose defect was never reproduced does not prove it fixed anything. Reproducing the defect is a mandatory GOAL criterion. |

## Bandeiras vermelhas (Red flags)

- A GOAL with no cited file or excerpt from the repository.
- Missing assumptions, or ones discovered later as a surprise during GO.
- A success criterion written with an adjective.
- A fix request with no step that reproduces the defect.
- A GOAL that already brings implementation code: GOAL does not implement.

## Verification before leaving the phase

A goal with three paragraphs, exploration citing real files, written assumptions, an impact map with
what stays out, criteria turned into claims with a command, and the goal gate resolved by the
path the mode requires. See `DoD 17` and `DoD 18`.
