---
name: narrative-guardian
description: "Canon audit: checks that every public artifact of the product says the same thing the code does, with no number without a source, no promise of a nonexistent capability and no invented metric. Runs before any publication."
bucket: governance
roteia: "ork verify <thread> | ork phase list <thread>"
license: MIT
---

# Narrative Guardian

## What this skill is

A thin router for the canon audit. It compares what the public artifacts state with what
the code and the ledger prove. **A number without a source does not go into a public document**, and a capability that
does not exist does not become a promise in a README.

## When to use

- Before publishing a README, product doc, changelog, post or marketing page.
- At the end of every thread that changes outward-facing documentation.
- Whenever an artifact cites a metric, time, count or comparison.

## How to route

```bash
ork verify <thread>        # o que a maquina realmente prova hoje
ork phase list <thread>    # a origem de cada evidencia citada
ork master --todas         # o que ja foi fechado e pode ser citado como entregue
```

## The canon rules

1. **Every published number has its source attached.** Command, output, date. A number from memory does not go in.
2. **A described capability is a capability that exists today.** A roadmap is written as a roadmap, in the declared
   future, never in the present indicative.
3. **A time metric is clocked, not optimistically estimated.** The fifteen-minute promise of the
   quickstart holds because the run was executed and the record was published with it.
4. **A gap is published as a gap.** `unavailable` with the reason, never zero, never omission.
5. **A divergence between doc and code is a defect of the doc**, and it becomes a task, not a footnote.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "About 15 minutes, it's roughly that" | A time metric is clocked. A number without a source becomes a promise the first user disproves. |
| "It will exist in the next version, I'll already write it in the present" | A described capability is a capability that exists today. A roadmap written as present is the lie that killed the original product. |
| "I'll leave the field empty, nobody will notice" | A gap is published as a gap. An empty field becomes zero on the next read, and zero is a data point. |
| "The doc is outdated, but the code is right" | A divergence between doc and code is a defect of the doc, with its own task. A wrong doc is the wrong product for whoever reads it. |
| "I compared with the competitor off the top of my head" | A published comparison needs a method and a date. Without that, it is advertising dressed up as data. |
| "The whole team knows this number is approximate" | Outside readers do not know. A published approximation declares that it is an approximation. |
| "I'll take out the `unavailable`, it looks ugly in the README" | What is ugly is the false number discovered later. Measurement honesty is part of the product, not a formatting detail. |
| "This is a marketing detail, not an engineering one" | The public artifact is product surface. The canon applies equally on both sides. |

## Bandeiras vermelhas (Red flags)

- A number in a public document with no command or date next to it.
- A present-tense verb for a roadmap feature.
- A benchmark cited without machine, regime and repetition.
- A metric field left blank instead of `unavailable`.
- A changelog citing a delivery without a matching MASTER log.

## Verification before publishing

Every number with a source, every capability checked against the code, every time clocked, every
gap declared, and no divergence between the artifact and what the ledger proves. See `TEST 12`,
`PERF 9` and `PERF 10`.
