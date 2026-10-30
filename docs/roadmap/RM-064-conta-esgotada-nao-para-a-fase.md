---
id: RM-064
tipo: roadmap
titulo: Conta esgotada não para a fase
categoria: iniciativa
pai: null
features: [FEAT-020]
owner: Julio
atualizado_em: 2026-10-27T00:50:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: fe590b66
    pr: 178
  deploy:
    release: v0.6.0 (fatias 1, 2 e 3), @orkastery/cli no npm
sdlc:
  thread: null
  modo: null
---

# RM-064 — Conta esgotada não para a fase

> **Em uma frase:** quando a cota de uma conta acaba no meio das fases, o ork move sozinho todas as threads dela para outra conta ou outro runtime capaz e retoma do ponto onde pararam, sem esperar o dono.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-020](../produto/FEAT-020-mcp-e-adaptadores.md)

**Pedido do dono de 13/10/2026:** "garanta que exista um item no roadmap tratando esse tipo de interrupção que ocorreu, pra que não ocorra mais quando houver outros runtimes capazes de assumir, nesse caso havia outra conta claude code logada".

## Problema e resultado

- **Público e problema/oportunidade:** o dono que tem mais de uma conta por runtime, ou mais de um runtime (`ork accounts`). Hoje, quando a cota semanal de uma conta acaba, todas as sessões dela param juntas e ficam paradas até alguém notar, mesmo com outra conta logada e ativa e com o fallback do bloco configurado.
- **Evidências e fonte:** o incidente de 13/10/2026 (tabela abaixo).
- **Objetivo/OKR:** fase parada por cota esgotada só quando nenhum destino capaz existe; com destino capaz, a fábrica segue sem o dono.
- **Hipótese:** se o esgotamento for tratado como evento da conta (e não de cada sessão), se o redespacho sair sozinho dentro da autorização durável e se a sessão nova receber o ponto de parada e o trabalho da anterior, então a troca de conta leva minutos, porque nenhum passo depende de alguém ler a tela da sessão morta.
- **Métrica principal / linha de base / meta / janela / fonte:** minutos entre o esgotamento da conta e a primeira sessão viva da thread em outro destino. Linha de base: cerca de 780 min (13/10/2026, de 02h06 a 15h00, retomada à mão). Meta: até 10 min sem intervenção do dono quando há destino capaz. Janela: 14 dias. Fonte: ledger (`runtime.quota-exhausted` e o despacho seguinte da thread).
- **Métricas de proteção:** nenhum despacho em conta que o dono tirou do rodízio ou que está marcada esgotada; nenhuma segunda sessão na mesma worktree; o prompt original e o sha256 continuam gravados (RM-063 F3); nenhum merge, tag ou publicação fora da autorização do dono.

### O incidente de 13/10/2026

A conta A (assinatura Claude) esgotou a cota semanal entre 02h03 e 02h12, com volta prevista para 18/10. Nela rodavam as quatro sessões de fase da VPS (fatias N3 a N6 da [RM-058](RM-058-modo-noctum.md)), a sessão de condução e a condução da maquina-b. Havia uma conta B (assinatura Claude) logada e ativa, duas contas Codex ativas e o fallback do bloco #Auto configurado para o Codex. Nada assumiu: a fábrica ficou parada até o dono perceber, e a retomada foi feita à mão às 15h00.

