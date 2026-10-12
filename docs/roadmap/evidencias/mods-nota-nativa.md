# Nota do MASTER pedida por mod: a prova da RM-059 (fatia F8)

Esta página responde se o diálogo nativo do Claude Code abre quando quem pede a nota do MASTER é um mod. O Ritual do MASTER (`ork-ritual`) chama `ork_request_master_note` por `$.mcp.call`, só com o `threadId`; o núcleo pede ao host um formulário (elicitation do MCP) com a nota de 0 a 5 e o porquê, e grava o MASTER com `avaliadoPor` `dono (dialogo nativo)`, o canal `claude-code` e o recibo assinado do ingresso local. Os tipos do Claude Code 2.1.296 dizem que a chamada do plugin é a concessão ("No permission prompt: the plugin's call, seen by the hooks above it, is the grant") e não dizem se a elicitation dessa chamada chega ao diálogo. Só uma sessão interativa do dono responde, e a sessão de fase que escreveu esta página não abre uma. É o mesmo elo que a [prova da Mesa](mods-dialogo-nativo.md) espera.

Veredito: pendente do dono

## O que já foi medido

| O quê | Como | Resultado |
| --- | --- | --- |
| O roteiro prepara a cópia | `node core/scripts/prova-ritual-nota-nativa.cjs --ensaio` | cópia fora do repositório, uma thread #Auto entregue e aceita por omissão, veredito pendente, cópia apagada |
| O servidor oferece a ferramenta e pede o formulário | teste `core/test/master-nota-local.test.ts`, com um cliente MCP sintético em memória no papel do host | a ferramenta existe só no servidor do dono; sem formulário no cliente, recusa `master.nota.sem-dialogo` sem gravar nada; recusa e cancelamento não gravam nota |
| A nota aceita vai ao MASTER com recibo | o mesmo teste | `master_done` com `autorizadoPor` `dono (dialogo nativo)`, o canal `claude-code`, o pedido de nota do `ork master pedir` e o recibo em `hitl-ingress-local/`; o aceite por omissão e o Telegram não a trocam |
| O `--conferir` lê o recibo certo | teste `core/test/prova-ritual-nota-nativa.test.ts` | separa a nota com recibo conferido, o recibo adulterado, o diálogo fechado sem nota e o nada |
| O Ritual manda só o `threadId` | testes do kit do Ritual e a varredura do fonte em `core/test/ork-ritual.test.ts` | `ork_request_master_note` com exatamente `{ threadId }`; nenhum argv de `ork master` com nota |

O cliente sintético prova o lado do núcleo e o roteiro. O que falta é o elo do host: a elicitation que nasce de uma chamada de `$.mcp.call` aparecer como diálogo nativo para o dono.

## Como rodar a prova

1. Prepare a cópia (pasta temporária nova, fora do repositório; o roteiro nunca lê nem grava o `.orkastery/` do projeto):

   ```bash
   npm --prefix core run build
   node core/scripts/prova-ritual-nota-nativa.cjs --preparar
   ```

2. Rode, num terminal seu, o comando que o roteiro imprime. Ele abre o `claude` na pasta da cópia, com a ponte e o Ritual por `--plugin-dir`, `--strict-mcp-config` e um `--mcp-config` só com o servidor `orkastery` da cópia, tira do ambiente `ORK_DISPATCH_ID`, `ORK_DISPATCH_THREAD`, `ORK_PROJETO` e `ORK_PROJETO_EXPLICITO` e desliga a publicação em segundo plano que o MASTER dispara (`ORK_FABRICA_PUBLICAR=0` e `ORK_REDE_PUBLICAR=0`, na sessão e no servidor da cópia): a cópia nunca é publicada na fábrica nem na sua rede. Aceite a confiança na pasta se o Claude Code pedir.
3. Na sessão, rode `/nota`, aperte Dar a nota no cartão da entrega e dê a nota e o porquê no diálogo, se ele aparecer. Use só o botão: não peça ao modelo que chame a ferramenta, porque o ledger não diz quem a chamou, e a prova é a do pedido vindo do Ritual.
4. Confira o ledger da cópia:

   ```bash
   node core/scripts/prova-ritual-nota-nativa.cjs --conferir <pasta da cópia>
   ```

O `--conferir` imprime a linha de veredito para trocar a de cima. Ele separa quatro casos: o `master_done` com `autorizadoPor` `dono (dialogo nativo)` pelo canal `claude-code` e o recibo conferido (o diálogo abriu e gravou); a nota com essa identidade e o recibo que não confere (anote o que viu); só o pedido de nota (o diálogo foi pedido e fechou sem nota: repita respondendo); e nada (o diálogo não foi pedido, ou o pedido não chegou ao núcleo).

## O que muda com cada resposta

| Resposta | Efeito |
| --- | --- |
| O diálogo abre e grava a nota com o recibo | O Ritual fica como está: Dar a nota pede o diálogo, e o Telegram segue como reserva |
| O diálogo não abre (o Dar a nota espera até o teto de 310 s e volta sem nota) | O botão Dar a nota sai do Ritual num commit pequeno; o cartão fica com a reserva (Pelo Telegram, que mostra o código do `ork master pedir`) |

## Para completar

O dono roda os passos acima, troca a linha do veredito pela que o `--conferir` imprimiu, com o build do Claude Code, e anota aqui a data e o que viu no diálogo.
