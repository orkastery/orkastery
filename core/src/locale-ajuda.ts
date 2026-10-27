/**
 * RM-061, fatia F2a: a ajuda do CLI (`ork`, `ork --help`, `ork help`, `ork <comando> --help` e o comando
 * desconhecido). O pt-BR e o texto de antes, movido sem mudar um byte (o `docs verificar` e a paridade do
 * `docs/referencia/cli.md` leem esta versao); o ingles tem as mesmas linhas de comando e as mesmas flags,
 * na mesma ordem, com a descricao e os nomes de argumento (`<name>`, `<path>`) traduzidos (D10).
 */

/** O que a ajuda interpola, montado por quem a imprime (o catalogo nao importa o nucleo). */
export interface DadosDaAjuda {
  versao: string;
  /** Quantos modos de conducao vivos ha. */
  modos: number;
  /** Onde ficam os segredos, na lingua da ajuda. */
  segredos: string;
  /** As #TAG dos modos vivos, separadas por espaco. */
  tags: string;
}

export const AJUDA_PT_BR = {
  comandoDesconhecido: (comando: string) => `comando desconhecido: ${comando}`,
  texto: (v: DadosDaAjuda) => `ork ${v.versao}, nucleo de orquestracao do Orkastery

Uso: ork [--projeto <nome|caminho>] <comando> [argumentos]

  --projeto <nome|caminho>                  Projeto-alvo de qualquer comando (RM-052): vence ORK_PROJETO, que vence o
                                            diretorio atual; nome ambiguo ou desconhecido recusa com os candidatos (saida 4)
  projetos [--json]                         Projetos conhecidos desta maquina (~/.orkastery/projetos.json)
  projetos registrar [caminho]              Registra a copia (init, thread new e fabrica entrar ja registram)
  projetos esquecer <nome|caminho>          Tira do registro a copia que sumiu ou sobrou (nada no disco e apagado)

  doctor                                    O que vale nesta maquina agora (sai != 0 se bloqueado)
  init [--force] [--name N] [--abbrev A]    Gera o orkastery.yaml do repositorio
  modos                                     Tabela dos ${v.modos} modos de conducao vivos por #TAG

  setup                                     Pauta da entrevista #setup: runtime/modelo/esforco
                                            por bloco de cada modo (default claude-bg/opus/high; #Fast: sonnet)
  onboarding [show|set <etapa>|reset [etapa]] Pauta e respostas do projeto (9 etapas)
        [--conteudo JSON] [--por Q] [--json]  Segredos ficam ${v.segredos}
        [--reset [etapa]]                    Reset seletivo ou total, idempotente
  onboarding sync [--json]                  Publicação opcional na memória, com degradação
  experiencia show [--json]                 Preferências efetivas; configure por onboarding set maestro --conteudo '{"owner":{"experience":true}}'
  experiencia uninstall <host> [--dry-run] [--json]
                                            Remove o bloco de Claude Code/Codex; sem --dry-run aplica a remoção
  setup <modo>                              Config atual de cada bloco do modo
  setup <modo> --bloco N [--runtime R]      Edita o bloco (runtimes: claude-bg, codex, grok);
        [--model M] [--effort E] [--por Q]       evento setup_configured no ledger do projeto
        [--fallback R:M[:E],...]                  ordem de fallback de runtime do bloco (I-33)
  accounts list [--json]                    Perfis de conta por runtime, sem segredo (I-33)
  accounts add <id> --runtime R --dir D     Cria o perfil e roda o login do proprio CLI com o env
        [--sem-login] [--device-auth]            do perfil (nunca copia credencial; codigo de dispositivo so no grok)
  accounts remove <id>                      Desativa o perfil (diretorio e login ficam onde estao)
  accounts check [<id>]                     Confere o login de cada perfil e marca o store
  accounts esgotamentos [--desde 7d] [--json]
                                            Despachos numa conta que outro projeto desta maquina viu esgotada
                                            (RM-040), so leitura: conta opaca, perfil pelo id, sem diretorio
  setup [<modo>] --reset                    Volta o modo (ou tudo) ao default
  setup sandbox [confirmar <postura>|revogar]  Postura de sandbox desta maquina (RM-047): runtime.sandbox que afrouxa
                                            (danger-full-access) so despacha com a confirmacao local, fora do git
  setup worktree [confirmar [<dir>]|revogar]  Pasta das worktrees desta maquina (RM-047): worktree.dir fora da raiz
                                            so cria checkout com a confirmacao local, fora do git
  setup versionar                           Leva o setup que vale para orkastery.setup.json: por PR, vale em
                                            todas as maquinas e passa a ser o arquivo editado (I-52)

  thread new <nome> --modo <MODO>           Cria a thread, o slug de 3 partes e o ledger
        [--exige-runtime-diferente]              o CHECK precisa de runtime que o GO nao usou
        [--done "<criterio> :: <comando>"]       criterio de pronto EXECUTAVEL (use ;; para varios)
        [--slug S] [--assunto A] [--worktree auto|DIR] [--dry-run]
        [--sem-worktree]                         cria sem worktree (na branch base, o ship barra a entrega com
                                                 push_direto_na_base: block, o padrão do ork init); com
                                                 worktree.por_thread: true, a worktree nasce sem flag
        [--roadmap RM-NNN]                       reserva o item do roadmap antes de criar (I-47)
        [--pedido "<texto>"]                     guarda o pedido do builder (pedido.md, com sha256): o
                                                 prompt render usa quando falta --pedido (RM-059)
  thread list [--todas] [--json]            Threads NAO fechadas do projeto (--todas inclui as fechadas)
  thread close <id> --motivo orfa|engano|superada --por Q --justificativa J
  thread entrega <id> --arquivo A --sha256 H --por Q
  thread status <thread-id> [--json]        Estado da thread, cruzado com o runtime

  portfolio inspect <id> --json              Entidade, origem e ciclos com lacunas explícitas
  creation start --input-file F --json       Criação durável com identidade do processo local
  creation show|list|events [id] --json       Consulta journal e recuperação
  creation resume|compensate <id> --expected-version N --json
  portfolio create <product|project|initiative> <id> --title T [--parent ID]
  portfolio list [product|project|initiative] [--parent ID] [--json]
  portfolio show <id> [--json]              Catálogo prod -> proj -> init
  objective ...                             Aposentado na I-43: as duas vigas viraram
                                            --exige-runtime-diferente e --done de thread

  phase run <thread-id> <FASE> --prompt "<texto>"
        [--runtime R] [--model M]           Despacha a fase como background agent
        [--effort E] [--dry-run]                 (runtime: CLI > setup do bloco > manifesto;
                                             so --model assume --effort high; o trio
                                             efetivo vai ao ledger como fato verificavel)
        [--canal C] [--correlacao ID]        Canal de origem (sem ele, o que o host declara)
        [--esperar [min]]                    Com a thread ja conduzida, espera a vez (sem: recusa na hora)
        [--perfil ID]                        Conta do despacho (ork accounts list); inexistente, de outro
                                             runtime, esgotado ou sem login recusa com motivo tipado
  phase list <thread-id>                    Historico do ledger da thread
                                            (mostra o modelo/esforco reais de cada fase)
  ledger stats --desde 7d [--ate ISO]       Telemetria economica do ledger (intervalo [desde,ate))
        [--thread T] [--modo M] [--runtime R] [--json]
  ledger estimate <thread-id> --sem-ia H --ia-sem-ork H --por Q --metodo M --premissas P
        [--incerteza I]                     Registra estimativas explicitas da fase PLAN

  sessions [--all] [--global] [--json]      Inventário Claude e Codex da conta do processo e de cada perfil
        [--exigir-limpo]                    Sai != 0 com fonte inválida ou sessão sem thread
  sessions adopt <id> [--json]             Adota identidade real sem executar prompt
  sessions event --tipo T --sessao ID       Ingere JSON limitado no stdin; observa sem aprovar gates
  sessions watch --thread T [--sessao ID]   Observa somente a sessão selecionada; --once faz uma varredura
  sessions limpar-fantasmas [--dry-run]     Solta do ork (sessao_morta no ledger) a sessao sem pid e sem processo;
        [--json]                             nunca toca no runtime (RM-056)
  sessions logs <sessao> [--linhas N]       Logs de uma sessao
  sessions supersede <thread> <UUID> --fase F --runtime R  Confirma encerramento de sessão superada
  sessions request <thread> <UUID> --fase F --runtime R --pergunta P  Abre pedido vinculado ao prompt nativo
  sessions answer <thread> <pedido> --stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]  Confirma entrega autenticada
  sessions reconcile <thread> <pedido>      Fecha envio pendente so com thread e pedido; consulta recibo, nunca reenvia
  sessions stop <sessao>                    Para uma sessao
  sessions attach <sessao>                  Imprime o comando de attach (precisa de TTY)
  pulse [--json] [--registrar]             Fila unificada de atenção humana e retry de órfãs
  pulse responder --resposta-stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]
                                            Recebe o que o dono digitou no canal do resumo (P4EJ a, 1a 2c)
        [--em-resposta-a <codigo>:<id>]     o código da pergunta e o id da mensagem respondida (reply)
        [--em-resposta-a outra]             a palavra solta em reply a outra mensagem: recusada, com o porquê
  pulse cadencia [<tag>] [--por P] [--json] Mostra ou troca a cadencia do resumo: OrkPulseOn, OrkPulseOn-15m,
                                            -30m, -60m ou OrkPulseOff; pergunta nova sai na hora (I-50)
  sessions hitl [--json] [--so-paradas]     Radar de sessoes que exigem acao humana AGORA:
        [--atencao N] [--sem-logs]              classifica o estado de cada sessao do runtime,
        [--so-da-raiz] [--exigir-limpo]         le a pergunta que a sessao trava e diz o que
                                                destrava (pega HITL de sessao SEM thread)
  noctum propor --arquivo <envelope.json>   Propõe o envelope de um arco #Noctum (RM-058) e pergunta ao dono, com código
                                            curto e alternativas, também no canal dele; não autoriza nada
  noctum revogar <arco> [--json]            Pergunta ao dono se revoga o arco (RM-057); quem revoga é a resposta dele,
                                            no Telegram ou pelo diálogo do host
  noctum responder <arco> --resposta-stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]
                                            Recebe a autorização ou a revogação assinada pelo gateway
  noctum terminal --hook-stdin              O ingresso do terminal (RM-057), desligado: o hook UserPromptSubmit entrega
                                            o que o dono digitou, e o núcleo só diz por onde responder; nada grava
  noctum status [<arco>] [--json]           Retrato do arco: situação, consumo medido, fila, fechamento e lacunas
  noctum tique <arco> [--json]              Fechamento, vigia e relatório do arco, nessa ordem (o cron do dono chama);
                                            o vigia reconcilia e, sem condutor vivo, dá o passo do despacho e o da entrega
  noctum relatorio <arco> [--json]          O relatório da manhã no terminal (recibo só em terminal interativo)
        [--reenviar telegram|openclaw]          reenvia as páginas sem recibo, inclusive a de envio incerto
  noctum conduzir <arco> [--json]           O condutor do arco, que o cron do piloto relança: sai 0 com o arco terminado
                                            ou parado, 2 em recusa, 3 com outro condutor vivo, 4 com a geração perdida
  noctum aceite <arco> [--json]             O aceite do piloto: as medidas M1 a M10, os critérios e o veredito; sai 0 só
                                            com aprovado, e a evidência simulada (o ensaio) nunca aprova
        [--injecoes <arquivo>]                  a agenda das falhas injetadas, que M4 e M5 medem
        [--limiares <arquivo>]                  os limiares do dono; o que faltar fica com a proposta, marcada
        [--publicar <arquivo>]                  grava a versão publicável, sem dado pessoal

  claims add <thread-id> <arquivo> --claim "<alegacao>" [--verificar "<comando>"] [--fase F]
                                            Registra alegacao verificavel da thread
  claims list <thread-id>                   Claims da thread e o estado de cada uma
  claims conferir <thread-id> --claims C1,C2|--tarefa T1 [--prazo S] [--json]
                                            Reexecuta so essas claims, ou o verify da tarefa do plano, no
                                            sandbox do verify, sem gravar recibo (RM-059); sai 3 se outra
                                            sessao conduz e 2 sem sandbox
  decisao registrar <thread-id> --decidido D --porque P --como-mudar C --custo-agora A --custo-depois B
        --criterio manifesto:CHAVE|ledger:REF|medicao:COMANDO --quem Q --evidencia E [--razao R] [--reverte ID]
                                            Decisao tomada sem perguntar: chega ao dono no resumo
  decisao placar <thread-id> [--json]       Decididas contra perguntas por fase, reversoes e o limiar
  claims verificar <thread-id> <claim-id> --comando "<comando>"
                                            Anexa o comando que comprova uma claim ja feita
  claims retirar <thread-id> <claim-id> --motivo "<motivo>"
                                            Retira a alegacao (o historico fica no claims.jsonl)
  claims ausente <thread-id> --paths A,B --motivo "<motivo>" [--commit SHA]
                                            Ciclo sem CHECK: declara no ledger o que ficou sem prova
  verify <thread-id> [--baseline]           Reexecuta claims e verify do manifesto no HEAD real
        [--so-claims]                       --baseline grava o estado do mundo antes do GO
        [--canal C] [--esperar [min]]       So executa com a conducao da thread (sai 3 se outra conduz)
  ci prepare <thread-id>                    Exporta claims/comandos para a candidata (.ork-ci/<thread>.json)
  ci run [<thread-id>] [--bundle ARQ]       Executa o CHECK no runner independente
        [--branch B]                         acha o bundle da thread pelo nome da branch (o CI usa)
  ci status [--sha SHA] [--remoto origin]   Consulta o check exato publicado no GitHub
  privado varrer [--base REF] [--json]      Dado privado (home, e-mail fora da lista, hostname de maquina e a lista
                                            local fora do git) nas linhas e nomes versionados; --base: so o diff (RM-062)

  gate next <thread-id> [--proximo FASE]    Gate de tokens: mesma sessao ou nova sessao
        [--ocupacao 0..1] [--fonte F] [--transcript ARQ] [--janela N] [--refazer]
  gate request <thread-id> [--motivo M]     Apresenta pedido HITL correlacionado à pausa
        [--formato telegram|terminal]           no contrato curto, com o codigo estavel para responder
  gate answer <thread-id> <pedido>          Recebe envelope do ingresso humano autenticado
        --resposta-stdin --por Q --mensagem ID --origem telegram [--canal hermes|openclaw]
        [--conta ID]  conta homologada do canal; obrigatoria no canal openclaw
  gate approve                             Aposentado: aprovação sem pedido é recusada

  retry policy [--motivo M] [--json]        Politica de retry por motivo tipado de gate
  retry plan <thread-id> [--motivo M]       O que o ork faria pelo ultimo gate reprovado
        [--fase F] [--json]                      (calcula, nao executa, nao gasta tentativa)
  retry run <thread-id> [--reverify]        Executa a acao tipada do ultimo gate reprovado
        [--por Q] [--dry-run]                    (--por autoriza quando o bloco do modo pausa)
  retry list [--json]                       Fila DURAVEL de rate limit do projeto
  retry resume [--id R1] [--agora ISO]      Retoma a fase morta por rate limit na janela seguinte
        [--ocupacao 0..1] [--forcar] [--dry-run] (playbooks: mesma-sessao, nova-sessao, escalada)
  retry cancel <id> --motivo M              Tira um pedido da fila, com motivo registrado
  retry parse --stderr "<texto>"            Le o horario de reset do stderr do adapter

  fix open <thread-id> [--so-claims]        GO-FIX: deriva a spec exata do CHECK reprovado
        [--reverify] [--json]                    (uma correcao por motivo tipado, tipo A ou B)
  fix list <thread-id> [--rodada N]         Correcoes da rodada e o veredito de cada uma
  fix reverify <thread-id> [--rodada N]     CHECK-REVERIFY com veredito POR correcao
        [--parcial] [--json]                     (--parcial e RECUSADO se houver tipo B)

  handoff export <thread-id>                Handoff triado CRITICO/IMPORTANTE/RESUMIVEL
        [--proxima-fase FASE] [--slug S]
  handoff recall <thread-id> <ponteiro>     Resolve um ponteiro path#ancora de volta ao conteudo

  recall <thread-id> --fase FASE            Recuperacao TARDIA: resolve so os ponteiros do
        [--id ptr-N] [--todos] [--forcar]        momento (retrieve_when), nunca a janela inteira
        [--sem-conteudo] [--json]                (orkmind por tag, files por path#ancora)

  brain status|inventory|get|query|receipts|context|dossie|sync|reconcile|apply|rollback|bind
  brain dossie --thread T [--decisao ID]    Dossie de decisao: vinculo, contexto citavel, alternativas,
                                            quem decidiu e evidencia, com os ids do Brain (so leitura)
  conhecimento listar [--colecao C] [--json]  Documentos validos da pasta conhecimento.dir (RM-026 K7), com versao e lacunas
  conhecimento mostrar <doc-id> [--json]    O documento com corpo, versao, fonte e referencias conferidas (Brain por get)
  conhecimento colecoes [--json]            As colecoes e os documentos de cada uma
  conhecimento verificar [--json]           Confere a pasta inteira, ids do Brain por get; sai != 0 com lacuna
  memory status [--json] [--sondar]         Regime efetivo (files|orkmind), tenant, degradacao e embeddings
                                            (--sondar: uma chamada real de embedding, com a latencia)
  memory sync [<thread-id>] [--json]        Publica decisoes, policies, handoff, licao e roadmap
  memory inventory --escopo <threads> [--json]                 Inventaria fontes canonicas e tenants excluidos, sem gravar
  memory migrate --operadora <thread> --escopo <threads> [--dry-run] [--json]                   Migra handoffs por G3, com pacote integral e readback
  memory search --tags '<json>' [--colecao C]  Busca deterministica por tag (mandatory sempre volta)
        [--thread ID] [--restrito] [--janela N] [--limite N] [--json]
  memory search --texto "<frase>"          Busca por significado (I-38): vetor + FTS por RRF no tenant,
        [--modo hibrido|vetor|fts]               NAO deterministica; nao combina com --tags nem --thread
        [--colecao C] [--limite N] [--json]
  memory index [--modelo primario|fallback|todos] Indice vetorial local do tenant (I-38), idempotente,
        [--dry-run] [--json]                     com tokens e custo estimados; --dry-run nao chama o provider

  grafo indexar [--verificar] [--forcar]    Indice do grafo de codigo do HEAD limpo (RM-031 KG3) no estado do projeto:
        [--json]                                 pastas 0700, chave por revisao e extrator, idempotente; incremental (KG4)
                                                 a partir do indice ancestral, ou completo com o motivo; --forcar extrai
                                                 completo; --verificar confere contrato, bytes, determinismo e o incremental
                                                 contra a completa; precisa de typescript e micromark
  grafo status [--json]                     Indices guardados, o do HEAD, os analisadores e o tamanho
  grafo contexto <thread> [--json]          Pacote da thread com evidencias e medida em bytes [--teto-bytes N]
  grafo vizinhos <no> [--profundidade N]    Vizinhanca de arquivo ou simbolo, com extrator e evidencia de cada aresta
        [--sentido entrada|saida|ambos] [--tipo T,...] [--limite N] [--json]
  grafo chamadores <simbolo>                Quem chama (arestas calls que chegam) [--profundidade N] [--limite N] [--json]
  grafo importadores <arquivo|simbolo>      Quem importa (arestas imports que chegam) [--profundidade N] [--limite N] [--json]
  grafo caminho <de> <para>                 Menor caminho pelas arestas [--sentido saida|entrada|ambos] [--tipo T,...] [--json]
        [--json --teto-bytes N]                  Nas quatro consultas (KG5): JSON compacto de no maximo N bytes; as arestas mais
                                                 longe do alvo saem ate caber, e o caminho que nao cabe recusa
  grafo amostra [--por-estrato N]           Amostra de arestas para auditoria manual; --conferir ARQ confere a auditada
  grafo limpar [--tudo] [--json]            Apaga os indices que nao sao do HEAD e as sobras com mais de uma hora

  security-scan [--base <ref>] [--json]     Varredura de seguranca do HEAD contra a base: relatorio por SHA em
                                            .orkastery/security-scan/<sha>/; sai 1 com achado novo no laco
  ship <thread-id> --para <branch>          Merge --no-ff serializado por lease e push PROVADO
  ship registrar-pr <thread-id>|--todas    A entrega feita por PR vira ship_done: merge ship(<thread>) na base
        [--remoto R] [--json]                    remota e CI verde no head do PR; depois, ork master <thread> --aceitar-omissao
        [--repo <dono/nome> --pr <n>]            PR mesclado em repositorio externo de ci.external_repositories
        [--dry-run]                              Ensaio: as mesmas conferencias, sem gravar ship_done, fase nem fabrica
        [--de <branch>] [--remoto origin] [--autorizar-push <quem>] [--allow-unscanned <quem>] [--sem-push] [--dry-run]
  ship publicar <thread-id>                 Publica a branch e abre o PR com prova (ls-remote), so em #Auto e #Maestro
        [--dry-run] [--remoto R] [--json]        Ensaio confere tudo sem publicar; repetido, nao abre outro PR
  ship pista [<thread-id>] [--json]         Etapas da entrega, do CHECK ao ship_done, e o proximo passo do nucleo

  board [--all] [--sem-remoto]              Visao unica das threads (todos os perfis com --all); com a
                                            fabrica compartilhada, tambem as outras maquinas (I-51)
  board plan                                Escalonador: quem avanca agora, quem espera e por que

  orquestracao status [--all] [--json]      Monitor PROATIVO de pausas e impedimentos: quem esta
        [--atencao N] [--so-paradas]             parado, esperando o que, ha quanto tempo e o que
        [--sem-runtime] [--exigir-limpo]         destrava (alias curto: ork monitor)

  worktree ensure <thread-id>               Garante a worktree da thread (base resolvida pelo ork)
  worktree sync <thread-id> [--dry-run]     Rebasa a branch da thread quando a base avancou
  worktree audit <thread-id>                Confere a worktree no proprio git (sai != 0 se divergir)
  worktree release <thread-id> [--forcar]   Remove a worktree e limpa o registro

  activation plan|status|enable|disable     Escrita escopada com aceite, hash, leases e recibo
  lease list                                Leases, familias e as filas (merge e colisao de regiao)
  lease acquire <nome> --thread T --motivo M   Toma um lease tipado (entra na fila se colidir)
  lease release <nome> [--thread T] [--forcar]
  conducao status <thread-id> [--json]      Quem conduz a thread agora (canal, sessao, fase, desde)
  conducao assumir <thread-id> --por Q --motivo M
                                            Handoff: encerra a conducao atual pelo runtime e registra quem assumiu
  conducao sentinela status|bater|desligar [--sessao S] [--json]
                                            Sentinela do Condutor: presenca nesta maquina e o passo de cada thread
  conducao autorizar --ate D --pode A[,B] [--por Q] [--nota N]
                                            Grava a autorizacao duravel do dono nesta maquina (fora do git)
  conducao autorizacao [--json]             A autorizacao duravel vigente nesta maquina, ou por que ela nao vale
  conducao batida [--entregar] [--json]     Avanca as threads dentro da autorizacao: merge, registro, MASTER, despacho
  conducao atualizar <thread-id> [--enviar] Merge da base na branch da thread, com o CHANGELOG reconciliado

  master propor <id> --score N --justificativa J --por <agente>
  master batch --aceitar <thread:assinatura,...> --por <humano>
  master migrar --dry-run --por Q           Inspeciona correções sem alterar originais
  master digest <enviar|preview|responder>  Digest semanal com recibos do host
  master <thread-id> --score 0-5 --justificativa "<texto>" --por <seu-nome>
        [--classe C[,C]] [--resumo R] [--refazer]
                                            Fecha a thread: POSTMORTEM + MASTER log + score (so do terminal;
                                            de processo de host e recusado com master.prova-de-canal)
  master pedir <thread-id> [--formato telegram|terminal|json]
                                            Pede a nota ao dono com codigo curto; ele responde pelo Telegram
                                            (<codigo> <0 a 5> <porque>) e a nota vai ao ledger com o recibo (RM-048)
  master [--todas] [--json]                 As entregas, com o indice derivado do ledger
  master <thread-id> --aceitar-omissao      Aceita por omissao SO a entrega desta thread, com registro (ou --thread T)
        [--dry-run] [--json]                     --dry-run lista o que seria fechado, sem gravar
  master --aceitar-omissao [--dry-run] [--json]
                                            Aceita TODAS as entregues por omissao, listando cada uma
                                            (de processo de agente com mais de uma, avisa em stderr)
  master classes                            As classes de falha fixas do POSTMORTEM
  licoes [--json]                           O que volta no GOAL e no PLAN da proxima thread (POSTMORTEM e
                                            MASTER) e as propostas de policy por recorrencia (I-55)

  demo [--manter] [--dir D]                 A promessa em 30 s: uma afirmacao falsa reprovada e a corrigida aceita,
                                            offline, num repositorio temporario (I-56)
  ciclos                                    Variantes de ciclo de "ork thread new --ciclo"
  modos --do-pedido "<texto>" [--json]      Le a #TAG do pedido do builder (usado pelos adaptadores)
  modos migrar [--dry-run] [--por Q]        Tira modo aposentado do orkastery.yaml e do setup.json
        [--json]                             (idempotente, com backup; nao toca em historico)

  prompt list                               Templates de prompt (embutidos e os do projeto)
  prompt lint [--template ID]               Reprova template quebrado antes de ele virar despacho
  prompt render <thread-id> --fase F        Mostra o prompt exato, com o sha256 que vai ao ledger
        [--pedido "<texto>"] [--template ID]     sem --pedido, o guardado na criacao da thread (RM-059)
  prompt render --exemplo --fase F --modo M Renderiza sem thread nenhuma, para revisar o texto

  roadmap status [--json]                   Status report unico do roadmap: grupos com icones, #HITL no que espera
                                            voce e o fecho com o que precisa de voce e o que vem a seguir (RM-048)
  roadmap reservas [--json] [--remoto R]    Quem esta com cada item do roadmap, lido da branch ork/roadmap-reservas
        [--soltar-orfas]                     marca a reserva de thread ja fechada (orfa) e, com a opcao, solta
                                             ou passa para outra thread aberta do mesmo item, com registro
  roadmap pegar <RM-NNN> [--thread T]       Reserva o item para esta maquina (push atomico: o primeiro vence)
        [--nota N] [--por Q] [--maquina M]       maquina = --maquina, ORK_MAQUINA ou o hostname
        [--forcar --motivo M]                    tomar a reserva de outra maquina fica registrado
  roadmap soltar <RM-NNN> [--forcar --motivo M]  Devolve o item
  roadmap feat [--thread T] [--nota N]      Reserva o proximo numero de FEAT na mesma branch (push atomico: duas
                                            maquinas nunca levam o mesmo numero; numero reservado nao volta)
  fabrica [--json] [--sem-remoto]           O que cada maquina conduz, lido da branch ork/fabrica-estado (I-51)
  fabrica entrar [--maquina NOME]           Esta maquina entra na fabrica compartilhada deste usuario, com
                                            este nome (~/.orkastery/maquina.json), e publica o primeiro retrato
  fabrica publicar [--forcar] [--json]      Grava o retrato desta maquina na branch (push atomico, sem forca);
                                            depois de entrar, sai sozinho ao criar thread, despachar fase,
                                            entregar e fechar, e a cada batida do pulse
  fabrica sair                              Para de publicar daqui e tira o retrato desta maquina da branch
  fabrica batida [status|instalar|remover]  A batida da varredura do pulse no crontab desta maquina (RM-063): instalar
        [--por Q] [--json]                       poe a linha do monitor/pulse.cron (idempotente), remover tira so ela;
                                                 status diz a linha e a ultima rodada do hitl.log
  network status [--json] [--sem-remoto]    A Orkastery Network desta pessoa: as maquinas, de qualquer diretorio,
                                            com a fonte, as lacunas e o que nao foi lido (RM-053)
  network entrar [--maquina NOME]           Esta maquina entra na rede: repositorio privado <usuario>/orkastery-network
        [--forja github|gitlab] [--repositorio [DONO/]NOME]  na forja (criado se falta) e o primeiro retrato;
        [--forcar]                               --forcar toma um nome que outra instalacao usa (fica no commit)
  network publicar [--forcar] [--json]      Grava o retrato desta maquina na casa da rede (push sem forca); depois de
                                            entrar, sai sozinho na batida do pulse e nos eventos de thread
  network sair                              Para de publicar daqui e tira o retrato desta maquina da casa
  network roadmap [--projeto P] [--json]    Roadmap, reservas e threads de cada maquina de cada projeto, de qualquer diretorio:
        [--sem-remoto]                           fonte e hora de cada parte, lacuna tipada no que nao leu. P = caminho do clone,
                                                 github:dono/repo, gitlab:grupo/repo ou nome conhecido; sem clone, le a forja (RM-054)
  docs verificar [--json] [--pr]            Documentacao de produto e roadmap contra o codigo e o git; no PR (--pr),
                                            o merge de outra thread e o indice que divergem da main so avisam
                                            (padrao do dono: frontmatter, leitura, paridade; sai != 0 com erro)
  docs sincronizar [--escrever]             Fatos do ledger e do git para o roadmap (merge, fase) e indices;
                                            sem --escrever so mostra; nunca muda status por passagem de tempo
        [--so RM-NNN[,RM-MMM]] [--todos]     so esses itens (e os indices); na worktree de uma thread com item,
                                             o padrao e o item dela; --todos volta a todo item (RM-037)
  docs init                                 Cria padroes, modelos, indices e o lint de Markdown no projeto

  mcp serve --project RAIZ --host HOST       Servidor MCP stdio deste projeto (codex|claude-code; grok so na sessao filha, com --thread)
  mcp install --project RAIZ --host HOST     Prepara MCP; aceita --dry-run, --ship-transport, --child-permissions e --owner-permissions (Codex)

  adapter list                              Adaptadores de host (Camada 1) e o destino de cada um
  adapter show <host>                       Os 3 pitfalls de instalacao do host
  adapter install <host> [--dir D]          Instala o adaptador (claude-code|codex|hermes|openclaw)
        [--dry-run] [--force]                    divergencia segura resolve sozinha; o resto pergunta
        [--aceitar-catalogo <arquivo>]           sobrescreve a copia com o catalogo, arquivo a arquivo
        [--manter-copia <arquivo>]               deixa a copia como esta, arquivo a arquivo

  eval [--skill S] [--canario C]            Canarios de comportamento + corpus das skills finas
        [--so-canarios] [--so-skills] [--json]   (sai != 0 em qualquer falha)

  audit packs [--estagio E] [--pack P]      Os 7 packs, o estagio que os ativa e a postura
  audit run <pack> [--profile P]            Monta o prompt do pack e despacha pelo runtime adapter
        [--since Nd] [--tudo] [--effort E] [--model M] [--agora "<quem>"] [--forcar] [--dry-run]
  audit list                                Rodadas de auditoria do projeto
  audit show <rodada> [--ledger]            Contexto, achados e propostas de uma rodada
  audit prompt <pack> [--since Nd]          O prompt exato do pack, com o sha256 que vai ao ledger
  audit lint                                Reprova template de auditoria quebrado (auditors/)
  audit ingest <rodada> --arquivo J         Registra em lote os achados que o auditor escreveu
  audit finding add <rodada> --regra R      Registra um achado com evidencia, claim e proposta
        --titulo T --arquivo caminho:linha --impacto I --fix F --estimativa E
        [--severidade critico|maior|menor] [--irreversivel "<passo>"] [--verificar "<comando>"]
  audit verify <rodada>                     Reexecuta as claims dos achados (auditor sem self-report)
  audit report <rodada> [--publicar]        Relatorio com o bloco OBRIGATORIO de propostas
  audit divida [--pack P] [--todos]         Board de divida: propostas abertas e recorrencia
  audit surface [<dir>] [--regra SPn]       Varredura DETERMINISTICA da superficie de ataque de rede
        [--limite N] [--json]                    (SP8..SP12; sai != 0 quando ha achado)
  audit surface --registrar <rodada>        Grava os achados da varredura no board da rodada
  audit finding estado <id> <estado>        Carimba o achado (aberto|adiado|resolvido|descartado)

  thread new <nome> --from-finding <ID>     Abre a thread a partir de um achado de auditoria
        [--modo M] [--worktree auto] [--sem-worktree] [--dry-run]
                                                 (evidencia, claim e proposta viajam junto; a worktree segue
                                                 worktree.por_thread como no thread new)

Regimes de memoria: files (fallback honesto) e orkmind (bloco B6, base propria por tenant
declarada em memory.database_url_file, arquivo 0600 em ~/.orkastery/segredos/, ou em
memory.database_url_env pelo NOME da variavel de ambiente; uma fonte so, sem fallback).
Colecoes gravadas no OrkMind: decision, handoff, rule, learning, roadmap (source=agent,
nunca mandatory: regra critica so nasce de humano autenticado).

Retry tipado (bloco B3): reexecutar, corrigir-dirigido, sincronizar-worktree,
escalar-esforco, esperar-janela, escalar-humano, sem-retry. Violacao de custo
(cost.violation) NUNCA recebe retry automatico. O limite de escalacao do manifesto
(retry.max_tentativas) pausa QUALQUER modo, inclusive #Auto.

Monitor de orquestracao (ork orquestracao status / ork monitor): duas naturezas de parada.
pausa-humana e a parada PREVISTA pelo modo (o bloco fechou e espera veredito, com o
pausaSobre do bloco dizendo o que o humano decide); impedimento e a nao prevista
(lease.busy, runtime.rate-limited, concurrency.limite e os demais gates tipados). Tudo e
DERIVADO de thread.json, ledger.jsonl e das filas em disco: o monitor le, nunca grava.
--exigir-limpo sai != 0 enquanto houver thread parada, para virar watchdog do orquestrador.

Fases: GOAL PLAN GO CHECK SHIP MASTER. Modos: ${v.tags}.
Familias de lease: main-tree, worktree-write:<thread>, path:<glob>, board:<card>, service:<porta>.
Ciclos: greenfield, merge-branch, goal-plan, gap, feature-xl-faseada.
Fontes de medida do gate de tokens: runtime_reported, estimated, informada, unavailable.
Hosts de Camada 1: claude-code, codex, hermes, openclaw. Canarios: fx-happy, fx-hallucination,
fx-stale-base, fx-wiki-destroy, fx-schema-drift, fx-concurrency.
Packs de auditoria: clean-code, reuse, architecture, data-model, ux, security-privacy, process.
Superficie de ataque de rede (SP8..SP12, varredura deterministica): rota sem auth, endpoint de
administracao exposto, rota sem rate limit, CORS permissivo, rota sem esquema de payload.
Estagios do produto: nascente, crescendo, maduro (hardening gradual, visao secao 5.2).
`,
};

