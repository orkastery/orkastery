---
id: RM-043
tipo: roadmap
titulo: Aposentadoria de cinco mecanismos
categoria: iniciativa
pai: null
features: [FEAT-001, FEAT-002, FEAT-015]
owner: Julio
atualizado_em: 2026-09-27T23:46:57-03:00
estado:
  ciclo: Disponível
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
  thread: ork-i43aposentad
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-043 — Aposentadoria de cinco mecanismos

> **Em uma frase:** Saíram dois modos que ninguém usava, a fila de notas, o envelope de objetivo, a cerimônia de instalação e a listagem inchada, cada um com canário provando que a falha segue evitada.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Disponível | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-001](../produto/FEAT-001-thread-e-seis-fases.md), [FEAT-002](../produto/FEAT-002-modos-de-conducao.md), [FEAT-015](../produto/FEAT-015-entrega-e-indice-master.md)
- **Thread:** `ork-i43aposentad`

## Problema e resultado

- **Problema:** mecanismos que produziam trabalho e não moviam entregas nem interrupções.
- **Medida:** 3 de 137 threads nos modos removidos; 13 notas esperando na fila.

## Escopo e validação

- **Regra:** escritores param de produzir; leitores aceitam para sempre.
- **Detalhe:** o que parou e o que continua, por mecanismo, está no [guia de modos](../guias/modos.md) e na [referência do CLI](../referencia/cli.md).

## Plano e decisões

- **Decisões de classe 2:** D3 (índice automático) e D4 (saída do `ork objective`).

## Estado com evidências

- Merge `6c5fe8d` (PR #18, 24/09/2026) pelo CI independente.
- MASTER pendente.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Disponível | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-27 | Julio |
| Testes | Aprovados | — | 2026-09-27 | Julio |
| Deploy | Produção | — | 2026-09-27 | Julio |
| Exposição | Geral | — | 2026-09-27 | Julio |
| Habilitação | Concluída | — | 2026-09-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-20 | thread aberta | pedido do dono | Julio |
| 2026-09-24 | mesclado pelo CI independente | PR #18, merge `6c5fe8d` | Julio |
