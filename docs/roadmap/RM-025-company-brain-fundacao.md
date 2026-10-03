---
id: RM-025
tipo: roadmap
titulo: "Company Brain: fundação"
categoria: iniciativa
pai: null
features: [FEAT-024]
owner: Julio
atualizado_em: 2026-10-03T04:29:37+00:00
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
    pr: 21
  testes:
    ci: verde no push do merge (run 36563382672) e no da v0.5.0 (run 36815186450)
  deploy:
    release: v0.5.0, @orkastery/cli 0.5.0 no npm
sdlc:
  thread: ork-rm025modocon
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
- **Thread:** `ork-rm025modocon` (a mais recente); antes, `ork-companybrai3`

## Problema e resultado

- **Problema:** o conhecimento da empresa não era citável pela fábrica.
- **Resultado pretendido:** B1 a B7 com fontes reconciliadas e contexto citável.
- **Métrica do item:** a definir pelo dono.
- **Métrica da fatia B4.1:** 100% dos itens do pacote de contexto com a citação inteira e o frescor calculado; toda divergência entre o Brain e o portfólio sai como lacuna. Em 28/09/2026 havia 1 entidade do portfólio ausente no Brain.

## Escopo e validação

- **Entregue até aqui:**
  - B1, contratos: `orkmind.company-brain/v1`, o mesmo schema no núcleo e no OrkMind (merge `3962717`).
  - B2, captura da fábrica: portfólio e ledger por thread, com recibos (merge `3962717`). A escrita no Brain depende da ativação, hoje desligada.
  - B4.1, pacote de contexto citável: `ork brain context`, a ferramenta `ork_brain_context` no MCP e no OpenClaw e o repasse do Hermes (thread `ork-companybrai3`, PR #21, merge `a17ff88`, na versão 0.5.0).
  - B4.2 no OrkMind: o modo `context` da seleção (pacote `orkmind.company-brain-context/v1`, montado no servidor numa transação só de leitura), a operação `history` (versões append-only de uma entidade, com a origem de cada uma) e a documentação do Brain v1 em `docs/company-brain.md` (orkastery/orkmind PR #5, merge `b533e3e`, 29/09/2026; ainda sem versão publicada do OrkMind).
  - B4.2 no núcleo (thread `ork-rm025modocon`, 03/10/2026, PR a abrir): `ork brain context`, a `ork_brain_context` e o contexto do dossiê pedem primeiro o modo `context`, conferem o pacote do servidor (schema, tenant, pedido, digest, citação inteira, ordem, fecho de pais e destino de cada id) e só voltam a `query` e `get` com `brain.selection.context-unsupported`; pacote que não confere encerra com `conflict` e `brain.context.server-invalid`; o campo `caminho` diz por onde o pacote veio, fora do digest. Teste `rm025-b42-contexto-no-servidor`, com o pacote dourado do OrkMind copiado byte a byte.
- **Não entregue:**
  - B3, organização, geografias, sistemas e estratégia: o merge `9b7fef1` trouxe canais de HITL e documentação, sem tipos novos no contrato, que continua com `prod`, `proj` e `init`.
  - O resto da B4: consulta federada e afirmações no contexto.
  - `ork brain history` e a ferramenta `ork_brain_history` no núcleo: comando e ferramenta novos são contrato público novo (classe 2) e esperam o dono; a operação `history` já existe no OrkMind.
  - B5 a B7.
- **Validação da B4.1:** testes `company-brain-context`, `company-brain-mcp` e `company-brain-hosts`. No Brain de produção, em 28/09/2026, `ork brain context` com as 14 entidades do portfólio devolveu 14 itens com a citação inteira: 13 `confere` e 1 `ausente-no-brain`, em 1,8 s.

## Plano e decisões

- **Produto principal:** OrkMind.
- **Superfícies:** agentes, CLI, MCP e os hosts (Claude Code, Codex, Hermes e OpenClaw), sem interface web.
- **B4.1:** somente leitura, montada no núcleo a partir de `query` e `get`, sem mudar o contrato.
- **B4.2:** o servidor monta e cita; o núcleo confere e calcula o frescor contra o portfólio, que só ele tem. Os dois caminhos dão o mesmo digest para os mesmos dados.
- **Próxima fatia candidata:** com o aceite do dono, a leitura de histórico no núcleo (`ork brain history`); depois, afirmações no contexto. Na produção, o dono concede a ação `history` às concessões que devem ler histórico e roda `initialize()` para o índice novo do OrkMind.

## Estado com evidências

- Código na `main`: B1 e B2, presentes desde `10ca416` (Orkastery 0.3.0). Os merges `3962717` e `9b7fef1` são do histórico anterior à 0.3.0.
- B4.1 na `main` pelo PR #21 (merge `a17ff88`), com o CI verde no push do merge (run 36563382672).
- Em produção na versão 0.5.0: tag `v0.5.0` (merge `2418a4e`, PR #36), `@orkastery/cli` 0.5.0 no npm, CI verde no push da versão (run 36815186450).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-03 | Julio |
| Documentação | Em revisão | — | 2026-10-03 | Julio |
| Código | Mesclado | commit `a17ff88` · PR #21 | 2026-10-03 | Julio |
| Testes | Aprovados | ci: verde no push do merge (run 36563382672) e no da v0.5.0 (run 36815186450) | 2026-10-03 | Julio |
| Deploy | Produção | release: v0.5.0, @orkastery/cli 0.5.0 no npm | 2026-10-03 | Julio |
| Exposição | Parcial | — | 2026-10-03 | Julio |
| Habilitação | Em andamento | — | 2026-10-03 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-14 | B1 e B2 mesclados | merge `3962717` | Julio |
| 2026-09-16 | C2/B3 mesclado | merge `9b7fef1` | Julio |
| 2026-09-28 | objetivo novo sobre o código de hoje; threads de 13 e 14/09 superadas | decisão do dono em 28/09/2026 | Julio |
| 2026-09-28 | B3 deixa de constar como entregue | o merge `9b7fef1` não trouxe tipos novos; o contrato tem só `prod`, `proj` e `init` | thread `ork-companybrai3` (#Auto) |
| 2026-09-28 | B4.1, pacote de contexto citável | thread `ork-companybrai3`, por PR | thread `ork-companybrai3` (#Auto) |
| 2026-09-29 | B4.1 mesclado na `main` | PR #21, merge `a17ff88` | Julio |
| 2026-10-01 | B4.1 em produção na versão 0.5.0 | tag `v0.5.0` (PR #36), `@orkastery/cli` 0.5.0 no npm | Julio |
| 2026-10-03 | B4.2: o modo `context`, o `history` e a doc do Brain v1 já estavam no OrkMind (PR #5); o núcleo passa a usar o modo `context`; `ork brain history` fica com o dono (classe 2) | thread `ork-rm025modocon`, decisões no ledger, teste `rm025-b42-contexto-no-servidor`, PR a abrir | thread `ork-rm025modocon` (#Auto) |
