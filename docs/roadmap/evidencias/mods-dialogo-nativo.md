# Diálogo nativo pedido por mod: a prova da RM-059 (T5.1)

Esta página responde se o diálogo nativo do Claude Code abre quando quem pede a decisão é um mod. A Mesa do Dono (`ork-mesa`) chama `ork_request_decision` por `$.mcp.call`, só com `threadId` e `pedidoId`; o núcleo abre o diálogo do host (elicitation do MCP, em formulário) e grava a resposta do dono com o recibo do ingresso local. Os tipos do Claude Code 2.1.296 dizem que a chamada do plugin é a concessão ("No permission prompt: the plugin's call, seen by the hooks above it, is the grant") e não dizem se a elicitation dessa chamada chega ao diálogo. Só uma sessão interativa do dono responde, e a sessão de fase que escreveu esta página não abre uma.

Veredito: pendente do dono

## O que já foi medido

| O quê | Como | Resultado |
| --- | --- | --- |
| O roteiro prepara a cópia e a pergunta de teste | `node core/scripts/prova-mods-dialogo-nativo.cjs --ensaio` | cópia fora do repositório, pergunta `ork.hitl/v2` com 3 alternativas aberta pelo próprio núcleo (`abrirPedidoGate`), veredito pendente |
| O servidor da cópia oferece o canal e pede o formulário | teste `core/test/ork-mesa-prova.test.ts`, com um cliente MCP sintético em memória no papel do host | `ork_hitl_pending` traz o canal `claude-code` disponível; `ork_request_decision` manda um pedido de formulário; recusado, nada é gravado como resposta |
| O `--conferir` lê o recibo certo | o mesmo teste, com o cliente sintético respondendo | `human_gate` com `autorizadoPor` `mcp-local:claude-code` |
| A Mesa manda só os dois ids | testes do kit da Mesa e varredura do fonte no teste `core/test/ork-mesa.test.ts` | `ork_request_decision` com exatamente `threadId` e `pedidoId` |

O cliente sintético prova o lado do núcleo e o roteiro. O que falta é o elo do host: a elicitation que nasce de uma chamada de `$.mcp.call` aparecer como diálogo nativo para o dono.

## Como rodar a prova

1. Prepare a cópia (pasta temporária nova, fora do repositório; o roteiro nunca lê nem grava o `.orkastery/` do projeto):

   ```bash
   npm --prefix core run build
   node core/scripts/prova-mods-dialogo-nativo.cjs --preparar
   ```

2. Rode, num terminal seu, o comando que o roteiro imprime. Ele abre o `claude` na pasta da cópia, com a ponte e a Mesa por `--plugin-dir`, `--strict-mcp-config` e um `--mcp-config` só com o servidor `orkastery` da cópia, e tira do ambiente `ORK_DISPATCH_ID`, `ORK_DISPATCH_THREAD`, `ORK_PROJETO` e `ORK_PROJETO_EXPLICITO`. Aceite a confiança na pasta se o Claude Code pedir.
3. Na sessão, rode `/mesa`, aperte Decidir no cartão do pedido de teste e responda no diálogo, se ele aparecer. Use só o botão: não peça ao modelo que decida, porque o ledger não diz quem chamou `ork_request_decision`, e a prova é a do pedido vindo da Mesa.
4. Confira o ledger da cópia:

   ```bash
   node core/scripts/prova-mods-dialogo-nativo.cjs --conferir <pasta da cópia>
   ```

O `--conferir` imprime a linha de veredito para trocar a de cima. Ele separa três casos: `human_gate` com `autorizadoPor` `mcp-local:claude-code` (o diálogo abriu e gravou); só `hitl_channel_selected` do canal `claude-code` (o diálogo foi pedido e fechou sem resposta: repita respondendo); e nada (o diálogo não foi pedido, ou o pedido não chegou ao núcleo).

## O que muda com cada resposta

| Resposta | Efeito |
| --- | --- |
| O diálogo abre e grava o recibo | A Mesa fica como está: Decidir pede o diálogo, e o Telegram segue como reserva |
| O diálogo não abre (o Decidir espera até o teto de 310 s e volta sem resposta) | O botão Decidir sai da Mesa num commit pequeno; o cartão fica com a reserva (o código e a letra pelo Telegram, ou o comando do pulse) |

## Para completar

O dono roda os passos acima, troca a linha do veredito pela que o `--conferir` imprimiu, com o build do Claude Code, e anota aqui a data e o que viu no diálogo.
