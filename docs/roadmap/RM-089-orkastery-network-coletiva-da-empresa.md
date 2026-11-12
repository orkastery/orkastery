---
id: RM-089
tipo: roadmap
titulo: Orkastery Network coletiva da empresa, com uso obrigatório
categoria: iniciativa
pai: null
features: []
owner: Julio
atualizado_em: 2026-11-11T18:15:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Rascunho
  codigo: Branch criada
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 3673d07
    pr: 285
sdlc:
  thread: null
  modo: null
---

# RM-089 — Orkastery Network coletiva da empresa, com uso obrigatório

> **Em uma frase:** a empresa reúne as Orkastery Networks dos builders, agrega roadmaps por projeto, evita trabalho duplicado, ajuda nos merges na main e pode exigir o uso no Git.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

## Origem e pedidos do dono

Pedido feito pelo dono no terminal em 10/11/2026:

> "O que podemos criar no orkastery pra que empresas que querem tornar o uso do orkastery obrigatório tenham essa possibilidade de ativar essa trava? Nesse caso, travaríamos no próprio terminal/CLI do run time orquestrador ou travaríamos no Git? &#91;...&#93; como poderíamos criar travas/mecanismos que façam o uso do orkastery obrigatório quando essa for a diretriz da empresa?"

A condução propôs como base, e o dono aceitou, que a trava vinculante fique no Git e na forja e que o terminal seja o caminho fácil. Uma trava apenas local é contornável pelo uso direto do runtime ou pela remoção de um hook; o check obrigatório da forja alcança toda mudança destinada à branch protegida, inclusive a produzida na IDE com um copiloto.

Na segunda rodada, o dono separou a rede coletiva da telemetria:

> "Precisa ficar claro, estamos criando duas coisas diferentes, a primeira é o orkastery network coletivo, para empresas, que agrega os roadmaps organizados por projeto e garante que um builder não esteja criando o que outro já está criando, e ajuda nos merges na Main. a segunda grande evolução aqui é a telemetria compatível com otel (open telemetry e grafana), onde todos os prompts e dados de condução das threads/fases ork viram logs pra SDLC Analytics."

Esta página registra a primeira evolução. A segunda está na [RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md).

## Problema e resultado

- **Público e problema/oportunidade:** uma empresa com vários builders não tem hoje uma visão coletiva dos roadmaps e do trabalho em andamento. Dois builders podem reservar ou executar o mesmo item sem saber um do outro, e conflitos entre threads diferentes podem aparecer somente perto do merge. Quando a empresa adota o Orkastery como diretriz, também falta uma garantia na forja de que toda mudança passou por thread, claims, verify e CHECK.
- **Evidências e fonte:** a [RM-053](RM-053-orkastery-network.md) limita a rede às máquinas de uma pessoa e deixa a rede de equipe fora do escopo. [`core/src/ci.ts`](../../core/src/ci.ts) exige o bundle ausente com `ci.bundle.ausente` quando o nome da branch começa por `ork/`; uma branch externa ainda pode executar somente os comandos do manifesto.
- **Objetivo/OKR:** reunir os roadmaps e o trabalho em andamento das redes inscritas, impedir execução concorrente sem acordo sobre o mesmo item, antecipar conflitos de merge e permitir que a empresa observe, avise ou exija o recibo do Orkastery na fronteira da forja.
- **Hipótese:** se as redes pessoais publicarem roadmaps e trabalho em andamento numa rede coletiva, e se a regra vinculante morar no check obrigatório da organização, então a empresa detecta duplicidade e conflito cedo e aplica sua diretriz sem depender de hooks locais.
- **Métrica principal / linha de base / meta / janela / fonte:** duplicidades e conflitos identificados antes da execução ou do merge, com origem nas reservas, threads e arquivos declarados. Linha de base, meta e janela: **A definir pelo dono**. Nenhuma meta numérica é proposta nesta Discovery.
- **Métricas de proteção:** nenhum segredo ou credencial na rede coletiva; nenhuma segunda execução no item reservado sem colaboração ou autorização; nenhuma ordem de merge sugerida sem fonte; nenhuma exceção sem justificativa auditável.

