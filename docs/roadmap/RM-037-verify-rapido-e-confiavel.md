---
id: RM-037
tipo: roadmap
titulo: Verify rápido e confiável
categoria: iniciativa
pai: null
features: [FEAT-004, FEAT-014]
owner: Julio
atualizado_em: 2026-10-27T00:52:46-03:00
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
    release: v0.6.0 (as esperas, a saída completa, os defeitos de 19 e 20/10 e os tipos do motor), v0.5.0 (PR
sdlc:
  thread: ork-rm037defeit2
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
- **Thread:** `ork-rm037defeit2` (a mais recente); antes, `ork-rm037esperas`, `ork-rm037fatia6r`, `ork-rm037fatia5p`, `ork-rm037fatia4t`, `ork-rm037fatia3d`, `ork-rm037noite`, `ork-rm037defeito`, `ork-defeitosdeco`, `ork-i54compilaca` e `ork-verifytimeou`

## Problema e resultado

- **Problema:** o verify local reprova por tempo quando a VPS perde 67% a 92% da CPU para o hipervisor (sar, 23 e 24/09/2026): com steal alto, a mesma suíte leva de 7 a 9 vezes o tempo que leva com CPU livre.
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
- **Registro de instabilidade e verify ciente do steal (thread `ork-rm037fatia6r`, fatia 6, 03/10/2026):** a T15 do P6 e o steal, na forma recomendada do item; os testes `core/test/rm037-fatia6-*.test.ts` reprovam o código anterior (não compilam contra `e7c465a`: o módulo e os campos não existiam):
  - `core/instabilidade.json`, contrato `ork.instabilidade/v1` ([contrato](../referencia/contratos/instabilidade-rm037.md)), nasce vazio e só aceita entrada com a taxa medida (falhas em rodadas, o comando que mediu e a data) e revalidação em até 30 dias da medida; vencida não vale, e registro fora do contrato não vale inteiro;
  - o `ork verify` (CLI, MCP e CHECK-REVERIFY) mede o steal do `/proc/stat` na rodada e na janela de cada comando e grava a medida no `verify_run` (`steal` e `stealPct`); a reprovação só de teste com relógio (assinatura de prazo do `node --test` ou entrada vigente do registro) sob steal acima de 40% vira `verify.timeout`, que o retry reexecuta, nunca regressão; asserção comum continua regressão, sem `/proc/stat` nada é atenuado e o `ork ci run` não atenua;
  - o `testeQueCaiu` do ledger passa a ler a seção "failing tests" do reporter `spec`, o padrão do `node --test` 24 fora de TTY, que antes saía vazio;
  - o PLAN da `ork-verifytimeou` não existe mais no repositório, nas branches nem no `.orkastery` (saiu no corte de 27/09): a T15 seguiu o texto da recomendada, decisão no ledger.
- **As esperas que nunca terminam (thread `ork-rm037esperas`, 12/10/2026):** em 12/10, cinco sessões de fase ficaram presas esperando algo que já tinha terminado ou morrido, e a condutora assumiu o fecho de cada uma. Os testes `core/test/rm037-esperas.test.ts` (R1 a R3 e V1 a V7) e o teste novo de `core/test/locale-pulse.test.ts` reprovam o código anterior:
  - verify ou suíte mandados para segundo plano com `&` dentro do comando, cujo processo morreu com a chamada, e laços `until ! pgrep -f "<texto>"` que acham a si mesmos, porque o próprio laço traz o texto procurado (um ficou quase 2 h vivo): a regra das esperas (`REGRA_DAS_ESPERAS` em `core/src/phase.ts`), uma linha só, entra no prompt de toda fase, no lugar da linha da N2 da RM-058, e com o mesmo texto na skill de entrada das duas instalações (`orkastery-bootstrap`), nas skills de GO e CHECK, na skill `ork` do Codex e nos seis agentes de fase do Claude Code. O teste confere o prompt renderizado de todo modo, as fontes, as cópias dos marketplaces e a instalação real do `ork adapter install`;
  - o teste do `ork pulse --json` nas duas línguas caía quando o minuto virava entre as leituras ("libera em 633079h03" contra "h04") e derrubou o Node 22 do CI de um PR sem relação: a comparação tira a falta relativa da fila, e um teste novo força a virada com o relógio do processo filho fixo (`core/test/relogio-fixo.ts`, por `NODE_OPTIONS`), com o controle de que a comparação de antes reprova nela;
  - a sessão parada com `claude stop` antes do `phase_result` contava no `concurrency.max_parallel_threads` até a thread fechar e bloqueava despacho novo: no limite, o portão de vaga do `ork phase run` lê as sessões de todas as contas com `claude agents --json --all` (a sessão parada só aparece nessa lista) e tira da conta a que o runtime mostra encerrada (`stopped`, `done`, `failed`, `completed`, `exited`) ou fantasma. Ausente da lista ou com a leitura falhando, ela segue contando; abaixo do limite, nada é consultado; a espera do `--esperar` lê o runtime uma vez a cada 30 s. A leitura "o runtime mostra a sessão encerrada" mora em `encerradaNaLista` (`core/src/sessoes-contas.ts`), que a capacidade do #Noctum também usa;
  - decisões D1 a D10 no ledger da thread; o que ficou para depois está em "Plano e decisões".
- **Defeitos de condução de 19 e 20/10/2026 (thread `ork-rm037defeit2`):** quatro defeitos vistos na condução #Auto, cada um reproduzido antes do código. Os testes `core/test/rm037-defeitos2010-*.test.ts` reprovam o código anterior, e os mutantes M1 a M17 (`core/test/mutantes/rm037-defeitos2010.json`, pelo `core/scripts/mutante.cjs`) provam isso nas claims. M7 a M10 vieram do primeiro CHECK independente, que devolveu o GO com dois achados de prova e um de fatiação (o PLAN reconciliado com os caminhos reais de cada tarefa); o M11, do segundo, que achou o executor de mutantes escrevendo fora da cópia por link simbólico; M12 a M17, do terceiro, que achou a ociosidade soltando a condução de sessão com despertar agendado e o preparo das dependências dentro da vez de despachar do arco:
  - **baseline com prazo fixo:** o `ork verify --baseline` rodava com o teto padrão de 600 s e ignorava `verify.timeout_ms_por_comando`; a suíte desta máquina passa disso, e o `test` era gravado como "já falhava" (`code: -1`, `causa: timeout`), então uma regressão passaria como dívida anterior. Agora a baseline roda pelo executor do verify (`executorDaRodada`: o prazo do manifesto e a medida do steal), e o comando sem veredito nela (estouro, relógio sob steal, comando que não rodou, e o `-1` antigo sem causa) nunca vale como "já falhava": a falha atual sai como falha sem baseline (`verify.failed`), o `verify_run` diz `baselineSemVeredito`, e a saída do `--baseline` e o handoff dizem `SEM VEREDITO`. O CHECK achou a baseline morta por sinal ainda valendo como "já falhava", com a falha de hoje aceita como pré-existente e `ok: true`; agora só o término normal do próprio comando (`causa: exit`, código de saída de 1 a 123, em `terminoNormal`) tem veredito, e a morte por sinal (o `signal` do processo, o 143 e o 137 do shell), o 124 do `timeout` de dentro do comando, de 125 a 127 e a falta do código de saída também ficam sem veredito (mutante M7). A baseline desta thread levou 1210 s no `test`, dentro dos 2400 s do manifesto;
  - **worktree nova sem dependências:** o `git worktree add` não traz o `core/node_modules`, e a baseline recusava com `baseline.dependencia-ausente` (código 127 no build). Escolha registrada (a recomendada): a chave `worktree.dependencias` do manifesto, que o núcleo roda dentro de toda worktree nova (`ork thread new`, `ork worktree ensure`, `ork_thread_new` do MCP), depois da trava de criação de threads, com o resultado em `worktree_dependencias` no ledger; a falha avisa com o comando exato e não desfaz a thread, e a recusa da baseline diz o comando, ou como declará-lo. O `orkastery.yaml` deste projeto declara `npm --prefix core ci --prefer-offline --no-audit --no-fund`. O terceiro CHECK reproduziu o preparo rodando dentro da vez de despachar do arco do #Noctum (`despacho.lock`, entre a reserva e o lançamento), que o cabeçalho de `core/src/noctum-execucao.ts` proíbe para trabalho pesado; agora o passo do arco abre a thread com o preparo pendente (`worktree_dependencias_pendentes`), e a baseline e o verify o rodam antes do primeiro comando, fora da trava e na fila de recursos pesados, e recusam (`baseline.dependencia-ausente`, `verify.dependencia-ausente`) enquanto ele falhar. O teste do arco prova com `flock -n` que a trava está livre durante o preparo (mutantes M14 a M16);
  - **testes instáveis sob carga:** o `prova-ativacao-roteiro` comparava o registro de projetos de `~/.orkastery`, que outras sessões regravam no meio da prova, ignorando o `ORKASTERY_HOME` da suíte; agora o roteiro mede a pasta do usuário pela regra do núcleo (`pastaDoUsuario`), e o teste dá ao roteiro `HOME` e casa próprios. O `projeto-alvo-cli` chamava o CLI que lia o runtime da conta de quem roda a suíte (`claude agents` e um `claude logs` por sessão parada, de 21 a 35 s), e a chamada passava do prazo de 60 s sob carga; agora o CLI do teste roda com um runtime vazio (`runtimeVazio`, em `core/test/apoio.ts`). O teste `rm037-defeitos2010-hermeticos` força as duas condições, e os mutantes M8 a M10 desfazem o isolamento (o roteiro de volta à casa do usuário real, o teste do roteiro de volta ao `HOME` de quem roda a suíte, o `projeto-alvo-cli` de volta às sessões reais) e a claim cai; uma troca neutra no mesmo arquivo sobrevive. Para isso o `core/scripts/mutante.cjs` aceita `arquivo` (um roteiro de `core/scripts` ou um apoio compilado de `core/dist-test/test`) no lugar de `modulo`, com a pasta do alvo copiada, e não ligada, na cópia. O executor recusa, no `arquivo` e no `modulo`, alvo ou componente que seja link simbólico, alvo que não seja arquivo regular e `realpath` fora da cópia ou das pastas permitidas, antes de ler no checkout e antes de escrever na cópia, sem escrever no alvo recusado (o segundo CHECK achou a escrita fora da cópia pelo link simbólico no `arquivo`, mutante M11; o terceiro, no `modulo`, mutante M17);
  - **sessão que terminou segura a condução:** a causa é do runtime. O Claude Code mantém `working` a sessão claude-bg cuja resposta final ele lê como "ainda há passo" e só a encerra (`done`) depois de 60 min ociosa no prompt (`bg retire <id>: idle-prompt, idle 60m` no log do daemon da conta); o observador esperava o `done`, sem `phase_result`, e o despacho do CHECK era recusado com `conducao.em-andamento`. Agora `working` com `status: idle`, processo vivo e Stop correlacionado sem atividade depois, por 5 min (`OCIOSA_DEPOIS_DO_STOP_MS`), vira fim do turno pela prova do `ork`, e o `phase_result` solta a condução. O terceiro CHECK mediu no Claude Code 2.1.304 que o `status` sozinho não basta: o Bash em segundo plano aparece `shell`, e o despertar agendado (`CronCreate`, `ScheduleWakeup`, `/loop`) e a tarefa MCP deixam a sessão `idle` até ela voltar a escrever. O hook do Stop passou a mandar ao `ork` as contagens de `background_tasks` e `session_crons` da entrada do Claude Code, gravadas no `runtime_stop` (`backgroundTasks`, `sessionCrons`), e a ociosidade só encerra o turno depois do Stop com as duas em zero; o Stop sem elas (hook ou runtime de antes) segue esperando o `done` do runtime (mutantes M12 e M13). A batida da condução usa a mesma classificação quando o observador não está vivo;
  - decisões no ledger da thread; o que ficou para depois está em "Plano e decisões".
- **Incluído:** causa tipada do estouro (T3), `verify.timeout` (T4), prazo do manifesto (T6), compilação única.
- **P2, compilação única (27/09/2026, thread `ork-i54compilaca`):** `verify.preparo` roda uma vez antes das claims; o produto é conferido do preparo ao fim da rodada; `executado` entrou no contrato e comando que não rodou nunca vira verificado (`verify.sem-veredito`). O `incremental` dos dois tsconfig já estava ligado.
- **P6, lint do comando de claim (27/09/2026, thread `ork-i53lintdocom`):** a suíte inteira do npm é recusada no `ci prepare` para a claim nascida sob a regra; SHA intermediário e contagem de commits só avisam; claim antiga só avisa. A lista das integrações locais passou a ter uma fonte só.
- **Claims executáveis no CI e CHANGELOG que vale (thread `ork-claimsechang`, 29/10/2026):** o resultado é claims executáveis no CI sem correção manual. Depois de repetições em cinco threads medidas pelo builder, o lint passa a recusar antes da persistência a claim nova com `rg`, `ork` direto, caminho em `.orkastery/` ou `\x22`/`\x27` literal; as correções indicam `grep`, `node core/dist/index.js`, checkout versionado e aspas reais. O `ci prepare` aplica as mesmas recusas e apenas avisa a claim anterior ao campo `lint`. A regra compartilhada do CHANGELOG reprova linha nova em seção cuja tag `v<versão>` existe e exige que a entrada de `## Não publicado` esteja sob `### Adicionado`, `### Alterado`, `### Corrigido` ou `### Segurança`; o script do CI, `ork docs verificar --pr` e `ork verify` usam o mesmo motivo tipado. Evidência focada: `core/test/claim-lint.test.ts` e `core/test/rm037-fatia3-changelog-no-ci.test.ts`.
- **Defeitos de condução de 28/09/2026 (thread `ork-defeitosdeco`, PR #18, merge `a61e1e4`, na versão 0.4.3):** sete defeitos que travavam a própria fábrica, cada um reproduzido com prova, corrigido na origem e com teste que reprova o código anterior: a sessão claude-bg em `blocked` depois do Stop abre a pausa humana; `ork sessions stop|logs|attach` acham a sessão no perfil da conta; `ork_git_status` e `ork_git_commit` aceitam hook e config que o commit nunca executa; o contexto do despacho chega por sessão, sem herança do daemon do `claude --bg`; `ork worktree sync` recria a branch sem commit próprio sobre base reescrita; modelo inacessível na conta vira `runtime.model-unavailable` e o retry troca o destino; o teste N1 claude-bg deixa de depender do observador destacado.
- **Defeitos de condução de 29/09/2026 (thread `ork-rm037defeito`, PR #28, merge `baf065e`, na versão 0.5.0):** sete defeitos, cada um reproduzido com prova e com teste que reprova o código anterior: o despacho codex de bloco com GO grava a baseline antes de soltar a sessão, e a decisão autônoma tem a ferramenta MCP `ork_decision_record`; o modo de sessão (plano no PLAN, review nativo no CHECK) vale só para o bloco que termina na fase de entrada, nos dois runtimes; `ork phase run` respeita `max_parallel_threads` pelas sessões vivas do projeto, com `concurrency.limite` e `--esperar`; `ork decisao registrar` diz o campo e o teto reais; `ork ship registrar-pr --repo --pr` registra PR mesclado em repositório externo declarado em `ci.external_repositories`; `ork ci prepare` grava o bundle na worktree da thread; o teste D-6 deixa de depender de quem vence a corrida com o observador destacado.
- **Entram (24/09/2026):** verify ciente do steal, nome do teste que reprovou no ledger, tempo de boot do CLI, asserções de relógio na suíte paralela, fixtures independentes de umask e a causa real em `registrarObservacao`.
- **Defeitos da noite de 29/09/2026 (thread `ork-rm037noite`, PR #34, merge `36def09`, na versão 0.5.0):** seis defeitos de condução, cada um com teste que reprova o código anterior: bundle de CI por thread, achado pelo nome da branch; fila e leases de thread fechada soltos no fechamento e podados quando outra thread pede a região; reserva do roadmap solta ou passada adiante no fechamento, com a órfã marcada e solta por `--soltar-orfas`; runtime e modelo de cada thread no retrato da fábrica; `docs sincronizar` só no item da thread; número de FEAT reservado entre máquinas.

## Plano e decisões

- **Ordem acordada em 20/09/2026:** terceiro, depois de #Fast.
- **Fica para depois da fatia das esperas (thread `ork-rm037esperas`, D6):** o mínimo que resolveu foi o portão de vaga ouvir o runtime; o resto, descrito aqui:
  - marcar no `ork sessions hitl` ou no pulse a sessão cuja última ferramenta é uma espera sem processo vivo correspondente: exige ler o último `tool_use` da transcrição do Claude Code, que nenhum código lê hoje, e reconhecer a espera (`sleep`, `until`, `while`, `pgrep`, `tail --pid`) e o processo que ela espera;
  - recusar no `ork guard` o verify com `&` e o `pgrep -f` cujo padrão casa com o próprio comando: o guard lê o texto inteiro do comando e recusaria o heredoc ou a documentação que só cita a regra;
  - o observador da sessão desiste sem `phase_result` depois de 600 s em `done` sem Stop, estado desconhecido ou consulta falhando, e não volta (`core/src/session-watcher-claude.ts`): o portão de vaga agora solta essa sessão quando o runtime a mostra encerrada, mas o ledger segue sem o resultado;
  - a prova de fim da sessão da própria thread (`provaDeFimDaSessao`, `core/src/conducao.ts`) consulta só a conta do processo: a sessão despachada por perfil nunca é provada encerrada ali;
  - o bloco do `AGENTS.md` que o `ork init` escreve e o bloco da experiência do `CLAUDE.md` não levam a regra: o primeiro pede o snapshot de locale, e o segundo é reconhecido sem recibo pelo texto exato;
  - o portão decide o fantasma numa leitura só: um instante sem `pid` (troca de processo, atualização automática) soltaria a vaga uma vez, enquanto o observador da sessão pede uma segunda observação; nesta máquina, em 12/10, toda `blocked` sem `pid` era registro morto havia horas;
  - o parser do `claude agents --json --all` é estrito: um registro malformado entre os cerca de 150 invalida a leitura da conta inteira (a sessão segue contando, sem aviso de que o runtime não foi lido), e a vaga solta pela prova do runtime não deixa rastro no ledger;
  - a regra cita o `pgrep -f` cujo padrão aparece no próprio comando; o texto que outro processo carrega também prende a espera (o prompt de outra sessão traz `ork verify`), e a saída que a regra dá, o arquivo de saída com prazo ou o PID guardado, cobre os dois casos.

- **Fica para depois do lote de 19 e 20/10/2026 (thread `ork-rm037defeit2`):**
  - comparar a baseline teste a teste (`testeQueCaiu`) em vez de comando a comando: com um teste instável que reprova de verdade na baseline, a falha de outro teste do mesmo comando ainda passa como dívida anterior;
  - varrer os outros testes que chamam o CLI real sem runtime falso, ou que leem a pasta do usuário de quem roda a suíte;
  - ler o `status` nativo também no radar do pulse e no portão de vaga do `ork phase run`, que contam a sessão ociosa no prompt como trabalhando até o `done` do runtime;
  - o prompt da fase não traz o comando de `worktree.dependencias` (o template é contrato versionado); a recusa da baseline o traz;
  - o `timeout` do uutils (medido na 0.8.0) devolve o SIGTERM, o SIGINT e o SIGHUP do processo que ele vigia como saída 15, 2 e 1, iguais a uma saída do próprio comando, e a baseline os toma como término normal; o GNU `timeout`, o 143 e o 137 do shell e o SIGKILL chegam como sinal. Separar os dois pede rodar cada comando sob um shell que devolva 128 + sinal, no executor de todo comando do verify e das claims;
  - do lado do verify de hoje, só o estouro e o relógio sob steal ficam sem veredito: o comando de hoje morto por sinal, contra uma baseline que já falhava, ainda sai pré-existente;
  - o `ork_thread_new` do MCP roda o preparo de `worktree.dependencias` dentro da chamada (até 10 min): o cliente pode desistir com a thread já criada. O passo do arco já adia o preparo para a baseline; levar o MCP ao mesmo adiamento pede que a sessão que o chama grave a baseline antes do primeiro build;
  - o comando de `worktree.dependencias` vai ao ledger (`worktree_dependencias`, `worktree_dependencias_pendentes`) e à recusa `baseline.dependencia-ausente` sem a redação de credencial de URL (`redigirCredenciaisUrl`) que o comando do verify recebe; só a recusa do preparo adiado já sai redigida;
  - o `ork fix open` diz "NAO ha baseline" também para a falha cuja baseline existe e ficou sem veredito.

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
- Fatia 6 (thread `ork-rm037fatia6r`, 03/10/2026): o registro de instabilidade do P6 e o verify ciente do steal, na forma recomendada abaixo, com decisões no ledger e testes `rm037-fatia6-*`; PR a abrir. O contrato é classe 2: a ratificação do dono foi relatada à thread pelo condutor da sessão em 03/10/2026 e não chegou por ingresso autenticado, então o merge fica com o dono.
- Antes da fatia 6, faltavam o registro de instabilidade do P6 e o verify ciente do steal; nenhum código de steal existia em `core/src`. Ficaram fora da fatia 4 por decisão registrada em 02/10/2026: o registro é contrato público versionado (classe 2) e pede a ratificação do dono. Recomendada: thread própria com a T15 do PLAN da `ork-verifytimeou` (`core/instabilidade.json` no schema `ork.instabilidade/v1`, que nasce vazio e só aceita entrada com taxa medida e revalidação em até 30 dias) e um verify que mede o steal de `/proc/stat` durante a rodada, grava a medida no `verify_run` e trata a reprovação de teste com relógio sob steal acima de 40% como `verify.timeout` (reexecuta), nunca como regressão.
- Fatia 5 (thread `ork-rm037fatia5p`, 02/10/2026): A1, A3 e A5 da rodada 5 do CHECK da fatia 4 e o rodízio no limite de gasto entraram com decisões no ledger e testes `rm037-fatia5-*`; PR a abrir.
- Fatia das esperas (thread `ork-rm037esperas`, 12/10/2026): a regra das esperas no prompt, na skill e nos guias, o teste do pulse sem o relógio e o portão de vaga que ouve o runtime, com decisões D1 a D10 no ledger e testes `rm037-esperas`; PR a abrir pela condutora.
- Lote de 19 e 20/10/2026 (thread `ork-rm037defeit2`): os quatro defeitos de condução com testes `rm037-defeitos2010-*` e os mutantes M1 a M17, com os achados de três CHECKs independentes, decisões no ledger; PR a abrir pela condutora.
- Em produção na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026): a fatia das esperas (PR #158), a saída completa no `ork verify` (PR #170), os testes instáveis de 13/10, o snapshot pt-BR com sha só de letras (PRs #179 e #182), os defeitos de condução de 19 e 20/10 (PR #185) e os tipos que o Claude Code grava nos mods (PR #195).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-10-27 | Julio |
| Documentação | Em revisão | — | 2026-10-27 | Julio |
| Código | Mesclado | commit `36def09` · PR #34 · anteriores: baf065e (PR #28), a61e1e4 (PR #18), 10ca416 (Orkastery 0.3.0) | 2026-10-27 | Julio |
| Testes | Aprovados | ci: verde no push dos merges (runs 36560460823, 36663174203 e 36725816649) e no da v0.5.0 (run 36815186450) | 2026-10-27 | Julio |
| Deploy | Produção | release: v0.6.0 (as esperas, a saída completa, os defeitos de 19 e 20/10 e os tipos do motor), v0.5.0 (PR | 2026-10-27 | Julio |
| Exposição | Parcial | — | 2026-10-27 | Julio |
| Habilitação | Em andamento | — | 2026-10-27 | Julio |

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
| 2026-10-03 | fatia 6: registro de instabilidade `ork.instabilidade/v1` e verify que mede o steal de `/proc/stat` e não chama de regressão o teste com relógio sob steal acima de 40% | thread `ork-rm037fatia6r`, decisões no ledger, testes `rm037-fatia6-*`, PR a abrir | Julio |
| 2026-10-02 | fatia 5: `mergeSha` do merge que incorporou a branch (A1), CHECK sem veredito no condutor no #Auto (A3), forja sem leitura de PR dita uma vez e GitHub Enterprise (A5), e a cota vista ao vivo com o perfil fora do rodízio até a hora da mensagem | thread `ork-rm037fatia5p`, decisões no ledger, testes `rm037-fatia5-*`, PR a abrir | Julio |
| 2026-10-12 | fatia das esperas: regra das esperas no prompt, na skill e nos guias; o teste do pulse sem o relógio; o portão de vaga do `ork phase run` ouve o runtime | thread `ork-rm037esperas`, decisões D1 a D10 no ledger, testes `rm037-esperas` e o novo de `locale-pulse`, PR a abrir | Julio |
| 2026-10-20 | defeitos de condução de 19 e 20/10: prazo da baseline, dependências da worktree nova, dois testes herméticos e a sessão ociosa depois do Stop | thread `ork-rm037defeit2`, decisões no ledger, testes `rm037-defeitos2010-*` e mutantes M1 a M17, PR a abrir | Julio |
| 2026-10-03 | teste instável do lease da sucessora (B-1 de `rm037-baseline-no-despacho`, run 37096532937 no Node 22): corrida com o watcher destacado, reproduzida com atraso injetado e consertada lendo a identidade no lease depois do fim da sessão; 50 rodadas seguidas sob carga na claim | thread `ork-rm037testede`, decisões e claims no ledger | Julio |
| 2026-10-27 | Esperas, saída completa, testes instáveis, snapshot com sha só de letras, defeitos de 19 e 20/10 e tipos do motor em produção na 0.6.0; o ciclo segue Piloto | Tag `v0.6.0`, com os merges `08cbd5ff` (#158), `927f9daf` (#170), `6abb3ba3`, `f0396f69` (#179), `69f40775` (#182), `aa3681fe` (#185) e `cca7f904` (#195) na tag; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
