# Changelog

As mudanças do pacote [`@orkastery/cli`](https://www.npmjs.com/package/@orkastery/cli), da mais
nova para a mais antiga. O detalhe de cada item, com a evidência de merge, está no
[roadmap](docs/roadmap/README.md).

## Não publicado

### Adicionado

- **Prova de ativação do Maestro no Codex** ([RM-032](docs/roadmap/RM-032-bootstrap-maestro.md)):
  `node core/scripts/prova-ativacao.cjs codex` prova o terceiro host. A sessão é nova, não interativa e efêmera
  (`codex exec --json --ephemeral --ignore-user-config`), usa o login nativo do `CODEX_HOME` de quem roda e recebe por
  `-c` o servidor MCP que o `ork mcp install --host codex` gravou no projeto, só com `ork_maestro` aprovada. A
  conferência lê os eventos do `codex exec --json` e exige `mcp__orkastery__ork_maestro`: `ork maestro` pelo shell,
  inclusive embrulhado em `bash -lc '...'`, é desvio. Ela confere também que nenhuma sessão da prova ficou em
  `$CODEX_HOME/sessions`. A skill `ork` do Codex passa a pedir `ork_maestro` antes de qualquer `ork` no shell: na
  primeira rodada real, o modelo rodou `ork maestro --json` no shell antes da tool, e a prova reprovou.
- **Suíte local sem as dependências opcionais** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)): o
  `npm --prefix core test` passa com 0 falhas numa máquina sem o codex em `/usr/bin`, sem PostgreSQL ou sem o
  interpretador do OrkMind. Os 44 testes que dependem deles sondam a dependência e saem como skip com o motivo
  (`skip: PostgreSQL ausente ...`), em vez de reprovar. `ORK_TESTE_EXIGE_AMBIENTE=1` desliga o skip, e o
  `test:ci` a liga na suíte hermética. `node core/scripts/suite-local.cjs` roda a suíte e conta falhas e skips.
- **HITL de condução por alternativas, fatia 3** ([RM-057](docs/roadmap/RM-057-hitl-por-alternativas.md)):
  - `ork pulse` e `ork roadmap status` trazem `hitlDeConducao`: as perguntas de condução abertas com há quanto tempo cada
    uma para a thread (e desde que hora, no fuso do dono) e a mediana dos últimos 7 dias contra a meta de 5 min;
  - o resumo do pulse (Telegram e terminal) ganha uma linha só quando passa da meta, sem sair fora da cadência.
- **Conferência opt-in da claim no registro** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md)): a policy
  `claim_sem_prova_local` (alias `claims_failed`, o nome que o `ork licoes` propõe) vem desligada. Declarada, o
  `ork claims add` roda o comando da claim uma vez, na worktree da thread e no prazo do `verify.timeout_ms`; se ele
  reprova, grava `policy_warn` com `claims.failed`, e se estoura o prazo, com `verify.timeout`. A claim entra do
  mesmo jeito e nada para, nem com a policy em `block`.
- **`ork doctor` acusa o pulse que bate devagar** ([RM-039](docs/roadmap/RM-039-cadencia-do-pulse-por-tag.md)): com
  `.orkastery/monitor/pulse-host.json`, o check `cadencia do pulse no cron` lê o `crontab -l` e avisa, sem bloquear, a
  linha da varredura ausente, o crontab inexistente ou a batida mais lenta que 15 minutos (como a antiga `0 * * * *`),
  com a linha do template `monitor/pulse.cron` pronta para colar. O doctor nunca edita o crontab.

### Segurança

- **`--remoto` de `ork ship registrar-pr` e de `ork ci status` validado antes do git** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)):
  o valor passa pelo mesmo validador do remoto da fábrica; fora do formato, `ork ship registrar-pr` (com a thread ou
  `--todas`) recusa com `ship.remoto-invalido` e `ork ci status` com `ci.remoto-invalido`, sem nada passado ao git nem
  consulta ao GitHub; antes, o valor ia cru ao `git fetch`, ao `git ls-remote` e ao `git remote get-url`, que agora
  recebem `--` antes do remoto. `--remoto` sem valor também recusa, em vez de virar `origin` em silêncio.
- **Remoto da fábrica validado antes do git** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)):
  - o `fabrica.remoto` do `orkastery.yaml` e o `--remoto` da linha de comando só chegam ao git como nome de remoto
    (letras, dígitos, `.`, `_` e `-`, sem `-` no começo, sem URL nem transporte, sem caractere de controle); antes, um
    repositório podia pôr ali uma opção do git, e o `ork fabrica` ou o `ork roadmap reservas` a passavam ao `git fetch`
    e ao `git push` de quem o clonou (classe: injeção de argumento na linha de comando do git);
  - fora do formato, `ork fabrica` (e `publicar`, `entrar`, `sair`) recusa com `fabrica.remoto-invalido`, e
    `ork roadmap reservas`, `pegar`, `soltar` e `feat` com `roadmap.remoto-invalido`, com o valor redigido e nada passado
    ao git; o `fetch`, o `push` e o `remote get-url` recebem `--` antes do remoto.

## [0.5.2] - 2026-10-03

### Adicionado

- **Perfil por despacho, rodízio por carga e sessões de cada conta** ([RM-056](docs/roadmap/RM-056-perfil-por-thread-e-carga.md), [FEAT-037](docs/produto/FEAT-037-perfil-carga-e-sessoes-das-contas.md)):
  - `ork phase run ... --perfil <id>`, e `perfil` em `ork_phase_run` (MCP e OpenClaw): o despacho sai pela conta pedida;
    perfil inexistente ou de outro runtime recusa com o motivo novo `runtime.profile-invalid` (sem retry automático),
    esgotado com `runtime.quota-exhausted` e sem login com `runtime.auth-missing`, sem abrir sessão nem trocar de perfil;
  - `runtime_profiles.distribuir: carga` no manifesto (opt-in; o padrão `ordem` segue igual): o perfil disponível com
    menos sessões vivas nesta máquina recebe o despacho, com desempate pelo uso mais antigo;
  - `ork sessions`, `ork board plan`, o escalonador e o monitor (e o retrato da fábrica) consultam a conta do processo e
    cada perfil do store; cada sessão sai com o id do perfil (coluna `PERFIL`), nunca com o diretório da conta;
  - sessão claude-bg sem `pid` vivo em estado não terminal é fantasma: não ocupa vaga nem vira pausa humana;
    `ork sessions limpar-fantasmas [--dry-run]` grava `sessao_morta` na thread vinculada e nunca toca no runtime.
