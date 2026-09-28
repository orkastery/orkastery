---
id: RM-035
tipo: roadmap
titulo: Horário do dono em toda superfície humana
categoria: iniciativa
pai: null
features: [FEAT-013]
owner: Julio
atualizado_em: 2026-09-28T15:23:46-03:00
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
  thread: ork-i35horariodo
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-035 — Horário do dono em toda superfície humana

> **Em uma frase:** Nenhum horário para pessoa em UTC: o fuso do dono sai de uma fonte única e aparece uma vez por mensagem, em formato brasileiro.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-013](../produto/FEAT-013-horario-do-dono.md)
- **Thread:** `ork-i35horariodo`

## Problema e resultado

- **Problema:** o produto mostrava UTC a pessoas, em parte sem rótulo.
- **Evidência:** ordem do dono em 19/09/2026: "Nunca mais use horários UTC para se comunicar comigo".
- **Métrica:** zero horário em UTC cru nas superfícies humanas, cobrado pelo lint `horario-lint`.

## Escopo e validação

- **Dívida:** fatos `*Local` ocupam bytes do teto de 64 KB da página do Maestro (P3-5 do CHECK `c655cb5e`).

## Plano e decisões

- **Decisão:** máquina continua em UTC ISO; pessoa vê o fuso do dono.

## Estado com evidências

- Merge `4fbf14f` (20/09/2026). MASTER aceito por omissão em 27/09/2026, score gravado 5/5.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Concluído | — | 2026-09-28 | Julio |
| Documentação | Em revisão | — | 2026-09-28 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-28 | Julio |
| Testes | Aprovados | — | 2026-09-28 | Julio |
| Deploy | Produção | — | 2026-09-28 | Julio |
| Exposição | Geral | — | 2026-09-28 | Julio |
| Habilitação | Concluída | — | 2026-09-28 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-20 | mesclado | merge `4fbf14f` | Julio |
| 2026-09-28 | concluído | em produção desde o merge; MASTER aceito por omissão em 27/09/2026 (score gravado 5/5) | Julio |
