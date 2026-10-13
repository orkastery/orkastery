---
id: RM-058
tipo: roadmap
titulo: "Modo #Noctum: arcos autônomos de muitas threads e máquinas"
categoria: iniciativa
pai: null
features: [FEAT-002, FEAT-026, FEAT-031, FEAT-032]
owner: Julio
atualizado_em: 2026-10-12T14:42:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Mesclado
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: "5551300"
    pr: null
  testes:
    n1: core/test/noctum-envelope.test.ts (E1 a E12) e core/test/noctum-arco.test.ts (A1 a A26)
    n2: core/test/noctum-fila.test.ts (F1 a F17), noctum-capacidade.test.ts (C1 a C10), fila-pesada.test.ts (P1 a P11), fila-pesada-verify.test.ts (V1 a V12) e noctum-execucao.test.ts (X1 a X15)
    n4: core/test/noctum-supervisao.test.ts (S1 a S12), noctum-reconciliacao.test.ts (R1 a R15), noctum-vigia.test.ts (G1 a G8), noctum-fila.test.ts (F18 a F20) e noctum-execucao.test.ts (X16 a X18)
sdlc:
  thread: ork-rm058n4
  modo: "#Auto"
  fase: GOAL
  status: aberta
---

# RM-058 — Modo #Noctum: arcos autônomos de muitas threads e máquinas

> **Em uma frase:** proposta de arcos de 6 a 12 horas em que o Orkastery conduz muitas threads, em uma ou mais máquinas autorizadas, com prova de qualidade e decisões do dono reunidas para a manhã.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Mesclado | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

**Em desenvolvimento, com as quatro decisões de produto tomadas e as fatias N1, N2 e N4 implementadas nas threads `ork-rm058n1`, `ork-rm058n2` e `ork-rm058n4`.** Esta página planeja o #Noctum; o modo ainda não está habilitado e `#Noctum` não é aceito como modo.

