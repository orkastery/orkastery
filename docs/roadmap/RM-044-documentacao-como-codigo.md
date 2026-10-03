---
id: RM-044
tipo: roadmap
titulo: Documentação como código com paridade
categoria: iniciativa
pai: null
features: [FEAT-018]
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
  thread: ork-i44docscomoc
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-044 — Documentação como código com paridade

> **Em uma frase:** Documentação de produto e roadmap no repositório, legíveis por pessoa com TDAH e por agentes, e conferidas contra o código e o git em todo PR.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Concluído | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-018](../produto/FEAT-018-documentacao-como-codigo.md)
- **Thread:** `ork-i44docscomoc`

## Problema e resultado

- **Problema:** a documentação dizia uma coisa e o código outra, e ninguém percebia até o dono tropeçar.
- **Hipótese:** Se toda afirmação conferível da doc for checada no CI, então a doc para de mentir, porque divergência vira PR vermelho.
- **Métrica:** zero erro de `ork docs verificar` na `main`.

## Escopo e validação

- **Incluído:** padrões v1.1, `ork docs verificar|sincronizar|init`, markdownlint no CI, aplicação neste repositório.
- **Fora de escopo:** extrair a ajuda de CLI de outros produtos (só `ork` é conferido hoje).

## Plano e decisões

- **Decisão:** a doc carrega fatos de SDLC do produto; micro-decisões ficam no ledger.

## Estado com evidências

- Merge `fc0ab14` (PR #20, 24/09/2026) pelo CI independente: `documentacao`, núcleo em Node 20 e 22 e `ork-verify` verdes no SHA exato.
- Em produção desde 24/09/2026 22h03: o `ork` global foi recompilado da `main` com `ork docs`.
- Habilitação: README, padrões em `docs/padroes/` e a seção 13 do guia do site publicados.

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
| 2026-09-24 | thread aberta e implementação | pedido do dono | Julio |
| 2026-09-24 | mesclado e em produção | PR #20, merge `fc0ab14`; `ork` recompilado da `main` | Julio |
| 2026-09-28 | concluído | em produção desde o merge; MASTER aceito por omissão em 27/09/2026 (score gravado 5/5) | Julio |
| 2026-10-03 | Fatia na thread `ork-rm044registr`: o `ork ship registrar-pr` lista a página com `sdlc.thread` da thread registrada que o push da `main` reprova em `docs.paridade.merge`, com o comando de sincronizar e o campo `docsPendentes` no `--json`; só aviso | 6 pushes da `main` vermelhos em 02 e 03/10 e os PRs de docs #67 e #75; teste `rm044-registrar-pr-docs` | Condutor #Auto, por delegação do dono |