- **HITL de condução por alternativas, fatia 2** ([RM-057](docs/roadmap/RM-057-hitl-por-alternativas.md)):
  - `ork ledger stats` traz `hitlDeConducao`: as perguntas `ork.hitl/v2` que o ork abriu, o tempo parado do pedido à
    primeira resposta (recortado ao período), a mediana contra a meta de 5 min e o texto fora da exceção à parte;
  - canário `fx-pedido-colado` (incidente de 01/10): o pedido colado em `#Auto` com push e merge autorizados segue sem
    parar, e o "confirmo" em texto livre é recusado com `hitl.selecao.texto-livre` sem gravar nada;
  - a regra do HITL de condução entra nas descrições de `ork_modo_do_pedido`, `ork_maestro` e `ork_phase_run` do
    OpenClaw e na skill `orkastery-devmaster` do Hermes, que passa a dizer alternativas de `a` a `e`.
- **HITL de condução por alternativas, fatia 1** ([RM-057](docs/roadmap/RM-057-hitl-por-alternativas.md)):
  - todo pedido que o ork abre ao dono (`ork.hitl/v2` pergunta) sai como seleção de 3 a 5 alternativas, exatamente uma
    com o selo "Recomendação"; fora disso, o registro recusa sem gravar nada, com `hitl.selecao.fora-da-faixa`,
    `hitl.selecao.recomendada` ou `hitl.selecao.texto-livre`;
  - resposta em texto só com `dependenciaTecnica` (o comando exato que o dono roda no terminal e o porquê);
  - as alternativas vão de `a` a `e`, e a resposta solta aceita a letra `e` e o dígito `5` no núcleo, no OpenClaw e no
    Hermes; o histórico com duas alternativas e a pergunta nativa das sessões continuam legíveis;
  - o texto ao dono marca a recomendada com o selo `✅ Recomendação` no Telegram e `[Recomendação]` no terminal;
  - `ork prompt lint` reprova (regra `hitl-texto-livre`) o template que peça um "confirmo" em texto livre ou que o dono
    cole texto, e os adaptadores do Claude Code e do Codex dizem a regra à condutora.
- **Impedimento que só o dono resolve vira pedido a ele** ([RM-055](docs/roadmap/RM-055-impedimento-do-dono-vira-hitl.md)):
  - o despacho recusado por `Workspace not trusted` (claude) ou `Not inside a trusted directory` (codex) sai como
    `runtime.workspace-untrusted`, e o de termos novos do CLI como `runtime.consent-pending`, a partir da saída real do
    runtime; motivo desconhecido continua `runtime.unavailable`, e cota e login seguem na rotação de conta;
  - os dois abrem a espera do dono, com o que trava, desde quando, o comando exato (`cd <worktree> && claude`) e o que o
    `ork` faz depois: aparecem em "espera você" no monitor, no board e no retrato da fábrica, e no pulse pelo contrato curto
    `ork.hitl-curto/v1`, nunca em "Conosco";
  - `ork retry run <thread>` re-despacha a mesma fase com o mesmo prompt gravado (mesmo sha256), sem o dono reescrever o
    pedido; na confiança do diretório, só depois que o `.claude.json` da conta a registra, e sem a prova nada é despachado.

### Mudado

- **`worktree.por_thread` passa a valer no `ork thread new`** (P4 do ensaio da 0.5.0, [RM-049](docs/roadmap/RM-049-lancamento.md)):
  - com `worktree.por_thread: true`, o que o `ork init` grava, a thread nasce com a worktree e a branch dela sem
    `--worktree auto`, também com `--from-finding`, e a saída diz que a worktree veio da chave; com a chave `false` ou
    ausente, nada muda, e a chave ausente passa a ler `false`;
  - `--sem-worktree` cria a thread na raiz do projeto e avisa o que isso faz no `ork ship` (na branch base,
    `push_direto_na_base: block`, o padrão do `ork init`, barra a entrega) e como corrigir antes do GO; junto com
    `--worktree`, ou num ciclo que exige worktree, recusa antes de reservar o item do roadmap;
  - `--dry-run` mostra a worktree e a branch que seriam criadas, com o id livre que a criação usaria, ou avisa por que
    a criação recusaria (pasta ou branch já existentes, repositório sem commit);
  - a worktree nasce na pasta da árvore principal mesmo quando o `ork thread new` roda de dentro da worktree de outra
    thread, em vez de aninhada nela;
  - num repositório sem commit, a worktree da chave espera o primeiro commit: a thread nasce na raiz, com aviso.

### Corrigido

- **Pendências da fatia 4 e rodízio no limite de gasto** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md), fatia 5):
  - a sessão claude-bg que bate o limite de gasto (ou outra cota que o rodízio já conhece) tira o perfil do rodízio na
    hora em que a mensagem aparece na transcrição, e não só quando o processo morre: o perfil fica esgotado até a hora
    da mensagem, no fuso dito entre parênteses, ou por 1 h contada da mensagem quando ela não diz a hora; o evento
    `runtime_quota_detected` vai ao ledger uma vez, o despacho seguinte sai pelo outro perfil e o `ork accounts list`
    mostra o prazo em `ESGOTADO ATE`;
  - a hora de volta com o fuso entre parênteses (`resets 4:40am (America/Sao_Paulo)`) é lida nesse fuso, e não no
    relógio da máquina;
  - com a branch já incorporada, o `ork ship` grava no `mergeSha` o merge de primeiro pai que a trouxe, e a ponta da
    base vai em `pontaDaBase`, que a prova do push e o recibo do Maestro conferem; o `ork ship registrar-pr` também
    grava a ponta;
  - no #Auto, o CHECK que termina em `done` sem o veredito sai de "Esperando você" e vira a linha do condutor com o
    passo "redespachar o CHECK";
  - com o remoto fora do GitHub, o pulse diz uma vez que a forja não tem leitura de PR, em vez de "PR não lido" a cada
    batida; com GitHub Enterprise, os PRs são lidos pelo host do remoto quando o `gh` está autenticado nele.

## [0.5.1] - 2026-10-02

### Adicionado

- **Prova de ativação do Maestro por host** ([RM-032](docs/roadmap/RM-032-bootstrap-maestro.md)):
  `node core/scripts/prova-ativacao.cjs <claude-code|openclaw>` instala o adaptador numa cópia
  descartável, abre uma sessão nova e não interativa no host (`claude -p` com `--plugin-dir`;
  `openclaw agent --local` com estado temporário) e diz `orkastery maestro`. A conferência
  (`core/src/prova-ativacao.ts`) exige a entrada do host chamada (`ork maestro` pelo shell é
  desvio), o resultado no contrato (`ork.maestro-snapshot/v1` ou `ork.network-roadmap/v1`), o
  projeto da cópia, o que não foi lido e uma resposta sem "roadmap vazio". O recibo
  `ork.prova-ativacao/v1` traz comandos, horários, versão do host e o sha256 da configuração global
  do host antes e depois, é redigido campo a campo antes de ser gravado e lista o que só o dono
  pode fazer. O roteiro fica no repositório, fora do pacote.

