---
description: "Delivers the thread through `ork ship`: serialized merge and proven push."
argument-hint: "<thread-id> [--para <branch>]"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /ship

SHIP phase (F5): merge serialized by lease, update against the base, push proven by command and a rollback plan. No `git push` by hand: a push by hand is not proven, and the per-project adapter guard (`ork adapter install claude-code`) blocks it.

## What this command does

1. Resyncs when the base has moved:

```bash
ork worktree sync <thread>
```

2. Rehearses the whole delivery before touching anything:

```bash
ork ship <thread> --para main --dry-run
```

3. Delivers, with the authorization recorded:

```bash
ork ship <thread> --para main --autorizar-push "<quem>"
```

4. Shows the proof to the builder: `mergeSha`, `shaRemoto` and `pushVerificado` in the ledger.

```bash
ork phase list <thread>
```

## Adapter rules

- **Zero business logic here.** This command turns intent into an `ork` call and nothing more.
  Validating the mode, building the prompt, deciding the gate and proving the delivery is the core's job.
- **The #TAG comes from the request, not from configuration.** The mode comes from `ork modos --do-pedido`, which uses the
  same function as the core; without a tag, the manifest's `conduction.default_mode` applies. Validation
  against `conduction.allowed_modes` happens inside `ork thread new`, never here.
- **No writing product code in this command.** Writing is the job of the session that `ork`
  dispatches, with the prompt recorded and its sha in the ledger.
