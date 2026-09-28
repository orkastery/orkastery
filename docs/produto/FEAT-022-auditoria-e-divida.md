---
id: FEAT-022
tipo: feature
titulo: Auditoria periódica e board de dívida
estado: vigente
pai: MOD-02
roadmap: [RM-100]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-24T21:30:00-03:00
versao: main@f9d9bc1
fontes:
  codigo:
    - core/src/auditoria.ts
    - core/src/auditrun.ts
    - core/src/divida.ts
    - core/src/superficie.ts
  testes:
    - core/test/auditoria.test.ts
    - core/test/superficie.test.ts
  simbolos:
    - core/src/divida.ts#gravarAchado
    - core/src/superficie.ts#REGRAS_DE_SUPERFICIE
  comandos:
    - ork audit packs
    - ork audit run
    - ork audit surface
    - ork audit divida
---

# FEAT-022 — Auditoria periódica e board de dívida

> **Em uma frase:** Sete packs de auditoria rodam pelo runtime, cada achado vira claim verificável, e a dívida fica num board append-only com recorrência.

- **Estado:** vigente · **Verificado em:** 2026-09-24 · **Versão:** main@f9d9bc1
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** rodar pack, registrar achado, varrer superfície de ataque, ver a dívida.
- **Pré-condições e gatilho:** estágio do produto (`nascente`, `crescendo`, `maduro`) no manifesto.
- **Fluxo principal:**

  1. `ork audit run <pack>` monta o prompt do pack e despacha.
  2. Cada achado tem evidência, claim e proposta; `ork audit verify` reexecuta as claims.
  3. `ork audit surface` varre rotas sem auth, admin exposto, CORS permissivo e afins.

- **Alternativas, erros e recuperação:** achado pode ser adiado, resolvido ou descartado, sempre com carimbo.
- **Pós-condições:** achados no board de dívida (append-only).
- **Regras de negócio:** BR-022-01: auditor sem self-report: claim do achado é reexecutada.
- **Critérios de aceite e testes:** Dada uma rota sem autenticação, quando a varredura roda, então sai diferente de zero (`core/test/superficie.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** board de dívida em `.orkastery/divida/`.
- **APIs:** Não aplicável.
- **Eventos:** `audit_finding`, `audit_report`.

## Operação e controle

- **Rollback:** `ork audit finding estado <id> descartado`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
