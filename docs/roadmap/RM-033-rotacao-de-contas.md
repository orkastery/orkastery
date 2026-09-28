---
id: RM-033
tipo: roadmap
titulo: Rotação de contas e perfis dos runtimes
categoria: iniciativa
pai: null
features: [FEAT-008]
owner: Julio
atualizado_em: 2026-09-24T21:33:13-03:00
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
  thread: ork-i33rotacaoco
  modo: "#Maestro"
  fase: MASTER
  status: fechada
---

# RM-033 — Rotação de contas e perfis dos runtimes

> **Em uma frase:** Quando uma conta esgota, o roadmap não para: o prompt segue em outro perfil do mesmo runtime ou no fallback do bloco, sem o `ork` tocar em credencial.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-008](../produto/FEAT-008-rodizio-de-contas.md)
- **Thread:** `ork-i33rotacaoco`

## Problema e resultado

- **Problema:** em 18/09/2026 um bloco morreu em 58 s porque a única conta Codex ficou sem crédito, classificado como `runtime.unavailable`.
- **Resultado:** `ork accounts`, motivos `runtime.quota-exhausted` e `runtime.auth-missing`, fallback por bloco.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Critério de aceite:** a fase morta por cota segue sozinha no próximo perfil com login.
- **Lacuna conhecida:** estado de conta por projeto ([RM-040](RM-040-estado-de-conta-compartilhado.md)).

## Plano e decisões

- **Decisão do dono (19/09/2026):** rotação no mesmo runtime ligada por padrão; registrada no `SECURITY.md`.

## Estado com evidências

- Merge `28a7fd5` (19/09/2026).
- Levada a outros dois projetos da fábrica de referência em 20/09/2026.

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
| 2026-09-19 | entregue | merge `28a7fd5` | Julio |
