---
name: decision-triage
description: "The delegation discipline: classifies each decision as class 1 (the human decides), 2 (public contract, requires ratification) or 3 (delegated, recorded), and raises a real tradeoff with options and one recommendation. Routes to ork gate request."
bucket: governance
roteia: "ork gate request <thread>"
license: MIT
---

# Decision Triage

## What this skill is

A thin router for the delegation discipline. It does not decide for the human and does not hide a decision
behind "technical detail": it classifies, records what is delegated and raises what belongs to the human.
**A delegated decision without a record is a lost decision.**

## The three classes

| Class | Who decides | What it requires |
|---|---|---|
| 1 | The human, always | Product tradeoff, business risk, priority, scope, money |
| 2 | The human, with recorded ratification | Change to a versioned public contract: schema, event types, state layout, interface |
| 3 | Delegated to the agent | Internal choice with no observable effect outside the module, recorded in the ledger when relevant |

## How to route

```bash
ork gate request <thread>    # abre o pedido; o humano responde pelo canal autenticado
ork phase list <thread>      # a auditoria de delegacao le daqui
```

## Conduct

1. **Classify before acting**, not after having acted.
2. **Raise the tradeoff with options and exactly one recommendation.** Raising without a recommendation pushes the
   work back to the human; raising without options asks for a signature, not a decision.
3. **Record the relevant class 3.** The qualifier carries weight: formatting and internal names
   are also class 3, and requiring an event for each of them is undue escalation.
4. **Audit both sides with equal weight.** Under-classifying (treating a product decision as a
   technical detail) and escalating unduly (asking for sign-off on a triviality) are defects of the same
   size, and the CHECK audit hunts both.
5. **A closed decision is locked.** Reopening is a new decision, with its own record, never a silent edit.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "This is a technical detail, I'll decide on my own" | If it changes what the user sees, what the product promises or what costs money, it is class 1. Under-classifying is the polite way of deciding for the human. |
| "I'll ask about everything, that way nobody complains" | Undue escalation is a defect of equal weight. Whoever asks about everything hands the work back and does away with delegation. |
| "I'll raise the question and let the human choose" | Without options and without a recommendation, that is passing the problem along. Bring the map and say which way to go. |
| "I'll change the schema, it is compatible in practice" | A versioned public contract is class 2: it requires recorded ratification before the merge, even when it looks compatible. |
| "The decision changed, I'll update the old text" | A closed decision is locked. Reopening is a new decision with a record; editing the old one erases the reason for the first. |

## Bandeiras vermelhas (Red flags)

- A public contract change in the diff with no ratification gate in the ledger.
- A series of product decisions showing up only in the phase's final summary.
- A question to the human about a variable name while the scope changed without notice.
- A decision recorded in two places with different wording.

## Verification before leaving triage

Each decision with an assigned class, those of class 1 and 2 raised with options and one recommendation, the relevant
class 3 ones recorded in the ledger, and no closed decision reopened in silence. See
`DoD 5`, `DoD 12` and `DoD 20`.
