# Índice incremental do grafo (KG4)

O KG4 faz o `ork grafo indexar` partir do índice de uma revisão anterior e reextrair só o que a
mudança alcança, gravando os mesmos bytes que a extração completa da mesma revisão gravaria. O
contrato [`ork.code-artifact-graph/v1`](grafo-deterministico-kg1.md) não muda. É o quarto pacote do
[RM-031](../../roadmap/RM-031-grafo-de-codigo.md) e segue as decisões D1 a D11 da thread
`ork-rm031kg4incr`, tomadas em #Auto e registradas no ledger. O mesmo pacote registra a
[linha de base do protocolo](#linha-de-base-do-protocolo) do [benchmark](benchmark-grafo-kg1.md).

Não entrega identidade estável entre revisões: o v1 deriva o ID de todo nó e de toda aresta do
snapshot, que deriva do manifesto inteiro, então qualquer mudança troca todos os IDs, também no
incremental. Estabilizar exigiria uma versão nova do contrato. Também ficam fora o consumo pelas
fases (KG5), a federação (KG6), a paridade entre hosts (KG7), ferramenta MCP e a rodada paga do A/B.

## O que o KG4 garante e o que não garante

| Garante | Não garante |
| --- | --- |
| O índice incremental tem os mesmos bytes do completo da mesma revisão, nos quatro arquivos da pasta | Que todo commit fica barato: o piso é montar, derivar e validar os IDs do snapshot inteiro |
| A mudança é comparada por conteúdo (o id de blob de cada caminho), sem depender do histórico | IDs estáveis entre revisões (o v1 os deriva do snapshot) |
| Sem base que prove, extração completa, com o motivo na saída | Ganho quando a mudança toca um arquivo que quase todo o código importa |
| O incremental passa pelas mesmas validações da completa antes de publicar | Que um canal de dependência novo do TypeScript fica coberto sem sonda nova: o `--verificar` e os pares reais o pegam |

## Base

Sem o índice do HEAD, a construção procura a base: o índice da revisão ancestral mais próxima do
HEAD, nas 512 revisões do `git rev-list HEAD`, cujo manifesto tem o mesmo perfil (repositório,
tenant, ACL, versões dos analisadores, fecho de pacotes e impressão do código do extrator) e o
schema `ork.code-graph-index/v1`. A base é lida com a integridade de sempre (permissão, tamanho e
digest), agora também das unidades.

Sem base, a extração é completa e a saída diz por quê:

| Motivo | Quando |
| --- | --- |
| `nenhum indice guardado` ou `nenhum indice de revisao ancestral com este extrator` | não há índice compatível |
| `o extrator mudou desde o indice de <revisão> (<campos>)` | há índice ancestral de outro perfil; os campos dizem o que mudou (analisadores, pacotes, código) |
| `... o de <revisão> esta fora da linha do HEAD (historico reescrito ou outro ramo)` | há índice do mesmo perfil, mas a revisão dele não é ancestral do HEAD |
| `so ha indice de formato anterior (ork.code-graph-index/v0)` | só há índices do KG3, sem unidades |
| `base ilegivel (<revisão>: <erro>)` | a base não passa na leitura; a próxima base é tentada antes |
| `o incremental falhou e a extracao foi completa (<erro>)` | o incremental lançou erro: a completa decide, e o índice nunca deixa de sair por causa do incremental |
| `pedido com --forcar` | `--forcar` extrai sempre completo |

A mudança é o conjunto de caminhos cujo hash difere do manifesto da base, mais os novos e os
removidos. Renome é remoção mais arquivo novo. Reescrever o histórico não engana a comparação,
porque ela é por conteúdo; o histórico só escolhe qual índice serve de base.

## Unidades por arquivo

A pasta do índice ganha o quarto arquivo, `unidades.json` (`ork.graph-extraction-units/v0`, JSON
determinístico), e o manifesto passa a `ork.code-graph-index/v1`, com o tamanho e o digest dele. A
extração completa também o grava, então os quatro arquivos são comparáveis entre os dois caminhos.

| Campo | Conteúdo |
| --- | --- |
| `arquivos` | o manifesto inteiro, em ordem de caminho: `path`, `source_hash`, `ts` e `md` |
| `ts` | de cada fonte TS/JS: os achados do `ork.ts-ast` (nós, arestas, diagnósticos e lacunas com offset), as dependências de resolução e as sondas |
| `md` | de cada Markdown: a estrutura pura dos bytes (seções, links, menções com offset e o que a ligação usa do frontmatter) |
| `globais_ts` | as fontes TS/JS com declaração no escopo global do checker ou com aumento de módulo |

Neste repositório as unidades somam cerca de 15 MB, ao lado de 31 MB do grafo. Índice v0 (do KG3)
aparece no `ork grafo status` como formato anterior, não serve de base e sai no `ork grafo limpar`.

## O que se reextrai

**Markdown.** A estrutura de um arquivo depende só dos bytes dele e das versões dos analisadores
(que estão no perfil): a de arquivo que não mudou vem da base. A ligação entre arquivos (artefatos
por ID, alvos de link, âncoras, símbolos do frontmatter e as menções em código) roda inteira em toda
indexação, porque depende do repositório todo e custa dezenas de milissegundos.

**TypeScript.** O checker só enxerga, a partir de um arquivo, os módulos que as referências de
módulo dele alcançam e o escopo global (com os aumentos de módulo). O plano segue isso:

1. **Sementes:** cada fonte TS/JS mudada ou nova, e a que não mudou mas tem uma sonda que casa um
   caminho novo ou removido. A sonda é a base de cada resolução relativa (inclusive o tipo importado
   no JSDoc e o `/// <reference path>`): o caminho casa a base exata, a base seguida de `.` ou `/`,
   o mesmo sem a extensão (o TypeScript troca `.js` por `.ts`) e os alvos de `main`, `types` e
   `typings` do `package.json` da pasta. Conteúdo mudado só importa pela dependência.
2. **Afetados:** as sementes e quem alcança, pelas dependências gravadas na base (os alvos de
   compilador, de runtime e de implementação de cada referência de módulo), uma semente ou um
   caminho mudado.
3. **Programa parcial:** os afetados, o fecho direto deles e os arquivos globais. Alvo de semente que
   ainda não está no programa entra, e a extração recomeça até fechar. Só os afetados têm os achados
   extraídos; o resto vem da base.
4. **TypeScript inteiro**, com o motivo: `package.json` na mudança, arquivo global na mudança, ou
   afetado que passa a declarar global.

Global é o arquivo com símbolo no escopo global, visto de um módulo vazio sintético fora da raiz
virtual (sem local que esconda global de mesmo nome), ou com aumento de módulo. Neste repositório,
dois: `adapters/claude-code/hooks/ork-sensor.js` (expande o global `process`) e
`adapters/openclaw/src/tipos-openclaw.d.ts`.

## Bandeiras e saída

Não há bandeira nova (D7).

| Comando | O que faz |
| --- | --- |
| `ork grafo indexar` | sem o índice do HEAD, incremental a partir da base, ou completo com o motivo; com ele, `existente` |
| `ork grafo indexar --forcar` | extração completa; só troca os arquivos se o conteúdo mudou |
| `ork grafo indexar --verificar` | completa, determinismo com a ordem de leitura trocada (agora também das unidades) e, havendo base, o incremental dela comparado byte a byte com a completa; diferença reprova com `grafo.indice.incremental-divergente` |

```text
indice do grafo de orkastery: criado
  ...
  extracao     incremental a partir do indice de c68df3cd1c34: 3 alterado(s), 0 novo(s), 0 removido(s)
               TypeScript parcial, 14 reextraido(s) (core/src/index.ts, ...) num programa de 194, 517 da base
               Markdown: 1 reextraido(s) (docs/referencia/contratos/indice-grafo-kg3.md), 258 da base
```

No `--json`, o resultado traz `modo` (`incremental`, `completo` ou `null` quando o índice já
existia), `base`, `motivo_completo`, `reaproveitamento` (a mudança, o modo do TypeScript com os
reextraídos e o tamanho do programa, e o Markdown reextraído) e, no `--verificar`, `incremental`.

## Prova da equivalência

- **Testes sintéticos** (`KG4 equivalencia`): renome de módulo e do alvo de link, remoção de módulo
  reexportado, arquivo novo que resolve import solto e dá destino a ID citado em Markdown que não
  mudou, mudança no alvo importado com símbolo de frontmatter, `export *` que fica ambíguo, `.d.ts`
  que ganha implementação e contamina a cadeia, tipo importado no JSDoc e título renomeado. Em cada
  um, depois do incremental, `--forcar` extrai completo e só dá `reconstruido-identico` com os
  quatro arquivos iguais; e só os afetados são reextraídos.
- **Quedas** (`KG4 queda`): sem base, extrator mudado, histórico reescrito, base ilegível,
  `package.json` e global na mudança, arquivo que passa a declarar global.
- **Pares reais** deste repositório, por `core/scripts/medir-incremental-grafo.cjs`, num clone no
  tmp: os seis pares abaixo deram os mesmos bytes, e a extração completa de 2418a4e7 com o código do
  KG4 dá o digest `9fe38ec2...` que o código do KG3 dava.
- **No repositório de quem usa:** `ork grafo indexar --verificar`.

## Medida do ganho

Registro em [`core/test/fixtures/kg4-medida-incremental.json`](../../../core/test/fixtures/kg4-medida-incremental.json)
(`ork.graph-incremental-cost/v0`), Node v22.23.2, 8 núcleos, carga de 5,5 no início e 1,9 no fim. O
tempo é o do `construirIndice` de ponta a ponta no mesmo processo; o "completo do KG3" é o `dist` de
2418a4e7 compilado à parte, no mesmo par.

| Par | Mudança (alterados/novos/removidos) | TypeScript | Incremental | Completo (KG4) | Completo (KG3) |
| --- | --- | --- | --- | --- | --- |
| mudança típica de TS (`c68df3cd..d4910625`) | 3/0/0 | parcial, 14 reextraídos num programa de 194 | 6.397 ms | 9.263 ms | 13.625 ms |
| só docs (`a300d6d9..66faa145`) | 1/0/0 | todo da base | 5.712 ms | 9.804 ms | 13.247 ms |
| só dados (`61631dd7..a1044c9b`) | 1/0/0 | todo da base | 6.628 ms | 10.397 ms | 12.750 ms |
| arquivo central (`5c3e7883..a8feb636`) | 2/0/0 | parcial, 413 reextraídos num programa de 464 | 8.220 ms | 9.276 ms | 13.129 ms |
| renome (`985d6179..35eea27f`) | 5/1/1 | parcial, 2 reextraídos num programa de 4 | 5.066 ms | 9.265 ms | 11.998 ms |
| remoção e arquivo novo (`5675a832..772762d6`) | 6/1/1 | parcial, 13 reextraídos num programa de 194 | 8.183 ms | 9.846 ms | 14.443 ms |

Medianas dos seis pares: incremental 6.512,5 ms, completo do KG4 9.540 ms, completo do KG3 13.188 ms.
Como ler, sem concluir além do medido:

- Parte do ganho sobre o KG3 vem do piso mais barato, que vale também para a completa: o `canonico`
  guarda a ordem das chaves por forma de objeto e a construção não valida duas vezes o mesmo grafo
  (D6), com o mesmo digest.
- O incremental tira a extração do que não mudou, mas não o piso: com o v1, cada revisão deriva e
  valida os IDs do grafo inteiro, confere todas as evidências contra os bytes e lê e grava os quatro
  arquivos. O par só de docs, sem nada do TypeScript a reextrair, levou 5.712 ms.
- Mudança num arquivo importado por quase todo o núcleo reextrai quase todo o TypeScript, e o
  incremental fica perto da completa.

## Linha de base do protocolo

O [protocolo](benchmark-grafo-kg1.md) decide economia por `logical_total_tokens`, que só uma sessão
de agente mede. A rodada paga não rodou; o KG4 entrega a parte determinística medida, o protocolo
fixado e o harness da rodada paga, por `core/scripts/linha-de-base-grafo.cjs`.

**Parte determinística**, em
[`core/test/fixtures/kg4-linha-de-base.json`](../../../core/test/fixtures/kg4-linha-de-base.json)
(`ork.graph-baseline/v0`), na revisão `7a1de0c3`, num clone no tmp, 3 repetições por braço. As
tarefas são as seis perguntas da [medida do KG3](indice-grafo-kg3.md#primeira-medida-do-custo-de-consulta),
cada uma com fatos obrigatórios conferidos no código. Braço B: `ork grafo <consulta> --json` num
processo novo; braço A: `git grep -n -I -F` e a leitura inteira de cada arquivo com ocorrência.
Preparo do índice: completo 10.202 ms; incremental a partir do pai 7.919 ms (16 fontes TS reextraídas).

| Tarefa | B: bytes ao agente | B: arestas | B: latência | A: bytes ao agente | A: arquivos lidos | A: latência | Fatos no contexto (B, A) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 quem chama `lerRepositorio` | 3.148 | 1 | 779,9 ms | 232.052 | 8 | 31,4 ms | 2/2, 2/2 |
| P2 quem chama `dirEstado` | 19.426 | 18 | 839,9 ms | 574.129 | 22 | 35,4 ms | 3/3, 3/3 |
| P3 quem importa o contrato do grafo | 10.059 | 8 | 854,4 ms | 426.227 | 16 | 44,7 ms | 3/3, 3/3 |
| P4 quem importa o leitor de YAML | 11.235 | 10 | 828,5 ms | 253.526 | 12 | 29,5 ms | 3/3, 3/3 |
| P5 vizinhança de `raizDoEstado` | 102.479 | 100 | 849,9 ms | 1.046.262 | 45 | 36,8 ms | 2/2, 2/2 |
| P6 caminho de `main` a `dirEstado` | 5.880 | 2 | 832,2 ms | indisponível | indisponível | indisponível | 2/2, indisponível |

Bytes não são tokens, fato no contexto não é fato na resposta e a leitura crua modela um agente que
abre todo arquivo com ocorrência; a latência do braço B inclui a partida do Node e a carga do índice.
Tokens ficam `unavailable` nos dois braços.

**Protocolo fixado**, em [`core/test/fixtures/kg4-protocolo-ab.json`](../../../core/test/fixtures/kg4-protocolo-ab.json):
registro `ork.graph-benchmark/v1` com `status: not-run` (veredito `not-run`, nunca publicável), as
seis tarefas, 10 repetições por tarefa (60 pares, AB e BA balanceados pela seed), o tratamento com o
digest, o snapshot e o conjunto de arestas do grafo medido, e controles propostos para a rodada paga
(Claude Code, `claude-sonnet-5-5`, esforço `high`), que o dono confirma ou troca regerando o protocolo
antes da primeira execução:

```sh
node core/scripts/linha-de-base-grafo.cjs --protocolo core/test/fixtures/kg4-protocolo-ab.json \
  --linha-de-base core/test/fixtures/kg4-linha-de-base.json --modelo <modelo> --esforco <esforco>
```

**Harness da rodada paga.** Só roda com `--pago`. Abre uma sessão isolada por braço de cada par, na
ordem do protocolo, num clone preparado na revisão medida (com o índice do HEAD), lê a telemetria
`stream-json` por requisição (entrada, saída e cache; raciocínio `unavailable`, porque o runtime não
o separa), conta as chamadas de ferramenta pedidas, mede a latência pelo relógio monotônico, confere
os fatos no texto final e refaz a tentativa pela política do protocolo. Guarde as transcrições dentro
do repositório, para as referências ficarem relativas:

```sh
node core/scripts/linha-de-base-grafo.cjs --executar --pago --protocolo core/test/fixtures/kg4-protocolo-ab.json \
  --repositorio <clone preparado> --agente '["claude","-p","--output-format","stream-json","--verbose"]' \
  --saida <registro.json> --transcricoes <pasta no repositorio>
```

Sem a auditoria integral de arestas do braço B, o veredito para em `inconclusive`: a auditoria e a
revisão dos recibos fazem parte da rodada paga, que segue pendente.

## Conformidade

```sh
npm --prefix core run build && npm --prefix core run build:test
node --test core/dist-test/test/intelligence-graph-incremental.test.js
node core/scripts/medir-incremental-grafo.cjs --conferir
node core/scripts/medir-incremental-grafo.cjs --validar core/test/fixtures/kg4-medida-incremental.json
node core/scripts/linha-de-base-grafo.cjs --validar core/test/fixtures/kg4-linha-de-base.json
node core/scripts/linha-de-base-grafo.cjs --validar-protocolo core/test/fixtures/kg4-protocolo-ab.json
```

Os grupos `KG4 equivalencia`, `KG4 queda`, `KG4 cli`, `KG4 medida` e `KG4 harness` usam
repositórios Git temporários e um agente simulado (`core/test/fixtures/kg4-agente-simulado.cjs`). O
`--conferir` refaz os seis pares e a âncora e precisa do histórico do Git (o CI faz checkout com
`fetch-depth: 0`).
