# Mods em sessão de fase: a prova da RM-059 (T0.1)

Esta página responde se um mod do Claude Code carrega numa sessão de fase do Orkastery, a sessão `claude --bg` que o núcleo despacha para GOAL, PLAN, GO ou CHECK, e quatro perguntas que decidem o plano dos mods de papel `fase` (Freio, Portão, Clima nas sessões de fase e o lado receptor do Mensageiro). A sessão que escreveu esta página é ela mesma uma sessão de fase e não abre outra sessão `claude --bg`, porque isso seria recursão. O que ela mediu está abaixo, com a fonte de cada medida. O resto sai do script de prova, que a condutora roda.

Veredito: carrega. Um mod carregado por `--plugin-dir` numa sessão `claude --bg` recebe `session.start`, `classic.SessionStart` e `classic.PostToolBatch` (Claude Code 2.1.296, prova da condutora em 12/10/2026). O Freio nasce como mod (F2), sem o plano B.

## Resultado da prova

A primeira rodada do script não registrou nada: a sessão de sonda parou na tela de aprovação do servidor MCP do projeto ("New MCP server found in this project"), antes do primeiro turno. O despacho real de fase passa `--strict-mcp-config` e não para nessa tela; o script passou a passar a mesma flag. Com ela, a sonda registrou:

| Evento | O que a sonda viu |
| --- | --- |
| `classic.SessionStart` | origem `startup` |
| `session.start` | marca do `--settings` lida pelo `$.env.get`; ferramentas `TaskCreate`, `TaskGet`, `TaskList`, `TaskStop` e `TaskUpdate`; versão 2.1.296 |
| `classic.PostToolBatch` | um lote com 2 chamadas de `Bash`; `permission_mode` `auto` |

- **P1:** sim. O `$.env.get` lê a marca que o `--settings` passa.
- **P2:** sim. As ferramentas Task existem na sessão de fundo.
- **P3:** `auto`.
- **P4:** o `claude` não está no PATH do sandbox do verify (`--ensaio`); as claims de mod seguem herméticas.

## Como rodar a prova

O ensaio grava o mod de sonda e mostra o comando, sem abrir sessão e sem chamar o `claude`:

```bash
node core/scripts/prova-mods-sessao-de-fase.cjs --ensaio
```

A prova de verdade abre uma sessão `claude --bg` com a sonda, espera o registro, para a sessão e imprime as respostas. Rode de um repositório que o Claude Code já confia (ou de uma worktree dele), com o login de sempre:

```bash
node core/scripts/prova-mods-sessao-de-fase.cjs --cwd <worktree confiada> --json
```

O script não lê nem grava credencial. O env da sessão da sonda perde `ORK_DISPATCH_*`, `ORK_CANAL` e `ORK_HITL_*`, para a sonda nunca escrever no ledger de uma thread. A sonda (`ork-sonda-fase`) registra `session.start`, `classic.SessionStart` e `classic.PostToolBatch` num arquivo `registro.jsonl` ao lado dela, com a marca lida por `$.env.get`, as ferramentas `Task*` de `$.tool.list()` e o `permission_mode`.

## Pergunta principal: o mod carrega e recebe os eventos?

Um mod carregado por `--plugin-dir` numa sessão `claude --bg` registra `session.start` e `classic.PostToolBatch`?

- **Medido aqui:** o despacho desta sessão (evento `phase_dispatch` do ledger da thread) passa `--plugin-dir` com o adaptador instalado, e os hooks de settings do plugin do Orkastery (o sensor `ork-sensor.js`) gravaram eventos no ledger durante esta sessão. Plugin com hooks de settings carrega em sessão `--bg`. A medida não separa as origens, porque o mesmo plugin também está instalado no escopo do usuário desta máquina, e não diz nada sobre um módulo de function hooks.
- **Fica com a prova:** os campos `carregou.sessionStart` e `carregou.postToolBatch` do resumo.

## As quatro perguntas

### P1. O `$.env.get` lê o env que o `--settings` do despacho passa?

- **Medido aqui:** o `ORK_DISPATCH_ID` que o Bash desta sessão vê é igual ao `dispatchId` do `phase_dispatch` desta thread, e ele só chega pelo `--settings` do despacho. Pelos tipos do 2.1.296, o `$.env.get` lê "the environment of this process, the one every Bash child, MCP server and `$.process.run` command started after inherits". A leitura indireta é sim.
- **Fica com a prova:** a sonda lê a marca do `--settings` com a marca velha no ambiente de quem abre a sessão (`p1Env.ok` e `p1Env.leuMarcaVelha`).

### P2. As ferramentas Task existem nessa sessão de fundo?

- **Medido aqui:** sim. Esta sessão, despachada por `claude --bg`, tem `TaskCreate`, `TaskGet`, `TaskList` e `TaskUpdate`, e usou `TaskCreate` e `TaskUpdate` para acompanhar o próprio bloco.
- **Fica com a prova:** `p2Task.ferramentas` pela lista que o mod recebe.

### P3. Qual modo de permissão a sessão de fase usa?

- **Medido aqui:** o despacho não passa `--permission-mode`, nenhum arquivo de settings da máquina define `permissions.defaultMode`, e o harness desta sessão se declara em modo auto. Pela doc de mensagens entre sessões, o modo auto entrega mensagem de outra sessão (não é bypass), o que pesa na DD3.
- **Fica com a prova:** `p3Permissao.modos`, pelo `permission_mode` que o hook recebe.

### P4. `claude plugin validate` e `claude plugin test` rodam dentro do sandbox do verify?

- **Medido aqui:** numa réplica do sandbox do `ork verify` (o `codex sandbox` com o mesmo estado de `core/src/verify-sandbox.ts`, rede desligada e HOME temporário), o `claude` não está no PATH (`/usr/local/bin:/usr/bin:/bin`). Chamado pelo caminho absoluto do binário, `claude plugin validate --strict` e `claude plugin test` rodaram offline e passaram (saída 0) sobre a sonda.
- **Consequência:** a barreira é só o PATH. Caminho absoluto não pode ir para uma claim, porque o bundle é público e o runner do CI não tem `claude`. Por isso as claims dos mods são herméticas (testes do núcleo e varredura estática) e os dois comandos ficam como prova no host, até o CI ganhar o `claude` (T0.9).

## O que muda com cada resposta

| Resposta | Efeito no plano |
| --- | --- |
| Carrega e recebe `classic.PostToolBatch` | O Freio nasce como mod (F2) |
| Não carrega, ou o lote não chega | O Freio vai pelo plano B, o settings hook clássico (T2.4) |
| P1 sim | O papel `fase` sai de `ORK_DISPATCH_ID` lido pela ponte (D4) |
| P2 sim | O Portão pode usar as ferramentas Task sem agent teams (T10.4) |
| P3 | Decide se `crossSessionInbound` entra no despacho (DD3) |
| P4 | Decide o domicílio das claims de mod (D8) |

## Para completar

A condutora roda a prova, troca a linha do veredito por `Veredito: <resposta>` com o build medido e anota as quatro respostas que o script imprimiu nas seções acima.