| # | O que parou | Por que nada assumiu | Camada |
| --- | --- | --- | --- |
| I1 | Duas sessões ficaram vivas, com o job ativo e a última fala "limite semanal atingido" | O sensor classificou as duas como "sessão parada com job vivo, a última tela não mostra o menu", e não como `runtime.quota-exhausted`; sem reprovação tipada, o `ork retry plan` respondeu "sem-retry" | núcleo |
| I2 | Duas sessões viraram `runtime.quota-exhausted` com a política "reexecutar, automática" | O retry só roda quando alguém chama `ork retry run`; a varredura (RM-063 F5) e o condutor do host não chamam | núcleo, hosts |
| I3 | As quatro threads da conta A, nos dois projetos e nas duas máquinas | A cota é da conta, mas o ork trata sessão por sessão: não marca o perfil até o horário de volta nem move as threads dele de uma vez | núcleo |
| I4 | O retry de cota "reexecuta o mesmo prompt" | Num bloco #Auto no meio do GO ou do CHECK, isso recomeça do GOAL; a retomada precisou de um pedido com o ponto de parada escrito à mão | núcleo |
| I5 | Rascunho do `check.md`, parecer do revisor e listas de mutantes | Ficavam no diretório do job da conta esgotada, fora da thread, e a sessão de outra conta não os vê; foram copiados à mão | núcleo, prompts |
| I6 | A sessão de condução, na mesma conta das fases | O condutor LLM dividia a conta com as fases e caiu junto; o condutor determinístico do host seguiu rodando, mas não troca de conta | núcleo (RM-063 F7), hosts |
| I7 | A maquina-b, que só tinha a conta A logada | Nenhuma outra máquina da rede assumiu as threads dela, e a rede não mostrou a parada como trabalho disponível | rede (RM-047, RM-053) |
| I8 | O estado das contas | O store mostrava uma conta "esgotada até" uma data já vencida, e o dono não sabia qual conta ainda tinha cota | núcleo (RM-040), mods |

## Escopo e validação

- **Incluído:** as frentes T1 a T10 abaixo.
- **Fora de escopo:** a escada de recuperação de `runtime.unavailable` no despacho (reerguer o daemon, fallback, outro perfil), que é a [RM-063](RM-063-fabrica-que-nao-para.md) F4: esta página reaproveita a escada e cobre a cota que acaba **no meio** da fase. A escolha de conta por thread e o rodízio por carga são da [RM-056](RM-056-perfil-por-thread-e-carga.md). Comprar cota ou criar conta nova continua com o dono.

| Frente | O que muda | Prova |
| --- | --- | --- |
| T1 Esgotamento é evento da conta | O sensor reconhece o fim de cota dentro da sessão viva (a fala do runtime, o código de erro, os hooks `StopFailure` e de notificação) e grava `runtime.quota-exhausted` com o horário de volta. O perfil fica esgotado até lá, e o ork lista todas as sessões vivas do perfil, em todos os projetos da máquina ([RM-040](RM-040-estado-de-conta-compartilhado.md)) | teste com runtime falso que para no meio da fase com a fala de limite: as sessões do perfil viram `runtime.quota-exhausted`, nenhuma fica "parada com job vivo" |
| T2 Troca sozinha, dentro da autorização | Para cada thread afetada, o ork encerra a sessão morta e redespacha no próximo destino capaz: outra conta do mesmo runtime, logada e ativa; depois o fallback do bloco; sem destino, fila até o horário de volta. Em #Auto e #Noctum, com a autorização durável da RM-063 F7, sem perguntar; fora dela, um pedido ao dono com a alternativa recomendada já pronta (RM-057) | teste com dois perfis claude-bg e um codex: esgotar o primeiro move as threads para o segundo; esgotar os dois move para o codex; sem destino, fila e um aviso |
| T3 Retomada, não recomeço | O redespacho no meio de um bloco leva o ponto de parada derivado do ledger e do git (fase, último commit, claims, rodada do CHECK, GO-FIX em curso) numa seção própria do prompt, e não repete GOAL nem PLAN; o prompt original segue gravado com o sha256 | teste: thread parada no CHECK é retomada no CHECK, com o GOAL e o PLAN intactos |
| T4 Trabalho da sessão mora na thread | Rascunhos, pareceres de revisão e listas de prova vão para a pasta da thread (`.orkastery/threads/<id>/trabalho/`), não só para o diretório do job da conta; na troca, o ork leva o caminho e um resumo limitado do que está lá | teste: o parecer gravado pela sessão A é lido pela sessão B de outra conta |
| T5 Condução não divide o destino das fases | O passo que reage à cota é o `ork conducao batida` determinístico (RM-063 F7), chamado pela batida da máquina; quando há condutor LLM, o `ork doctor` avisa se ele divide runtime e conta com fases vivas | ensaio: esgotar a conta das fases não para a condução |
| T6 A rede vê a parada | Máquina sem destino capaz publica as threads paradas na rede ([RM-053](RM-053-orkastery-network.md)); outra máquina com conta livre pode assumir pela reserva ([RM-047](RM-047-fabrica-em-varias-maquinas.md)), e o dono recebe o aviso em até 30 min | teste com duas máquinas falsas: a sem conta publica, a com conta assume pela reserva |
| T7 Estado das contas sempre vivo | O `ork accounts check` expira a marcação vencida, distingue limite de sessão, semanal e de gasto definido pelo administrador, mede a cota quando o runtime a expõe e mostra, por conta, o que roda nela e quando volta; runtime sem adaptador instalado não entra como destino capaz | teste: marcação vencida volta a ativa; medida estruturada aparece; fallback sem adaptador é descartado |
| T8 Estado gravável com privilégio mínimo | O despacho inicial e o redespacho Codex por `ork retry` ou pela escada recebem o MCP do Orkastery vinculado à própria thread e ao despacho, com perfil filho `worktree` e ferramentas de mutação enumeradas; o sandbox continua restrito à worktree e o núcleo valida cada escrita | teste: redespacho simulado contém somente os grants MCP previstos, sem ampliar sandbox nem raiz gravável |
| T9 Fim visto mesmo sem watcher | O vínculo do sensor é registrado antes da prontidão eventual do runtime. Se o watcher não nascer ou morrer, a batida recompõe a fonte pelo despacho verificado, lê o terminal nativo, grava a resposta final privada em `trabalho/` e emite um único `phase_result`; falha permanente ao recompor a fonte fica diagnosticada e só vira parada tipada depois de dez minutos desde a última observação boa ou o primeiro erro da série atual | teste com controller e rollout simulados: falha transitória não encerra a sessão, a leitura seguinte encontra `task_complete` e vínculo permanentemente divergente termina em `runtime.unavailable` |
| T10 Fora do rodízio em toda seleção | A escada, o retry, a fila e a distribuição por carga consomem a mesma lista de perfis disponíveis. Perfil desativado continua configurado, portanto não habilita ambiente implícito, mas nunca é escolhido | teste com perfis ativos e desativados: nenhum seletor automático devolve o perfil retirado pelo dono |

