---
name: master-metrics
description: "MASTER phase (F6): typed POSTMORTEM, MASTER log in the frozen ork.master-log/v1 contract and the human score from 0 to 5 with a justification. Routes to ork master and ork master <thread> --aceitar-omissao."
bucket: phases
roteia: "ork master <thread> --score N --justificativa \"...\" | ork master <thread> --aceitar-omissao"
license: MIT
---

# MASTER, closing and score

## What this skill is

A thin router for the MASTER phase. It does not invent numbers, does not round scores and does not close a thread
without a human: it calls `ork master`, which validates against the frozen contract and refuses whatever does not
comply. **A delivery without a MASTER log did not happen.**

## How to route

```bash
ork master classes                            # as classes de falha do catalogo fixo
ork master <thread> --score 4 --justificativa "<texto>" --classe base-avancou --por <quem>
ork master                                    # as entregas, com o indice derivado do ledger
ork master --todas                            # inclusive as ja pontuadas
ork master <thread> --aceitar-omissao         # aceita so a entrega desta thread, com indice e insumos no ledger
ork master --aceitar-omissao --dry-run        # lista o que a forma sem thread fecharia, sem gravar
```

An agent closes only its own thread: `ork master <thread> --aceitar-omissao`. Without the thread, the command
accepts ALL of the project's delivered threads, including those of other parallel fronts (which happened three
times on 2026-10-03); run from an agent process with more than one, `ork` warns on stderr.

## What MASTER delivers

1. **Typed POSTMORTEM**, with the phases traversed, what failed and the failure class taken from a
   fixed catalog: `sem-falha`, `erro-de-spec`, `base-avancou`, `conflito`, `rate-limit`, `modelo`,
   `processo`, `scope-creep`, `outra`. An invented class is refused by the command.
2. **MASTER log in the `ork.master-log/v1` contract**, frozen: changing the contract without changing the version
   fails, because a telemetry contract is a public contract.
3. **Integer human score from 0 to 5, with a non-empty justification.** The score belongs to the human, always. In
   the modes with no MASTER pause, the delivery is accepted by default, with the ledger-derived index, which
   no agent types; the human score, when it comes, overrides it.
4. **Evidence pointing to the ledger and the POSTMORTEM**, with counts of events, sessions and claims. A log
   without evidence is refused.

## What the core checks for you

`ork master` refuses and **writes nothing** when the score is outside 0 to 5, when the justification
is empty, when the class is outside the catalog, when a phase is outside the canonical cycle,
when the contract was changed without changing the version and when evidence is missing. A partial refusal that
writes half is worse than a full refusal.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "Score 5 because it delivered, justification later" | An empty justification is refused by the command. A score without a written reason teaches the next thread nothing. |
| "I'll give it 4.5, it landed between the two" | The score is an integer from 0 to 5. A scale with half points turns into a negotiation, and what is measured here is conduction, not goodwill. |
| "The failure class for this one was 'almost worked'" | The catalog is fixed. An invented class is refused, because a free-form class destroys comparability between threads. |
| "I'll fill in the MASTER log later, the delivery already went out" | A delivery without a MASTER log did not happen. A postponed learning phase is a learning phase that does not exist. |
| "The mode is `#Auto`, so the score can be automatic" | The score is human in every mode. `#Auto` changes when it is given (the delivery is accepted by default and the human score overrides it), never who gives it. |

## Bandeiras vermelhas (Red flags)

- A thread delivered without `master-log.json`.
- A score recorded without the name of who rated it.
- A failure class outside the fixed catalog, or no class on a thread that had rework.
- A score typed by an agent in the human's name.

## Verification before leaving the phase

Typed POSTMORTEM recorded, MASTER log valid against `ork.master-log/v1`, integer score with
justification and rater, and evidence pointing to the ledger and the POSTMORTEM. See `DoD 16`.
