---
name: roadmap-keeper
description: "Guardiao do roadmap: toda demanda entra registrada antes de virar thread, toda proposta de auditor vira item com origem, e nada some do escopo sem decisao registrada. Roteia para ork board e ork thread new."
bucket: governance
roteia: "ork board | ork board plan | ork thread new"
license: MIT
---

# Roadmap Keeper

## O que esta skill e

Um roteador fino entre a demanda e a thread. Ela nao prioriza no lugar do humano: ela garante que
toda demanda esteja escrita antes de virar trabalho, com origem, e que nada saia do escopo em
silencio. **Demanda que vira thread sem estar registrada e trabalho sem dono e sem historia.**

## Como rotear

```bash
ork board                       # o estado de todas as threads
ork board plan                  # quem avanca agora, quem espera e por que
ork thread new "<nome>" --mode <modo>
ork master                      # as entregas, com o indice derivado do ledger
```

## Conduta

1. **Registrar antes de abrir.** A demanda entra com titulo, origem e o problema que resolve, e so
   entao vira `ork thread new`.
2. **Origem sempre.** Pedido do builder, achado de auditor, licao de MASTER log: quem pediu fica
   escrito. Item sem origem nao sabe por que existe e nao sabe quando morrer.
3. **Proposta de auditor entra como proposta**, nunca como correcao ja aplicada. O auditor le, o
   roadmap decide.
4. **Item que sai do escopo sai com decisao registrada**, com quem decidiu e por que. Escopo que
   encolhe em silencio e escopo que reaparece como surpresa.
5. **A capacidade da maquina limita o quadro.** `concurrency.max_parallel_threads` no manifesto e o
   teto real; roadmap que ignora o teto vira fila disfarcada de plano.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Abro a thread agora e registro depois" | Registrar depois e registrar do jeito que a memoria contar. A demanda entra escrita, com origem, antes de virar trabalho. |
| "Esse item obviamente saiu do escopo" | Obvio para quem estava na conversa. Saida de escopo e decisao registrada, ou vira surpresa na entrega seguinte. |
| "O auditor achou, ja corrijo direto" | Auditor propoe, roadmap decide. Correcao aplicada direto por auditor e mudanca sem dono e sem gate. |
| "Cabe mais uma thread em paralelo, e pequena" | O teto e o do manifesto, medido, nao o do otimismo. Acima dele as threads competem por arvore e por atencao humana. |
| "Isso e obviamente prioridade, nem precisa perguntar" | Prioridade e decisao de classe 1, do humano. O roadmap organiza a escolha; ele nao faz a escolha. |

## Bandeiras vermelhas

- Thread aberta sem item de roadmap correspondente.
- Item sem origem escrita.
- Achado de auditor aplicado como correcao direta.
- Escopo reduzido sem registro de quem decidiu.
- Numero de threads ativas acima do teto do manifesto.

## Verificacao antes de sair da skill

Demanda registrada com origem, teto de paralelismo respeitado, propostas de auditor tratadas como
propostas, e toda mudanca de escopo com decisao registrada. Ver `DoD 20` e `REVIEW 11`.