- **Grafo de código: índice incremental e linha de base do protocolo** ([RM-031](docs/roadmap/RM-031-grafo-de-codigo.md), KG4):
  sem o índice do HEAD, `ork grafo indexar` parte do índice da revisão ancestral com o mesmo
  extrator e reextrai só o que a mudança alcança, gravando os mesmos bytes da extração completa;
  sem base, extrai completo e diz por quê. `--verificar` compara também o incremental com a
  completa, e `--forcar` extrai completo. O índice passa a `ork.code-graph-index/v1`, com as
  unidades por arquivo (`unidades.json`); índice do KG3 aparece no `status` como formato anterior.
  A parte determinística da linha de base do benchmark está medida e o protocolo, fixado; a rodada
  paga segue pendente. A prova nos pares reais confere a âncora com os rótulos do Node e do Unicode
  fixados, porque a versão do Node entra no digest do grafo.

- **Grafo de código pelas fases, pelo MCP** ([RM-031](docs/roadmap/RM-031-grafo-de-codigo.md), KG5):
  com `grafo.mcp: true` no `orkastery.yaml` (desligada por padrão; ligar é decisão do dono), o MCP do
  projeto expõe `ork_grafo_vizinhos`, `ork_grafo_chamadores`, `ork_grafo_importadores` e
  `ork_grafo_caminho`, de leitura, que respondem pelo índice do HEAD da worktree da thread o mesmo JSON
  do `ork grafo`, com a evidência de cada aresta e no máximo 32.768 bytes por padrão; o despacho
  claude-bg as libera para a sessão filha só com a flag. As consultas do `ork grafo` ganham
  `--teto-bytes N` (JSON compacto de até N bytes, sem as arestas mais longe do alvo quando não cabe) e,
  sem o índice do HEAD, dizem se ele falta, se é de outra revisão ou de outro extrator, com a correção
  `ork grafo indexar`. Sem a flag, as tools e o despacho ficam como estão. Como todo o `ork grafo`,
  as tools precisam do `typescript` e do micromark na instalação do `ork`; sem eles, recusam com
  `grafo.parser.indisponivel`.

### Corrigido

- **Trabalho parado no condutor e status honesto** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md), fatia 4):
  - o pulse acha, além de 30 min, o trabalho parado depois da entrega e põe cada thread numa linha,
    `<thread> parado no condutor desde HH:MM: <próximo passo>`, em `ork pulse`, no campo
    `paradoNoCondutor` do `ork.pulse/v1` e no resumo dos dois canais, fora de "Esperando você" e sem
    pergunta ao dono: branch sem push, branch publicada sem PR (inclusive a entrega nova depois de um
    `ship_done`), PR verde sem merge, PR com check vermelho sem fase despachada depois, merge na base sem
    registro e sessão `blocked` sem pergunta de verdade (antes da entrega, o passo é despachar a fase
    seguinte, fase a fase fora do #Auto). O
    `human.pending` que o observador grava no fim de turno de um bloco sem pausa ao fim (sessão
    `blocked`, ou SHIP em `done` sem o `ship_done`) deixa de contar como pergunta do dono e volta sempre
    como linha; fora do #Auto e do #Maestro, publicar a branch, abrir o PR e mergear levam a
    autorização de push do dono. Os PRs vêm do `gh pr list` (os abertos e os
    recentes, e a branch candidata a "sem PR" conferida sozinha), só com branch que já foi ao remoto, e a
    leitura boa vira o retrato `ork.prs-abertos/v1` em
    `.orkastery/monitor/prs.json`; falha, lista cortada e retrato velho são "PR não lido";
  - `ork roadmap status` diz em "O que eu faço em seguida" o estado real da entrega (parado no
    condutor, PR com check vermelho, PR verde esperando o merge, branch sem push), lido do git local e
    desse retrato, sem rede; com fábrica compartilhada, uma linha "Fábrica:" avisa a máquina sem batida
    além de 3 h pela cópia local de `ork/fabrica-estado`, ou diz "não lido";
  - o retrato da máquina em `ork/fabrica-estado` não marca "espera você" no que é do condutor.
- **Defeitos de condução de 27/09 a 01/10/2026** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md), fatia 3):
  - `ork docs verificar` reprova o item cuja thread (`sdlc.thread`) já entrou na base pelo merge
    `ship(<thread>)` e segue fora de `Mesclado` (`docs.paridade.merge`), e o índice gerado que
    diverge do frontmatter (`docs.paridade.indice`); `ork docs sincronizar --escrever --so RM-NNN`
    corrige os dois. No PR (`ork docs verificar --pr`, o que o CI usa), as duas regras só avisam, e o
    push da `main` reprova: a página de outra thread não trava o PR de ninguém;
  - o check `documentacao` do CI exige linha nova em "Não publicado" quando o PR muda `core/`,
    `adapters/` ou `marketplaces/` (`core/scripts/checar-changelog.cjs`, `changelog.linha-ausente`);
    PR só de testes ou só de CI fica de fora, e o PR de versão passa pela seção nova;
  - `ork worktree sync` recusa a base reescrita também com ancestral comum (force-push que tirou
    commits): com commit próprio, `tree.blocked` com a causa `base-reescrita` e o `git rebase --onto`
    que reaplica só os commits da thread; sem commit próprio, a branch é recriada na base;
  - o commit, o verify, o SHIP e a escrita de artefato pelo MCP soltam o lease e a fila de thread
    fechada antes de conferir a região, com registro no ledger dela; lease de thread aberta segue
    barrando;
  - `ork_git_status` e `ork_git_commit` aceitam hard link no armazém de objetos do `.git` (clone
    local), que o git nunca abre para escrita; fora dele, `mcp.git.metadata.unsafe` diz o caminho e a
    receita sem perda;
  - `ork ship registrar-pr --dry-run`, também com `--repo --pr` e `--todas`, faz as mesmas
    conferências e não grava `ship_done`, fase nem fábrica;
  - `ork doctor` reprova arquivo ou pasta do `.git` com dono diferente do dono do repositório, com
    o `sudo chown -R` exato na correção, sem rodar nada.
