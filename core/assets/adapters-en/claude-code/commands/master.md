---
description: Closes the thread with a typed POSTMORTEM and the human score from 0 to 5.
argument-hint: "<thread-id>"
allowed-tools: Bash(ork:*), Read, Glob, Grep
---

# /master

MASTER phase (F6): typed POSTMORTEM, MASTER log in the frozen contract and the human score with a justification. A delivery without a MASTER log did not happen.

## What this command does

1. Shows the builder the failure classes from the fixed catalog:

```bash
ork master classes
```

2. Asks the owner for the score through the channel that carries proof (RM-048). **The score belongs to the human, in every mode.**
   This command never makes up a score and never writes `--por` on anyone's behalf:

```bash
ork master pedir <thread> --formato terminal
```

   Show the line as it comes. The owner replies through Telegram (`<codigo> <0 a 5> <porque>`) and the core
   records the score with the ingress receipt. `ork master <thread> --score ... --por` called from here is
   refused with `master.prova-de-canal`; from their own terminal, outside the host, the owner can use it.
3. Check that the score made it into the ledger:

```bash
ork master --todas
```

4. In modes with no MASTER pause, the delivery is accepted unless the builder says otherwise;
   `ork master --todas` shows the deliveries with the ledger-derived index, including those already scored.
   To close by default, always pass the thread, so that only yours is closed:

```bash
ork master <thread> --aceitar-omissao
```

   Without the thread, the command accepts ALL of the project's delivered threads, including those from other parallel
   workstreams; `ork master --aceitar-omissao --dry-run` shows which ones, without recording.

## Adapter rules

- **Zero business logic here.** This command turns intent into an `ork` call and nothing more.
  Validating the mode, building the prompt, deciding the gate and proving the delivery is the core's job.
- **The #TAG comes from the request, not from configuration.** The mode comes from `ork modos --do-pedido`, which uses the
  same function as the core; without a tag, the manifest's `conduction.default_mode` applies. Validation
  against `conduction.allowed_modes` happens inside `ork thread new`, never here.
- **No writing product code in this command.** Writing is the job of the session that `ork`
  dispatches, with the prompt recorded and its sha in the ledger.
