# Mensageiro de Sessões

> **Em uma frase:** a resposta que você dá pelo diálogo da sua sessão do Claude Code chega à sessão de fase `claude-bg` que parou esperando por ela, conferida pelo núcleo nas duas pontas, sem `claude attach`.

Use este guia se uma sessão de fase despachada por `claude --bg` parou com uma pergunta e você quer responder da sua sessão, ou se quer entender por que uma mensagem de outra sessão não entrou numa sessão de fase.

## O que muda para você

- **Antes:** a sessão `claude-bg` que parou com uma pergunta só recebia resposta pelo `claude attach`. O núcleo não abria o pedido de sessão para ela nem tinha como entregar a resposta.
- **Agora:** o núcleo abre o pedido de sessão `claude-bg` preso ao turno que parou, você responde pelo diálogo nativo da sua sessão (a Mesa do Dono ou o `ork_request_decision`), e o mod `ork-mensageiro` leva a resposta à sessão de fase.
- **Pelo Telegram:** a resposta a uma sessão `claude-bg` não sai. O núcleo recusa antes de gravar o ingresso, com `runtime.unavailable` e a correção: o texto da resposta só existe na memória do servidor MCP da sua sessão, e o processo do Telegram não tem essa caixa.
- **O que a resposta não faz:** ela chega à sessão de fase como mensagem de outra sessão. Informa a sessão; não autoriza ação que só você aprova (um gate, um push). Para isso, `claude attach`.

## O caminho da resposta

1. A sessão de fase para num turno com uma pergunta em texto, sem ferramenta pendente. O núcleo prende o pedido a esse turno pela transcrição que o próprio Claude Code grava: o `uuid` da última linha do assistente e a pergunta projetada, de até 2000 caracteres.
2. Você responde pelo diálogo nativo da sua sessão. Antes do diálogo, o núcleo confere que um Mensageiro consultou a caixa de saída desta sessão nos últimos 120 s; sem ele, recusa antes de você digitar.
3. O núcleo compõe a mensagem no contrato `ork.session-delivery/v1` (um cabeçalho exato e a sua resposta, literal), grava `session_delivery_queued` com o sha256 do corpo, nunca o texto, e põe a mensagem na caixa de saída, só na memória do servidor MCP desta sessão.
4. O Mensageiro lê a caixa (`ork_session_outbox`), envia a mensagem à sessão de fase por `$.session.send`, como o núcleo a compôs, e anota o envio (`session_delivery_sent`).
5. Na sessão de fase, o Mensageiro leva a mensagem ao `ork_session_inbox` (`conferir`), com um prazo (`ate`) de 15 s. O núcleo aceita o envelope `<cross-session-message ...>` do Claude Code só na forma que o motor escreve (os atributos conhecidos, cada um numa linha só), confere o despacho do servidor, a entrega, a sessão, o sha256 e que a sessão ainda está no mesmo turno, e reserva a entrega uma vez (`session_delivery_reserved`), só antes do prazo. Só a confirmada entra na conversa do modelo, como chegou.
6. Depois de a mensagem entrar na fila do modelo, o `confirmar` grava o recibo do receptor, e a reconciliação de sempre grava o `session_answered`.

| Evento no ledger da thread | Quem grava | O que diz |
| --- | --- | --- |
| `session_delivery_queued` | o servidor da sua sessão | a resposta entrou na caixa de saída, com o sha256 do corpo |
| `session_delivery_sent` | o Mensageiro do dono, pelo núcleo | o envio entrou ou não entrou na fila da sessão de fase, com o motivo |
| `session_delivery_reserved` | o servidor da sessão de fase | o núcleo conferiu e reservou a entrega para esta sessão; vem de outro servidor e pode sair antes do `session_delivery_sent` |
| `session_answered` | a reconciliação | a resposta chegou, com o recibo do receptor (`recibo-do-controller`) |

O reenvio segue três regras. O que o receptor reservou não vai de novo. O envio que não entrou na fila volta depois de 30 s. O que entrou e ninguém reservou em 60 s também volta, porque o receptor que falhou na conferência consome a mensagem e reserva uma vez só (a cópia a mais é consumida). Depois de 10 envios, o Mensageiro desiste, e o painel e a faixa pedem o `claude attach`.

## Como ligar nas duas pontas

Precisa do Claude Code 2.1.287 ou mais novo e do adaptador instalado no projeto (`ork adapter install claude-code`), que copia os mods para `.claude/plugins/orkastery/mods/`.

