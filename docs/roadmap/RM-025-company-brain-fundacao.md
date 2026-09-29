---
id: RM-025
tipo: roadmap
titulo: "Company Brain: fundação"
categoria: iniciativa
pai: null
features: [FEAT-024]
owner: Julio
atualizado_em: 2026-09-28T23:25:00-03:00
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
  thread: ork-companybrai3
  modo: "#Auto"
  fase: GOAL
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
- **Thread:** `ork-companybrai3`

## Problema e resultado

- **Problema:** o conhecimento da empresa não era citável pela fábrica.
- **Resultado pretendido:** B1 a B7 com fontes reconciliadas e contexto citável.
- **Métrica do item:** a definir pelo dono.
- **Métrica da fatia B4.1:** 100% dos itens do pacote de contexto com a citação inteira e o frescor calculado; toda divergência entre o Brain e o portfólio sai como lacuna. Em 28/09/2026 havia 1 entidade do portfólio ausente no Brain.

## Escopo e validação

- **Entregue até aqui:**
  - B1, contratos: `orkmind.company-brain/v1`, o mesmo schema no núcleo e no OrkMind (merge `3962717`).
  - B2, captura da fábrica: portfólio e ledger por thread, com recibos (merge `3962717`). A escrita no Brain depende da ativação, hoje desligada.
  - B4.1, pacote de contexto citável: `ork brain context`, a ferramenta `ork_brain_context` no MCP e no OpenClaw e o repasse do Hermes (thread `ork-companybrai3`).
- **Não entregue:**
  - B3, organização, geografias, sistemas e estratégia: o merge `9b7fef1` só mudou canais de HITL, e o contrato continua com `prod`, `proj` e `init`.
  - O resto da B4: consulta federada e afirmações no contexto, que pedem o modo `context` no OrkMind.
  - B5 a B7.
- **Validação da B4.1:** testes `company-brain-context`, `company-brain-mcp` e `company-brain-hosts`, e a medição no Brain de produção registrada no CHECK da thread.

## Plano e decisões

- **Produto principal:** OrkMind.
- **Superfícies:** agentes, CLI, MCP e os hosts (Claude Code, Codex, Hermes e OpenClaw), sem interface web.
- **B4.1:** somente leitura, montada no núcleo a partir de `query` e `get`, sem mudar o contrato.
- **Próxima fatia candidata:** o modo `context` e a leitura de histórico no OrkMind, e a documentação do Brain v1 no OrkMind.

## Estado com evidências

- Código na `main`: B1 e B2, presentes desde `10ca416` (Orkastery 0.3.0).
- B4.1: branch `ork/ork-companybrai3-full`, entregue por PR.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-28 | Julio |
| Documentação | Em revisão | — | 2026-09-28 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-28 | Julio |
| Testes | Aprovados | — | 2026-09-28 | Julio |
| Deploy | Produção | — | 2026-09-28 | Julio |
| Exposição | Parcial | — | 2026-09-28 | Julio |
| Habilitação | Em andamento | — | 2026-09-28 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-14 | B1 e B2 mesclados | merge `3962717` | Julio |
| 2026-09-16 | C2/B3 mesclado | merge `9b7fef1` | Julio |
| 2026-09-28 | objetivo novo sobre o código de hoje; threads de 13 e 14/09 superadas | decisão do dono (P5 a) | Julio |
| 2026-09-28 | B3 deixa de constar como entregue | o merge `9b7fef1` só tocou HITL; o contrato tem só `prod`, `proj` e `init` | thread `ork-companybrai3` (#Auto) |
| 2026-09-28 | B4.1, pacote de contexto citável | thread `ork-companybrai3`, por PR | thread `ork-companybrai3` (#Auto) |
