# Índice e consulta do grafo (KG3)

O KG3 guarda o grafo que a [extração do KG2](extracao-grafo-kg2.md) produz num índice local e
persistente, e o consulta pelo `ork grafo`: vizinhança, quem chama, quem importa e caminho entre
dois nós. O contrato [`ork.code-artifact-graph/v1`](grafo-deterministico-kg1.md) não muda. É o
terceiro pacote do [RM-031](../../roadmap/RM-031-grafo-de-codigo.md) e segue as decisões D1 a D10
da thread `ork-rm031kg3`, tomadas em #Auto e registradas no ledger.

O KG3 substitui o comando provisório do KG2: a prova da extração e a amostra auditada passam ao
`ork grafo`. Não entrega extração incremental (KG4), consumo pelas fases (KG5), federação (KG6),
paridade entre hosts (KG7), ferramenta MCP nem o benchmark A/B do
[protocolo](benchmark-grafo-kg1.md).

## O que o KG3 garante e o que não garante

| Garante | Não garante |
| --- | --- |
| O índice guarda o grafo do KG2 byte a byte, validado e com cada fonte e evidência conferidas contra os bytes antes de publicar | Que a resposta é completa: o grafo só tem o que o extrator prova |
| Mesma revisão, extrator e identidade dão a mesma chave e os mesmos bytes, sem horário | Que o índice acompanha a árvore editada: ele é do HEAD limpo |
| A mesma pergunta dá a mesma saída byte a byte, em texto e em JSON | Economia de contexto: isso é o benchmark do protocolo |
| Toda aresta devolvida traz extrator, versão, método e a evidência com arquivo, linhas e bytes | Que uma chamada extraída de fato executa |
| Registro fora da concessão local não aparece em resposta, contagem, candidato nem erro | Um motor de ACL entre pessoas ou tenants (KG6) |

## Índice

O índice mora no estado canônico do projeto, fora do git (o `.gitignore` cobre `.orkastery/`).
Numa worktree de thread, o estado é o da árvore principal, e as worktrees da mesma revisão
compartilham o índice.

```text
<raiz canônica>/.orkastery/grafo/idx-<sha256>/
  indice.json      manifesto do índice (ork.code-graph-index/v0), sem horário
  grafo.json       o grafo canônico do KG2; o SHA-256 dos bytes é o digest do grafo
  relatorio.json   o relatório de extração (ork.graph-extraction-report/v0), canônico
```

| Regra | Como |
| --- | --- |
| Permissões | a pasta `grafo/` e cada pasta de índice 0700, cada arquivo 0600, tudo do dono do processo; link simbólico, dono diferente, modo diferente e segundo link físico são recusados (`grafo.indice.permissao-invalida`) |
| Chave | `idx-` e o SHA-256 canônico de: schema do índice, revisão, repositório, tenant, ACL ordenada, versões dos analisadores (TypeScript, Node, micromark e tabela GFM, Unicode) e a impressão do código compilado dos módulos da extração |
| Árvore limpa | `indexar` só roda com a revisão do KG2 não nula: HEAD, nada rastreado mudado e bytes iguais aos blobs; senão recusa com `grafo.indice.arvore-nao-limpa` e o motivo (`working-tree-modified`, `filtro-do-git`, `sem-commit`) antes de ler qualquer arquivo |
| Construção | lê o repositório, extrai, valida, confere fontes e evidências (`conferirFontes` verificada, nenhuma indisponível), grava numa pasta `.tmp-<uuid>` com `fsync` e publica por `rename` |
| Idempotência | a mesma chave já guardada não é reescrita; `--forcar` extrai de novo e só troca os arquivos se o conteúdo mudou |
| Verificação | `--verificar` sempre extrai de novo, repete a extração com a ordem de leitura invertida e embaralhada e reprova se o digest ou o relatório divergem, ou se o índice guardado íntegro difere da extração nova (`grafo.indice.nao-deterministico`) |
| Leitura | pelo descritor aberto sem seguir link; confere o manifesto, o tamanho e o digest do grafo e do relatório; não roda `validarGrafo` a cada consulta (2157 ms no grafo deste repositório em d2b180ea, contra 19 ms do SHA-256 dos bytes, medidos no GOAL da thread) |
| Corrida | duas construções da mesma chave: a primeira publica, a outra confere a publicada e descarta a sua; a consulta nunca vê índice pela metade |
| Limpeza | `ork grafo limpar` apaga os índices que não são do HEAD (ou todos, com `--tudo`) e as sobras `.tmp-` e `.lixo-` com mais de uma hora; nome que não é do índice nunca é apagado |

Índice que não passa na leitura (truncado, digest divergente, permissão) é trocado pela próxima
construção, com o motivo na saída. O índice é projeção descartável: nada nele é autoridade de
fato nem concede acesso.

## Analisadores

