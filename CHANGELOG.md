# Changelog

As mudanças do pacote [`@orkastery/cli`](https://www.npmjs.com/package/@orkastery/cli), da mais
nova para a mais antiga. O detalhe de cada item, com a evidência de merge, está no
[roadmap](docs/roadmap/README.md).

## Não publicado

### Adicionado

- **CLI em inglês e pt-BR — F3e ([RM-061](docs/roadmap/RM-061-cli-em-ingles-e-pt-br.md)):** entram no catálogo as rotas restantes de `master`, `onboarding sync`, `experiencia uninstall`, `doctor --modo`, Maestro, `brain`, `activation`, `mcp serve`, `receipt-verifiers` e as recusas antecipadas de projeto; o grafo e o `security-scan` localizam a apresentação humana sem mudar códigos, dados ou `--json`.

### Corrigido

- **O teste das lanes não herda o plano de CPU da rodada:** `ORK_CHECK_CPUS_DA_LANE` e `ORK_CHECK_CPUS_DOCKER`
  continuam limitando a própria lane, mas não chegam aos testes que ela executa. Sob saturação, os testes que conferem
  a concorrência da lane e os argumentos do Docker viam a fatia da rodada e reprovavam sem defeito no código
  ([RM-074](docs/roadmap/RM-074-agile-check-tres-vezes-mais-rapido.md)).
- **O verify faz classificação por teste dentro de comandos que já falhavam** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  a baseline guarda os nomes que o TAP já produz, e a rodada separa por igualdade exata regressões, falhas
  pré-existentes e testes corrigidos. Uma falha nova bloqueia com `verify.regression` e leva o nome no motivo;
  teste renomeado conta como antigo corrigido e novo em regressão. Baseline antiga ou comando sem nomes mantém
  a comparação por comando, mas o veredito declara o fallback e não inventa “0 regressões” por teste.
- **Teste da validade inicial da fixture isolado:** a fixture respeita `TMPDIR`, e o teste não observa mais o `/tmp`
  compartilhado nem vence após 5 segundos sob carga ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)).
- **Claims executáveis no CI e CHANGELOG na seção certa** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  `ork claims add` e o MCP recusam antes da gravação comandos com `rg`, `ork` fora do PATH, estado em `.orkastery/`
  ou aspas `\x22`/`\x27` literais, indicando `grep` e `node core/dist/index.js`; `ork ci prepare` mantém apenas aviso
  para claims antigas. Em repositório com `CHANGELOG.md` e tag publicada `v*`, o verify, `ork docs verificar --pr` e o
  CI também recusam linha nova em versão já tagueada e exigem que a entrada de "Não publicado" fique sob Adicionado,
  Alterado, Corrigido ou Segurança; sem arquivo ou versão publicada, a regra não entra no verify.
- **Fila pesada entre host e sandbox** ([RM-064](docs/roadmap/RM-064-conta-esgotada-nao-para-a-fase.md)):
  o lease combina a trava do kernel com batida em arquivo, identidade opaca do host e do espaço de PIDs e o instante de
  início lido de `/proc/<pid>/stat`. PID invisível ou evidência insuficiente agora é lease indeterminado, nunca órfão;
  a sessão espera com `--esperar` ou deixa um pedido tipado para a condução.
- **Parada intencional não vira queda do runtime** ([RM-055](docs/roadmap/RM-055-impedimento-do-dono-vira-hitl.md)):
  a sessão `worktree` ganha somente `ork_request_conduction`, vinculada ao próprio despacho, para registrar um motivo
  enumerado e um comando `ork` exato sem executá-lo. O watcher preserva o pedido em vez de sintetizar
  `runtime.unavailable`, o retry não redespacha enquanto ele está aberto e o relatório o mostra em “Conosco”.

### Segurança

- **Evidência de máquina e relato honesto de escape** ([RM-062](docs/roadmap/RM-062-repositorio-publico-sem-dado-privado.md), F3 e F4): o retrato da Orkastery Network exige um alias local e o repete em `maquina`, no campo legado `hostname` e no nome do arquivo, sem publicar o hostname real; o guia de pull request ganha um modelo testado que separa o que foi corrigido, o que continua nos commits anteriores e a decisão do dono sobre reescrever ou não.

## [0.6.1] - 2026-10-29

O Grok Build entra por despacho explícito (`--runtime grok`), com perfis de conta, setup e MCP, ainda sem homologação real: o ensaio real (F5) falta.

O Agile Check passa a agendar o trabalho pela CPU da máquina, e a bancada de medição compara Agile e Classic na mesma máquina.

O #Noctum segue **em desenvolvimento, não anunciado** e ainda não validado.

### Adicionado

- **Grok Build por despacho explícito** ([RM-067](docs/roadmap/RM-067-grok-build-homologado.md), F1 e F2):
  `ork phase run <thread> <FASE> --runtime grok --model <modelo>` despacha a fase pelo Grok Build headless (`grok -p`
  com `--output-format streaming-json`), com o id da sessão escolhido pelo `ork`, a sessão conferida na pasta que o
  runtime grava, o filho sem `XAI_API_KEY` e o sandbox `workspace` de piso. O watcher fecha a fase pelo evento `end` do
  stream e pelo recibo de saída do supervisor: `end_turn` só conclui com a prova do `ork`, a saída 1 com objeto `error`
  vira parada tipada, 130, 143 e `cancelled` sem objeto `error` vão ao dono com a retomada `grok -p continue -r <id>`,
  e o stream sem `end` vira `runtime.unavailable` depois do prazo. Sem a chave, o despacho real autentica pelo login
  da assinatura que o `grok` guardou no `GROK_HOME`, a alternativa da D1 em zona cinza da política de uso: nenhuma
  conta real deve despachar antes da decisão do dono. O `grok` não é padrão de bloco, nem fallback, nem
  `runtime.adapter`, e ainda despacha sem o MCP do `ork`; perfis de conta, login e cota (F3, que espera a decisão D1
  do dono), setup, MCP e onboarding (F4) e o ensaio real (F5) ficam para depois. O `claude-bg` e o `codex` não mudam.
- **Perfis de conta do Grok Build** ([RM-067](docs/roadmap/RM-067-grok-build-homologado.md), F3): com a D1 decidida pelo
  dono em 27/10/2026 (a assinatura agora, com o risco da política de uso aceito), `ork accounts add <id> --runtime grok
  --dir <dir>` cria o perfil com o `GROK_HOME` dele e roda `grok login` (ou `grok login --device-auth`, com
  `--device-auth`); o `ork` nunca lê nem copia o `auth.json`. O despacho `--runtime grok` sai pelo perfil da vez, e o
  perfil esgotado, sem login, pago ou desativado não recebe despacho. O `grok` não documenta conferência de login: o
  perfil entra sem conferência prévia, e o erro de login do despacho o tira. O formato da cota esgotada do `grok` não
  está confirmado: nenhum texto dele vira cota esgotada, e o `grok` fica fora da escada automática e do fallback até o
  ensaio real (F5). O `claude-bg` e o `codex` não mudam.
- **Grok Build no setup do bloco** ([RM-067](docs/roadmap/RM-067-grok-build-homologado.md), F4): `ork setup <modo>
  --bloco N --runtime grok --model <modelo>` e o fallback `grok:<modelo>[:esforço]` aceitam o `grok`, sempre com o
  modelo do dono e nunca como `runtime.adapter`; o `eco` vira `minimal` no `--effort`. A postura `danger-full-access`
  vira o sandbox `off` do `grok` só com `ork setup sandbox confirmar`, senão o despacho recusa com
  `runtime.sandbox-nao-confirmado`; o comando confia a worktree (`--trust`), e o `AGENTS.md` dela entra na partida. O
  `ork retry` troca o perfil do `grok` também num projeto com o MCP do `ork`, e o `ork sessions` lista as sessões dele.
  O `claude-bg` e o `codex` não mudam.
- **Host MCP do Grok Build** ([RM-067](docs/roadmap/RM-067-grok-build-homologado.md), F4b): `ork mcp install --project
  <raiz> --host grok` grava a entrada `orkastery` no `.grok/config.toml` do projeto, com o perfil filho, e recusa a
  entrada divergente como os outros hosts. O `ork mcp serve --host grok` só serve a sessão filha (sem `--thread`, recusa
  com `mcp.host.child-only`) e lista só as ferramentas do perfil filho, as que o `--allowedTools` do `claude-bg` libera.
  Num projeto preparado, o despacho `--runtime grok` de uma thread com worktree própria grava nela, fora do git, a config
  com o servidor vinculado à thread e ao despacho, leva um `--allow MCPTool(orkastery__<ferramenta>)` por ferramenta
  liberada e roda o filho sem o MCP do Claude e do Cursor. O `ork_phase_run` do MCP aceita o `grok`, a tela do setup o
  lista, e o watcher refaz a prova do `ork` sob o lock da sessão. O `claude-bg` e o `codex` não mudam.
- **MCP do `ork` fora do sandbox do Grok Build** ([RM-067](docs/roadmap/RM-067-grok-build-homologado.md), F4c): o
  sandbox do `grok` vale para ele e os filhos, e o servidor MCP do `ork` que ele subia lia o estado sem gravar. Agora,
  com o MCP do `ork`, o despacho `--runtime grok` sobe antes do `grok` um servidor do próprio `ork`, fora do sandbox:
  Streamable HTTP só em `127.0.0.1`, porta efêmera, token de 256 bits por despacho só no ambiente do servidor e do
  `grok` (`bearer_token_env_var`), nunca em arquivo, com o sandbox a conexão só da árvore de processos do `grok` do
  despacho (quando ele deixa ler os descritores), só as ferramentas do `--allow` daquele despacho, e o servidor morre
  com a sessão. A sessão `grok` no piso `workspace` grava o ledger, os artefatos e o git da worktree pelo núcleo, e o
  `grok` volta a ser destino de fallback de um projeto com o MCP. O `grok` segue no `workspace`, sem
  `danger-full-access`, `--yolo` ou `bypassPermissions`, e a retomada manual avisa que roda sem o MCP do `ork`. O
  `claude-bg` e o `codex` não mudam.

- **Preparação dos pilotos em duas máquinas do #Noctum (RM-058)**: `ork noctum maquina [--json]` dá nome, chave
  pública e impressão para o envelope `v3`; o passo supervisionado usa a coordenação da máquina, a retomada exige o
  recibo de fim antes de transferir trabalho, e fila, fechamento, relatório, guarda e entrega consideram a rede e a
  vez global. O aceite combina os arquivos das demais máquinas por `--outra-maquina`, P3 e P4 exigem ao menos duas
  máquinas quando forem conferidos, e o cenário `duas-maquinas` exercita F10 e F11 apenas em fixture simulada.
  Nenhum piloto em duas máquinas rodou; o #Noctum segue em desenvolvimento, não anunciado.
- **Bancada de medição do CHECK** ([RM-074](docs/roadmap/README.md), M0): `node core/scripts/medir-check.cjs --bancada`
  roda, numa cópia descartável e no mesmo commit, pares de Agile Check e Classic Check e um passe que mede cada arquivo
  de teste sozinho (`user`, `sys`, parede, pico de memória e testes), espera a máquina quieta antes de cada rodada,
  grava o roubo de CPU e calcula a razão entre os modos, a eficiência de paralelismo por lane e o corte de CPU contra a
  linha de base. A linha de base da M0 está em `docs/roadmap/evidencias/RM-074/`. O Classic Check e o Agile Check não
  mudam.

### Corrigido

- **Agile Check agenda o grupo pela CPU da máquina:** a lane hermética, a varredura e a integração dividem a mesma
  conta de CPUs, e todo contêiner recebe `--cpus` com a sua cota. Se carga ou steal indicarem saturação, o `verify`
  executa hermética, varredura e integração na ordem do Classic, registra peça e motivo no `verify_run` e usa uma CPU
  a menos; arquivos de teste, categorias e ferramentas de varredura permanecem os mesmos.
- **A paridade do índice do roadmap reprova ainda no PR:** `ork docs verificar --pr` deixa de rebaixar
  `docs.paridade.indice` para aviso; a janela entre o merge de outra thread e a atualização da página continua aviso.
- **A entrega por PR reconhece a mensagem padrão da forja:** `ork ship registrar-pr`, `--todas`, a paridade de docs,
  o condutor e `ork ship publicar` aceitam tanto `ship(<thread>)` quanto os merges padrão do GitHub e do GitLab,
  vinculados pela branch exata da thread. Revert, citação só no corpo e branch de outra thread com prefixo parecido
  continuam fora; com CI obrigatória, squash/rebase sem segundo pai segue recusado por `entrega.sem-vinculo`.
- **O `ork retry run` guarda a conta pedida com `--perfil`:** o despacho barrado antes de abrir a sessão agora grava
  o perfil pedido no ledger (`perfilPedido`), e o retry e a retomada da fila voltam a ele. Se ele estiver sem login,
  esgotado ou for de outro runtime, recusam com motivo tipado e a correção, em vez de redespachar em outra conta sem
  avisar. A rotação por falha da própria conta e o despacho sem `--perfil` seguem como antes.
- **A dívida do Agile Check que pesava na confiança** ([RM-074](docs/roadmap/RM-074-agile-check-tres-vezes-mais-rapido.md),
  F4): o motivo da peça `imagem-de-lint` chega ao ledger sem login de URL. A lane de teste que não termina sozinha
  fora do tempo (sinal, comando ausente, código de quem não a deixou terminar) não tira mais o veredito do `test`
  inteiro: ele é comparado com a baseline como o comando único do Classic, nem mais nem menos estrito. O texto do
  gate diz qual lane ficou sem veredito e por quê. A legenda do fuso sai `GMT+0` também no ICU que escreve só `GMT`.
  O panorama da rede omite o ano pela hora da leitura, e o retrato pt-BR F3c não fica vermelho em 01/01/2027. O
  trabalhador da varredura roda sem string de shell. A varredura do Agile ganha o caso com Docker real na lane de
  integração. O CI confere a paridade do `tsgo` com o `tsc` em todo PR. O Classic Check não muda.

### Segurança

- **SDK do MCP 1.32.2** (GHSA-f897-62hf-6gxq): o `@modelcontextprotocol/sdk` sai da 1.29.0, cujos transportes
  HTTP não limitavam o tamanho do corpo nem o lote de JSON-RPC; o `qs` transitivo também sai da faixa do
  GHSA-6pq8-jhm2-2vcw.

## [0.6.0] - 2026-10-26

O CHECK padrão passou a ser o **Agile Check**; para voltar ao Classic, use `check.mode: classic` no `orkastery.yaml` ou `ork verify --check classic`.

O #Noctum segue **em desenvolvimento, não anunciado** e ainda não validado.

### Adicionado

- **Agile Check e Classic Check** ([RM-072](docs/roadmap/RM-072-check-cinco-vezes-mais-rapido.md)): o `ork verify`
  ganha dois modos de CHECK com a mesma cobertura, escolhidos por `check.mode: agile | classic` no `orkastery.yaml` ou
  por `ork verify <thread> --check classic|agile` na rodada, que vence o manifesto. O Classic Check é o CHECK de sempre:
  os mesmos comandos, a mesma ordem e as mesmas ferramentas. O Agile Check roda o preparo uma vez e as claims contra o
  produto dele, com guarda de hash, e as lanes de teste e a varredura em paralelo sem passar da CPU da máquina (a lane
  que sobe containers espera a varredura, por `check.agile.apos_a_varredura`), com o banco do Trivy em cache, a imagem
  de lint pré-montada, o binário nativo primeiro e, neste repositório, o `tsgo` no preparo da árvore fria; a peça
  indisponível cai para o equivalente do Classic e fica registrada no `verify_run`. Nos dois modos, o
  `verify_run` grava o modo, de onde ele veio e a duração de cada comando, claim e rodada, e o parecer do CHECK e o
  `pr-body.md` dizem o modo da rodada. `osv-scanner` e `oxlint` ficam atrás de `check.agile.osv_scanner` e
  `check.agile.oxlint`, desligados.
- **Portão de release do #Noctum (RM-058)**: por decisão do dono, somente a versão que anuncia o produto exige o P1 real de 6 h, aprovado e ratificado depois do piloto; o alcance `toda-versao` só volta por decisão futura dele, e P2, P3 e P4 ficam para versões seguintes.
- **Recusas visíveis no #Noctum (RM-058)**: a supervisão e o relatório da manhã mostram a recusa que impediu o despacho, e `ork noctum propor` avisa quando o cron não poderá reconferir a prova pública do dono.
- **DSN da memória fora do ambiente dos agentes (RM-069)**: `memory.database_url_file` declara a DSN da memória por
  um arquivo da pasta de segredos do `ork` (`~/.orkastery/segredos/<nome>`, que segue `ORKASTERY_HOME`), em vez da
  variável de `memory.database_url_env`; as duas fontes são exclusivas e o `ork` nunca cai de uma para a outra. O
  arquivo só é lido como arquivo comum do usuário que roda o `ork`, sem link simbólico no caminho (cada pasta da casa
  do usuário até o arquivo é conferida antes de abrir, e a pasta do usuário vinda de `ORK_USUARIO_DIR` ou
  `ORKASTERY_HOME` só vale dentro da casa, sem `..` e do próprio usuário), com permissão `0600` ou `0400` exata, até 4 KiB
  e uma linha só com a DSN (`esquema://...`); ausente, inseguro ou inválido, a memória degrada para `files` com
  `dsn.arquivo-ausente`, `dsn.arquivo-inseguro` ou `dsn.arquivo-invalido`. O driver do OrkMind, o cliente e a
  migração do Company Brain e o `ork doctor` leem a DSN pelo mesmo resolvedor, e ela continua indo só ao ambiente do
  processo filho. A resposta do filho que repita a DSN ou a senha dela, de qualquer tamanho, é recusada inteira, nas
  duas fontes, com `brain.transport.secret`, `brain.migration.secret` ou `memory.transport.secret`, sem o valor. O
  `ork doctor` ganha os checks "fonte da DSN" (a variável pelo nome ou o arquivo pelo caminho com `~`, nunca o valor)
  e "DSN no ambiente" (numa sessão despachada, os nomes das variáveis com a DSN do projeto ou com URL com senha), e o
  `ork memory status` mostra o arquivo. O erro de `memory.database_url_env` inválido deixa de repetir o valor. O
  agente roda com o mesmo usuário e pode ler o arquivo: o ganho é a senha fora de `env`, da transcrição e do contexto
  do modelo.
- **O dono aprova onde estiver, com resposta curta** ([RM-057](docs/roadmap/RM-057-hitl-por-alternativas.md), na
  [RM-058](docs/roadmap/RM-058-modo-noctum.md)): a proposta do arco do #Noctum (`ork noctum propor` e
  `ork_noctum_propor`) e a revogação pedida (`ork noctum revogar <arco>`, novo) viram a pergunta ao dono com código
  curto, três alternativas e "Responda a, b ou c", que sai também no canal dele pelo transporte do pulse; o hash fica
  na pergunta, nunca na resposta. O dono responde com a letra: no Telegram do Hermes e do OpenClaw, em reply à
  mensagem da pergunta (só a mensagem em que ela foi entregue vale: o transporte devolve o id dela, e o gateway assina
  o código do título e o id da mensagem respondida no endereço `resposta:<código>:<id>`, passado ao
  `ork pulse responder` por `--em-resposta-a`), com o código, com o número ou com a palavra solta sem reply quando só
  uma pergunta espera no chat; em reply a qualquer outra mensagem (a confirmação de um gate, a mensagem de outra
  pessoa do grupo), a palavra solta vai ao núcleo marcada (`resposta:outra`, `--em-resposta-a outra`) e é recusada
  com o porquê, sem gravar nada; e no diálogo nativo, agora com três alternativas. No terminal do Claude Code, o hook
  `UserPromptSubmit` do plugin e o `ork noctum terminal --hook-stdin` (novo) não gravam nada por enquanto: o
  ingresso do terminal está desligado até o Claude Code mandar a origem humana do evento (o 2.1.306 instalado não
  manda o campo `source`) e haver prova de que o evento veio do hook, e não do agente da própria sessão; quem
  responde lá ouve que responda pelo Telegram ou pela janela de confirmação do Claude Code. A confirmação do "b"
  nunca é pergunta, uma mensagem responde a uma pergunta só, e o vocabulário ganha "autorizo" e "adiar". Com duas
  pendentes, a palavra solta volta perguntando qual; nada é gravado sem pergunta, depois do prazo, de outro chat ou
  com a mesma mensagem. O `/ork noctum <arco> autorizar <sha256>` segue aceito, mas não é mais ensinado.
  Formatos sem ratificação que mudam: o recibo `ork.noctum-ingresso/v1` ganha a `pergunta`, o endereço assinado e a
  origem `terminal`; o log do arco ganha o `codigo` da proposta e o evento `revogacao_pedida`; o diálogo `ork.noctum-dialogo/v1` ganha as alternativas; nascem
  a decisão do hook e o domínio da subchave do recibo do terminal (`ork.noctum-terminal/v1`, com a recusa
  `noctum.terminal.desligado`), a pergunta do arco
  (`ork.noctum-pergunta/v1`) e os registros das mensagens usadas (`ork.noctum-mensagem-usada/v1`) e das respostas b e c
  (`ork.noctum-sem-efeito/v1`); o lote servido (`ork.pulse-lote-servido/v1`) ganha a pergunta do arco, com o destino e
  os ids da entrega; o texto do contrato curto (`ork.hitl-curto/v1`) ganha a última linha "Responda a, b ou c"; e o
  endereço assinado do pulse ganha a forma do reply e a marca do reply a outra mensagem. O envelope do arco e a prova
  dos gates não mudam. O ensaio do modo abre os arcos pela resposta curta e ganha o cenário `resposta-curta`.
