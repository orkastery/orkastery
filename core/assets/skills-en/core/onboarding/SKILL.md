---
name: onboarding
description: "Runs or resumes the project's setup interview through the ork onboarding agenda. Use it to record public answers, check pending items, reset an answer or publish the interview to memory."
bucket: core
roteia: "ork onboarding | ork doctor"
license: MIT
---

# Project onboarding

Use `ork onboarding` to get the agenda and `ork onboarding show --json` to resume
the pending steps. The order, the contract and the validation belong to the core; do not keep
a parallel list of steps in the skill or in the host. Do not create a thread just to interview.

Work through the agenda's questions, using the builder's answers. Record each public answer
with `ork onboarding set <etapa> --conteudo <JSON> --por <quem>`. Carry the JSON as data,
with proper shell escaping. Do not invent answers or authorship; `owner` is the CLI default,
not a declaration that the human answered.

At the maestro step, check `ork experiencia show --json` and present the options: the detected
recommended one, configure, and turn off. Record only the choice received in `owner`, with
`language`, `timezone`, `depth` and `experience`. The core persists these keys in the manifest,
preserving the other answers. Opt-out example:
`ork onboarding set maestro --conteudo '{"owner":{"experience":false}}' --por equipe`.
Without an answer, keep the question pending: effective defaults are not human authorship.

Ask only for variable references in the sensitive steps. Secret values stay in the environment of the
process or in the host's vault (in Hermes, `~/.hermes/.env`); do not read them or carry credentials into
the conversation, onboarding or ledger.
If the builder provides a secret, do not repeat it: guide them through the local configuration and record only
the public reference accepted by the core.

Repeating identical content preserves authorship, stamp and events. A reset requires an explicit request:
use `ork onboarding reset [etapa]` (omitting the step clears all of them). Read the state again after the operation.

The optional publication uses `ork onboarding sync --json`. The files regime or an unavailable driver
produces a typed degradation; the interview can finish in files. Do not announce memory as published
when the result reports degradation. The recorded choice guides `memory.mode` in the manifest,
without changing it automatically. `ork doctor` shows pending items and choice divergence.

When finished, present the state measured by `ork onboarding show --json` and any pending items.
A structural eval does not prove LLM behavior or weeks of operation; that half stays
unavailable until an observed run exists.

## Racionalizacoes comuns (Common rationalizations)

| Excuse | Response |
|---|---|
| "Keeping the token here is faster" | Keep only references; values stay in the local secrets file. |
| "#Auto allows inventing the rest" | The answers come from the builder; autonomy does not create facts. |
| "Files means incomplete onboarding" | The local interview finishes; report the degradation reason without claiming publication. |

## Bandeiras vermelhas (Red flags)

- A list of steps or validation copied from the core into the host.
- A credential in an answer, prompt or ledger.
- A reset without a builder request, or inferred human authorship.
- Publication declared without checking the sync result.
