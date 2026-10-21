# Adaptador Claude Code

O Orkastery chega ao Claude Code como **plugin**: as 18 skills finas do catalogo, seis subagentes
de fase, os slash commands `/goal` ... `/master` e um guard `PreToolUse`.

## Instalacao

```bash
ork adapter install claude-code --dry-run
ork adapter install claude-code # prepara <projeto>/.claude/plugins/orkastery
claude plugin validate .claude/plugins/orkastery
claude plugin marketplace add "$PWD/.claude/plugins/orkastery" --scope project
claude plugin install orkastery@orkastery --scope project
claude plugin details orkastery
```

O instalador copia o catalogo unico de `skills/` e `references/`, renderiza o manifesto do plugin
com os caminhos declarados um a um, e grava `INSTALADO.json` com a origem e o sha256 de cada
arquivo. E esse arquivo que permite detectar depois que alguem editou a copia instalada em vez do
catalogo.

Copiar o adaptador não habilita o plugin no Claude. Os comandos nativos acima registram
o marketplace e habilitam o plugin no projeto atual. Confirme primeiro que o nome
`orkastery` não pertence a outro marketplace e preserve as configurações existentes.
O manifesto usa a descoberta padrão de `agents/` e `hooks/hooks.json`: declarar o
diretório como `agents` é inválido no Claude 2.1.263; declarar novamente o arquivo
padrão em `hooks` provoca erro de carregamento por duplicação.

O escopo precisa ser provado em cada worktree. Nos ensaios do Claude 2.1.263,
`--scope project` habilitou os diretórios configurados explicitamente, enquanto
`--scope local` na main também alcançou uma worktree não configurada. Não use esse
último mecanismo para excluir threads. O [plano de ativação](ACTIVATION.md) descreve
preservação, exclusões, prova de despacho e rollback antes de uso operacional.

Validação, instalação e startup nativos sem modelo:

```bash
npm --prefix core run build
npm --prefix core run build:test
node adapters/claude-code/test/native-plugin.cjs
```

O teste cria projeto e worktrees pela API do `ork`, isola cache/configuração com
`CLAUDE_CONFIG_DIR` e verifica o startup do CLI, além do inventário. Uma worktree
não habilitada e outro projeto devem carregar zero hooks. O teste explícito
`node adapters/claude-code/test/native-plugin.cjs --smoke` também abre duas sessões
reais e exige `PermissionRequest` no ledger canônico, sem aprovar Bash. Esse smoke
exige Linux, Python 3/pexpect e OAuth de assinatura em `ANTHROPIC_TOKEN` no arquivo
`~/.hermes/.env`; não usa chave API nem fallback. A configuração global
permanece fora da fixture. As sessões e os ledgers temporários são descartados;
guarde a saída JSON como recibo antes de declarar a prova concluída.

**Prova de ativação do Maestro (RM-032).** `node core/scripts/prova-ativacao.cjs claude-code`
instala o plugin e o `.mcp.json` desta cópia num projeto descartável e abre uma sessão nova
`claude -p "orkastery maestro"` com `--plugin-dir`, `--mcp-config --strict-mcp-config`,
`--setting-sources project` e `--no-session-persistence`. Usa o login nativo do CLI, sem copiar
credencial e sem gravar no registro global de plugins. Aprova só quando o modelo chama
`mcp__orkastery__ork_maestro` (o `ork maestro` pelo Bash é desvio) e o snapshot é do projeto
descartável; o recibo traz o sha256 dos arquivos globais antes e depois. Modelo padrão: `sonnet`
(`--modelo` troca). Detalhes no [contrato do snapshot](../../docs/referencia/contratos/maestro-i32.md).

## O que voce ganha