- **Na sua sessão (papel `dono`):** com o servidor MCP do projeto (`ork mcp install --project "$PWD" --host claude-code`), carregue a ponte e o Mensageiro. A caixa de saída só existe no servidor do Claude Code sem thread, o da sua sessão.

  ```bash
  claude --plugin-dir .claude/plugins/orkastery/mods/ork-ponte --plugin-dir .claude/plugins/orkastery/mods/ork-mensageiro
  ```

- **Na sessão de fase (papel `fase`):** nada a fazer. O despacho `claude-bg` já passa a ponte e o Mensageiro por `--plugin-dir` e acrescenta `crossSessionInbound: accept` ao `--settings` que monta, só com o Mensageiro entre os mods que vão à sessão e o `ORK_DISPATCH_ID` no env do despacho. Sem o campo, a paridade de modo do Claude Code seguraria a mensagem, e numa sessão sem pessoa ela vence o prazo. Com um `claude` abaixo da API de mods, nem o mod nem o campo vão.

Depois de atualizar o `ork`, rode `ork adapter install claude-code` de novo: o despacho usa a cópia instalada dos mods.

## O que a sessão de fase deixa entrar

| Origem da entrega | O que o Mensageiro faz |
| --- | --- |
| Remote Control do dono (`bridge`), notificação de tarefa, agendamento e canal (`slack-ping`) | passa como chegou, sem chamada ao núcleo |
| Mensagem para um agente desta sessão (com o `agentId` dele) e de teammate que o harness verificou | passa como chegou |
| Todo o resto: mensagem de outra sessão (`peer`, `peer-send-message`), de sessão coordenadora (`coordinator`, `projects-relay`), sem classe (`unclassified`), mailbox de teammate que o harness não verificou, tipo de origem desconhecido | só entra confirmada pelo núcleo; sem a marca `ork.session-delivery/v1`, é consumida sem chamar o núcleo |

- O nome do plugin que o remetente declara (`origin.plugin`) nunca conta: uma mensagem que diz vir do `ork-mensageiro` e não tem entrega confirmada é consumida.
- A falha do núcleo, o prazo vencido (15 s no núcleo, 20 s no mod) e a resposta fora do contrato consomem. Sem a ponte, ou sem o papel da sessão, o Mensageiro também consome a mensagem de outra sessão. O `.catch` do gancho fecha do mesmo jeito, salvo a mensagem que o núcleo já confirmou e reservou, que segue.
- Cada mensagem consumida deixa uma linha no transcript, fora do modelo, e uma linha no `/mensageiro`, com a origem e o motivo, nunca o texto.
- A linha da resposta confirmada mostra "Resposta do dono ao pedido X, conferida pelo núcleo" no lugar do cabeçalho, só na linha de mensagem de outra sessão e com o mesmo texto que o núcleo conferiu (a impressão do texto, nunca o texto, fica no estado). É só visual: o que fica guardado e o que o modelo lê não mudam.

## O painel

`/mensageiro` abre o painel nas duas pontas, no terminal e no desktop. Todo estado tem glifo e rótulo.

| Na sua sessão | Quer dizer |
| --- | --- |
| `·` na fila do núcleo | a resposta entrou na caixa e ainda não foi enviada |
| `●` a caminho | entrou na fila da sessão de fase, esperando a conferência |
| `●` recebida pela sessão, confirmando | o receptor reservou a entrega |
| `?` recebida pela sessão, sem recibo em 5 min | a sessão de fase reservou e não gravou o recibo: confira pelo `claude attach` |
| `×` não entrou na fila da sessão | nova tentativa em breve, com o motivo |
| `×` não chegou | o Mensageiro desistiu: responda pelo `claude attach` |
| `✓` entregue | com o recibo da sessão |
| `?` saiu da caixa sem recibo | a caixa soltou a entrega com o pedido ainda aberto (o servidor da sua sessão reiniciou, por exemplo): responda pelo `claude attach` |

Abaixo, "Fora desta sessão" lista o pedido que o retrato mostra com a entrega incerta e que a caixa desta sessão não tem: a entrega pode seguir noutra sessão do dono, ou ter se perdido com uma sessão que fechou. O painel não sabe qual; sem retorno, responda pelo `claude attach`.

