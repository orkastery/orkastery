---
name: code-reviewer
description: "Code reviewer for CHECK: goes through the five axes of code-review-axes.md on the thread diff and returns findings categorized as blocker, warning or suggestion. Never fixes what it finds."
bucket: reviewers
roteia: "ork verify <thread> | references/code-review-axes.md"
license: MIT
---

# Code Reviewer

## What this skill is

A thin router that applies [code-review-axes.md](../../../references/code-review-axes.md) to the
thread diff. **The separation is the central rule: whoever reviews does not fix.** A finding becomes a GO task,
with its own commit, or the reviewer ends up reviewing their own work and the review ceases to exist.

## How to route

```bash
ork worktree audit <thread>          # confere a worktree no proprio git
ork verify <thread>                  # a suite reexecutada no HEAD real
git diff <base>...HEAD               # o escopo declarado da revisao
```

## Scope and conduct

1. **The scope is declared before the findings:** which diff, which range, which files.
   A review without a declared scope is not reproducible.
2. **All five axes are covered, every one of them.** An axis with no finding comes out with an explicit "none"; silence
   is not evidence that anyone looked.
3. **Every finding comes out with exactly one category** and the item it violates, in the format `REVIEW 7`.
   A finding without a category is opinion.
4. **No rewriting someone else's code in the middle of the review.** The reviewer points out the place, the reason
   and the cost; the change happens in GO.

## What the core checks for you

A cited file or test that does not exist in the diff comes back as `claims.failed` in `ork verify`; the
reviewer does not need to trust the runtime's summary, it re-runs.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "Since I found it, I will fix it right here" | Whoever reviews does not fix. A reviewer who edits ends up reviewing their own work, and the review becomes a formality. |
| "The diff is big, I will review only what looks important" | Partial scope is a partial result: declare what was left out, or the report asserts more than it looked at. |
| "I let style slide, it is not important" | Style is a suggestion, except when it breaks a project tool, and then it is already a correctness issue. The rule is to categorize, not to ignore. |
| "This axis does not apply to this diff" | Then write "none" and why. A blank axis is indistinguishable from a forgotten axis. |
| "I will leave it as a warning so it does not hold up the delivery" | Category is not negotiated out of haste. A blocker downgraded because the delivery was close is the process defect the axis exists to expose. |

## Bandeiras vermelhas (Red flags)

- A reviewer commit inside the branch they are reviewing.
- A finding without a category, or without the `REVIEW n` it violates.
- A report without a declared scope.
- Duplication pointed out without saying where the code should come from.

## Verification before leaving the review

Scope declared, five axes filled in, each finding with a category and an item, no edit made
by the reviewer, and the consolidated verdict delivered to CHECK. See `REVIEW 1` to `REVIEW 12` and `DoD 8`.
