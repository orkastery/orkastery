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
isolar o contexto de cada fase, e o guard `PreToolUse`.

## O guard PreToolUse

Um hook, em `Bash`, chamando `hooks/ork-guard.js`. Ele bloqueia seis classes de comando:

| Bloqueio | Por que |
|---|---|
| `git add -A`, `git add --all`, `git add .` | Engolem arquivo de outra thread na mesma arvore |
| `git commit -a` | Comita o que esta rastreado, nao a tarefa |
| `git push --force` | Reescreve historico publico e apaga entrega alheia |
| `git push` | Push na mao nao e provado: a entrega passa por `ork ship` |
| `git reset --hard`, `git clean -fd`, `git checkout -- .` | Descarte em massa sem rastro |
| `rm -rf` com alvo amplo ou variavel | Apaga o que ninguem pediu |

**O guard nao tem regra de negocio.** Ele nao le ledger, nao sabe quem autorizou o que e nao
conhece thread nenhuma: ele reconhece a forma do comando e manda o agente pelo caminho que o `ork`
verifica. Comando que comeca com `ork` passa direto, porque quem prova o push e serializa o merge e
o nucleo. E se o proprio guard quebrar, ele **libera**: um hook que derruba a sessao por bug proprio
e pior que nenhum hook.

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
   deve reportar 26 entradas: 18 skills mais oito comandos. O startup registra
   separadamente skills e comandos. A prova anterior de T10, com 17 skills, é histórica.
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