- **Barreira de dado privado (RM-062, F1 e F2)**: `ork privado varrer` varre as linhas e os nomes de arquivo
  versionados atrás de caminho de home, e-mail fora da lista permitida, hostname no formato de máquina e os termos de
  uma lista local que fica fora do git (`termos-privados.txt` em `~/.orkastery/` e em `.orkastery/` do projeto, ou o
  arquivo de `ORK_TERMOS_PRIVADOS`); ela só é aceita como arquivo comum do usuário atual, sem link simbólico e com
  permissão `0600`; sem a lista, só os padrões genéricos, e a saída diz isso. A árvore e o diff incluem conteúdo
  binário com texto literal, inclusive sob `-diff`, sem descomprimir nem decodificar outros formatos. O
  relatório diz arquivo, linha, coluna e padrão, nunca o valor, o caminho da lista ou o detalhe de uma exceção sem uso,
  e mascara o nome de arquivo com achado. As exceções em `orkastery.privado.json` exigem padrão e valor exato sem
  curinga, com caminho só como filtro e sem curinga semanticamente global; cada e-mail permitido é exato e tem motivo.
  A detecção de e-mail encerra a autoridade de URL nos separadores de documento, inclusive o `;` do CSV. Com a policy
  `dado_privado` no manifesto, o
  `ork verify` varre o diff da thread (reprova com `policy.violation` em `block`; grava `policy_warn` em `warn`) e o
  `ork ci prepare` recusa gerar o bundle com achado; sem a policy, os dois não mudam. No CI do núcleo, a varredura é
  um passo do job `documentacao`, e as fixtures da API do GitHub, um teste da rede e um bundle antigo deixaram de levar
  dado pessoal do dono.
- **`ork security-scan`: segurança e qualidade de código no CHECK**: o novo comando varre o HEAD e a base com as
  ferramentas oficiais em Docker, fixadas por digest (Gitleaks, Semgrep, Trivy, zizmor, actionlint, `npm audit`,
  `pip-audit`, `govulncheck`, ESLint, Ruff e golangci-lint, para JavaScript/TypeScript, Python e Go), e compara por
  impressão digital: cada achado é `new`, `existing` ou `dismissed`. Segredo novo e vulnerabilidade `high` ou `critical`
  nova (dependência, SAST, IaC, workflow) fazem o comando sair 1; qualidade e licença só reportam. O relatório
  (`report.json`, contrato `ork.security-scan/v1`, e `report.md`) vai para `.orkastery/security-scan/<sha>/` e nunca leva o
  valor de um segredo. A config da app mora em `.ork-security/` (`config.json` e `dismissals.json`, com `reason` e
  `decisionRef`). Com `verify.security_scan` no manifesto (o `ork init` grava quando acha uma stack), o `ork verify` roda o
  scan como quarto comando, o CHECK faz a triagem de cada achado novo com o `security-auditor` e o GO-FIX corrige pela skill nova
  `security-remediation`; o `ork ci prepare` leva o scan ao bundle com `ORK_SECURITY_SCAN_REQUIRED=1`, e o `ork doctor`
  ganha o check "security scan". Sem Docker nem binário nativo a ferramenta fica `unavailable` (saída 0), e o `ork ship`
  de projeto sem CHECK independente exigido para com `human.pending` até a autorização de `--allow-unscanned "<quem>"`,
  gravada no ledger como `ship_unscanned_authorized`. Sem `verify.security_scan`, nada muda. Guia em
  [`docs/guias/verificacao.md`](docs/guias/verificacao.md#8-security-scan-segurança-e-qualidade-pelo-comando-não-pela-leitura)
  e referência em [`docs/referencia/cli.md`](docs/referencia/cli.md#varredura-de-segurança).
- **SHIP do MCP por qualquer forja**: dois transportes novos no `ork mcp install --ship-transport`. `forja-ssh` aceita
  host e porta da forja (inclusive `forja.ssh_host`/`ssh_porta`), fixa na instalação a chave do servidor confirmada
  pelo `known_hosts` da pessoa ou por `--ssh-fingerprint`, e confere a chave a cada push com
  `StrictHostKeyChecking=yes`, sem config de SSH do usuário. `forja-https` zera os helpers de credencial da config e
  usa só o `auth git-credential` do `gh`/`glab` com login no host, sem prompt, com a CA do `forja.ca` conferida pelo
  hash. A fixação mora fora do projeto (`$XDG_CONFIG_HOME/orkastery/mcp-ship/`) e é reconferida em cada passo do
  worker. O push e a prova saem de um gitdir privado direto para a URL fixada, e mudança do origin ou da config durante
  o push deixa a entrega sem prova (`mcp.ship.transport.mudou-no-push`). Nos modos `forja-*`, a publicação da fábrica em
  segundo plano e as consultas `ork_fabrica` e `ork_roadmap_reservas` ficam indisponíveis por ora. `github-ssh` e
  `bare-local` não mudam; sem a opção, a instalação é a de sempre e propõe o modo do origin. Contrato em
  [`docs/referencia/contratos/forja.md`](docs/referencia/contratos/forja.md#transporte-do-ship-pelo-mcp).
- **Entrega no GitLab**: o `ork ship publicar` abre MR no GitLab nos mesmos `#Auto` e `#Maestro`, com as mesmas
  conferências e recusas, a descrição pelo stdin e sem merge automático, provado pela releitura da lista; o
  `ork ship pista` lê os MRs e a CI do head pela regra única de estado; o `ork ship registrar-pr --repo --pr` reconhece
  MR mesclado do GitLab (inclusive pelo método `ff`), e o `ci.external_repositories` aceita `grupo/subgrupo/projeto`. A
  publicação acha a forja pelo resolver, e não pelo nome do host; o `registrar-pr --repo` não tem host de reserva (remoto
  de forja que não se resolve é recusado com `entrega.sem-leitura`, e subgrupo no GitHub com `entrega.forja-mista`). O
  push da base recusado pela proteção da branch (GitHub: `GH006` ou "protected branch hook declined"; `GH013` só com a
  mensagem de proteção da branch; recusa de segredo nunca; GitLab: "not allowed to push code to protected branches")
  vira `entrega.base-protegida`, com a orientação de entregar por PR/MR; o motivo do gate não muda. Nenhum modo de
  entrega mescla PR ou MR; a batida do condutor (RM-063) continua mesclando só PR do GitHub, com autorização, e a
  entrega do #Noctum continua só no GitHub. Muda para todos: remoto GitHub Enterprise sem o bloco `forja:` e sem login da `gh` nele passa a
  ser recusado pelo `ork ship publicar` e pelo `registrar-pr --repo` antes de qualquer escrita (`forja.desconhecida`
  ou `entrega.sem-leitura`), pedindo `forja.tipo`. Contrato em
  [`docs/referencia/contratos/forja.md`](docs/referencia/contratos/forja.md#entrega).
- **`ork ship pista` no GitLab**: a pista lê os MRs de cada branch candidata (até 20 por chamada) e a CI do head pelo mesmo
  mapa do GitHub (`manual`/`skipped` contam como verde só na pista). O `ork.ci-status/v2` ganha o campo opcional
  `bloqueado: true`, e o gate segue reprovando. Num host próprio sem o bloco `forja:`, a pista resolve a forja uma vez,
  como o pulse, e o comando do dono nos modos sem push usa o tipo sabido sem rede (o bloco, o host conhecido ou a
  sondagem em cache); sem ele, mostra o do `gh` e o do `glab`. O `ork ship publicar` e o `registrar-pr --repo` passam
  a usar o cache de 24 h da sondagem.
- **Pulse e rede no GitLab**: o pulse lê os MRs da base em uma consulta GraphQL, com a pipeline do head e o job do
  check da CI (`ci.context`); a forja do pulse é resolvida pelo manifesto e pela CLI com login, nunca pelo nome do
  host; o retrato `ork.prs-abertos/v1` aceita subgrupos. A rede usa a API da CLI logada (host com porta por
  `GITLAB_HOST`, login conferido antes, corpo com `Content-Type`), e a casa da rede pode morar num grupo em que a
  pessoa é Maintainer ou acima (`ork network entrar --repositorio GRUPO/SUB/NOME`). A porta de um remoto https de
  GitLab chega à leitura do roadmap. Contrato em [`docs/referencia/contratos/forja.md`](docs/referencia/contratos/forja.md).
- **`ork network roadmap --json`**: as lacunas `forja.nao-encontrado`, `forja.inacessivel` e `forja.tempo-esgotado`
  passam a `forja.nao-achei` e `forja.indisponivel`.
- **Correção medida**: o `glab api --input` não mandava `Content-Type`, e o GitLab ignorava o corpo; o `gh` com host e
  porta passa por `GH_HOST` (o `--hostname` recusa a porta).
- **O gate de CI lê o GitLab**: `ork ci status` e o gate do `ork ship` leem a CI pela forja resolvida. Só o job que
  está na lista de jobs da pipeline do projeto conta como produtor `gitlab-ci`; um status criado por `POST /statuses`
  conta só como `status:<login>` e só aprova se estiver em `ci.produtor`. Abaixo do GitLab 17.0 a consulta é recusada, e
  o resultado mesclado sem vínculo com o head falha fechado (`ci.merged-results-sem-vinculo`). O `ork ci status --json`
  passa a `ork.ci-status/v2` (`provider`, `fonte`, `produtor`); a v1 continua lida. Traz o modelo
  `templates/gitlab/ork-verify.yml` e o CI/CD Component `templates/ork-verify/template.yml`; as `workflow:rules` ficam
  no `.gitlab-ci.yml` do projeto. Contrato em [`docs/referencia/contratos/forja.md`](docs/referencia/contratos/forja.md).
- **Identidade, endereço e versão da forja**: o `orkastery.yaml` aceita o bloco opcional `forja:` (`tipo`, `host`,
  `porta`, `caminho_base`, `ssh_host`, `ssh_porta`, `ca`) e o `ci.produtor`; sem eles, o manifesto lê como antes. A
  forja do remoto é resolvida pelo manifesto, pelo host conhecido ou pela sondagem só da CLI com login no host
  (`gh api meta`, `glab api metadata`), nunca pelo nome do host; sem resposta, `forja.desconhecida`, e com duas,
  `forja.ambigua`. A API da forja passa por uma chamada só, com o host explícito (`GITLAB_HOST` sempre no `glab`;
  `GH_HOST` no `gh`, só quando há porta; o subcaminho só vai no login), o corpo pelo stdin, os erros tipados pelo
  status HTTP, uma espera do limite de cota ou secundário numa leitura (até 60 s) e a paginação com teto de 10
  páginas. Versões mínimas medidas das CLIs: `gh` 2.18.0 e `glab` 1.121.0. A versão do GitLab cai numa faixa (testada
  19.2 a 19.4, compatível desde 17.0, recusa abaixo), em cache por 24 h. O `ork doctor` ganha a seção forja
  (identidade, alcance HTTPS e SSH, TLS, subcaminho, CLI, login, servidor, escopo, projeto, capacidades), que só
  reprova o projeto que depende da forja; no `--json`, só com `--forja`, e o campo `forja` do `ork.doctor/v1` diz
  `medida` ou `nao-medida`. Contrato em [`docs/referencia/contratos/forja.md`](docs/referencia/contratos/forja.md).
  Muda para todos: o `ork-verify` verde de um app fora de `ci.produtor` (padrão `github-actions`) deixa de aprovar o
  gate; quem publica o check por outro app declara a lista. O commit status verde do `github-actions[bot]` passa a
  aprovar sozinho.
- **#Noctum, fatia N4: supervisão e recuperação** ([RM-058](docs/roadmap/RM-058-modo-noctum.md)):
  `core/src/noctum-supervisao.ts` guarda os checkpoints da supervisão do arco num log próprio, encadeado e assinado
  (`ork.noctum-supervisao/v1`), com os parâmetros na primeira linha: reiniciar o condutor ou o vigia, trocar de conta ou
  de runtime não zera tentativas nem renova o envelope. `core/src/noctum-vigia.ts` traz o condutor (`conduzirArco`) e o
  vigia (`vigiarArco`, um tique a cada 5 min), que provam a vida pela trava do kernel: o vigia assume com geração nova
  quando o condutor morre, e sem vigia o condutor não despacha nada novo. `core/src/noctum-reconciliacao.ts` resolve
  com prova o que a N2 deixou no meio (a reserva pendente de passo morto, a sessão do id dito antes da falha, o fim de
  turno sem resultado), percebe a sessão sem avanço, a sem primeiro turno e o despacho de fora do arco, e reconcilia
  pelo remoto o push de resultado incerto; toda retomada sai pelo passo do arco, até o teto, e depois o trabalho é
  isolado. O rodízio fica dentro do envelope: conta esgotada sai até o reset dito, reset desconhecido é lacuna pelo
  resto do arco, login perdido tira a conta, e o teto do arco ou a recusa por custo param o arco. Muda para todos: o
  `ork retry resume` não redespacha o pedido do limite de uso de um despacho de arco, que o vigia retoma pelo arco.
  Nenhum comando chama o vigia nem o condutor.
- **#Noctum, fatia N6: fechamento, relatório da manhã e o transporte que liga o modo** ([RM-058](docs/roadmap/RM-058-modo-noctum.md)):
  o arco fecha sozinho pela hora final, pelo teto do arco ou pela fila vazia (`core/src/noctum-fechamento.ts`): grava o
  `encerrado` no log do arco antes de tudo (nenhuma reserva nem efeito passa depois, nem por outra conta, e nada o
  reabre), pede a parada de cada sessão em voo uma vez (no teto em sessões, as já contadas terminam e o arco fecha
  quando a última acaba), confirma no tique seguinte e deixa o estado de retomada. A
  medição (`core/src/noctum-medicao.ts`) cobre `minutos-de-sessao`, `tokens` e `percentual-da-cota`, com o consumo
  desconhecido como lacuna, nunca zero, e a reserva com teto nessas unidades admite só abaixo do medido. O relatório da
  manhã (`core/src/noctum-relatorio.ts`) vence no primeiro `HH:MM` do fuso do envelope, traz os sete grupos da página a
  partir dos fatos do núcleo (entregue só com a prova do push) e sai pelo transporte local
  `.orkastery/monitor/noctum-host.json`, com recibo por página, reenvio limitado sem duplicação e a correção explícita
  numa versão nova; sem recibo, a lacuna aparece no `ork noctum status`. O modo passa a ser ligado pelo transporte:
  `ork noctum propor`, `responder`, `status`, `tique` e `relatorio`, as ferramentas `ork_noctum_propor`,
  `ork_noctum_autorizar`, `ork_noctum_revogar` e `ork_noctum_status` do MCP (autorizar e revogar só pelo diálogo nativo
  do host) e `/ork noctum <arco> autorizar <sha256>` ou `revogar` no Telegram do Hermes e do OpenClaw; `#Noctum` só vale
  com um envelope vigente e, sem ele, segue recusado com `noctum.modo.sem-envelope`. `core/scripts/ensaio-noctum.cjs`
  ensaia o piloto local em repositórios descartáveis, com relógio controlado e runtime e canal simulados. O tique ainda
  chama o passo da N2: ligar o vigia e o condutor da N4 vem antes do primeiro piloto, que espera também os valores e a
  autorização do dono.
- **#Noctum, integração numa máquina** ([RM-058](docs/roadmap/RM-058-modo-noctum.md)): a thread de um arco agendado ou
  vigente só tem o SHIP e o MASTER pelo arco: `ork ship`, `ork ship publicar`, `ork ship registrar-pr` e
  `ork conducao atualizar` recusam com `noctum.guarda.thread-do-arco` antes de qualquer git, a batida, a varredura, a
  Sentinela e a máquina ociosa pulam a thread, e a sessão do arco recebe no pedido a linha que diz isso. O bloco com GO
  pede a baseline em todo runtime, gravada pelo condutor; a que falha sem ser espera isola o trabalho com a causa.
  `ork noctum tique` passa a rodar o fechamento, o vigia da supervisão (que reconcilia, aplica as paradas e, sem condutor
  vivo, dá o passo do despacho e o da entrega) e o relatório, com os fatos da supervisão no relatório e no retrato; a
  parada da supervisão fecha o arco com o motivo `supervisao`, menos a parada pelo teto, que espera as sessões admitidas e
  fecha quando a última acaba, e a fila vazia espera o MASTER por omissão que a entrega do arco deve. `ork noctum conduzir
  <arco>` roda o condutor (sai 0, 2, 3 ou 4), e `ork noctum aceite <arco>` mede M1 a M10 e dá o veredito do piloto
  (`ork.noctum-piloto/v1`), contando só a entrega do arco e a reversão dela pela data do commit que reverte, com a
  evidência simulada (também o despacho sem sessão confirmada pelo runtime) nunca aprovada e o arquivo publicável sem
  dado pessoal. Com `ci.contexts` no manifesto, a prova do CI da entrega exige todos os contextos verdes. O ensaio
  ganha a cadeia ligada, o condutor que morre e a base que anda. Muda para quem publica: a tag que anuncia o #Noctum só publica com o aceite dos pilotos em
  `docs/roadmap/evidencias/RM-058/aceite.json`, e o CI de documentação recusa o texto que anuncia o #Noctum como lançado,
  entregue, validado ou disponível sem esse aceite, em qualquer caixa de letra; o piloto com marca de simulação e a
  ratificação anterior ao fim dos pilotos não passam no portão. Nenhum piloto rodou: o #Noctum ainda não foi validado.

- **Conta esgotada não para a fase, fatia 1** ([RM-064](docs/roadmap/RM-064-conta-esgotada-nao-para-a-fase.md)):
  o fim de cota vira evento da conta, interrompe com prova as sessões vinculadas, troca para outro perfil ou fallback
  autorizado — ou espera o prazo de volta — e, mesmo quando a sessão já commitou, retoma a fase pelo checkpoint sem
  substituir o prompt original nem repetir o trabalho já registrado no `HEAD`.
- **Conta esgotada não para a fase, fatia 2** ([RM-064](docs/roadmap/RM-064-conta-esgotada-nao-para-a-fase.md)): a pasta `trabalho/` da thread guarda o trabalho retomável e entra no checkpoint da retomada, a batida determinística retoma a fase parada por cota mesmo com a Sentinela ligada, `accounts check` mantém o estado vivo das contas e, em projeto preparado, fallback sem adaptador instalado não recebe despacho.
- **Conta esgotada não para a fase, fatia 3** ([RM-064](docs/roadmap/RM-064-conta-esgotada-nao-para-a-fase.md)): despachos iniciais e redespachos Codex por `ork retry` ou pela escada levam o MCP vinculado à thread e ao despacho, com a raiz gravável restrita à worktree; a partida fixa a fonte válida sem aceitar corrupção e a batida recupera o terminal e a resposta final sem duplicar o retry do pulse quando o watcher falha, contando os dez minutos de indisponibilidade desde a última observação boa ou o primeiro erro da série e registrando como parada tipada a divergência permanente do vínculo; perfis desativados ficam fora da escada, da fila e da distribuição por carga.

- **Entrega dentro do arco #Noctum, fatia N5 da RM-058** ([RM-058](docs/roadmap/RM-058-modo-noctum.md#n5-qualidade-e-entrega)):
  o passo da entrega do arco (`passoDaEntrega`, ainda sem quem o chame) leva a thread que a fila deixou na entrega do
  CHECK ao MASTER, um efeito por chamada, e só integra com todas as provas no SHA fonte exato e na base lida no remoto:
  a revisão independente de uma sessão de CHECK que o núcleo despachou, verificou e viu concluir, com id nativo fora dos
  autores (o arco despacha esse CHECK pela reserva de revisão quando ele falta); o verify contra a baseline com as
  claims ativas, guardando a reprovação anterior do mesmo SHA; o CI obrigatório verde no SHA; nenhum segredo na história
  que iria ao remoto (as linhas de cada commit da thread, o diff final e as mensagens deles) nem no título e no corpo do
  PR que o arco abre; e nenhum mutante
  sobrevivente, com o mutante como claim que começa por "Mutante" e o executor `core/scripts/mutante.cjs`. A base que
  anda é mesclada na worktree com o conflito só aditivo resolvido pela regra do núcleo, a entrada da thread posta em
  "Não publicado" depois de uma versão, o bundle regravado e o verify de novo (conflito em binário, fora de UTF-8 ou sem
  conteúdo dos dois lados aborta); o merge é amarrado ao SHA (a árvore da fonte com os pais base e fonte, o envelope
  conferido com o relógio da hora do push, push com lease na ponta conferida que a base que andou recusa, prova pelo
  `ls-remote`) e leva no mesmo push o estado derivado da página do item que deixaria a `main` vermelha. A supervisão da
  N4 vale na entrega: o arco parado não faz efeito, o trabalho isolado não sai nem pela vez da N3, e a conta que o arco
  tirou não despacha o CHECK. A leitura do git que falha é lacuna e espera, o git que falha sem conflito nem recusa do
  remoto (a trava do índice, a rede do push) espera, a branch sem commit próprio não se entrega, o push que a proteção
  do remoto recusa não se repete, o push leva só a fonte que as provas viram, e a recusa de antes de qualquer efeito não
  prende a fila. `publicarEntrega` ganha a opção `antesDoEfeito`, chamada imediatamente antes do push e antes de abrir o
  PR.

- **A forja vira porta**: o GitHub passa por um adaptador com capacidades em `core/src/forja/` (CI, entrega externa,
  PRs da branch e abertura de PR), com a CLI da forja rodada por um executor só, sem mudança de comportamento. É a
  base para o GitLab.
- **Respostas gravadas do GitHub e do GitLab para o contrato da forja**: `core/scripts/forja-contrato.cjs` grava, só
  por consulta, as respostas reais de uma forja (`--forja github|gitlab --host H --repo CAMINHO --sha SHA [--pr N]
  [--branch B] --saida DIR`) pela CLI já logada (`gh`, `glab`), sem ler nem passar token, e cada registro passa pelo
  redator antes do disco (arquivo 600): tokens do GitHub e do GitLab (inclusive o formato com ponto e os de runner),
  JWT, credencial em URL e o valor de toda chave terminada em `token`. Os testes ganham as respostas redigidas do
  GitHub (10/2026) e do GitLab CE 16.11, 17.0, 18.11, 19.2, 19.3 e 19.4 em `core/test/fixtures/forja/`.

- **CLI em inglês e pt-BR, fatia F3b** ([RM-061](docs/roadmap/RM-061-cli-em-ingles-e-pt-br.md)): seguem também o
  locale `ork thread list`, `thread close` e `thread entrega`, `ork worktree`, `ork claims`, `ork decisao placar`,
  `ork accounts`, `ork network` (fora `network roadmap`), `ork roadmap reservas`, `pegar`, `soltar` e `feat`,
  `ork docs verificar` e `docs sincronizar`, `ork adapter` e os erros de estado. Com o dono em inglês, o
  `ork adapter install` copia as skills, as checklists, os comandos e os subagentes em inglês (variantes em
  `core/assets/*-en/`) para o mesmo destino, e trocar a língua troca no lugar a cópia intacta. O `--json`, o ledger, o
  `claims.jsonl`, o recibo `INSTALADO.json` e o que o `ork docs verificar` lê nas páginas não mudam; o pt-BR segue igual
  byte a byte. Ficam em pt-BR, para a F3c, `decisao registrar`, `network roadmap`, `thread new --from-finding` e os
  prompts de fase. O catálogo vai de 1.020 para 1.653 entradas (cobertura de 25,3% para 39,7%).

- **Ritual do MASTER, mod de papel `dono`, e a nota pelo diálogo nativo** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  a ferramenta MCP `ork_request_master_note`, só no servidor do dono, recebe só o `threadId`, pede ao host um formulário
  com a nota de 0 a 5 e o porquê e grava o MASTER com `avaliadoPor` `dono (dialogo nativo)`, o canal do host e o recibo
  assinado do ingresso local (`ork.hitl-local-master-note/v1`); sem formulário no cliente, recusa com
  `master.nota.sem-dialogo` sem gravar nada, e a gravação espera até um minuto pela trava da thread. O contrato
  `ork.master-log/v1` não muda: a nota vale como nota humana em qualquer versão do `ork`, o núcleo confere o recibo ao
  gravá-la e essa identidade não se digita no `--por`. O aceite por omissão (`ork master --aceitar-omissao`) passa a
  gravar sob a trava de HITL da thread e não troca a nota humana que chegou depois da listagem; sem thread indicada, a
  entrega com a trava tomada fica para o próximo aceite. O recibo prova o caminho, não a pessoa: a chave local é legível
  pelo mesmo usuário do sistema. A seção `master` do retrato do Maestro passa a trazer o regime, o índice derivado do
  ledger com as parcelas, as reprovações tipadas, as classes e a entrega, inclusive a entrega por artefato
  (`deliveredArtifact`).
  `adapters/claude-code/mods/ork-ritual` mostra na sessão do dono as entregas dos últimos 7 dias que esperam a nota
  (inclusive as aceitas por omissão), a prova de cada uma (o índice, o POSTMORTEM e as claims com comando e estado, uma
  por vez) e o botão Dar a nota, que chama só a ferramenta da nota; sem diálogo, Pelo Telegram mostra o código do
  `ork master pedir`. A prova do diálogo pedido por mod fica com o dono (`core/scripts/prova-ritual-nota-nativa.cjs`), e
  o guia é o [Ritual do MASTER](docs/guias/ritual-do-master.md).

- **Mensageiro de Sessões, mod de papéis `dono` e `fase`** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  a resposta que o dono dá pelo diálogo nativo da sessão do Claude Code chega à sessão de fase `claude-bg` que parou
  esperando por ela. O núcleo abre o pedido de sessão `claude-bg` preso ao turno que parou (a transcrição do próprio
  Claude Code), compõe a mensagem no contrato `ork.session-delivery/v1` e a guarda numa caixa de saída só na memória do
  servidor MCP do dono (`ork_session_outbox`); o ledger guarda só o sha256. Na sessão do dono,
  `adapters/claude-code/mods/ork-mensageiro` leva a mensagem por `$.session.send`, com reenvio pela D10 e o painel
  `/mensageiro`; na sessão de fase, só entra na conversa a mensagem de outra sessão que o núcleo confirma pelo
  `ork_session_inbox` (o envelope do Claude Code só na forma do motor, reserva uma vez e antes do prazo, mesmo turno,
  mesmo sha256), só com o corpo conferido e num envelope fixo do Mensageiro, e o resto é consumido antes do modelo.
  Muda para todos: o despacho `claude-bg` acrescenta `crossSessionInbound: accept` ao `--settings` só com o Mensageiro na
  sessão e o `ORK_DISPATCH_ID`; a resposta a uma sessão `claude-bg` pelo Telegram, ou sem um Mensageiro vivo na sessão do
  dono, recusa com `runtime.unavailable` antes de gravar nada. O guia é o `docs/guias/mensageiro-de-sessoes.md`.

- **Conhecimento escrito, fatia 2: o comando e as tools MCP** ([RM-026](docs/roadmap/RM-026-workspace-empresarial.md)):
  `ork conhecimento listar [--colecao C]|mostrar <doc-id>|colecoes|verificar`, todos com `--json`, e as tools
  `ork_conhecimento_listar`, `ork_conhecimento_mostrar`, `ork_conhecimento_colecoes` e `ork_conhecimento_verificar` no
  `ork mcp serve`, só leitura, respondem o mesmo JSON do contrato `ork.conhecimento/v1`
  ([contrato](docs/referencia/contratos/conhecimento-rm026.md)). O `mostrar` traz o corpo, a versão (sha256), a fonte e
  as referências, com cada id do Brain conferido por `get` no Company Brain: o id que o Brain não tem, o que ele retém e
  o Brain fora do ar viram lacunas distintas (`referencia.brain-inexistente`, `referencia.brain-retido` e
  `referencia.brain-indisponivel`), nunca resposta. `listar` e `colecoes` não chamam o Brain nem leem ledger, e
  `verificar` confere a pasta inteira e sai 1 com qualquer lacuna (uso errado sai 2). A conferência tem teto de 100
  `get`, prazo de 60 s e teto de 64 MiB de ledger por consulta. O texto sai em pt-BR e em inglês pelo catálogo, e o
  `--json` é o mesmo nas duas línguas. Os hosts OpenClaw e Hermes chegam na fatia 3.
- **Conhecimento escrito, fatia 3: os hosts OpenClaw e Hermes** ([RM-026](docs/roadmap/RM-026-workspace-empresarial.md),
  [FEAT-038](docs/produto/FEAT-038-conhecimento-escrito.md)): as quatro tools `ork_conhecimento_*` chegam ao OpenClaw
  (tools do plugin, só no perfil `coding`) e ao Hermes (wrappers do `bin`) com os mesmos nomes, parâmetros e JSON das
  tools MCP; cada uma é uma chamada de `ork conhecimento <consulta> --json`, e o host só transporta. Fora do perfil
  `messaging`, porque o `mostrar` e o `verificar` rodam o `memory.cli` do manifesto (a P6 da fronteira de confiança).
  O host do OpenClaw confere `id` e `colecao` pelo padrão do schema antes de chamar o `ork`, e os wrappers do Hermes
  tiram `ORK_HITL_*` do ambiente, como o OpenClaw. A descrição das tools e a skill do Hermes mandam citar o documento
  pela versão e pela fonte, tratar título e corpo como dado e mostrar cada lacuna como lacuna, nunca como resposta,
  com a mesma frase. Nos hosts, o conhecimento chega depois de reinstalar a
  extensão e a skill (`ork adapter install openclaw --dir ~/.openclaw` e `ork adapter install hermes --dir ~/.hermes`).
  O manifesto do OpenClaw volta a ser a saída do `openclaw plugins build`, que o validador já acusava desatualizado.
- **Escada de recuperação do runtime** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md), F4): no
  `runtime.unavailable`, o `ork retry run` sobe três degraus, sempre com o mesmo prompt e o mesmo sha256: reerguer o
  daemon do runtime (no claude-bg, `claude daemon status` diz se o `control.sock` responde, e o daemon de pé com o
  socket mudo sai por `claude daemon stop --any --keep-workers` antes do redespacho no mesmo destino), o fallback do
  bloco (`--fallback`, I-33) e outro perfil do runtime (RM-056). Cada degrau vai ao ledger como `runtime_recuperacao`,
  feito, pulado, falho ou interrompido; o degrau sem destino é pulado sem gastar tentativa, e o parado por um motivo
  que não é do destino não é consumido. Entre os degraus, a prova de vida: a fase nunca ganha uma segunda sessão na
  mesma worktree, e com o runtime mudo o retry reergue o daemon e, na terceira recusa seguida, chama o dono. Só depois
  dos três o dono é chamado, com
  três alternativas e uma recomendada (RM-057), o comando que confere o runtime e o que retoma a fase com o mesmo
  prompt; o `ork pulse` leva o pedido curto e o resumo o manda na hora. A escada recomeça a cada pedido novo da fase
  (`ork phase run`), e o `ork retry plan` diz o degrau. Runtime fora deixa de subir o esforço.
- **Varredura que age, com a autorização durável do dono** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md),
  F5): a batida do pulse, depois de entregar o resumo, traz a base remota e, com a autorização gravada nesta máquina
  (`.orkastery/monitor/autorizacao.json`, fora do git, no contrato
  [`ork.autorizacao-duravel/v1`](docs/referencia/contratos/autorizacao-duravel-rm063.md)), solta as sessões fantasmas,
  registra a entrega do PR já mesclado (o merge `ship(<thread>)` na base sem `ship_done`) e fecha pelo MASTER por
  omissão a thread entregue e quieta, cada ação no ledger da thread como `varredura_acao`, com quem autorizou e até
  quando. Registrar ou fechar por cima de quem trabalha na thread (sessão viva, alteração não commitada, commit ou
  despacho depois do PR) nunca é automático: a ação fica com o dono, com o motivo e `ork thread status`. Sem
  autorização, vencida, de outra máquina ou de outro projeto, nada é feito: cada ação vira item da fila do pulse com o
  comando pronto, e o resumo ao dono mostra a arrumação pendente e o que a varredura fez. O
  `ork fabrica batida status` diz a autorização em vigor. Em 10/10/2026 o PR #112 ficou dois dias mesclado sem registro.