O compilador TypeScript, o micromark com a tabela GFM e o juiz de sintaxe do V8, que o KG2
recebia de adaptadores em `core/scripts/`, moram em `core/src/intelligence-graph-parsers.ts`.
`typescript` e os pacotes do micromark são resolvidos a partir desse módulo, isto é, da instalação
do `ork` que roda, nunca do diretório atual nem da raiz do projeto analisado. O juiz roda o ESM num
processo filho sem ambiente, então um `NODE_OPTIONS` de quem chama não carrega código nele.

Eles não são dependências de runtime do pacote publicado: dependência nova é decisão de produto.
No checkout de desenvolvimento e no CI existem; numa instalação sem eles, `ork grafo indexar`
recusa com `grafo.parser.indisponivel: <pacote>`. As versões entram nas dos extratores do KG2 e na
chave do índice, e a consulta calcula a chave lendo só os `package.json`, sem carregar o compilador.
No mesmo HEAD, o comando provisório do KG2 e o `ork grafo indexar` deram o mesmo snapshot e o mesmo
digest.

## Consulta

| Consulta | O que percorre |
| --- | --- |
| `vizinhos <nó>` | os nós a até N saltos (`--profundidade`, 1 a 5) e todas as arestas dos nós a menos de N saltos, no `--sentido` (`entrada`, `saida`, `ambos`) e nos `--tipo` pedidos |
| `chamadores <símbolo>` | as arestas `calls` que chegam ao símbolo, com o mesmo raio |
| `importadores <arquivo\|símbolo>` | as arestas `imports` que chegam ao arquivo ou ao símbolo |
| `caminho <de> <para>` | o menor caminho, no sentido das arestas por padrão; com `--sentido ambos`, também contra elas |

O nó é `caminho` (o arquivo), `caminho#fragmento` (no último `#`), `tipo:caminho#fragmento` ou
um nome solto, que casa o fragmento exato de um símbolo, seção ou artefato. Nome solto ambíguo
não escolhe: sai `grafo.consulta.ambiguo` com os candidatos. Resposta vazia é resposta, com
saída 0; nó desconhecido, alvo inválido e índice ausente saem 1, com o código tipado.

A ordem é fixa: arestas por tipo, origem e destino, nós por distância e rótulo, a comparação por
code point, e a busca do caminho expande os vizinhos nessa ordem, então entre caminhos do mesmo
tamanho sai sempre o mesmo. `--limite` corta a lista já ordenada e declara `truncado`. A saída em
JSON (`ork.code-graph-query/v0`, provisório e fora do contrato) traz a consulta, o cabeçalho do
índice (revisão, chave, snapshot, digest, estado da árvore e extratores), os nós, as arestas com
todas as evidências, o total e o aviso de parcialidade. Não há horário nem tempo na resposta.

Com a árvore modificada, a consulta responde pelo índice do HEAD e diz isso no texto e no
campo `arvore`. Toda resposta diz que é parcial: chamada por despacho de tipo, chamada fora de
símbolo, import não resolvido e as outras lacunas do relatório de extração não viram aresta.

## Tenant, ACL e não vazamento