- Fora da [N1](#n1-envelope-e-estado-do-arco), da [N2](#n2-fila-local-e-capacidade) e da [N4](#n4-supervisão-e-recuperação), as regras abaixo são requisitos futuros. A duração vem do pedido do dono, não de um ensaio de autonomia já aprovado.
- Em 12/10/2026 o dono decidiu D1 a D4 (veja [Decisões do dono](#decisões-do-dono)); seguem pendentes a prioridade final, o horário e o canal do relatório da manhã e os valores do teto, que o dono preenche antes do primeiro piloto.
- O primeiro piloto continua dependendo da autorização do dono.

Features relacionadas: [modos de condução](../produto/FEAT-002-modos-de-conducao.md), [reservas do roadmap](../produto/FEAT-026-reservas-do-roadmap.md), [Orkastery Network](../produto/FEAT-031-orkastery-network.md) e [roadmap da rede](../produto/FEAT-032-roadmap-da-rede.md). São bases existentes, não prova de execução autônoma entre máquinas.

## Problema e resultado

- **Público e problema:** product builder com roadmap priorizado e trabalho suficiente para avançar enquanto fica ausente por 6 a 12 horas. Hoje precisa vigiar a condução, recuperar sessões e coordenar contas, revisões e merges.
- **Evidências e fonte:** pedido do dono para a RM-058 e registro da condutora sobre a condução manual na noite de 02 para 03/10/2026. As ocorrências relatadas estão em [Resiliência](#resiliência-ao-longo-de-horas), com suas limitações de evidência.
- **Objetivo:** conduzir um arco inteiro, da seleção de itens ao relatório final, sem solicitar intervenção humana durante a janela autorizada, mantendo os bloqueios de cada ação e a prova de cada entrega.
- **Hipótese:** se o núcleo persistir autorização, fila, limites, supervisão e retomada, o arco poderá continuar com trabalho independente quando uma thread falhar ou depender do dono, sem precisar de vigilância manual.
- **Métrica principal:** tempo de condução elegível sem intervenção humana, medido entre eventos do arco no ledger. Linha de base quantitativa ainda não medida; o relato manual não equivale a benchmark. Meta proposta: completar ensaios de 6 h e 12 h sem intervenção, se houver fila e orçamento. Janela: piloto de cada duração, com injeção de falhas e recibos por transição.
- **Métricas de proteção:** nenhuma operação fora do envelope, nenhum merge sem provas no SHA correto, nenhum dono ou revisor fictício, nenhuma duplicação de item entre máquinas e nenhuma ultrapassagem do teto autorizado.

| Aspecto | #Auto vigente | #Noctum proposto |
| --- | --- | --- |
| Unidade de condução | Uma thread e seu ciclo, sem pausas humanas previstas | Um arco com muitas threads, fila, prazo e orçamento comuns |
| Paralelismo | O projeto pode ter threads simultâneas | O arco planeja e limita a distribuição entre máquinas e contas |
| Decisão exclusiva do dono | Escalação tipada pausa a thread | A operação e seus dependentes ficam bloqueados; outras threads elegíveis seguem; a decisão vai ao lote |
| Fechamento | Evidências, entrega e MASTER da thread | Fechamento por thread mais reconciliação e relatório de todo o arco |

O #Noctum não reduzirá checks nem converterá `policy: block`, autenticação ausente ou escalação tipada em permissão. Se o impedimento afetar o arco inteiro, ele terminará com estado recuperável e relatório; continuidade não será promessa de progresso sem condições.

## Escopo e validação

**Incluído:** envelope anterior ao arco, fila persistente de itens autorizados, distribuição com reservas, supervisão, recuperação limitada, revisão independente, fila de operações pesadas, entrega com provas, controle de custo e relatório multicanal.

**Entregável desta etapa:** apenas o planejamento, sua posição proposta no [índice](README.md#prioridade-para-a-comunidade-de-product-builders) e a entrada documental no [CHANGELOG](../../CHANGELOG.md). A implementação tem as seis fatias abaixo; a N1 está na thread `ork-rm058n1` e a N2 na `ork-rm058n2`, registrada no bloco `sdlc`, e o modo segue sem habilitação.

**Validação documental:** `node core/dist/index.js docs sincronizar --escrever`, `ork docs verificar` e `core/node_modules/.bin/markdownlint-cli2 docs/roadmap/RM-058-modo-noctum.md docs/roadmap/README.md CHANGELOG.md`. A aprovação desses comandos confere documentação; não prova um arco Noctum.

### Envelope de autorização antes do arco

O dono deverá conceder um envelope por ingresso autenticado do host antes do início. O núcleo guardará sua versão e hash, recibo de origem humana, projetos e repositórios, branches de destino, itens elegíveis, máquinas, contas e runtimes permitidos, início, expiração, fuso, tetos, limites de concorrência e canal/horário do relatório. Não haverá autorização por silêncio nem renovação automática.

O registro ficará no estado governado pelo núcleo, referenciado por todo evento do arco, sem credenciais no documento ou no ledger. Cada executor terá de conferir a versão vigente, revogação, escopo, tempo e orçamento antes do despacho e imediatamente antes de um efeito externo. Um retrato da rede ou texto de um agente não substituirá esse recibo. O contrato persistente e o ingresso no núcleo foram definidos na [N1](#n1-envelope-e-estado-do-arco); o comando dos gateways e a ferramenta do MCP que levam esse ingresso até o núcleo ficam para a fatia que liga o transporte.

| Operação | Autorização que deverá constar | Conferência antes de executar |
| --- | --- | --- |
| Push e PR | Remotos, branches de trabalho e repositórios já existentes; permissão separada para criar/atualizar PR | Destino permitido, claims, identidade do executor, prazo e ausência de segredo; push direto na base fica fora do envelope |
| Merge | Branch de destino e exigência dos checks obrigatórios, revisão independente e verify aprovados | SHA fonte exato, base atual e candidato de integração; qualquer alteração invalida a prova afetada e exige nova rodada |
| Despacho de threads | Lista ou filtro fechado de itens do roadmap e dependências autorizadas | Item elegível, reserva ganha, capacidade disponível e gates satisfeitos; expansão do escopo vai ao lote |
| Rodízio de contas e runtime | Lista de perfis previamente autenticados, runtimes, modelos/esforços e política de provider admitidos | Saúde, saldo e concorrência da conta; mudança de runtime, inclusive Claude → Codex, somente entre opções já autorizadas |

**Nunca entra em nenhum envelope:** tag e publicação de versão, pacote ou site; acesso ou circulação de segredos; ações destrutivas; criação de repositório público. A atualização de produção também fica fora: só com autorização explícita própria e fluxo próprio, descrito abaixo. Credenciais continuarão locais, consumidas apenas pelo mecanismo já autorizado do host. Nenhum agente poderá ampliar permissões, mudar sandbox, trocar identidade ou habilitar provider pago para recuperar o arco.

Uma implantação em produção exigirá autorização específica do dono e fluxo próprio; não será inferida de push, PR ou merge. Revogação ou expiração negará novos efeitos imediatamente. Trabalho em voo será interrompido ou encerrado em checkpoint seguro, conforme o limite do host, sem aproveitar uma ação iniciada antes do prazo para autorizar a seguinte.

### N1: envelope e estado do arco

Implementada na thread `ork-rm058n1` (modo #Auto), sem ligar o modo: nenhum comando, ferramenta ou gateway abre arco ainda, e `#Noctum` segue recusado como modo.

- **Contrato `ork.noctum-envelope/v1`** (`core/src/noctum-envelope.ts`): o pedido de abertura traz o arco, a janela (`inicio` e `fim` com deslocamento explícito, `fuso` IANA, de 6 a 12 h), os destinos (repositório já existente, base e permissões entre `push`, `pr` e `merge`), o orçamento (teto do arco e subtetos por conta e por runtime `claude-bg` ou `codex`, cada um com valor finito maior que zero e unidade entre `sessoes`, `minutos-de-sessao`, `tokens` e `percentual-da-cota`) e o relatório da manhã (`horario` `HH:MM` no fuso da janela e um `canal` entre `terminal`, `telegram` e `openclaw`). As exclusões são fixas e ficam guardadas no envelope: `tag-e-publicacao`, `producao`, `segredos`, `acao-destrutiva` e `repositorio-publico-novo`. O hash é o sha256 do conteúdo canônico.
- **Nenhum valor do dono é presumido:** pedido sem algum desses campos é recusado com `noctum.envelope.valores-ausentes`, que lista tudo o que falta de uma vez; teto infinito, zero, negativo ou escrito como ilimitado é recusado com `noctum.envelope.teto-ilimitado`, sem opção de liberar. Os valores reais continuam do dono antes do primeiro piloto.
- **Ingresso com prova de origem, pelo caminho do HITL** (`core/src/noctum-arco.ts`): proposta não autoriza nada. Autorizar exige o envelope assinado do Telegram ou do callback nativo do host, conferido por `autenticarResposta` (chave do canal, allowlists, conta homologada e janela de 60 s) no endereço `noctum` / `arco:<arco>`, com o texto `autorizar <sha256>`; revogar exige o texto `revogar`. O `:` deixa esse endereço fora do alcance de `/ork gate`, `/ork session` e do pulse. Cada ato assinado deixa um recibo durável no formato do HITL (`.orkastery/noctum/arcos/<arco>/ingresso/`, com o MAC da chave do canal e o `.public` ao lado). O diálogo nativo do host entra por `criarDialogoDoArco`, com o callback de elicitação que o servidor fornece. Ainda não há comando do CLI, ferramenta do MCP nem comando dos gateways para esse ingresso.
- **Estado do arco:** log append-only em `.orkastery/noctum/arcos/<arco>/arco.jsonl`, na raiz do estado, com cada linha encadeada pelo sha256 da anterior e com MAC de subchave derivada da chave local do núcleo (`.orkastery/private`). A situação (`proposto`, `agendado`, `vigente`, `expirado`, `revogado`) é derivada do disco e do instante a cada leitura; nada fica em memória, e restart não renova o envelope nem responde pelo dono. Limites conhecidos: a chave local do núcleo é legível por qualquer processo com o mesmo usuário do sistema, que é o caso dos agentes da fábrica, então o MAC do log não os impede de escrever uma linha nova nem de truncar o log, como no ledger. O que eles não forjam é o recibo do canal que a autorização assinada deixa e que a conferência relê antes de cada efeito. A autorização pelo diálogo do host não tem esse recibo: com a chave local, uma linha nova que se diga do diálogo passa na conferência, e o teste A21 fixa esse limite. A fronteira dela é a conta do sistema, como no recibo local do HITL ([referência do CLI](../referencia/cli.md)), e `criarDialogoDoArco` confia no callback que recebe, como `criarIngressoLocal`; para separar o núcleo dos agentes, rode-os em outra conta ou sandbox.
- **Antes de cada efeito** (`conferirAntesDoEfeito`): recusa, nesta ordem, ação excluída (`noctum.efeito.acao-excluida`), estado adulterado (`noctum.estado.adulterado`), revogação (`noctum.efeito.revogado`), falta de autorização (`noctum.efeito.sem-autorizacao`), recibo do dono que não confere (`noctum.estado.adulterado`) ou que não pode ser reconferido no processo, sem a chave nem o verificador público do canal (`noctum.origem.sem-prova`), hash diferente do vigente (`noctum.efeito.hash-antigo`), fora da janela (`noctum.efeito.fora-da-janela` e `noctum.efeito.expirado`) e destino ou permissão fora do envelope, inclusive `push` direto na base, também pela ref completa (`noctum.efeito.fora-do-destino`). Emenda é versão nova com prova nova; revogação é terminal.
- **Fila de decisões em lote:** `enfileirarDecisao` guarda o que só o dono resolve, com thread, ação impedida, dependentes, impacto e 3 a 5 alternativas com exatamente uma recomendada, id estável e sempre `pendente`; não existe campo de resposta.
- **Fica para depois:** consumo e reserva do orçamento (N2 e N6; a conferência da N1 não mede consumo), as provas do `merge` no SHA exato (N5), a fila e a execução (N2), o multimáquina (N3), a supervisão (N4) e o relatório (N6). Os campos do envelope que a `v1` ainda não guarda (itens elegíveis, máquinas, contas e runtimes permitidos além dos subtetos, limites de concorrência, margem, fonte de medição e frequência de atualização) entram numa versão nova do contrato, com hash próprio, porque a `v1` recusa campo desconhecido. A `v2` da [N2](#n2-fila-local-e-capacidade) traz a lista de trabalhos e os limites de concorrência; máquinas, margem, fonte de medição e frequência seguem para as fatias seguintes.
- **Produção:** a N1 não reconhece implantação disparada por merge. Até o fluxo próprio de produção existir, `merge` numa base que implanta sozinha não deve entrar em envelope.
- **Emenda:** versão nova com prova nova, que mantém o início, não passa do `fim` autorizado e não reabre arco que terminou; arco novo é outro arco.

Evidência: `core/test/noctum-envelope.test.ts` (E1 a E12) e `core/test/noctum-arco.test.ts` (A1 a A26), que rodam em `npm --prefix core test`.

### N2: fila local e capacidade

Implementada na thread `ork-rm058n2` (modo #Auto), sem ligar o modo: nenhum comando, ferramenta ou gateway abre ou executa arco, e `#Noctum` segue recusado como modo.

- **Contrato `ork.noctum-envelope/v2`** (`core/src/noctum-envelope.ts`): traz o que a `v1` deixou para uma versão nova. `trabalhos` é a lista fechada do arco (até 30), cada um com `id`, `item` do roadmap, `prioridade` (o 1 vem primeiro), `dependeDe` (ids da mesma lista, sem ciclo; até a lista vazia é escrita pelo dono) e exatamente um entre `thread` (uma thread que já existe) e `pedido` (o texto do dono para a thread que o arco abre, até 4 KiB, e todos juntos até 16 KiB). O resumo que o dono autoriza traz cada pedido inteiro, linha por linha, e o pedido com caractere de controle (fora o tab e a quebra de linha), de formato (marcas de direção, largura zero, BOM, hífen suave e as tags do Unicode, que carregam texto que a tela não mostra e o modelo lê), de uso privado, separador de linha do Unicode, caractere que não desenha nada ou seletor de variação que não seja um só, o de texto ou o de emoji, logo depois de um pictograma ou da base da tecla, é recusado, porque esconderia texto na tela de quem autoriza (seletores em série carregam 4 bits cada). `capacidade` traz as sessões ao mesmo tempo na máquina, por conta e por runtime (as mesmas contas e runtimes do orçamento, nenhum limite acima da máquina) e `revisao`, os slots que só o CHECK usa. Falta vira `noctum.envelope.valores-ausentes`, listando tudo. A `v1` fica como estava, e um arco autorizado nela não despacha nada.
- **A fila** (`core/src/noctum-fila.ts`): relida do disco a cada passo. Entra o trabalho com as dependências entregues (`ship_done` na thread dele) e o item reservado por esta máquina na última cópia local da branch de reservas, sem rede; tomar reserva é da N3. A thread que o arco abre é achada depois pelo item mais o sha256 do pedido guardado na criação; duas threads casando é lacuna, nunca escolha. A ordem: prioridade do dono, prova mais adiantada (a fase a despachar mais adiante primeiro, abrir thread por último), posição no envelope e id. O passo de cada thread é o da Sentinela (`passoDaThread`): a fase seguinte à prova mais adiantada que a sessão do bloco deixou. SHIP e MASTER ficam para a N5 (aguardando entrega); fim de turno sem resultado e retomada ficam bloqueados para a N4; thread fora do #Auto, sem pedido guardado ou com decisão pendente no lote não sai da fila sozinha. O trabalho cujo despacho falhou no núcleo, antes de lançar, três vezes seguidas fica bloqueado (`erro-repetido`); o que pode ter uma sessão aberta (reserva pendente no log do arco, ou thread nunca despachada cuja falha disse o id da sessão) vai para a retomada da N4, e nunca ganha outra sessão por cima; a falha que não abriu nada (a conta sem cota, sem id) deixa o trabalho na fila, e o despacho seguinte sai por outra conta; e sem `auto` em `conduction.allowed_modes` o arco não tenta abrir thread.
- **Quando a fila acaba:** vazia (todo trabalho entregue, encerrado ou preso a uma dependência que fechou sem entrega, de qualquer distância) encerra cedo; só bloqueada, ou com fonte que não foi lida, espera com backoff (metade do tempo sem progresso, entre 5 e 60 min), nunca além do `fim`; com sessão em curso, espera 5 min, a cadência da D3. Lacuna nunca vira fila vazia; a thread ilegível só é lacuna quando pode ser a de um trabalho. Fechar o arco e mandar o relatório são da N6.
- **Capacidade** (`core/src/noctum-capacidade.ts`): a ocupação são as conduções de sessão desta raiz de estado, pela mesma regra de vaga do `ork phase run`, mais os despachos em curso, unidas às sessões vivas do runtime em todas as contas que o `ork` conhece, inclusive de outros projetos, sem repetir sessão. A sessão que o runtime prova encerrada na própria conta sai da conta; a que a regra da vaga soltou ainda conta se o runtime a mostra trabalhando, e a sessão sem perfil no lease conta na conta que o runtime atribui a ela. O despacho só é admitido com o projeto (o mesmo portão de vaga do `phase run`), a máquina, a margem de revisão (a execução nunca usa os slots do CHECK), a conta e o runtime ao mesmo tempo; fonte de sessões que falha não admite, porque consumo desconhecido nunca é zero. A conta do despacho é a do envelope com mais folga entre os perfis disponíveis do runtime.
- **Fila de recursos pesados** (`core/src/fila-pesada.ts`): `ork verify` e `ork verify --baseline` seguram a vez pela rodada inteira, depois da condução: no máximo `concurrency.max_parallel_heavy` ao mesmo tempo (padrão 1, 0 desliga) nas worktrees do projeto nesta máquina, nunca duas no mesmo artefato (a worktree) e na ordem de chegada. Tudo é trava do kernel, que solta quando o processo morre. O `ork verify` espera em primeiro plano até `--esperar` ou 60 min, avisa uma vez no stderr e então recusa com `fila-pesada.ocupada`, dizendo quem ocupa e o comando que repete com mais espera, e sai com 3. `ork ship`, `ork fix open`, `ork fix reverify` e a baseline do `ork phase run`, que verificam por dentro, esperam até o `--esperar` deles, com o mesmo aviso, ou 30 s sem ele; o `ork retry` e o `ork ci run`, até 30 s. O `ork_verify` e o `ork_ship` do MCP esperam até 20 s (o `ork_ship`, nunca além do prazo do worker) e devolvem a mesma recusa tipada. O comando que roda dentro da vez herda a marca da posse (`ORK_FILA_PESADA_DONO`, com o identificador da posse gravado na vaga): o `ork verify` de outra thread numa claim entra como reentrada, em vez de esperar a vaga do próprio pai; a marca copiada para fora dessa árvore de processos, ou guardada de uma vez anterior do mesmo dono, não pula a fila.
- **Execução** (`core/src/noctum-execucao.ts`): `passoDoArco` faz no máximo um despacho por chamada, sob a trava do kernel de despacho da raiz de estado (um despachante por vez, entre todos os arcos). Relê a fila e a capacidade, escolhe o primeiro candidato admitido, reserva o despacho com a conferência do envelope sob o lock do arco (`reservarDespacho`: a cadeia da N1 mais a janela, o trabalho na lista, a conta, o runtime e o orçamento), abre a thread pelo `novaThread` quando o trabalho é novo e despacha pelo `rodarFase`, que toma o lease de condução e é idempotente. O desfecho volta ao log do arco (`concluirDespacho`). A reserva de um trabalho de pedido só aceita a thread que o arco abriu para ele (o item mais o sha256 do pedido), só abre uma pelo GOAL e quando nenhuma casa com ele (nem pode casar, com thread ilegível no projeto), e recusa SHIP e MASTER. A baseline que o bloco com GO no codex pede nunca roda entre a reserva e o lançamento: o despacho do arco recusa com `baseline.pendente`, a reserva volta, a trava de despacho é solta e só então a baseline é gravada, e o passo seguinte confere tudo de novo. A falha de um candidato antes de lançar (abrir a thread, ler o pedido) devolve a reserva e o passo segue para o próximo, e a recusa da reserva que é só daquele candidato (fora do envelope, orçamento esgotado) também. Do núcleo, só a recusa de antes do lançamento devolve a reserva: a dos portões, e a da conta, do limite de uso ou do impedimento do dono quando nenhum id de sessão foi dito. A falha seca do runtime, o id dito antes da falha (o `claude --bg` que diz o id e sai com erro deixa a sessão aberta), o núcleo que volta sem sessão nem recusa e a exceção de dentro do `rodarFase` deixam a reserva pendente e contada até a N4 reconciliar; a exceção sobe. A recusa tipada do arco, inclusive a do log adulterado, volta como resultado do passo. A revogação usa o lock do arco e nunca espera um despacho.
- **Orçamento:** só `sessoes` é medido. Cada despacho reserva uma sessão no teto do arco e nos subtetos da conta e do runtime, e a recusa do núcleo a devolve; teto aplicável em outra unidade recusa com `noctum.orcamento.sem-medicao`, em vez de presumir consumo zero. A N6 mede `minutos-de-sessao`, `tokens` e `percentual-da-cota`.
- **Aprendizados da madrugada de 12/10:**
  - a sessão de fase que mandou verify ou suíte para segundo plano com `&` perdeu o processo e esperou para sempre (3 casos): as regras do prompt de fase pedem verify, build e suíte em primeiro plano, com timeout, e o `ork verify` espera a vez na fila de recursos pesados, cuja trava solta quando o processo morre;
  - `claude stop` antes do `phase_result` prendia a vaga até a thread fechar: a sessão com o Stop e sem atividade nenhuma por 15 min deixa a vaga do `ork phase run` (a mesma leitura do pulse; a carência cobre a sessão que só espera uma tarefa em segundo plano e volta sozinha), e a capacidade do arco também tira a sessão que o runtime prova encerrada;
  - o bloco inteiro numa sessão faz o `phase_result` sair com a fase do despacho, e um condutor que lê a última linha do ledger repete fase: a fila usa a prova mais adiantada da Sentinela e nunca despacha o PLAN de um bloco que já passou dele.
- **Limites ditos:** a fila pesada é da raiz de estado, e outro projeto da mesma máquina tem a sua; só há trava com `/usr/bin/flock`, e fora do Linux a fila pesada fica desligada e o arco não despacha; o processo morto por SIGKILL solta a vaga mesmo que um comando dele ainda rode até o próprio prazo. Despachos fora do arco (condutor externo, dono) não passam pela trava de despacho, e o limite do projeto continua valendo para eles. A reserva de um passo morto no meio fica contada no orçamento até a reconciliação da N4. A sessão que volta a trabalhar depois da carência do turno encerrado pode passar por um instante do limite do projeto. Na fila pesada, quem está na vez esperando uma worktree ocupada segura a vaga livre para quem vem depois; a reentrada no mesmo processo, e a do comando aninhado pela marca, vale pela raiz de estado e não pelo artefato, então com `max_parallel_heavy` acima de 1 e threads sem worktree o verify aninhado pode escrever na mesma raiz que outra operação da vez; e ler quem ocupa tranca por um instante a vaga livre. O `ork phase run --esperar N` pode esperar quase o dobro: até N pela condução e pela vaga, e de novo até N pela fila da baseline. O despacho do arco que cai no limite de uso vai para a fila durável do retry sem a correlação do arco, e o `ork retry resume` o retoma sem a conferência do envelope nem a reserva: amarrar essa retomada ao arco é da N4.
- **Fica para depois:** reserva nova e coordenação entre máquinas (N3), vigia, retomada e reconciliação (N4), entrega com provas no SHA (N5), fechamento, relatório e medição das outras unidades (N6), e o transporte que liga o modo.

Evidência: `core/test/noctum-envelope.test.ts` (E13 a E18), `core/test/noctum-fila.test.ts` (F1 a F17), `core/test/noctum-capacidade.test.ts` (C1 a C10), `core/test/fila-pesada.test.ts` (P1 a P11), `core/test/fila-pesada-verify.test.ts` (V1 a V12), `core/test/noctum-arco.test.ts` (A27 a A31), `core/test/noctum-execucao.test.ts` (X1 a X15) e o teste do `ork_ship` com a fila ocupada em `core/test/mcp-ship.test.ts`, que rodam em `npm --prefix core test`.

### N4: supervisão e recuperação

Implementada na thread `ork-rm058n4` (modo #Auto), numa máquina, sem ligar o modo: nenhum comando, ferramenta ou gateway abre, executa ou vigia arco, e `#Noctum` segue recusado como modo. Quem chama o vigia a cada 5 min (cron, serviço ou o transporte) é a fatia que liga o modo.

- **Checkpoints** (`core/src/noctum-supervisao.ts`): log append-only `.orkastery/noctum/arcos/<arco>/supervisao.jsonl`, ao lado do log do arco, encadeado e com MAC de subchave própria da chave local (a do log do arco não vale ali), com recusas no tipo fechado `MotivoDaSupervisao`. Guarda as gerações de quem conduz, as batidas, os tiques do vigia, as retomadas autorizadas, as sessões paradas, as contas que o arco tirou, os trabalhos isolados, as recusas de ambiente, a parada, os efeitos incertos e os pedidos da fila durável já tratados, e o estado é relido do disco a cada passo. Os parâmetros vão na primeira linha e valem pelo arco inteiro, mesmo com o manifesto mudado depois: cadência de 5 min (D3), carência de 15 min, vigia ausente depois de 15 min, 3 tiques interrompidos seguidos param o arco, 15 min para o primeiro turno, 90 min sem avanço, teto de retomadas por trabalho e fase igual ao `retry.max_tentativas` (padrão 3), uma retomada por sessão sem primeiro turno, 2 recusas de ambiente seguidas param o arco, 15 min de carência da reserva incerta e 2 leituras do efeito incerto; todos a medir no piloto. O log do arco não ganha linha da supervisão: nada aqui autoriza, renova, emenda ou prorroga o envelope, e a contabilidade da reserva segue no `concluirDespacho`.
- **Condutor e vigia** (`core/src/noctum-vigia.ts`): a prova de vida é a trava do kernel. O condutor (`conduzirArco`) segura `condutor.lock` pela vida inteira, grava a geração nova com a prova e chama o passo da N2 na cadência que a fila pede; quem perde a geração sai sem despachar. O vigia (`vigiarArco`, um tique) segura `vigia.lock`, registra o tique anterior que ficou aberto (o vigia que morreu no meio), reconcilia, aplica as paradas e, com a trava do condutor livre (o condutor morreu ou nunca existiu), grava a geração dele e dá um passo. O condutor vivo sem batida não é substituído, porque não há prova de ausência. Sem tique do vigia dentro do limite, o condutor não despacha nada novo (`vigia-ausente`).
- **Reconciliação** (`core/src/noctum-reconciliacao.ts`), só com a trava de despacho livre (nenhum passo no meio): a reserva pendente cujo despacho o ledger prova vira concluída; a de nada lançado (nenhum `phase_prompt_recorded` do arco depois dela) volta ao orçamento; a do id dito antes da falha vai ao runtime (viva conclui, morta conclui e retoma, sem leitura espera); o prompt gravado sem despacho nem id procura a sessão da thread no runtime: achada, conclui e isola o trabalho, porque ela roda fora do registro do núcleo; ausente da listagem completa do claude-bg depois da carência, a sessão volta ao orçamento; sem prova, a reserva fica contada e o trabalho é isolado.
- **Retomada pelo passo do arco**: a sessão morta sem resultado (estado terminal, fantasma, ou ausente da listagem completa da conta dela no claude-bg), o fim de turno sem resultado depois da carência, a sessão que trabalha sem evento de produto por 90 min (a espera por processo que morreu, o laço que acha a si mesmo) e a sessão sem nenhuma atividade 15 min depois do despacho (o diálogo do servidor MCP novo) viram `sessao_morta` no ledger da thread, o que solta condução e vaga, e uma retomada autorizada. A sessão viva é parada antes pelo controle do runtime (`claude stop` com o ambiente do perfil) e conferida na listagem seguinte. A fase é a seguinte à prova mais adiantada que a sessão deixou depois do despacho, ou a mesma; produto na branch prova o PLAN, não o GO; SHIP e MASTER ficam para a N5. Quem despacha é o passo da N2, com a conferência do envelope, a reserva e a capacidade. No teto, ou na segunda sessão sem primeiro turno, o trabalho é isolado.
- **Rodízio dentro do envelope**: o passo recebe só as contas do envelope que o store (com o registro compartilhado da [RM-040](RM-040-estado-de-conta-compartilhado.md)) dá como disponíveis e que o arco não tirou, e os runtimes do bloco e da ordem de fallback dele que o envelope admite, com o modelo e o esforço do item. Cota esgotada num despacho do arco sai até o reset dito; sem reset dito, fica fora pelo resto do arco, como lacuna; limite de uso sai até o `liberaEm` do pedido; login perdido tira a conta do arco; subteto esgotado tira a conta. Teto do arco esgotado, recusa por custo e 2 recusas de ambiente seguidas (`runtime.context.conflict`) param o arco, sem retry nem troca de conta.
- **O pedido do limite de uso**: o `ork phase run` grava a correlação do despacho no pedido da fila durável; o `ork retry resume` não redespacha o pedido de um arco e devolve que a retomada é do vigia, sem regravar o pedido; o vigia autoriza a retomada da fase pelo passo do arco e tira o pedido da fila depois do despacho do arco, ou com o arco encerrado.
- **Despacho de fora**: o `phase_dispatch` numa thread de trabalho do arco, depois da autorização, sem a correlação do arco (o condutor que relê a última linha do ledger, o `ork retry run`, o dono) isola o trabalho: o arco não conduz junto com outro condutor.
- **Efeito incerto**: `registrarEfeitoIncerto` e `reconciliarEfeito` deixam o remoto decidir o push que ficou incerto (`git ls-remote`): confirmado nunca se repete; ausente permite repetir abaixo do teto, e quem repete confere o envelope de novo; outro sha na branch, ou remoto sem leitura no teto, isolam o trabalho. Quem chama na entrega é a N5.
- **Retomada em outra máquina (interface para a N3)**: a geração e as travas são desta máquina. A geração vigente e as anteriores ficam no log de supervisão (`conducao_assumida`, com instância, pid e máquina), e as retomadas, os isolamentos e as contas fora são relidos de lá. Retomar noutra máquina exige revogar a geração anterior entre máquinas e provar que o executor antigo não grava mais (a trava do kernel não cruza máquinas), e só então gravar a geração nova com essa prova. A reconciliação de reserva e de sessão vale para despachos desta máquina, porque a prova vem da listagem local do runtime.
- **Limites ditos**: a chave local é legível por processos do mesmo usuário (como no log do arco), que escrevem linha nova ou truncam o log; a trava do kernel prova o fim do processo, não o travamento (o condutor vivo e parado só aparece como lacuna); o claude-bg prova a ausência de sessão só com todas as contas lidas, e o codex nunca prova ausência (a reserva incerta do codex fica contada e o trabalho isolado); a parada de sessão codex exige o controller vinculado, que o vigia não infere; o prazo de 90 min sem avanço é parâmetro a medir (uma fase pode passar disso sem produto, como a revisão longa); os despachos de fora não passam pela conferência do envelope e só são percebidos depois; e a cota marcada no store por outro projeto, sem prova do arco, vale pelo prazo do store, que pode ser estimado.

Evidência: `core/test/noctum-supervisao.test.ts` (S1 a S12), `core/test/noctum-reconciliacao.test.ts` (R1 a R15), `core/test/noctum-vigia.test.ts` (G1 a G8), `core/test/noctum-fila.test.ts` (F18 a F20) e `core/test/noctum-execucao.test.ts` (X16 a X18), que rodam em `npm --prefix core test`.

### Sem HITL no meio, com decisões registradas

Dentro do envelope, uma dúvida delegável deverá virar decisão autônoma registrada por `ork decisao registrar <thread>` ou pela ferramenta correspondente do núcleo. O registro levará quem decidiu, alternativas, uma recomendada, razão, evidência, critério, como mudar e custo de reverter agora e depois. A recomendação escolhida dentro do envelope terá autoria do agente, nunca do dono.

O que só o dono resolverá entrará numa fila de lote durável, com ID estável, thread, ação impedida, dependentes, impacto e 3 a 5 alternativas, exatamente uma recomendada, conforme [RM-048](RM-048-hitl-humano-no-centro.md) e [RM-057](RM-057-hitl-por-alternativas.md). Não se abrirá pergunta interativa durante o arco. Sem resposta, a ação permanecerá bloqueada; a recomendação não será aplicada como resposta humana.

O agendador retirará apenas o trabalho inelegível da fila executável e continuará com itens independentes. `policy: block`, violação de custo e limite de tentativas manterão sua abrangência: se globais, pararão o arco; se locais, isolarão a thread ou conta. Uma violação de custo não receberá retry automático. O lote será entregue no relatório combinado, inclusive quando o arco terminar antecipadamente.

### Arco e fila

1. **Preparar:** conferir envelope, dependências, ferramentas disponíveis, baseline, reservas e panorama de [RM-054](RM-054-roadmaps-e-threads-da-rede.md). Fonte não lida será lacuna; não será tratada como fila vazia.
2. **Escolher:** filtrar os itens autorizados por dependências cumpridas, escopo claro e prova executável; ordenar pela prioridade final definida pelo dono (ainda pendente), depois idade na fila e ID para desempate reproduzível. Itens novos descobertos durante o arco serão propostas para o lote.
3. **Reservar e distribuir:** ganhar a reserva antes de abrir a thread, conforme [RM-047](RM-047-fabrica-em-varias-maquinas.md); só despachar em máquina aderida, apta e autorizada. Capacidade anunciada será reconferida no executor.
4. **Fatiar:** cada tarefa deverá ter resultado pequeno, touch paths, claims, comando de aceite e commit próprio. Cada thread percorrerá GOAL → PLAN → GO → CHECK → SHIP → MASTER com os gates do núcleo.
5. **Limitar:** contabilizar sessões de execução e de revisão, incluindo outros projetos. Aplicar simultaneamente o teto da máquina e o teto global da conta entre máquinas; uma sessão só começa se ambos admitirem. Os limites serão explícitos no envelope, com margem reservada à revisão.
6. **Repor ou encerrar:** ao liberar capacidade, reler fatos e selecionar o próximo item. Fila realmente vazia encerrará antecipadamente; fila apenas bloqueada aguardará eventos até o prazo, com backoff, sem criar trabalho para ocupar contas. O relatório distinguirá vazio, bloqueado e fonte indisponível.

### Multimáquina

O [Orkastery Network, RM-053](RM-053-orkastery-network.md), fornecerá descoberta, identidade de instalação, capacidades e frescor. A RM-054 fornecerá o panorama e suas lacunas. Esses retratos não são um executor remoto: o transporte autenticado de ordens, recibos e cancelamento terá de ser implementado e testado na N3.

Haverá uma autoridade ativa para a fila do arco, com geração verificável e substituição controlada. Cada máquina conduzirá a thread na própria worktree. A reserva atômica por item impedirá duas máquinas de começar o mesmo trabalho; uma segunda thread do mesmo item aguardará liberação ou transferência registrada. Slots de conta compartilhada também precisarão de coordenação entre máquinas, além dos limites locais.

Cada máquina preparará a própria branch e PR. O merge passará pelo caminho oficial de entrega, com serialização por repositório/destino válida entre máquinas. Um lease apenas local não bastará: a N3 deverá provar coordenação compartilhada ou fila da forja, revalidando os HEADs após adquirir o direito de integrar. Perdeu a corrida ou mudou a base: atualizar, resolver conflitos e repetir as provas do novo candidato antes do merge. Push confirmado e reconciliação do remoto serão requisitos do recibo de entrega.

Se uma máquina perder batidas, o arco suspenderá novos despachos para ela, consultará sessão, controlador, reserva e remoto e preservará os checkpoints. Ausência de batida não provará morte nem liberará sozinha a reserva. Uma retomada em outra máquina só ocorrerá após revogar a geração anterior e impedir que o executor antigo volte a gravar ou integrar. Sem essa prova, o item ficará isolado para o lote; outros itens seguirão. Ao retornar, a máquina antiga reconciliará o estado e rejeitará ordens vencidas, sem executar a entrega em duplicidade.

### Resiliência ao longo de horas

**Origem:** registro da condutora no pedido deste planejamento, sobre a condução manual de 02→03/10/2026. As quantidades abaixo são ocorrências relatadas, não métricas de um Noctum implementado. A correção do watcher foi indicada no [PR #117](https://github.com/orkastery/orkastery/pull/117); o [CHANGELOG](../../CHANGELOG.md#não-publicado) descreve a recuperação e descreve a causa dos incidentes como provável, não comprovada. O piloto deverá produzir medições reproduzíveis.

| Ocorrência relatada | Como o Noctum deverá detectar | O que deverá fazer sozinho |
| --- | --- | --- |
| Condutor parou duas vezes; foram necessários despertador a cada 30 min e vigias | Supervisor externo à sessão comparará batida e avanço do ledger com o prazo de cada fase e sondará controlador/runtime; pouca saída, sozinha, não provará travamento | Retomar do checkpoint com nova sessão vinculada e geração válida; preservar gates e tentativas; isolar falha repetida. A cadência decidida em D3 é de 5 min, ainda como parâmetro a medir |
| Contas atingiram teto de gasto e limite semanal; rodízio detectou tarde e foi preciso trocar Claude por Codex | Conferir consumo, saldo/reset declarados pelo runtime, recusas tipadas e idade da última leitura antes do despacho e durante a execução | Retirar conta esgotada da seleção; aguardar reset ou escolher perfil/runtime previamente autorizado; transferir contexto com proveniência, sem contornar teto do arco ou violação de custo |
| Watcher Codex morreu em sessão longa; condução ficou presa por até 12 h, com correção indicada no #117 | Vigia independente observará o próprio watcher, eventos terminais e recibos auditados; canário incluirá falha durante commit MCP e sessão sem novo rollout | Exigir instalação com a correção e canário aprovado; recuperar sob trava e só assumir condução após provar ausência das identidades anteriores. Não esperar expirar uma janela de horas para perceber watcher morto |
| Verify concorrente com build/testes produziu regressão falsa | Registrar ocupação, geração dos artefatos compilados e aquisição do recurso por worktree; comparar falha com a baseline em ambiente estável | Enfileirar verifies e builds/testes pesados por máquina e impedir escritores concorrentes no mesmo artefato; preservar a primeira falha e repetir de forma isolada dentro do orçamento. Nova falha consistente continuará bloqueando |
| PRs conflitaram no `CHANGELOG.md`; depois de uma versão, uma entrada pôde cair na seção errada | Após cada avanço da base, conferir conflito e posição semântica da entrada, inclusive se a seção de versão mudou sem conflito textual | Preservar ambas as entradas em conflito, pôr a mudança ainda não publicada em “Não publicado”, regenerar índices e repetir review, verify e CI no novo SHA; ambiguidade de conteúdo vai ao lote |
| Claims usaram `rg`, ausente no CI, e reprovaram | Validar comandos no ambiente do runner e conferir dependências declaradas antes da revisão | Usar ferramentas disponíveis, como `grep -E` ou Node, em comandos de claims; revisar equivalência da prova e executar novamente no CI, sem transformar ausência de ferramenta em sucesso |
| Cada fatia de código precisou de 2 a 4 rodadas de revisão independente | Contabilizar rodadas, achados recorrentes, identidade nativa dos revisores e vínculo com o SHA | Reservar capacidade de revisão; devolver achados ao GO e repetir CHECK independente. Planejar capacidade para até quatro rodadas não autorizará exceder o limite de tentativas do núcleo; ao atingi-lo, isolar e relatar |

Todos os relógios, tetos de tentativas e critérios de avanço deverão ser persistidos. Reiniciar condutor, trocar máquina ou mudar runtime não zerará o histórico nem renovará o envelope.

### Qualidade sem dono acordado

Uma fatia só poderá chegar à `main` com revisão independente obrigatória, claims executadas, verify contra baseline e CI obrigatório verde no SHA fonte exato, além da prova de integração com a base vigente. Autor e revisor poderão usar o mesmo runtime/modelo, mas terão IDs nativos distintos e vínculos comprovados pelo núcleo. Nome de papel no prompt e autoavaliação não contarão como CHECK.

Cada CHECK cobrirá correção, segurança, performance, manutenção e estilo, com revisão dos testes. Mutantes existentes deverão ser executados; guardas novas precisarão de prova negativa adequada ao risco. Ausência ou inaplicabilidade de mutantes/performance terá justificativa verificável, nunca porcentagem inventada. Documentação passará também por paridade e markdownlint.

Falha, revisão pendente, mutante sobrevivente relevante, segredo, baseline ausente ou check de outro SHA impedirão a integração. Um verde antigo não sobreviverá a ajuste de conflito, código, teste ou documentação no candidato. A fila de merge deverá impedir que duas máquinas integrem com a mesma prova de uma base já superada. O MASTER de cada thread registrará índice derivado do ledger; eventual nota humana será posterior e identificada como humana.

### Relatório da manhã

O envelope fixará horário e fuso, canal do dono e destinos habilitados: terminal, Telegram e OpenClaw deverão apresentar o mesmo conteúdo essencial. A composição partirá dos fatos do núcleo, segundo o formato aprovado na [RM-048](RM-048-hitl-humano-no-centro.md); o exemplo abaixo define conteúdo, sem afirmar números de uma execução.

- ✅ **Entregue:** um item por linha, com resultado, thread, PR/commit, prova do push e MASTER. Commit local ficará entre os trabalhos em curso.
- 🔄 **Em curso:** checkpoint, responsável pela retomada, próximo passo e reserva ainda ativa.
- ⏸️ **Impedido:** causa, alcance e ações tentadas; `#HITL` somente no que depender do dono, com ID estável e alternativas do lote.
- 🧭 **Decidi no envelope:** decisão, recomendação aplicada, razão, evidência e como reverter.
- 💰 **Custo e duração:** consumo medido por arco/conta, unidade, teto, lacunas e motivo do encerramento; assinatura não será tratada como uso ilimitado.
- 📝 **Correções:** “foi informado”, “fato confirmado agora”, fonte e impacto. Uma alegação errada durante o arco será corrigida explicitamente, sem apagar seu rastro nem repetir entrega não provada.
- 👤 **O que precisa de você:** decisões do lote com 3 a 5 alternativas e uma recomendada; se não houver, dizer “nada”; indicar também o próximo trabalho elegível.

O envio terá ID do arco e recibo por destino para evitar duplicação. Canal indisponível manterá o relatório durável para reenvio limitado e consulta no terminal; não será marcado como entregue sem recibo. Encerramento antecipado preservará a entrega no horário combinado. Revogação de acesso ao canal será respeitada.

### Custo e parada

Antes do início, o envelope deverá fixar teto total do arco, subtetos por conta, unidade e fonte de medição, margem para operações em voo e frequência de atualização. Gastos conhecidos e reservas de consumo das sessões ativas entrarão na decisão de admitir mais trabalho. Conta de assinatura terá limites de uso/reset separados do custo monetário; consumo desconhecido será lacuna, nunca zero.

Ao iniciar operação, reservar capacidade; ao concluir, reconciliar consumo. Rotação de conta não restaurará saldo global. Estimativa não será apresentada como gasto medido: se o runtime não oferecer limite ou medição suficiente para garantir o teto, ele não será elegível para esse regime até haver mecanismo comprovado. O regime foi decidido em D4: vários perfis autenticados e runtimes de assinatura, com teto do arco e subtetos; os valores continuam pendentes.

| Condição | Comportamento proposto | Estado deixado para retomar |
| --- | --- | --- |
| Hora final ou envelope expirado/revogado | Parar admissões e novos efeitos; encerrar sessões de modo controlado | Checkpoints, motivos de interrupção e operações em voo reconciliadas |
| Fila vazia confirmada | Encerrar cedo; não abrir escopo novo | Retrato das fontes consultadas, itens concluídos e relatório agendado |
| Fila só com bloqueios ou fontes indisponíveis | Aguardar evento com backoff até o prazo, sem consumir sessões ociosas | Pendências e lacunas separadas de ausência de trabalho |
| Falha repetida ou escalação tipada | Aplicar o limite existente à unidade afetada; se o supervisor falhar repetidamente, parar o arco | Tentativas preservadas, diagnóstico e lote do dono |
| Teto do arco ou violação de custo | Parar globalmente, sem retry automático nem troca de conta para contornar | Consumo, reservas em voo e reconciliação pendente identificados |
| Conta sem capacidade, ainda dentro do teto global | Suspender a conta; só usar outra já admitida se policy e orçamento permitirem | Reset conhecido ou lacuna, sessões e saldo por conta |

O fechamento deverá deixar fila ordenada, envelope encerrado, decisões e evidências persistidas, branches/worktrees identificadas, PRs com estado real, resultados por SHA, reservas liberadas apenas onde for seguro e instrução de retomada. A próxima sessão exigirá envelope vigente e reconciliação; não repetirá cegamente commit, merge ou push cujo resultado tenha ficado incerto.

## Plano e decisões

- **Prioridade proposta:** posição 5, após RM-047 e antes de RM-037; aproxima a autonomia prolongada de sua base multimáquina, preservando as quatro primeiras posições. Método: dependências e impacto no trabalho sem supervisão; sem pontuação numérica inventada. Proposta de 2026-10-03, posição final de Julio.
- **Horizonte e confiança:** desenvolvimento, com a N1 e a N2 implementadas e sem previsão de lançamento. Confiança depende dos ensaios e da ratificação do envelope; marcos N1 a N6 abaixo.
- **Dependências e responsáveis:** RM-047 (reservas), RM-053 (rede), RM-054 (panorama), RM-048/RM-057 (decisões e status), [RM-037](RM-037-verify-rapido-e-confiavel.md) (verify), [RM-040](RM-040-estado-de-conta-compartilhado.md) e [RM-056](RM-056-perfil-por-thread-e-carga.md) (contas/capacidade), [RM-036](RM-036-maestro-multicanal.md) (condução). Owner de integração: Julio; executor a designar por fatia. Próxima revisão: antes de admitir N3, conferindo evidência de cada dependência, sem presumir conclusão pelo número do item.

### Fatias propostas

Os aceites da N1, da N2 e da N4 já são testes (veja a [N1](#n1-envelope-e-estado-do-arco), a [N2](#n2-fila-local-e-capacidade) e a [N4](#n4-supervisão-e-recuperação)); os das demais fatias são testes a construir, não provas já executadas. A ordem respeitará dependências e a aprovação das escolhas de produto.

| Fatia | Resultado | Critério de aceite verificável | Dependências |
| --- | --- | --- | --- |
| N1 — Envelope e estado do arco | Contrato persistente de autorização, prazo, exclusões, orçamento e decisões em lote | Testes de ingresso negam origem sem prova, ação excluída, hash antigo, revogação e expiração imediatamente antes do efeito; restart mantém limites e não inventa resposta do dono | Decisões D1–D4 (tomadas em 12/10/2026); valores do teto e canal do relatório; RM-048, RM-057 e policies vigentes |
| N2 — Fila local e capacidade | Seleção determinística e execução de muitas threads em uma máquina, com slots de revisão e recursos pesados | Fixture com itens independentes, dependência bloqueada e fila vazia prova ordem, progresso possível e encerramento; disputa entre dois processos nunca ultrapassa slots nem escreve no mesmo artefato compilado | N1; RM-037, RM-040, RM-056 |
| N3 — Coordenação entre máquinas | Transporte de ordens/recibos, reservas exclusivas, slots compartilhados e serialização de integração | Ensaio com dois executores prova um vencedor por item, limite global por conta e um integrador por destino; queda, partição e retorno do executor antigo não duplicam escrita ou entrega; base alterada invalida candidato | N2; RM-047, RM-053, RM-054 |
| N4 — Supervisão e recuperação | Vigia independente, checkpoints, rodízio autorizado e reconciliação após falha | Injetar parada do condutor/watcher, limite semanal, reset desconhecido, falha de autenticação e resultado incerto do push; provar recuperação limitada ou isolamento, sem renovar envelope nem trocar identidade | N2; N3 para retomada remota; correção indicada no #117 e canários da RM-036 |
| N5 — Qualidade e entrega | Revisão independente, mutantes aplicáveis, verify e CI por SHA antes da integração | Provas negativas recusam revisor sem vínculo, SHA alterado, CI vermelho/ausente, segredo e mutante relevante sobrevivente; conflito de changelog após versão preserva entradas na seção correta; falhas de build concorrente continuam registradas | N2 e N3; [CI independente](../produto/FEAT-005-ci-check-independente.md) e [SHIP](../produto/FEAT-006-ship-com-push-provado.md) |
| N6 — Fechamento, relatório e piloto | Parada por hora/custo/fila, retomada e relatório no canal combinado | Relógio controlado prova prazo/fuso, teto com sessões em voo, ausência de recibo e reenvio sem duplicação; ensaios de 6 h e 12 h mostram continuidade, falhas injetadas, prova de cada entrega e correção explícita de alegação errada | N1 a N5; RM-048, RM-054 e canais habilitados |

**Piloto e expansão:** começar em uma máquina com repositório de teste e falhas injetadas; depois repetir entre duas máquinas. Expansão exigirá aceites N1–N6, revisão independente e métricas com origem. Violação de envelope, duplicação de efeito, perda de evidência ou teto excedido interromperá o piloto. Tempo de recuperação e cadência serão medidos antes de afirmar um SLA.

### Riscos

| Risco | Probabilidade / impacto | Mitigação e contingência |
| --- | --- | --- |
| Autonomia interpretada como autorização irrestrita | A validar / crítico | Envelope conferido em cada efeito, exclusões explícitas e lote sem aprovação implícita |
| Partição da rede ou dois condutores ativos | A validar / alto | Autoridade por geração, reservas e isolamento do executor antigo; sem prova, não transferir o item |
| Consumo atrasado ou disputa pela mesma conta em projetos diferentes | A validar / alto | Slots globais, reservas de gasto, margem e recusa de admissão quando não for possível garantir o teto |
| Supervisor com a mesma falha do runtime observado | A validar / alto | Vigia externo, canários de morte do watcher e parada limitada com checkpoint |
| Pressa por entrega reduzir revisão ou mascarar regressão | A validar / alto | Revisão vinculada, SHA exato, baseline, fila pesada e histórico de falhas preservado |
| Fila do dono crescer sem resolução ou relatório não chegar | A validar / médio | IDs estáveis, dependentes isolados, lote priorizado e recibos/reenvio limitado por canal |

### Não-objetivos

- Implementar ou habilitar #Noctum nesta etapa documental, nem alterar os modos existentes.
- Garantir trabalho útil sem fila elegível, capacidade, autenticação, orçamento ou dependências disponíveis.
- Criar uma rede de equipe, compartilhar credenciais ou transformar a descoberta da RM-053 em autorização remota.
- Publicar versões, criar tags ou repositórios públicos e executar ações destrutivas; alterar produção sem a autorização própria dela.
- Remover policies, aceitar autoavaliação como revisão ou obter nota humana durante o arco.

### Decisões do dono

Em 12/10/2026 o dono escolheu, nas quatro decisões de produto D1–D4, a alternativa que havia sido recomendada. As demais alternativas ficam abaixo, descartadas, para o histórico. A escolha orienta o planejamento e as fatias N1 a N6; não autoriza execução: o primeiro piloto só começa quando o dono o autorizar, com o envelope descrito acima.

**Continuam pendentes**, e a página não as presume: a prioridade final do item no [índice](README.md#prioridade-para-a-comunidade-de-product-builders), o horário e o canal do relatório da manhã e os valores do teto (total do arco, subtetos por conta, unidades e margens), que o dono preenche antes do primeiro piloto.

- **D1. Até onde vai a entrega automática?** Decidida em 12/10/2026: **C**.
  - **C) push, PR e merge com todas as provas no SHA exato**, limitado ao destino autorizado e aos gates. Se o núcleo não conseguir provar, a ação fica bloqueada.
  - Descartadas: A) só commits locais; B) push e PR, sem merge; D) escolher antes, por repositório, entre A, B e C.
- **D2. Como entra o multimáquina?** Decidida em 12/10/2026: **B**.
  - **B) piloto local, depois piloto em duas máquinas antes de ampliar.** Prova a recuperação local antes de somar partição, exclusão mútua e retomada remota, sem tirar o multimáquina do escopo.
  - Descartadas: A) primeira implementação só local; C) várias máquinas já no primeiro piloto; D) só preparar PRs nas máquinas, com integração concentrada em uma.
- **D3. Janela e supervisão?** Decidida em 12/10/2026: **C**.
  - **C) janela entre 6 e 12 h, vigia externo a cada 5 min e prazo de avanço por fase.** Dá o período pedido com detecção mais rápida que o despertador manual; os 5 min são um parâmetro a medir (custo e falso alarme).
  - Descartadas: A) arcos fixos de 6 h; B) arcos fixos de 12 h; D) janela entre 6 e 12 h, vigia externo a cada 30 min.
- **D4. Custo e rodízio?** Decidida em 12/10/2026: **B**.
  - **B) vários perfis autenticados e runtimes de assinatura, com teto do arco e subtetos.** Usa a capacidade já autorizada e troca de runtime sem ampliar provider. Exige informar valores, unidades, margens e contas antes de começar, sem teto ilimitado por padrão.
  - Descartadas: A) um runtime e uma conta, com teto; C) também provider pago explicitamente autorizado, com limite imposto pelo provider; D) sem rodízio automático: o limite da conta encerra o arco.

