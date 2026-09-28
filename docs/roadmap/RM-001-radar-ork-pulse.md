---
id: RM-001
tipo: roadmap
titulo: Radar ork pulse e cron determinístico
categoria: iniciativa
pai: null
features: [FEAT-014]
owner: Julio
atualizado_em: 2026-09-24T23:03:12-03:00
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
    commit: aefa92e
    pr: null
sdlc:
  thread: ork-i01orkpulser
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-001 — Radar ork pulse e cron determinístico

> **Em uma frase:** Uma fila única de atenção humana, com carimbo de bloqueio e cron determinístico, para o dono não virar o monitor da fábrica.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-014](../produto/FEAT-014-monitor-board-e-pulse.md)
- **Thread:** `ork-i01orkpulser`

## Problema e resultado

- **Problema:** o dono perguntava o status várias vezes por dia e virava o monitor (diagnóstico de 07/09/2026, DM-01 e DM-03).
- **Resultado:** contrato `ork.pulse/v1`, três canários e cron na máquina da fábrica.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Incluído:** `ork pulse`, carimbo de bloqueio, estado único, cron.
- **Critério de aceite:** canários do pulse e ativação do host no ledger da entrega.
- **Pendência:** observação do `hitl.log` por 7 dias.

## Plano e decisões

- **Decisão de 20/09/2026:** cron desligado depois de 75 mensagens em minutos; volta em camadas com a [RM-041](RM-041-hitl-invertido.md).

## Estado com evidências

- Merges `aefa92e` e `72ef57a` (07/09/2026); CHECK cruzado e push no ledger da thread.
- Cron religado em 25/09/2026 às 01h33, de hora em hora, com a entrega em camadas ([RM-041](RM-041-hitl-invertido.md)) e a fila enxuta ([RM-045](RM-045-pulse-enxuto.md)): primeira varredura em 48 s, um único resumo com 6 itens.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-24 | Julio |
| Documentação | Em revisão | — | 2026-09-24 | Julio |
| Código | Mesclado | commit `aefa92e` | 2026-09-24 | Julio |
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
| 2026-09-07 | entregue | merges `aefa92e` e `72ef57a` | Julio |
| 2026-09-20 | cron do pulse desligado | 75 mensagens em minutos no Telegram | Julio |
| 2026-09-24 | cron mantido desligado | varredura de 9 min 30 s e fila com 92 itens (RM-045) | Claude (agente), a confirmar com Julio |
| 2026-09-25 | cron religado, de hora em hora | RM-045 em produção; primeira varredura em 48 s | Julio |
