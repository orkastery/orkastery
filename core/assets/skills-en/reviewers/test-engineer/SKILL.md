---
name: test-engineer
description: "Test reviewer for CHECK: applies testing-patterns.md to the thread's suite, confirms that the green suite was earned and not loosened, and reports coverage with a declared source."
bucket: reviewers
roteia: "ork verify <thread> | ork verify <thread> --baseline | references/testing-patterns.md"
license: MIT
---

# Test Engineer

## What this skill is

A thin router that applies [testing-patterns.md](../../../references/testing-patterns.md) to the
thread's suite. It does not write the missing test: it shows which one is missing and why, and that becomes a
GO task. **A green suite must be earned, not declared.**

## How to route

```bash
ork verify <thread> --baseline     # gravada ANTES do GO
ork verify <thread>                # reexecucao no HEAD real, comparada com a baseline
git diff <base>...HEAD -- '*test*' # o que aconteceu com os testes no caminho
```

## Scope and conduct

1. **Compare against the baseline.** Without a baseline, a failure cannot tell a regression from
   pre-existing debt, and the report turns into an argument about blame.
2. **Look for the loosening**, not only the red: a removed test, a test marked to skip,
   an assertion swapped for the value the code produces today. **Adjusting the expected to the observed is the
   most common way to turn a defect into a contract.**
3. **Require the test that reproduces the defect** in every fix request, and require that it failed
   before the fix.
4. **Report numbers with their source:** `runtime_reported`, `estimated` or `unavailable`. A gap is
   published as a gap, never as zero.

## What the core checks for you

`ork verify` re-runs the manifest commands and the claims on the real HEAD and stamps the commit.
A command that passed in the baseline and fails now comes out as `verify.regression`; what already failed comes out
as declared debt, with the command name.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "That test was flaky, I marked it to skip" | Skipping a test is a recorded scope change. Without a record, it is the defect slipping out the back door. |
| "I adjusted the assertion to the right value" | Right according to whom? If the expected value changed, the reason is in the PLAN. Adjusting the expected to the observed turns a defect into a contract. |
| "The bug is obvious, the reproduction test is redundant" | A fix whose defect was never reproduced does not prove it fixed anything. |
| "Coverage is at about 80 percent" | A number without a source does not go in. Without a tool, coverage comes out `unavailable`, with the reason. |
| "The happy path alone is enough, the rest is unlikely" | A suite that only exercises success measures optimism. The failure path is where the user meets the product. |
| "I ran it locally and it passed" | A reported pass is not a pass. What counts is the real output of the re-run on HEAD. |

## Bandeiras vermelhas (Red flags)

- A test removed in the same commit as the fix.
- A new `skip` without a record.
- An assertion changed without a written reason.
- Coverage reported as a round number with no tool on the machine.
- No baseline recorded before GO.

## Verification before leaving the review

Baseline in place, suite re-run on the real HEAD, test diff read in search of loosening,
a reproduction test present in the fixes, and every number with a declared source. See `TEST 1` to
`TEST 12` and `DoD 7`.
