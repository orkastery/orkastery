# Registro de instabilidade e steal no verify (RM-037)

Contrato `ork.instabilidade/v1`, definido em `core/src/instabilidade.ts`, e os campos de steal do
`verify_run`, definidos em `core/src/steal.ts` e `core/src/verify.ts`. É a T15 do P6 da
[RM-037](../../roadmap/RM-037-verify-rapido-e-confiavel.md), na forma recomendada do item.

## O registro

Arquivo `core/instabilidade.json`, lido da árvore que o `ork verify` verifica (a worktree da thread).
Nasce vazio:

```json
{
  "contrato": "ork.instabilidade/v1",
  "entradas": []
}
```

Uma entrada diz que um teste depende do relógio e por isso reprova quando a máquina perde CPU para o
hipervisor. Ela só entra com a taxa **medida** e com revalidação em até 30 dias da medida:

```json
{
  "teste": "o sensor responde em menos de 2 s",
  "arquivo": "core/test/sensor.test.ts",
  "causa": "relogio",
  "taxa": {
    "falhas": 3,
    "rodadas": 20,
    "comando": "for i in $(seq 20); do node --test core/dist-test/test/sensor.test.js; done",
    "medidaEm": "2026-10-03"
  },
  "revalidarAte": "2026-11-02",
  "nota": "thread ork-exemplo"
}
```

| Campo | Regra |
| --- | --- |
| `teste` | O nome do teste como o runner reporta, o mesmo de `testeQueCaiu` no ledger. Sem repetição |
| `arquivo` | O arquivo do teste, relativo à raiz |
| `causa` | `relogio`, a única da v1 |
| `taxa.falhas`, `taxa.rodadas` | Inteiros medidos, `1 <= falhas <= rodadas` |
| `taxa.comando` | O comando que mediu, reproduzível |
| `taxa.medidaEm` | Data da medida, `AAAA-MM-DD` |
| `revalidarAte` | `AAAA-MM-DD`, de `taxa.medidaEm` até 30 dias depois. A entrada vale até o fim desse dia, em UTC |
| `nota` | Opcional, texto livre (thread, PR) |

Chave desconhecida, no registro, na entrada ou na taxa, é erro. Leitura:

- arquivo ausente vale registro vazio;
- JSON ilegível ou qualquer erro de contrato: **nenhuma** entrada vale, e os erros vão ao
  `verify_run` e ao texto do `ork verify` (`FORA DO CONTRATO, nenhuma entrada vale`);
- entrada vencida não vale até alguém medir de novo; o `verify_run` a lista em `vencidas`.

O registro nunca atenua uma falha sozinho. Ele só diz ao verify que o teste é de relógio; a
reprovação só deixa de ser regressão com o steal medido acima de 40% na janela do comando.

## O steal no `verify_run`

O `ork verify` (CLI e `ork_verify` do MCP) lê a linha agregada `cpu` do `/proc/stat` no início e no
fim da rodada e de cada comando (preparo, comandos das claims e do manifesto). O steal da janela é
`Δsteal / Δ(user + nice + system + idle + iowait + irq + softirq + steal)`, em porcentagem com uma
casa; `guest` já está em `user`.

```json
"steal": {
  "fonte": "/proc/stat",
  "medido": true,
  "rodadaPct": 71.4,
  "limiarPct": 40,
  "porComando": { "preparo": 68.2, "C1.1": 74.9, "test": 71.0 },
  "relogioSobSteal": ["test"]
}
```

| Campo | O que é |
| --- | --- |
| `medido` | `false` sem `/proc/stat` (macOS, Windows, container sem `/proc`) ou com janela vazia; aí nada é atenuado |
| `rodadaPct` | Steal da rodada inteira; `null` sem medida |
| `porComando` | Steal na janela de cada comando; `null` sem medida |
| `relogioSobSteal` | Os comandos cuja reprovação virou `verify.timeout` pelo steal |

Cada comando que falha leva, além de `causa`, `prazoMs`, `duracaoMs`, `testeQueCaiu` e `trecho`:
`stealPct` (o steal da janela dele) e, quando reclassificado, `relogioSobSteal` (os testes). A
`causa` continua a real (`exit`). Com o registro presente na árvore, o `verify_run` traz também
`instabilidade: {contrato, arquivo, vigentes, vencidas, erros}`.

## A reprovação sob steal

Um comando que falhou vira `verify.timeout` (sem veredito; o retry reexecuta), e nunca
`verify.regression`, `verify.failed` nem `claims.failed`, quando as três condições valem:

1. o steal na janela dele passou de 40% (estritamente);
2. o runner nomeou os testes que caíram;
3. **todos** eles são de relógio: a falha traz a assinatura de prazo do `node --test`
   (`testTimeoutFailure`, `test timed out after N ms`, ou `cancelledByParent`, `test did not finish
   before its parent and was cancelled`), ou o teste tem entrada vigente com `causa: relogio` no
   registro.

Asserção comum sob steal alto continua regressão. Comando sem teste nomeado (build, `tsc`, script)
nunca é reclassificado. A claim reclassificada não é carimbada `reprovado`: o estado anterior vale.

O `ork ci run` não mede steal nem reclassifica: o CI é o CHECK independente do merge e não ganha
atenuante.
