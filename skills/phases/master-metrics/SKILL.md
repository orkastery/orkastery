---
name: master-metrics
description: "Fase MASTER (F6): POSTMORTEM tipado, MASTER log no contrato congelado ork.master-log/v1 e o score humano de 0 a 5 com justificativa. Roteia para ork master e ork master <thread> --aceitar-omissao."
bucket: phases
roteia: "ork master <thread> --score N --justificativa \"...\" | ork master <thread> --aceitar-omissao"
license: MIT
---

# MASTER, fechamento e score

## O que esta skill e

Um roteador fino da fase MASTER. Ela nao inventa numero, nao arredonda score e nao fecha thread
sem humano: ela chama `ork master`, que valida contra o contrato congelado e recusa o que nao
cumpre. **Uma entrega sem MASTER log nao aconteceu.**

## Como rotear

```bash
ork master classes                            # as classes de falha do catalogo fixo
ork master <thread> --score 4 --justificativa "<texto>" --classe base-avancou --por <quem>
ork master                                    # as entregas, com o indice derivado do ledger
ork master --todas                            # inclusive as ja pontuadas
ork master <thread> --aceitar-omissao         # aceita so a entrega desta thread, com indice e insumos no ledger
ork master --aceitar-omissao --dry-run        # lista o que a forma sem thread fecharia, sem gravar
```

Agente fecha so a propria thread: `ork master <thread> --aceitar-omissao`. Sem a thread, o comando
aceita TODAS as entregues do projeto, inclusive as de outras frentes paralelas (o que aconteceu tres
vezes em 03/10/2026); de processo de agente com mais de uma, o `ork` avisa em stderr.

## O que o MASTER entrega

1. **POSTMORTEM tipado**, com as fases percorridas, o que falhou e a classe de falha vinda de um
   catalogo fixo: `sem-falha`, `erro-de-spec`, `base-avancou`, `conflito`, `rate-limit`, `modelo`,
   `processo`, `scope-creep`, `outra`. Classe inventada e recusada pelo comando.
2. **MASTER log no contrato `ork.master-log/v1`**, congelado: mudar o contrato sem mudar a versao
   e reprovado, porque contrato de telemetria e contrato publico.
3. **Score humano inteiro de 0 a 5, com justificativa nao vazia.** O score e do humano, sempre. Nos
   modos sem pausa de MASTER a entrega e aceita por omissao, com o indice derivado do ledger, que
   nenhum agente digita; a nota humana, quando vier, sobrescreve.
4. **Evidencia apontando o ledger e o POSTMORTEM**, com contagem de eventos, sessoes e claims. Log
   sem evidencia e recusado.

## O que o nucleo verifica por voce

`ork master` recusa e **nao grava nada** quando o score esta fora de 0 a 5, quando a justificativa
esta vazia, quando a classe esta fora do catalogo, quando uma fase esta fora do ciclo canonico,
quando o contrato foi trocado sem trocar a versao e quando falta evidencia. Recusa parcial que
grava metade e pior que recusa inteira.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Score 5 porque entregou, justificativa depois" | Justificativa vazia e recusada pelo comando. Score sem razao escrita nao ensina nada a thread seguinte. |
| "Dou 4,5, ficou entre os dois" | O score e inteiro de 0 a 5. Escala com meio ponto vira negociacao, e o que se mede aqui e conducao, nao simpatia. |
| "A classe de falha dessa foi 'quase deu certo'" | O catalogo e fixo. Classe inventada e recusada, porque classe livre destroi a comparabilidade entre threads. |
| "Preencho o MASTER log depois, a entrega ja foi" | Uma entrega sem MASTER log nao aconteceu. Fase de aprendizado adiada e fase de aprendizado que nao existe. |
| "O modo e `#Auto`, entao o score pode ser automatico" | O score e humano em todos os modos. `#Auto` muda quando ele e dado (a entrega e aceita por omissao e a nota humana sobrescreve), nunca quem da. |

## Bandeiras vermelhas

- Thread entregue sem `master-log.json`.
- Score gravado sem nome de quem avaliou.
- Classe de falha fora do catalogo fixo, ou nenhuma classe numa thread que teve retrabalho.
- Nota de score digitada por agente em nome do humano.

## Verificacao antes de sair da fase

POSTMORTEM tipado gravado, MASTER log valido contra `ork.master-log/v1`, score inteiro com
justificativa e avaliador, e evidencia apontando ledger e POSTMORTEM. Ver `DoD 16`.
