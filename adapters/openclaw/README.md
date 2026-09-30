# Adaptador OpenClaw

O OpenClaw recebe o Orkastery como uma **extensao** no formato 2026.7.1: um pacote com
`package.json` (`openclaw.extensions: ["./dist/index.js"]`), um entry JS que registra as
**26 tools `ork_*`** via `defineToolPlugin` do SDK do proprio OpenClaw, e o manifesto
`openclaw.plugin.json` gerado (`id`, `activation`, `contracts.tools`). Cada tool e uma
chamada de CLI do `ork`, sem regra de negocio no host.

## Estrutura do pacote

| Arquivo | Papel |
|---|---|
| `package.json` | `openclaw.extensions` aponta o entry; sem dependencia de runtime |
| `dist/index.js` | Entry construido; unico arquivo com o placeholder `{{ork_bin}}` |
| `openclaw.plugin.json` | Manifesto GERADO por `openclaw plugins build` (nao editar na mao) |
| `src/index.ts` | Fonte TS; `construir.sh` compila com o tsc do core |
| `bin/ork-abrir-thread.sh` | Atalho de abertura de thread sem reimplementar o parse da #TAG |

O entry importa `openclaw/plugin-sdk/tool-plugin`, que o loader do OpenClaw resolve por
alias: o pacote nao precisa de `node_modules` no destino. Os parametros das tools sao JSON
Schema literal (sem typebox). Se uma versao futura do `openclaw plugins validate` exigir
typebox, adicione-o em `dependencies` e rode `npm install` no destino.

## Instalacao

```bash
ork adapter install openclaw                     # instala em <projeto>/.openclaw/extensions/orkastery
ork adapter install openclaw --dir ~/.openclaw   # instala para a maquina, no source root global
ork adapter install openclaw --dry-run           # lista o que seria escrito
```

O instalador renderiza `{{ork_bin}}` no `dist/index.js` com o caminho absoluto do `ork`
desta maquina e grava `INSTALADO.json` com a origem e o sha256 de cada arquivo.

**Registro no OpenClaw.** Com `--dir ~/.openclaw`, o destino
`~/.openclaw/extensions/orkastery` ja e o source root `global` que o
`openclaw plugins list` varre: reinicie o gateway e confira. Alternativas equivalentes:

```bash
openclaw plugins install ~/.openclaw/extensions/orkastery   # registra explicitamente
# ou aponte plugins.load.paths para o diretorio instalado na config do OpenClaw
```

Se a copia nao passou pelo instalador (placeholder nao renderizado), o entry cai no
fallback: usa `ORK_BIN` do ambiente ou o `ork` do PATH.

## As tools

| Tool | O que faz |
|---|---|
| `ork_doctor` | O que vale nesta maquina agora; sai != 0 quando o despacho nao vale |
| `ork_modo_do_pedido` | Le a #TAG do pedido e devolve o modo (use SEMPRE, nao reconheca a tag no host) |
| `ork_thread_new` | Cria a thread, o slug de 3 partes e o ledger |
| `ork_thread_status` | Estado da thread cruzado com o runtime |
| `ork_phase_run` | Despacha uma fase, gravando o prompt exato com sha256 |
| `ork_phase_list` | O ledger, evento a evento |
| `ork_claims_add` | Registra alegacao verificavel com o comando que a comprova |
| `ork_verify` / `ork_verify_baseline` | Reexecuta no HEAD real; grava a baseline antes do GO |
| `ork_worktree_ensure` / `ork_worktree_audit` | Worktree isolada, conferida no proprio git |
| `ork_portfolio_list` | Lista produtos, projetos e iniciativas canônicos |
| `ork_gate_answer` | Resposta humana correlacionada a um gate |
| `ork_session_answer` | Resposta humana correlacionada a uma sessão |
| `ork_ship` | Merge serializado por lease e push provado contra o remoto |
| `ork_master` | POSTMORTEM tipado e o score HUMANO de 0 a 5 |
| `ork_board` | As threads DESTE projeto e o escalonador; nao le o roadmap (zero threads nao e roadmap vazio) |
| `ork_roadmap_status` | Status report do roadmap so desta maquina (`ork roadmap status`), transportado como vem |
| `ork_network_roadmap` | Roadmap da rede (`ork network roadmap`): o status report com as threads de todas as maquinas, reservas, fonte e hora de cada parte e lacunas; a fonte do status do roadmap |
| `ork_master_batch` | Todas as entregas, com o indice do ledger (`ork master --todas`; a fila de score saiu na I-43) |

### O projeto de cada chamada (RM-052)