- **Máquina ociosa vira alerta** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md), F6): com vaga livre no
  projeto (abaixo de `concurrency.max_parallel_threads`) e item do roadmap reservado para esta máquina que ninguém
  trabalha, o `ork pulse` traz `maquinaOciosa` com as próximas threads sugeridas, até o número de vagas livres, cada
  uma com o passo e o comando, e a varredura avisa o dono na hora, uma vez por episódio, com o aviso no ledger do
  projeto (`maquina_ociosa_avisada`).
- **Condutor autônomo dentro da autorização durável** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md), F7): `ork
  conducao autorizar --ate <data> --pode merge,registrar,master,despachar [--por Q]` grava a autorização do dono nesta
  máquina, fora do git, no contrato
  [`ork.autorizacao-duravel/v1`](docs/referencia/contratos/autorizacao-duravel-rm063.md) (o prazo sempre com o fuso
  escrito e até 31 dias; a data sozinha vale até 23:59 no fuso do dono), e `ork conducao autorizacao` mostra a vigente;
  nenhum agente se autoriza (a sessão despachada pelo `ork` e o pedido de dentro do Claude Code, do Codex, do Hermes ou
  do OpenClaw são recusados), e tag e publicação nunca entram. `ork conducao batida` é o passo determinístico que a
  varredura do cron roda depois do resumo: mescla o PR de branch `ork/*` de thread #Auto ou #Maestro com todos os checks
  obrigatórios verdes, o PR limpo e o CHECK aprovado depois do último commit de produto (`gh pr merge --merge
  --match-head-commit`, com o assunto `ship(<thread>)`, provado na cópia da base), registra a entrega e fecha pelo
  MASTER por omissão na mesma rodada, e despacha a fase seguinte só com o pedido guardado na criação da thread, como
  sessão de fundo, nunca por cron LLM; com a Sentinela ligada, cede o despacho. Autorização vencida ou sem a ação, check
  pendente ou vermelho, PR em rascunho, trabalho na thread, pendência do dono e branch local com trabalho fora do PR
  recusam com motivo tipado e viram item da fila do pulse, com o comando. Em 12 e 13/10/2026 os PRs #153 e #154
  esperaram de 5 a 6 horas pelo condutor.
- **CHANGELOG reconciliado no merge da main** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md), F7): `ork conducao
  atualizar <thread> [--enviar]`, e a batida no PR que ficou para trás ou em conflito, faz o merge da base na branch da
  thread sob a condução dela (a sessão despachada que conduz a thread reentra pela identidade de despacho, como no
  `ork verify`); os itens da thread voltam a "## Não publicado", no mesmo grupo, quando o merge os joga numa versão
  publicada ou conflita só no CHANGELOG, e conflito em código aborta e fica com o dono. A regra foi conferida contra os
  25 merges reais mais recentes do repositório.
- **A batida dos hosts e a retomada pelo canal** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md), H1 a H4): `ork
  doctor --json` (`ork.doctor/v1`) traz a batida da fábrica com a idade da última rodada e o aviso pronto, e o heartbeat
  do OpenClaw (automação de comando, sem modelo) e o do Hermes rodam `bin/ork-vigia-batida` e avisam o dono quando a
  batida passou de 30 min. `#OrkRetomar` no Telegram autorizado roda a batida da condução e o que voltou a andar chega
  pelo transporte do pulse; `#OrkFabrica` responde o `ork fabrica`. A etapa `maestro` do onboarding grava o canal do
  dono e, junto, o `pulse-host.json` pronto do host; com os dois hosts configurados, a falha do transporte tenta o outro
  e aparece no `ork doctor` ("transporte do pulse"). O doctor também reprova a batida parada com a linha no crontab.
- **#Noctum, fatia N3: coordenação entre máquinas** ([RM-058](docs/roadmap/RM-058-modo-noctum.md)): o contrato
  `ork.noctum-envelope/v3` traz as máquinas do arco, cada uma com a chave pública Ed25519 com que assina, o limite de
  sessões por conta somando as máquinas e a máquina presa de um trabalho. `core/src/noctum-transporte.ts` grava ordens,
  recibos e cancelamento assinados no ramo `ork/noctum-coordenacao` do remoto do projeto, por push sem força e com a
  identidade da máquina nos commits, e só decide com leitura nova e conferida (assinatura, caminho, tamanho, só
  acréscimo, batida que não volta no tempo e história que desce da última vista, que só avança depois da leitura inteira
  conferir); quem grava confere com a mesma régua antes do push, o motivo de quem chama só vai ao ramo sem caminho,
  e-mail, id de sessão ou segredo, o ramo adulterado que a máquina viu uma vez deixa a vista marcada até a inspeção do
  dono, mas falha passageira de `merge-base` ou `show` recusa sem deixar essa marca; a emenda que esta máquina ainda não
  autorizou é espera, e o retrato da rede é descoberta, nunca autorização. `core/src/noctum-coordenacao.ts` dá a autoridade por geração,
  com cada geração nova selando os registros da anterior (o que a vencida gravar depois reprova a leitura), uma ordem
  viva por trabalho, a transferência só com prova (inclusive a prova da vez de integrar; sem ela, o item fica isolado e
  os outros seguem), sem deixar a chave que uma emenda aposentou fechar, soltar ou entregar a ordem emitida sob a versão da troca ou uma posterior
  (com as emendas autorizadas na mesma ordem em todas as máquinas, sem volta a um envelope de antes) nem a raiz nova
  fechar ou concluir a ordem com a vaga viva da chave antiga, a revogação do dono numa máquina valendo em todas, o abandono da vez de integrar de quem não dá sinal e a vaga
  global, que soma as máquinas no limite da conta e nos tetos do arco; a reserva do item é a da RM-047, revalidada
  depois de tomar, e decide para qual máquina a ordem vai, ou se ela espera a reserva de fora ser solta,
  sem levar ao ramo quem reservou. `core/src/noctum-integracao.ts` deixa um integrador por destino entre máquinas, invalida o
  candidato quando a base ou a fonte mudam e só registra a entrega do merge feito sobre a base provada e devolvido pelo
  integrador (a fonte igual à base provada entrega com a base, como a já incorporada do `ork ship`, e o passo da
  entrega da N5 bloqueia antes a branch sem commit próprio desde a partida da thread); o `integradorDaEntrega` da N5
  devolve o merge, e não a ponta com os docs derivados, e o git que não roda ou falha e a história que não se lê deixam a vez
  até a reconciliação; a repetição sem ler os HEADs também preserva a vez, e a entrega registrada por uma vez abandonada
  entra na linha que prova as integrações seguintes; o passo segue quando a ordem que perdeu a reserva espera essa prova,
  e a reserva do arco só se solta sem ordem viva da máquina no item, relida na hora. `core/src/noctum-maquinas.ts` reconcilia a máquina que volta, sob a
  mesma trava local do passo e sem entrega em duplicidade, fecha o que é da máquina
  que uma emenda tirou do arco e chama o passo da N2 só com o que tem ordem dela, com a entrega e o fim sem entrega das
  outras máquinas valendo antes da thread local. Um ensaio com dois executores em
  processos separados, sobre um remoto de fixture, prova o aceite da tabela, inclusive o vencedor por item pela
  reserva e a disputa da última vaga global. Nada chama a coordenação ainda: o tique da N6 chama o passo da N2, que,
  com o envelope `v3`, espera o passo da máquina, a entrega da N5 bloqueia fora da `v2`, e nenhum comando grava no
  ramo. O arco que a N6 encerrou nesta máquina recusa o que começa (`noctum.efeito.encerrado`), recusa as ordens que
  chegam e para de bater, e a vaga global com teto fora de sessões recusa, porque a soma entre máquinas só mede sessões;
  a emenda não troca o contrato entre a `v3` e as outras.
- **CLI em inglês e pt-BR, fatia F3c** ([RM-061](docs/roadmap/RM-061-cli-em-ingles-e-pt-br.md)): o
  `.orkastery/.gitignore` gerado pelo `ork init`, as recusas humanas de `ork decisao registrar` no CLI e no MCP, o
  texto humano de `ork network roadmap`, `ork thread new --from-finding`, `ork prompt` e o prompt montado pelo
  `ork phase run` seguem a língua do dono. O que é gravado para depois (o prompt despachado e o pedido do achado)
  segue só `owner.language`, sem ela pt-BR, e o `ork prompt render` mostra esse prompt; o template de fase do projeto
  vence o embutido, e o lint avisa o que não tem o par `.en`. As linhas de contrato do panorama da rede, os códigos
  HITL v2, o ledger, o `--json` e os snapshots pt-BR permanecem iguais; o prompt inglês conserva as seis fases, os
  cinco módulos, a `CENTRAL RULE` e o fecho obrigatório do GO.
