---
id: RM-005
tipo: roadmap
titulo: MASTER ratificado e digest semanal
categoria: iniciativa
pai: null
features: [FEAT-015]
owner: Julio
atualizado_em: 2026-09-24T21:33:12-03:00
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
sdlc:
  thread: ork-i05masterrat
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-005 — MASTER ratificado e digest semanal

> **Em uma frase:** O fechamento separa proposta, score humano e encerramento administrativo, e um digest semanal leva as entregas ao dono na sexta-feira.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-015](../produto/FEAT-015-entrega-e-indice-master.md)
- **Thread:** `ork-i05masterrat`

## Problema e resultado

- **Problema:** MASTER usado para descartar órfãs e score sem humano (diagnóstico de 07/09).
- **Resultado:** `ork.master-pending/v1`, `ork.master-log/v1`, `thread_closed_admin` e digest.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Critério de aceite:** fechadas com `por` humano ou `closed_admin`.
- **Mudança posterior:** a fila de ratificação de score foi aposentada pela [RM-043](RM-043-aposentadoria.md), trocada por aceitação por default com índice derivado do ledger.

## Plano e decisões

- **Decisão de 20/09/2026:** lembrete não converte em nota; a fila sai.

## Estado com evidências

- Merge `956105c` (07/09/2026).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-24 | Julio |
| Testes | Aprovados | — | 2026-09-24 | Julio |
| Deploy | Produção | — | 2026-09-24 | Julio |
| Exposição | Geral | — | 2026-09-24 | Julio |
| Habilitação | Concluída | — | 2026-09-24 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-07 | entregue | merge `956105c` | Julio |
| 2026-09-24 | fila de ratificação aposentada | RM-043, merge `6c5fe8d` | Julio |