Na sessão de fase, o painel lista o que chegou de outras sessões, o mais novo em cima: `○` consumida antes do modelo, `●` na conversa gravando o recibo, `✓` com o recibo no núcleo, `?` na conversa sem o recibo e `×` conferida, mas consumida por outro plugin abaixo. O recibo que falha volta em 5 s, 30 s e 120 s; a recusa do núcleo não volta.

## A prova

- **Sem o Claude Code:** `node --test core/dist-test/test/hitl-sessions-mod.test.js` (depois de `npm --prefix core run build` e `npm --prefix core run build:test`) roda o ciclo inteiro pelos dois servidores MCP; `core/dist-test/test/ork-mensageiro.test.js` cruza o mod com o contrato do núcleo e varre a AST pela lista fechada; `core/dist-test/test/ork-mensageiro-despacho.test.js` monta o despacho com o catálogo real; `node core/scripts/checar-mods.cjs adapters/claude-code/mods/ork-mensageiro` roda a guarda estática.
- **No host:** `claude plugin validate --strict adapters/claude-code/mods/ork-mensageiro` e `claude plugin test adapters/claude-code/mods/ork-mensageiro`, que o job `mods` do CI também roda.
- **Num despacho de verdade:** com uma sessão de fase `claude-bg` parada numa pergunta, o pedido sai por `ork sessions request <thread> <sessao> --fase <fase> --runtime claude-bg` (o `--pergunta` é opcional e, quando vem, tem de ser igual ao texto nativo do turno); você responde pelo diálogo da sua sessão com o Mensageiro ligado; o ledger da thread mostra `session_delivery_queued`, depois `session_delivery_sent` e `session_delivery_reserved` (em qualquer ordem entre os dois) e, por fim, `session_answered`, e o `/mensageiro` das duas pontas diz entregue.

## Limites ditos

- **A sessão de fase de verdade não foi medida por esta entrega:** a sessão que a escreveu não abre `claude --bg`. Se o texto chegar ao destino num formato diferente do que o núcleo compôs, a entrega falha fechada: a mensagem é consumida e o `session_delivery_reserved` não aparece.
- **Só `claude-bg`:** a sessão `codex` segue pelo caminho nativo dela.
- **A resposta não vai ao estado do Orkastery:** o ledger e a pasta `entregas-de-sessao` guardam só ids e o sha256, e a caixa de saída fica na memória. A transcrição da sessão de fase, que o próprio Claude Code grava, tem a mensagem, como qualquer conversa. Se o servidor MCP da sua sessão reiniciar antes da entrega, a entrada sai da caixa sem recibo e o painel pede o `claude attach`; se a sessão inteira fechar, a nova só vê a entrega como incerta, fora dela.
- **Mensagem de um agente desta sessão para a conversa principal:** chega como mensagem de outra sessão (`peer`, sem `agentId`) e não se distingue de uma; o Mensageiro a consome. O que vai para um agente, e o resultado e a notificação dos agentes, passam.
- **O envelope do Claude Code:** só a forma que o motor escreve passa. Os atributos dele (o nome que a sessão remetente declara, por exemplo) são do motor e chegam ao modelo junto, como em toda mensagem de outra sessão.
- **Plugin abaixo do Mensageiro:** se outro plugin consumir a mensagem depois da conferência, a entrega fica reservada sem recibo; o painel da fase diz que ela não entrou na conversa.
- **Teammate em painel próprio:** o despacho roda os teammates no mesmo processo; uma entrada de mailbox sem verificação é consumida.
- **Sem a ponte:** o Mensageiro consome as mensagens de outras sessões também na sua sessão, até a ponte carregar; o aviso da sessão diz isso.

## A medida

A medida é a M10 do plano dos mods: as respostas com alvo `session` entregues com recibo (`session_answered`), com o recorte do que passou pelo Mensageiro (`session_delivery_queued`) e o tempo da fila ao recibo, pelo ledger de cada thread, antes e depois de ligar o Mensageiro nas duas pontas. Antes desta entrega, nenhum pedido de sessão `claude-bg` existia, porque o núcleo não conseguia abri-lo.

A meta: toda resposta para `claude-bg` entregue com recibo em até 1 min no p90, e nenhuma na fila sem recibo, por janela. Para ver os eventos de uma thread:

```bash
jq -c 'select(.tipo == "session_delivery_queued" or .tipo == "session_answered") | {tipo, ts, pedidoId}' .orkastery/threads/<thread>/ledger.jsonl
```
