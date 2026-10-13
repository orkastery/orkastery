---
description: Conducts the thread's CHECK phase and consolidates a single verdict.
argument-hint: "<thread-id>"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /check

CHECK phase (F4): verification against the baseline, the five review axes, security with zero blockers, a delegation audit and exactly one verdict.

## What this command does

1. Re-runs everything on the real HEAD:

```bash
ork verify <thread>
ork worktree audit <thread>
```

2. Runs the four reviewers from the catalog over the declared scope: `code-reviewer`,
   `security-auditor`, `test-engineer` and `web-performance-auditor`. Use the
   `ork-check` subagent and its siblings when you want to isolate each one's context.

3. Reads the ledger for the delegation audit:

```bash
ork phase list <thread>
```

4. Consolidates ONE verdict (PASSOU = passed, PRECISA DE MUDANCA = needs changes, BLOQUEADO = blocked) and, if the mode pauses, opens the request
   and waits. The builder answers through the authenticated channel (the host's native dialog, or
   `/ork gate <thread> <pedido> <resposta>` in Telegram); the agent never answers for the builder:

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