### Relações com o roadmap

- A [RM-053](RM-053-orkastery-network.md) continua sendo a rede pessoal de cada builder; a RM-089 inscreve essas redes na rede coletiva e mantém as credenciais locais.
- A [RM-026](RM-026-workspace-empresarial.md) é a referência para o workspace empresarial e para a rede de equipe que a RM-053 deixou fora; a RM-089 especifica a coordenação dos roadmaps e do trabalho, sem reescrever a RM-026.
- A [RM-047](RM-047-fabrica-em-varias-maquinas.md) fornece reservas e trabalho distribuído; a RM-089 amplia a detecção para builders diferentes.
- A [RM-065](RM-065-gitlab-com-paridade-ao-github.md) exige comportamento equivalente da política e dos recibos no GitHub e no GitLab.
- A [RM-048](RM-048-hitl-humano-no-centro.md) fornece o contrato para pedir o acordo de quem reservou o item quando o segundo builder não entra como colaborador.
- A [RM-090](RM-090-telemetria-opentelemetry-para-sdlc-analytics.md) recebe a telemetria diretamente no coletor OpenTelemetry. Ela funciona sem a RM-089 para o builder sozinho; com a RM-089, a política da empresa distribui o endereço do coletor às redes inscritas.

## Escopo e validação

- **Incluído:** inscrição da rede pessoal na rede coletiva; identidade do maestro; sincronização dos roadmaps e do trabalho em andamento; detecção de duplicidade; ajuda na ordem dos merges; política `observar`, `avisar` e `exigir`; recibos básico e forte em qualquer branch; `ork adotar`; aviso no terminal; exceção auditável.
- **Fora de escopo:** telemetria, coletor central e SDLC Analytics, que ficam na RM-090; memória do OrkMind; transferência de credenciais; escolha ou hospedagem de backend de observabilidade; construção de código, teste ou workflow nesta thread de documentação.
- **Entregáveis e critérios de aceite:** cada fatia abaixo tem prova observável e mantém fonte, horário e lacunas declaradas.
- **Piloto, medição e critérios de expansão/interrupção:** **A definir pelo dono**. O piloto começa em `observar`, mede duplicidades e conflitos antecipados e só avança para `exigir` depois de provar os recibos e as exceções. A expansão é interrompida diante de segredo sincronizado, reserva contornada sem acordo, recibo aceito para outro HEAD ou exceção sem rastro.

### Rede coletiva da empresa

A empresa mantém uma rede coletiva e inscreve nela a Orkastery Network pessoal de cada builder, definida na RM-053. O contrato cobre:

- **Inscrição e identidade:** a inscrição registra a rede pessoal, a identidade do maestro, os projetos autorizados, a versão da política e um identificador revogável. O maestro vê o que a rede publica em nome dele.
- **Revogação e saída:** a empresa pode revogar a inscrição, e o maestro pode sair quando a política permitir. Novas sincronizações cessam, as credenciais continuam locais e o destino dos dados já recebidos segue a política declarada. Retenção, exclusão e portabilidade são **não confirmadas** até a decisão de governança da empresa.
- **Roadmaps por projeto:** sincroniza itens, reservas e estado, com a fonte de cada rede e as lacunas tipadas.
- **Trabalho em andamento:** sincroniza threads, fase atual e item do roadmap de cada thread. O conteúdo de segredo, as credenciais e os arquivos privados não entram.
- **Direção:** as redes pessoais publicam roadmaps e trabalho; a rede coletiva devolve conflitos, reservas e a versão da política. A empresa não escreve no ledger pessoal por este contrato.
- **Credenciais:** tokens de runtime, forja e coletor continuam locais, como na RM-053.

Ao abrir uma thread, a rede procura o mesmo item nos projetos e nas redes inscritas. Conforme a D1, ela informa quem já trabalha, em qual projeto e fase, e exige a reserva. O segundo builder entra como colaborador ou obtém o acordo de quem reservou.