Toda tool aceita `projeto`, o **nome** de um projeto registrado nesta maquina (`ork projetos`),
nunca um caminho. Ele vai ao `ork` como `--projeto <nome>`. O adaptador declara
`ORK_PROJETO_EXPLICITO=1`: o diretorio do gateway nao escolhe projeto. Sem `projeto` e com mais de
um projeto conhecido, a resposta e a escolha tipada `projeto.escolha`, com os candidatos; com um
so, vale ele. Toda resposta de `ork_maestro`, `ork_board` e `ork_roadmap_status` comeca dizendo o
projeto consultado e o que nao foi lido.

### O roadmap da rede (RM-054, fatia 2)

`ork_network_roadmap` e a fonte de qualquer pergunta sobre o roadmap: uma chamada de
`ork network roadmap`, com o status report do RM-048 e as threads de todas as maquinas, as
reservas, a fonte e a hora de cada parte e as lacunas. A descricao manda transportar o texto como
vem e nunca concluir "roadmap vazio" nem "nenhuma maquina publicou" a partir de lacuna ou de "Nao
consultado". O `projeto` dela aceita o nome registrado ou a forja (`github:dono/repo`,
`gitlab:grupo/repo`), para a maquina sem clone; caminho e URL recusam no host e no nucleo, e o
nucleo so aceita a forja em `github.com`, `gitlab.com` ou no host de um projeto registrado. Sem
`projeto`, vem o panorama de todos os projetos do registro, e e o que a frase `orkastery maestro`
sem projeto oferece. O projeto do diretorio do gateway so entra se estiver no registro.

Ela e a unica tool do catalogo declarada nos perfis `coding` e `messaging` do OpenClaw
(`toolMetadata.ork_network_roadmap.profiles` no manifesto): com o perfil `coding`, o padrao do
onboarding, as tools de plugin so chegam ao modelo quando o manifesto as declara no perfil ou o
operador as libera. Sem isso o modelo nao ve tool `ork_*` nenhuma e vai ao `ork` pelo shell, como
no incidente de 29/09. As outras tools continuam sob escolha do operador:
`tools.alsoAllow: ["orkastery"]` no `openclaw.json` libera todas; allowlist e deny do operador
sempre valem.

## A #TAG de conducao

O manifesto novo do OpenClaw nao tem campo proprio para isso, entao a regra vive aqui e
nas descricoes das tools: `ork_modo_do_pedido` devolve JSON com o modo, a tag, se veio do
pedido ou do `conduction.default_mode`, e quantas pausas humanas aquele modo tem. O host
passa o resultado a `ork_thread_new` e **nao decide nada**: `conduction.allowed_modes` e
conferido dentro do `ork thread new`, que recusa com erro tipado quando o projeto nao
permite o modo.

## Os 3 pitfalls de instalacao

1. **Placeholder `{{ork_bin}}` que fica no arquivo.** O unico placeholder renderizavel
   vive no `dist/index.js`. Nao renderizado, o entry cai no fallback (`ORK_BIN` ou o `ork`
   do PATH); sem fallback possivel, toda tool viraria "comando nao encontrado", e a sessao
   so descobriria depois de ja ter aberto thread na cabeca do agente. Confira com
   `grep -c '{{' <destino>/extensions/orkastery/dist/index.js`, que precisa devolver `0`.

2. **Argumento com espaco quebrado em varios argumentos.** Cada tool monta o comando como
   **vetor de argv** e chama o `ork` sem shell, exatamente para que um pedido com espaco,
   aspas ou quebra de linha chegue inteiro em `--prompt`. Se voce adaptar uma tool,
   mantenha o vetor: uma string de shell aqui vira injecao de comando com o texto do
   builder dentro.

3. **Tool que reimplementa regra do nucleo.** A tentacao e criar uma tool "esperta" que
   decide o modo, monta o prompt ou escolhe a base. Toda tool deste plugin e uma chamada
   de CLI e nada mais; a decisao que parece faltar aqui ja existe do outro lado, com
   teste. Tool nova que precisa de logica e sinal de que a logica pertence ao `ork`.

## Como reconstruir

```bash
bash adapters/openclaw/construir.sh                          # tsc do core compila src/ para dist/
cd adapters/openclaw && openclaw plugins build --entry ./dist/index.js    # regenera o manifesto
cd adapters/openclaw && openclaw plugins validate --entry ./dist/index.js # Plugin orkastery is valid.
```

O `dist/` fica commitado: o instalador copia arquivos do repositorio, nao roda build.

## O que este adaptador nao faz

Nao escreve codigo de produto, nao decide gate e nao valida modo. Ele traduz intencao em
chamada de `ork`, apresenta o resultado ao humano e registra o que o humano decidiu.

## Contas por runtime (I-33)