- **Primeira experiência da 0.5.0, achados do ensaio em máquina limpa** ([RM-049](docs/roadmap/RM-049-lancamento.md)):
  - `ork init` num repositório ainda sem commit grava em `worktree.base_branch` a branch do HEAD
    (como `master`), e não `main`; com o HEAD destacado, `main`, e não `HEAD`. O `ork doctor` diz a
    branch e "(sem commit)", e o `ork thread new` avisa no stderr que a thread nasce sem base, sem
    sugerir rodar a fase; o marcador `desconhecido` sai inteiro onde o `ork` mostra commit (resumo
    da thread, `ork verify`, `ork fix`, `ork ship` e auditoria);
  - o aviso `onboarding fuso` do `ork doctor` compara o `owner.timezone` da resposta `maestro`, quando
    há, e não o `fuso` legado da mesma resposta;
  - a correção de `push_direto_na_base` aponta a branch da thread e, antes do GO,
    `ork worktree ensure <thread>`, em vez de repetir o `ork ship`; o erro de `ork mcp install` com
    caminho relativo diz para usar `--project "$PWD"`;
  - textos: a armadilha do plugin do Claude Code sem contagem fixa de caminhos, "pacote pulado" na
    instalação com aviso e a continuação do `setup` de volta ao lugar na ajuda;
  - docs: o quickstart cria a primeira thread com `--worktree auto`, traz os modos vivos no
    manifesto, uma claim focada, o `.gitignore` do estado, a ativação do plugin e amostras da saída
    real conferidas por teste; os READMEs dos plugins e o roteiro do revisor pedem um repositório
    com commit e usam `ork mcp install --project "$PWD"`.
- **Primeira experiência da 0.5.0, fatia 2 do ensaio** ([RM-049](docs/roadmap/RM-049-lancamento.md)):
  - `ork doctor` só reprova o `claude-bg` quando algum bloco de modo permitido despacha por ele, e a
    correção ensina o caminho só com o Codex (`ork setup <modo> --bloco N --runtime codex --model
    <modelo>`); o check `despacho pelo codex` vale também por bloco; sem o binário `claude`, o
    `ork sessions` dá a fonte como ausente, com a correção, e não sai mais 1;
  - o `gate_blocked` do `ork ship --dry-run` leva `dryRun: true`, e board, escalonador, monitor
    (pulse) e maestro ignoram o evento de ensaio: a thread não aparece pausada por um dry-run;
  - `ork init` cria `.orkastery/.gitignore` com `*`, e o `ork`, ao criar a pasta de worktrees, o
    mesmo nela; o `.gitignore` do usuário não muda;
  - onboarding, ajuda e docs dizem que segredos ficam no ambiente do processo ou no cofre do host
    (no Hermes, `~/.hermes/.env`);
  - a correção do lint de claim de suíte inteira e a dica de `ci.failed` das lições não citam mais
    o script do Orkastery;
  - `ork roadmap status` diz o fuso logo abaixo do título;
  - o `ork_git_commit` adiciona caminho rastreado com `git add -u` e, quando o git falha, diz o
    subcomando e o código de saída, sem o stderr;
  - o `ork ship` barra por `push_direto_na_base` a entrega sem delta com a base local à frente do
    remoto; o merge do próprio ship que não chegou ao remoto (push recusado, `--sem-push`) segue
    entregando no ship repetido;
  - o `ork` acha binário no PATH sem o `which`; `ork experiencia show` diz as origens em texto;
    `ork verify --baseline` sem comando não se contradiz; o guia de experiência diz onde o `--dir`
    põe o catálogo.

## [0.5.0] - 2026-09-30

### Adicionado

- **Grafo de código: extração, índice e consulta** ([RM-031](docs/roadmap/RM-031-grafo-de-codigo.md), KG2 e KG3):
  - extração determinística de um repositório local no contrato `ork.code-artifact-graph/v1`
    (KG2): TypeScript e JavaScript pelo compilador, Markdown (seções, links, frontmatter e IDs
    citados) e a proveniência de cada aresta; o que não se prova fica fora e declarado, e a mesma
    entrada dá o mesmo grafo e o mesmo digest em qualquer ordem de leitura;
  - `ork grafo indexar [--verificar] [--forcar]`: índice local e persistente do grafo do HEAD
    limpo, no estado do projeto e fora do git (pastas 0700, arquivos 0600), chaveado pela revisão,
    pela identidade e pelo extrator, e idempotente; `--verificar` confere contrato, bytes e
    determinismo;
  - `ork grafo vizinhos|chamadores|importadores|caminho`: consulta pelas arestas, em texto e
    `--json`, determinística e com o extrator e a evidência de cada aresta; a resposta diz que é
    parcial (só o que o extrator prova);
  - `ork grafo status`, `ork grafo amostra` e `ork grafo limpar`; o comando provisório do KG2 sai;
  - o `ork grafo` precisa do `typescript` e do micromark instalados no próprio pacote do `ork`
    (`ork grafo indexar` e as consultas), que não são dependências do pacote: sem eles, a recusa é
    `grafo.parser.indisponivel`.
- **Pacote de experiência de orquestração** ([RM-051](docs/roadmap/RM-051-pacote-de-experiencia.md)): preferências de idioma, fuso, profundidade e opt-out pelo onboarding; skills em inglês e pt-BR; blocos reversíveis em Claude Code/Codex e entrada Hermes; consultas MCP de reservas/fábrica e aviso de item sem associação. O bloco aponta o catálogo por caminho relativo ao projeto e é adotado num clone sem recibo; versão mantida.
- **Busca por significado na memória** ([RM-038](docs/roadmap/RM-038-busca-semantica-na-memoria.md)):
  - bloco `memory.embedding` no manifesto (provider, modelo, dimensão, o NOME da variável da chave,
    fallback local e teto de tokens); sem o bloco, desligado. O manifesto recusa valor de chave ou
    DSN, nome da lista de provider pago e a variável da DSN;
  - `ork memory index [--modelo primario|fallback|todos] [--dry-run]`: índice vetorial local e
    derivado do tenant, fora do git, idempotente, com tokens e custo estimados antes da rede;
  - `ork memory search --texto "<frase>"`: vetor e FTS por RRF dentro do tenant, com a origem
    declarada e `deterministico: false`; a busca por tag, o recall e o prompt não mudam;
  - `ork memory status` passa a sondar a ponte (`health`) e mostra o estado dos embeddings, a
    cobertura do tenant e, com `--sondar`, a latência de uma chamada real; a frase fixa de
    saúde, que nada sondava, deixou de existir. Embedding ausente nunca derruba o regime `orkmind`;
  - a policy `segredo_em_prompt` reconhece chave do OpenRouter, e o `ork doctor` confere a chave
    de embedding pelo nome.