- **CLI em inglês e pt-BR, fatia F3d** ([RM-061](docs/roadmap/RM-061-cli-em-ingles-e-pt-br.md)): as
  famílias do CLI principal que seguiam fora da lista e as três lacunas da revisão da F3c passam pelo catálogo
  tipado, com 3.367 entradas, 2.306 literais de saída ainda fora do catálogo e 59,35% de cobertura no mesmo
  contador. Os
  quatro snapshots pt-BR anteriores mantêm os hashes byte a byte; `--json`, ledger, ids, códigos, comandos e
  flags continuam contratos não traduzidos. Mods, tools do OpenClaw e cópias dos marketplaces ficam para um
  trabalho próprio de geração reproduzível e paridade, sem tradução parcial. Depois do merge da `main`, a mesma
  medida dá 58,63% (41,26% na `main` sozinha). A família do grafo segue sem importar o catálogo (o `index.ts`
  passa a redação no locale do comando), o `ork ci prepare` grava o lint em pt-BR no ledger em qualquer língua, e
  o custo de referência do `ork ledger` troca o travessão por parênteses. Com o CLI em inglês, seguem em pt-BR,
  para a fatia F3e: `ork master audit`, `master digest`, `master migrar`, `master ratificar` e `master propor`; as
  linhas de extração do `ork grafo indexar` e o detalhe das recusas tipadas do índice e da consulta do grafo;
  `ork onboarding sync`, `ork experiencia uninstall`, `ork doctor --modo`, `ork maestro` e `ork mcp serve`; as
  mensagens de erro de `ork brain`, `ork activation` e `ork receipt-verifiers`, que imprimem JSON; e a recusa do
  projeto-alvo, que sai antes de o comando ativar o locale. A lista, conferida no código, está na página do item.

### Alterado

- **O CHECK padrão passa a ser o Agile Check** ([RM-072](docs/roadmap/RM-072-check-cinco-vezes-mais-rapido.md)): projeto sem `check.mode` roda o Agile; para voltar ao CHECK de sempre, declare `check.mode: classic` no `orkastery.yaml` (ou rode `ork verify <thread> --check classic`).

### Corrigido

- **Tipos gerados pelo Claude Code (RM-037)**: o despacho aceita o `.gitignore`, os links `.d.ts` comprovados pelo `INSTALADO.json` e o `tsconfig.json` exato que o motor grava nos mods, sem liberar links externos nem arquivos sem recibo.
- **Defeitos de condução de 19 e 20/10/2026** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)): a
  baseline (`ork verify --baseline`) roda com o mesmo prazo de cada comando do verify
  (`verify.timeout_ms_por_comando`) e a mesma medida do steal, e o comando sem veredito nela (estouro, morte por sinal,
  relógio sob steal, comando que não rodou, falta do código de saída) sai `SEM VEREDITO` e nunca vale como "já
  falhava": só o término normal do próprio comando, com código de saída de 1 a 123, tem veredito, e a falha dele no
  verify é falha sem baseline (`verify.failed`). O `core/scripts/mutante.cjs` aceita `arquivo` (um roteiro de
  `core/scripts` ou um apoio compilado de `core/dist-test/test`) no lugar de `modulo`, mas recusa alvo ou componente
  simbólico, alvo não regular e `realpath` fora da cópia ou dessas duas pastas, sem escrever no alvo recusado; o
  `modulo` passou pela mesma conferência. Nova chave `worktree.dependencias` no manifesto: o `ork` roda o comando dentro de toda
  worktree nova (`ork thread new`, `ork worktree ensure`, `ork_thread_new`), grava `worktree_dependencias` no ledger e,
  se falhar, avisa com o comando exato sem desfazer a thread; a recusa `baseline.dependencia-ausente` diz esse
  comando. No passo do arco do #Noctum, que abre a thread com a vez de despachar, o preparo fica pendente
  (`worktree_dependencias_pendentes`) e roda fora da trava, antes do primeiro comando da baseline ou do verify, que
  recusam (`baseline.dependencia-ausente`, `verify.dependencia-ausente`) enquanto ele falhar. A sessão claude-bg que
  deu a resposta final e ficou ociosa no prompt (`working` com `status: idle`) por 5 min depois do Stop vira fim do
  turno pela prova do `ork`, e a condução sai sem esperar os 60 min do runtime, mas só quando o Stop disse que nada
  vai acordá-la: o hook do Stop manda ao `ork` as contagens de `background_tasks` e `session_crons` do Claude Code,
  e com tarefa em segundo plano, despertar agendado (`CronCreate`, `ScheduleWakeup`, `/loop`) ou o Stop sem as
  contagens, a sessão segue conduzindo. Os
  testes `prova-ativacao-roteiro` e `projeto-alvo-cli` deixam de ler o registro de projetos e o runtime da máquina de
  quem roda a suíte.
- **Snapshot pt-BR estável com sha só de letras** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)): o
  teste `locale pt-BR F3b` caía quando o commit gerado no teste saía só com letras (`aaeecea`, `ebcbadb`) em dois
  contextos que o normalizador não reconhecia, `branch <b> em <sha>` e `(<sha>, N tentativa(s))`. Os dois
  contextos viram `<SHA7>`, sem engolir palavra comum no meio da frase. Na mesma tarde caiu um terceiro, `(<sha>).`;
  o normalizador passou a cobrir todos os contextos de sha da fixture: entre parênteses, `para`, `ship_done`, `→`,
  `->` e `--is-ancestor`.
- **Codex e Claude Code fecham o GO com os mesmos artefatos** ([RM-016](docs/roadmap/RM-016-experiencia-do-builder.md)): o prompt canônico agora exige `verify`, build, bundle de CI, commit `ci(<thread>): bundle ...` e `pr-body.md` nos dois runtimes.
- **Parecer reprovado volta a ser legível na retomada** ([RM-064](docs/roadmap/RM-064-conta-esgotada-nao-para-a-fase.md)): o leitor do CHECK reconhece `Veredito: REPROVOU` como reprovação, além dos três termos já aceitos.
- **Baseline não aceita dependência ausente na worktree** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)): código `127` agora recusa `ork verify --baseline` com motivo tipado, em vez de virar “já falhava” e mascarar o ambiente incompleto.
- **Worktrees novas saem da base remota atual** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)): `ork thread new` e `ork worktree ensure` atualizam `origin/<base>` antes de criar a branch, sem depender da `main` local parada em outra worktree.
- **Verificações longas e primeiro uso do HITL sem falha espúria** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  o comando hermético do CI passa a respeitar o teto configurado para a suíte de testes, e a primeira operação de HITL
  inicializa com segurança um arquivo de trava ainda vazio, sem tratá-lo como estado corrompido.
- **Saída completa no `ork verify`** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)): comandos de
  verificação que escrevem mais de 1 MiB não são mais interrompidos pelo limite padrão do Node; falhas continuam
  mostrando o trecho final da saída.
- **O install não leva o cache do Python** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md)): o `ork adapter
  install` a partir de um checkout copiava, e punha no recibo, o `__pycache__` e os `*.pyc` que o Python deixa nas pastas
  do adaptador depois de rodar os testes dele; agora eles ficam de fora, como já ficavam no hash do runtime.
- **A skill e o README do Hermes em inglês com o conhecimento escrito** ([RM-061](docs/roadmap/RM-061-cli-em-ingles-e-pt-br.md)):
  com o dono em inglês, o `ork adapter install hermes` copiava a skill `orkastery-devmaster` e o README sem as linhas do
  conhecimento escrito (RM-026 K7, fatia 3), que entraram no original em pt-BR no mesmo dia. As duas variantes inglesas
  recebem essas linhas, traduzidas, e o pt-BR segue igual byte a byte.

- **As esperas que nunca terminam** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)): o prompt de toda
  fase, a skill de entrada das duas instalações (`orkastery-bootstrap`), as skills de GO e CHECK, a skill `ork` do
  Codex e os seis agentes de fase do Claude Code dizem, numa linha só, que verify, build e suíte nunca saem com `&`
  dentro do comando, que o `ork verify` roda em primeiro plano com `timeout` (ou pela execução em segundo plano do
  host, que avisa quando termina) e que a espera nunca usa `pgrep -f` com o padrão no próprio comando (espera-se pelo
  arquivo de saída com prazo, ou pelo PID guardado). O `ork phase run` deixa de contar no
  `concurrency.max_parallel_threads` a sessão que o runtime mostra parada (`stopped`, `done`, `failed`) ou fantasma no
  `claude agents --json --all`, consultado só quando o limite recusaria; ausente da lista ou com a leitura falhando, ela
  segue contando. O teste do `ork pulse --json` nas duas línguas não cai mais quando o minuto vira entre as leituras.
  Em 12/10/2026, cinco sessões de fase esperaram por processo morto ou por laço que achava a si mesmo, e uma sessão
  parada com `claude stop` prendia a vaga até a thread fechar.

- **Prazo de cada chamada ao Company Brain** ([RM-026](docs/roadmap/RM-026-workspace-empresarial.md)):
  `memory.timeout_ms` fora da faixa (0, negativo ou fração) passa a valer o padrão de 15 s no transporte do Brain, em
  vez de esperar sem prazo (0) ou falhar com erro (negativo ou fração). Visto na revisão da fatia 2 do K7.
- **Sessão ocupada não é parada, o lease solta com a sessão terminada e nenhum projeto temporário no registro**
  ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md)): o `ork pulse` e o "O que precisa de você" tratavam a sessão
  interativa do Claude Code em `busy` (ou `running`) como possível parada; agora é trabalho, como já era para o
  observador. O lease de condução ficava preso depois que a sessão terminava no runtime, e o condutor precisava do `ork
  conducao assumir`: o `done` que o observador viu e a ausência na conta do perfil da sessão soltam o lease. O registro
  automático deixou de gravar no `~/.orkastery/projetos.json` projetos de `/tmp` e da pasta dos jobs do Claude Code, a
  casa do ork segue `ORKASTERY_HOME`, e a suíte roda com uma casa temporária.

- **Remoto, CI e entrega do GitHub com a porta da forja**: o endereço do remoto (`https`, `ssh`, `git://`, com porta e
  subgrupos) passa por um parser só, e o host e o `dono/nome` da consulta saem do mesmo parse, sem host de reserva. Um
  remoto do GitHub Enterprise é consultado com `--hostname` no host dele (inclusive com porta) e exige login do `gh`
  nesse host; só o `github.com` dispensa a pergunta. A entrega externa (`registrar-pr --repo`) consulta sempre com
  `--hostname github.com`: o `GH_HOST` do ambiente deixa de valer ali.

- **Gate de CI: lista completa, produtor claro e commit status só endurece**: a CI lê todas as páginas dos
  check-runs e dos commit statuses, em ordem estável, e o detalhe diz o produtor que bloqueou. Um commit status sozinho
  deixa de aprovar o gate: status vermelho ou pendente bloqueia, e o verde precisa de um check-run verde. A lista que
  vem incompleta e a resposta de check-runs sem a lista (`check_runs` que não é array) dão CI indisponível, não check
  ausente. As chamadas ao `gh` da CI e da entrega externa passam a usar um buffer de 32 MiB e a achar o `gh` como o
  executor da forja.

- **Uma regra só para o estado de um check**: o gate e o pulse leem o estado de um check pela mesma regra. Um check-run
  concluído como `neutral` ou `skipped` segue reprovando o gate, e o detalhe passa a dizer `bloqueado (neutral)` ou
  `bloqueado (skipped)` em vez de `completed/neutral`.

- **`ork ship registrar-pr` sem vínculo com o head**: com a CI exigida (`ci.required_for_ship`), o merge de um pai só
  (squash ou rebase) é recusado com `entrega.sem-vinculo` antes de qualquer consulta à CI, porque a CI do commit da
  base nunca prova o head do PR; sem a CI exigida, ele é registrado como antes. O `git fetch` que falha recusa com
  `entrega.sem-leitura`, em vez de dizer que não há merge, e `registrar-pr --todas` com a busca do remoto falhando
  recusa por thread aberta, com saída 1.

- **Stderr da forja e do push redigido**: o stderr da CLI da forja e do `git push` passa pelo redator de segredos
  (`ghp_`, `github_pat_`, os tokens do GitLab inteiros, inclusive o formato com ponto e os de runner, e
  `https://usuario:senha@host`) antes de ir ao detalhe da CI, ao erro do push, ao `--json`, ao ledger e ao terminal. O
  detalhe da forja guarda as duas últimas linhas, no máximo 240 caracteres; o do push tira as linhas `hint:` e guarda o
  começo, até 400 caracteres, com o `! [rejected]` e o `error: failed to push`.

- **Corpo do PR por arquivo, fora do argv**: o `gh pr create` recebe o corpo por `--body-file`, num arquivo 600 em
  diretório temporário apagado ao fim, em vez de `--body=<texto>`. Um `pr-body.md` que parece flag
  (`--repo=outro/repo`) ou de 64 KiB não toca mais a linha de comando.

- **`ork network --repositorio` com subgrupos do GitLab**: o dono e o nome se separam pelo último `/`, e
  `grupo/sub/casa` deixa de ser cortado em `grupo/sub`. No GitHub, `dono/nome` sai igual.

- **`ork-verify` no head exato do PR**: o job `ork-verify` do GitHub Actions faz o checkout do commit head do PR, não do
  commit de merge temporário (`refs/pull/N/merge`), então o check que o `ork` lê no head é a prova daquele head.
- **Piloto noturno sem despacho (RM-058)**: sessões ociosas sem vínculo deixam de ocupar vaga, a espera passa a registrar motivo e ocupação anonimizada para o relatório da manhã, e `ork noctum propor` avisa sem bloquear sobre login, trust e capacidade com uma única vaga de execução.

## [0.5.6] - 2026-10-12

### Adicionado

- **#Noctum, fatia N2: fila local e capacidade** ([RM-058](docs/roadmap/RM-058-modo-noctum.md)): o contrato
  `ork.noctum-envelope/v2` traz a lista fechada de trabalhos do arco (prioridade e dependências do dono, thread que já
  existe ou pedido para abrir uma, que o dono lê inteiro no resumo que autoriza) e os limites de sessões ao mesmo tempo
  (máquina, conta, runtime e slots de revisão). `core/src/noctum-fila.ts` escolhe de forma determinística (dependências
  entregues, item reservado por esta máquina, prioridade, prova mais adiantada da Sentinela, posição e id) e diz quando
  esperar e quando encerrar, sem chamar lacuna de fila vazia; `core/src/noctum-capacidade.ts` admite um despacho só com
  projeto, máquina, revisão, conta e runtime ao mesmo tempo; `core/src/noctum-execucao.ts` despacha no máximo um
  trabalho por passo, sob a trava do kernel, com o envelope conferido e a sessão reservada no orçamento imediatamente
  antes, só pelo `ork phase run`, e grava fora dessa trava a baseline que o despacho pede. Muda para todos:
  `ork verify` e a baseline esperam a vez na fila de recursos pesados (`concurrency.max_parallel_heavy`, padrão 1, 0
  desliga) e, sem ela no prazo, recusam com `fila-pesada.ocupada` e saem com 3 (o `ork verify` espera até `--esperar`
  ou 60 min; `ork ship`, `ork fix` e a baseline do `ork phase run`, até o `--esperar` deles ou 30 s, com aviso no
  stderr; o `ork retry`, até 30 s; o MCP, até 20 s); o comando que roda dentro da vez herda a marca da posse, e o
  `ork verify` aninhado nele não espera a vaga do próprio pai; a
  sessão com o turno encerrado sem resultado deixa a vaga do `ork phase run` depois de 15 min sem atividade; e o prompt
  de fase pede verify, build e suíte em primeiro plano, nunca com `&`. O modo continua desligado: `#Noctum` não é
  aceito e nenhum comando abre ou executa arco.
- **Design system Partitura no repositório** ([docs/design](docs/design/README.md)): o kit do Claude Design do dono (tokens
  em `docs/design/partitura/`, marca em `docs/design/marca/`, manual, brand kit, componentes, diretrizes e revisão de
  copy) entra no repositório, com um README de entrada e um apontamento no `AGENTS.md` para toda sessão que mexer em UI,
  design, frontend, componentes visuais ou layout. Em conflito, a Partitura vence o `tokens.css` legado.
- **#Noctum, fatia N1: envelope e estado do arco** ([RM-058](docs/roadmap/RM-058-modo-noctum.md)):
  `core/src/noctum-envelope.ts` define o contrato `ork.noctum-envelope/v1` (janela de 6 a 12 h com fuso, destinos com
  `push`, `pr` e `merge`, teto do arco e subtetos por conta e por runtime com unidade, horário e canal do relatório da
  manhã) e recusa pedido sem os valores do dono, listando o que falta, teto ilimitado e as ações que nunca entram (tag e
  publicação, produção, segredos, ação destrutiva, repositório público novo). `core/src/noctum-arco.ts` guarda o estado
  do arco num log encadeado e com MAC, só aceita autorização e revogação com prova de origem do dono pelo caminho do HITL
  (Telegram assinado e callback nativo, com recibo durável do canal, ou diálogo nativo do host, na fronteira da conta
  do sistema) e confere o recibo, o hash, a revogação, a janela e o destino imediatamente antes de cada efeito. O modo
  continua desligado: `#Noctum` não é aceito e nenhum comando abre arco ainda.