| Voce digita | Voce recebe |
|---|---|
| `/goal <pedido com #TAG>` | Abre a thread no modo da tag e conduz a fase GOAL |
| `/plan <thread>` | PLAN: tarefas com verify, `touch_paths`, decisoes travadas |
| `/go <thread>` | GO: worktree garantida, baseline gravada, commit por tarefa |
| `/check <thread>` | CHECK: verificacao contra a baseline, cinco eixos, um veredito |
| `/ship <thread>` | SHIP: merge serializado por lease e push provado |
| `/master <thread>` | MASTER: POSTMORTEM tipado e o score humano de 0 a 5 |
| `/ork` | Painel: doctor, board, escalonador, modos, fila de score |

Mais seis subagentes (`ork-goal`, `ork-plan`, `ork-go`, `ork-check`, `ork-ship`, `ork-master`) para
isolar o contexto de cada fase, o guard `PreToolUse` e o hook `UserPromptSubmit` da resposta curta do dono.

## O guard PreToolUse

Um hook, em `Bash`, chamando `hooks/ork-guard.js`. Ele bloqueia sete classes de comando:

| Bloqueio | Por que |
|---|---|
| `git add -A`, `git add --all`, `git add .` | Engolem arquivo de outra thread na mesma arvore |
| `git commit -a` | Comita o que esta rastreado, nao a tarefa |
| `git push --force` | Reescreve historico publico e apaga entrega alheia |
| `git push` | Push na mao nao e provado: a entrega passa por `ork ship` |
| `git reset --hard`, `git clean -fd`, `git checkout -- .` | Descarte em massa sem rastro |
| `rm -rf` com alvo amplo ou variavel | Apaga o que ninguem pediu |
| `ork noctum terminal` e o hook da resposta chamados pela ferramenta | A resposta do dono no terminal vem do hook da sessão dele; o agente que chama esse ingresso se passa pelo dono (RM-057) |

**O guard nao tem regra de negocio.** Ele nao le ledger, nao sabe quem autorizou o que e nao
conhece thread nenhuma: ele reconhece a forma do comando e manda o agente pelo caminho que o `ork`
verifica. Comando que comeca com `ork` passa direto, porque quem prova o push e serializa o merge e
o nucleo; a exceção é o ingresso da resposta do dono (`ork noctum terminal`), barrado antes dessa
passagem. E se o proprio guard quebrar, ele **libera**: um hook que derruba a sessao por bug proprio
e pior que nenhum hook. A barreira do ingresso da resposta é lombada, não prova: quem roda como o
mesmo usuário do sistema a contorna, e o limite está dito abaixo.

## A resposta curta do dono no terminal (RM-057)

**Desligada.** Desde o GO-FIX 2 da RM-057, o núcleo não grava nada pelo terminal. Numa sessão interativa do
Claude Code, quando o dono digita a resposta curta a uma pergunta que espera por ele (`sim`, `a` ou
`<código> a`), o hook `UserPromptSubmit` (`hooks/ork-resposta.js`) leva o evento ao núcleo pelo
`ork noctum terminal --hook-stdin`, e o núcleo só devolve a recusa `noctum.terminal.desligado`: com alguém
presente, o dono vê um aviso (`systemMessage`) para responder pelo Telegram, em reply à mensagem da
pergunta ou com o código e a letra, ou pela janela de confirmação do Claude Code (o diálogo nativo, um
clique). O prompt segue ao modelo, e nada é gravado nem encaminhado, nem a resposta a um gate. Conversa
comum nem chama o núcleo, e o prompt que a máquina escreveu (o campo `source` do evento diferente de
`user`) também não.

**Por que desligada:** o Claude Code instalado (2.1.306) ainda não manda o `source` do evento, e sem ele
nada do dono gravaria. E o agente da própria sessão do dono, pela ferramenta Bash, troca o shell pelo
núcleo com `exec`, tira a marca `AI_AGENT` e forja o evento com `source` igual a `user`: a cadeia de
processos e o guard são lombadas, não prova. Ligado, o ingresso não serviria ao dono e serviria a quem
forja o evento.

