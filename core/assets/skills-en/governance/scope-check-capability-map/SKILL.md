---
name: scope-check-capability-map
description: "Phase 0: before opening the thread, checks whether the demand fits what the product and the machine can do, and returns what is missing instead of starting work doomed to stop halfway."
bucket: governance
roteia: "ork_preflight | ork doctor --modo | ork board plan | ork thread new --dry-run"
license: MIT
---

# Scope Check and Capability Map

## What this skill is

A thin router for phase 0. It runs before GOAL and answers a single question: **does this demand fit
what exists today?** If it does not fit, it returns what is missing, by name, before any thread
consumes context window.

## How to route

First resolve the mode through the core. Prefer `ork_preflight({modo})` in the project's MCP;
without that tool, use the contextual CLI below. The result follows the canonical setup per block.

```bash
ork doctor --modo <modo>                   # preflight contextual do modo autorizado
ork board plan                            # capacidade ocupada e capacidade livre
ork thread new "<nome>" --mode <modo> --dry-run   # ensaio: slug, modo, blocos, sem gravar
```

Plain `ork doctor`, without a mode, is an optional broad diagnosis with a global inventory; it does not replace
the contextual preflight, nor should it compete with it as a mandatory dispatch route.

## The capability map

1. **Machine capability.** Check `prontoPrimeiroBloco` and the checks of the initial block; a relevant
   failure blocks that dispatch. `prontoTodosBlocos` reports the dependencies of the future blocks:
   announce those limitations without confusing them with an impediment to the initial block. The probe does not prove
   authentication, accepted model, gates or delivery; the dispatch revalidates those contracts. VERIFY/SHIP
   MCP also depend on the isolated Codex executor and on the delivery transport, even with a Claude phase.
2. **Parallelism capability.** Active threads against `concurrency.max_parallel_threads`, plus the
   leases already taken in the region the demand will touch.
3. **Product capability.** What the demand asks for either exists in the product or is a new capability. If it is
   new, that is said in the scope check and not discovered in GO.
4. **Decision capability.** Does the demand depend on a decision only the human makes? Then it is born
   with the gate planned, not with a surprise halfway through.

## The return contract

When the demand does not fit, the return **names what is missing and what would unblock it**, in one line
each. Returning "can't be done" without what is missing is a refusal, not a scope check.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "I'll start and see what is missing along the way" | Discovering the gap in GO costs the whole thread. The scope check costs one command. |
| "I'll ignore any fail because I chose Auto" | A relevant failure in the initial block's preflight blocks the dispatch; Auto does not remove verification. A future block's dependency must be reported as future. |
| "One more thread fits, I can handle it" | The ones who have to handle it are the machine and the human who approves gates, and both have a measured ceiling in the manifest. |
| "The demand is vague, GOAL will clarify it" | GOAL clarifies the goal, not whether a capability exists. A demand that asks for what does not exist is sent back earlier, with what is missing written down. |

## Bandeiras vermelhas (Red flags)

- Dispatch started with `prontoPrimeiroBloco` false or a relevant failure of the initial block.
- A demand asking for a nonexistent capability without that being written down.
- A file region already under another thread's lease, with no queue planned.
- A return that does not say what would unblock the demand.

## Verification before opening the thread

Contextual preflight read per block, future dependencies explained, parallelism capability
checked, product capability confirmed or declared
absent, human gates planned, and a rehearsal with `--dry-run` showing slug, mode and blocks. See
`DoD 17`.
