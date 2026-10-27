---
id: RM-016
tipo: roadmap
titulo: Experiência do builder em Claude Code e Codex
categoria: iniciativa
pai: null
features: [FEAT-020]
owner: Julio
atualizado_em: 2026-10-27T00:50:00-03:00
estado:
  ciclo: Concluído
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída
evidencias:
  codigo:
    commit: 10ca416
    pr: null
  deploy:
    release: código desde o Orkastery 0.3.0 (10ca416); o fecho do GO igual no Codex e no Claude Code na v0.6.0, @orkastery/cli no npm
sdlc:
  thread: ork-i16experienc
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-016 — Experiência do builder em Claude Code e Codex

> **Em uma frase:** Iniciar, acompanhar, decidir, retomar e receber entrega em Claude Code e Codex com a mesma jornada do Hermes e do OpenClaw.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-020](../produto/FEAT-020-mcp-e-adaptadores.md)
- **Thread:** `ork-i16experienc`

## Problema e resultado

- **Problema:** a jornada só era fluida pelo Telegram.
- **Resultado:** paridade das cinco jornadas nos dois runtimes.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Critério de aceite:** 46 de 46 claims no SHIP e suíte 709 de 709 (registro da época).

## Plano e decisões

- **Decisão:** prioritária, antes de docs e sites (pedido de 09/09/2026).

## Estado com evidências

- Merge `85eb2bb` (12/09/2026).
- Na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026): o Codex e o Claude Code fecham o GO com os mesmos artefatos.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-10-27 | Julio |
| Documentação | Em revisão | — | 2026-10-27 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-10-27 | Julio |
| Testes | Aprovados | — | 2026-10-27 | Julio |
| Deploy | Produção | release: código desde o Orkastery 0.3.0 (10ca416); o fecho do GO igual no Codex e no Claude Code na v0.6.0, @orkastery/cli no npm | 2026-10-27 | Julio |
| Exposição | Geral | — | 2026-10-27 | Julio |
| Habilitação | Concluída | — | 2026-10-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-12 | entregue | merge `85eb2bb` | Julio |
| 2026-10-27 | O fecho do GO igual no Codex e no Claude Code em produção na 0.6.0 | Tag `v0.6.0`, com o merge `84f5fa15` na tag; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
