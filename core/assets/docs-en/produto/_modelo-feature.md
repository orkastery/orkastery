---
id: FEAT-000
tipo: feature
titulo: <Feature name>
estado: proposto
pai: MOD-00
roadmap: [RM-000]
owner: <name>
aprovador: <name>
verificado_em: 2026-01-01T00:00:00-03:00
versao: main@0000000
fontes:
  codigo: []
  testes: []
  simbolos: []
  contratos: []
  comandos: []
---

<!-- The feature number comes from `ork roadmap feat --thread <thread>`, reserved across machines; never from the highest number on your branch. -->
<!-- Keep the frontmatter keys and values, the section titles and the "Em uma frase" line as they are: `ork docs verificar` reads them in Portuguese in every language. -->

# FEAT-000: Feature name

> **Em uma frase:** [what this feature does, for whom, in up to 240 characters]

- **State:** `proposto` · **Verified on:** [YYYY-MM-DD] · **Version:** [branch@commit]
- **Where it lives:** [PLAT-00 > SYS-00 > MOD-00, with links]
- **Roadmap:** [RM-000, with a link]
- **Page owner / approver:** [names]

## Comportamento

- **Use cases and operations:** [UC-ID, action, actor]
- **Preconditions and trigger:** [what must exist and what starts it]
- **Main flow:**
  1. [observable step]
- **Alternatives, errors and recovery:** [error, cancellation, timeout, resume]
- **Postconditions:** [what is recorded, emitted or changed outside]
- **Business rules:** [BR-ID: condition → result; exception]
- **Acceptance criteria and tests:** [Given/When/Then, with the test that proves it]
- **Interface and accessibility:** [screens, states, prototype, or Not applicable: reason]

## Dados e contratos

- **Entities and fields:** [links, types, validations, sensitivity]
- **APIs and endpoints:** [IDs, methods, contracts, errors, versioning]
- **Events and jobs:** [IDs, schemas, triggers, retries, time zone]

## Operação e controle

- **Configuration and environments:** [parameters, no secrets]
- **Observability:** [metrics, SLO, logs, alerts, runbook]
- **Access, privacy and compliance:** [applicable controls]
- **Dependencies and rollback:** [what it uses and how to roll it back]
- **Code, PR, tests and release:** [identifiable links]

## Histórico

| Date | Change | Author/reviewer | Evidence or decision |
| --- | --- | --- | --- |
| [YYYY-MM-DD] | [description] | [names] | [link] |
