---
description: Conducts the thread's GO phase through `ork`, inside the isolated worktree.
argument-hint: "<thread-id> [task]"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /go

GO phase (F3): implementation slice by slice, one atomic commit per task, inside the thread's worktree. Code is written by the dispatched session, never by this command.

## What this command does

1. Ensures the worktree and records the baseline BEFORE the first line of code:

```bash
ork worktree ensure <thread>
ork verify <thread> --baseline
```

2. Dispatches the task:

```bash
ork phase run <thread> GO --prompt "<tarefa do PLAN, uma por vez>"
```

3. Re-runs the verification on the real HEAD and compares it with the baseline:

```bash
ork verify <thread>
```

4. Checks that the worktree stays consistent in git itself:

```bash
ork worktree audit <thread>
```

## Adapter rules

- **Zero business logic here.** This command turns intent into an `ork` call and nothing more.
  Validating the mode, building the prompt, deciding the gate and proving the delivery is the core's job.
- **The #TAG comes from the request, not from configuration.** The mode comes from `ork modos --do-pedido`, which uses the
  same function as the core; without a tag, the manifest's `conduction.default_mode` applies. Validation
  against `conduction.allowed_modes` happens inside `ork thread new`, never here.
- **No writing product code in this command.** Writing is the job of the session that `ork`
  dispatches, with the prompt recorded and its sha in the ledger.
