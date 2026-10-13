---
description: Opens the thread for the request and conducts the GOAL phase through `ork`.
argument-hint: "<builder request, with optional #TAG>"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /goal

GOAL phase (F1): a verifiable goal, exploration of the real repository, explicit assumptions and criteria that become claims with a command. GOAL does not implement.

## What this command does

1. Extracts the conduction mode from the request itself, without reimplementing the parsing:

```bash
MODO=$(ork modos --do-pedido "$ARGUMENTS")
```

2. Opens the thread with that mode (`ork` validates against `conduction.allowed_modes` and refuses what
   the project does not allow):

```bash
ork thread new "<nome curto da demanda>" --mode "$MODO" --worktree auto
```

3. Dispatches the phase, with the builder's full request:

```bash
ork phase run <thread> GOAL --prompt "$ARGUMENTS"
```

4. Records as a claim everything GOAL stated, with the command that proves each statement, and
   re-runs:

```bash
ork claims add <thread> <arquivo> --claim "<alegacao>" --verificar "<comando>" --fase GOAL
ork verify <thread> --so-claims
```

5. If the mode pauses in this block, presents the evidence to the builder and stops. The request comes from the core, and the
   release is only recorded when the builder answers through the authenticated channel:

```bash
ork gate request <thread>
```

## Adapter rules

- **Zero business logic here.** This command turns intent into an `ork` call and nothing more.
  Validating the mode, building the prompt, deciding the gate and proving the delivery is the core's job.
- **The #TAG comes from the request, not from configuration.** The mode comes from `ork modos --do-pedido`, which uses the
  same function as the core; without a tag, the manifest's `conduction.default_mode` applies. Validation
  against `conduction.allowed_modes` happens inside `ork thread new`, never here.
- **No writing product code in this command.** Writing is the job of the session that `ork`
  dispatches, with the prompt recorded and its sha in the ledger.
