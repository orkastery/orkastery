---
name: web-performance-auditor
description: "Performance auditor for CHECK: a conditional audit that runs when the target has a latency-sensitive surface and, when it does not, is waived by a written contract. Does not assert performance without measurement."
bucket: reviewers
roteia: "references/performance-checklist.md | ork verify <thread>"
license: MIT
---

# Web Performance Auditor

## What this skill is

A thin router that applies
[performance-checklist.md](../../../references/performance-checklist.md) to the thread's target. It is
**conditional and never absent**: when the target has no latency-sensitive surface, the section
exists and contains the written waiver, with the reason.

## How to route

```bash
ork verify <thread>            # a suite, e o tempo real que ela leva
git diff <base>...HEAD         # os lacos e o I/O que o diff introduziu
```

## Scope and conduct

1. **Decide and record applicability.** A written waiver is a result; a missing audit with no
   line at all is a gap.
2. **Measure before asserting.** Every performance statement carries a number, a unit and how the number
   was obtained. **"It got faster" without a measurement is opinion, and opinion does not pass a gate.**
3. **Compare on the same machine and under the same conditions**, with enough repetition to separate signal from
   noise. A single run becomes `estimated`, never `runtime_reported`.
4. **Measure the user's path**, not the convenient microbenchmark.
5. **Declare the source of every number**, and what was not measured comes out `unavailable` with the reason, never
   as zero.

## What the core checks for you

The same discipline as the `ork` token gate, which would rather say "not measurable" than invent a
window occupancy: `runtime_reported`, `estimated`, `informada`, `unavailable`. The source is part
of the data, not decoration on the report.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "It got visibly faster" | Without a number, a unit and a method, it is opinion. Opinion does not pass a performance gate. |
| "I measured on my machine, it came out better than on CI" | Comparing different machines compares machines, not code. Same hardware, same conditions, or no comparison. |
| "I ran it once and could already see it" | One run becomes `estimated`. Without repetition there is no way to separate gain from noise. |
| "There is no web interface, so I skip the section" | The section always exists. With no sensitive surface, it contains the waiver and the reason. |
| "I put zero where I could not measure" | Zero is a data point, and a false one. What was not measured comes out `unavailable` with the reason. |

## Bandeiras vermelhas (Red flags)

- A CHECK report with no performance section, not even with the waiver.
- A gain asserted with no number and no method.
- A number without a declared source.
- A comparison across different machines or conditions presented as before and after.

## Verification before leaving the audit

Applicability decided and written down, measurements with method and repetition when there is something to measure, the user's
path covered, and every number with its source. See `PERF 1` to `PERF 10` and `DoD 9`.