A rede também cruza o item e os arquivos declarados pelas threads de builders diferentes. Conforme a D2, o conflito aparece antes do merge e a rede sugere a ordem dos merges com a origem da sugestão. Ela não executa o merge nem substitui o gate da forja.

A telemetria não passa pela rede coletiva. Os logs definidos na RM-090 saem da máquina do builder diretamente para o coletor OpenTelemetry configurado. A memória do OrkMind também não é sincronizada por esta página.

### Política empresarial e recibos

A política é versionada por repositório ou time e tem três níveis:

| Nível | Efeito no PR | Resultado verificável |
| --- | --- | --- |
| `observar` | Mede e publica o resultado sem bloquear | O relatório mostra presença, validade ou ausência do recibo |
| `avisar` | Comenta o que falta no PR sem reprovar o check | O comentário aponta `ork thread new` ou `ork adotar` |
| `exigir` | Reprova o check quando o recibo obrigatório está ausente ou inválido | A regra da organização impede o merge na branch protegida |

O arquivo da política tem dono definido por `CODEOWNERS`. A regra que torna o status check obrigatório pertence à organização na forja, fora da alteração comum do PR.

- O [GitHub documenta rulesets com status checks obrigatórios](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) e [aprovação por responsáveis no `CODEOWNERS`](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
- O GitLab documenta [branches protegidas](https://docs.gitlab.com/user/project/repository/branches/protected/), [`CODEOWNERS`](https://docs.gitlab.com/user/project/codeowners/) e [external status checks capazes de bloquear o merge](https://docs.gitlab.com/user/project/merge_requests/status_checks/).

O mecanismo administrativo exato e os tiers necessários para cada instalação GitLab serão validados na fatia de paridade; fora dessas fontes, ficam **não confirmados**.

No nível `exigir`, o nome da branch de origem não concede exceção. Todo PR destinado à branch protegida precisa de um recibo de thread:

- **Recibo básico:** referencia HEAD, thread, claims e rodada; o CI confere o SHA e executa novamente as claims e o verify da thread.
- **Recibo forte:** é assinado pela fábrica da empresa com chave mantida no cofre dela, nunca na máquina do builder. Contém HEAD, thread, tag, veredito e um CHECK independente produzido por conta nativa diferente da conta construtora. O CI confere assinatura, emissor e SHA antes de aceitar.

`ork adotar <branch>` incorpora em uma thread a branch criada fora da fábrica, preserva os commits, roda verify e CHECK independente e gera o recibo. O builder continua usando sua ferramenta; a forja exige a evidência, não a interface de edição.

O `ork adapter install` detecta uma sessão fora de thread, avisa e oferece `ork thread new` ou `ork adotar`. Em máquinas gerenciadas, o Claude Code permite [configurações gerenciadas com precedência administrativa](https://code.claude.com/docs/en/managed-settings). O Codex documenta [requisitos administrativos em `requirements.toml`](https://developers.openai.com/codex/config-reference), mas a equivalência completa é **não confirmada**; para os demais runtimes, a imposição central é **não confirmada**.

Um hotfix urgente pode usar uma exceção auditável autorizada pela política. A justificativa, o alcance, o responsável e o recibo dispensado entram no ledger; o responsável pela política recebe aviso; o relatório mostra a exceção. Quem autoriza, o prazo e a revisão posterior são **não confirmados** até decisão de governança da empresa.

## Fatias e critérios de aceite

| Ordem | Fatia | Critério de aceite verificável |
| --- | --- | --- |
| F1 | Inscrição e sincronização da rede coletiva | Duas redes pessoais inscritas publicam itens, reservas, estado, threads, fase e item por projeto; revogação e saída cessam novos envios sem transferir credenciais |
| F2 | Duplicidade e reserva obrigatória | Ao abrir trabalho já reservado, a rede identifica builder, projeto e fase; o segundo builder só prossegue como colaborador ou com o acordo registrado de quem reservou |
| F3 | Conflito antecipado e ordem dos merges | Threads de builders diferentes no mesmo item ou nos mesmos arquivos recebem aviso antes do merge e uma ordem sugerida com fonte; a rede não executa o merge |
| F4 | Política e `exigir` no `ork ci run`, com GitHub e GitLab | PRs de branches `ork/*` e externas produzem o mesmo resultado em cada nível; em `exigir`, recibo ausente, inválido ou de outro HEAD reprova o check obrigatório nas duas forjas |
| F5 | Recibo básico em qualquer branch | O CI reexecuta claims e verify da thread e aceita somente o recibo ligado ao HEAD do PR |
| F6 | `ork adotar`, aviso no terminal e exceção auditável | Uma branch externa entra em thread sem perder commits; a sessão fora de thread recebe as duas ações; a exceção autorizada aparece no ledger e no relatório, e a não autorizada não libera o merge |
| F7 | Recibo forte da fábrica da empresa | O CI aceita assinatura da fábrica para o mesmo SHA e rejeita chave, emissor ou SHA divergente; o recibo contém veredito e CHECK de conta diferente da construtora |

**Estado em 11/11/2026:** F4 está na `main` pelo PR #282, merge `4c196ae`; F1 está na `main` pelo PR #285, merge `3673d07`; F2 está em construção; F3, F5, F6 e F7 estão planejadas. O conjunto ainda não foi implantado e sai na 0.6.9.

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** Discovery e documentação despachadas em 10/11/2026 a pedido do dono; prioridade de construção a definir pelo dono.
- **Horizonte / alvo / previsão / confiança / marcos:** meta e piloto: **A definir pelo dono**. Marcos propostos são F1 a F7; não há previsão de implantação nesta Discovery.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-053, RM-026, RM-047, RM-065, RM-048 e RM-090; revisão de segurança e de governança antes do piloto; owner: Julio; próxima revisão no planejamento da primeira fatia.
- **Premissas / riscos / mitigação:** detalhados abaixo; capacidades não cobertas pelas fontes oficiais permanecem não confirmadas.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):** D1 e D2 foram decididas pelo dono no terminal em 10/11/2026; a antiga D4 foi respondida pelo esclarecimento da mesma data.

### Decisões do dono

#### D1 — Trabalho em duplicidade

Resposta do dono em 10/11/2026: `"1a 2a"`; para D1, foi escolhida a alternativa **A**.

- **A. Escolhida.** Ao abrir a thread, a rede avisa quem já faz o mesmo item, em qual projeto e fase, e exige a reserva. O segundo builder entra somente como colaborador ou com o acordo de quem reservou.
- **B.** A rede somente avisa, sem exigir reserva ou acordo.
- **C.** A rede bloqueia a segunda thread no item reservado, sem caminho de colaboração.

#### D2 — Ajuda nos merges na main

Resposta do dono em 10/11/2026: `"1a 2a"`; para D2, foi escolhida a alternativa **A**.

- **A. Escolhida.** O conflito entre threads de builders diferentes no mesmo item ou nos mesmos arquivos aparece cedo, e a rede sugere a ordem dos merges.
- **B.** A empresa mantém uma fila que ordena e executa os merges.
- **C.** A rede somente mostra, por projeto, o que vai entrar na main.

#### Antiga D4 — O que a rede da empresa sincroniza

Na primeira rodada, as alternativas eram: **A**, telemetria e recibos; **B**, telemetria, recibos, retratos e roadmap; **C**, tudo da alternativa B e memória do OrkMind. O esclarecimento do dono em 10/11/2026 substituiu essa divisão: a RM-089 sincroniza roadmaps e trabalho em andamento; a telemetria vai direto ao coletor pela RM-090; a memória do OrkMind fica fora. As fatias F1 a F3 seguem esse contrato.

#### Decisões registradas em 11/11/2026

- O dono ratificou os nomes públicos `ci.politica_recibo`, `ci.recibo.*` e `ork network empresa`.
- A condução decidiu, com reversão disponível ao dono, que no nível `exigir` a rede indisponível bloqueia uma nova reserva e uma nova thread. O critério é falhar fechada quando não há como conferir a coordenação coletiva exigida pela política.
- A condução decidiu que o acordo de colaboração é atestado pela forja. O critério é usar uma identidade conferível no mesmo limite em que a política protege o merge.

### Premissas e riscos

- **Segredo ou credencial na rede coletiva:** roadmap e trabalho podem conter texto indevido. Mitigação: schema de campos permitidos, saneamento antes da publicação, credenciais sempre locais e recusa da sincronização quando o conteúdo não passa pela política.
- **Reserva contornada:** um segundo builder pode tentar seguir sem colaboração. Mitigação: a reserva e o acordo entram no recibo e são conferidos no nível `exigir`.
- **Ordem de merge incorreta:** arquivos declarados podem estar incompletos ou mudar. Mitigação: mostrar fonte e HEAD da análise, recalcular antes do merge e tratar a ordem como sugestão, nunca como execução automática.
- **Resistência à trava:** bloqueio abrupto pode deslocar trabalho para fora do fluxo. Mitigação: adoção gradual por `observar` e `avisar`, orientação do adapter e `ork adotar`.
- **Contorno pela forja:** um PR pode tentar alterar política ou check. Mitigação: regra da organização, status check obrigatório e `CODEOWNERS` fora da aprovação do autor; detalhes dependentes do plano da forja ficam **não confirmados** até o piloto.

## Fontes oficiais

- GitHub: [rulesets e status checks obrigatórios](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) e [`CODEOWNERS`](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
- GitLab: [branches protegidas](https://docs.gitlab.com/user/project/repository/branches/protected/), [external status checks](https://docs.gitlab.com/user/project/merge_requests/status_checks/) e [`CODEOWNERS`](https://docs.gitlab.com/user/project/codeowners/).
- Runtimes: [configurações gerenciadas do Claude Code](https://code.claude.com/docs/en/managed-settings) e [referência de configuração do Codex](https://developers.openai.com/codex/config-reference).

## Estado com evidências

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-11-11 | Julio |
| Documentação | Rascunho | — | 2026-11-11 | Julio |
| Código | Branch criada | commit `3673d07` · PR #285 | 2026-11-11 | Julio |
| Testes | Em execução | — | 2026-11-11 | Julio |
| Deploy | Não implantado | — | 2026-11-11 | Julio |
| Exposição | Flag desligada | — | 2026-11-11 | Julio |
| Habilitação | Pendente | — | 2026-11-11 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: equipe Orkastery; A: Julio; C: segurança, administradores das forjas e builders inscritos; I: times da empresa.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** a sessão GO separou as duas evoluções em modo `#Fast`; o dono decidiu D1 e D2 e esclareceu o conjunto sincronizado; revisão humana ocorrerá na condução e no planejamento da construção.
- **Próxima ação, responsável e prazo:** dono define a prioridade de construção e o piloto; prazo a definir pelo dono.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-11-10 | RM-089 aberta em Discovery com política empresarial, rede coletiva e telemetria na mesma página | Pedidos do dono no terminal e fontes oficiais da primeira rodada | Dono definiu o problema; sessão GO organizou a proposta |
| 2026-11-10 | Telemetria saiu para a RM-090; RM-089 ficou com a rede coletiva, a prevenção de duplicidade, a ajuda nos merges e a trava no Git; D1 e D2 foram decididas | Esclarecimento do dono e respostas `"1a 2a"` no terminal | Julio |
| 2026-11-11 | Estado atualizado para Em desenvolvimento: F4 e F1 estão na `main`, F2 está em construção e as demais fatias estão planejadas; nomes públicos ratificados e decisões de indisponibilidade e atestado registradas | PR #282, merge `4c196ae`; PR #285, merge `3673d07`; decisões de 11/11/2026 | Julio nos nomes; condução nas decisões reversíveis |
