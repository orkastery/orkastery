<!-- orkastery:begin -->
## Orkastery

Projeto: **orkastery** (ork). Branch base: `main`.

- Comece com `ork doctor`, `ork onboarding` e `ork thread status <thread>`.
- Conduza o ciclo GOAL → PLAN → GO → CHECK → SHIP → MASTER pelo `ork`.
- Respeite o modo da thread: #Classic, #Maestro, #Auto, #Fast.
- Edite produto somente na worktree vinculada; estado em `.orkastery/` pertence ao núcleo.
- PLAN não implementa. GO usa commits atômicos. CHECK não corrige. SHIP acontece por `ork ship`.
- Toda alegação exige claim e comando reproduzível; self-report não é evidência.

Verificações do manifesto:

- build: `npm --prefix core run build`
- test: `npm --prefix core test`

Este bloco é mantido por `ork init`. Edite livremente o restante do arquivo.
<!-- orkastery:end -->
