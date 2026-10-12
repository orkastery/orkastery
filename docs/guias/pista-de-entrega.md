# Pista de Entrega

> **Em uma frase:** do CHECK verde ao merge, cada entrega vira uma pista na sua sessão do Claude Code, com a prova de cada etapa e o próximo passo que o núcleo declara; a publicação da branch e do PR passa pelo `ork ship publicar`, só no modo que já autoriza o push.

Use este guia se você quer acompanhar as entregas sem sair do terminal, ou se mantém um condutor externo que hoje publica a branch e abre o PR por conta própria.

## O que a Pista mostra

Com o mod `ork-pista` ligado na sua sessão (papel `dono`), `/pista` abre um painel com uma pista por thread aberta que já está na entrega: passou do CHECK, publicou a branch, tem PR ou tem merge na base sem registro. Cada pista tem oito etapas, na ordem:

| Etapa | Feita quando |
| --- | --- |
| CHECK | o `docs/check.md` tem exatamente um veredito, PASSOU, gravado depois do último commit de produto (merge e `ci(` não contam) |
| verify | o último `ork verify` da thread passou no HEAD, ou num ancestral dele com só o bundle depois |
| bundle | o `.ork-ci/<thread>.json` está no HEAD, é desta branch e lista exatamente as claims ativas |
| branch | o `git ls-remote` do remoto devolve o HEAD da branch |
| PR | há PR aberto (ou mesclado) da branch |
| CI | o check `ork-verify` está verde no head do PR |
| conflito | o GitHub diz que o PR mergeia sem conflito com a base |
| entrega | o `ship_done` está no ledger |

Cada etapa que não está feita traz o texto do núcleo. Embaixo, o próximo passo: o que o núcleo diz que destrava a entrega, com o comando que resolve. A faixa acima do prompt resume o que pede você ("1 pronta para publicar · 1 pede o seu push · /pista"); o que só anda sozinho (CI rodando, PR esperando o merge) não entra nela.

A Torre de Controle abre a Pista pelo botão Entregar de uma thread: `/pista <thread>` põe a thread em foco no alto do painel.

## Os botões

Botão só aparece quando o núcleo declara a ação disponível no próximo passo da pista, e só para dois comandos:

| Botão | Aparece quando | O que roda |
| --- | --- | --- |
| Publicar | `acao: publicar` com `disponivel`, numa thread #Auto ou #Maestro | `ork ship publicar <thread> --json` |
| Registrar a entrega | `acao: registrar` com `disponivel` (o PR foi mesclado e falta o `ship_done`) | `ork ship registrar-pr <thread> --json` |

O clique relê a pista daquela thread antes de valer: se, entre o desenho e o clique, o núcleo deixou de declarar a ação (outra sessão passou a conduzir, um commit novo tirou o verify do HEAD), nada roda e a linha da pista diz o que mudou. Um clique por vez por thread: com o primeiro rodando, o botão some e a linha diz que está rodando. O resultado fica na pista: publicada com o PR e a prova do `ls-remote`, recusada com o motivo tipado e a correção do núcleo, ou a falha (o `ork` do PATH sem o comando, a ponte que recusou). Fora de #Auto e #Maestro não há botão de publicar: o próximo passo traz o comando para você rodar no seu terminal.

O argv sai sempre do mod, nunca do texto do JSON, e a ponte confere cada um contra a lista de autoridade dos mods.

## O que a Pista nunca faz

- Merge, tag ou promoção de site. O merge do PR verde continua com você ou com o condutor externo, e o `ship_done` vem do `ork ship registrar-pr`.
- Push fora do núcleo. A Pista não roda `git` nem `gh`: a publicação é o `ork ship publicar`, e a ponte recusa o resto.
- Agir pelo dono. Fora de #Auto e #Maestro, o push pede a sua autorização: a Pista mostra o comando para você rodar no seu terminal e não tem botão.

## O que o núcleo oferece

- `ork ship pista [<thread>] --json` (`ork.ship-pista/v1`): as oito etapas e o próximo passo de cada pista, com `acao` (`publicar`, `registrar` ou `null`), `disponivel` e `comando`. É uma leitura: um `git ls-remote --heads` do remoto e uma leitura dos PRs pelo `gh`, sem gravar nada.
- `ork ship publicar <thread> [--dry-run] [--json]` (`ork.ship-publicar/v1`): publica a branch e abre o PR, só em #Auto e #Maestro. Antes de qualquer efeito confere a thread aberta, ninguém conduzindo, a branch com produto, o CHECK, o verify e o bundle no HEAD, o remoto do GitHub e os PRs da branch; a recusa volta com motivo tipado e não grava nada. Empurra sem força, prova pelo `git ls-remote`, reaproveita o PR aberto ou abre um com o `.orkastery/threads/<thread>/pr-body.md` (título `ship(<thread>): ...`, do primeiro cabeçalho do corpo) e grava `ship_published` no ledger. Repetido, responde `ja-publicada`. Não aceita `--autorizar-push`.

A Pista lê o retrato do núcleo pela ponte (`ork-ponte`) para saber quando uma entrega andou, e relê a pista quando um ledger muda, a cada 5 min com o painel à vista e a cada 15 min escondido. O que o painel à vista mostrou entra no registro da ponte (`ork.mod-mostrado/v1`), para o Telegram não repetir.

A Pista roda o `ork` do seu PATH: se ele ainda não tem `ork ship pista`, o painel diz para atualizar o CLI.

## O que mudar no script do condutor externo

O condutor externo que publica a branch que só espera push (o caso `sem-push` do `ork pulse`) e abre o PR com o `gh` faz isso fora do núcleo e sem prova. Troque esse trecho pela pista e pelo `publicar`, que só publicam no modo que já autoriza o push e recusam com motivo tipado o que não está pronto. O script fica fora do repositório: a mudança é sua, ou de quem conduz a fábrica por você.

```bash
ork ship pista --json 2>/dev/null |
  jq -r '.pistas[] | select(.proximo.acao == "publicar" and .proximo.disponivel) | .thread' |
  while read -r t; do
    r=$(timeout 600 ork ship publicar "$t" --json 2>/dev/null) ||
      echo "- $t: $(echo "$r" | jq -r '.motivo + ": " + .detalhe')"
  done
```

Cada recusa sai com o motivo tipado e o detalhe do núcleo, para o aviso ao dono.

Gere e commite o bundle antes, como hoje (`ork ci prepare <thread>` e o commit `ci(<thread>): bundle`): sem ele, o `publicar` recusa com `artifact.missing`.

## Como conferir

- `ork ship pista` mostra as pistas no terminal, sem a sessão do Claude Code.
- `ork ship publicar <thread> --dry-run` confere tudo e diz o que faria, sem publicar nem gravar.
- O ledger da thread (`.orkastery/threads/<thread>/ledger.jsonl`) tem o `ship_published` de cada publicação, com a prova do `ls-remote` e o PR.