Como mudar: registrar a nova escolha do dono por ingresso autenticado e atualizar esta seção e o contrato afetado, mantendo o histórico. Custo agora: revisão documental. Depois de N1–N6: migração do contrato, ajuste de admissões e repetição dos ensaios relacionados.

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`. Código e testes referem-se ao modo proposto, não à existência desta página. A thread `ork-rm058planeja` preparou o planejamento, a `ork-rm058n1` implementou a [N1](#n1-envelope-e-estado-do-arco), a `ork-rm058n2` a [N2](#n2-fila-local-e-capacidade) e a `ork-rm058n4` a [N4](#n4-supervisão-e-recuperação); nenhum ensaio Noctum ou entrega do modo é alegado aqui.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-10-12 | Julio |
| Documentação | Em revisão | — | 2026-10-12 | Julio |
| Código | Mesclado | commit `5551300` | 2026-10-12 | Julio |
| Testes | Em execução | n1: core/test/noctum-envelope.test.ts (E1 a E12) e core/test/noctum-arco.test.ts (A1 a A26) · n2: core/test/noctum-fila.test.ts (F1 a F17), noctum-capacidade.test.ts (C1 a C10), fila-pesada.test.ts (P1 a P11), fila-pesada-verify.test.ts (V1 a V12) e noctum-execucao.test.ts (X1 a X15) · n4: core/test/noctum-supervisao.test.ts (S1 a S12), noctum-reconciliacao.test.ts (R1 a R15), noctum-vigia.test.ts (G1 a G8), noctum-fila.test.ts (F18 a F20) e noctum-execucao.test.ts (X16 a X18) | 2026-10-12 | Julio |
| Deploy | Não implantado | — | 2026-10-12 | Julio |
| Exposição | Flag desligada | — | 2026-10-12 | Julio |
| Habilitação | Pendente | — | 2026-10-12 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: fábrica Orkastery na elaboração e nas futuras fatias; A: Julio; C: revisores independentes designados por fatia; I: dono pelo canal autorizado.
- **Agentes envolvidos, atuação e autonomia:** agente Codex redigiu a proposta em #Auto, restrita à documentação; agente Claude Code implementou a N1, a N2 e a N4 em #Auto, nas threads `ork-rm058n1`, `ork-rm058n2` e `ork-rm058n4`. Revisão independente e ratificação de produto não são presumidas; revisor humano: Julio.
- **Próxima ação, responsável e prazo:** Julio define a prioridade final, o horário e o canal do relatório e os valores do teto, e autoriza o primeiro piloto; D1–D4 já estão decididas; a N1 e a N2 estão implementadas e a próxima fatia é a N3 (coordenação entre máquinas), sem data de lançamento definida.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-03 | Proposta em Refinamento, seis fatias e posição 5 sugerida | Pedido do dono para planejar #Noctum; relato de condução manual e dependências documentadas acima | Codex propõe; Julio decide produto e prioridade |
| 2026-10-12 | D1 a D4 decididas (C, B, C, B); prioridade final, horário e canal do relatório e valores do teto seguem pendentes; ciclo continua em Refinamento | Decisão do dono de 12/10/2026, registrada na seção Decisões do dono | Julio |
| 2026-10-12 | N1 implementada: contrato do envelope, estado do arco, ingresso com prova de origem e recusas antes do efeito, com testes; ciclo passa a Em desenvolvimento; valores do teto, horário e canal do relatório seguem pendentes | Thread `ork-rm058n1`, testes E1 a E12 e A1 a A26 | Fábrica Orkastery em #Auto; Julio decide valores e piloto |
| 2026-10-12 | N2 implementada: contrato `v2` com trabalhos e capacidade, fila do arco, capacidade de sessões, fila de recursos pesados no `ork verify`, passo do arco pelo núcleo e os três aprendizados da madrugada, com testes; o modo segue desligado | Thread `ork-rm058n2`, testes E13 a E17, F1 a F10, C1 a C9, P1 a P9, V1 a V7, A27 a A31 e X1 a X8 | Fábrica Orkastery em #Auto; Julio decide valores e piloto |
| 2026-10-12 | N4 implementada: checkpoints da supervisão, condutor e vigia com prova de vida pelo kernel, reconciliação do que a N2 deixou no meio, retomada pelo passo do arco, rodízio dentro do envelope, pedido do limite de uso amarrado ao arco e efeito incerto reconciliado pelo remoto, com testes; o modo segue desligado | Thread `ork-rm058n4`, testes S1 a S12, R1 a R15, G1 a G8, F18 a F20 e X16 a X18 | Fábrica Orkastery em #Auto; Julio decide valores e piloto |