- **Entregáveis e critérios de aceite:** cada frente com a prova da tabela. O critério do item é o ensaio de esgotamento: com duas contas Claude e uma Codex, esgotar a primeira no meio do GO de três threads, e as três voltam a andar na segunda em até 10 min, do ponto onde pararam, sem o dono; esgotar também a segunda, e elas seguem no Codex; sem nenhum destino, ficam na fila até a volta da cota, com um aviso só.
- **Piloto, medição e critérios de expansão/interrupção:** 14 dias na VPS e na maquina-b, com o #Noctum ligado; interrompe se houver despacho em conta fora do rodízio ou duas sessões na mesma worktree.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** P0, pedido do dono de 13/10/2026; o #Noctum (RM-058) roda arcos de horas e não se sustenta se uma conta esgotada para o arco inteiro.
- **Horizonte / alvo / previsão / confiança / marcos:** fatia 1 (T1, T2, T3); fatia 2 (T4, T5, T7); fatia 3 (T8, T9, T10); T6 permanece como frente própria de rede.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-063 F3, F4 e F7 (prompt gravado, escada e condutor com autorização); RM-056 (perfil por thread); RM-040 (estado de conta entre projetos); RM-059 (Sentinela e Clima de Cota); RM-047 e RM-053 (rede).
- **Premissas / riscos / mitigação:** risco de gastar a cota de uma conta que o dono reserva para outro uso; mitigação: só entram na troca as contas do rodízio (`ork accounts`), e o dono tira uma conta do rodízio com `ork accounts remove`. Risco de trocar de runtime no meio de um bloco e perder qualidade; mitigação: outra conta do mesmo runtime vem antes do fallback, e a troca fica no ledger.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** pedido do dono de 13/10/2026 (esta página). Página própria em vez de fatia da RM-063: a RM-063 trata o despacho que falha e a máquina sem batida; esta trata a conta que acaba com a fase em curso e o destino capaz disponível.

## Estado com evidências

### Fatia 1 — T1, T2 e T3

A primeira fatia está implementada na branch da thread `ork-rm064f1`:

- **T1:** falas de limite em inglês e português, erro estruturado do Codex e hooks `Stop`/`Notification` viram o sinal tipado `runtime.quota-exhausted`. O perfil recebe o prazo de volta e o reconciliador procura, nos projetos registrados, as sessões vivas ligadas à mesma conta. A parada de `claude-bg` usa a identidade retornada pelo runtime; a do Codex exige o controller e o vínculo canônico da thread. Sem prova da parada, a condução não é liberada.
- **T2:** o retry automático reaproveita a autorização durável da thread, tenta primeiro outro perfil ativo do mesmo runtime, depois o fallback do bloco e, sem destino capaz, grava uma única espera até o menor prazo de retorno. Perfil desativado, esgotado, sem autenticação ou de provedor pago não recebe despacho.
- **T3:** a retomada recebe um prompt derivado com fase, último commit, `git status`, claims pendentes, rodada do CHECK e GO-FIX em curso. O prompt e o `sha256` originais permanecem registrados; a fase corrente é preservada e a existência anterior de `docs/goal.md` não abre `human.pending`.

T3 substitui a guarda D11c somente para `runtime.quota-exhausted`: se a sessão já produziu ou
commitou, o retry usa o checkpoint em vez de abrir `human.pending`. A guarda fail-closed permanece
nas falhas sem retomada segura. A regressão em `core/test/cota-terminal.test.ts` confere que o novo
despacho referencia o `HEAD` existente e que o retry não cria um segundo commit.

Provas focadas:

```sh
npm --prefix core run build:test
node core/dist-test/test/rm064-quota-signals.test.js
node core/dist-test/test/rm064-conta-esgotada.test.js
node core/dist-test/test/rotacao-retry.test.js
node core/dist-test/test/rm064-retomada-checkpoint.test.js
```

Limites da fatia 1 ao ser entregue: T4 a T7 continuavam pendentes; a enumeração entre máquinas pertence à T6. Uma fonte de inventário incompleta ou um controller Codex sem vínculo mantém a thread bloqueada, sem inferir parada nem criar uma segunda sessão na worktree. Não houve implantação nessa fatia.

### Fatia 2: T4, T5 e T7

- **T4:** cada thread tem a pasta retomável `.orkastery/threads/<id>/trabalho/`, criada com modo `0700` quando a fase é despachada. O prompt de toda fase entrega esse caminho; o checkpoint da retomada também resume os arquivos regulares pequenos por nome, tamanho e `sha256`. Arquivo grande, link simbólico, profundidade e volume excedentes são contados, mas não copiados nem injetados no prompt, e com a lista ou o orçamento cheios o resto da pasta só é contado, sem ser aberto. Para a sessão que grava fora da worktree, o diretório do job deixa de ser o único lugar dos rascunhos de parecer e de corpo do PR, dos pareceres e das listas de prova; o `pr-body.md` final continua na pasta da thread.
- **T5:** com a Sentinela ativa, `ork conducao batida` continua responsável pela retomada tipada de `runtime.quota-exhausted`; os demais passos permanecem com a Sentinela. O `ork doctor` compara o runtime e o perfil do condutor LLM com as fases vivas e avisa quando dividem a mesma conta; a sessão de fase despachada pelo `ork` não entra nessa conta como condutor.
- **T7:** `ork accounts check` persiste a expiração de marca vencida antes de conferir a autenticação, classifica o tipo de limite (o limite de gasto dito por extenso vence o semanal do prazo de volta), relata cota estruturada somente quando o runtime a fornece, lista a carga viva da conta e mostra o prazo de volta. Os rótulos dessa linha, e o nome da unidade que o runtime não informa, seguem a língua da CLI (`owner.language` ou o locale): `limite`, `cota`, `roda agora`, `volta` e `unidades` em pt-BR; `limit`, `quota`, `running now`, `returns` e `units` em inglês. Em projeto preparado pelo MCP, a fila, a rotação e a escada só consideram um fallback depois de conferir o recibo e os bytes do adaptador desse runtime.

Provas focadas:

```sh
npm --prefix core run build
npm --prefix core run build:test
node core/dist-test/test/rm064-fatia2.test.js
node core/dist-test/test/rm064-conta-esgotada.test.js
node core/dist-test/test/rotacao-retry.test.js
node core/dist-test/test/locale-accounts.test.js
node core/dist-test/test/locale-f3b-snapshot.test.js
node --test --test-name-pattern='RM-064' core/dist-test/test/rm063-conducao-batida.test.js
node --test --test-name-pattern='RM-064' core/dist-test/test/fila-fallback.test.js
node --test --test-name-pattern='RM-064' core/dist-test/test/cota-terminal.test.js
```

Limites desta fatia:

- A pasta de T4 fica na raiz do estado, fora da worktree. A sessão Codex no sandbox `workspace-write` só grava na worktree e não alcança `trabalho/`.
- No Claude Code, a gravação ali depende das permissões da sessão: o despacho só pré-aprova edição dentro da worktree, e a sessão que retomou esta fatia em modo automático gravou a sua lista de provas em `trabalho/`. Quem não puder gravar segue com os rascunhos no diretório do job e no resumo da sessão.
- Garantir a pasta a todo perfil muda sandbox e permissão, decisão do dono, e não entrou nesta fatia.
- O resumo de T4 aponta para o trabalho na mesma raiz de estado; ele não transporta conteúdo entre máquinas.
- O aviso de T5 diagnostica a conta compartilhada, mas não move o condutor LLM.
- Sem medida estruturada, T7 mostra cota indisponível em vez de estimar ou inventar zero. Projeto legado sem MCP mantém a seleção anterior.
- A assunção entre máquinas continua na T6, reservada para a fatia 3. Não há implantação nesta fatia.

### Fatia 3: T8, T9 e T10

Uma troca automática expôs uma segunda classe de parada: sessões do runtime alternativo concluíram o turno, mas não
conseguiram gravar o estado fora da worktree; o watcher falhou antes de registrar a própria fonte, a batida não viu o
terminal e um perfil retirado do rodízio ainda apareceu entre os candidatos. O trabalho ficou somente na resposta da
sessão e as threads continuaram conduzidas sem um resultado observável.

- **T8:** o despacho inicial e o redespacho Codex por `ork retry` ou pela escada injetam o MCP vinculado à thread e à
  identidade do despacho. O perfil filho `worktree` autoriza somente as ferramentas enumeradas do núcleo; objetivo,
  plano, parecer, claims, commits, verify e entrega passam pelos contratos do Orkastery, sem tornar a raiz do projeto
  gravável pelo sandbox.
- **T9:** o registro estrutural do sensor acontece antes de o rollout estar pronto. A validação profunda continua
  fail-closed no laço. A batida reconcilia a última sessão despachada e verificada quando o watcher não está vivo,
  recompõe uma fonte ausente pelo `phase_dispatch`, lê `task_complete` e o fechamento nativo, guarda a resposta final
  em arquivo privado `0600` e registra no ledger apenas caminho, `sha256`, bytes e truncamento. Depois de dez minutos
  desde a última observação boa ou o primeiro erro da série atual sem fonte legível, a sessão vira
  `runtime.unavailable`, de modo idempotente, e o passo seguinte é retry automático ou item explícito do dono. Falha
  permanente ao recompor o vínculo entra no mesmo diagnóstico e no mesmo prazo; a batida não a descarta em silêncio.
- **T10:** `perfisDisponiveis` é o filtro comum da escada, do retry de modelo e da distribuição por carga. A existência
  de um perfil desativado impede cair silenciosamente no ambiente implícito, mas ele nunca vira destino.

Prova focada:

```sh
npm --prefix core run build:test
node core/dist-test/test/rm064-fatia3.test.js
```

Os testes usam somente projeto, controller, rollout e contas simulados. Não despacham runtime real nem alteram perfis
da máquina. T6 e a implantação continuam fora desta fatia.

### Continuação: fila pesada entre host e sandbox

O incidente de 29/10/2026 mostrou que a vida do dono da fila pesada não pode depender só de
`kill(pid, 0)`: o `ork verify` estava vivo no host, mas o sandbox via outro espaço de PIDs e chamou
o lease de órfão. A continuação `ork-asessaonosan` combina quatro sinais:

