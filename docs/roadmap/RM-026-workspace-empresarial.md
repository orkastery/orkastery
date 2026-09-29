---
id: RM-026
tipo: roadmap
titulo: Workspace empresarial e Maestro
categoria: iniciativa
pai: null
features: [FEAT-024]
owner: Julio
atualizado_em: 2026-09-29T23:48:35+00:00
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
    commit: a17ff88
    pr: null
sdlc:
  thread: ork-companybrai3
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-026 — Workspace empresarial e Maestro

> **Em uma frase:** Escrever, investigar, decidir e conduzir a fábrica a partir do conhecimento da empresa, sem interface web: agentes, CLI, MCP e os hosts usam contexto citável, dossiês, coleções e métricas.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-024](../produto/FEAT-024-company-brain-no-cli.md)
- **Thread:** `ork-companybrai3`

## Problema e resultado

- **Problema:** a jornada prioritária do Company Brain não existia.
- **Resultado pretendido:** K1 a K7, conduzidos por agentes, CLI, MCP e os hosts (Claude Code, Codex, Hermes e OpenClaw), sem interface web.
- **Métrica do item:** a definir pelo dono.

## Escopo e validação

- **Entregue até aqui:**
  - K1, cartões, estados e criação: identidade, estado e criação recuperável no núcleo (merge `580abb9`).
  - Investigar: o pacote de contexto citável da [RM-025](RM-025-company-brain-fundacao.md) (B4.1) chega aos quatro hosts (thread `ork-companybrai3`).
- **Saiu com a interface web:** o protótipo K2 (biblioteca, estratégia e Kanban) vivia na interface web, que saiu dos repositórios públicos em 28/09/2026 (commit `7eb942d`).
- **Faltando, sem interface web:**
  - K3, dossiê de decisão ligado a objetivo e projeto, com os mesmos IDs no Brain.
  - K4, Maestro com contexto citado nos quatro hosts.
  - K5, roadmap, decisões e indicadores.
  - K6, aceite da jornada por tarefas nos hosts, no lugar do aceite de interface.
  - K7, conhecimento escrito (documentos, coleções e referências) por CLI e MCP.

## Plano e decisões

- **Dependência:** [RM-025](RM-025-company-brain-fundacao.md).
- **Superfície:** agentes, CLI, MCP e hosts. A interface web está fora do escopo (decisão do dono em 28/09/2026).

## Estado com evidências

- Código na `main`: K1, presente desde `10ca416` (Orkastery 0.3.0). O merge `580abb9` é do histórico anterior à 0.3.0.
- Contexto citável: branch `ork/ork-companybrai3-full`, entregue por PR.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-29 | Julio |
| Documentação | Em revisão | — | 2026-09-29 | Julio |
| Código | Mesclado | commit `a17ff88` | 2026-09-29 | Julio |
| Testes | Aprovados | — | 2026-09-29 | Julio |
| Deploy | Produção | — | 2026-09-29 | Julio |
| Exposição | Parcial | — | 2026-09-29 | Julio |
| Habilitação | Em andamento | — | 2026-09-29 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-14 | K1 e K2 mesclados | merge `580abb9` | Julio |
| 2026-09-28 | workspace sem interface web; o K2 saiu com a interface | decisão do dono em 28/09/2026, commit `7eb942d` | Julio |
| 2026-09-28 | contexto citável nos quatro hosts | thread `ork-companybrai3`, por PR | thread `ork-companybrai3` (#Auto) |
