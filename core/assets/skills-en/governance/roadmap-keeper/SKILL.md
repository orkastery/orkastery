---
name: roadmap-keeper
description: "Roadmap guardian: every demand is recorded before it becomes a thread, every auditor proposal becomes an item with a source, and nothing vanishes from scope without a recorded decision. Routes to ork board and ork thread new."
bucket: governance
roteia: "ork board | ork board plan | ork thread new"
license: MIT
---

# Roadmap Keeper

## What this skill is

A thin router between the demand and the thread. It does not prioritize in the human's place: it ensures that
every demand is written down before it becomes work, with a source, and that nothing leaves scope in
silence. **A demand that becomes a thread without being recorded is work with no owner and no history.**

## How to route

```bash
ork board                       # o estado de todas as threads
ork board plan                  # quem avanca agora, quem espera e por que
ork thread new "<nome>" --mode <modo>
ork master                      # as entregas, com o indice derivado do ledger
```

## Conduct

1. **Record before opening.** The demand comes in with a title, a source and the problem it solves, and only
   then becomes `ork thread new`.
2. **Always a source.** Builder request, auditor finding, lesson from a MASTER log: who asked stays
   written down. An item without a source does not know why it exists or when to die.
3. **An auditor proposal comes in as a proposal**, never as an already applied correction. The auditor reads, the
   roadmap decides.
4. **An item that leaves scope leaves with a recorded decision**, with who decided and why. Scope that
   shrinks in silence is scope that reappears as a surprise.
5. **The machine's capacity limits the board.** `concurrency.max_parallel_threads` in the manifest is the
   real ceiling; a roadmap that ignores the ceiling becomes a queue disguised as a plan.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "I'll open the thread now and record it later" | Recording later is recording the way memory tells it. The demand comes in written, with a source, before it becomes work. |
| "This item obviously left scope" | Obvious to whoever was in the conversation. Leaving scope is a recorded decision, or it becomes a surprise in the next delivery. |
| "The auditor found it, I'll fix it directly" | The auditor proposes, the roadmap decides. A correction applied directly by an auditor is a change with no owner and no gate. |
| "One more thread fits in parallel, it's small" | The ceiling is the manifest's, measured, not optimism's. Above it, threads compete for the tree and for human attention. |
| "This is obviously a priority, no need to even ask" | Priority is a class 1 decision, the human's. The roadmap organizes the choice; it does not make the choice. |

## Bandeiras vermelhas (Red flags)

- A thread opened without a matching roadmap item.
- An item without a written source.
- An auditor finding applied as a direct correction.
- Scope reduced with no record of who decided.
- Number of active threads above the manifest ceiling.

## Verification before leaving the skill

Demand recorded with a source, parallelism ceiling respected, auditor proposals treated as
proposals, and every scope change with a recorded decision. See `DoD 20` and `REVIEW 11`.
