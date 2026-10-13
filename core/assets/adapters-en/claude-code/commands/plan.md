---
description: Conducts the thread's PLAN phase through `ork`.
argument-hint: "<thread-id> [note]"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /plan

PLAN phase (F2): sliced tasks with `touch_paths` and a verify per task, decisions D1..Dn with a single home. PLAN does not implement.

## What this command does

1. Reads the real state of the thread before anything else:

```bash
ork thread status <thread>
```

2. Dispatches the phase:

```bash
ork phase run <thread> PLAN --prompt "<o que o plano precisa cobrir>"
```

3. Reserves the regions the plan declared it would touch, so that another thread does not write over them:

```bash
ork lease acquire "path:<glob>" --thread <thread> --motivo "PLAN reservou a regiao"
```

4. Exports the typed handoff to the next phase, instead of relying on the session's memory:

```bash
ork handoff export <thread> --proxima-fase GO
```

5. If the mode pauses, presents the tradeoffs with options and a recommendation, and waits for the verdict.

## Adapter rules

- **Zero business logic here.** This command turns intent into an `ork` call and nothing more.
  Validating the mode, building the prompt, deciding the gate and proving the delivery is the core's job.
- **The #TAG comes from the request, not from configuration.** The mode comes from `ork modos --do-pedido`, which uses the
  same function as the core; without a tag, the manifest's `conduction.default_mode` applies. Validation
  against `conduction.allowed_modes` happens inside `ork thread new`, never here.
- **No writing product code in this command.** Writing is the job of the session that `ork`
  dispatches, with the prompt recorded and its sha in the ledger.