**O que falta para voltar**, numa fatia própria: o Claude Code mandar a origem humana do evento
(`source`); uma prova de que o evento veio do hook do harness, e não de um processo do mesmo usuário; e,
para a palavra solta, a pergunta mostrada exigida como a linha que o núcleo monta para ela, ou só o código
com a letra. O código do ingresso segue no núcleo atrás da chave `TERMINAL_LIGADO`, desligada; só os
testes a ligam, e o CLI e o hook nunca.

**Limite:** a fronteira é a conta do sistema. No diálogo nativo, qualquer cliente MCP do mesmo usuário que
declare o formulário passa, sem chave. Para separar o núcleo dos agentes, rode os agentes em outra conta
ou sandbox. O aviso só aparece depois de reinstalar o plugin (`ork adapter install claude-code`) e do
`ork` com o `noctum terminal`.

## Sensores de sessão

`PermissionRequest`, `Notification`, `Stop`, `SubagentStop` e `PostToolUse` chamam
`ork sessions event` com a sessão e o diretório fornecidos pelo Claude. A sessão deve
estar registrada em uma thread do projeto. `ORK_SENSOR_CLI` pode apontar para o executável
do ork instalado; o padrão é `ork` no PATH. Cada chamada tem timeout de três segundos.

O sensor deixa stdout vazio e sai com código zero, inclusive em falha. Ele observa o
bloqueio, sem decidir a permissão. `PermissionRequest` captura a solicitação imediata;
`Notification` com `permission_prompt` só ocorre após cerca de seis segundos, conforme a
[referência de hooks](https://code.claude.com/docs/en/hooks#permissionrequest).

O ledger recebe carimbos e identificadores, sem prompts, comandos ou transcrições.
`PostToolUse` registra progresso; para Bash, um recibo de commit só é emitido quando o
resultado contém o SHA do HEAD confirmado no Git. O comando recebido nunca é executado.
`Stop` e `SubagentStop` são observações distintas e não aprovam uma fase.

Teste de integração isolado: `npm --prefix core run build && npm --prefix core run build:test && node --test core/dist-test/test/claude-sensors.test.js`.

O canário `node core/dist/index.js eval --so-canarios --canario fx-sensores-runtime`
integra hook, CLI, supervisor e watcher em um repositório temporário. Seus eventos Codex
são sintéticos; a saída identifica esse limite e mede ingestão, morte e duplicatas.

Para homologação com as assinaturas autenticadas, execute explicitamente:

```bash
node core/scripts/smoke-sensores.cjs --runtime claude
node core/scripts/smoke-sensores.cjs --runtime codex
```

O harness exige usuário comum; Claude exige Python 3 com `pexpect`. Ele cria um projeto
temporário e aceita a confiança somente nesse projeto que acabou de criar. Claude roda
em PTY com permissão de Bash obrigatória: o teste observa o diálogo real, o instante do
hook e a ingestão no ledger, e encerra a sessão sem aprovar a ferramenta. A saída inclui
o código/sinal desse encerramento controlado, sem alegar resposta ou aprovação humana.
Codex executa um comando curto e o harness confere o arquivo produzido, tokens, rollout
e recibo supervisionado. A descoberta do rollout é refeita no término porque sua criação
pode ocorrer após `thread.started`. O sandbox vem de `runtime.sandbox` do manifesto
do diretório de execução, sem override do harness. A prova de escrita em `read-only`
falha, preservando o modo configurado.

Cada comando emite JSON e retorna código 1 quando falta a prova. Variáveis de credenciais
e redirecionamento de API paga são removidas; não há fallback. HOME, CODEX_HOME,
CLAUDE_CONFIG_DIR, XDG e temporários ficam dentro da tentativa, junto dos ledgers.
O recibo lista os arquivos nativos e confirma a limpeza apenas desses recursos.
Claude usa OAuth de assinatura somente no ambiente. Codex lê seu cache nativo por
`memfd` Linux selado, sem cópia persistente de credenciais ou escrita na origem.
Refresh que precise escrever no cache torna a prova indisponível. Veja os limites
e o tratamento do rollout legado de T9 no [plano de ativação](ACTIVATION.md).
Guarde o JSON no diretório de evidências da thread
condutora. O teste de contrato do harness não dispara runtimes nem substitui esses smokes.
O prompt de permissão de rede do sandbox tem um fluxo distinto, descrito na
[referência de PermissionRequest](https://code.claude.com/docs/en/hooks#permissionrequest).

Sem `tool_use_id`, cada invocação do hook recebe uma identidade de ocorrência. O tamanho
do transcript não identifica uma ocorrência; eventos de um novo episódio de permissão
podem chegar sem alteração do arquivo. Replays com `tool_use_id` continuam idempotentes.

## Mods nas sessões de fase (RM-059)

Mod é plugin de *function hooks* do Claude Code 2.1.287 ou mais novo. Cada mod do Orkastery mora
em `adapters/claude-code/mods/<mod>/`, com o próprio `.claude-plugin/plugin.json`, e declara o
papel em `orkastery-mod.json`:

```json
{"formato":"ork.mod/v1","papeis":["fase"],"claudeCodeMinimo":"2.1.287"}
```

O papel `dono` roda na sessão de quem conduz; o papel `fase`, nas sessões de fase que o `ork`
despacha. O `ork adapter install claude-code` copia os mods com o resto do adaptador e grava cada
arquivo deles no `INSTALADO.json`. No despacho `claude-bg`, cada mod de papel `fase` entra com o
próprio `--plugin-dir`, logo depois do plugin do Orkastery, quando:

- a pasta instalada do mod tem exatamente os arquivos do recibo, com os mesmos bytes e sem link;
  os tipos que o próprio Claude Code escreve em `.claude-plugin/types/` (`*.d.ts` e
  `tsconfig.json`) ficam fora da conta;
- o `claude --version` atende o `claudeCodeMinimo` do mod e o 2.1.287 da API de mods.

Mod que pede versão mais nova fica fora do comando, e o despacho segue: o núcleo não depende de
mod. Mod cuja dependência ficou de fora (pela versão, ou por ser só de papel `dono`) também fica.
Declaração inválida, manifesto fora do recibo ou arquivo a mais na pasta recusa o despacho com
`runtime.context.installation`, como um byte divergente. Arquivo de mod que saiu do catálogo sai da
cópia na reinstalação: o `ork adapter install claude-code` tira o que ele mesmo instalou e ninguém
editou. Arquivo editado ou acrescentado à mão fica, e a recusa diz o caminho para apagar. A dependência (`dependencies` do
`plugin.json` do mod) entra antes de quem depende; o resto segue o nome. Os mods que foram ficam no
comando gravado no evento `phase_dispatch` do ledger da thread.

O arquivo comum da raiz de `mods/`, como a lista de autoridade que a ponte lê em `../autoridade.json`
antes da própria pasta, segue a mesma regra quando há mod de fase no despacho: fora do recibo, link
ou arquivo especial recusam, e o que saiu do catálogo sai da cópia na reinstalação.

Para tirar um mod das sessões de fase, mude o papel no `orkastery-mod.json` do catálogo, ou tire o
mod, e rode `ork adapter install claude-code` de novo.

O mod de papel `dono` não vai ao despacho: ele roda na sessão de quem conduz. Num projeto com o
adaptador instalado, a cópia dele já está em `.claude/plugins/orkastery/mods/<mod>`, com cada
arquivo registrado no `INSTALADO.json` e os arquivos comuns da raiz de `mods/` ao lado. Nesse
carregamento ninguém confere os bytes: a conferência contra o recibo roda no despacho, para mod de
fase. Carregue-a na sessão com:

```bash
claude --plugin-dir .claude/plugins/orkastery/mods/<mod>
```

Sem o adaptador local, cada mod tem uma entrada no marketplace próprio do repositório
(`.claude-plugin/marketplace.json`, gerado por `node core/scripts/gerar-marketplaces.cjs`), que aponta
para uma cópia gerada em `marketplaces/claude-code/mods/<mod>/`. Instalado pelo marketplace, o plugin
é só a própria pasta, então o arquivo comum da raiz de `adapters/claude-code/mods/` (a lista de
autoridade da ponte, por exemplo) vai dentro de cada cópia. A instalação é no escopo do projeto:

```bash
claude plugin marketplace add orkastery/orkastery
claude plugin install <mod>@orkastery --scope project
```

Os dois marketplaces se chamam `orkastery`, e o local, registrado na instalação acima a partir de
`.claude/plugins/orkastery`, não lista os mods. Não troque um pelo outro num projeto que usa o
plugin do adaptador: remover um marketplace desinstala os plugins que vieram dele (medido no
Claude Code 2.1.296), e o plugin do marketplace do repositório não traz o guard `PreToolUse` nem o
MCP do adaptador.

### Freio de Lote (`ork-freio`)

O primeiro mod de papel `fase`. Na sessão de fase, depois de cada lote de ferramentas, ele:

- acha os arquivos que o lote mexeu: os caminhos de `Edit`, `Write`, `MultiEdit` e `NotebookEdit` e a
  diferença do `git status` entre um lote e outro, que pega também a edição feita por `Bash`;
- acha as claims da thread que citam esses arquivos, pelo `arquivo` ou pelo texto do comando, e avisa
  quando o lote mexeu fora dos `touch_paths` do plano;
- pede ao núcleo, em segundo plano, a conferência dessas claims com
  `ork claims conferir <thread> --claims ... --json`, no sandbox do verify, uma rodada por vez;
- devolve ao modelo, no lote seguinte do laço principal, o que quebrou: o id da claim, o comando e o
  fim da saída. Lote sem claim afetada passa sem texto, e a linha de status mostra as claims em risco.
  O lote de um subagente conta os arquivos tocados, mas não leva a entrega nem o aviso.

O Freio nunca roda o comando de uma claim, nunca grava estado de claim e nunca para o laço: quem
verifica de verdade continua sendo o `ork verify`. Ele lê o papel e a thread pelo `$.ork` da ponte, e
as claims e o plano pelas ferramentas de leitura `ork_claims_list` e `ork_artifact_read`, nunca do
disco em `.orkastery/`. Precisa de um `ork` com `ork claims conferir` no `PATH` da sessão; sem ele, ou
sem o sandbox do verify, avisa uma vez que a conferência está indisponível e segue. Teste que cria
processo pode reprovar no sandbox e passar no `ork verify`, e o aviso diz isso junto da falha. O
resultado chega no lote seguinte: se a sessão terminar antes dele, a última conferência fica sem
entrega. Falha de claim cujo arquivo foi tocado de novo durante a conferência não é entregue, porque
uma conferência nova já foi pedida. Um `Edit` que falhou também conta como toque e pode pedir uma
conferência a mais.

### Portão de Tarefas (`ork-portao`)

O segundo mod de papel `fase`. Os portões do quadro agem só na sessão de fase cujo bloco atual tem o GO
(pelo slug do bloco no retrato do núcleo) e cuja thread tem plano com ao menos uma tarefa `T<n>` que
serve ao quadro: com `touch_paths` (caminhos entre crases, com barra, ponto ou curinga) e um verify com um
comando só entre crases, a regra do `ork claims conferir --tarefa`. Plano sem nenhuma tarefa assim não
ganha portão, para não travar o quadro do GO. Com o portão ligado:

- **criação:** `TaskCreated` recusa a tarefa cujo assunto não traz o id de uma tarefa do plano
  (`T2.1 ...`), ou cuja tarefa do plano não serve ao quadro. A recusa volta ao modelo com o motivo e as
  tarefas do plano que servem;
- **conclusão:** `TaskCompleted` da tarefa registrada na criação, ou da que cita no assunto uma tarefa do
  plano que serve, pede ao núcleo `ork claims conferir <thread> --tarefa T2.1 --prazo 540 --json`, no
  sandbox do verify, e só deixa a tarefa fechar com o item aprovado. Reprovação volta com o comando, o
  código e o fim da saída; sem veredito, recusa tipada, outra condução na thread, conferência que não roda
  ou falha do próprio Portão também bloqueiam, sempre com a saída: corrigir e concluir de novo, ou devolver
  a tarefa para `pending` e seguir. A tarefa registrada continua conferida mesmo com o plano ilegível na
  hora, porque o núcleo lê o plano por conta própria. Uma conferência por vez: a conclusão que chega no
  meio de outra é recusada na hora. Da terceira reprovação igual em diante, o texto manda deixar a tarefa
  aberta;
- **teammate ocioso:** com agent teams no piloto (abaixo), `TeammateIdle` entrega ao teammate a próxima
  tarefa do plano que serve, não fechou nesta sessão e cuja região está livre: nenhum lease `path:` ativo,
  de nenhuma thread, cruza os `touch_paths` dela e ela não cruza as tarefas dos outros teammates. Os leases
  vêm do retrato de todas as threads pela consulta `maestro` da ponte
  (`ork maestro --json --section leases --offset N`), seguindo o `nextOffset` das páginas que o teto de
  bytes do retrato corta, até 10 páginas, porque o servidor MCP da sessão de fase só mostra os da própria
  thread. O Portão não toma nem solta lease: o `ork_git_commit` toma o `path:` de cada arquivo na hora do
  commit e recusa o commit com qualquer lease no caminho. Quem fica ocioso sem concluir devolve a tarefa,
  que sai da distribuição automática desta sessão. Sem a lista de leases inteira (seção indisponível,
  lacuna, retrato em conflito ou mais de 10 páginas), no teto de custo ou sem tarefa livre, o teammate
  fica ocioso.

O Portão nunca roda o verify por conta própria: quem verifica de verdade continua sendo o `ork verify`.
Ele lê o papel pelo `$.ork.contexto` da ponte, o estado e o bloco pelo `$.ork.retrato`, os leases pela
consulta `maestro` da ponte e o plano pelo `ork_artifact_read`, nunca do disco em `.orkastery/`. Teste que
cria processo pode reprovar no sandbox e passar no `ork verify`, e o bloqueio diz isso.

Agent teams na sessão de fase só rodam no piloto, desligado por padrão. Quem conduz liga no manifesto da
raiz:

```yaml
runtime:
  agent_teams:
    ligado: true
    teammates: 2   # teto de teammates vivos, de 1 a 8
    custo_usd: 10  # teto do custo da sessão, como o /cost soma, até 500
```

Com a chave ligada, o GO no bloco da fase atual e o Portão entre os mods que vão à sessão, o despacho
`claude-bg` acrescenta ao `--settings` a variável `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, os dois tetos
(`ORK_AGENT_TEAMS_TEAMMATES` e `ORK_AGENT_TEAMS_CUSTO_USD`) e `teammateMode` `in-process`, porque a sessão
de fundo não tem `tmux`. Teto inválido vira aviso do manifesto e deixa desligado. Em toda sessão de fase,
com ou sem o portão do quadro, o Portão recusa o nascimento de teammate sem os tetos, no teto de teammates
vivos ou com o custo da sessão no teto, e no teto de custo não entrega tarefa nova.

Limites conhecidos:

- o quadro do Portão vale para a sessão: numa sessão de GO redespachada, tarefa fechada na anterior pode
  ser entregue de novo ao teammate, que a encontra pronta no quadro e no git;
- o líder não recebe aviso quando um teammate devolve uma tarefa; ele a vê aberta no quadro;
- a conferência do Freio, em segundo plano, e a do Portão, na conclusão, podem rodar ao mesmo tempo na
  mesma worktree; cada mod só serializa as próprias;
- os tetos dependem de o Portão carregar de verdade: o despacho decide pelo `--plugin-dir`, e se o mod não
  registrar na sessão, agent teams fica ligado sem ninguém aplicando os tetos;
- se o turno for interrompido no meio da conferência, o Claude Code segue sem a resposta do gancho;
- nome de lease que o retrato redige (caminho absoluto ou texto com cara de segredo) chega irreconhecível e
  não cruza nenhuma região;
- o comportamento desses eventos numa sessão `claude --bg` real com agent teams ainda não foi medido; os
  testes do kit e do núcleo cobrem o mod e o despacho.

## A #TAG de conducao

O comando `/goal` extrai o modo do proprio pedido, sem reimplementar nada:

```bash
MODO=$(ork modos --do-pedido "$ARGUMENTS")
ork thread new "<nome>" --mode "$MODO" --worktree auto
```

`ork modos --do-pedido` usa a mesma `extrairTagDoPedido` do nucleo. Sem tag no texto, vale o
`conduction.default_mode` do manifesto. **A validacao contra `conduction.allowed_modes` e do
nucleo**, dentro do `ork thread new`: o host transporta a tag, nunca decide se ela vale.

## Os 3 pitfalls de instalacao

Sao os tres jeitos conhecidos de a instalacao "dar certo" e nao funcionar. O instalador confere os
tres e o `--dry-run` mostra o que ele vai fazer sobre cada um.

1. **Manifesto sem os caminhos das skills instala limpo e nao expoe nada.** Um plugin do Claude
   Code auto-descobre `skills/<nome>/SKILL.md` e para ai: ele nao desce nos diretorios de bucket
   (`core/`, `phases/`, `reviewers/`, ...) que este catalogo usa. Por isso `plugin.json` declara os
   caminhos um a um. O teste compara esses caminhos com o catálogo fonte e exige
   `onboarding`, acrescentada por I15. Neste catálogo, `claude plugin details orkastery`
   deve reportar 29 entradas: 21 skills e 8 comandos (a linha `Skills (29)`). O startup registra
   separadamente skills e comandos. As provas anteriores, com 17 e 18 skills, são históricas.
   Confira também os seis agentes e seis eventos de hooks, sem erros de carregamento.

2. **Duas copias do catalogo divergem, e a divergencia so aparece quando ja custou uma entrega.**
   A fonte unica e `skills/` na raiz do produto. O instalador copia de la e grava a origem e o
   sha256 de cada arquivo em `INSTALADO.json`; reinstalar com `--force` ressincroniza. Editar a
   copia instalada e bandeira vermelha: a correcao volta para o catalogo e desce de novo pelo
   instalador.

3. **Hook com caminho relativo silenciosamente nao roda, e o guard vira decoracao.** O
   `hooks.json` chama `node "${CLAUDE_PLUGIN_ROOT}/hooks/ork-guard.js"`, nunca um caminho relativo
   ao diretorio de trabalho, que muda a cada worktree de thread. Depois de instalar, prove que o
   script do guard funciona isoladamente:

   ```bash
   echo '{"tool_name":"Bash","tool_input":{"command":"git add -A"}}' \
     | node <plugin>/hooks/ork-guard.js ; echo "codigo: $?"
   ```

   Codigo 2 e decisao `deny` na saida: guard vivo. Codigo 0: o hook nao esta bloqueando nada.

## Nao confunda as duas camadas

O Claude Code aparece duas vezes na arquitetura do Orkastery. **Aqui ele e Camada 1**, o podio: o
host onde o builder conversa e de onde as chamadas de `ork` saem. Ele tambem e **Camada 3**, a
orquestra, quando o `ork` despacha `claude --bg` para escrever codigo, e esse adaptador de runtime
mora em `core/src/adapters/claude-bg.ts`, chamado pelo nucleo. Sao papeis diferentes no mesmo
programa, e misturar os dois e como o Orkastery original acabou prometendo um motor que nunca teve.
# Entrada Maestro

Em sessão nova com o plugin ativado, diga `orkastery maestro`. A entrada consulta
`mcp__orkastery__ork_maestro` e apresenta fontes, lacunas e ações disponíveis.
A instalação em fixture prova os arquivos/roteamento; ativação e conversa real
dependem do recibo pós-SHIP. HITL prioriza recomendação, opções claras e pergunta
nativa na condutora. Telegram é opcional. Falha de autenticação não autoriza trocar
provider, runtime ou permissões.