- **Sentinela do Condutor, mod de papel `dono`** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  `adapters/claude-code/mods/ork-sentinela` liga só na sessão do dono, mantém pelo núcleo a presença dela nesta
  máquina (`ork conducao sentinela bater` a cada 60 s; sai no fim da sessão e no `/sentinela pausar`), relê o passo do
  condutor de cada thread aberta quando um ledger muda e a cada batida, e publica pela ponte a linha da faixa (threads
  andando, paradas em degraus de tempo, pausada). `/sentinela` mostra o passo de cada thread e o diário. Despacha a
  fase seguinte das threads #Auto que o núcleo manda despachar, uma vez por turno: relê a condução e o retrato da
  thread, renderiza o prompt com o pedido guardado e despacha por `ork phase run --canal claude-code --correlacao
  sentinela:<sessão>`; a recusa que passa (outro condutor, sem vaga, pedido aberto) volta depois de 3 min, com a
  espera dobrando até 30 min na mesma recusa, e a retomada só roda `ork retry run` quando o `ork retry plan` é
  automático. A cada 5 min, o que só o dono resolve no `ork pulse --json` vira notificação do sistema, linha no diário
  e conta na faixa, uma vez por texto e com o próximo passo do núcleo (em #Auto, nunca o pedido de gate); o que foi
  mostrado entra no registro da ponte, para o Telegram não repetir.
- **Condução pela Sentinela no núcleo** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  `ork conducao sentinela status --json` (`ork.conducao-sentinela/v1`) diz se a Sentinela do Condutor está ligada nesta
  máquina (canal `claude-code`, sessão, batida e prazo de 3 min) e dá o passo do condutor em cada thread aberta, com as
  leituras do pulse, sem o limiar de 30 min e sem a forja; no #Auto, sai a fase seguinte à prova mais adiantada que a
  sessão do bloco deixou (artefato gravado depois do despacho, produto na branch, `ship_done` ou `master_done`), nada sai
  depois de um bloco que passou do CHECK, e a pendência do dono segura tudo. `bater` e `desligar`
  mantêm a presença, uma por máquina, com `sentinela_ligada` e `sentinela_desligada` no ledger do projeto só na troca.
  O guia `docs/guias/conducao-pela-sentinela.md` diz ao condutor externo como ceder o despacho enquanto ela conduz.
- **Publicação provada da branch e do PR** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  `ork ship publicar <thread>` (`ork.ship-publicar/v1`) publica a branch da thread e abre o PR pelo núcleo, só no modo
  que já autoriza o push (#Auto e #Maestro). Antes de qualquer efeito confere a thread aberta, ninguém conduzindo, a
  branch com produto, o CHECK com veredito PASSOU depois do último commit de produto, o último `ork verify` verde no
  HEAD (ou só o bundle depois dele), o bundle `.ork-ci/<thread>.json` com as claims ativas e os comandos delas, o remoto do GitHub e os
  PRs da branch; a recusa antes de qualquer efeito volta com motivo tipado e não grava nada. Empurra sem força o sha
  conferido, prova pelo `git ls-remote`, reaproveita o PR aberto ou abre um com o texto do `pr-body.md` da thread
  (título `ship(<thread>): ...`) e grava `ship_published`, também para o push que ficou sem prova; repetido, ou com o
  PR já mesclado no HEAD, responde `ja-publicada`. Não aceita `--autorizar-push`: nos outros modos o push é do
  dono, e a correção diz o comando dele. `ork ship pista --json` (`ork.ship-pista/v1`) dá, por thread aberta na
  entrega, as etapas (CHECK, verify, bundle, branch, PR, CI, conflito e `ship_done`) e o próximo passo com a ação
  que o núcleo declara disponível. A leitura dos PRs do pulse passa a trazer o estado de merge do PR aberto, e a prova
  do push pelo `git ls-remote` passa a valer só pela ref exata, também no `ork ship`.
- **Pista de Entrega, mod de papel `dono`** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  `adapters/claude-code/mods/ork-pista` liga só na sessão do dono e abre com `/pista [thread]` (a Torre abre a Pista
  assim) um painel com uma pista por entrega: as oito etapas do `ork ship pista --json` (CHECK, verify, bundle, branch,
  PR, CI, conflito e `ship_done`), o texto do núcleo em cada uma que falta e o próximo passo com o comando dele, no
  terminal e no desktop. Relê a pista fora do desenho, uma leitura por vez, quando um ledger muda, quando o retrato da
  ponte diz que uma entrega andou e por idade; publica na faixa só o que pede o dono e registra pela ponte o que o
  painel à vista mostrou, para o Telegram não repetir. Botão só com a ação que o núcleo declara disponível: Publicar
  (`ork ship publicar`, só em #Auto e #Maestro) e Registrar a entrega (`ork ship registrar-pr`); o clique relê a pista
  da thread antes de valer, roda o argv do próprio mod (nunca `git` nem `gh`) e deixa o resultado na pista. Fora de
  #Auto e #Maestro, só o comando para o dono. O CI acompanha o evento do GitHub que a sessão recebe (`session.receive`,
  fonte `github`, só pelos campos asseridos) como gatilho da consulta `ork ci status --sha <head> --json`, com reserva
  a cada 2 min à vista e 10 min escondido; o conteúdo do evento nunca vira estado, e a consulta que falha não apaga o
  que o núcleo leu. O guia `docs/guias/pista-de-entrega.md`
  diz ao condutor externo como trocar a publicação crua pelo `ork ship publicar`.
- **CLI em inglês e pt-BR, fatia F3a** ([RM-061](docs/roadmap/RM-061-cli-em-ingles-e-pt-br.md)): o que o CLI escreve em
  arquivo nasce na língua do dono no momento da geração (`owner.language` ou, sem ela, `LC_ALL`, `LC_MESSAGES` ou `LANG`
  em `en`): os comentários do `orkastery.yaml` e o bloco do `AGENTS.md` do `ork init`, o bloco da experiência que
  `ork adapter install` põe no `CLAUDE.md` (ou no `AGENTS.md` do Codex) e os sete arquivos do `ork docs init`, que passa
  a imprimir em inglês também. Chaves, valores e marcadores não mudam, nem o que o `ork docs verificar` lê nas páginas
  (frontmatter, nomes das seções e a linha `Em uma frase` seguem em pt-BR); o pt-BR segue igual byte a byte. Rodar
  `ork init` de novo regrava o bloco do `AGENTS.md` na língua do momento, e o bloco da experiência é reconhecido nas
  duas línguas na reinstalação e na remoção. A referência do CLI ganha a versão em inglês,
  [`docs/referencia/cli.en.md`](docs/referencia/cli.en.md), ligada à de pt-BR e conferida por teste. O catálogo vai de
  835 para 877 entradas.
- **Conhecimento escrito, fatia 1: o contrato e a leitura** ([RM-026](docs/roadmap/RM-026-workspace-empresarial.md)):
  o bloco `conhecimento: { dir }` do `orkastery.yaml` declara uma pasta de documentos Markdown no contrato
  `ork.conhecimento/v1` ([contrato](docs/referencia/contratos/conhecimento-rm026.md)), com frontmatter fechado: `id`
  (`doc-...`), `titulo`, `colecoes` e `referencias` a ids do Brain e a decisões `thread#linha` do ledger. O núcleo lê a
  pasta e devolve os documentos válidos, as coleções e as lacunas tipadas: documento inválido ou referência que não
  confere nunca entra na resposta. A decisão confere no ledger canônico da thread, com a fonte e o sha256 da linha que a
  captura do Brain grava; o id do Brain confere só pela forma até a fatia 2. A pasta segue a fronteira da RM-047: fica
  dentro da raiz pelo caminho real, link não é seguido e nada é executado. Ainda sem CLI pública nem tools MCP (fatias
  2 e 3); projeto sem o bloco segue igual.
- **Batida da fábrica instalada e vigiada pelo `ork`** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md), F1):
  `ork fabrica batida instalar|status|remover`. O `instalar` põe no crontab desta máquina, de forma idempotente, a
  linha do template `monitor/pulse.cron` com o checkout canônico (`ORK_PULSE_PROJECT`), o PATH que acha `node`,
  `claude` e o transporte, e a marca `# ork-batida`; preserva as outras entradas, nunca grava sem ler e confere
  relendo. O `remover` tira só a linha marcada; o `status` diz a linha e a última rodada do `hitl.log`, com a idade,
  e sai 1 sem a batida. Os eventos novos `batida_instalada` e `batida_removida` vão ao ledger da máquina
  (`~/.orkastery/ledger.jsonl`). O crontab é lido como o cron e o `sh` o leem (linha de ambiente que vale para as
  entradas seguintes, aspas, `~` e `$HOME`), e o que mudou entre a leitura e a gravação não é sobrescrito. O
  `ork doctor` passa a reprovar quando o projeto tem thread aberta e não há batida deste projeto, com ou sem
  `pulse-host.json`, com a correção `ork fabrica batida instalar`; uma rodada de até 30 min no `hitl.log` prova a
  batida de outro agendador. Antes, sem transporte, ele calava, e o maquina-b ficou de 03/10 a 12/10/2026 sem varredura.

### Corrigido

- **Superfícies honestas: "sigo" só com sessão viva** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md), F2): o
  `ork roadmap status` (o fecho "O que eu faço em seguida", também no MCP e na visão da rede) só diz `sigo <thread> na fase <F>` com a sessão viva verificada no runtime (`claude agents --json --all` de cada conta e os rollouts do
  Codex) ou com o processo do condutor conduzindo agora; sessão fantasma, despacho falho e nenhuma sessão viram
  `<thread> parada desde HH:MM: <motivo>`. O "O que precisa de você" lê a mesma fila do `ork pulse`
  (`precisaDeHumanoAgora`, sem forja e sem registrar) e nunca diz "Nada agora" com item do dono nela, nem com a fila
  lida pela metade; o campo aditivo `filaDoDono` leva os itens no `--json`. O `ork fabrica` e o `FABRICA.md` ganham a
  coluna da sessão de cada thread (`viva` ou `parada desde HH:MM`), publicada no retrato (`sessao`, opcional). Em
  12/10/2026 o status disse "Nada agora" e "sigo" com o despacho da K7 morto e o pulse contando 3.
- **Retry que sempre tem o prompt** ([RM-063](docs/roadmap/RM-063-fabrica-que-nao-para.md), F3): o `ork phase run`
  grava o prompt e o evento `phase_prompt_recorded` (prompt e sha256) antes de chamar o adaptador; a falha seca do
  adaptador e a exceção dele viram `gate_blocked runtime.unavailable` com o prompt e o sha256. O `ork retry run`
  acha o prompt pelo despacho da sessão do gate, pelo próprio gate ou pela tentativa mais recente da fase, localiza o
  arquivo pelo sha256, só dentro do projeto (o caminho gravado da worktree não resolvia do checkout), e redespacha o
  mesmo sha256 sem pedir o texto. Antes de redespachar, confere no runtime que nenhuma sessão viva trabalha na thread
  (o `claude --bg` lento devolve erro com a sessão aberta): com ela, ou sem resposta do runtime, nada sai e a tentativa
  não conta. Antes saía com "não há despacho falho registrado em GO com prompt gravado".