- **Entrega em repositório externo** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  `ork ship registrar-pr <thread> --repo <dono/nome> --pr <n>` registra `ship_done` de PR mesclado
  em repositório declarado em `ci.external_repositories`: o PR cita a thread e entrou na branch
  padrão, o merge está dentro da ponta da base pela API do GitHub e o check declarado está verde no
  head do PR.
- **Decisão autônoma pelo MCP** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)): a
  ferramenta `ork_decision_record` grava pelo mesmo contrato do `ork decisao registrar`, para a
  sessão cujo sandbox não grava o ledger.
- **Projeto-alvo explícito** ([RM-052](docs/roadmap/RM-052-projeto-alvo-explicito.md)):
  - `--projeto <nome|caminho>`, opção global em qualquer comando, e `ORK_PROJETO`, com precedência
    sobre o diretório atual; nome ambíguo ou desconhecido recusa com os candidatos, na saída 4;
  - registro dos projetos desta máquina em `~/.orkastery/projetos.json` (`ork.projetos/v1`, sem
    segredo), alimentado por `ork init`, `ork thread new` e `ork fabrica entrar`; `ork projetos`
    lista, `registrar` e `esquecer` cuidam das cópias antigas;
  - toda tool do OpenClaw e do MCP aceita `projeto`; OpenClaw e Hermes declaram
    `ORK_PROJETO_EXPLICITO=1` e, sem projeto e com mais de um conhecido, devolvem a escolha em vez
    de ler o diretório do gateway; o MCP continua fixado e recusa outro projeto;
  - `ork maestro`, `ork board`, `ork board plan`, `ork fabrica` e `ork roadmap status` dizem no
    alto qual projeto leram (nome, raiz, remoto, origem) e o que não leram; sem remoto, board e
    fábrica dizem que nada foi lido, nunca "nenhuma publicou ainda".
- **Roadmap da rede, de qualquer diretório** ([RM-054](docs/roadmap/RM-054-roadmaps-e-threads-da-rede.md), fatia 1):
  `ork network roadmap [--projeto P] [--json]` junta, para cada projeto, o status report do
  roadmap com as threads de todas as máquinas, as reservas e as threads por máquina, com a fonte
  e a hora de cada parte (contrato `ork.network-roadmap/v1`). Sem clone, lê a forja só com
  consulta (`gh api graphql` numa chamada; GitLab pela mesma interface). O que não foi lido sai
  como lacuna tipada, nunca como "vazio".
- **Roadmap da rede nos hosts** ([RM-054](docs/roadmap/RM-054-roadmaps-e-threads-da-rede.md), fatia 2):
  - `ork_network_roadmap` no OpenClaw, no Hermes (`bin/ork-network-roadmap.sh`) e no MCP, e a rota
    nas entradas do Claude Code e do Codex: o status do roadmap nos hosts passa a vir do panorama
    da rede, com as threads de todas as máquinas e a fonte e a hora de cada parte, transportado
    como vem; `ork_roadmap_status` fica como o relatório só desta máquina;
  - a frase `orkastery maestro` sem projeto oferece o panorama da rede, e a recusa
    `projeto.escolha` do projeto-alvo passa a oferecê-lo também; o "Não lido" de maestro, board,
    fábrica e roadmap status aponta `ork network roadmap`;
  - o manifesto do OpenClaw declara `ork_network_roadmap` nos perfis `coding` e `messaging`
    (`toolMetadata`): no perfil `coding`, o padrão do OpenClaw, nenhuma tool `ork_*` chegava ao
    modelo; as outras continuam sob `tools.alsoAllow` do operador;
  - com `ORK_PROJETO_EXPLICITO=1`, `ork network roadmap --projeto` aceita só o nome registrado ou a
    forja (`github:dono/repo`) em `github.com`, `gitlab.com` ou no host de um projeto registrado, e
    o projeto do diretório do gateway só entra pelo registro; no MCP, a tool lê só o projeto
    servido;
  - fica para a fatia 3, com a RM-053 na `main`: `ork_network_status` e a rede por pessoa como
    fonte de projetos e máquinas.
- **Plugin nos marketplaces** ([RM-049](docs/roadmap/RM-049-lancamento.md)): o plugin do Claude
  Code (20 skills, 8 comandos, 6 subagentes e as checklists) e o plugin de skills do Codex (a
  entrada `ork` e as 20 skills), em `marketplaces/`, gerados do catálogo por
  `core/scripts/gerar-marketplaces.cjs` na versão do `@orkastery/cli` e conferidos no CI com
  `--verificar`. Sem hooks nem MCP: instalado pelo diretório, o plugin vale para a conta toda, e o
  guard e os sensores seguem no `ork adapter install claude-code`, por projeto. Os marketplaces
  próprios na raiz do repositório instalam sem esperar a revisão dos diretórios
  (`claude plugin marketplace add orkastery/orkastery`, `codex plugin marketplace add orkastery/orkastery`).
- **HITL humano no centro** ([RM-048](docs/roadmap/RM-048-hitl-humano-no-centro.md)):
  - todo pedido sai num contrato curto, `ork.hitl-curto/v1`: pergunta em uma frase, o que trava e
    desde quando, até quatro alternativas de uma linha, uma recomendada com o porquê e a última
    linha dizendo o que digitar, em no máximo 15 linhas, no Telegram, no terminal e no OpenClaw;
  - a resposta em texto livre registra quando é inequívoca (`aprovo`, `sim`, `pode seguir`, `a`,
    `1`, `1. B, 2. A`); ambígua, volta como pergunta com as opções reais. Com mais de um pedido
    aberto na mesma thread, texto livre não registra. A prova HMAC do ingresso não muda;
  - a linha que o dono recebe não vence em uma hora: o código do gate é estável, `<código> a`
    responde ao gate, e a resposta a pedido vencido vai ao pedido renovado quando a pergunta é a
    mesma;
  - impedimento técnico deixa de virar pergunta ao dono e aparece no resumo como "Conosco";
  - `ork roadmap status`: o status report único do roadmap, que os canais chamam em vez de
    escrever o próprio;
  - `ork master pedir`: a nota do MASTER com prova de canal. `ork master` com `--por` vindo de
    processo de host é recusado com `master.prova-de-canal`, e a `ork_master` do OpenClaw deixa de
    receber nome de pessoa.
