---
id: RM-026
tipo: roadmap
titulo: Workspace empresarial e Maestro
categoria: iniciativa
pai: null
features: [FEAT-024, FEAT-033]
owner: Julio
atualizado_em: 2026-10-03T03:42:28+00:00
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
    commit: 46220bc
    pr: 27
    anteriores: "a17ff88 (PR #21, contexto citável)"
  testes:
    ci: verde no push do merge (run 36662685901) e no da v0.5.0 (run 36815186450)
  deploy:
    release: v0.5.0, @orkastery/cli 0.5.0 no npm
sdlc:
  thread: ork-rm026k7conhe
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

- **Features:** [FEAT-024](../produto/FEAT-024-company-brain-no-cli.md), [FEAT-033](../produto/FEAT-033-dossie-de-decisao.md)
- **Thread:** `ork-rm026k7conhe` (K7, GOAL e PLAN); antes, `ork-rm026k3dossi` (K3.1) e `ork-companybrai3`

## Problema e resultado

- **Problema:** a jornada prioritária do Company Brain não existia.
- **Resultado pretendido:** K1 a K7, conduzidos por agentes, CLI, MCP e os hosts (Claude Code, Codex, Hermes e OpenClaw), sem interface web.
- **Métrica do item:** a definir pelo dono.
- **Métrica da fatia K3.1:** 100% das decisões do dossiê com a citação da linha do ledger e o id do Brain conferido; nenhuma resposta do dono mostrada sem recibo conferido.

## Escopo e validação

- **Entregue até aqui:**
  - K1, cartões, estados e criação: identidade, estado e criação recuperável no núcleo (merge `580abb9`).
  - Investigar: o pacote de contexto citável da [RM-025](RM-025-company-brain-fundacao.md) (B4.1) chega aos quatro hosts (thread `ork-companybrai3`, PR #21, merge `a17ff88`).
  - K3.1, dossiê de decisão somente leitura ([FEAT-033](../produto/FEAT-033-dossie-de-decisao.md)): `ork brain dossie` e `ork_brain_dossie` no MCP, no OpenClaw e no repasse do Hermes. Liga cada decisão da thread ao objetivo (o ticket do K1) e ao projeto do portfólio, com o contexto citável, as alternativas, quem decidiu, a evidência e os ids do Brain (thread `ork-rm026k3dossi`, PR #27, merge `46220bc`).
- **Saiu com a interface web:** o protótipo K2 (biblioteca, estratégia e Kanban) vivia na interface web, que saiu dos repositórios públicos em 28/09/2026 (commit `7eb942d`).
- **Faltando, sem interface web:**
  - O resto do K3: objetivo estratégico e projeto organizacional (dependem da B3), alternativas na decisão informada (mudança do contrato HITL), respostas a sessão nativa e o `objective_id` no `cycle` capturado pelo Brain.
  - K4, Maestro com contexto citado nos quatro hosts.
  - K5, roadmap, decisões e indicadores.
  - K6, aceite da jornada por tarefas nos hosts, no lugar do aceite de interface.
  - K7, conhecimento escrito (documentos, coleções e referências) por CLI e MCP.

## Plano e decisões

- **Dependência:** [RM-025](RM-025-company-brain-fundacao.md).
- **Superfície:** agentes, CLI, MCP e hosts. A interface web está fora do escopo (decisão do dono em 28/09/2026).

### K7, conhecimento escrito: GOAL e PLAN, à espera da escolha do dono

Thread `ork-rm026k7conhe` (#Auto, 03/10/2026). Nenhum código entra antes da escolha: o K7 pede
contrato público novo (classe 2), e contrato novo é do dono.

- **Objetivo:** um agente, pela CLI ou pelo MCP, lista, lê e cita um documento escrito da empresa
  (política, especificação, guia), sabe a que coleção ele pertence e a que produto, projeto,
  iniciativa ou decisão ele se refere, com a versão e a fonte de cada resposta. Sem interface web.
- **Por que é classe 2:** nenhum contrato vigente tem documento nem coleção. O
  `orkmind.company-brain/v1` só tem os tipos `prod`, `proj` e `init`
  (`core/src/company-brain-contract.ts`), e o `orkmind.company-brain-api/v1` só tem as operações
  `capabilities`, `ingest`, `get`, `query`, `receipts` e `head` (`core/src/company-brain-client.ts`).
  Qualquer caminho cria um schema novo, comandos novos e tools MCP novas.
- **Pronto quando (para qualquer alternativa):** `ork` e as tools MCP listam as coleções, leem um
  documento com versão e fonte, e devolvem as referências dele com cada id do Brain conferido por
  `get`; documento ou referência que não confere sai como lacuna tipada, nunca como resposta; o
  mesmo teste reprova o código de antes; os quatro hosts (Claude Code, Codex, Hermes e OpenClaw)
  chegam às mesmas tools, como no K3.1.

Alternativas, para o dono escolher uma:

- **a) (Recomendação) Documento como arquivo versionado no repositório, contrato do lado do ork.**
  Schema novo `ork.conhecimento/v1`: cada documento é um Markdown numa pasta declarada no
  `orkastery.yaml`, com frontmatter (id `doc-...`, título, coleções e referências a ids do Brain e
  a decisões `thread#linha` do ledger); a coleção é o nome no frontmatter, sem arquivo próprio.
  Comandos `ork conhecimento colecoes|listar|ler|referencias` e tools `ork_conhecimento_*`, só
  leitura; escrever é commit numa thread, com PR, como todo o resto. Por quê: o git já dá versão,
  revisão e histórico; não muda o OrkMind nem o contrato do Brain; as referências reaproveitam o
  `get` e a citação do ledger do dossiê. Custo: 2 a 3 fatias; o conhecimento fica por repositório
  até a federação.
- **b) Tipos novos no Company Brain.** `doc` e `col` no `orkmind.company-brain/v1`, asserções
  `cita` e `pertence_a`, e operações de documento no `orkmind.company-brain-api/v1`. Por quê: o
  conhecimento fica no PostgreSQL do tenant, com a ACL e os recibos do Brain. Custo: muda o contrato
  nos dois repositórios, pede versão do OrkMind antes da do ork, e é a mesma ratificação que a B3 da
  RM-025 espera.
- **c) Coleções de memória que o OrkMind já tem.** As coleções `content` e `docs` entram no escopo do
  ork (`COLECOES_DO_ORK`), com a governança da memória. Por quê: nenhum contrato do OrkMind muda.
  Custo: a entrada de memória não tem versão nem id do Brain, então a referência não é citável como
  no dossiê, e as duas coleções passam a valer para todo projeto com `memory: orkmind`.
