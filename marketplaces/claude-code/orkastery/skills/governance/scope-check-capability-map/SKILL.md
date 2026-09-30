---
name: scope-check-capability-map
description: "Fase 0: antes de abrir a thread, confere se a demanda cabe no que o produto e no que a maquina conseguem fazer, e devolve o que falta em vez de comecar trabalho fadado a parar no meio."
bucket: governance
roteia: "ork_preflight | ork doctor --modo | ork board plan | ork thread new --dry-run"
license: MIT
---

# Scope Check e Capability Map

## O que esta skill e

Um roteador fino da fase 0. Ela roda antes do GOAL e responde uma pergunta so: **esta demanda cabe
no que existe hoje?** Se nao cabe, ela devolve o que falta, com nome, antes de qualquer thread
consumir janela de contexto.

## Como rotear

Primeiro resolva o modo pelo nucleo. Prefira `ork_preflight({modo})` no MCP do projeto;
sem essa ferramenta, use o CLI contextual abaixo. O resultado segue o setup canonico por bloco.

```bash
ork doctor --modo <modo>                   # preflight contextual do modo autorizado
ork board plan                            # capacidade ocupada e capacidade livre
ork thread new "<nome>" --mode <modo> --dry-run   # ensaio: slug, modo, blocos, sem gravar
```

O `ork doctor` sem modo e um diagnostico amplo opcional, com inventario global; nao substitui
o preflight contextual nem deve competir com ele como rota obrigatoria de despacho.

## O mapa de capacidade

1. **Capacidade de maquina.** Confira `prontoPrimeiroBloco` e os checks do bloco inicial; falha
   relevante bloqueia esse despacho. `prontoTodosBlocos` informa dependencias dos blocos futuros:
   anuncie essas limitacoes sem confundi-las com impedimento do bloco inicial. A sonda nao comprova
   autenticacao, modelo aceito, gates ou entrega; o despacho revalida esses contratos. VERIFY/SHIP
   MCP dependem tambem do executor Codex isolado e do transporte de entrega, mesmo com fase Claude.
2. **Capacidade de paralelismo.** Threads ativas contra `concurrency.max_parallel_threads`, mais os
   leases que ja estao tomados na regiao que a demanda vai tocar.
3. **Capacidade de produto.** O que a demanda pede existe no produto, ou e capacidade nova. Se e
   nova, isso e dito no scope check e nao descoberto no GO.
4. **Capacidade de decisao.** A demanda depende de decisao que so o humano toma? Entao ela nasce
   com o gate previsto, nao com uma surpresa no meio.

## O contrato de devolucao

Quando a demanda nao cabe, a devolucao **nomeia o que falta e o que destravaria**, em uma linha
cada. Devolver "nao da" sem o que falta e recusa, nao scope check.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Comeco e vejo no caminho o que falta" | Descobrir a falta no GO custa a thread inteira. O scope check custa um comando. |
| "Ignoro qualquer fail porque escolhi Auto" | Falha relevante no preflight do bloco inicial bloqueia o despacho; Auto nao remove verificacao. Dependencia de bloco futuro deve ser informada como futura. |
| "Cabe mais uma thread, dou conta" | Quem da conta e a maquina e o humano que aprova gate, e os dois tem teto medido no manifesto. |
| "A demanda e vaga, o GOAL esclarece" | GOAL esclarece objetivo, nao existencia de capacidade. Demanda que pede o que nao existe volta antes, com o que falta escrito. |

## Bandeiras vermelhas

- Despacho iniciado com `prontoPrimeiroBloco` falso ou falha relevante do bloco inicial.
- Demanda que pede capacidade inexistente sem isso estar escrito.
- Regiao de arquivos ja sob lease de outra thread, sem fila prevista.
- Devolucao sem dizer o que destravaria a demanda.

## Verificacao antes de abrir a thread

Preflight contextual lido por bloco, dependencias futuras explicadas, capacidade de paralelismo
conferida, capacidade de produto confirmada ou declarada
ausente, gates humanos previstos, e ensaio com `--dry-run` mostrando slug, modo e blocos. Ver
`DoD 17`.
