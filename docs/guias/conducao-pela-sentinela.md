# Condução pela Sentinela

> **Em uma frase:** com a sessão do dono aberta no Claude Code e o mod `ork-sentinela` ligado, é a Sentinela que despacha a fase seguinte das threads #Auto; o condutor externo cede e volta sozinho quando a sessão fecha.

Use este guia se você mantém um condutor externo (por exemplo, um cron no gateway do Hermes que despacha as fases #Auto) e vai ligar a Sentinela do Condutor na sua sessão. O script do condutor externo fica fora do repositório: a mudança abaixo é sua, ou de quem conduz a fábrica por você.

## Quem conduz quando

| Situação | Despacho da fase seguinte e retry | Publicação, merge e avisos do Telegram |
| --- | --- | --- |
| Sessão do dono aberta, Sentinela ligada e não pausada | a Sentinela | o condutor externo |
| Sentinela pausada (`/sentinela pausar`) | o condutor externo | o condutor externo |
| Sessão do dono fechada (a presença vence 3 min depois da última batida) | o condutor externo | o condutor externo |

A Sentinela não publica branch, não abre nem mergeia PR e não manda mensagem pelo Telegram. O Telegram continua: o que a Sentinela mostrou no terminal fica no registro da ponte (`ork.mod-mostrado/v1`).

## O que o núcleo oferece

- `ork conducao sentinela status --json` responde no contrato `ork.conducao-sentinela/v1`:
  - `presenca`: a Sentinela desta máquina, com `ativa`, `canal` (sempre `claude-code`), `sessao`, `desde`, `batidaEm` e `expiraEm`, ou `null`;
  - `threads`: o passo do condutor em cada thread aberta, calculado pelo núcleo (`acao`: `despachar`, `retomar`, `avisar` ou `nada`; `fase`; `caso` e `proximoPasso` do pulse, sem o limiar de 30 min; `porque`).
- `ork conducao sentinela bater --sessao <id>` e `ork conducao sentinela desligar --sessao <id>`: a batida e o desligamento, que o mod faz sozinho. Uma Sentinela por máquina: com outra sessão viva, a batida sai 3 e não toma o lugar dela.
- `sentinela_ligada` e `sentinela_desligada` no ledger do projeto (`.orkastery/ledger.jsonl`), só na troca.
- O despacho da Sentinela sai por `ork phase run` com `--canal claude-code` e `--correlacao sentinela:<sessao>`: o `phase_dispatch` mostra de onde veio.

## O que mudar no script do condutor externo

1. Uma vez por rodada, antes do laço de despacho, leia a presença:

   ```bash
   SENTINELA=0
   if timeout 30 ork conducao sentinela status --json 2>/dev/null | jq -e '.presenca.ativa == true' >/dev/null; then
     SENTINELA=1
   fi
   ```

2. No laço que despacha a fase seguinte e roda `ork retry run` das threads #Auto, ceda enquanto ela conduz:

   ```bash
   [ "$SENTINELA" = 1 ] && continue
   ```

3. Deixe como estão a publicação da branch que só espera push, o merge do PR verde e os avisos ao dono.

Sem presença viva, o condutor externo conduz como antes, nas horas sem a sessão do dono.

O condutor externo do próprio `ork` é a batida da condução (`ork conducao batida`, RM-063), que a varredura do cron roda
depois do resumo: ela já lê a presença e cede o despacho e o retry enquanto a Sentinela conduz, e segue com o merge do
PR verde, o registro da entrega e o MASTER por omissão, dentro da autorização durável do dono. Com ela no cron, o script
de fora deixa de ser necessário.

## Por que não há despacho duplicado

Os dois condutores despacham só pelo núcleo. O `ork phase run` toma a condução da thread (`exec:<thread>`) sob uma trava do kernel:

- dois pedidos no mesmo instante: um despacha e o outro sai com `HITL ocupado`, sem sessão nova;
- pedido com a thread já conduzida: sai 3 com `conducao.em-andamento` e grava `conducao_recusada`;
- o mesmo pedido de quem já conduz: grava `despacho_idempotente` e devolve a sessão em andamento.

A Sentinela ainda relê a condução logo antes de despachar, nunca usa `ork conducao assumir` e guarda o turno que já despachou.

## A regra da fase seguinte

A Sentinela não decide a fase sozinha: segue o `threads[].acao` do núcleo. No #Auto, depois de uma fase concluída, sai a fase seguinte à prova mais adiantada que a sessão do bloco deixou: o artefato da fase (`goal.md`, `plan.md`, `check.md`) gravado depois do despacho, o produto na branch (houve GO) ou o `ship_done` e o `master_done`. Se o bloco já passou do CHECK, nada sai: o passo é o da entrega, com o condutor externo e o dono. O CHECK que terminou sem exatamente um veredito é redespachado, e o despacho que falhou antes de abrir sessão vai ao `ork retry plan`. Pendência do dono (thread pausada, pergunta aberta, escalação) segura qualquer passo. Sem pedido guardado na criação da thread (`ork thread new --pedido`), a Sentinela não despacha e avisa.

Recusa que passa (outro condutor, projeto sem vaga, pedido aberto, falha) não queima o turno: a Sentinela tenta de novo depois de 3 min, e a mesma recusa seguida dobra a espera até 30 min. Só o despacho feito, ou o pedido repetido de quem já conduz, fica de vez.

Se o seu condutor externo despacha pela última linha do ledger, ele pode repetir uma fase que a sessão do bloco já fez. Ler `threads[].acao` do mesmo status evita isso; a troca é sua.

## Como conferir

- `ork conducao sentinela status` diz se a Sentinela está ligada nesta máquina e o passo de cada thread.
- `ork phase list <thread>` mostra o despacho com o canal `claude-code`.
- Na sessão do dono, `/sentinela` mostra o diário do que ela despachou, cedeu e avisou.
