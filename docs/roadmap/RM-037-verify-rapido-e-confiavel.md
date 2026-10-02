---
id: RM-037
tipo: roadmap
titulo: Verify rápido e confiável
categoria: iniciativa
pai: null
features: [FEAT-004]
owner: Julio
atualizado_em: 2026-09-28T15:23:46-03:00
estado:
  ciclo: Piloto
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
  thread: ork-i54compilaca
  modo: "#Auto"
  fase: MASTER
  status: fechada
---

# RM-037 — Verify rápido e confiável

> **Em uma frase:** Verify que distingue "não executado" de "reprovado", diz qual teste falhou e julga a máquina antes de julgar o código.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Piloto | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-004](../produto/FEAT-004-claims-e-verify.md)
- **Thread:** `ork-verifytimeou`

## Problema e resultado

- **Problema:** o verify local reprova por tempo quando a VPS perde 67% a 92% da CPU para o hipervisor (sar, 23 e 24/09/2026): a mesma suíte leva 3,4 min com CPU livre e 24 a 30 min com steal alto.
- **Métrica:** verify local com o mesmo veredito do CI em 10 de 10 rodadas.
- **Linha de base:** A definir — agente da thread, no PLAN revisado.

## Escopo e validação

- **Já entregue:** T5 (a árvore inteira morre no estouro do teto), merge `8f02f44` de 22/09/2026.
- **Defeitos de 27/09 a 01/10/2026 (thread `ork-rm037fatia3d`, fatia 3):** sete defeitos, cada um reproduzido com prova antes do código. Os seis que reproduziam na 0.5.0 têm teste `core/test/rm037-fatia3-*.test.ts` que reprova o código anterior:
  - o `ork docs verificar` acusa o item cuja thread já entrou na base e segue fora de `Mesclado` (`docs.paridade.merge`) e o índice que diverge do frontmatter (`docs.paridade.indice`); na `main` da 0.5.0 eram RM-031, RM-038, RM-051, RM-054 e o índice sem a RM-051. Escolha registrada: o verificador acusa no CI, em vez de o SHIP gravar, porque o merge é pelo GitHub e o `ship_done` vem do `ork ship registrar-pr`; no PR (`--pr`), as duas regras só avisam, e o push da `main` reprova;
  - o check `documentacao` do CI exige linha no CHANGELOG quando o PR muda `core/`, `adapters/` ou `marketplaces/`, com a exceção documentada para PR só de testes ou só de CI; sobre a história real, o checador reprova o #26 (`f0b79255`) e o #32 (`d2b180ea`), que entraram sem linha;
  - o `ork worktree sync` recusa a base reescrita com ancestral comum, que caía no `git rebase` e trazia de volta o commit tirado da base; o corte de 27/09 (raiz nova) já era coberto pela D-5;
  - lease e fila de thread fechada são órfãos nas conferências prévias do MCP (commit, verify, SHIP, artefato);
  - o armazém de objetos do `.git` aceita hard link no MCP git, e a recusa nos outros metadados diz o caminho e a receita sem perda (decisão: aceitar com segurança, porque o git nunca escreve dentro de arquivo de `objects/`);
  - `ork ship registrar-pr --dry-run` deixa de gravar `ship_done`; o `ork ci prepare` na raiz não reproduz na 0.5.0 (corrigido no #28, com o bundle por thread do #34);
  - o `ork doctor` acusa arquivo ou pasta do `.git` com outro dono, com o `chown` exato e sem rodar nada.
- **Incluído:** causa tipada do estouro (T3), `verify.timeout` (T4), prazo do manifesto (T6), compilação única.
- **P2, compilação única (27/09/2026, thread `ork-i54compilaca`):** `verify.preparo` roda uma vez antes das claims; o produto é conferido do preparo ao fim da rodada; `executado` entrou no contrato e comando que não rodou nunca vira verificado (`verify.sem-veredito`). O `incremental` dos dois tsconfig já estava ligado.
- **P6, lint do comando de claim (27/09/2026, thread `ork-i53lintdocom`):** a suíte inteira do npm é recusada no `ci prepare` para a claim nascida sob a regra; SHA intermediário e contagem de commits só avisam; claim antiga só avisa. A lista das integrações locais passou a ter uma fonte só.
- **Defeitos de condução de 28/09/2026 (thread `ork-defeitosdeco`):** sete defeitos que travavam a própria fábrica, cada um reproduzido com prova, corrigido na origem e com teste que reprova o código anterior: a sessão claude-bg em `blocked` depois do Stop abre a pausa humana; `ork sessions stop|logs|attach` acham a sessão no perfil da conta; `ork_git_status` e `ork_git_commit` aceitam hook e config que o commit nunca executa; o contexto do despacho chega por sessão, sem herança do daemon do `claude --bg`; `ork worktree sync` recria a branch sem commit próprio sobre base reescrita; modelo inacessível na conta vira `runtime.model-unavailable` e o retry troca o destino; o teste N1 claude-bg deixa de depender do observador destacado.
- **Defeitos de condução de 29/09/2026 (thread `ork-rm037defeito`):** sete defeitos, cada um reproduzido com prova e com teste que reprova o código anterior: o despacho codex de bloco com GO grava a baseline antes de soltar a sessão, e a decisão autônoma tem a ferramenta MCP `ork_decision_record`; o modo de sessão (plano no PLAN, review nativo no CHECK) vale só para o bloco que termina na fase de entrada, nos dois runtimes; `ork phase run` respeita `max_parallel_threads` pelas sessões vivas do projeto, com `concurrency.limite` e `--esperar`; `ork decisao registrar` diz o campo e o teto reais; `ork ship registrar-pr --repo --pr` registra PR mesclado em repositório externo declarado em `ci.external_repositories`; `ork ci prepare` grava o bundle na worktree da thread; o teste D-6 deixa de depender de quem vence a corrida com o observador destacado.
- **Entram (24/09/2026):** verify ciente do steal, nome do teste que reprovou no ledger, tempo de boot do CLI, asserções de relógio na suíte paralela, fixtures independentes de umask e a causa real em `registrarObservacao`.
- **Defeitos da noite de 29/09/2026 (thread `ork-rm037noite`):** seis defeitos de condução, cada um com teste que reprova o código anterior: bundle de CI por thread, achado pelo nome da branch; fila e leases de thread fechada soltos no fechamento e podados quando outra thread pede a região; reserva do roadmap solta ou passada adiante no fechamento, com a órfã marcada e solta por `--soltar-orfas`; runtime e modelo de cada thread no retrato da fábrica; `docs sincronizar` só no item da thread; número de FEAT reservado entre máquinas.

## Plano e decisões

- **Ordem acordada em 20/09/2026:** terceiro, depois de #Fast.

## Estado com evidências

- T5 já está na `main` (merge `8f02f44`).
- Fatia de 27/09/2026 na thread `ork-verifytimeou` (blocos P1, P3 e parte do P4):
  - causa tipada do encerramento e o motivo `verify.timeout`, que não reprova a alegação e o retry reexecuta;
  - prazo no manifesto (`verify.timeout_ms` e `verify.timeout_ms_por_comando`), também no MCP, até 300 s por comando;
  - o ledger guarda, por comando que falha, a causa, o prazo, a duração, os testes que caíram e o trecho redigido;
  - o comando de verificação não herda variável `ORK_HITL_*`.
- Falta: compilação única com identidade verificada (P2), lint de comando de claim e registro de instabilidade (P6), e o verify ciente do steal.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-09-28 | Julio |
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
| 2026-09-27 | fatia P1 e P3 implementada | estouro de prazo tipado, prazo no manifesto, evidência da falha no ledger | Julio |
| 2026-09-22 | T5 mesclado por outra thread | merge `8f02f44` | Julio |
| 2026-09-24 | escopo ampliado pela investigação do steal | sar e experimentos A/B | Julio |
| 2026-09-27 | P1 e P3 em produção na VPS de referência | merge `74db81b` (PR #31), `ork` de produção reconstruído; P2 e P6 seguem abertos | Julio |
| 2026-09-27 | P6: lint do comando de claim | a C48 foi para o bundle rodando a suíte inteira e derrubou 33m57s de CI | Julio |
| 2026-09-27 | P2: compilação única e `executado` | fecha o escopo do item: T1 a T14 do PLAN entregues | Julio |
| 2026-09-28 | três testes instáveis do CI consertados (umask das fixtures, lock com `ENOENT`, SHA curto lido como número pelo YAML) | PR #6, merge `0b00683` | Julio |
| 2026-09-28 | corridas de tempo do sensor do controller e do observador sob máquina ocupada; o push da `main` ficou verde de primeira | PR #9, merge `8e6ddda` | Julio |
| 2026-09-28 | defeitos de condução achados em 28/09: conclusão claude-bg em `blocked`, perfis no `sessions stop`, `ork_git` com hooks, contexto vazado, sync sobre base reescrita, modelo inacessível e o teste instável do PR #14 | thread `ork-defeitosdeco`, PR a abrir | Julio |
| 2026-10-01 | fatia 3: sete defeitos de condução de 27/09 a 01/10 (estado do item contra o merge, CHANGELOG no CI, base reescrita com ancestral comum, lease de thread fechada no MCP, hard link em `.git/objects`, `registrar-pr --dry-run` e dono do `.git` no doctor) | thread `ork-rm037fatia3d`, reprodução e decisões no ledger, testes `rm037-fatia3-*`, PR a abrir | Julio |
| 2026-09-30 | defeitos da noite de 29/09: bundle por thread, fila e reservas de thread fechada, runtime na fábrica, sincronizar com escopo e número de FEAT reservado | thread `ork-rm037noite`, fatia aprovada pelo dono (N1 a), PR a abrir | Julio |