- **Pacote de contexto citável do Company Brain** ([RM-025](docs/roadmap/RM-025-company-brain-fundacao.md)):
  `ork brain context --thread <id> --ids <ids>` devolve o pacote `ork.brain-context/v1`, com cada
  entidade do portfólio, a citação da fonte, o frescor contra o portfólio canônico e as lacunas
  tipadas, e um digest reproduzível. Item sem citação vira lacuna, nunca conteúdo. Somente
  leitura; também como `ork_brain_context` no MCP e no OpenClaw, que passa a ter 25 tools.
- **Dossiê de decisão** ([RM-026](docs/roadmap/RM-026-workspace-empresarial.md), K3.1):
  `ork brain dossie --thread <id> [--decisao <id>]` devolve o dossiê `ork.dossie-de-decisao/v1`: o
  vínculo da thread com o objetivo (o ticket do K1) e o projeto do portfólio, o pacote de contexto
  citável e cada decisão do ledger com as alternativas, quem decidiu, a evidência, a citação da
  linha e os ids que o Brain dá ao fato (`fact-…`). A resposta do dono só aparece com o recibo do
  ingresso conferido; sem ele, vira lacuna. Somente leitura; também como `ork_brain_dossie` no MCP
  e no OpenClaw, que passa a ter 26 tools.

### Mudado

- **Defeitos da noite de 29/09/2026** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  - `ork ci prepare` grava `.ork-ci/<thread>.json`, com a branch da thread, e o CI roda
    `ork ci run --branch <branch>`: duas PRs não mudam mais o mesmo bundle. O `.ork-ci/bundle.json`
    de antes só vale quando a thread dele bate com a branch, e a `main` roda só os comandos do
    manifesto;
  - fechar a thread (`ork master`, `ork thread close`) solta os leases de escrita e as esperas dela
    na fila, com `lease_released` e `lease_dequeued` no ledger; espera de thread já fechada não barra
    mais quem pede a região;
  - o fechamento solta a reserva do item do roadmap, ou a passa para outra thread aberta do mesmo
    item; `ork roadmap reservas` marca a reserva órfã e `--soltar-orfas` a solta com registro;
  - o retrato da fábrica leva runtime, modelo e esforço de cada thread, do último `phase_dispatch`,
    e o `ork fabrica`, o `FABRICA.md` e o panorama da rede mostram;
  - `ork docs sincronizar` ganha `--so RM-NNN` e `--todos`; na worktree de uma thread com item, o
    padrão é o item dela;
  - `ork roadmap feat` reserva o próximo número de FEAT na branch `ork/roadmap-reservas`: duas
    máquinas não levam mais o mesmo número.
- **`ork board --json` vira objeto** ([RM-052](docs/roadmap/RM-052-projeto-alvo-explicito.md)):
  `{contrato: 'ork.board/v1', consulta, threads}`, com a lista de antes em `threads`. `board plan`,
  `fabrica` e `roadmap status` ganham o campo `consulta`; o snapshot do maestro ganha
  `project.root`, `project.remote` e `notConsulted`, opcionais no contrato `v1`.

### Corrigido

- **Defeitos de condução de 29/09/2026** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  - o despacho codex de bloco com GO grava a baseline antes de soltar a sessão, pela mesma
    execução do `ork verify --baseline`;
  - o modo plano do PLAN e o review nativo do CHECK valem só para o bloco que termina na fase de
    entrada: no #Auto, a sessão codex segue do PLAN ao GO e do CHECK ao SHIP como no claude-bg;
  - `ork phase run` recusa com `concurrency.limite` quando o projeto já tem
    `max_parallel_threads` sessões vivas em outras threads, e `--esperar` espera a vaga;
  - `ork decisao registrar` diz o campo e o tamanho quando o texto passa do teto;
  - `ork ci prepare` grava o bundle na worktree da thread, não na raiz do projeto;
  - o teste D-6 de modelo inacessível deixa de depender da corrida com o observador destacado.

## 0.4.3 — 29/09/2026

### Removido

- **Tools aposentadas no OpenClaw:** `ork_objective_status` e `ork_objective_message` saem do plugin.
  Desde a I-43 elas só devolviam a recusa `objective.aposentado`. O plugin fica com 23 tools.

### Corrigido

Sete defeitos de condução achados em 28/09/2026, que travavam a própria fábrica
([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):

- **Sessão claude-bg à espera humana depois do Stop.** A sessão que encerrava o turno e ficava em
  `blocked` com o processo vivo nunca concluía a fase, e a pausa humana não abria: uma ficou 41
  minutos travada até o processo morrer. Agora, na segunda leitura, abre `human.pending`, com a
  prova da fase ou com o que faltou dela no diagnóstico.
- **`ork sessions stop|logs|attach` com perfil de conta.** A sessão de um perfil que não é a
  conta do processo respondia "não encontrada no runtime". Agora ela é procurada em cada perfil
  claude-bg do projeto e o comando roda com o `CLAUDE_CONFIG_DIR` dela.
- **`ork_git_status` e `ork_git_commit` com hook próprio.** O `pre-push` da trava do corte fazia
  as duas ferramentas recusarem o repositório, embora o commit nunca o execute. Hook e seção
  `orkastery.*` do config que o commit nunca executa passam a ser aceitos; hook que ele
  executaria continua recusado, com o nome e a saída. O `ork_ship` do MCP segue estrito. Nenhum
  hook é desativado.
- **Contexto de despacho vazado.** O daemon do `claude --bg` guardava o ambiente do primeiro
  despacho da conta e o passava a todas as sessões reserva, que nasciam com a identidade de outra
  thread. A identidade agora vai por sessão em `--settings`, fica fora do ambiente do processo
  `claude`, e o CLI de dentro de uma sessão Claude só aceita a que o ledger liga à sessão dela.
- **`ork worktree sync` sobre base reescrita.** Numa branch sem commit próprio, cuja base ganhou
  raiz nova, o sync faria rebase de histórias sem relação. Agora a branch é recriada no SHA da
  base; com commit próprio, o sync recusa com o `git rebase --onto` exato. Na thread
  `merge-branch`, a ponta da branch existente nunca conta como base, para os commits dela não
  sumirem no sync.
- **Modelo inacessível na conta.** O despacho com um modelo que a conta não tem virava
  `runtime.unavailable` e repetia o mesmo modelo na mesma conta. O motivo novo
  `runtime.model-unavailable` mantém o perfil no rodízio, e o retry tenta outro perfil com o
  mesmo modelo, depois o fallback do bloco; sem destino, diz a correção exata do setup.
- **Teste instável no CI.** "N1 claude-bg com perfis a,b" esperava o resultado que só o
  observador destacado grava; agora conduz a observação no próprio processo, como a versão codex.

## 0.4.2 — 28/09/2026

### Mudado

- **Decisões do tamanho de um dia cheio** no README e no README do pacote: toda pergunta que o
  `ork` traz é curta, organizada, com alternativas e uma recomendação, pensada para quem conduz
  dezenas de frentes ao mesmo tempo.

### Corrigido

- **Sessões despachadas nascem sem escrita de grupo** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)).
  Com o `umask 002` comum em contas Linux, o Codex criava o histórico da sessão com escrita de grupo,
  o sensor recusava a fonte, e o `ork` perdia a visão da sessão, que seguia rodando sem registro. O
  `ork` agora acrescenta os bits 022 ao próprio umask ao iniciar, sem afrouxar um umask mais
  restrito, e tudo o que ele cria ou despacha herda isso.