Este host tem superfície CLI, e a paridade com os hosts MCP vem pelos mesmos comandos do
núcleo; a superfície MCP de `accounts` não existe neste ciclo (o `add` é interativo e local, e
a leitura de estado já sai de `ork_observe`).

```bash
ork accounts list [--json]                          # perfis por runtime, sem segredo
ork accounts add <id> --runtime claude-bg|codex --dir <diretorio>
ork accounts check [<id>]                           # confere o login pelo proprio CLI
ork accounts remove <id>                            # desativa; diretorio e login ficam
ork setup <modo> --bloco N --fallback codex:<modelo>
```

O login roda no terminal do operador, pelo próprio CLI do runtime com o env do perfil; o
adaptador nunca recebe, guarda ou repassa credencial, e a conversa nunca é canal de login.
Quando uma conta esgota a cota, o crédito ou o limite do plano, ou perde o login, o
`ork retry run` rotaciona e grava `runtime_profile_rotated`; o host só apresenta o evento e a
pendência humana quando houver. A troca para outro perfil do mesmo runtime por esgotamento vem
ligada por padrão desde a decisão do dono de 19/09/2026
(`runtime_profiles.rotate_same_runtime_on_quota: true`; `false` desliga), vale só para perfis
que o operador cadastrou e autenticou pelo CLI oficial, para contas que ele tem direito de usar
sob os termos do provedor, e nunca acontece no rate limit comum, que espera a janela na fila
(ver `SECURITY.md` e `docs/guias/verificacao.md` na raiz do repositório).

## Respostas HITL

`ork_gate_answer` e `ork_session_answer` recebem `thread`, `pedido` e `updateTelegram` original do gateway autenticado. Configure `ORK_HITL_TELEGRAM_USERS` e `ORK_HITL_TELEGRAM_CHATS` com os ids permitidos, separados por vírgula. A mensagem responde ao alerta com a linha `ork-hitl <thread> <pedido>`; callback contém `ork:<thread>:<pedido>:<opção>`. Bots, origem não autorizada e correlação incorreta são recusados antes do CLI.

O gateway autenticado é a fronteira de confiança: conteúdo de conversa ou JSON criado por agente não comprova resposta humana. `ork_gate_approve` foi retirado do catálogo; migre o host para os comandos de resposta. Expiração nunca aprova, e delegação não pode aprovar push nem score. O núcleo fornece a profundidade da apresentação.

Verificação: `sh adapters/openclaw/construir.sh && node --test adapters/openclaw/test/hitl-answer.test.mjs`.
# Entrada Maestro

O callback `inbound_claim` possui ingresso adicional `native` sem Telegram quando
o SDK comprova `commandAuthorized`, `senderIsOwner`, sessão e identidade do contexto.
Bindings/chave privados `ORK_HITL_NATIVE_BINDING_OPENCLAW`/`ORK_HITL_NATIVE_KEY_OPENCLAW`
pertencem ao processo do gateway e ao núcleo, nunca ao modelo. Ausência de campo,
conta/canal/sessão divergente ou recibo inválido mantém o pedido pendente. A resposta
usa `/ork gate|session <thread> <pedido> <resposta>` na mesma conversa. Replay não
reenvia confirmação. A homologação live exige instalação/ativação pós-SHIP.

`orkastery maestro` roteia para `ork_maestro`, consulta JSON do núcleo com argv sem
shell. O panorama não abre trabalho; fonte indisponível permanece explícita.
Sessão filha executa o bloco recebido. A apresentação HITL prioriza tópicos,
recomendação e opções rotuladas, sem UUID exposto. Telegram é opcional; ingresso
nativo adicional só fica disponível após prova do callback e configuração do host.
Instalação fixture/SDK simulado não comprova ativação em uma sessão real.

Na callback autenticada, `/ork offer <thread> <pedido>` consulta a pergunta e a
oferta nativa sem responder ao pedido. O gateway assina uma prova efêmera da
mensagem e chama `gate context --native-offer-stdin`; só uma prova válida para
aquele host, sessão e pedido anuncia disponibilidade na conversa. Configuração
isolada, prova vencida ou texto produzido pelo modelo não demonstram callback.

Antes de executar tools, o helper fixo `ork receipt-verifiers --json` autentica e
prepara provas públicas dos recibos legados no projeto de `ORK_HITL_ROOT`, definido
pelo gateway. Os bytes dos recibos e o ledger permanecem preservados. Só os
verificadores públicos seguem ao executor; variáveis `ORK_HITL_*` são removidas.
Autoridade presente com projeto, preparação ou verificadores indisponíveis recusa
a execução da tool (`hitl.receipt.verifiers-unavailable`).
