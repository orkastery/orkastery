---
id: RM-025
tipo: roadmap
titulo: "Company Brain: fundação"
categoria: iniciativa
pai: null
features: [FEAT-024]
owner: Julio
atualizado_em: 2026-09-24T21:33:13-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: 9b7fef1
    pr: null
sdlc:
  thread: ork-companybrai2
  modo: "#Maestro"
  fase: SHIP
  status: aberta
---

# RM-025 — Company Brain: fundação

> **Em uma frase:** A ontologia empresarial (pessoas, processos, geografias, sistemas, metas e decisões) com captura, proveniência e histórico, no OrkMind e no `ork brain`.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-024](../produto/FEAT-024-company-brain-no-cli.md)
- **Thread:** `ork-companybrai2`

## Problema e resultado

- **Problema:** o conhecimento da empresa não era citável pela fábrica.
- **Resultado pretendido:** B1 a B7 com fontes reconciliadas e contexto citável.
- **Métrica:** A definir — Julio, na retomada do Company Brain.

## Escopo e validação

- **Entregue até aqui:** B1 e B2 (merge `3962717`) e C2/B3 (merge `9b7fef1`), só na trilha do Orkastery.
- **Faltando:** B4 a B7.

## Plano e decisões

- **Produto principal:** OrkMind.
- **Horizonte:** depois da pausa de uso do dono (a partir de 25/09/2026).

## Estado com evidências

- Código parcial na `main`: último merge `9b7fef1` (16/09/2026).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `9b7fef1` | 2026-09-24 | Julio |
| Testes | Aprovados | — | 2026-09-24 | Julio |
| Deploy | Produção | — | 2026-09-24 | Julio |
| Exposição | Parcial | — | 2026-09-24 | Julio |
| Habilitação | Em andamento | — | 2026-09-24 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-14 | B1 e B2 mesclados | merge `3962717` | Julio |
| 2026-09-16 | C2/B3 mesclado | merge `9b7fef1` | Julio |
