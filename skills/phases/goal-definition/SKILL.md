---
name: goal-definition
description: "Fase GOAL (F1): objetivo verificavel, exploracao do repositorio real, premissas explicitas, impact map, riscos e criterios de sucesso observaveis, tudo amarrado em claims com comando de verificacao. Roteia para ork phase run GOAL e ork claims add."
bucket: phases
roteia: "ork phase run <thread> GOAL | ork claims add"
license: MIT
---

# GOAL, definicao de objetivo

## O que esta skill e

Um roteador fino da fase GOAL. Ela nao explora o repositorio por conta propria e nao implementa
nada: ela despacha a fase pelo `ork` e transforma o resultado em claims que o `ork` reexecuta.
**GOAL nao implementa.**

## Como rotear

```bash
ork thread new "<nome>" --mode <modo>
ork phase run <thread> GOAL --prompt "<pedido do builder>"
ork claims add <thread> <arquivo> --claim "<alegacao>" --verificar "<comando>" --fase GOAL
ork verify <thread> --so-claims
ork gate request <thread>
```

## O que o GOAL entrega

1. **Objetivo em tres paragrafos, no minimo.** Mesmo uma correcao de uma linha ganha um GOAL de
   tres paragrafos: compacto quer dizer menor, nunca ausente.
2. **Exploracao do repositorio real.** A exploracao mira o repositorio de verdade, nao a memoria do
   modelo. Cite arquivos e trechos concretos ou a exploracao nao aconteceu.
3. **Premissas explicitas.** Premissa implicita e a maior fonte de retrabalho e e tratada como
   defeito de processo. Escrever a premissa custa uma linha; descobrir ela errada no GO custa a
   thread.
4. **Impact map.** O que muda, o que encosta e o que fica de fora, com o de fora escrito.
5. **Criterios de sucesso observaveis.** Latencia, cobertura, comportamento verificavel: nunca
   adjetivo. Numa demanda de correcao, reproduzir o defeito e criterio obrigatorio do GOAL.
6. **Riscos e ambiguidades**, cada um com o que faria ele virar bloqueio.

## O que o nucleo verifica por voce

Todo criterio de sucesso vira `ork claims add ... --verificar "<comando>"`, e `ork verify` reexecuta
o comando no HEAD real. Alegacao sem comando volta como `claims.unverifiable`; alegacao que reprova
volta como `claims.failed`, motivo tipado que reprova em qualquer modo.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Eu ja conheco esse framework, da para pular a exploracao" | A exploracao mira o repositorio real, nao a memoria do modelo. Sem arquivo e trecho citados, o GOAL e um resumo plausivel de um codigo que ninguem abriu. |
| "Listar premissa e burocracia, elas sao obvias" | Premissa implicita e a maior fonte de retrabalho. Obvio para quem escreve costuma ser surpresa no GO. |
| "O criterio e que funcione bem e o usuario goste" | Adjetivo nao e metrica. Criterio que nao vira comando nao gateia nada, e e no gate que a autonomia se perde. |
| "O repositorio esta vazio, nao ha o que explorar" | Explorar repositorio vazio tambem e explorar: escreva o que foi verificado ausente, ou a ausencia vira premissa implicita. |
| "O bug e obvio, nao preciso reproduzir antes" | Correcao cujo defeito nunca foi reproduzido nao prova que corrigiu nada. Reproduzir o defeito e criterio obrigatorio do GOAL. |

## Bandeiras vermelhas

- Um GOAL sem arquivo nem trecho citado do repositorio.
- Premissas ausentes, ou descobertas depois como surpresa durante o GO.
- Criterio de sucesso escrito com adjetivo.
- Demanda de correcao sem passo de reproducao do defeito.
- GOAL que ja traz codigo de implementacao: GOAL nao implementa.

## Verificacao antes de sair da fase

Objetivo com tres paragrafos, exploracao citando arquivos reais, premissas escritas, impact map com
o que fica de fora, criterios virados em claims com comando, e o gate de objetivo resolvido pelo
caminho que o modo exige. Ver `DoD 17` e `DoD 18`.
