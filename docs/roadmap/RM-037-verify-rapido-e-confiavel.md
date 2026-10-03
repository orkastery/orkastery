---
id: RM-037
tipo: roadmap
titulo: Verify rápido e confiável
categoria: iniciativa
pai: null
features: [FEAT-004, FEAT-014]
owner: Julio
atualizado_em: 2026-10-01T02:30:00-03:00
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
    commit: 36def09
    pr: 34
    anteriores: "baf065e (PR #28), a61e1e4 (PR #18), 10ca416 (Orkastery 0.3.0)"
  testes:
    ci: verde no push dos merges (runs 36560460823, 36663174203 e 36725816649) e no da v0.5.0 (run 36815186450)
  deploy:
    release: "v0.5.0 (PR #28 e #34) e v0.4.3 (PR #18), @orkastery/cli no npm"
sdlc:
  thread: ork-rm037noite
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

- **Features:** [FEAT-004](../produto/FEAT-004-claims-e-verify.md), [FEAT-014](../produto/FEAT-014-monitor-board-e-pulse.md)
- **Thread:** `ork-rm037fatia5p` (a mais recente); antes, `ork-rm037fatia4t`, `ork-rm037fatia3d`, `ork-rm037noite`, `ork-rm037defeito`, `ork-defeitosdeco`, `ork-i54compilaca` e `ork-verifytimeou`

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
- **Trabalho parado no condutor e status honesto (thread `ork-rm037fatia4t`, fatia 4, 02/10/2026):** em 01/10 o condutor parou duas vezes e o pulse só dizia "Esperando você". Os testes `core/test/rm037-fatia4-*.test.ts` reprovam o código anterior:
  - a varredura do pulse acha, além de 30 min, o trabalho parado depois da entrega e põe cada thread numa linha, `<thread> parado no condutor desde HH:MM: <próximo passo>`, fora de "Esperando você" e sem pergunta ao dono. Os casos: fase terminada com a branch sem push, branch publicada sem PR (inclusive a entrega nova depois de um `ship_done`), PR com os checks verdes sem merge, PR com check vermelho sem fase despachada depois e sessão `blocked` sem pergunta de verdade, mais o merge na base sem registro e a fase seguinte antes da entrega (fora do #Auto, fase a fase, sem pular a pausa do dono), que a revisão do CHECK pediu: o que sai do dono volta sempre como linha;
  - o `human.pending` que o observador grava quando a sessão encerra o turno em `blocked`, ou quando o SHIP termina em `done` sem o `ship_done` (PR esperando o merge, entrega por registrar), num bloco sem pausa ao fim e sem pergunta estruturada aberta, é do condutor; pausa prevista do modo, escalação tipada, pedido aberto (inclusive vencido que espera), prompt de permissão, sessão retomada, sessão nativa do Codex, CHECK em `done` sem o veredito e SHIP em `failed` ou `stopped` continuam do dono; fora do #Auto e do #Maestro, publicar a branch, abrir o PR e mergear levam a autorização de push do dono; depois do Stop sem atividade, a tela é a mensagem final, e a lista numerada nela não é menu, nem no carimbo do radar;
  - os PRs vêm do `gh pr list` do pulse, só com branch que já foi ao remoto: os abertos e os recentes em duas chamadas, e a branch candidata a "sem PR" conferida sozinha; a leitura boa vira o retrato `ork.prs-abertos/v1` em `.orkastery/monitor/`, e falha, lista cortada e retrato velho são "PR não lido", nunca "sem PR";
  - o `ork roadmap status` diz em "O que eu faço em seguida" o estado real da entrega (parado no condutor, PR com check vermelho, PR verde esperando o merge, branch sem push), lido do git local e do retrato de PRs, sem rede; e avisa numa linha a máquina da fábrica sem batida além de 3 h, pela cópia local de `ork/fabrica-estado` ("não lido" sem cópia);
  - o retrato da máquina não marca "espera você" no que é do condutor, e as outras máquinas deixam de mostrá-lo como pergunta.
- **Pendências da fatia 4 e rodízio no limite de gasto (thread `ork-rm037fatia5p`, fatia 5, 02/10/2026):** os testes `core/test/rm037-fatia5-*.test.ts` reprovam o código anterior:
  - A1: com a branch já incorporada, o `ork ship` grava no `mergeSha` o commit de primeiro pai da base que a trouxe (o merge, ou a própria branch no fast-forward) e a ponta da base em `pontaDaBase`; a prova do push e o recibo do Maestro conferem a ponta, o `ork ship registrar-pr` também a grava, e o leitor do trabalho parado aceita o `ship_done` já gravado com a ponta, que contém o merge `ship(<thread>)`;
  - A3: no #Auto, o CHECK que termina em `done` sem o veredito sai do dono e vira a linha `<thread> parado no condutor desde HH:MM: redespachar o CHECK (ork phase run <thread> CHECK --prompt "<pedido da fase>")`, antes de qualquer caso de entrega; fora do #Auto, segue com o dono;
  - A5: a forja sem leitura de PR (GitLab, caminho local, host em que o `gh` não tem login) é dita uma vez por remoto e host (`prs.sem-leitura`), e as linhas e o status deixam de dizer "PR não lido" dela; o GitHub Enterprise, o host próprio em que `gh auth status --hostname` passa, é lido pelo host do remoto, e o retrato `ork.prs-abertos/v1` guarda o host;
  - rodízio no limite de gasto: na madrugada de 02/10, as sessões de uma conta pararam às 03:00 com `You've hit your individual spend limit · ... · your session limit resets 4:40am (America/Sao_Paulo)`, a cota só foi classificada às 04:15, quando o processo morreu, e o redespacho das 03:14 caiu na mesma conta. Agora o observador da sessão viva relê a transcrição quando ela cresce e, com o erro de esgotamento depois do despacho (as frases que o rodízio já conhece, D16), marca o perfil esgotado até a hora da mensagem, no fuso dela, ou por 1 h contada da mensagem, e grava `runtime_quota_detected` uma vez; o despacho seguinte pula o perfil (`rotate_same_runtime_on_quota`) e o `ork accounts list` mostra o prazo em `ESGOTADO ATE`. A hora de volta dita com o fuso entre parênteses passa a ser lida nesse fuso, e não no relógio da máquina.
- **Incluído:** causa tipada do estouro (T3), `verify.timeout` (T4), prazo do manifesto (T6), compilação única.
- **P2, compilação única (27/09/2026, thread `ork-i54compilaca`):** `verify.preparo` roda uma vez antes das claims; o produto é conferido do preparo ao fim da rodada; `executado` entrou no contrato e comando que não rodou nunca vira verificado (`verify.sem-veredito`). O `incremental` dos dois tsconfig já estava ligado.
- **P6, lint do comando de claim (27/09/2026, thread `ork-i53lintdocom`):** a suíte inteira do npm é recusada no `ci prepare` para a claim nascida sob a regra; SHA intermediário e contagem de commits só avisam; claim antiga só avisa. A lista das integrações locais passou a ter uma fonte só.
- **Defeitos de condução de 28/09/2026 (thread `ork-defeitosdeco`, PR #18, merge `a61e1e4`, na versão 0.4.3):** sete defeitos que travavam a própria fábrica, cada um reproduzido com prova, corrigido na origem e com teste que reprova o código anterior: a sessão claude-bg em `blocked` depois do Stop abre a pausa humana; `ork sessions stop|logs|attach` acham a sessão no perfil da conta; `ork_git_status` e `ork_git_commit` aceitam hook e config que o commit nunca executa; o contexto do despacho chega por sessão, sem herança do daemon do `claude --bg`; `ork worktree sync` recria a branch sem commit próprio sobre base reescrita; modelo inacessível na conta vira `runtime.model-unavailable` e o retry troca o destino; o teste N1 claude-bg deixa de depender do observador destacado.
- **Defeitos de condução de 29/09/2026 (thread `ork-rm037defeito`, PR #28, merge `baf065e`, na versão 0.5.0):** sete defeitos, cada um reproduzido com prova e com teste que reprova o código anterior: o despacho codex de bloco com GO grava a baseline antes de soltar a sessão, e a decisão autônoma tem a ferramenta MCP `ork_decision_record`; o modo de sessão (plano no PLAN, review nativo no CHECK) vale só para o bloco que termina na fase de entrada, nos dois runtimes; `ork phase run` respeita `max_parallel_threads` pelas sessões vivas do projeto, com `concurrency.limite` e `--esperar`; `ork decisao registrar` diz o campo e o teto reais; `ork ship registrar-pr --repo --pr` registra PR mesclado em repositório externo declarado em `ci.external_repositories`; `ork ci prepare` grava o bundle na worktree da thread; o teste D-6 deixa de depender de quem vence a corrida com o observador destacado.
- **Entram (24/09/2026):** verify ciente do steal, nome do teste que reprovou no ledger, tempo de boot do CLI, asserções de relógio na suíte paralela, fixtures independentes de umask e a causa real em `registrarObservacao`.
- **Defeitos da noite de 29/09/2026 (thread `ork-rm037noite`, PR #34, merge `36def09`, na versão 0.5.0):** seis defeitos de condução, cada um com teste que reprova o código anterior: bundle de CI por thread, achado pelo nome da branch; fila e leases de thread fechada soltos no fechamento e podados quando outra thread pede a região; reserva do roadmap solta ou passada adiante no fechamento, com a órfã marcada e solta por `--soltar-orfas`; runtime e modelo de cada thread no retrato da fábrica; `docs sincronizar` só no item da thread; número de FEAT reservado entre máquinas.

## Plano e decisões

- **Ordem acordada em 20/09/2026:** terceiro, depois de #Fast.

## Estado com evidências

- T5 já está na `main` (merge `8f02f44`).
- Fatia de 27/09/2026 na thread `ork-verifytimeou` (blocos P1, P3 e parte do P4):
  - causa tipada do encerramento e o motivo `verify.timeout`, que não reprova a alegação e o retry reexecuta;
  - prazo no manifesto (`verify.timeout_ms` e `verify.timeout_ms_por_comando`), também no MCP, até 300 s por comando;
  - o ledger guarda, por comando que falha, a causa, o prazo, a duração, os testes que caíram e o trecho redigido;
  - o comando de verificação não herda variável `ORK_HITL_*`.
- P2 (compilação única e `verify.sem-veredito`) e o lint de comando de claim do P6 (`core/src/claim-lint.ts`) estão na `main` desde `10ca416` (Orkastery 0.3.0).
- Defeitos de condução: os de 28/09 na `main` pelo PR #18 (merge `a61e1e4`) e na versão 0.4.3; os de 29/09 pelo PR #28 (merge `baf065e`) e os da noite de 29/09 pelo PR #34 (merge `36def09`), os dois na versão 0.5.0. CI verde no push de cada merge (runs 36560460823, 36663174203 e 36725816649).
- Em produção na versão 0.5.0: tag `v0.5.0` (merge `2418a4e`, PR #36), `@orkastery/cli` 0.5.0 no npm, CI verde no push da versão (run 36815186450).
- Falta: o registro de instabilidade do P6 e o verify ciente do steal; nenhum código de steal existe em `core/src`. Ficaram fora da fatia 4 por decisão registrada em 02/10/2026: o registro é contrato público versionado (classe 2) e pede a ratificação do dono. Recomendada: thread própria com a T15 do PLAN da `ork-verifytimeou` (`core/instabilidade.json` no schema `ork.instabilidade/v1`, que nasce vazio e só aceita entrada com taxa medida e revalidação em até 30 dias) e um verify que mede o steal de `/proc/stat` durante a rodada, grava a medida no `verify_run` e trata a reprovação de teste com relógio sob steal acima de 40% como `verify.timeout` (reexecuta), nunca como regressão.
- Fatia 5 (thread `ork-rm037fatia5p`, 02/10/2026): A1, A3 e A5 da rodada 5 do CHECK da fatia 4 e o rodízio no limite de gasto entraram com decisões no ledger e testes `rm037-fatia5-*`; PR a abrir.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-10-01 | Julio |
| Documentação | Em revisão | — | 2026-10-01 | Julio |
| Código | Mesclado | commit `36def09` · PR #34 · anteriores: baf065e (PR #28), a61e1e4 (PR #18), 10ca416 (Orkastery 0.3.0) | 2026-10-01 | Julio |
| Testes | Aprovados | ci: verde no push dos merges (runs 36560460823, 36663174203 e 36725816649) e no da v0.5.0 (run 36815186450) | 2026-10-01 | Julio |
| Deploy | Produção | release: v0.5.0 (PR #28 e #34) e v0.4.3 (PR #18), @orkastery/cli no npm | 2026-10-01 | Julio |
| Exposição | Parcial | — | 2026-10-01 | Julio |
| Habilitação | Em andamento | — | 2026-10-01 | Julio |

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
| 2026-09-29 | defeitos de 28/09 mesclados na `main` e publicados na versão 0.4.3 | PR #18, merge `a61e1e4`; tag `v0.4.3` | Julio |
| 2026-09-30 | defeitos de 29/09 mesclados na `main` | PR #28, merge `baf065e` | Julio |
| 2026-09-30 | defeitos da noite de 29/09 mesclados na `main` | PR #34, merge `36def09` | Julio |
| 2026-10-01 | defeitos de 29/09 e da noite de 29/09 em produção na versão 0.5.0 | tag `v0.5.0` (PR #36), `@orkastery/cli` 0.5.0 no npm | Julio |
| 2026-10-02 | fatia 4: trabalho parado no condutor no pulse e status do roadmap com o estado real da entrega e a batida da fábrica; registro de instabilidade e steal ficam pendentes com a recomendada | thread `ork-rm037fatia4t`, decisões no ledger, testes `rm037-fatia4-*`, PR a abrir | Julio |
| 2026-10-02 | fatia 5: `mergeSha` do merge que incorporou a branch (A1), CHECK sem veredito no condutor no #Auto (A3), forja sem leitura de PR dita uma vez e GitHub Enterprise (A5), e a cota vista ao vivo com o perfil fora do rodízio até a hora da mensagem | thread `ork-rm037fatia5p`, decisões no ledger, testes `rm037-fatia5-*`, PR a abrir | Julio |
| 2026-10-03 | teste instável do lease da sucessora (B-1 de `rm037-baseline-no-despacho`, run 37096532937 no Node 22): corrida com o watcher destacado, reproduzida com atraso injetado e consertada lendo a identidade no lease depois do fim da sessão; 50 rodadas seguidas sob carga na claim | thread `ork-rm037testede`, decisões e claims no ledger | Julio |
