---
name: ship-release
description: "SHIP phase (F5): merge serialized by lease, update against the base, push proven by command and a rollback plan. Routes to ork ship, which only delivers with the push verified on the remote."
bucket: phases
roteia: "ork ship <thread> --para <base>"
license: MIT
---

# SHIP, delivery

## What this skill is

A thin router for the SHIP phase. It does not merge by hand, does not push a branch on the side and does not decide
on its own that the push may happen: it calls `ork ship`, which serializes the merge by lease and **proves
the push by comparing the local sha with what the remote reports**.

## How to route

```bash
ork worktree sync <thread>                  # rebasa quando a base avancou
ork ship <thread> --para main --dry-run     # ensaio: mostra tudo, nao toca em nada
# autorizacao humana registrada: vai no proprio ship, com o nome de quem autorizou
ork ship <thread> --para main --autorizar-push <quem>
ork phase list <thread>                     # a prova: mergeSha, shaRemoto, pushVerificado
```

## What SHIP delivers

1. **Serialized merge.** The `main-tree` lease lets one thread at a time touch the target tree; the
   others join a queue with a position, instead of fighting over the same checkout.
2. **Update against the latest base**, with full revalidation whenever the update
   brought changes. A verdict computed before the update describes a diff that no longer exists.
3. **Push proven by command.** `ork` compares the local sha with `git ls-remote` on the remote and records
   `pushVerificado` in the ledger. **A push reported without the remote's sha counts as a push that did not happen.**
4. **Contract guard.** Nothing in the final diff changes a versioned public contract without a ratified
   class 2 decision, and the guard runs again after the update against the base.
5. **Rollback plan**, written before the merge, with the exact revert command.

## What the core checks for you

The `push_direto_na_base` policy is blocking: source equal to target, source equal to the project's base
branch, or a delivery with no delta while the local base is ahead of the remote (the push would publish a commit that
did not go through a thread merge) fails before `ork` touches the remote. A merge that ship itself
already made and that did not reach the remote (push refused, `--sem-push`) does not count: running ship again pushes it.
A busy target tree comes out as `tree.blocked`; a lease held by another thread comes out as
`lease.busy`.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Reality |
|---|---|
| "I already pushed, it worked" | A push is proven by command or it did not happen. The remote's sha is the evidence; the feeling of success is not. |
| "I'll merge straight into the base, it's a single commit" | A direct push to the base is a blocking policy. Delivery comes from the thread's branch, always. |
| "The base moved, but my diff does not touch that" | Update and revalidate. An update can bring a change that touches a contract, and the previous verdict described a different diff. |
| "I'll think about rollback if something goes wrong" | A rollback plan written before the merge, or the plan will be written under pressure, in broken production. |
| "The queue is slow, I'll merge on the side" | A merge outside the queue is the collision the queue exists to prevent. Wait for your position or release the lease with a record. |
| "The mode is `#Classic`, so the push needs no authorization" | It does: the authorization is given in advance and **recorded** in the ledger, not waived. A mode relaxes when the human speaks, never whether they speak. |

## Bandeiras vermelhas (Red flags)

- A merge without a CHECK report with the verdict PASSOU (passed).
- A push without `pushVerificado` in the ledger.
- A contract guard run only before the update against the base.
- A missing thread branch: the delivery going out from the base itself.
- No rollback plan in the phase artifact.

## Verification before leaving the phase

Base updated and revalidated, contract guard rerun on the final diff, merge through the lease
queue, push with the remote's sha in the ledger and a written rollback plan. See `DoD 12` to `DoD 15` and
`SEC 12`.