- **Observação de sessão codex sob carga** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)).
  Com a máquina ocupada, o registro e o observador recusavam uma sessão legítima, e o `ork-verify`
  do CI caía com um teste diferente a cada rodada:
  - o `state.json` do controller, que o worker regrava por arquivo temporário e rename, trocava de
    inode entre a conferência e a abertura, e o sensor recusava a fonte. Agora ele confere e abre de
    novo, até cinco vezes, e só aceita o descritor cujo inode é o conferido;
  - o relógio de referência era lido antes do `state.json` e do rollout. O close e as linhas
    gravados durante a leitura pareciam do futuro, e o observador morria sem `phase_result`. Agora
    o relógio é lido depois da leitura, e o que vem do futuro de fato continua recusado.
- O teste da fonte corrompida corrompe o `launch.json`, que o controller grava uma vez só. No
  `state.json`, a regravação do worker podia desfazer a corrupção antes da validação.

## 0.4.1 — 28/09/2026

Primeira publicação da linha 0.4 no npm. A tag `v0.4.0` não chegou ao registro: a prova de origem
do npm recusou a URL do repositório escrita com maiúscula. Tudo o que está na 0.4.0, abaixo, sai
nesta versão.

### Corrigido

- A URL do repositório no pacote, nos READMEs, nos guias e nos modelos de issue passa a ser
  `github.com/orkastery/orkastery`, em minúsculas, como a prova de origem do npm exige. O
  workflow de publicação confere essa URL antes de compilar.
- **Três testes instáveis do CI** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  - o leitor de YAML do núcleo lia o SHA curto `0123456` como o número `123456`. Inteiro com zero à
    esquerda ou além da precisão segura agora fica texto, e o `ork docs verificar` deixa de acusar
    como inexistente um commit que existe;
  - o lock do observador de sessão caía com `ENOENT` quando o dono o soltava no meio do recovery
    de outro processo. Agora o outro processo assume o lock livre, e o resultado continua único;
  - as fixtures do controller simulado criavam pastas com o `umask` de quem roda. Em conta com
    `umask 002`, o sensor recusava, com razão, a fonte com escrita do grupo.

## 0.4.0 — 28/09/2026 (não publicada no npm)

### Adicionado

- **Lições viram avisos de policy** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md), fatia 3):
  `verify_regression` e `verify_failed` (bloco com GO sem baseline), `runtime_unavailable` (bloco
  sem runtime de fallback) e `tree_blocked` (ship com a branch atrás da base). Em `warn`, o gate
  imprime a correção exata e grava `policy_warn`, sem parar nada; em `block`, reprova como as
  outras policies. O `ork licoes` diz quais propostas já podem ser declaradas.

### Mudado

- **Nova frase de apresentação** no README e na descrição do pacote: "A software factory of AI
  agents that proves its work: parallel threads, verified results, and short decisions only when
  they matter."

### Corrigido

- `ork ci run` não rodava o `verify.preparo` do manifesto: a claim que usava a compilação do
  preparo passava no `ork verify` local e reprovava no CI. Agora os dois rodam o mesmo preparo.
- **Nenhuma superfície ensina comando aposentado**
  ([RM-046](docs/roadmap/RM-046-go-to-open-source.md)). As correções impressas pelo núcleo
  (`board`, `retry`, `fix`, `doctor`, `ship`), o guard e os comandos do Claude Code, as skills,
  os guias e a definição de pronto deixam de mandar rodar `ork gate approve`,
  `ork master --batch` e `ork objective`.
  - A pausa se libera pela resposta ao `ork gate request`, que chega pelo canal autenticado.
  - O push se autoriza no próprio `ork ship <thread> --para <base> --autorizar-push <quem>`.
  - As entregas se veem com `ork master`; a tool `ork_master_batch` do OpenClaw roda
    `ork master --todas --json`.
  - Os scripts `ork-objective-*` do Hermes saíram; as duas tools `ork_objective_*` do OpenClaw
    ficam no catálogo e dizem que devolvem a recusa `objective.aposentado`.

## 0.3.0 — 27/09/2026

### Adicionado

- **Modo `#Fast`** ([RM-042](docs/roadmap/RM-042-modo-fast.md)): uma fase só (GO), sem pausa,
  para pedido pequeno e claro.
  - Prova mínima: teste focado, claim de até dois comandos ou ausência declarada com
    `ork claims ausente`.
  - Não autoriza push sozinho e não commita arquivo de contrato público.
  - Default próprio: `claude-bg/sonnet/high`, com fallback `codex:gpt-5.6-terra:high`.
- **Condução multicanal** ([RM-036](docs/roadmap/RM-036-maestro-multicanal.md)): um dono,
  vários canais, e nunca duas execuções na mesma worktree.
  - Despacho, `ork verify`, GO-FIX, retomada e o `ork_verify` do MCP tomam o lease
    `exec:<thread>`, e o segundo pedido sai na hora com quem conduz e três ações: esperar
    (`--esperar`), acompanhar (`ork conducao status`) e assumir (`ork conducao assumir`).
  - A mesma fase com o mesmo pedido devolve a sessão em andamento, sem sessão nova.
  - Todo despacho grava o canal de origem, e a linha "conduzido agora por ..." é a mesma no
    board, no monitor, no pulse, no `ork thread status` e no panorama do Maestro.
- **Reservas de item do roadmap entre máquinas**
  ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)): `ork roadmap reservas`,
  `ork roadmap pegar` e `ork roadmap soltar`, e `ork thread new --roadmap RM-NNN`. A reserva é
  gravada por push atômico numa branch própria: duas máquinas não pegam o mesmo item.
- **HITL em camadas** ([RM-041](docs/roadmap/RM-041-hitl-invertido.md)): a decisão óbvia vem
  tomada e chega no resumo (`ork decisao registrar`). Pergunta real vem com contexto,
  alternativas e recomendação, e o dono responde em lote.