- **d) Esperar o K5 e o K6.** O K7 volta depois que o dono disser o que o K5 mede. Custo: o item
  fica parado.

Se a escolha for a (a), o GO segue em três fatias: (1) o schema, a leitura da pasta e a validação,
com as lacunas tipadas; (2) a CLI e as tools MCP, com as referências conferidas; (3) os hosts
OpenClaw e Hermes e a página de produto nova.

## Estado com evidências

- Código na `main`: K1, presente desde `10ca416` (Orkastery 0.3.0). O merge `580abb9` é do histórico anterior à 0.3.0.
- Contexto citável na `main` pelo PR #21 (merge `a17ff88`), com o CI verde no push do merge (run 36563382672).
- Dossiê de decisão (K3.1) na `main` pelo PR #27 (merge `46220bc`), com o CI verde no push do merge (run 36662685901).
- Os dois em produção na versão 0.5.0: tag `v0.5.0` (merge `2418a4e`, PR #36), `@orkastery/cli` 0.5.0 no npm, CI verde no push da versão (run 36815186450).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-03 | Julio |
| Documentação | Em revisão | — | 2026-10-03 | Julio |
| Código | Mesclado | commit `46220bc` · PR #27 · anteriores: a17ff88 (PR #21, contexto citável) | 2026-10-03 | Julio |
| Testes | Aprovados | ci: verde no push do merge (run 36662685901) e no da v0.5.0 (run 36815186450) | 2026-10-03 | Julio |
| Deploy | Produção | release: v0.5.0, @orkastery/cli 0.5.0 no npm | 2026-10-03 | Julio |
| Exposição | Parcial | — | 2026-10-03 | Julio |
| Habilitação | Em andamento | — | 2026-10-03 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-14 | K1 e K2 mesclados | merge `580abb9` | Julio |
| 2026-09-28 | workspace sem interface web; o K2 saiu com a interface | decisão do dono em 28/09/2026, commit `7eb942d` | Julio |
| 2026-09-28 | contexto citável nos quatro hosts | thread `ork-companybrai3`, por PR | thread `ork-companybrai3` (#Auto) |
| 2026-09-29 | K3.1, dossiê de decisão somente leitura | thread `ork-rm026k3dossi`, por PR | thread `ork-rm026k3dossi` (#Auto) |
| 2026-09-29 | contexto citável mesclado na `main` | PR #21, merge `a17ff88` | Julio |
| 2026-09-30 | K3.1 mesclado na `main` | PR #27, merge `46220bc` | Julio |
| 2026-10-01 | contexto citável e K3.1 em produção na versão 0.5.0 | tag `v0.5.0` (PR #36), `@orkastery/cli` 0.5.0 no npm | Julio |
| 2026-10-03 | K7: GOAL e PLAN com quatro alternativas; o código espera a escolha do dono, porque o K7 é contrato público novo (classe 2) | thread `ork-rm026k7conhe`, decisões no ledger | thread `ork-rm026k7conhe` (#Auto) |
