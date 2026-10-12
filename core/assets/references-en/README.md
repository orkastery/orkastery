# references/

Normative checklists cited **by item number** by the skills, by the adapters and by the
human, so that whoever writes `DoD 4` or `SEC 5` and whoever reads it resolve the same line.

| File | Cited as | What it establishes |
|---|---|---|
| [definition-of-done.md](definition-of-done.md) | `DoD 4` | The conditions a delivery meets, per task, per thread, per merge and per log |
| [code-review-axes.md](code-review-axes.md) | `REVIEW 7` | The 5 review axes and the rule that categorizes every finding |
| [security-checklist.md](security-checklist.md) | `SEC 5` | The audit surface and the hard condition of zero blockers |
| [testing-patterns.md](testing-patterns.md) | `TEST 3` | What a suite must prove and how a green suite is earned honestly |
| [performance-checklist.md](performance-checklist.md) | `PERF 2` | The conditional audit, its waiver contract and measurement honesty |

Three rules govern the five.

1. **They elevate checks that already exist** in the core (`core/`) and in the thin skills, with the same
   meaning. A divergence between a checklist and the `ork` command that runs it is a defect, never
   a second opinion; wherever it shows up, the core wins.
2. **An item is a gate only when this machine can run it.** Anything that depends on a missing
   tool goes to the `Recomendacoes` (Recommendations) section, saying so. A checklist that demands evidence that
   nobody can produce is a lie dressed up as rigor. What cannot be measured is published
   as `unavailable`, never as zero.
3. **Numbering is append-only** from the commit that publishes these files, for the life of v1.
   Renumbering breaks every citation already written and is a change to a versioned public contract: it requires
   a ratified class 2 decision, the same rule the MASTER log contract adopted when it was frozen.
