---
name: ship-release
description: "Fase SHIP (F5): merge serializado por lease, atualizacao contra a base, push provado por comando e plano de rollback. Roteia para ork ship, que so entrega com push verificado no remoto."
bucket: phases
roteia: "ork ship <thread> --para <base>"
license: MIT
---

# SHIP, entrega

## O que esta skill e

Um roteador fino da fase SHIP. Ela nao faz merge na mao, nao empurra branch por fora e nao decide
sozinha que o push pode acontecer: ela chama `ork ship`, que serializa o merge por lease e **prova
o push comparando o sha local com o que o remoto reporta**.

## Como rotear

```bash
ork worktree sync <thread>                  # rebasa quando a base avancou
ork ship <thread> --para main --dry-run     # ensaio: mostra tudo, nao toca em nada
# autorizacao humana registrada: vai no proprio ship, com o nome de quem autorizou
ork ship <thread> --para main --autorizar-push <quem>
ork phase list <thread>                     # a prova: mergeSha, shaRemoto, pushVerificado
```

## O que o SHIP entrega

1. **Merge serializado.** O lease `main-tree` faz uma thread por vez tocar a arvore de destino; as
   outras entram em fila com posicao, em vez de disputarem o mesmo checkout.
2. **Atualizacao contra a base mais recente**, com revalidacao completa sempre que a atualizacao
   trouxe mudanca. Um veredito calculado antes da atualizacao descreve um diff que nao existe mais.
3. **Push provado por comando.** O `ork` compara o sha local com `git ls-remote` no remoto e grava
   `pushVerificado` no ledger. **Push relatado sem sha do remoto conta como push que nao aconteceu.**
4. **Guarda de contrato.** Nada no diff final muda contrato publico versionado sem decisao de
   classe 2 ratificada, e a guarda roda de novo depois da atualizacao contra a base.
5. **Plano de rollback**, escrito antes do merge, com o comando exato de reversao.

## O que o nucleo verifica por voce

A policy `push_direto_na_base` e bloqueante: origem igual ao destino, origem igual a branch base
do projeto, ou entrega sem delta com a base local a frente do remoto (o push publicaria commit que
nao passou por merge de thread) reprova antes de o `ork` tocar no remoto. O merge que o proprio
ship ja fez e nao chegou ao remoto (push recusado, `--sem-push`) nao conta: o ship repetido empurra.
Arvore de destino ocupada sai como `tree.blocked`; lease tomado por outra thread sai como
`lease.busy`.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Ja empurrei, deu certo" | Push provado por comando ou nao aconteceu. O sha do remoto e a evidencia; a sensacao de sucesso nao e. |
| "Mergeio direto na base, e um commit so" | Push direto na base e policy bloqueante. Entrega sai da branch da thread, sempre. |
| "A base andou mas o meu diff nao encosta nisso" | Atualize e revalide. Uma atualizacao pode trazer mudanca que toca contrato, e o veredito anterior descrevia outro diff. |
| "Rollback eu penso se der problema" | Plano de rollback escrito antes do merge, ou o plano vai ser escrito sob pressao, em producao quebrada. |
| "A fila esta lenta, faco o merge por fora" | Merge fora da fila e a colisao que a fila existe para impedir. Espere a posicao ou libere o lease com registro. |
| "O modo e `#Classic`, entao push nao precisa de autorizacao" | Precisa: a autorizacao e antecipada e **registrada** no ledger, nao dispensada. Modo afrouxa quando o humano fala, nunca se ele fala. |

## Bandeiras vermelhas

- Merge sem relatorio de CHECK com veredito PASSOU.
- Push sem `pushVerificado` no ledger.
- Guarda de contrato rodada so antes da atualizacao contra a base.
- Branch de thread ausente: a entrega saindo da propria base.
- Nenhum plano de rollback no artefato da fase.

## Verificacao antes de sair da fase

Base atualizada e revalidada, guarda de contrato reexecutada no diff final, merge pela fila do
lease, push com sha do remoto no ledger e plano de rollback escrito. Ver `DoD 12` a `DoD 15` e
`SEC 12`.
