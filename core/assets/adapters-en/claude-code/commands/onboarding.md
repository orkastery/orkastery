---
description: Conducts or resumes the project interview following the agenda from the ork core.
argument-hint: "<onboarding request>"
allowed-tools: Bash(ork:*)
---

# /onboarding

Run `ork onboarding` to get the agenda and `ork onboarding show --json` to look up
the current answers. Work through the pending items following the agenda returned by the core. Do not duplicate
steps or validation in this host, and do not make up answers on the builder's behalf.

Record the requested public answer with `ork onboarding set <etapa> --conteudo <JSON> --por <quem>`.
Pass the JSON as an argument, with proper shell escaping; never execute the text you received.
Ask only for variable names for credentials. Secret values stay in the process environment
or in the host's vault (in Hermes, `~/.hermes/.env`); do not read them or carry values into the
conversation, the onboarding or the ledger.

A requested reset uses `ork onboarding reset [etapa]`. Optional publication uses
`ork onboarding sync --json`; present the typed degradation reason without blocking the interview.
The memory choice guides the manifest, without editing it automatically.
Finish with the state from `ork onboarding show --json`. Do not create a thread just to interview.