O KG3 é o primeiro consumidor do grafo e cumpre as obrigações do
[KG1](grafo-deterministico-kg1.md#tenant-acl-e-não-vazamento) com uma avaliação local: quem roda o
CLI e lê a raiz do repositório recebe `repo:<repositório>:leitura` no tenant `local`, e nada mais.

| Obrigação | Como o KG3 cumpre |
| --- | --- |
| Filtrar antes de resolver, contar ou montar contexto | a concessão filtra nós, arestas (também a mais restrita que as pontas), evidências e diagnósticos na preparação, antes de qualquer mapa |
| Não mostrar dado negado | nó negado responde igual a nó inexistente e não entra em candidato, contagem nem caminho |
| Particionar cache por escopo, política e revisão | a chave do índice inclui tenant, ACL e revisão |
| Sem avaliação autorizada, recusar | sem leitura da raiz, a recusa é `grafo.acesso.negado`, sem cair para outro escopo |

## O que o comando provisório fazia e onde ficou

| Comando provisório do KG2 | No KG3 |
| --- | --- |
| resumo da extração | `ork grafo indexar` e `ork grafo status` |
| `--verificar` | `ork grafo indexar --verificar` |
| `--saida ARQ`, `--relatorio ARQ` | o grafo e o relatório ficam no índice; `indexar` mostra a pasta |
| `--amostra [N]` | `ork grafo amostra [--por-estrato N]` |
| `--conferir-amostra ARQ` | `ork grafo amostra --conferir ARQ` |
| `--raiz`, `--repositorio`, `--tenant`, `--acl` | o projeto do `ork` (ou `--projeto`) e a identidade padrão do KG2; outra identidade entra com a federação (KG6) |

A amostra lê o trecho auditado da árvore e confere cada arquivo lido contra o SHA-256 do
manifesto do índice do HEAD: outro arquivo modificado não impede, e arquivo que mudou recusa
(`grafo.amostra.fonte-mudou`). Na
[amostra auditada](../../../core/test/fixtures/kg2-amostra-auditada.json), a aresta que morava
no script removido deu lugar à primeira do passo fixo do mesmo estrato, conferida à mão; as outras
44 ficaram.

## Primeira medida do custo de consulta

Registro em
[`core/test/fixtures/kg3-medida-consulta.json`](../../../core/test/fixtures/kg3-medida-consulta.json)
(`ork.graph-query-cost/v0`), gerado por `core/scripts/medir-consulta-grafo.cjs` na revisão
`a97a1de9` da branch da thread, antes do sync com a main `36def09`, com a árvore limpa, carga 2,8
em 8 núcleos, Node v22.23.2 e 3 repetições por braço.
**Não é a linha de base do protocolo nem o benchmark `ork.graph-benchmark/v1`,** e não conclui
economia.

- **Braço grafo:** `ork grafo <consulta> --json` num processo novo, com o índice do HEAD pronto;
  bytes da saída em JSON e em texto, arestas devolvidas e latência de ponta a ponta, que inclui a
  partida do Node e a carga do índice.
- **Braço cru:** `git grep -n -I -F` do nome nos arquivos rastreados e a leitura inteira de cada
  arquivo com ocorrência, que é o que chegaria a um agente para confirmar a relação.
- **Preparo do índice**, à parte: `ork grafo indexar --forcar` levou 15.320 ms, para um índice de
  30.996.179 bytes com 943 fontes e 24.621 arestas.
- **Tokens:** `unavailable` nos dois braços; sem tokenizador exato nem contagem do runtime, bytes
  divididos por 4 seriam estimativa.

| Pergunta | Grafo: arestas | Grafo: bytes do texto | Grafo: bytes do JSON | Grafo: latência (mediana) | Cru: ocorrências | Cru: arquivos abertos | Cru: bytes ao agente | Cru: latência (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 quem chama `lerRepositorio` | 1 | 731 | 3.108 | 1078,8 ms | 13 | 5 | 172.792 | 47,2 ms |
| P2 quem chama `dirEstado` | 18 | 3.315 | 19.011 | 943,5 ms | 46 | 20 | 535.219 | 20,7 ms |
| P3 quem importa o contrato do grafo | 8 | 1.996 | 9.865 | 931,8 ms | 20 | 14 | 358.627 | 28,5 ms |
| P4 quem importa o leitor de YAML | 8 | 1.558 | 9.131 | 882,1 ms | 9 | 9 | 208.952 | 22,4 ms |
| P5 vizinhança de `raizDoEstado` | 96 | 16.989 | 96.325 | 965,4 ms | 110 | 41 | 945.950 | 44,2 ms |
| P6 caminho de `main` a `dirEstado` | 2 | 866 | 5.770 | 1030,6 ms | indisponível | indisponível | indisponível | indisponível |

Como ler, sem concluir além do que foi medido:

- As respostas dos dois lados não são as mesmas. O grafo devolve só o que o extrator prova: em P1,
  1 aresta, porque as chamadas de `lerRepositorio` nos testes estão dentro de `test(...)` (chamada
  fora de símbolo, lacuna do KG2). A leitura crua acha texto, com comentário, documentação e nome
  igual em outro escopo.
- A leitura crua modela um agente que abre todo arquivo com ocorrência; um agente real pode ler
  mais ou menos.
- P6 não tem braço cru: não há procedimento fixo que ache um caminho de chamadas sem inferir o
  símbolo que contém cada ocorrência.
- A primeira repetição de P1 levou 7193,2 ms, fora da faixa das outras; a causa não foi medida, e
  a mediana e todas as repetições estão no registro.

```sh
node core/scripts/medir-consulta-grafo.cjs --conferir
node core/scripts/medir-consulta-grafo.cjs --validar core/test/fixtures/kg3-medida-consulta.json
```

`--conferir` mede de novo no HEAD e confere, no blob do HEAD, que o trecho de cada evidência
devolvida cita o alvo da aresta. `--validar` confere a forma do registro e recusa token medido
sem medida e texto que prometa economia.

## Conformidade

```sh
npm --prefix core run build:test && node --test core/dist-test/test/intelligence-graph-index.test.js core/dist-test/test/intelligence-graph-query.test.js core/dist-test/test/intelligence-kg1-boundary.test.js
```

Os grupos `KG3 parsers`, `KG3 index`, `KG3 cli`, `KG3 query`, `KG3 determinism` e `KG3 medida`
usam repositórios sintéticos, em memória ou Git temporário. A fronteira confere que só o
`index.ts` abre a família do grafo, e só pelo módulo de CLI; que a consulta é pura; e que só o
módulo de analisadores carrega o compilador e o micromark em tempo de execução.