- **Portão de Tarefas, o segundo mod de papel `fase`** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  `adapters/claude-code/mods/ork-portao` faz do quadro de tarefas do Claude Code, na sessão de fase do GO, o quadro
  do plano: a tarefa só entra apontando uma tarefa do plano com `touch_paths` e verify, e só fecha com a conferência
  do núcleo aprovada (`ork claims conferir --tarefa`, no sandbox do verify), nunca com o verify rodado pelo mod. Plano
  sem nenhuma tarefa assim não ganha portão. Com agent teams no piloto, o teammate ocioso recebe a próxima tarefa
  cuja região está livre: sem lease `path:` ativo de nenhuma thread no caminho (lidos de todas as threads pelo
  `ork maestro --json`, página a página; leitura incompleta deixa o teammate ocioso) e sem cruzar as tarefas dos
  outros teammates; o Portão não toma lease. O manifesto ganha `runtime.agent_teams`
  (`ligado`, `teammates`, `custo_usd`), desligado por padrão: ligado, o despacho do GO com o Portão na sessão passa
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` e os dois tetos, que o Portão aplica no nascimento de teammate e na entrega
  de tarefa.

## [0.5.5] - 2026-10-12

Não publicada no npm; o conteúdo saiu na 0.5.6.

### Adicionado

- **Item novo de roadmap, RM-062: repositório público sem dado privado** ([RM-062](docs/roadmap/RM-062-repositorio-publico-sem-dado-privado.md)):
  nada privado do dono entra em repositório público, nem em linha, nem em nome de arquivo, nem em JSON de evidência.
  Quatro fatias: barreira no CI do núcleo e dos sites (padrões genéricos mais uma lista local fora do git), a mesma
  barreira no `ork verify` e no `ork ci prepare`, nome genérico de máquina na evidência de rede e o relatório honesto de
  quando algo escapou. Só a página e o registro no índice; o código das fatias vem depois.
- **Freio de Lote, o primeiro mod de papel `fase`** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  `adapters/claude-code/mods/ork-freio` acha, a cada lote de ferramentas da sessão de fase, os arquivos que o lote
  mexeu (inclusive por `Bash`, pela diferença do `git status`) e as claims da thread que os citam, pede ao núcleo a
  conferência delas em segundo plano (`ork claims conferir`, no sandbox do verify) e devolve o que quebrou no lote
  seguinte, com o id da claim, o comando e o fim da saída; também avisa o lote que mexeu fora dos `touch_paths` do
  plano. Nunca roda comando de claim, nunca grava estado de claim e nunca para o laço: o `ork verify` continua sendo
  quem verifica. Vai às sessões de fase pela distribuição dos mods e ao marketplace próprio pelo gerador; sem um
  `ork` com `claims conferir`, avisa uma vez que a conferência está indisponível.
- **CLI em inglês e pt-BR, fatia F2a** ([RM-061](docs/roadmap/RM-061-cli-em-ingles-e-pt-br.md)): `ork doctor` inteiro, o
  erro de `ork init` fora do repositório, `ork onboarding` (pauta, `show`, `set`, `reset`), `ork experiencia show`,
  `ork thread new`, `ork thread status`, `ork phase list`, o resumo de `ork phase run` e a ajuda (`ork --help` e a ajuda
  por comando) saem em inglês quando `owner.language` ou, sem ela, `LC_ALL`, `LC_MESSAGES` ou `LANG` pedem `en`. O pt-BR
  segue igual byte a byte; o `--json`, o ledger, o `thread.json` e os prompts não mudam com a língua. Erro do validador
  do manifesto, do regime de memória e de estado durante a gravação segue em pt-BR até a F2b.
  `core/scripts/contar-mensagens-de-saida.cjs` mede a cobertura do catálogo (de 92 para 382 entradas).
- **CLI em inglês e pt-BR, fatia F2b** ([RM-061](docs/roadmap/RM-061-cli-em-ingles-e-pt-br.md)): `ork verify` (com
  `--baseline`), `ork ship`, `ork ship registrar-pr`, `ork pulse`, `ork master` (o índice, `--aceitar-omissao` e
  `master pedir`), `ork retry plan`, `ork retry run` e `ork roadmap status` saem em inglês quando `owner.language` ou o
  locale pedem `en`. O pt-BR segue igual byte a byte; o `--json`, o ledger, o MASTER log e os demais arquivos gravados
  não mudam com a língua: o texto que o comando monta e grava nasce em pt-BR, e só a impressão o remonta. Motivo
  tipado, ação e código saem iguais nas duas línguas. O catálogo vai de 389 para 835 entradas.
- **Mods de papel `fase` nas sessões de fase, conferidos contra o recibo** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  o despacho `claude-bg` passa um `--plugin-dir` por mod de `adapters/claude-code/mods/` que declara o papel `fase` no
  `orkastery-mod.json` (`ork.mod/v1`), depois do plugin do Orkastery, quando a pasta instalada tem exatamente os arquivos
  do `INSTALADO.json` e o `claude --version` atende o `claudeCodeMinimo` do mod e o 2.1.287 da API de mods. Arquivo a
  mais, link ou declaração inválida recusa o despacho com `runtime.context.installation`; mod que pede versão mais nova
  fica de fora e o despacho segue, e o mod que depende dele sai junto. O arquivo comum da raiz de `mods/` (a lista de
  autoridade da ponte) também precisa estar no recibo. O `ork adapter install claude-code` tira da cópia o arquivo de
  mod que saiu do catálogo. Sem mods, o comando é o de antes.
- **Mods no marketplace próprio, pelo gerador** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  `node core/scripts/gerar-marketplaces.cjs` copia cada mod de `adapters/claude-code/mods/*/orkastery-mod.json` para
  `marketplaces/claude-code/mods/<mod>/`, com os arquivos comuns da raiz de `mods/` dentro de cada cópia, e põe o mod no
  `.claude-plugin/marketplace.json` com `source` na cópia. O `--verificar` confere a declaração, o manifesto, o
  `hooks/hooks.json` e a cópia em dia. A pasta do diretório da Anthropic segue sem mods e sem hooks.
- **Job dos mods no CI e canário de eventos** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)): o job
  `mods` instala o Claude Code 2.1.296 fixado pelo npm, sem credencial nem chave de API, e roda
  `node core/scripts/canario-eventos-mods.cjs --com-plugin`: `claude plugin validate --strict` e `claude plugin test` em
  cada mod e a busca, no binário, de cada evento e chamada de `$` que os mods usam, com um nome de controle que precisa
  ficar ausente. Medido: os builds 2.1.288 e 2.1.289 reprovam (sem `ui.notify`) e o 2.1.296 aprova.
- **`ork claims conferir`** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)): reexecuta só as claims
  pedidas (`--claims C3,C7`) ou o verify de uma tarefa do plano da thread (`--tarefa T2.1`, quando ele é um comando só
  entre crases) no sandbox do `ork_verify`, na worktree da thread registrada no git do projeto, sob a condução da
  thread e sem gravar recibo; `--json` devolve `ork.claims-conferencia/v1`, com prazo total de 180 s (teto de 600 s).
  No sandbox, processo filho do node falha: teste que cria processo pode reprovar ali e passar no `ork verify`.
- **Pedido guardado na criação da thread** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  `ork thread new --pedido "<texto>"` guarda o pedido em `pedido.md`, com o sha256 no `thread.json` e no
  `thread_created`, e o `ork prompt render` sem `--pedido` usa esse pedido, conferido pelo sha256. Thread sem pedido
  guardado segue como antes.
- **Fundação dos mods no Claude Code, lado do adaptador** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  a ponte `ork-ponte` (`adapters/claude-code/mods/ork-ponte`) acrescenta ao `$` dos mods o noun `$.ork`, com o papel
  da sessão (`dono`, `fase` ou `dormente`), o retrato do núcleo pelo `ork_maestro` com reserva numa lista fechada de
  consultas `--json` do CLI, a faixa acima do prompt e os `watchPaths` com dono único, e o registro do que um mod
  mostrou ao dono (`ork.mod-mostrado/v1`). A regra de autoridade (nenhum mod aprova gate, permissão, nota do MASTER,
  push ou tag pelo dono, nem fala como o dono) mora em `adapters/claude-code/mods/autoridade.json` e tem duas guardas:
  `node core/scripts/checar-mods.cjs` reprova o mod pelo fonte, e a ponte recusa em tempo de execução. O script
  `core/scripts/prova-mods-sessao-de-fase.cjs` prova se um mod carrega numa sessão `claude --bg`; o veredito fica com
  quem conduz.
- **Clima de Cota no Claude Code** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md), onda 1): o mod
  `ork-clima` (`adapters/claude-code/mods/ork-clima`), na sessão do dono, lê as janelas de limite da conta a cada
  medição do motor (`session.measure`), guarda a série e prevê quando cada janela acaba no ritmo atual. Na faixa da
  ponte, só no alerta, aparece algo como `não cabe: ork-x; 5 h com 80% ou mais, acaba ~16:45, renova 17:00`, com a
  retomada da fila que cai entre o esgotamento e a renovação na frente; o `/clima` mostra cada janela, a fila de
  retomada, as threads abertas paradas por cota e as contas do registro (`ork accounts esgotamentos`), com o que o
  núcleo já sabe fazer. O Clima só lê e avisa: troca de conta, de runtime ou de modelo fica com o núcleo e com o dono.
- **Torre de Controle no Claude Code** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md), fatia F1):
  o mod `ork-torre` (`adapters/claude-code/mods/ork-torre`), sobre a ponte, abre na sessão do dono um painel com cada
  thread aberta numa linha: o trilho das seis fases, o modo, quem conduz e desde quando, o bloqueio tipado numa frase
  curta, os pedidos ao dono e a ação que o estado da thread pede, entre as que o núcleo declara. `/torre` abre o
  painel; sozinho, ele só abre no fullscreen e nunca depois que o dono o fecha. Apertar a linha abre o detalhe (sessões, últimos eventos, claims com estado e as leituras de estado,
  observação e git). Ação com efeito nunca roda pela Torre: abre o mod dono dela pelo comando dele, quando ele está
  carregado, ou aparece como o comando do `ork` para o dono rodar. As threads das outras máquinas entram quando a rede
  é lida, a linha da faixa sai pela ponte e o que o painel mostrou na tela entra no registro da ponte, para o Telegram
  não repetir.
- **Radar de Colisão no Claude Code** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md), fatia F3):
  o mod `ork-radar` (`adapters/claude-code/mods/ork-radar`), sobre a ponte, calcula na sessão do dono, a cada 10 min e
  no `/radar`, o merge de cada thread aberta contra a `origin/main` local e entre as threads, antes do SHIP, sem
  worktree e sem gravar objeto no repositório: os SHAs saem do `git ls-remote` e cada par roda
  `git merge-tree --write-tree` com os objetos novos num temporário e os do repositório como alternativo. O `fetch`
  continua com o núcleo; a base diferente do remoto aparece com os dois SHAs. O painel mostra o mapa de calor (`Raster`
  no terminal, tabela nas outras superfícies), os arquivos em conflito, o lease `path:` que cobre cada um e o comando
  `ork worktree sync <thread> --dry-run` que resolve, como texto. A colisão nova vira uma linha na faixa pela ponte, e
  o que o dono viu entra no registro da ponte, para o Telegram não repetir.
- **Mesa do Dono no Claude Code** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md), fatia F5): o
  mod `ork-mesa` (`adapters/claude-code/mods/ork-mesa`), sobre a ponte, junta na sessão do dono tudo que espera por
  ele. `/mesa` abre um painel com o lote de até cinco perguntas, cada uma com a recomendada na frente, o porquê e a
  consequência das outras alternativas; as decisões que a fábrica tomou por ele na semana, com como mudar e o custo de
  reverter agora e depois; e as paradas, só leitura. O botão Decidir só pede ao núcleo o diálogo nativo do host
  (`ork_request_decision`, com o `threadId` e o `pedidoId`), e o código e a letra para o Telegram ficam sempre à
  vista. A Mesa só decide pelo dono pela decisão autônoma do núcleo (`ork_decision_record`), quando o pedido passa no
  mesmo teste das quatro condições do núcleo, e nunca responde um pedido. A prova de que o diálogo abre quando o
  pedido vem de um mod fica com o dono: `core/scripts/prova-mods-dialogo-nativo.cjs` e
  `docs/roadmap/evidencias/mods-dialogo-nativo.md`.
- **CLI em inglês e pt-BR** ([RM-061](docs/roadmap/RM-061-cli-em-ingles-e-pt-br.md)): nova página do
  roadmap, em desenvolvimento, com a decisão do dono de 12/10/2026 de que o CLI fala inglês e pt-BR. A
  língua vem de `owner.language` e, sem ela, de `LC_ALL`, `LC_MESSAGES` e `LANG`; o pt-BR fica idêntico
  byte a byte, o `--json` não muda com a língua e as datas seguem o locale. Fatias: F1, a prova de
  conceito do #113 (`doctor`, `init`, catálogo tipado e datas), já mesclada; F2, o caminho da primeira
  experiência; F3, o resto do CLI, os arquivos gerados e a referência em inglês. A entrada é só
  documentação.
- **Decisões do dono no modo #Noctum** ([RM-058](docs/roadmap/RM-058-modo-noctum.md)): em 12/10/2026 o
  dono decidiu D1 a D4 (entrega com push, PR e merge no SHA exato; piloto local e depois em duas
  máquinas; janela de 6 a 12 h com vigia externo a cada 5 min; vários perfis e runtimes de assinatura
  com teto e subtetos). Continuam pendentes a prioridade final, o horário e o canal do relatório e os
  valores do teto; o item segue em Refinamento até o dono autorizar o primeiro piloto.
- **Verify ciente do steal e registro de instabilidade** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md), fatia 6):
  - o `ork verify` (CLI, MCP e CHECK-REVERIFY) mede o steal da CPU no `/proc/stat` na rodada e na janela de cada
    comando e grava a medida no `verify_run` (`steal`, e `stealPct` em cada comando que falha);
  - a reprovação só de teste com relógio (estouro de prazo do `node --test`, ou entrada vigente do registro) sob steal
    acima de 40% vira `verify.timeout`, que o retry reexecuta, e nunca `verify.regression`; asserção comum continua
    regressão, sem `/proc/stat` nada é atenuado e o `ork ci run` não atenua;
  - `core/instabilidade.json`, contrato `ork.instabilidade/v1` ([contrato](docs/referencia/contratos/instabilidade-rm037.md)),
    nasce vazio e só aceita entrada com a taxa medida e revalidação em até 30 dias;
  - o `testeQueCaiu` do ledger lê a seção "failing tests" do reporter `spec` do `node --test` 24, que antes saía vazio.
- **O `ork roadmap status` diz quando uma thread fora do roadmap espera você** ([RM-049](docs/roadmap/RM-049-lancamento.md), R3):
  no ensaio, uma thread sem item do roadmap esperava o dono por `runtime.workspace-untrusted`, e o relatório dizia
  "O que precisa de você: Nada agora" enquanto o `ork pulse` dizia "Precisa de humano agora: 1". Pela alternativa (a)
  da decisão do dono, o fecho ganha a linha "Fora do roadmap: N thread(s) esperam você (ork pulse)", só quando há, e o
  `--json` o campo opcional e aditivo `foraDoRoadmap`. Sem thread fora do roadmap esperando, a saída fica igual byte a byte.

### Alterado

- **Requisito de linguagem simples no HITL por alternativas** ([RM-057](docs/roadmap/RM-057-hitl-por-alternativas.md)):
  todo passo que depende do dono chega como pergunta com 3 alternativas e uma recomendada, em linguagem simples, sem lista
  de comandos crus e sem termo técnico sem explicação (o caso: o comando de uma tag mandado sem dizer o que é uma tag).
  A recomendada, quando possível, é a que o dono responde com uma palavra e a fábrica executa o resto com a autorização dele.
- **Teto dos testes no verify deste repositório** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  o `orkastery.yaml` do projeto passa a dar 40 min ao comando `test`, teto que o comando hermético do CI
  herda ao rodar `test:ci`, porque a suíte leva de 7 a 8 vezes o tempo que leva com CPU livre quando o hipervisor
  rouba CPU. O `build` e os outros comandos seguem no prazo padrão.
- **No #Fast, o ship sem `--autorizar-push` não desconta o índice** ([RM-049](docs/roadmap/RM-049-lancamento.md), EN8):
  o `ship_blocked` com `human.pending` de uma thread #Fast é a pausa prevista do modo, como o `ork ship --dry-run`
  barrado, e deixa de entrar no índice derivado do MASTER (era 4.75/5, `ship_blocked x1`). Fora do #Fast, ou com
  outro motivo, o desconto segue. Decisão do dono, alternativa (a) do recibo do ensaio em inglês.

### Segurança

- **Postura de sandbox e procedência do estado** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md),
  P1 a P5 da [fronteira de confiança](docs/referencia/fronteira-de-confianca.md)). Patch de segurança, por decisão do
  dono (S1 a, 11/10/2026).
  - **Muda para quem já usa** (uma vez em cada máquina): com `runtime.sandbox: danger-full-access`, rode
    `ork setup sandbox confirmar danger-full-access`; com `.orkastery/` versionado, `git rm -r --cached .orkastery`;
    com `worktree.dir` fora da raiz, `ork setup worktree confirmar`; com a fábrica ligada só pelo manifesto,
    `ork fabrica entrar`; com o `ork` instalado rodando `ork eval` num checkout do Orkastery, `node core/dist/index.js eval`.
    Quem usa `.claude/worktrees`, `workspace-write`, estado fora do índice e `ork fabrica entrar` não percebe mudança.
  - o `runtime.sandbox` que afrouxa o sandbox do agente (`danger-full-access`) só despacha pelo Codex depois de a
    máquina confirmá-lo com `ork setup sandbox confirmar <postura>`, gravado em `.orkastery/private/postura-local.json`
    (0600, fora do git, só para este checkout). Sem isso, `ork phase run` e `ork retry run` recusam com
    `runtime.sandbox-nao-confirmado`, e o `ork doctor` acusa. **Muda para quem já usa `danger-full-access`:** rode o
    comando uma vez em cada máquina;
  - estado de `.orkastery/` rastreado pelo git não escolhe cwd, worktree nem executável (`estado.rastreado`), e o cwd
    de git e agente vindo do `thread.json`, do ledger ou da fila só vale na raiz do projeto ou numa worktree do
    `git worktree list` do repositório (`estado.worktree-nao-registrada`). Vale para despacho, retomada, verify, claims,
    GO-FIX, prova do GO, handoff, liveness, `ci prepare` e `ork worktree audit|release`. **Muda para quem versiona o
    `.orkastery/`:** tire o estado do índice (`git rm -r --cached .orkastery`);
  - o transporte do pulse e do digest só vale do `pulse-host.json` e do `master-host.json` locais, arquivos comuns
    fora do índice do git (`transporte.rastreado`);
  - os ponteiros do `ork recall`, do `ork handoff recall` e do `ork handoff export` (o `location` do `handoff.json`,
    o arquivo de uma claim, o prompt de uma sessão, o handoff e a lição vindos da memória) só leem arquivo que, pelo
    caminho real, fica na raiz do projeto ou na worktree registrada da thread. O recall recusa com
    `ponteiro.fora-da-raiz`, e o export deixa de apontar para fora;
  - o `worktree.dir` do manifesto que leva para fora da raiz pelo caminho real (`..`, caminho absoluto, link no
    caminho ou `.git`) só cria worktree depois de a máquina confirmar a pasta com `ork setup worktree confirmar`,
    gravado em `.orkastery/private/worktree-local.json` (0600, fora do git, só para este checkout e esta pasta). Sem
    isso, a criação recusa com `worktree.dir-fora-da-raiz`, e o `ork doctor` acusa. **Muda para quem já usa worktree
    fora da raiz:** rode o comando uma vez em cada máquina; as worktrees que já existem seguem valendo;
  - o `ork eval` só executa o catálogo (canários, hooks e `core/dist`) do pacote que está rodando. Um diretório com
    `skills/`, `references/` e `eval/` achado a partir do cwd que não é o do pacote recusa com `eval.catalogo-alheio`.
    **Muda para quem roda o `ork` instalado dentro de um checkout do Orkastery:** use o `ork` do checkout
    (`node core/dist/index.js eval`), como o CI já faz;
  - o `fabrica.compartilhada: true` do manifesto não liga mais a publicação do retrato desta máquina (threads, nome,
    host) no remoto do clone, nem a leitura das outras máquinas: só a adesão da máquina liga (`ork fabrica entrar`,
    em `~/.orkastery/maquina.json`, ou `ORK_FABRICA_COMPARTILHADA=1`). Com o pedido no manifesto e sem a adesão, o
    `ork doctor` e o `ork fabrica` avisam com `fabrica.nao-confirmada`. **Muda para o time que ligava a fábrica só
    pelo manifesto:** rode `ork fabrica entrar` uma vez em cada máquina.
- **Fronteira de confiança do repositório clonado** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)):
  auditoria de cada chamada de processo e de cada caminho montado com dado do clone em `core/src`, com a matriz em
  [docs/referencia/fronteira-de-confianca.md](docs/referencia/fronteira-de-confianca.md). Corrigido:
  - o `mergeSha` e o `para` de um `ship_done` do ledger só chegam ao `git log` da detecção de reversão como sha
    hexadecimal e nome de branch, depois de `--end-of-options`; antes, um ledger versionado no clone passava uma
    opção ao git em `ork master` e `ork ship`;
  - `ork docs sincronizar` não cai mais na base crua do manifesto quando ela não resolve, e o sha do ledger e o
    commit do frontmatter só vão ao git como sha hexadecimal;
  - o manifesto recusa `worktree.base_branch` que o git não aceita como nome de branch (começa com `-`, tem `..`);
  - o manifesto recusa `memory.cli` relativo: vale nome procurado no PATH, como `orkmind`, ou caminho absoluto. A
    sonda do OrkMind (inclusive a do `ork doctor`) ignora entradas relativas do PATH e shebang com interpretador
    relativo, e o `ork brain` roda o executável com cwd no `$HOME`, não na raiz do clone;
  - `.orkastery`, `.orkastery/threads` e a pasta de uma thread como link simbólico recusam com `estado.link`, e o
    append do ledger, das claims e do board usa `O_NOFOLLOW`; antes, um link versionado levava a escrita para fora
    da raiz;
  - o id de uma rodada de auditoria lido do `run.json` precisa ser um nome simples (`audit.rodada-invalida`).
  - O SECURITY.md passa a listar todos os comandos declarados que o `ork` executa (inclusive `verify.preparo`,
    `ci.command`, `.ork-ci/` e `doneWhen`). Cinco itens que exigem mudar comportamento aceito hoje ficam na matriz
    como pendentes do dono.

### Corrigido

- **Prova de mod em sessão de fase** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  `core/scripts/prova-mods-sessao-de-fase.cjs` abre a sessão de sonda com `--strict-mcp-config`, como o despacho de fase;
  sem a flag, a sessão parava na aprovação do MCP do projeto e a prova saía inconclusiva. Veredito da T0.1: o mod carrega
  numa sessão `claude --bg` e recebe `classic.PostToolBatch`.
- **Nome de máquina do dono fora do repositório público** ([RM-062](docs/roadmap/RM-062-repositorio-publico-sem-dado-privado.md)):
  o arquivo de evidência da RM-040 foi renomeado para `docs/roadmap/evidencias/RM-040/maquina-b-2026-10-03.json`, e o
  hostname de uma máquina do dono, que aparecia em recibos, páginas do roadmap, contratos, comentários e bundles de
  claims, virou `maquina-b`; caminhos de home de exemplo passaram a `/home/usuario`. O nome antigo continua nos commits
  anteriores, porque o histórico não é reescrito.

## [0.5.4] - 2026-10-12

Não publicada no npm; o conteúdo saiu na 0.5.6.

### Adicionado

- **Quickstart até a primeira thread em `#Fast`** ([RM-049](docs/roadmap/RM-049-lancamento.md)):
  `docs/comecar/quickstart.md` ganha o atalho do menor ciclo completo, de `ork thread new --modo fast` a
  `ork master`, com a saída para `runtime.workspace-untrusted` e para o `human.pending` do `ship`; um teste confere os comandos.
- **Que página do site uma mudança deixa para revisar, e a medida do piloto de contribuição** ([RM-050](docs/roadmap/RM-050-guia-de-contribuicao.md)):
  `node core/scripts/checar-fontes-do-site.cjs --snapshot <docs-sources.json>` compara o checkout com o snapshot de fontes
  do site e lista, por página, as fontes mudadas, novas e removidas; com `--base <ref>`, só o que a mudança tocou desde
  que saiu da ref. Sai 0 em dia, 1 com fonte a revisar e 2 com erro. `node core/scripts/medir-piloto-de-contribuicao.cjs`
  mede pelo `gh api` os PRs de fora desde a publicação do guia, a conclusão da primeira execução do CI de cada um e o
  critério de dois PRs mesclados sem ajuda; lacuna da coleta reprova em vez de virar zero. O guia de documentação passa
  a explicar o catálogo dos dois sites, e a triagem, a medida.
- **Roadmap: condução dentro do Claude Code** ([RM-059](docs/roadmap/RM-059-conducao-dentro-do-claude-code.md)):
  página nova do item que leva a condução da fábrica para a sessão do Claude Code com dez mods (Freio de Lote,
  Sentinela do Condutor, Torre de Controle, Mesa do Dono, Portão de Tarefas, Clima de Cota, Pista de Entrega,
  Ritual do MASTER, Mensageiro de Sessões e Radar de Colisão), em quatro ondas, com as decisões do dono, os
  riscos e as métricas pelo ledger. Só documentação: nenhum mod existe ainda.
- **Roadmap: site como produto** ([RM-060](docs/roadmap/RM-060-site-como-produto.md)): página nova do item que
  trata os dois sites públicos como produto, com seis fatias (código que não quebra, quickstart, mesma regra
  no site do OrkMind, docs e home por versão, CI e prévia de PR) e a regra de que nada é mesclado nem
  publicado sem a aprovação do dono. Só documentação.
- **Diagnóstico na prova da busca por significado** ([RM-038](docs/roadmap/RM-038-busca-semantica-na-memoria.md)):
  `core/scripts/prova-busca-semantica.sh` mostra, por par, a posição e a similaridade de cada alvo no
  ranking vetorial e quantas entradas da busca têm vetor coerente no índice, na mesma consulta
  vetorial, agora com `--limite 100`. O diagnóstico não muda o critério da prova (alvo no top 5 da
  semântica, fora da tag e do FTS da paráfrase) nem os códigos de saída.
- **Proveniência conferida contra a árvore nas tools do grafo, KG5 fatia 5** ([RM-031](docs/roadmap/RM-031-grafo-de-codigo.md)):
  as consultas por nó (`ork grafo vizinhos`, `chamadores`, `importadores` e `caminho` com `--json`, e as
  tools `ork_grafo_*`) trazem `fontes`, com o sha256 e o blob do Git de cada arquivo citado e a situação
  dele na árvore (`igual`, `modificada` ou `ausente`), e cada aresta traz `arvore`, `modificada` quando a
  origem, o alvo ou uma evidência mudou depois do HEAD. No pacote de contexto, só o grupo de fonte mudada
  ganha `arvore: "modificada"`; com a árvore limpa, o pacote é o de antes, byte a byte. A árvore só é
  lida quando o `git status` diz que mudou, pelos bytes, sem seguir link e com o tamanho conferido antes
  de abrir; nenhum índice guardado precisa ser refeito. O texto da CLI marca a aresta, e as descrições
  das tools e a dica do pedido explicam a marca. Custo medido no mesmo índice: de 15% a 29% a mais de
  bytes por resposta; na pergunta cortada pelo teto, 34 arestas em vez de 41. A flag `grafo.mcp`
  continua desligada.
- **Planejamento do modo #Noctum** ([RM-058](docs/roadmap/RM-058-modo-noctum.md)): proposta no roadmap de arcos autônomos de 6 a 12 horas, com envelope de autorização, muitas threads e máquinas, resiliência, qualidade, custo e relatório; modo ainda não implementado.
- **CLI em inglês e pt-BR, fatia 1 da RM-061** (achados EN1, EN6 e EN7 do
  [recibo do ensaio em inglês](docs/roadmap/evidencias/RM-049/ensaio-2026-10-03-en.json)): o texto de `ork doctor` e
  `ork init` sai em inglês quando `owner.language` (a escolha do onboarding) ou, sem ela, `LC_ALL`, `LC_MESSAGES` ou
  `LANG` pedem `en`; com `en`, as datas desses comandos saem em ISO (`2026-10-03 06:30`). O padrão segue pt-BR, igual
  byte a byte; os demais comandos, o `--json` e o `ork doctor --modo` não mudam. Sem dependência nova
  (`core/src/locale.ts`).
- **Citações e segundo salto no contexto da thread, KG5 fatia 4** ([RM-031](docs/roadmap/RM-031-grafo-de-codigo.md)):
  arestas `cites` ligam caminhos literais em Markdown e strings de testes/scripts a arquivos existentes
  no índice, com evidência de linha, sem duplicar links ou imports resolvidos, inclusive código inline
  no rótulo de links relativos ou resolvidos pela raiz, nem sondar palavras ou nomes de pacote.
  Sondas e variantes de extensão e `index` preservam a equivalência incremental quando
  diretório vira arquivo e volta, inclusive diretórios com extensão no nome. `cites` fica por último no
  desempate por tipo. Após selecionar as ligações diretas,
  o pacote v2 usa a sobra para vizinhos a dois saltos, marcados com `salto: 2`, mantendo o teto em
  bytes e parando após oito rejeições seguidas por espaço. `omitidos.segundo_salto` separa as
  omissões indiretas, que não ativam `truncado` quando a vizinhança direta está completa. A medida
  histórica continua v3, com o mesmo comparador: a cobertura do pacote vai de 23% para 69% (KG3) e de
  41% para 65% (KG4), acima da descoberta por grep nos dois casos; a precisão cai para 36% e 61%, ainda acima
  dela; o pacote quase dobra (28.015 e 32.706 bytes) e, no KG4, passa a saída do grep (25.988).

### Alterado

- **Primeira experiência em inglês e o recibo do ensaio** ([RM-049](docs/roadmap/RM-049-lancamento.md)):
  o `README.md` traz a primeira thread e o glossário do CLI, o `CONTRIBUTING.md` o caminho curto, e o recibo do ensaio
  em inglês (EN1 a EN10) registra os achados corrigidos com o PR e o commit de cada um.
- **A prova da busca por significado usa os pares que o dono decidiu** ([RM-038](docs/roadmap/RM-038-busca-semantica-na-memoria.md)):
  sem argumentos, `core/scripts/prova-busca-semantica.sh` consulta
  `watchdog|vigia agendado que inunda a conversa privada com avisos repetidos` e
  `duplicacao|dois repositorios gemeos fundidos num unico oficial` (decisão do dono em 10/10/2026), no lugar
  dos pares `rotacao` e `handoff`; pares passados como argumentos substituem os padrão.

### Corrigido

- **Impedimento que só o dono resolve, RM-055, continuação** ([RM-055](docs/roadmap/RM-055-impedimento-do-dono-vira-hitl.md)):
  - a classificação segue as frases reais do claude 2.1.296: o aviso de termos que bloqueia ("[ACTION
    REQUIRED] ... You must run `claude` to review the updated terms.") e os portões do `--bg` para o modo
    sem permissões e o modo auto viram `runtime.consent-pending`, com o comando exato tirado da própria
    frase (só na forma fechada do binário com opções); "could not be resolved on disk", o diretório home e
    o aviso de carência dos termos não viram espera do dono, porque aceitar a confiança não os resolve;
  - a prova de que o dono aceitou a confiança segue a regra que o claude aplica no `--bg`: vale o diretório
    e os de cima até a raiz git, e o repositório principal de uma worktree vinculada, dentro ou fora dele; o
    diretório acima do repositório não vale mais (dava "resolvido" onde o claude recusa, e travava o
    re-despacho numa worktree fora do repositório);
  - o redespacho recusado de novo pelo mesmo impedimento não gasta tentativa nem sobe esforço: antes, a
    quarta chamada do `ork retry run` escalava e o retry nunca mais re-despachava, nem depois do aceite;
  - o resumo que chega ao dono traz o bloco "Só você destrava, no terminal", com a thread, a fase, o
    comando e o `ork retry run` de cada impedimento, e o impedimento novo sai na hora, sem esperar a janela
    da cadência.
- **Projeto-alvo explícito, fatia 2: o que faltou da resposta honesta** ([RM-052](docs/roadmap/RM-052-projeto-alvo-explicito.md)):
  a sessão despachada por um host (fase, retry e `ork audit run`) deixa de herdar o modo host e o `ORK_PROJETO`
  do gateway (o despacho leva `ORK_PROJETO` vazio e `ORK_PROJETO_EXPLICITO=0`), e o `ork` dela, na worktree da
  thread, lê a própria thread em vez de recusar com `projeto.escolha`; o filho `fabrica publicar` herda o mesmo.
  `ork roadmap reservas` abre com o cabeçalho do projeto consultado e, sem remoto ou sem cópia, diz que nada foi
  lido, nunca "Nenhum item do roadmap reservado"; o JSON ganha `consulta` e `leitura`. Todo comando que lê um
  projeto que o leitor não tem como adivinhar (no host, ou fora do diretório dele) termina com a linha
  `Projeto consultado: ...` no stderr, com o remoto sem query, sem fragmento e sem a pasta da conta, e a skill
  do Hermes manda `--projeto` em todo `ork` de projeto do terminal.

- **O `ork portfolio show` deixa de aceitar em silêncio as sobras do `objective`** ([RM-043](docs/roadmap/RM-043-aposentadoria.md)):
  a ajuda ainda listava `--constraints`, `--outcomes`, `--threads`, `--execution-runtime` e `--validation-runtimes`
  sob `portfolio show`, herança do `objective` aposentado na I-43, e o comando as aceitava e ignorava. Elas saem da
  ajuda e recusam com `portfolio.opcao-aposentada` (saída 2), apontando `ork thread new --exige-runtime-diferente` e
  `--done`, como a recusa `objective.aposentado`.

- **Teste da coleta após falha de limpeza do candidato** ([RM-036](docs/roadmap/RM-036-maestro-multicanal.md)):
  os cenários de `EPERM`, com aquisição bem-sucedida ou erro original, agora exigem que um concorrente
  recolha o candidato após `ESRCH` simulado e deixe a fila vazia, com `flock` e transporte portátil.
  Receita de mutação suprime essa coleta sem alterar a recusa de limpeza inicial.
- **Diagnóstico da entrada fora de UTF-8 no MCP** ([RM-036](docs/roadmap/RM-036-maestro-multicanal.md)):
  a recusa em metadados Git e em leases/candidatos mostra o caminho relativo da entrada, preserva os
  bytes em escapes hexadecimais e orienta renomear pelo shell. A guarda continua antes do `lstat`;
  testes cobrem `refs/`, `logs/`, worktrees e nomes com controles ou barra invertida, com receitas de mutação.
- **Fixture de nome fora de UTF-8 sem pulo silencioso** ([RM-036](docs/roadmap/RM-036-maestro-multicanal.md)):
  `ENOENT` ao criar a entrada faz o teste falhar; só incompatibilidade do filesystem permite pular.
  Regressão com pasta-mãe ausente e receita de mutação que recoloca `ENOENT` na lista de pulo.
- **Watcher e recuperação da condução Codex** ([RM-036](docs/roadmap/RM-036-maestro-multicanal.md)):
  commits MCP auditados do despacho renovam o prazo de inatividade com controller e runtime vivos,
  mesmo quando o rollout não avança. A materialização temporária do estado durante commit exige nova
  auditoria. Contenção e estado dividido usam somente o orçamento de 600 segundos sem observação
  bem-sucedida; as demais falhas transitórias também têm teto de 12 tentativas. Contenção passageira
  não grava erro; esgotar o prazo gera diagnóstico próprio. Falha permanente inicial gera um único
  resumo com contagem 1. Os recibos MCP incluem sessão e despacho quando o servidor tem esse vínculo.
  `conducao assumir` exige todos os watchers, controlador e runtime ausentes por identidade comprovada,
  relendo os eventos terminais após conferir os processos, sob a trava.
  Nos dois incidentes históricos, conforme cruzamento do ledger pela condutora, os heartbeats param
  logo depois de `mcp_git_committed`, a 8 e a 11 minutos do despacho, sem `gate_blocked` aos 600 segundos.
  A causa provável é a exceção de estado dividido durante o commit MCP, antes lançada fora do `try`.
  Essa evidência não comprova a causa; os incidentes não são atribuídos ao prazo de 600 segundos.
- **A referência do CLI volta a cobrir a ajuda do `ork`** ([RM-044](docs/roadmap/RM-044-documentacao-como-codigo.md)):
  depois dos ~50 PRs de 03/10, `docs/referencia/cli.md` estava sem `brain`, `portfolio`, `creation`, `onboarding`,
  `experiencia`, `mcp`, `docs verificar`, os novos `sessions` e várias opções que o binário já aceitava; o exemplo do
  `ork memory status` no guia de memória não batia com a saída. Só documentação, mais um teste que confere as
  invocações da referência contra o despacho do `main` e a ajuda, com exceções explícitas.

## [0.5.3] - 2026-10-03

### Adicionado

- **O `ork ship registrar-pr` avisa a página que vai deixar a `main` vermelha** ([RM-044](docs/roadmap/RM-044-documentacao-como-codigo.md)):
  seis pushes da `main` reprovaram em `docs.paridade.merge` em 02 e 03/10, e o condutor só descobria no push. Depois
  de registrar, o `registrar-pr` lê as páginas do roadmap da base remota e lista a da thread que já entrou pelo merge
  `ship(<thread>)` com o `estado.codigo` fora de `Mesclado`, com o comando `ork docs sincronizar --escrever --so RM-NNN`.
  No `--json`, o campo aditivo `docsPendentes`. Só avisa: não grava, não muda o código de saída nem o veredito do
  `ork docs verificar`.
- **Medida da conta esgotada entre projetos** ([RM-040](docs/roadmap/RM-040-estado-de-conta-compartilhado.md)):
  `ork accounts esgotamentos [--desde 7d] [--json]` (`ork.esgotamentos/v1`) só lê as marcas vivas de
  `~/.orkastery/private/contas.json` e os `phase_dispatch` com perfil dos projetos de `ork projetos`, e conta o
  despacho que caiu na conta de uma marca de outro projeto, dentro do prazo dela. A conta sai como id opaco e o
  perfil, pelo id; nenhum diretório de conta vai à saída. O total é um piso: o registro só guarda as marcas vivas.
- **Contexto compacto da thread, KG5 fatia 3** ([RM-031](docs/roadmap/RM-031-grafo-de-codigo.md)):
  pacote `ork.thread-graph-context/v2` com referências locais, evidências em tupla e fan-in agregado;
  prioridade entre arquivos e perto do diff, limite por alvo e amostra de sementes ausentes.
  Sem worktree, o diff é ignorado e declarado. A flag `grafo.mcp` segue desligada.
  Sementes de prosa exigem extensão conhecida ou diretório do índice; evidências auxiliares
  de outro arquivo são omitidas e declaradas. Fixture sintética de 22.973 para 3.119 bytes.
  A [medida histórica](core/test/fixtures/kg5-medida-contexto.json) foi executada; o GO-FIX
  corrige a descoberta para exports de pelo menos quatro caracteres e `grep -w`, mede precisão
  e cobertura só dos editados existentes na base, e conta arquivos novos à parte. Medida v3 em dois
  casos reais ([tabela do contrato](docs/referencia/contratos/consumo-grafo-kg5.md#dica-e-medidas)): o pacote, que é só o mapa, tem 15.122 e 16.974 bytes,
  2,2 e 1,5 vez menos que a saída do grep (sem a leitura dos arquivos); precisão 3/7 (43%) e 7/8 (88%)
  contra 3/41 (7%) e 6/11 (55%); cobertura 3/13 e 7/17 contra 3/13 e 6/17. Pacote pequeno e preciso nos vínculos, cobertura parcial; sem economia de tokens demonstrada.
- **Contexto determinístico da thread, KG5 fatia 2** ([RM-031](docs/roadmap/RM-031-grafo-de-codigo.md)):
  `ork grafo contexto <thread>` e `ork_grafo_contexto` compõem o mesmo pacote de arquivos e símbolos
  a partir de diff, GOAL, PLAN e claims, com evidências, teto em bytes e omissões declaradas.
  Índice ausente ou de outra revisão recusa com `ork grafo indexar`. A medida offline compara bytes
  do pacote e dos mesmos arquivos indexados, sem estimar tokens. Com `grafo.mcp` ligada, o pedido da
  fase ganha uma dica curta; desligada, mantém o texto anterior. A flag continua desligada por padrão.
- **Orkastery Network, fatia 2** ([RM-053](docs/roadmap/RM-053-orkastery-network.md)):
  - o `ork doctor` ganha a linha `rede`: a adesão, a casa, a última batida e a última falha do `rede.log`, só de
    arquivos locais; vira aviso, com a correção, quando a falha é mais nova que a última batida ou quando a batida
    passou de 3 h, e nunca bloqueia o despacho;
  - o retrato sem batida há mais de 14 dias sai da tabela do `REDE.md` e vai ao rodapé; o arquivo dele e o
    `ork network status` ficam;
  - um saneador de saída comum ao núcleo (`core/src/saida-segura.ts`): o `ork fabrica`, a seção de outras máquinas
    do `ork board` e o `ork fabrica --json` deixam de levar à tela a quebra de linha e o controle de terminal do
    `por`, do `projeto` e da pergunta lidos de `ork/fabrica-estado`; o JSON tem o mesmo valor, com o invisível
    escrito como `\uXXXX`;
  - a faxina da trava órfã da rede é serial e não move mais a trava viva de outro processo (W9 do CHECK 5).
- **A rede por pessoa no roadmap da rede, fatia 3** ([RM-054](docs/roadmap/RM-054-roadmaps-e-threads-da-rede.md)):
  - `ork network roadmap` lê a casa da RM-053: a seção "Rede por pessoa" traz a casa e cada máquina com a batida e
    os projetos que declara, e o JSON ganha `rede`; o projeto que uma máquina da rede declara passa a ser pedido
    pelo nome mesmo sem clone nem registro, e a máquina da rede sem retrato na fábrica do projeto sai com as
    threads não lidas e a lacuna `maquina.sem-fabrica`; `ORK_REDE_LER=0` desliga a leitura;
  - `ork_network_status` no OpenClaw (perfis `coding` e `messaging`, sem `projeto`), no Hermes e no MCP (só o projeto
    servido em cada máquina); no host, `ork network status` não lê o projeto do diretório do gateway;
  - o `gh` e o `glab` da forja são achados também em `~/.local/bin` e nas outras pastas de usuário, fora do PATH
    curto do gateway e do cron.
- **Orkastery Network** ([RM-053](docs/roadmap/RM-053-orkastery-network.md)): as máquinas de uma pessoa em
  rede, num repositório privado dela na forja (`<usuario>/orkastery-network`):
  - `ork network entrar`, `status`, `publicar` e `sair`, de qualquer diretório; GitHub pelo `gh` e GitLab
    pelo `glab`, com a identidade da CLI já autenticada;
  - o retrato leva nome, hostname, forja e login, runtimes e hosts com versão, projetos conhecidos, versão do
    `ork` e a batida; nunca token, conta paga ou caminho de credencial: a varredura de segredo recusa o
    retrato, e o projeto suspeito fica fora sozinho, com aviso;
  - cada instalação tem uma identidade aleatória no retrato: duas máquinas com o mesmo nome não se
    sobrescrevem;
  - a casa só fala por HTTPS, e nada que o terminal execute (ESC, bidi) chega à saída do
    `ork network status` nem ao `REDE.md`;
  - quem já fez `ork fabrica entrar` entra sem refazer, e `ork/fabrica-estado` continua lida;
  - `ork network status --json` (`ork.rede-status/v1`) declara a fonte, as lacunas e o que não foi consultado.
- **Prova de ativação do Maestro no Codex** ([RM-032](docs/roadmap/RM-032-bootstrap-maestro.md)):
  `node core/scripts/prova-ativacao.cjs codex` prova o terceiro host. A sessão é nova, não interativa e efêmera
  (`codex exec --json --ephemeral --ignore-user-config`), usa o login nativo do `CODEX_HOME` de quem roda e recebe por
  `-c` o servidor MCP que o `ork mcp install --host codex` gravou no projeto, só com `ork_maestro` aprovada. A
  conferência lê os eventos do `codex exec --json` e exige `mcp__orkastery__ork_maestro`: `ork maestro` pelo shell,
  inclusive embrulhado em `bash -lc '...'`, é desvio. Ela confere também que nenhuma sessão da prova ficou em
  `$CODEX_HOME/sessions`. A skill `ork` do Codex passa a pedir `ork_maestro` antes de qualquer `ork` no shell: na
  primeira rodada real, o modelo rodou `ork maestro --json` no shell antes da tool, e a prova reprovou.
- **`ork brain context` pelo modo `context` do OrkMind** ([RM-025](docs/roadmap/RM-025-company-brain-fundacao.md)):
  o núcleo pede primeiro o pacote `orkmind.company-brain-context/v1` ao servidor, confere schema, tenant, pedido,
  digest, citação inteira, ordem, fecho de pais e o destino de cada id, e o traduz para `ork.brain-context/v1` com o
  frescor contra o portfólio. Com um OrkMind anterior ao modo (`brain.selection.context-unsupported`), monta o pacote
  por `query` e `get`, como antes; os dois caminhos dão o mesmo digest, e o campo `caminho` diz qual foi. Pacote do
  servidor que não confere encerra com `conflict` e `brain.context.server-invalid`. Vale também para a ferramenta
  `ork_brain_context` e para o contexto do dossiê.
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
- **Aceite por omissão só da thread indicada** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md)): em 03/10,
  três vezes, um condutor rodou `ork master --aceitar-omissao` para fechar a própria thread e fechou também as
  entregues de outras frentes paralelas, porque a CLI não deixava indicar a thread.
  - `ork master <thread> --aceitar-omissao` (também `--thread <thread>` e `--aceitar-omissao=<thread>`) aceita só a
    entrega daquela thread; thread sem entrega recusa (saída 1) e a já fechada não grava de novo (saída 0);
  - `--dry-run` lista o que seria fechado, com o índice, sem gravar (`--json`: `{ dryRun, fecharia }`);
  - sem a thread, o padrão continua o mesmo (aceita todas as entregues e lista cada uma). De processo de agente
    (a mesma marca do `master.prova-de-canal`) com mais de uma, sai em stderr o aviso `master.omissao-sem-thread`,
    com o comando da thread do despacho; o stdout e o `--json` ficam como eram;
  - o `ork ship registrar-pr`, a tabela do `ork master`, o bloco do `AGENTS.md` que o `ork init` escreve, as skills,
    os adaptadores e os guias passam a ensinar a forma com a thread.
- **`ork doctor` acusa o pulse que bate devagar** ([RM-039](docs/roadmap/RM-039-cadencia-do-pulse-por-tag.md)): com
  `.orkastery/monitor/pulse-host.json`, o check `cadencia do pulse no cron` lê o `crontab -l` e avisa, sem bloquear, a
  linha da varredura ausente, o crontab inexistente ou a batida mais lenta que 15 minutos (como a antiga `0 * * * *`),
  com a linha do template `monitor/pulse.cron` pronta para colar. O doctor nunca edita o crontab.

### Alterado

- **Ramos do `ork doctor` sob teste, C5** ([RM-039](docs/roadmap/RM-039-cadencia-do-pulse-por-tag.md)):
  cobertura do cron, do manifesto fora do repositório e do login do Claude com diferentes perfis de conta.
- **Fechamento com falha parcial sob teste, C4** ([RM-056](docs/roadmap/RM-056-perfil-por-thread-e-carga.md)):
  falhas isoladas em leases, sessões e reserva comprovam que as demais liberações continuam e a pendência fica registrada.
- **Piloto de contas compartilhadas** ([RM-040](docs/roadmap/RM-040-estado-de-conta-compartilhado.md)):
  prova real só de leitura registra ausência de marcas; esgotamento entre dois projetos reais segue sem caso observado.
- **Fatos da rede após os merges** ([RM-053](docs/roadmap/RM-053-orkastery-network.md), [RM-054](docs/roadmap/RM-054-roadmaps-e-threads-da-rede.md)):
  roadmaps registram os PRs #31 e #72 e distinguem código mesclado de implantação pendente.
- **Company Brain, B4.2 após o merge** ([RM-025](docs/roadmap/RM-025-company-brain-fundacao.md)):
  roadmap registra o modo `context` no núcleo pelo PR #64 e as capacidades já presentes no OrkMind.
- **Fatos do roadmap e ordem do CHANGELOG, B3:** documentação consolidada após as entregas, com as notas em ordem.

### Corrigido

- **A skill do Codex e a do Hermes consultam o `ork` no shell só depois da `ork_maestro`** ([RM-032](docs/roadmap/RM-032-bootstrap-maestro.md)):
  na segunda rodada da prova do Codex, o `ork doctor`, o `ork onboarding` e o `ork experiencia show` rodaram no
  shell antes da tool, e a skill mandava consultar a experiência sem ordem. O CLI resolve o projeto pelo diretório
  da sessão, a classe de erro que a frase `orkastery maestro` evita. Um teste de guarda confere a ordem nas skills
  de entrada e na cópia do marketplace.
- **Recibos do ensaio com o estado real dos achados** ([RM-049](docs/roadmap/RM-049-lancamento.md)):
  itens corrigidos citam PR e commit; R3 segue registrado, e um teste confere essa distinção em todos os recibos.
- **O MASTER sem `--classe` junta `base-avancou` quando a branch trouxe a base** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md)):
  a classe fixa nunca era inferida. Em 03/10, 29 das 35 entregas trouxeram a `origin/main` para a branch antes do
  merge, e todas fecharam sem ela. Agora conta o `worktree_synced` do ledger e, no merge da entrega, os merges da
  branch cujo pai trazido já estava na base. Git sem resposta conta 0, e `--classe` continua vencendo.
- **O POSTMORTEM conta o CHECK e o SHIP que o ledger registrou** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md)):
  o `verify_run` e o `ship_done` são gravados sem o campo `fase`, e as `fasesPercorridas` só contavam evento com
  fase. Dos 35 POSTMORTEMs de 03/10, só 1 listava o CHECK e 2 o SHIP. Agora `verify_run` e `check_reverify` contam
  como CHECK, e `ship_started`, `ship_done` e `ship_blocked` como SHIP, quando o evento não traz fase; o campo
  explícito continua vencendo. A forma do POSTMORTEM não muda, e os já gravados ficam como estão.
- **Id da instalação numa pasta dividida** ([RM-053](docs/roadmap/RM-053-orkastery-network.md), X6 do CHECK 6):
  sem hard link (vboxsf, SMB, alguns FUSE), e na troca de um `~/.orkastery/maquina-id` ruim, cada host ou contêiner
  que divide a pasta gravava um id derivado do próprio hostname e boot, e o último a gravar vencia. Por isso, quem
  já tinha publicado passava a ler outro id. Agora o id sai de uma reserva que entra por `rename` de pasta com
  conteúdo (`maquina-id.reserva/` ou `maquina-id.troca-<chave>/`): só a primeira entra, e todos leem o mesmo id.
  O `maquina-id` continua um arquivo com o UUID, e o id derivado fica para quando a reserva falha.
- **Testes instáveis do CI de 03/10** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)): o caso "tomar a reserva de
  outra maquina fica registrado com de quem e por que" (`roadmap-reservas`, Node 20, run 37106955227) caía com
  `ENOTEMPTY` na limpeza do remoto bare. Depois de push e fetch, o git solta `git maintenance run --auto --detach`,
  e o processo destacado escrevia em `objects/` enquanto o `rmSync` apagava o diretório; o `git clone` local da
  outra máquina também podia copiar um repack pela metade. Os testes que usam `core/test/apoio.ts` agora desligam a
  manutenção automática do git: por `GIT_CONFIG_COUNT` do lado de quem roda o comando e por `GIT_CONFIG_SYSTEM`
  (que inclui a configuração de sistema de verdade) no `receive-pack` do remoto bare, porque o transporte local
  limpa a primeira. Nenhum repositório ganha chave nova. Sem retry e sem prazo maior; a prova
  `bash core/scripts/prova-laco-sob-carga.sh` roda o teste N vezes sob carga de CPU, com a manutenção do git fazendo
  trabalho a cada push: antes, 13 de 1000 rodadas caíam; depois, nenhuma.
- **Marcas visíveis da categoria `Cf` na rede** ([RM-053](docs/roadmap/RM-053-orkastery-network.md), Y4 do CHECK 7):
  o saneador comum (`core/src/saida-segura.ts`) tratava toda a categoria `Cf` como invisível, e o projeto com um
  sinal numérico árabe (U+0600 a U+0605, U+06DD), U+070F, U+0890, U+0891, U+08E2, U+110BD ou U+110CD no nome ou
  no caminho saía do retrato com aviso, e a marca sumia da saída. Essas 13 marcas, que têm glifo, passam como
  texto; bidi, largura zero, tags e o resto de `Cf` continuam barrados.
- **Avisos finais dos leases multicanais** ([RM-036](docs/roadmap/RM-036-maestro-multicanal.md)):
  o teste de fila simbólica usa um alvo fora de `.orkastery/leases`, isolando a recusa do link;
  a varredura de metadados usada pelo commit e pelo SHIP do MCP ignora `ENOENT` quando a fila de
  retomada ou um candidato desaparece durante `lstat` ou `readdir`, preservando os demais erros.
  Nomes fora de UTF-8 são recusados antes de `lstat`, tanto nos metadados quanto no preflight de
  documentos e claims, inclusive nas filas; perda de bytes na decodificação não conta como desaparecimento.
  Falhas de `unlink` do candidato ou de `rmdir` da fila vazia não alteram o resultado da aquisição
  nem encobrem a exceção original; candidatos remanescentes são recolhidos por concorrentes quando
  o PID morre ou o prazo vence. Os ajustes têm cenários de regressão e receitas em
  `core/scripts/rm036-leases-mutantes.cjs`.
- **Instalação e suíte sem os avisos do próprio repositório:** o `markdownlint-cli2` de desenvolvimento desce
  para `^0.22.1` (com o `markdownlint` 0.40.0), a última que aceita o Node 20 que o `core/package.json` declara.
  Assim, o `npm ci` do núcleo no Node 20 deixa de imprimir `npm warn EBADENGINE`, e o lint dá o mesmo resultado
  em `docs/` e nos READMEs. Os três testes que usam `mock.timers` deixam de imprimir o `ExperimentalWarning` do
  MockTimers no Node 20 e 22, e qualquer outro aviso continua saindo.
- **Suspeitas da revisão de 03/10** (thread `ork-suspeitasdar`):
  - a marca da rede (`~/.orkastery/rede/publicada.json`) é trocada inteira, por `rename`; antes, um
    `ork network status`, o `ork doctor` ou uma publicação concorrente liam o arquivo vazio ou cortado, e um
    processo morto no meio da escrita deixava a marca ilegível, o que fazia a próxima publicação perder a reserva
    dos projetos (D7) e o doctor dizer "nenhuma batida publicada".
  - `ork network sair` durante uma publicação em curso não deixa mais a marca da rede regravada depois da saída: a
    marca sai de novo sob a trava, quando a publicação já terminou; antes, ela sobrevivia ao `sair` e o próximo
    `ork network entrar` na mesma casa voltava a reservar os projetos que a saída tinha esquecido.
  - a prova de ativação (`core/scripts/prova-ativacao.cjs`) reconhece como desvio toda forma de rodar o
    `ork maestro` pelo shell do host: pelo caminho do binário (`$(which ork) maestro`), pelo node
    (`node core/dist/index.js maestro`), pelo npx (`npx @orkastery/cli maestro`) e com o projeto entre aspas
    (`ork --projeto "/srv/meu projeto" maestro`); antes só a forma `ork [--projeto X] maestro` reprovava, e as outras,
    ao lado da chamada contratada, deixavam a prova verde. `maestro` no argumento de outro subcomando continua não
    sendo desvio.
  - a leitura de uma branch de estado (a casa da rede, `ork/fabrica-estado`, as reservas do roadmap) busca de novo
    quando outro processo atualizou a mesma ref no mesmo instante; antes, o `ork network status` rodando junto da
    publicação, com a casa avançada, fazia uma das duas sair com `rede.sem-leitura` ("incorrect old value
    provided"), sem falha de rede nenhuma.
  - `ork network status` e `ork network entrar` não confundem mais a falha da forja com falta de login: prazo, erro do
    servidor ou falta de rede no `gh api user` (ou `glab api user`) saem como `rede.sem-leitura`, com o erro da forja
    redigido; antes viravam `forja.sem-login` e mandavam a pessoa rodar `gh auth login`. A falta de login de verdade
    continua `forja.sem-login`.
  - `ork_network_status` no servidor MCP fixado num projeto lê a fábrica só desse projeto; antes lia a de todos os
    projetos do registro e só filtrava a saída: a batida e a versão do ork de uma máquina vista nos dois vinham do
    projeto que o servidor não serve (D5 da RM-052), e o servidor rodava `git fetch` no clone do outro projeto.
  - `ork network roadmap` não marca mais como "(esta máquina)" o retrato de outra instalação com o nome desta
    (`maquina.nome-em-uso`), como o `ork network status` já fazia desde a revisão de 03/10.
  - a validação do remoto da RM-047 aceita o nome com `/` que o git aceita (`fabrica.remoto: time/origem`), como a
    0.5.2; a primeira versão dela o recusava com `fabrica.remoto-invalido`. Cada parte começa por letra ou dígito, então
    caminho absoluto, `..`, opção e transporte continuam recusados.
  - com `claim_sem_prova_local` declarada, o `ork_claim_add` do MCP não roda mais o comando da claim: antes, o texto
    vindo do pedido MCP rodava no processo do servidor, fora do sandbox do `ork_verify` e por até `verify.timeout_ms`
    dentro do pedido, embora a tool diga "Nao executa comandos". Pela CLI, com a worktree da thread apagada, o aviso
    diz que a worktree não existe, em vez de dizer que a claim "reprova no verify".
  - o pacote de contexto do Company Brain (`ork brain context`) exige `source.authority` na citação também pelo caminho
    da consulta (OrkMind sem o modo `context`), como o servidor; antes, um Brain fora do próprio contrato dava pacote e
    digest diferentes conforme o caminho. Com pais divergentes entre a fonte e o Brain, os dois caminhos já davam o
    mesmo pacote, agora com teste.
- **A vez de publicar na rede tem um vencedor só também sob carga** ([RM-053](docs/roadmap/RM-053-orkastery-network.md)):
  `tomarVezDePublicar` lia a hora antes de pegar a trava; o processo que perdia a CPU nesse intervalo achava a marca
  do vencedor "no futuro", a tomava por relógio que voltou e tomava a vez também (o teste da revisão de 03/10 reprovou
  assim no CI, `FFFTFFFFFTFF`). Agora a hora é lida dentro da trava.
- **Fechar a thread solta as sessões fantasma dela** ([RM-056](docs/roadmap/RM-056-perfil-por-thread-e-carga.md)): o
  MASTER e o `ork thread close` soltavam leases, fila e reserva, mas a sessão `blocked` sem processo presa à thread
  fechada seguia no `ork sessions list` até alguém rodar `ork sessions limpar-fantasmas`. Agora, quando o ledger da
  thread tem sessão sem fim, o fechamento grava `sessao_morta` (origem `fechamento`) só nos fantasmas dela; sessão
  viva e fantasma de outra thread ficam, e o runtime nunca é parado.
- **O MASTER sem `--classe` infere a classe de falha pelo motivo do gate** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md)):
  antes, toda thread com gate reprovado fechava com a classe `outra`, que o `ork licoes` ignora; 8 POSTMORTEMs de
  03/10 fecharam assim pelo aceite por omissão. Agora os motivos de verificação e evidência (`claims.failed`,
  `verify.failed`, `ci.failed` e os outros da tabela `CLASSE_DO_MOTIVO`) gravam `processo`, os de limite de uso
  gravam `rate-limit` e os de região e condução gravam `conflito`; o resto segue `outra`. O aviso cita os motivos, e
  `--classe` continua vencendo.
- **Revisão das entregas da madrugada de 03/10** (thread `ork-revisaodasen`):
  - `ork network status` não repete mais o `fabrica.remoto` cru: o valor do manifesto versionado vai ao git só como
    nome de remoto, depois do `--`, como no resto da RM-047, e o recusado sai redigido na lacuna
    `fabrica.sem-leitura`; antes, uma URL com credencial no lugar do nome aparecia inteira no texto e no JSON. O
    projeto do diretório no retrato da rede também deixa de passar o valor cru ao `git remote get-url`.
  - o teto de uma tentativa de publicar na rede a cada 14 minutos vale também para processos simultâneos: a marca
    da tentativa é lida e gravada sob uma trava e trocada por `rename`; antes, vários pulses na mesma batida
    tomavam a vez juntos.
  - `ork network status` sem o `maquina-id` local (antes da primeira publicação, ou com `~/.orkastery` apagada) diz
    `maquina.nome-em-uso` quando o retrato com o nome desta máquina é de outra instalação, como a publicação já
    recusava; antes o mostrava como "(esta máquina)", publicado e sem lacuna.
  - `ork_network_status` no MCP (só o projeto servido) tira também a lacuna da máquina que saiu dos membros por ser
    vista só na fábrica de outro projeto; antes, a `maquina.sem-batida` dela continuava com o nome (D5).
  - `ork memory search --texto` mostra o `detalhe` também na busca que deu certo: a quantidade de ids do FTS fora
    do universo e o aviso de cobertura do índice (RM-038) só apareciam no `--json`.
- **Defeitos do ensaio isolado da reinstalação do OpenClaw** ([RM-057](docs/roadmap/RM-057-hitl-por-alternativas.md)):
  - a regra do HITL de condução vai também nas descrições de `ork_network_roadmap` e `ork_network_status`, as únicas
    tools que o perfil `coding` do OpenClaw expõe; antes o modelo desse perfil nunca lia a regra. O perfil não foi
    ampliado: `tools.alsoAllow` segue como decisão do dono;
  - `ork adapter install` aponta a extensão para o `ork` que roda o install (o caminho real do CLI), e não para o
    primeiro `ork` do PATH; com outro `ork` no PATH, a saída avisa com as duas versões. `--ork <caminho>` continua
    vencendo.
- **Achados do ensaio de 03/10, com a recomendada de cada um** ([RM-049](docs/roadmap/RM-049-lancamento.md)):
  - `ork doctor` avisa (`warn`) quando o `claude` do PATH está sem login e não há perfil de conta do
    `claude-bg`: confere pelo mesmo `claude auth status` do check de contas; antes dizia `ok` e o primeiro
    despacho falhava;
  - sem idioma escolhido no ambiente (`LANG=C.UTF-8`, `C`, `POSIX`), o `ork onboarding` recomenda a
    experiência em `pt-BR`, a língua da CLI, em vez de `en-US`; um locale escolhido continua valendo;
  - `ork ci status` com `--sha HEAD` ou sha curto diz que pede o sha completo de 40 caracteres
    (`git rev-parse HEAD`); antes respondia só a linha de uso;
  - `ork ship --dry-run` sem o remoto configurado (ou com `--sem-push`) diz o mesmo que o ship real, "merge
    local concluído, sem push a provar", em vez de listar o `git push` e o `git ls-remote`;
  - `ork adapter install claude-code` (e `codex`) repete no fim, depois da lista de arquivos e dos pitfalls, as
    linhas de ativação e o `ork mcp install`: o fim da saída diz o próximo passo;
  - `ork verify --baseline` com comando que já falhava diz onde ver a saída: as últimas linhas no
    `thread.json` da thread (`baseline.comandos`, `resumo` e `trecho`) e o evento em `ork phase list`;
  - o README traz os números do CI da `main` de 03/10 (run 37102089623): 2.733 testes do núcleo, 24 canários e
    20 skills com 199 asserções; dizia 1.553 testes, de 27/09;
- **Primeira experiência sobre a main de 03/10, achados do ensaio** ([RM-049](docs/roadmap/RM-049-lancamento.md)):
  - `ork init` fora de um repositório git recusa com `init.fora-do-repositorio` sem criar nada; antes, rodado
    por engano no HOME, gravava manifesto, `AGENTS.md` e `.orkastery/` ali, e um repositório criado depois
    dentro dessa pasta herdava o manifesto de fora. O `ork doctor` avisa o `orkastery.yaml` lido de fora do
    repositório (`manifesto do repositorio`), e fora de repositório a correção do manifesto manda entrar nele;
  - `ork board` mostra, na thread parada por impedimento do dono (`runtime.workspace-untrusted`,
    `runtime.consent-pending`), a correção gravada no gate, com o `ork retry run` que o pulse recomenda, em
    vez de um `ork gate request` que o `#Fast` e o `#Auto` recusam;
  - o `ship_blocked` e o `gate_blocked` de um `ork ship --dry-run` não descontam o índice do `ork master`
    nem entram nas reprovações do POSTMORTEM;
  - a linha do cron que o `ork doctor` sugere para o pulse aponta o `monitor/varredura-pulse.sh` do `ork`
    instalado, com `ORK_PULSE_PROJECT`, quando o projeto não tem o script; antes apontava um caminho que só
    existe no checkout do Orkastery;
  - `ork phase list` mostra o id curto do pedido da decisão autônoma, e não `[object Object]`; a linha `ci`
    do resumo do `ork ship` fica alinhada com as outras;
  - `ork master` com score: a ajuda e o erro dizem que o `--por` é obrigatório; o quickstart, a referência
    da CLI e a definição de pronto o trazem, e o quickstart manda fazer o commit do manifesto de novo depois
    da etapa `maestro` do onboarding, que grava `owner` nele;
  - o `npm --prefix core test` volta a 0 falhas sem o interpretador do OrkMind: os testes da ponte da
    RM-038 saem como skip tipado, e um teste-guarda reprova arquivo que suba a fixture sem ele.
- **Teste instável do lease da sucessora no Node 22** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  o caso B-1 de `rm037-baseline-no-despacho` lia `conducaoDaThread` logo depois de despachar uma sessão codex que
  termina sozinha. O watcher destacado grava o `phase_result` na volta seguinte do laço de 1 s, e dali em diante a
  leitura derivada é `null` por desenho; num runner carregado o teste chegava depois do watcher e reprovava (run
  37096532937, que passou no rerun). Agora ele espera o fim da sessão e lê a identidade no lease, sempre na mesma ordem.
  Com 3 s de atraso injetado depois do despacho, o teste antigo reprova com a mesma mensagem do CI e o novo passa; sob
  carga, o arquivo passou 60 vezes seguidas no Node 22 e no 24. A varredura de `FINALIZAR-SIMULADO` e `conducaoDaThread`
  em `core/test` não achou outro teste que leia estado vivo de sessão que termina sozinha.
- **Memória inativa na busca por significado, rodada 3** ([RM-038](docs/roadmap/RM-038-busca-semantica-na-memoria.md)):
  `memory search --texto` mantém saída 1 também em `modo.files`, `dsn.env-ausente` e
  `orkmind.indisponivel`, com motivo tipado em texto e JSON, como `memory index`;
  universo vazio lido com sucesso sai 0. A prova `core/scripts/prova-busca-semantica.sh`
  imprime a resposta com o motivo antes de sair se qualquer busca falhar.
- **Avisos da rodada 2 do universo da busca** ([RM-038](docs/roadmap/RM-038-busca-semantica-na-memoria.md)):
  - `ork memory search --texto` sai 1 com motivo tipado quando o universo não foi lido, em texto e JSON;
  - o cliente preserva `injection_risk` e `expires_at` e reconfere a governança antes de qualquer embed;
  - a operação `universo` tem prazo próprio, `memory.universo_timeout_ms`, com padrão de 90.000 ms, e informa a
    latência medida no JSON do índice e do status;
  - o teste de expiração da ponte atravessa a leitura com relógio crescente, cobrindo FTS e universo.
- **O universo do índice é o mesmo da busca** ([RM-038](docs/roadmap/RM-038-busca-semantica-na-memoria.md), fatia de correção):
  - índice, vetor, FTS e `ork memory status` usam o mesmo universo da busca, lido de uma vez pela operação `universo`
    da ponte, com o tenant como filtro na origem: as entradas ativas do tenant nas coleções do `ork`, sem as que a
    biblioteca marca com `injection_risk`;
  - o FTS da ponte deixa de devolver entrada com `injection_risk` (antes ela chegava ao `ork` e era descartada em
    silêncio); a quantidade de ids do FTS fora do universo aparece no `detalhe` da busca e em `ftsForaDoUniverso`;
  - `universo` e `export` leem até o fim: quando a janela enche, a ponte conta e lê de novo uma vez, e cheia de novo sai
    com `memory.query.window-saturated` (como o `fts` já fazia) em vez de cortar;
  - entrada de outro tenant ou de outra coleção no universo, no `ork memory index` ou na busca vira
    `memory.query.scope-violation` antes de qualquer embed, em vez de ser filtrada em silêncio;
  - `ork memory status` e `ork memory index` mostram o universo da busca por coleção e o que fica fora da busca (com
    `injection_risk`, expiradas e em outras coleções, só em número), e o status avisa quando o índice cobre menos do
    que a busca enxerga, só mandando reindexar quando isso resolve; sem o universo lido inteiro, o status diz o motivo
    e não calcula cobertura.
- **O grafo de código funciona em quem instala o `ork` pelo npm** ([RM-031](docs/roadmap/RM-031-grafo-de-codigo.md)):
  - o `typescript` 5.9.3 e o micromark 4.0.2, com a tabela GFM 2.1.1 e os dois decodificadores de referência de
    caractere que o extrator usa, passam a ser dependências de runtime do `@orkastery/cli`, com versão exata: no
    `npm install -g`, o `ork grafo indexar`, as consultas e as tools `ork_grafo_*` rodam sem passo manual, onde antes
    a recusa era `grafo.parser.indisponivel: typescript`. Os rótulos `ork.ts-ast` e `ork.md-structure` não mudam; a
    instalação fica com 125 pacotes e cerca de 26 MB a mais em disco, quase todo o compilador;
  - depois de atualizar, `ork grafo indexar` refaz o índice completo uma vez: o comentário atualizado dos
    analisadores entra no `dist` e muda a impressão do extrator, invalidando o índice anterior para o HEAD;
  - `ork doctor` ganha o check "analisadores do grafo", logo depois do `node`: `ok` com as versões, ou `warn` com a
    recusa e a correção (`npm install -g @orkastery/cli@<versão>`, quando o pacote falta ou o npm o deixou fora da
    instalação, como dentro de um projeto ou pelo `npx`; Node 20.19, 22.12 ou mais novo, quando o Node não carrega ESM
    por `require`). Quando falta um pacote dos analisadores, o `ork grafo status` diz a mesma correção, na linha
    `correcao` e no campo `correcao` do `--json`;
  - `core/scripts/provar-grafo-instalado.cjs` instala o tarball do `npm pack` com `npm install -g` num prefixo e num
    HOME temporários e indexa e consulta um repositório novo; roda no CI (job `nucleo`, em cada Node da matriz) e no
    `publicar.yml`, num job só de leitura, sem o `id-token`, de que a publicação depende.

- **Leases de todas as famílias no estado canônico** ([RM-036](docs/roadmap/RM-036-maestro-multicanal.md), [FEAT-007](docs/produto/FEAT-007-worktree-e-leases.md)):
  - `main-tree`, `worktree-write`, `path`, `board`, `service` e a fila por colisão moram no `.orkastery/leases` da raiz do
    projeto: um `ork` chamado da raiz e outro de uma worktree passam a se excluir, com `lease.busy` (antes cada checkout
    tinha a sua pasta, e duas threads pegavam o `main-tree` ao mesmo tempo);
  - o legado válido das worktrees só barra enquanto vivo na janela de 30 minutos iniciada na primeira consulta
    desta versão, mesmo sem legado, marcada em `.orkastery/leases/.legado`; encerrada, a janela não reabre com
    arquivos novos. Arquivos inválidos ou ilegíveis não bloqueiam; o diagnóstico do legado não sugere `release`. Os comandos sugeridos citam os argumentos com aspas simples
    e escape; links simbólicos são ignorados e o registro da worktree exige vínculo de volta;
  - o prazo legado tolera 1 segundo além dos 30 minutos. O legado nunca é apagado: o descarte grava uma marca
    `dev:ino:ctime` em `.orkastery/leases/.legado-ignorado-<dev>-<ino>-<ctime>` no estado canônico. `release` atua somente no
    canônico quando presente; sem ele, marca o legado. Nenhuma liberação é anunciada quando nada saiu.
    A marca usa `ctimeMs`, conferido novamente antes do descarte: reutilizar o inode não oculta um legado novo.
    O motivo exposto do legado é sempre `(legado)`. A retomada automática funciona em Linux e macOS, inclusive
    sem `/usr/bin/flock`, por candidatos exclusivos e tickets publicados com `rename` atômico. A fila portátil
    também serializa concorrentes com `flock`; sob exclusão, relê o conteúdo, confere dispositivo e inode e cria
    com `wx`. Ausência, bloqueio do spawn, timeout ou erro do `flock` usam o caminho portátil. A fila fica
    em `.orkastery/leases/<lease>.json.retomadas`; o MCP aceita somente diretório real desse formato, com
    candidatos regulares de um único vínculo, e a pasta vazia é removida. `ork lease list` mostra
    candidatos, PID, ticket, idade e temporários `.json.tmp`. A prova de morte por `process.kill(pid, 0)` só
    vale no mesmo namespace de PID; processos de namespaces diferentes não devem compartilhar esta fila. PID
    reutilizado ou sem permissão de consulta bloqueia até o limite de 30 minutos (`TTL_PADRAO_MS`).
    Candidatos e temporários expirados são recolhidos na próxima tentativa, que retorna
    `lease.resume-unavailable`; a correção é consultar `ork lease list` e repetir a aquisição, sem apagar o
    lease. Temporários de PID comprovadamente morto são recolhidos mesmo antes do prazo, inclusive JSON
    parcial deixado por SIGKILL. Um retomador que perdeu seu candidato não pode prosseguir. Dispositivo e
    inode são reconferidos imediatamente antes de `unlink`; as duas chamadas de sistema não constituem um
    CAS atômico contra escritores externos à exclusão.
    `nlink === 0` é `lease.busy`, com fila normal e
    preservação do vencedor. Hard link ou link simbólico recebem `lease.resume-unavailable`, com escalada humana
    e sem retry automático: avaliar a posse antes de `ork lease release <nome> --forcar`, seguido de nova aquisição.
    O `ship --dry-run` também considera o legado vivo;
  - a fila legada não é lida e a espera se refaz no próximo pedido; a dona da própria cópia legada não entra na fila
    atrás de si, e a fila canônica grava por temporário e `rename`;
  - o legado nunca prova posse canônica para ativação de escrita; arquivo canônico vazio ou ilegível com menos de
    cinco segundos é preservado para o escritor que o criou com `wx`, e o escalonador elimina nomes repetidos;
  - o lock de espera do `ork portfolio` também passa para a raiz: a worktree espera a vez em vez de recusar com
    `brain.journal.busy`.

### Segurança

- **`--remoto` de `ork ship --para` validado antes do git** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)):
  o valor passa pelo mesmo validador; fora do formato, `ork ship <thread> --para <branch>` recusa com
  `ship.remoto-invalido` antes de qualquer git, na CLI e na API. Antes, com o gate de CI desligado, o valor ia cru ao
  `git remote get-url`, ao `git ls-remote` e ao `git push`, e um remoto inválido virava "remoto não configurado": o ship
  entregava com merge local e sem push provado. O `ls-remote`, o `remote get-url` e o `push` recebem `--` antes do
  remoto, o merge usa o sha verificado de `--de` (nome de branch nunca vira opção do `git merge`) e a leitura dos PRs do
  pulse só leva nome de remoto ao git.
- **`--remoto` de `ork ship registrar-pr` e de `ork ci status` validado antes do git** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)):
  o valor passa pelo mesmo validador do remoto da fábrica; fora do formato, `ork ship registrar-pr` (com a thread ou
  `--todas`) recusa com `ship.remoto-invalido` e `ork ci status` com `ci.remoto-invalido`, sem nada passado ao git nem
  consulta ao GitHub; antes, o valor ia cru ao `git fetch`, ao `git ls-remote` e ao `git remote get-url`, que agora
  recebem `--` antes do remoto. `--remoto` sem valor também recusa, em vez de virar `origin` em silêncio.
- **Remoto da fábrica validado antes do git** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)):
  - o `fabrica.remoto` do `orkastery.yaml` e o `--remoto` da linha de comando só chegam ao git como nome de remoto
    (letras, dígitos, `.`, `_`, `-` e `/` entre partes, cada parte começando por letra ou dígito, sem URL nem
    transporte, sem caractere de controle); antes, um
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
