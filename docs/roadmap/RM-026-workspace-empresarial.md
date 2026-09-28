---
id: RM-026
tipo: roadmap
titulo: Workspace empresarial e Maestro
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
    commit: 10ca416
    pr: null
sdlc:
  thread: ork-c1oitocartoe
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-026 — Workspace empresarial e Maestro

> **Em uma frase:** Escrever, investigar, decidir e conduzir a fábrica a partir do conhecimento da empresa: cartões, biblioteca, coleções, dossiês e métricas.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-024](../produto/FEAT-024-company-brain-no-cli.md)
- **Thread:** `ork-c1oitocartoe`

## Problema e resultado

- **Problema:** a jornada prioritária do Company Brain não existia.
- **Resultado pretendido:** K1 a K7.
- **Métrica:** A definir — Julio, na retomada do Company Brain.

## Escopo e validação

- **Entregue até aqui:** K1 e K2 (merge `580abb9`).
- **Faltando:** K3 a K7.

## Plano e decisões

- **Dependência:** [RM-025](RM-025-company-brain-fundacao.md).

## Estado com evidências

- Código parcial na `main`: merge `580abb9` (14/09/2026).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-24 | Julio |
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
| 2026-09-14 | K1 e K2 mesclados | merge `580abb9` | Julio |
