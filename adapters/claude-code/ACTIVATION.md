# Ativação nativa escopada: I-04 / T10

Este é o plano para revisão do condutor. GO testa fixtures; ativação operacional só
acontece depois de CHECK, revisão de prontidão, SHIP pelo `ork` e rebuild da main.
A iniciativa continua aberta até um despacho controlado autorizado produzir evento
real no estado canônico. Nenhuma aprovação ou score humano é emitido pelo autor.

## Contrato comprovado no Claude 2.1.263

`ork adapter install claude-code` prepara um plugin completo e o recibo de arquivos.
`claude plugin validate`, `plugin marketplace add` e `plugin install` verificam o
contrato nativo. O manifesto omite `agents` e `hooks` porque usa os locais padrão;
os caminhos de skills continuam explícitos devido aos diretórios intermediários.
I15 acrescentou `onboarding`: o catálogo integrado contém 18 skills. A prova de T10
com 17 skills e C14 permanecem históricas; o ensaio atual compara os caminhos com
`skillsDoCatalogo` e exige a presença de onboarding.
Veja as [regras de componentes](https://code.claude.com/docs/en/plugins-reference).

O comando `node adapters/claude-code/test/native-plugin.cjs --smoke` produz recibo
JSON com argv, cwd, horários, saídas e códigos reais. Os testes usam o
[CLAUDE_CONFIG_DIR isolado](https://code.claude.com/docs/en/claude-directory), a API
`novaThread(... criarWorktree: true)` e o CLI Claude instalado. O inventário é de
26 skills/comandos, seis agentes e seis hooks neste catálogo. O startup precisa registrar
as 18 skills vigentes, oito comandos, seis agentes e seis hooks sem erros. Os dois smokes
exigem `PermissionRequest` real, `sessao_bloqueada` canônica e ferramenta não
executada. A configuração adicional da sessão contém somente a regra `ask: Bash`;
nenhum hook é injetado pelo harness e nenhum JSON é reproduzido como evento.

`--scope project` foi testado separadamente no projeto e na worktree habilitada.
Outra worktree do mesmo Git, sem habilitação, e outro projeto carregaram zero hooks.
`--scope local` na main NÃO satisfaz essa exclusão: uma worktree sem configuração
própria herdou o plugin. `plugin list` e inventário não substituem startup nem evento.
A matriz de escopos é evidência dessa versão do CLI, não promessa para versões futuras.

## Contrato de isolamento de T11

Os dois harnesses criam homes, diretórios XDG, caches, sessões e temporários dentro
da tentativa. Os recibos listam caminhos e tamanhos dos arquivos criados, identificam
os transcripts/rollouts nativos e confirmam a remoção dos diretórios próprios. Nenhum
inventário global ou acesso a threads protegidas é necessário para essa prova.

Claude recebe o OAuth de assinatura de `~/.hermes/.env` somente pelo ambiente filho.
Codex reutiliza seu cache nativo ChatGPT por descritor Linux `memfd` selado: a fixture
contém um link ao descritor vivo, nunca uma cópia persistente da credencial. Não se
altera o cache original. Um refresh que precise gravar nesse cache fica indisponível;
essa condição reprova o smoke, sem login global, API paga ou redução do sandbox.
Esse mecanismo requer Linux e Python com `memfd_create`/seals. O contrato de cache
do CLI está na [documentação de autenticação](https://learn.chatgpt.com/docs/auth).

O smoke lê `runtime.sandbox` do manifesto do diretório de execução e transmite o
valor ao adapter oficial. Em `workspace-write`, exige comando real, arquivo, usage,
recibo e rollout isolado. `read-only` é preservado e reprova a prova que requer escrita.
O rollout legado de T9 continua sendo tratado pontualmente pelo condutor/I02; T11
não o apaga nem o adota e não altera a classificação operacional de sessões sem thread.

## Preparação e preservação

1. O condutor revisa o candidato, os recibos novos, CHECK e a ordem com I-02.
   S1 exige a correção T11, a reprodução interceptada e o smoke real no sandbox
   configurado. A main versionada já usa `workspace-write`; sua configuração
   operacional suja não altera essa baseline. Não alterar sandbox para passar.
2. Autorizar um conjunto explícito de diretórios. Para esta iniciativa, começar
   somente pela raiz do projeto e, quando necessário, pela worktree da thread
   (`<raiz>/.claude/worktrees/<thread>`). Depois do SHIP,
   uma worktree pode precisar de sync oficial antes da ativação. Cada nova worktree
   precisa de instalação/habilitação explícita e prova própria antes do despacho.
3. Excluir por ID **antes de resolver qualquer estado ou arquivo**:
   `ork-grandeevoluc`, `ork-jornadasdpa`, `ork-renarrativac`. Não varrer threads,
   não adicionar configuração de desabilitação nelas, não ler suas configurações
   nem testar nelas. Projetos alheios nunca entram no conjunto autorizado.
4. Com leases canônicas dos diretórios/regiões efetivamente alterados, registrar
   HEAD, base, UID, status Git restrito aos caminhos da entrega e hashes dos
   arquivos de configuração relevantes. Preservar cópias restritas dos arquivos
   exatos que o CLI vai alterar e do adaptador existente. Não imprimir valores de
   ambiente, credenciais ou configuração completa. Configuração de autenticação
   existente não é objeto desta ativação; segredos permanecem em `~/.hermes/.env`.
5. Verificar colisões antes de instalar: marketplace `orkastery` e plugin
   `orkastery@orkastery` devem corresponder à origem prevista. Uma colisão ou
   configuração divergente exige análise, nunca `--force` genérico. O instalador
   aponta divergências; revisão dos arquivos e backup precedem eventual substituição
   apenas do adaptador. Preservar todas as chaves de settings não relacionadas.

## Sequência após SHIP e rebuild

Na main, sob as leases e autorização do condutor, reconstruir o CLI da versão
mergeada e registrar o SHA efetivo. Executar em cada diretório do conjunto autorizado:

```bash
ork adapter install claude-code --dry-run
ork adapter install claude-code
claude plugin validate .claude/plugins/orkastery
claude plugin marketplace add "$PWD/.claude/plugins/orkastery" --scope project
claude plugin install orkastery@orkastery --scope project
claude plugin list --json
claude plugin details orkastery
```

Se já existe uma instalação, usar o fluxo nativo de atualização dessa instalação
após comparar a origem e preservar seu conteúdo; não aceitar o mesmo número de
versão como prova de bytes atualizados. Revalidar os hashes do recibo instalado e
os caminhos carregados pelo CLI. Reinstalação deve passar pela mesma verificação.

As entradas de habilitação são locais à cópia de `.claude/settings.json` em cada
árvore. Não commitar esses arquivos de ativação nem propagá-los por merge/sync ou
copiá-los para todas as worktrees: isso ampliaria o conjunto habilitado. Não usar
escopo `user`, `local` na main, links globais, hooks globais ou edição de `~/.claude`.
Não substituir a configuração existente por um arquivo reduzido do harness.

Reexecutar a matriz isolada de escopos com a versão do CLI que fará o despacho.
Registrar o startup nativo no diretório autorizado. Despachar pelo `ork phase run`
uma thread de prova explicitamente autorizada, com claude-bg/opus/high e evento
controlado. A sessão precisa constar no recibo de despacho antes da prova; usar o
sessionId real para correlacionar o hook e o ledger na main. O CLI que o sensor chama
é o `ork` reconstruído da main. Não apontá-lo para um wrapper que gere eventos.

O despacho operacional não é substituído pelos smokes: estes já provaram o plugin
em fixtures, mas não a main reconstruída nem o registro real do despacho. Se o
runtime termina, falha ou pede humano antes da prova, registrar esse resultado e
manter a iniciativa aberta. Não fabricar aprovação. O condutor confere preservação
da main pelos hashes/diffs restritos e mantém o score humano pendente para batch.

## Rollback e limites

Conservar hashes anteriores e posteriores à ativação. Para cada diretório autorizado,
`claude plugin disable orkastery@orkastery --scope project` interrompe carregamentos
novos; encerrar somente a sessão controlada pelo `ork`. Restaurar somente as chaves
inseridas pelo plano quando ainda têm os valores esperados; se outra ação mudou o
arquivo, reconciliar a diferença sem restaurar um snapshot inteiro por cima dela.
Não desinstalar marketplaces compartilhados nem apagar caches/dados de outros plugins.
A reversão do código segue o rollback do SHIP, serializado, sem force-push.

O dispatcher atual não prepara automaticamente a configuração nativa de novas
worktrees. A sequência explícita acima atende à ativação do conjunto autorizado.
Se a operação exigir automação dessa preparação, abrir tarefa/claim de core, entrar
no fim da FIFO `path:core` e aguardar. Não resolver isso com wrapper de PATH, glob
menor ou habilitação herdada por threads excluídas.
# Prova da entrada Maestro

Depois de ativar a versão entregue em uma sessão nova, apresente literalmente
`orkastery maestro` e confira a origem do snapshot. Registro de instalação não
prova carregamento; guarde identidade nativa da sessão e recibo do host. Descubra
`select:mcp__orkastery__ork_maestro` pelo nome completo. Um pedido HITL deve usar
elicitation da condutora, conservar cancelamento e produzir readback do núcleo.
Não habilite grants novos nem mude `interactive` para `worktree` para passar a prova.
