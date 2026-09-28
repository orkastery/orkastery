# eval/

Avaliacao deterministica do Orkastery, rodada por `ork eval`. Regra do catalogo original,
mantida e agora executavel: **skill sem eval nao entra**, e comportamento sem canario tambem nao.

```bash
ork eval                                  # canarios + corpus das skills
ork eval --so-canarios                    # so o comportamento do nucleo
ork eval --skill code-reviewer            # so uma skill
ork eval --canario fx-stale-base          # so um canario
ork eval --json                           # para o CI
```

O comando sai diferente de zero em qualquer falha, que e o que permite ao CI barrar merge sem
eval.

## As duas metades de um eval, e a que este runner julga

Uma skill e um conjunto de instrucoes que um agente segue, entao cada caso tem duas metades, e
este diretorio e explicito sobre qual delas uma maquina consegue julgar.

- **O cenario.** A situacao que o agente encontra, a desculpa pela qual ele vai se sentir
  tentado e o comportamento que a skill precisa produzir. Essa metade e julgada por um humano ou
  por um modelo. O runner **nao** a julga e nao finge que julga.
- **As guardas estaticas.** As passagens da skill que precisam existir para aquele comportamento
  ser possivel. Essa metade e deterministica, e e a que o runner verifica. Apague a regra da
  separacao no reviewer e o caso dele fica vermelho, com o motivo escrito ao lado.

Toda execucao diz isso em voz alta, com a mesma palavra que a metodologia usa para metrica nao
medida: a metade comportamental sai `unavailable`, **nunca** `passing`. Lacuna e publicada como
lacuna.

Que as guardas estaticas medem alguma coisa nao e afirmacao: `core/test/evalrunner.test.ts`
monta uma copia do catalogo, apaga uma regra, planta uma skill sem eval e ancora um caso so
dentro da tabela de desculpas, e confere que os tres ficam vermelhos. Corpus que fica verde
depois de a regra sumir nao protege nada.

## `fixtures/`, os canarios

Seis comportamentos do nucleo, exercitados ponta a ponta contra git de verdade, em repositorio
temporario, sem rede e sem credencial. A expectativa de cada um e **dado versionado**
(`caso.json`), e o executor e codigo tipado (`core/src/canarios.ts`): assim, mudar o que se
espera do produto e um diff que aparece na revisao, revisavel por quem nao le TypeScript.

| Canario | O que ele impede de voltar |
|---|---|
| `fx-happy` | O caminho feliz parar de funcionar sem ninguem notar |
| `fx-hallucination` | Citacao de arquivo e de teste que nao existem passar no gate |
| `fx-stale-base` | A base andar embaixo da thread e o merge descobrir isso tarde |
| `fx-wiki-destroy` | Comando destrutivo em massa chegar ao disco, no host ou na entrega |
| `fx-schema-drift` | O contrato congelado do MASTER log aceitar mutacao em silencio |
| `fx-concurrency` | Duas threads escreverem na mesma regiao em vez de entrar na fila |

Ha ainda duas fixtures de contrato, mais antigas, rodadas pela suite (`npm test`) em
`core/test/eval.test.ts`: `b0-slug-e-modos` (a #TAG do pedido vira slug, blocos e pausas) e
`b2-master-log` (o contrato congelado do MASTER log, com as mutacoes que precisam reprovar).
A segunda tem dois consumidores de proposito: a suite e o canario `fx-schema-drift`.

## `casos/`, o corpus das skills

Os 87 casos do catalogo original, adaptados as skills finas: um arquivo por skill, no minimo
tres casos cada, cobrindo caminho feliz, resistencia a racionalizacao e borda de dominio.

O runner tambem cobra o **contrato de cobertura**, e nao apenas as assercoes:

| Codigo | O que ele reprova |
|---|---|
| `skill-sem-eval` | Skill no catalogo sem arquivo de casos |
| `eval-sem-skill` | Casos apontando para uma skill que nao existe |
| `cobertura-minima` | Menos de tres casos numa skill |
| `tipo-faltando` | Skill sem caso de algum dos tres tipos |
| `id-duplicado`, `id-sem-prefixo` | Id repetido, ou que nao comeca com o nome da skill |
| `racionalizacao-sem-desculpa` | Caso de racionalizacao que nao escreve a desculpa |
| `assercao-sem-porque` | Assercao sem dizer por que aquela passagem precisa existir |
| `ancora-fora-da-tabela` | Caso ancorado **so** na tabela de racionalizacoes da skill |
| `assercao` | A passagem que a skill deveria carregar sumiu |

O ultimo merece explicacao, porque foi ele que achou defeito real durante o proprio B4: uma
skill pode LISTAR a desculpa na tabela e nao ter, em lugar nenhum, a regra que responde a ela.
O caso passaria e a skill nao seguraria nada. Por isso todo caso de racionalizacao precisa de ao
menos uma ancora fora daquela tabela.

O casamento normaliza espaco em branco: reflowar um paragrafo de markdown nao pode deixar um
eval vermelho sem que regra nenhuma tenha mudado. Um eval que reprova por quebra de linha treina
o time a ignorar o eval, que e o pior resultado possivel para um corpus de regressao.