export const AJUDA_EN: typeof AJUDA_PT_BR = {
  comandoDesconhecido: (comando) => `unknown command: ${comando}`,
  texto: (v) => `ork ${v.versao}, the Orkastery orchestration core

Usage: ork [--projeto <name|path>] <command> [arguments]

  --projeto <name|path>                     Target project of any command (RM-052): overrides ORK_PROJETO, which overrides
                                            the current directory; an ambiguous or unknown name lists the candidates (exit 4)
  projetos [--json]                         Projects known on this machine (~/.orkastery/projetos.json)
  projetos registrar [path]                 Registers this checkout (init, thread new and fabrica entrar already do)
  projetos esquecer <name|path>             Removes a checkout that vanished or is no longer needed from the registry (nothing on disk is deleted)

  doctor                                    What holds on this machine now (exits != 0 when blocked)
  init [--force] [--name N] [--abbrev A]    Generates the repository orkastery.yaml
  modos                                     Table of the ${v.modos} live conduction modes by #TAG

  setup                                     Agenda of the #setup interview: runtime/model/effort
                                            per block of each mode (default claude-bg/opus/high; #Fast: sonnet)
  onboarding [show|set <step>|reset [step]]  Project agenda and answers (9 steps)
        [--conteudo JSON] [--por Q] [--json]  Secrets live ${v.segredos}
        [--reset [step]]                     Selective or full reset, idempotent
  onboarding sync [--json]                  Optional publication to memory, with degradation
  experiencia show [--json]                 Effective preferences; configure with onboarding set maestro --conteudo '{"owner":{"experience":true}}'
  experiencia uninstall <host> [--dry-run] [--json]
                                            Removes the Claude Code/Codex block; without --dry-run it applies the removal
  setup <mode>                              Current config of each block of the mode
  setup <mode> --bloco N [--runtime R]      Edits the block (runtimes: claude-bg, codex, grok);
        [--model M] [--effort E] [--por Q]       setup_configured event in the project ledger
        [--fallback R:M[:E],...]                  runtime fallback order of the block (I-33)
  accounts list [--json]                    Account profiles per runtime, without secrets (I-33)
  accounts add <id> --runtime R --dir D     Creates the profile and runs the CLI's own login with the profile
        [--sem-login] [--device-auth]            env (never copies a credential; device code only for grok)
  accounts remove <id>                      Deactivates the profile (directory and login stay where they are)
  accounts check [<id>]                     Checks the login of each profile and marks the store
  accounts esgotamentos [--desde 7d] [--json]
                                            Dispatches on an account that another project on this machine saw exhausted
                                            (RM-040), read only: opaque account, profile by id, no directory
  setup [<mode>] --reset                    Resets the mode (or everything) to the default
  setup sandbox [confirmar <posture>|revogar]  This machine's sandbox posture (RM-047): a runtime.sandbox that loosens the sandbox
                                            (danger-full-access) only dispatches after a local confirmation, kept out of git
  setup worktree [confirmar [<dir>]|revogar]  This machine's worktree folder (RM-047): a worktree.dir outside the root
                                            only creates checkouts after a local confirmation, kept out of git
  setup versionar                           Moves the setup in force to orkastery.setup.json: through a PR, it holds on
                                            every machine and becomes the edited file (I-52)

  thread new <name> --modo <MODE>           Creates the thread, the 3-part slug and the ledger
        [--exige-runtime-diferente]              the CHECK needs a runtime the GO did not use
        [--done "<criterion> :: <command>"]      EXECUTABLE done criterion (use ;; for several)
        [--slug S] [--assunto A] [--worktree auto|DIR] [--dry-run]
        [--sem-worktree]                         creates without a worktree (on the base branch, ship blocks the delivery with
                                                 push_direto_na_base: block, the ork init default); with
                                                 worktree.por_thread: true, the worktree is created without a flag
        [--roadmap RM-NNN]                       reserves the roadmap item before creating (I-47)
        [--pedido "<text>"]                      saves the builder request (pedido.md, with sha256):
                                                 prompt render uses it when --pedido is missing (RM-059)
  thread list [--todas] [--json]            Project threads that are NOT closed (--todas includes the closed ones)
  thread close <id> --motivo orfa|engano|superada --por Q --justificativa J
  thread entrega <id> --arquivo A --sha256 H --por Q
  thread status <thread-id> [--json]        Thread state, crossed with the runtime

  portfolio inspect <id> --json              Entity, origin and cycles with explicit gaps
  creation start --input-file F --json       Durable creation with the identity of the local process
  creation show|list|events [id] --json       Queries the journal and the recovery
  creation resume|compensate <id> --expected-version N --json
  portfolio create <product|project|initiative> <id> --title T [--parent ID]
  portfolio list [product|project|initiative] [--parent ID] [--json]
  portfolio show <id> [--json]              Catalog prod -> proj -> init
  objective ...                             Retired in I-43: its two parts became
                                            --exige-runtime-diferente and the thread --done

  phase run <thread-id> <PHASE> --prompt "<text>"
        [--runtime R] [--model M]           Dispatches the phase as a background agent
        [--effort E] [--dry-run]                 (runtime: CLI > block setup > manifest;
                                             only --model implies --effort high; the effective
                                             trio goes to the ledger as a verifiable fact)
        [--canal C] [--correlacao ID]        Source channel (without it, what the host declares)
        [--esperar [min]]                    If the thread is already being conducted, waits its turn (without it: refuses at once)
        [--perfil ID]                        Dispatch account (ork accounts list); a profile that is missing, belongs to another
                                             runtime, is exhausted or is not signed in is refused with a typed reason
  phase list <thread-id>                    Thread ledger history
                                            (shows the real model/effort of each phase)
  ledger stats --desde 7d [--ate ISO]       Ledger economic telemetry (half-open interval: start included, end excluded)
        [--thread T] [--modo M] [--runtime R] [--json]
  ledger estimate <thread-id> --sem-ia H --ia-sem-ork H --por Q --metodo M --premissas P
        [--incerteza I]                     Records explicit estimates of the PLAN phase

  sessions [--all] [--global] [--json]      Claude and Codex inventory of the process account and of each profile
        [--exigir-limpo]                    Exits != 0 with an invalid source or a session without a thread
  sessions adopt <id> [--json]             Adopts a real identity without running a prompt
  sessions event --tipo T --sessao ID       Ingests bounded JSON on stdin; observes without approving gates
  sessions watch --thread T [--sessao ID]   Watches only the selected session; --once does a single scan
  sessions limpar-fantasmas [--dry-run]     Releases from ork (sessao_morta in the ledger) the session with no pid and no process;
        [--json]                             never touches the runtime (RM-056)
  sessions logs <session> [--linhas N]      Logs of a session
  sessions supersede <thread> <UUID> --fase F --runtime R  Confirms that a superseded session ended
  sessions request <thread> <UUID> --fase F --runtime R --pergunta P  Opens a request bound to the native prompt
  sessions answer <thread> <request> --stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]  Confirms an authenticated delivery
  sessions reconcile <thread> <request>     Closes a pending send with only thread and request; checks the receipt, never resends
  sessions stop <session>                   Stops a session
  sessions attach <session>                 Prints the attach command (needs a TTY)
  pulse [--json] [--registrar]             Unified queue of human attention and retry of orphans
  pulse responder --resposta-stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]
                                            Receives what the owner typed in the summary channel (P4EJ a, 1a 2c)
        [--em-resposta-a <code>:<id>]       the question code and the id of the replied message (reply)
        [--em-resposta-a outra]             the bare word in reply to another message: refused, with the reason
  pulse cadencia [<tag>] [--por P] [--json]  Shows or changes the summary cadence: OrkPulseOn, OrkPulseOn-15m,
                                            -30m, -60m or OrkPulseOff; a new question goes out at once (I-50)
  sessions hitl [--json] [--so-paradas]     Radar of sessions that need human action NOW:
        [--atencao N] [--sem-logs]              classifies the state of each runtime session,
        [--so-da-raiz] [--exigir-limpo]         reads the question the session is stuck on and says what
                                                unblocks it (catches HITL of sessions WITHOUT a thread)
  noctum propor --arquivo <envelope.json>   Proposes the envelope of a #Noctum arc (RM-058) and asks the owner, with a short
                                            code and choices, also on the owner's channel; it authorizes nothing
  noctum revogar <arc> [--json]             Asks the owner whether to revoke the arc (RM-057); the owner's answer revokes,
                                            on Telegram or through the host dialog
  noctum responder <arc> --resposta-stdin --origem telegram --canal C --por ID --mensagem REF [--conta ID]
                                            Receives the authorization or revocation signed by the gateway
  noctum terminal --hook-stdin              The terminal ingress (RM-057), turned off: the UserPromptSubmit hook delivers
                                            what the owner typed, and the core only says where to answer; nothing is recorded
  noctum status [<arc>] [--json]            Arc snapshot: situation, measured usage, queue, closing and gaps
  noctum tique <arc> [--json]               Closing, watcher and report of the arc, in that order (the owner cron calls it);
                                            the watcher reconciles and, with no live conductor, takes the dispatch and delivery step
  noctum relatorio <arc> [--json]           The morning report in the terminal (receipt only in an interactive terminal)
        [--reenviar telegram|openclaw]          resends the pages without a receipt, even an uncertain one
  noctum conduzir <arc> [--json]            The arc conductor, which the pilot cron relaunches: exits 0 with the arc ended
                                            or stopped, 2 on refusal, 3 with another live conductor, 4 with the generation lost
  noctum aceite <arc> [--json]              The pilot acceptance: measures M1 to M10, the criteria and the verdict; exits 0
                                            only when approved, and simulated evidence (the rehearsal) never approves
        [--injecoes <file>]                     the schedule of injected failures, which M4 and M5 measure
        [--limiares <file>]                     the owner's thresholds; what is missing stays with the proposal, marked
        [--publicar <file>]                     writes the publishable version, without personal data

  claims add <thread-id> <file> --claim "<claim>" [--verificar "<command>"] [--fase F]
                                            Records a verifiable claim of the thread
  claims list <thread-id>                   Claims of the thread and the state of each one
  claims conferir <thread-id> --claims C1,C2|--tarefa T1 [--prazo S] [--json]
                                            Reruns only those claims, or the verify of the plan task, in the
                                            verify sandbox, without writing a receipt (RM-059); exits 3 if another
                                            session is conducting and 2 without a sandbox
  decisao registrar <thread-id> --decidido D --porque P --como-mudar C --custo-agora A --custo-depois B
        --criterio manifesto:KEY|ledger:REF|medicao:COMMAND --quem Q --evidencia E [--razao R] [--reverte ID]
                                            Decision taken without asking: reaches the owner in the summary
  decisao placar <thread-id> [--json]       Decided versus asked per phase, reversals and the threshold
  claims verificar <thread-id> <claim-id> --comando "<command>"
                                            Attaches the command that proves a claim already made
  claims retirar <thread-id> <claim-id> --motivo "<reason>"
                                            Withdraws the claim (the history stays in claims.jsonl)
  claims ausente <thread-id> --paths A,B --motivo "<reason>" [--commit SHA]
                                            Cycle without CHECK: declares in the ledger what was left without proof
  verify <thread-id> [--baseline]           Re-runs the claims and the manifest verify on the real HEAD
        [--so-claims]                       --baseline records the state of the world before GO
        [--canal C] [--esperar [min]]       Only runs while conducting the thread (exits 3 if another one conducts)
  ci prepare <thread-id>                    Exports claims/commands to the candidate (.ork-ci/<thread>.json)
  ci run [<thread-id>] [--bundle FILE]      Runs the CHECK on the independent runner
        [--branch B]                         finds the thread bundle by the branch name (the CI uses it)
  ci status [--sha SHA] [--remoto origin]   Queries the exact check published on GitHub
  privado varrer [--base REF] [--json]      Private data (home, e-mail off the allow list, machine hostname and the local
                                            list outside git) in versioned lines and names; --base: only the diff (RM-062)

  gate next <thread-id> [--proximo PHASE]   Token gate: same session or new session
        [--ocupacao 0..1] [--fonte F] [--transcript FILE] [--janela N] [--refazer]
  gate request <thread-id> [--motivo M]     Presents the HITL request correlated to the pause
        [--formato telegram|terminal]           in the short contract, with the stable code to answer
  gate answer <thread-id> <request>         Receives the envelope of the authenticated human ingress
        --resposta-stdin --por Q --mensagem ID --origem telegram [--canal hermes|openclaw]
        [--conta ID]  approved account of the channel; required on the openclaw channel
  gate approve                             Retired: approval without a request is refused

  retry policy [--motivo M] [--json]        Retry policy per typed gate reason
  retry plan <thread-id> [--motivo M]       What ork would do for the last failed gate
        [--fase F] [--json]                      (computes, does not run, does not spend an attempt)
  retry run <thread-id> [--reverify]        Runs the typed action of the last failed gate
        [--por Q] [--dry-run]                    (--por authorizes when the mode block pauses)
  retry list [--json]                       DURABLE rate limit queue of the project
  retry resume [--id R1] [--agora ISO]      Resumes the phase killed by a rate limit in the next window
        [--ocupacao 0..1] [--forcar] [--dry-run]  (playbooks: mesma-sessao, nova-sessao, escalada)
  retry cancel <id> --motivo M              Takes a request out of the queue, with the reason recorded
  retry parse --stderr "<text>"             Reads the reset time from the adapter stderr

  fix open <thread-id> [--so-claims]        GO-FIX: derives the exact spec of the failed CHECK
        [--reverify] [--json]                    (one fix per typed reason, type A or B)
  fix list <thread-id> [--rodada N]         Fixes of the round and the verdict of each one
  fix reverify <thread-id> [--rodada N]     CHECK-REVERIFY with a verdict PER fix
        [--parcial] [--json]                     (--parcial is REFUSED if there is a type B)

  handoff export <thread-id>                Handoff triaged CRITICAL/IMPORTANT/RESUMABLE
        [--proxima-fase PHASE] [--slug S]
  handoff recall <thread-id> <pointer>      Resolves a path#anchor pointer back to the content

  recall <thread-id> --fase PHASE           LATE recovery: resolves only the pointers of the
        [--id ptr-N] [--todos] [--forcar]        moment (retrieve_when), never the whole window
        [--sem-conteudo] [--json]                (orkmind by tag, files by path#anchor)

  brain status|inventory|get|query|receipts|context|dossie|sync|reconcile|apply|rollback|bind
  brain dossie --thread T [--decisao ID]    Decision dossier: link, citable context, alternatives,
                                            who decided and evidence, with the Brain ids (read only)
  conhecimento listar [--colecao C] [--json]  Valid documents of the conhecimento.dir folder (RM-026 K7), with version and gaps
  conhecimento mostrar <doc-id> [--json]    The document with body, version, source and checked references (Brain by get)
  conhecimento colecoes [--json]            The collections and the documents of each one
  conhecimento verificar [--json]           Checks the whole folder, Brain ids by get; exits != 0 with a gap
  memory status [--json] [--sondar]         Effective regime (files|orkmind), tenant, degradation and embeddings
                                            (--sondar: one real embedding call, with the latency)
  memory sync [<thread-id>] [--json]        Publishes decisions, policies, handoff, lesson and roadmap
  memory inventory --escopo <threads> [--json]                 Inventories canonical sources and excluded tenants, without writing
  memory migrate --operadora <thread> --escopo <threads> [--dry-run] [--json]                   Migrates handoffs through G3, with a full package and readback
  memory search --tags '<json>' [--colecao C]  Deterministic search by tag (mandatory always comes back)
        [--thread ID] [--restrito] [--janela N] [--limite N] [--json]
  memory search --texto "<phrase>"         Search by meaning (I-38): vector + FTS by RRF in the tenant,
        [--modo hibrido|vetor|fts]               NOT deterministic; does not combine with --tags or --thread
        [--colecao C] [--limite N] [--json]
  memory index [--modelo primario|fallback|todos]  Local vector index of the tenant (I-38), idempotent,
        [--dry-run] [--json]                     with estimated tokens and cost; --dry-run does not call the provider

  grafo indexar [--verificar] [--forcar]    Code graph index of the clean HEAD (RM-031 KG3) in the project state:
        [--json]                                 folders 0700, key per revision and extractor, idempotent; incremental (KG4)
                                                 from the ancestor index, or full with the reason; --forcar extracts
                                                 in full; --verificar checks contract, bytes, determinism and the incremental
                                                 against the full one; needs typescript and micromark
  grafo status [--json]                     Stored indexes, the HEAD one, the analyzers and the size
  grafo contexto <thread> [--json]          Thread package with evidence and size in bytes [--teto-bytes N]
  grafo vizinhos <node> [--profundidade N]  Neighborhood of a file or symbol, with the extractor and evidence of each edge
        [--sentido entrada|saida|ambos] [--tipo T,...] [--limite N] [--json]
  grafo chamadores <symbol>                 Who calls it (incoming calls edges) [--profundidade N] [--limite N] [--json]
  grafo importadores <file|symbol>          Who imports it (incoming imports edges) [--profundidade N] [--limite N] [--json]
  grafo caminho <from> <to>                 Shortest path along the edges [--sentido saida|entrada|ambos] [--tipo T,...] [--json]
        [--json --teto-bytes N]                  In the four queries (KG5): compact JSON of at most N bytes; the edges farthest
                                                 from the target go out until it fits, and a path that does not fit refuses
  grafo amostra [--por-estrato N]           Sample of edges for manual audit; --conferir FILE checks the audited one
  grafo limpar [--tudo] [--json]            Deletes the indexes that are not from HEAD and leftovers older than one hour

  security-scan [--base <ref>] [--json]     Security scan of the HEAD against the base: report by SHA in
                                            .orkastery/security-scan/<sha>/; exits 1 on a new finding in the loop
  ship <thread-id> --para <branch>          Serialized --no-ff merge by lease and PROVEN push
  ship registrar-pr <thread-id>|--todas    A delivery made by PR becomes ship_done: ship(<thread>) merge on the remote
        [--remoto R] [--json]                    base and green CI on the PR head; then, ork master <thread> --aceitar-omissao
        [--repo <owner/name> --pr <n>]           PR merged in an external repository of ci.external_repositories
        [--dry-run]                              Rehearsal: the same checks, without writing ship_done, phase or factory
        [--de <branch>] [--remoto origin] [--autorizar-push <who>] [--allow-unscanned <who>] [--sem-push] [--dry-run]
  ship publicar <thread-id>                 Publishes the branch and opens the PR with proof (ls-remote), only in #Auto and #Maestro
        [--dry-run] [--remoto R] [--json]        The rehearsal checks everything without publishing; repeated, it opens no other PR
  ship pista [<thread-id>] [--json]         Delivery steps, from CHECK to ship_done, and the core's next step

  board [--all] [--sem-remoto]              Single view of the threads (all profiles with --all); with the
                                            shared factory, also the other machines (I-51)
  board plan                                Scheduler: who moves now, who waits and why

  orquestracao status [--all] [--json]      PROACTIVE monitor of pauses and impediments: who is
        [--atencao N] [--so-paradas]             stopped, waiting for what, for how long and what
        [--sem-runtime] [--exigir-limpo]         unblocks it (short alias: ork monitor)

  worktree ensure <thread-id>               Ensures the thread worktree (base resolved by ork)
  worktree sync <thread-id> [--dry-run]     Rebases the thread branch when the base moved ahead
  worktree audit <thread-id>                Checks the worktree in git itself (exits != 0 if it diverges)
  worktree release <thread-id> [--forcar]   Removes the worktree and cleans the registry

  activation plan|status|enable|disable     Scoped writing with acceptance, hash, leases and receipt
  lease list                                Leases, families and the queues (merge and region collision)
  lease acquire <name> --thread T --motivo M   Takes a typed lease (joins the queue if it collides)
  lease release <name> [--thread T] [--forcar]
  conducao status <thread-id> [--json]      Who conducts the thread now (channel, session, phase, since)
  conducao assumir <thread-id> --por Q --motivo M
                                            Handoff: ends the current conduction through the runtime and records who took over
  conducao sentinela status|bater|desligar [--sessao S] [--json]
                                            Conductor Sentinel: presence on this machine and the step of each thread
  conducao autorizar --ate D --pode A[,B] [--por Q] [--nota N]
                                            Records the owner's durable authorization on this machine (outside git)
  conducao autorizacao [--json]             The durable authorization in force on this machine, or why it does not hold
  conducao batida [--entregar] [--json]     Moves the threads within the authorization: merge, record, MASTER, dispatch
  conducao atualizar <thread-id> [--enviar] Merges the base into the thread branch, with the CHANGELOG reconciled

  master propor <id> --score N --justificativa J --por <agent>
  master batch --aceitar <thread:signature,...> --por <human>
  master migrar --dry-run --por Q           Inspects fixes without changing the originals
  master digest <enviar|preview|responder>  Weekly digest with host receipts
  master <thread-id> --score 0-5 --justificativa "<text>" --por <your-name>
        [--classe C[,C]] [--resumo R] [--refazer]
                                            Closes the thread: POSTMORTEM + MASTER log + score (terminal only;
                                            from a host process it is refused with master.prova-de-canal)
  master pedir <thread-id> [--formato telegram|terminal|json]
                                            Asks the owner for the score with a short code; they answer through Telegram
                                            (<code> <0 to 5> <why>) and the score goes to the ledger with the receipt (RM-048)
  master [--todas] [--json]                 The deliveries, with the index derived from the ledger
  master <thread-id> --aceitar-omissao      Accepts by default ONLY the delivery of this thread, with a record (or --thread T)
        [--dry-run] [--json]                     --dry-run lists what would be closed, without writing
  master --aceitar-omissao [--dry-run] [--json]
                                            Accepts ALL delivered ones by default, listing each one
                                            (from an agent process with more than one, warns on stderr)
  master classes                            The fixed failure classes of the POSTMORTEM
  licoes [--json]                           What comes back in the GOAL and PLAN of the next thread (POSTMORTEM and
                                            MASTER) and the policy proposals by recurrence (I-55)

  demo [--manter] [--dir D]                 The promise in 30 s: a false claim refused and the fixed one accepted,
                                            offline, in a temporary repository (I-56)
  ciclos                                    Cycle variants of "ork thread new --ciclo"
  modos --do-pedido "<text>" [--json]       Reads the #TAG of the builder request (used by the adapters)
  modos migrar [--dry-run] [--por Q]        Removes a retired mode from orkastery.yaml and setup.json
        [--json]                             (idempotent, with a backup; does not touch history)

  prompt list                               Prompt templates (built in and the project ones)
  prompt lint [--template ID]               Refuses a broken template before it becomes a dispatch
  prompt render <thread-id> --fase F        Shows the exact prompt, with the sha256 that goes to the ledger
        [--pedido "<text>"] [--template ID]      without --pedido, the one saved when the thread was created (RM-059)
  prompt render --exemplo --fase F --modo M  Renders without any thread, to review the text

  roadmap status [--json]                   Single roadmap status report: groups with icons, #HITL on what waits for
                                            you and the closing with what needs you and what comes next (RM-048)
  roadmap reservas [--json] [--remoto R]    Who holds each roadmap item, read from the ork/roadmap-reservas branch
        [--soltar-orfas]                     marks the reservation of a thread already closed (orphan) and, with the option, releases
                                             it or passes it to another open thread of the same item, with a record
  roadmap pegar <RM-NNN> [--thread T]       Reserves the item for this machine (atomic push: the first one wins)
        [--nota N] [--por Q] [--maquina M]       machine = --maquina, ORK_MAQUINA or the hostname
        [--forcar --motivo M]                    taking the reservation of another machine is recorded
  roadmap soltar <RM-NNN> [--forcar --motivo M]  Gives the item back
  roadmap feat [--thread T] [--nota N]      Reserves the next FEAT number on the same branch (atomic push: two
                                            machines never take the same number; a reserved number does not come back)
  fabrica [--json] [--sem-remoto]           What each machine conducts, read from the ork/fabrica-estado branch (I-51)
  fabrica entrar [--maquina NAME]           This machine joins the shared factory of this user, with
                                            this name (~/.orkastery/maquina.json), and publishes the first snapshot
  fabrica publicar [--forcar] [--json]      Writes the snapshot of this machine to the branch (atomic push, without force);
                                            after joining, it goes out on its own when a thread is created, a phase is dispatched,
                                            delivered and closed, and at every pulse beat
  fabrica sair                              Stops publishing from here and removes the snapshot of this machine from the branch
  fabrica batida [status|instalar|remover]  The pulse scan beat in this machine's crontab (RM-063): instalar
        [--por Q] [--json]                       adds the monitor/pulse.cron line (idempotent), remover takes out only it;
                                                 status shows the line and the last run in hitl.log
  network status [--json] [--sem-remoto]    This person's Orkastery Network: the machines, from any directory,
                                            with the source, the gaps and what was not read (RM-053)
  network entrar [--maquina NAME]           This machine joins the network: private repository <user>/orkastery-network
        [--forja github|gitlab] [--repositorio [OWNER/]NAME]  on the forge (created if missing) and the first snapshot;
        [--forcar]                               --forcar takes a name that another installation uses (it stays in the commit)
  network publicar [--forcar] [--json]      Writes the snapshot of this machine to the network home (push without force); after
                                            joining, it goes out on its own at the pulse beat and on thread events
  network sair                              Stops publishing from here and removes the snapshot of this machine from the home
  network roadmap [--projeto P] [--json]    Roadmap, reservations and threads of each machine of each project, from any directory:
        [--sem-remoto]                           source and time of each part, typed gap on what it did not read. P = clone path,
                                                 github:owner/repo, gitlab:group/repo or a known name; without a clone, it reads the forge (RM-054)
  docs verificar [--json] [--pr]            Product and roadmap documentation against the code and git; on the PR (--pr),
                                            the merge of another thread and the index that diverge from main only warn
                                            (owner standard: frontmatter, reading, parity; exits != 0 with an error)
  docs sincronizar [--escrever]             Facts from the ledger and git to the roadmap (merge, phase) and indexes;
                                            without --escrever it only shows; never changes a status because time passed
        [--so RM-NNN[,RM-MMM]] [--todos]     only these items (and the indexes); in the worktree of a thread with an item,
                                             the default is its item; --todos goes back to every item (RM-037)
  docs init                                 Creates standards, templates, indexes and the Markdown lint in the project

  mcp serve --project ROOT --host HOST       stdio MCP server of this project (codex|claude-code; grok only in the child session, with --thread)
  mcp install --project ROOT --host HOST     Prepares MCP; accepts --dry-run, --ship-transport, --child-permissions and --owner-permissions (Codex)

  adapter list                              Host adapters (Layer 1) and the target of each one
  adapter show <host>                       The 3 installation pitfalls of the host
  adapter install <host> [--dir D]          Installs the adapter (claude-code|codex|hermes|openclaw)
        [--dry-run] [--force]                    a safe divergence resolves on its own; the rest asks
        [--aceitar-catalogo <file>]              overwrites the copy with the catalog, file by file
        [--manter-copia <file>]                  keeps the copy as it is, file by file

  eval [--skill S] [--canario C]            Behavior canaries + corpus of the thin skills
        [--so-canarios] [--so-skills] [--json]   (exits != 0 on any failure)

  audit packs [--estagio E] [--pack P]      The 7 packs, the stage that activates them and the posture
  audit run <pack> [--profile P]            Builds the pack prompt and dispatches through the runtime adapter
        [--since Nd] [--tudo] [--effort E] [--model M] [--agora "<who>"] [--forcar] [--dry-run]
  audit list                                Audit rounds of the project
  audit show <round> [--ledger]             Context, findings and proposals of a round
  audit prompt <pack> [--since Nd]          The exact pack prompt, with the sha256 that goes to the ledger
  audit lint                                Refuses a broken audit template (auditors/)
  audit ingest <round> --arquivo J          Records in batch the findings the auditor wrote
  audit finding add <round> --regra R       Records a finding with evidence, claim and proposal
        --titulo T --arquivo path:line --impacto I --fix F --estimativa E
        [--severidade critico|maior|menor] [--irreversivel "<step>"] [--verificar "<command>"]
  audit verify <round>                      Re-runs the claims of the findings (auditor without self-report)
  audit report <round> [--publicar]         Report with the MANDATORY block of proposals
  audit divida [--pack P] [--todos]         Debt board: open proposals and recurrence
  audit surface [<dir>] [--regra SPn]       DETERMINISTIC scan of the network attack surface
        [--limite N] [--json]                    (SP8..SP12; exits != 0 when there is a finding)
  audit surface --registrar <round>         Writes the scan findings to the round board
  audit finding estado <id> <state>         Stamps the finding (aberto|adiado|resolvido|descartado)

  thread new <name> --from-finding <ID>     Opens the thread from an audit finding
        [--modo M] [--worktree auto] [--sem-worktree] [--dry-run]
                                                 (evidence, claim and proposal travel together; the worktree follows
                                                 worktree.por_thread as in thread new)

Memory regimes: files (honest fallback) and orkmind (block B6, own database per tenant
declared in memory.database_url_file, a 0600 file in ~/.orkastery/segredos/, or in
memory.database_url_env by the NAME of the environment variable; one source only, without fallback).
Collections written to OrkMind: decision, handoff, rule, learning, roadmap (source=agent,
never mandatory: a critical rule is only born from an authenticated human).

Typed retry (block B3): reexecutar, corrigir-dirigido, sincronizar-worktree,
escalar-esforco, esperar-janela, escalar-humano, sem-retry. A cost violation
(cost.violation) NEVER gets an automatic retry. The escalation limit of the manifest
(retry.max_tentativas) pauses ANY mode, #Auto included.

Orchestration monitor (ork orquestracao status / ork monitor): two kinds of stop.
pausa-humana is the stop PLANNED by the mode (the block closed and waits for a verdict, with the
block pausaSobre saying what the human decides); impedimento is the unplanned one
(lease.busy, runtime.rate-limited, concurrency.limite and the other typed gates). Everything is
DERIVED from thread.json, ledger.jsonl and the queues on disk: the monitor reads, never writes.
--exigir-limpo exits != 0 while there is a stopped thread, so it can be the orchestrator watchdog.

Phases: GOAL PLAN GO CHECK SHIP MASTER. Modes: ${v.tags}.
Lease families: main-tree, worktree-write:<thread>, path:<glob>, board:<card>, service:<port>.
Cycles: greenfield, merge-branch, goal-plan, gap, feature-xl-faseada.
Token gate measurement sources: runtime_reported, estimated, informada, unavailable.
Layer 1 hosts: claude-code, codex, hermes, openclaw. Canaries: fx-happy, fx-hallucination,
fx-stale-base, fx-wiki-destroy, fx-schema-drift, fx-concurrency.
Audit packs: clean-code, reuse, architecture, data-model, ux, security-privacy, process.
Network attack surface (SP8..SP12, deterministic scan): route without auth, exposed admin
endpoint, route without rate limit, permissive CORS, route without a payload schema.
Product stages: nascente, crescendo, maduro (gradual hardening, vision section 5.2).
`,
};