- **Documentação como código** ([RM-044](docs/roadmap/RM-044-documentacao-como-codigo.md)):
  `ork docs verificar`, `ork docs sincronizar` e `ork docs init` conferem a documentação de
  produto e o roadmap contra o código e o git.
- **Pulse enxuto** ([RM-045](docs/roadmap/RM-045-pulse-enxuto.md)): a fila só traz quem pode
  responder, e a varredura cabe no teto de tempo.
- **Rotação de contas dos runtimes** ([RM-033](docs/roadmap/RM-033-rotacao-de-contas.md)):
  `ork accounts` e ordem de fallback por bloco (`ork setup <modo> --bloco N --fallback`). O
  login é sempre do próprio CLI do runtime.
- **Horário do dono** ([RM-035](docs/roadmap/RM-035-horario-do-dono.md)): `owner.timezone` no
  manifesto vale em toda superfície humana.
- **Radar e entrega** ([RM-001](docs/roadmap/RM-001-radar-ork-pulse.md),
  [RM-003](docs/roadmap/RM-003-hitl-bidirecional-telegram.md),
  [RM-005](docs/roadmap/RM-005-master-e-digest.md)): `ork pulse`, HITL pelo Telegram e digest
  semanal do MASTER.
- **Telemetria, onboarding e playbook** ([RM-007](docs/roadmap/RM-007-telemetria-economica.md),
  [RM-015](docs/roadmap/RM-015-onboarding-do-nucleo.md),
  [RM-009](docs/roadmap/RM-009-playbook-dos-runtimes.md)): `ork ledger stats`, `ork onboarding`
  e limites por bloco.
- **Estado de conta compartilhado entre projetos**
  ([RM-040](docs/roadmap/RM-040-estado-de-conta-compartilhado.md)): cota esgotada, login perdido
  e credencial paga valem para a conta em todos os projetos do mesmo usuário, e nenhuma fábrica
  despacha numa conta que outra já viu esgotada.
- **Verify que diz por que falhou** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  - estouro de prazo vira o motivo `verify.timeout`, que o retry reexecuta, em vez de reprovar a
    alegação;
  - `verify.timeout_ms` e `verify.timeout_ms_por_comando` no manifesto;
  - o ledger guarda, por comando que falha, a causa, o prazo, a duração, os testes que caíram e o
    trecho da saída redigido.
  - o lint do comando de claim: `ork claims add` avisa, e `ork ci prepare` recusa a claim que
    roda a suíte inteira do npm no runner do CI;
  - `verify.preparo` compila uma vez por rodada e confere o produto do preparo ao fim; comando que
    não rodou nunca vira verificado (`verify.sem-veredito`).
- **Cadência do pulse pela tag do dono**
  ([RM-039](docs/roadmap/RM-039-cadencia-do-pulse-por-tag.md)): o dono manda `#OrkPulseOff` (8h,
  às 08h, 16h e 00h), `#OrkPulseOn` (2h) ou `#OrkPulseOn-15m`, `-30m`, `-60m` no Telegram, ou usa
  `ork pulse cadencia`, sem editar o crontab. Pergunta nova sai na hora, qualquer que seja a tag.
- **Fábrica compartilhada entre máquinas**
  ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)): `ork fabrica entrar` dá nome à
  máquina e a faz publicar o retrato das próprias threads na branch `ork/fabrica-estado`.
  `ork board`, `ork fabrica` e o resumo do pulse mostram as outras máquinas, e pergunta que
  espera o dono em outra máquina chega na hora. Guia: [Várias máquinas](docs/guias/varias-maquinas.md).
- **Setup por bloco versionado** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)):
  `ork setup versionar` grava `orkastery.setup.json` no repositório, e todas as máquinas despacham
  com o mesmo runtime, modelo e esforço por bloco.
- **Loop de aprendizado** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md)): a lição das
  threads fechadas pelo MASTER volta no GOAL e no PLAN da próxima thread, em qualquer regime de
  memória, e a mesma falha em 3 threads em 30 dias vira proposta de policy (`ork licoes`).
- **`ork demo`** ([RM-046](docs/roadmap/RM-046-go-to-open-source.md)): em 30 segundos, offline e sem
  conta, uma afirmação falsa do agente reprovada pelo `ork verify` e a corrigida aceita.
- **Entrega por PR fecha pelo MASTER** (`ork ship registrar-pr`): o merge `ship(<thread>)` com CI
  verde vira `ship_done`, e a thread entregue por PR deixa de ficar aberta para sempre.
- `ork --version` imprime só a versão.

### Mudado

- O template do cron do pulse bate de 15 em 15 minutos e o núcleo decide o que sai. Quem tem a
  linha de hora em hora troca `0 * * * *` por `*/15 * * * *` e reinstala os adaptadores do
  Telegram.

- **`#Look` e `#Ork` aposentados** ([RM-043](docs/roadmap/RM-043-aposentadoria.md)). Quem
  escreve um deles recebe a recusa tipada `modo.aposentado`, e o que já foi gravado continua
  legível para sempre. `ork modos migrar` limpa o `orkastery.yaml` e o `setup.json`.
- `ork objective` saiu: as duas garantias viraram `--exige-runtime-diferente` e `--done` em
  `ork thread new`.
- A fila de `ork master --batch` saiu: a entrega fecha com o índice derivado do ledger, e a nota
  humana, quando vier, sobrescreve.
- A versão do `ork` sai do `package.json`, e o pacote deixa de levar testes e arquivos internos.
- **README canônico em inglês** ([RM-046](docs/roadmap/RM-046-go-to-open-source.md)): o
  `README.md` do repositório e o do pacote no npm passam a ser em inglês, e a versão em
  português do repositório fica em `README.pt-BR.md`, com seletor nas duas. O titular da
  licença MIT passa a ser Julio Pessoa.

### Corrigido

- `ork --version` imprimia a ajuda inteira.
- Uma thread `#Fast` entregue derrubava `ork master`, o aceite por omissão e o pulse com "fase
  MASTER não pertence a nenhum bloco". O ciclo do `#Fast` não tem MASTER: o score dele é de lote.
- Fase despachada de dentro de uma worktree lia o setup da própria worktree e caía no default; o
  setup local agora vem da raiz de estado.

## 0.2.0 — 05/09/2026

Primeira versão publicada no npm: núcleo `ork` com threads de seis fases, cinco modos por #TAG,
claims, `ork verify`, `ork ship` com push provado, worktrees e leases, board, retry tipado,
handoff e memória opcional.
