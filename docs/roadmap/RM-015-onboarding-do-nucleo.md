---
id: RM-015
tipo: roadmap
titulo: Onboarding do núcleo
categoria: iniciativa
pai: null
features: [FEAT-023]
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
  thread: ork-onboardingnu
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-015 — Onboarding do núcleo

> **Em uma frase:** Pauta de nove etapas, persistência idempotente, referências de credencial sem segredo e memória opcional, nos três hosts.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-023](../produto/FEAT-023-onboarding-do-projeto.md)
- **Thread:** `ork-onboardingnu`

## Problema e resultado

- **Problema:** cada projeto novo começava do zero e sem roteiro.
- **Resultado:** contrato `ork.onboarding/v1` e rotas nos três hosts.
- **Métricas:** Não aplicável — item anterior ao padrão v1.1 (24/09/2026); a métrica e a meta não foram registradas no plano da época.

## Escopo e validação

- **Fora de escopo:** `install.sh`, perfis de stack e cronômetro em máquina limpa.

## Plano e decisões

- **Decisão:** valores secretos só no `.env` do host.

## Estado com evidências

- Merge `f81ac8c` (08/09/2026).

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
| 2026-09-08 | entregue | merge `f81ac8c` | Julio |
