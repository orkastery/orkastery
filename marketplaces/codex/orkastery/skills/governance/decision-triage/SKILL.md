---
name: decision-triage
description: "A disciplina de delegacao: classifica cada decisao em classe 1 (humano decide), 2 (contrato publico, exige ratificacao) ou 3 (delegada, registrada), e sobe tradeoff real com opcoes e uma recomendacao. Roteia para ork gate request."
bucket: governance
roteia: "ork gate request <thread>"
license: MIT
---

# Decision Triage

## O que esta skill e

Um roteador fino da disciplina de delegacao. Ela nao decide pelo humano e nao esconde decisao
atras de "detalhe tecnico": ela classifica, registra o que e delegado e sobe o que e do humano.
**Decisao delegada sem registro e decisao perdida.**

## As tres classes

| Classe | Quem decide | O que exige |
|---|---|---|
| 1 | O humano, sempre | Tradeoff de produto, risco de negocio, prioridade, escopo, dinheiro |
| 2 | O humano, com ratificacao registrada | Mudanca de contrato publico versionado: schema, tipos de evento, layout de estado, interface |
| 3 | Delegada ao agente | Escolha interna sem efeito observavel fora do modulo, registrada no ledger quando relevante |

## Como rotear

```bash
ork gate request <thread>    # abre o pedido; o humano responde pelo canal autenticado
ork phase list <thread>      # a auditoria de delegacao le daqui
```

## Conduta

1. **Classificar antes de agir**, nao depois de ter agido.
2. **Subir tradeoff com opcoes e exatamente uma recomendacao.** Subir sem recomendacao empurra o
   trabalho de volta ao humano; subir sem opcoes pede assinatura, nao decisao.
3. **Registrar a classe 3 relevante.** O qualificador carrega peso: formatacao e nome interno
   tambem sao classe 3, e exigir evento para cada um deles e escalacao indevida.
4. **Auditar os dois lados com peso igual.** Subclassificar (tratar decisao de produto como
   detalhe tecnico) e escalar indevidamente (pedir aval para trivialidade) sao defeitos do mesmo
   tamanho, e a auditoria de CHECK caca os dois.
5. **Decisao fechada trava.** Reabrir e decisao nova, com registro proprio, nunca edicao silenciosa.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Isso e detalhe tecnico, decido sozinho" | Se muda o que o usuario ve, o que o produto promete ou o que custa dinheiro, e classe 1. Subclassificar e a forma educada de decidir pelo humano. |
| "Pergunto tudo, assim ninguem reclama" | Escalacao indevida e defeito de igual peso. Quem pergunta tudo transfere o trabalho e some com a delegacao. |
| "Subo a duvida e o humano escolhe" | Sem opcoes e sem uma recomendacao, isso e transferir o problema. Traga o mapa e diga por onde ir. |
| "Mudo o schema, e compativel na pratica" | Contrato publico versionado e classe 2: exige ratificacao registrada antes do merge, mesmo quando parece compativel. |
| "A decisao mudou, atualizo o texto antigo" | Decisao fechada trava. Reabertura e decisao nova com registro; editar a antiga apaga a razao da primeira. |

## Bandeiras vermelhas

- Mudanca de contrato publico no diff sem gate de ratificacao no ledger.
- Uma serie de decisoes de produto aparecendo so no resumo final da fase.
- Pergunta ao humano sobre nome de variavel enquanto o escopo mudou sem aviso.
- Decisao registrada em dois lugares com redacoes diferentes.

## Verificacao antes de sair da triagem

Cada decisao com classe atribuida, as de classe 1 e 2 subidas com opcoes e uma recomendacao, as de
classe 3 relevantes registradas no ledger, e nenhuma decisao fechada reaberta em silencio. Ver
`DoD 5`, `DoD 12` e `DoD 20`.
