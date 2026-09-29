# Benchmark A/B do grafo (KG1)

Contrato aditivo `ork.graph-benchmark/v1`, definido em
`core/src/intelligence-benchmark-contract.ts` e publicado em
`core/schemas/graph-benchmark.v1.schema.json`. É o formato do experimento que vai decidir
se o [grafo determinístico](grafo-deterministico-kg1.md) economiza contexto, e segue as
decisões D1, D6, D7, D8 e D10 da thread `ork-i31kg1contra`
([RM-031](../../roadmap/RM-031-grafo-de-codigo.md)).

O KG1 entrega o formato, a validação do registro e a avaliação pura de registros já
fornecidos. **Não executa o experimento.** Nenhum número deste contrato ou do corpus é
medida de economia, latência ou relevância estatística.

## Desenho do experimento

| Braço | O que é |
| --- | --- |
| A | fluxo de leitura existente, sem o grafo |
| B | o mesmo fluxo, com contexto obtido pelo grafo determinístico |

O tratamento é só o mecanismo de obter contexto. Todo o resto do par fica fixo no
`protocol` antes da primeira execução:

- `tasks`: `task_id`, hash da pergunta, fatos obrigatórios, claims e verificadores com hash
  do comando;
- `controls`: modelo e revisão, provider, runtime e versão, esforço, amostragem (seed ou o
  motivo de não haver seed), hash do prompt base, das ferramentas e das regras de parada,
  orçamento de tokens, contexto e tempo, snapshot, tenant e hash da política de acesso;
- `treatment`: schema, digest, snapshot, número de arestas e digest do conjunto de
  `edge_id` do grafo usado pelo braço B (`digestDoConjuntoDeArestas`);
- `pairs`: `pair_id`, tarefa, repetição e ordem `AB` ou `BA`, balanceada por tarefa segundo
  a `order_seed`;
- corpus e versão, hash do ambiente, política de cache, aquecimentos por braço, limite de
  tentativas, convenção de contagem de ferramentas e métricas requeridas.

Recomendação operacional inicial: 10 repetições pareadas por tarefa, com peso igual por
tarefa. É desenho proposto, não medida nem significância demonstrada.

Cada execução é uma sessão isolada (`session_id` único). Aquecimento é predefinido, igual
nos dois braços e fica fora da comparação. Retry, timeout, cancelamento e erro são
registros, nunca descarte: tentativas são contíguas até o limite do protocolo, e o consumo
de todas entra no total do par. O custo de preparar o índice fica em `index_preparation`,
separado da consulta, com cenário frio ou quente e a hipótese de amortização.

## Medidas

Cada medida tem `value` (ou `null`), `unit`, `source`, `method`, `method_version`,
`evidence_ref` com hash e `unavailable_reason`.

| `source` | Demonstra consumo? |
| --- | --- |
| `runtime_reported` | sim |
| `tokenizer_exact` | sim, se equivalente e documentado nos dois braços |
| `estimated` | não: bytes/4, valor informado pelo agente ou estimativa |
| `unavailable` | não: `value` é `null` com motivo, nunca zero |

Métrica primária: `logical_total_tokens` = `input_total_tokens` + `output_total_tokens`
de todas as requisições da tarefa, com retries. `cached_input_tokens` está dentro da
entrada e `reasoning_tokens` dentro da saída: são subconjuntos reportados, nunca somados de
novo. Consumo medido exige a lista de `requests` em delta, com `request_id` único no
registro inteiro; a soma das requisições tem de bater com cada medida de tokens, inclusive
com `logical_total_tokens`. Origem equivalente entre braços é a mesma `source`, o mesmo
`method` e a mesma `method_version`.

Métricas auxiliares: `residual_context_tokens` (com janela e ponto de leitura),
`tool_calls` (convenção fixada no protocolo), `latency_ms` (relógio monotônico, de ponta a
ponta) e `cost` (moeda, natureza paga, marginal ou atribuída, e tabela de preço quando
calculado). Custo de assinatura não atribuível é `null` com motivo.

## Veredito

`validarBenchmark` separa estrutura de resultado: registro inválido é erro de contrato
(`benchmark.*`) e não recebe veredito. `avaliarBenchmark` julga só registro válido.

| Resultado | Quando |
| --- | --- |
| `not-run` | protocolo fixado, nenhuma execução |
| `fail` | fato perdido, claim ou verify não preservado, verify falho, aresta falsa, tarefa não concluída; ou dados completos com mediana de B maior ou igual à de A |
| `inconclusive` | registro não `complete`, par ausente, aquecimento diferente do protocolo, controle ou pergunta divergente, ordem trocada, falha de instrumentação, cancelamento, métrica primária ausente ou estimada, origens misturadas, métrica requerida ausente ou estimada, auditoria incompleta |
| `pass` | dados completos e comparáveis, rigor preservado nos dois braços, auditoria integral sem aresta falsa e mediana de B menor que a de A |

Violação de rigor observada prevalece sobre falta de telemetria. Aresta falsa em qualquer
tentativa do braço B reprova, porque é fato do grafo auditado, não da tentativa. Linha de base A que falha
em rigor também impede `pass`. Mediana por ordenação numérica; amostra par usa a média dos
dois centrais. O veredito traz a mediana geral, o delta (B menos A) e as medianas por
tarefa, sempre sobre a população de pares prevista.

A auditoria de arestas do braço B lista o universo de arestas do grafo usado, as examinadas
e o resultado de cada uma (`supported`, `false` ou `unverified`) com as fontes. Examinar
menos que o universo, deixar aresta não verificada ou auditar um universo cujo digest não
bate com o `edge_set_digest` do tratamento não é zero arestas falsas. O contrato confere cobertura e consistência, mas não
autentica o auditor: a origem dos recibos é conferida por quem executa e revisa. Um corpus
de referência independente do extrator reduz a circularidade.

`publicavel` só é verdadeiro com `pass`, `status: complete`, `data_class: measured` e recibos revisados
(`receipts_review.state: reviewed`). Registro `synthetic` nunca é publicável como economia
medida, mesmo com `pass`.

## Validação e erros

| Função | Faz |
| --- | --- |
| `validarBenchmark(entrada)` | estrutura, protocolo, medidas, pares e tentativas; lança `benchmark.*` |
| `avaliarBenchmark(entrada)` | veredito, motivos, medianas e `publicavel` |
| `mediana(valores)` | mediana numérica, `null` para lista vazia |
| `digestDoConjuntoDeArestas(ids)` | digest canônico do conjunto de `edge_id`, sem depender da ordem |

Famílias de erro: `benchmark.versao`, `benchmark.estrutura`, `benchmark.protocolo`,
`benchmark.controle`, `benchmark.metrica`, `benchmark.run`, `benchmark.warmup`,
`benchmark.status`, `benchmark.auditoria`, `benchmark.preparo` e `benchmark.revisao`.

## Conformidade

O corpus `core/test/fixtures/graph-benchmark-v1.json` é sintético: um registro completo com
duas tarefas, quatro pares, um retry e um aquecimento por braço, cujo tratamento é o grafo
sintético do contrato do grafo; um registro não executado; casos inválidos com o código
esperado; e casos de veredito com resultado e motivos esperados.

```sh
npm --prefix core run build:test && node --test core/dist-test/test/intelligence-benchmark-contract.test.js
```

Os grupos `KG1 measurement` e `KG1 verdict` têm casos positivos e negativos. Mudança
incompatível exige novo identificador de versão e migração explícita.
