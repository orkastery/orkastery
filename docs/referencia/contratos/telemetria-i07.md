# Telemetria econômica do ledger (I-07)

O comando `ork ledger stats --desde 7d` transforma fatos já registrados no ledger em métricas operacionais e econômicas. O intervalo é sempre semiaberto, `[desde,ate)`, em UTC. Os filtros opcionais são `--thread`, `--modo` e `--runtime`; `--json` expõe o contrato `ork.ledger-stats/v1`.

O agregador conta apenas `phase_result` como término de sessão e elimina replays pelo `sensorResultId`. Tokens, duração e custo têm cobertura explícita. Ausência de medição permanece ausência: ela não vira zero. `cachedInput` já faz parte de `input`, portanto `uncachedInput = input - cachedInput`.

`custoReferencia` é uma estimativa em USD calculada com a tabela pública auditada em `core/assets/reference-tariffs-i07.json`. Ela serve para comparar cenários; não representa gasto, fatura nem preço efetivo de assinatura. Sessões sem modelo tarifado ficam em `sessoesSemTarifa` e fora do valor.

Throughput usa `ship_done`; lead time vai de `thread_created` a `ship_done`; espera humana pareia `gate_blocked` com motivo `human.pending` ao `human_gate`, recortando o período consultado. Riscos preventivos contam somente gates com motivos conservadores e tipados. Linhas corrompidas são ignoradas e declaradas em `qualidade`.

`hitlDeConducao` mede o tempo parado por HITL de condução ([RM-057](../../roadmap/RM-057-hitl-por-alternativas.md)): cada pergunta `ork.hitl/v2` que o ork abriu (`hitl_requested`, classe `pergunta`) espera do `criadoEm` até a primeira resposta (`human_gate` ou `session_answered`), o prazo de quem segue a recomendada, um pedido novo para o mesmo alvo ou o fechamento da thread, o que vier primeiro. O campo traz `pedidos`, `respondidos`, `semResposta`, `abertos`, `paradoMs` (recortado ao período), `medianaRespostaMs` e `maiorRespostaMs` (só das respondidas), a meta de 5 min com `dentroDaMeta` (`null` sem amostra) e `emTexto`, que separa a resposta em texto pela dependência técnica tipada da que veio fora da exceção. Decisão informada não para nada e fica fora. O "confirmo" pedido na conversa, fora do ork, não chega ao ledger: quem o barra é a regra dos adaptadores e o canário `fx-pedido-colado`.

No PLAN, o responsável pode registrar dois contrafactuais:

```sh
ork ledger estimate <thread> \
  --sem-ia 40 --ia-sem-ork 18 \
  --por maestro --metodo "estimativa por tarefas" \
  --premissas "escopo fechado e equipe atual" --incerteza "+/- 25%"
```

Esses valores são estimativas declaradas, com autor, método, premissas, unidade e HEAD. O Orkastery não os apresenta como horas medidas.
