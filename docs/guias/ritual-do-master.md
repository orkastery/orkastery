# Ritual do MASTER

> **Em uma frase:** as entregas que esperam a sua nota aparecem na sua sessão do Claude Code com a prova de cada uma, e você dá a nota de 0 a 5 com o porquê pelo diálogo nativo do host; o mod só mostra e encaminha, e quem grava a nota, com recibo, é o núcleo.

Use este guia se a maior parte das suas entregas fecha por omissão porque dar a nota pede sair do terminal, ou se você quer ver a prova antes de pontuar.

## O que o Ritual mostra

Com o mod `ork-ritual` ligado na sua sessão (papel `dono`), `/nota` abre um painel com as entregas dos últimos 7 dias que esperam a sua nota:

- sem MASTER ainda;
- com uma proposta da fábrica esperando a sua nota;
- aceitas por omissão. O condutor aceita por omissão logo depois do SHIP; a sua nota sobrescreve, e o registro da omissão continua no ledger.

Cada entrega é um cartão, com o ponto de HITL "espera sua nota":

| Linha | O que diz |
| --- | --- |
| Entrega | a thread, a hora local do `ship_done` e o merge |
| Situação | sem nota, proposta esperando você, ou aceita por omissão com a nota que o índice deu |
| Índice | o índice derivado do ledger, de 0 a 5, com as parcelas que o descontaram (GO-FIX, CHECK refeito, ship barrado, reversão); quem prova é o `ork master` |
| POSTMORTEM | as classes de falha registradas e as reprovações tipadas; sem MASTER, o POSTMORTEM nasce no fechamento |

A faixa acima do prompt resume ("3 entregas esperam a sua nota: ork-a, ork-b, ork-c · /nota"). A Torre de Controle abre o Ritual pelo botão do MASTER de uma thread: `/nota <thread>` abre direto na prova dela. A entrega mais velha que a janela fica num aviso com a contagem; `ork master` lista todas.

## A prova

"Ver a prova" percorre as claims da thread uma por vez, com Anterior e Próxima: o id, o estado registrado pelo núcleo com glifo e rótulo (✓ verificada, × reprovada, · pendente, ? não verificável), o arquivo, a alegação e os comandos que a conferem. As claims retiradas ficam de fora e aparecem só na contagem. A saída dos comandos nunca aparece: o Ritual mostra o que o núcleo registrou, e `ork claims list <thread>` diz o mesmo no terminal.

## Dar a nota

"Dar a nota" pede ao núcleo o diálogo nativo do host, pela ferramenta `ork_request_master_note`, só com o id da thread. O formulário tem a nota (de 5 a 0) e o porquê (de 3 a 1000 caracteres), os dois obrigatórios. Respondido, o núcleo grava o MASTER com `avaliadoPor` `mcp-local:claude-code` e o recibo assinado do ingresso local em `.orkastery/threads/<thread>/hitl-ingress-local/`, e a entrega sai da lista. Fechado sem resposta, nada é gravado e a entrega segue esperando.

A nota pelo diálogo vale como nota humana em toda leitura, só com o recibo conferido. Depois dela, `ork master --aceitar-omissao` não a troca, e a resposta pelo Telegram ao código da mesma entrega também não. Com nota humana dada antes por outro caminho, o botão diz que ela já existia e não abre diálogo.

Quando o diálogo não serve (o cliente MCP não abre formulário, o núcleo da sessão ainda não tem a ferramenta, ou o núcleo recusou), o cartão mostra a reserva: "Pelo Telegram" roda `ork master pedir <thread> --formato json` e mostra o código. Responda pelo Telegram com `<código> <0 a 5> <porquê>`, como sempre. O pedido só sai no seu clique.

A prova de que o diálogo nativo abre quando o pedido vem de um mod está pendente do dono: o roteiro está em [mods-nota-nativa](../roadmap/evidencias/mods-nota-nativa.md).

## O que o Ritual nunca faz

- Dar a nota pelo dono. O botão não leva nota nem porquê, e o mod não roda `ork master` com nota no argv: a guarda da ponte recusa.
- Ler `.orkastery/` por conta própria. As entregas vêm do retrato do núcleo pela ponte (`ork-ponte`, seção `master`), e as claims do `ork_claims_list`.
- Repetir o que você já viu. O que o painel à vista mostrou, inclusive o código do Telegram, entra no registro da ponte (`ork.mod-mostrado/v1`).

## O limite do recibo

O recibo da nota prova o caminho (esta conexão MCP, esta solicitação, esta nota), não a pessoa. A chave que assina o recibo é legível pelo mesmo usuário do sistema, então quem já roda como ele consegue forjar um recibo. É a mesma fronteira do gate respondido pelo diálogo nativo.

## Como ligar

O Ritual depende da ponte. Num projeto com o adaptador instalado:

```bash
claude --plugin-dir .claude/plugins/orkastery/mods/ork-ponte --plugin-dir .claude/plugins/orkastery/mods/ork-ritual
```

Pelo marketplace do repositório, instale os dois no escopo do projeto:

```bash
claude plugin install ork-ponte@orkastery --scope project
claude plugin install ork-ritual@orkastery --scope project
```

## O que o núcleo oferece

- `ork_request_master_note` (MCP, só no servidor do dono, nunca no de uma thread): recebe só o `threadId`. Devolve `{ ok, threadId, estado, repetida, score }`: `registrada` com a nota dada agora, `registrada` com `repetida` quando já havia nota humana, ou `pendente` quando o diálogo fechou sem nota. Sem formulário no cliente, recusa com `master.nota.sem-dialogo` antes de qualquer escrita.
- A seção `master` do retrato (`ork maestro --json --section master`) traz, por entrega, o regime da nota, o índice derivado do ledger com as parcelas, as reprovações tipadas, as classes do MASTER log e a entrega (`deliveredAt`, `deliveredAtLocal` e `deliveredSha`).

## Como conferir

- `ork master` mostra as entregas com o índice, e as aceitas por omissão.
- O ledger da thread (`.orkastery/threads/<thread>/ledger.jsonl`) tem o `master_done` da nota, com `autorizadoPor` `mcp-local:claude-code`, o pedido de nota e a evidência do recibo.
