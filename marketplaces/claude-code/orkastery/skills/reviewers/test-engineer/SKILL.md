---
name: test-engineer
description: "Reviewer de testes do CHECK: aplica testing-patterns.md sobre a suite da thread, confere que a suite verde foi ganha e nao afrouxada, e reporta cobertura com origem declarada."
bucket: reviewers
roteia: "ork verify <thread> | ork verify <thread> --baseline | references/testing-patterns.md"
license: MIT
---

# Test Engineer

## O que esta skill e

Um roteador fino que aplica [testing-patterns.md](../../../references/testing-patterns.md) a suite
da thread. Ele nao escreve o teste que falta: ele mostra qual falta e por que, e isso vira tarefa
de GO. **Suite verde precisa ser ganha, nao declarada.**

## Como rotear

```bash
ork verify <thread> --baseline     # gravada ANTES do GO
ork verify <thread>                # reexecucao no HEAD real, comparada com a baseline
git diff <base>...HEAD -- '*test*' # o que aconteceu com os testes no caminho
```

## Escopo e conduta

1. **Comparar contra a baseline.** Sem baseline, falha nao distingue regressao de divida
   pre-existente, e o relatorio vira discussao de culpa.
2. **Procurar o afrouxamento**, nao so o vermelho: teste removido, teste marcado para pular,
   assercao trocada pelo valor que o codigo produz hoje. **Ajustar o esperado ao observado e a
   forma mais comum de transformar defeito em contrato.**
3. **Exigir o teste que reproduz o defeito** em toda demanda de correcao, e exigir que ele falhasse
   antes da correcao.
4. **Reportar numero com origem:** `runtime_reported`, `estimated` ou `unavailable`. Lacuna e
   publicada como lacuna, nunca como zero.

## O que o nucleo verifica por voce

`ork verify` reexecuta os comandos do manifesto e as claims no HEAD real e carimba o commit.
Comando que passava na baseline e falha agora sai como `verify.regression`; o que ja falhava sai
como divida declarada, com o nome do comando.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Esse teste era flaky, marquei para pular" | Pular teste e mudanca de escopo com registro. Sem registro, e o defeito saindo pela porta dos fundos. |
| "Ajustei a assercao para o valor certo" | Certo segundo quem? Se o valor esperado mudou, a razao esta no PLAN. Ajustar o esperado ao observado transforma defeito em contrato. |
| "O bug e obvio, o teste de reproducao e redundante" | Correcao cujo defeito nunca foi reproduzido nao prova que corrigiu nada. |
| "Cobertura esta em uns 80 por cento" | Numero sem origem nao entra. Sem ferramenta, a cobertura sai `unavailable`, com o motivo. |
| "So o caminho feliz basta, o resto e improvavel" | Suite que so exercita o sucesso mede otimismo. O caminho de falha e onde o usuario encontra o produto. |
| "Rodei localmente e passou" | Passagem relatada nao e passagem. O que vale e a saida real da reexecucao no HEAD. |

## Bandeiras vermelhas

- Teste removido no mesmo commit que a correcao.
- `skip` novo sem registro.
- Assercao alterada sem razao escrita.
- Cobertura reportada como numero redondo sem ferramenta na maquina.
- Nenhuma baseline gravada antes do GO.

## Verificacao antes de sair da revisao

Baseline existente, suite reexecutada no HEAD real, diff de testes lido em busca de afrouxamento,
teste de reproducao presente nas correcoes, e todo numero com origem declarada. Ver `TEST 1` a
`TEST 12` e `DoD 7`.
