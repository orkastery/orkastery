---
name: web-performance-auditor
description: "Auditor de performance do CHECK: auditoria condicional que roda quando o alvo tem superficie sensivel a latencia e, quando nao tem, e dispensada por contrato escrito. Nao afirma performance sem medida."
bucket: reviewers
roteia: "references/performance-checklist.md | ork verify <thread>"
license: MIT
---

# Web Performance Auditor

## O que esta skill e

Um roteador fino que aplica
[performance-checklist.md](../../../references/performance-checklist.md) ao alvo da thread. Ela e
**condicional e nunca ausente**: quando o alvo nao tem superficie sensivel a latencia, a secao
existe e contem a dispensa escrita, com o motivo.

## Como rotear

```bash
ork verify <thread>            # a suite, e o tempo real que ela leva
git diff <base>...HEAD         # os lacos e o I/O que o diff introduziu
```

## Escopo e conduta

1. **Decidir e registrar a aplicabilidade.** Dispensa escrita e resultado; auditoria ausente sem
   linha nenhuma e lacuna.
2. **Medir antes de afirmar.** Toda afirmacao de performance traz numero, unidade e como o numero
   foi obtido. **"Ficou mais rapido" sem medida e opiniao, e opiniao nao passa em gate.**
3. **Comparar na mesma maquina e no mesmo regime**, com repeticao suficiente para separar sinal de
   ruido. Uma execucao unica vira `estimated`, nunca `runtime_reported`.
4. **Medir o caminho do usuario**, nao o microbenchmark conveniente.
5. **Declarar origem em todo numero**, e o que nao foi medido sai `unavailable` com o motivo, nunca
   como zero.

## O que o nucleo verifica por voce

A mesma disciplina do gate de tokens do `ork`, que prefere dizer "nao medivel" a inventar uma
ocupacao de janela: `runtime_reported`, `estimated`, `informada`, `unavailable`. Origem faz parte
do dado, nao e enfeite do relatorio.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Ficou visivelmente mais rapido" | Sem numero, unidade e metodo, e opiniao. Opiniao nao passa em gate de performance. |
| "Medi na minha maquina, deu melhor que a do CI" | Comparar maquinas diferentes e comparar maquinas, nao codigo. Mesmo hardware, mesmo regime, ou nao compara. |
| "Rodei uma vez e ja deu para ver" | Uma execucao vira `estimated`. Sem repeticao nao da para separar ganho de ruido. |
| "Nao tem interface web, entao pulo a secao" | A secao existe sempre. Sem superficie sensivel, ela contem a dispensa e o motivo. |
| "Coloco zero onde nao consegui medir" | Zero e um dado, e um dado falso. O que nao foi medido sai `unavailable` com o motivo. |

## Bandeiras vermelhas

- Relatorio de CHECK sem secao de performance, nem mesmo com a dispensa.
- Afirmacao de ganho sem numero e sem metodo.
- Numero sem origem declarada.
- Comparacao entre maquinas ou regimes diferentes apresentada como antes e depois.

## Verificacao antes de sair da auditoria

Aplicabilidade decidida e escrita, medidas com metodo e repeticao quando ha o que medir, caminho do
usuario coberto, e todo numero com origem. Ver `PERF 1` a `PERF 10` e `DoD 9`.