- a trava do kernel continua a autoridade quando observável;
- uma batida em arquivo, renovada pelo próprio dono e com prazo, prova vida dos dois lados;
- identidade opaca do host e do espaço de PIDs impede comparar PIDs de domínios diferentes;
- quando o domínio coincide, `/proc/<pid>/stat` confere também o instante de início, evitando PID reutilizado.

O resultado é triádico: vivo, morto ou desconhecido. Só prova positiva de morte permite recuperar;
desconhecido vira `concurrency.lease-indeterminado`, espera com `--esperar` ou pedido tipado à
condução. A mesma continuação acrescenta `ork_request_conduction` ao perfil filho `worktree`, sem
ampliar o sandbox: a sessão registra um comando `ork` exato, o watcher não o rebaixa a
`runtime.unavailable`, o retry não redespacha e o relatório o mostra em “Conosco”.

Provas focadas cobrem lease vivo visto de outro espaço de PIDs, lease realmente órfão, estado
desconhecido, parada intencional, correlação do pedido, retry em espera e o relatório. A mudança
está em “Não publicado”; as fatias 1 a 3 seguem sendo as únicas marcadas como produção abaixo.

### CHECK continua dentro da sessão — thread `ork-verifyassinc`

A continuação #Auto não depende mais de manter `ork_verify` aberto durante a suíte. O prompt v5
inicia uma única rodada assíncrona, guarda o `rodadaId` e consulta `ork_verify_status` a cada
30–60 s, conservando só estado e lane durante a espera. No verde, segue para bundle, CHECK e SHIP;
falha tipada ou veredito vermelho continua bloqueando qualquer modo.

Claude Code e Grok recebem `ork_verify_status` como consulta enumerada; o filho Codex recebe o
grant explícito necessário ao perfil `approval_policy=never`. O perfil `worktree` continua sendo
o único que inicia a mutação, sem ampliar sandbox, gate ou identidade do dono. O comportamento e
o contrato estão em [FEAT-020](../produto/FEAT-020-mcp-e-adaptadores.md) e
[`verify-mcp.md`](../referencia/contratos/verify-mcp.md).

- Em produção na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026): as fatias 1, 2 e 3 saíram juntas nessa versão (T1 a T5 e T7 a T10); a T6 segue.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-27 | Julio |
| Documentação | Em revisão | — | 2026-10-27 | Julio |
| Código | Mesclado | commit `fe590b66` · PR #178 | 2026-10-27 | Julio |
| Testes | Em execução | — | 2026-10-27 | Julio |
| Deploy | Produção | release: v0.6.0 (fatias 1, 2 e 3), @orkastery/cli no npm | 2026-10-27 | Julio |
| Exposição | Parcial | — | 2026-10-27 | Julio |
| Habilitação | Em andamento | — | 2026-10-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: condutor da VPS; A: Julio; C: condutor da maquina-b (RM-063); I: —.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** condutor da VPS (#Fast para a página); revisor humano: Julio.
- **Próxima ação, responsável:** tratar T6 na frente de rede. Responsável: condutor da iniciativa.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-13 | Item criado com as frentes T1 a T7 | Incidente de 13/10/2026 (I1 a I8): a conta A esgotou às 02h03 com a conta B e o Codex disponíveis, e a fábrica ficou parada até 15h00 | Julio |
| 2026-10-19 | Estado do código corrigido de `Branch criada` para `Mesclado`, com a evidência do último merge | As fatias 1, 2 e 3 estão na `main`: `9975486e` (#173, 14/10), `8d37c75f` (#176, 19/10) e `fe590b66` (#178, 19/10). Testes seguem em execução e o ciclo não muda: a T6 e a implantação continuam abertas | Julio |
| 2026-10-27 | Fatias 1, 2 e 3 em produção na 0.6.0; exposição Parcial e habilitação Em andamento, porque a T6 segue | Tag `v0.6.0`, com os merges `9975486e` (#173), `8d37c75f` (#176) e `fe590b66` (#178) na tag; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
| 2026-10-29 | Continuação para a fila pesada observada de outro espaço de PIDs e para pedidos tipados à condução | Incidente da thread `ork-rm061f3erota` e testes focados da thread `ork-asessaonosan`; mudança ainda em “Não publicado” | Agente condutor em #Auto |
