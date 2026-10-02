# Índice e consulta do grafo (KG3)

O KG3 guarda o grafo que a [extração do KG2](extracao-grafo-kg2.md) produz num índice local e
persistente, e o consulta pelo `ork grafo`: vizinhança, quem chama, quem importa e caminho entre
dois nós. O contrato [`ork.code-artifact-graph/v1`](grafo-deterministico-kg1.md) não muda. É o
terceiro pacote do [RM-031](../../roadmap/RM-031-grafo-de-codigo.md) e segue as decisões D1 a D10
da thread `ork-rm031kg3`, tomadas em #Auto e registradas no ledger.

O KG3 substitui o comando provisório do KG2: a prova da extração e a amostra auditada passam ao
`ork grafo`. Não entrega extração incremental, que veio no [KG4](incremental-grafo-kg4.md), consumo
pelas fases nem ferramenta MCP, que vieram no [KG5](consumo-grafo-kg5.md), federação (KG6), paridade
entre hosts (KG7) nem o benchmark A/B do [protocolo](benchmark-grafo-kg1.md).

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
  indice.json      manifesto do índice (ork.code-graph-index/v1 desde o KG4), sem horário
  grafo.json       o grafo canônico do KG2; o SHA-256 dos bytes é o digest do grafo
  relatorio.json   o relatório de extração (ork.graph-extraction-report/v0), canônico
  unidades.json    as unidades por arquivo do KG4 (ork.graph-extraction-units/v0)
```

O KG4 acrescentou `unidades.json`, a base do índice incremental; índice v0, do KG3, aparece no
`status` como formato anterior e o `limpar` o remove. As regras abaixo valem para os quatro arquivos.

| Regra | Como |
| --- | --- |
| Permissões | a pasta `grafo/` e cada pasta de índice 0700, cada arquivo 0600, tudo do dono do processo; link simbólico, dono diferente, modo diferente e segundo link físico são recusados (`grafo.indice.permissao-invalida`) |
| Chave | `idx-` e o SHA-256 canônico de: schema do índice, revisão, repositório, tenant, ACL ordenada, versões dos analisadores (TypeScript, Node, micromark e tabela GFM, Unicode), o fecho de pacotes deles com a versão de cada um (`micromark-core-commonmark` e os utilitários incluídos) e a impressão do código compilado dos módulos da extração e do índice |
| Árvore limpa | `indexar` só roda com a revisão do KG2 não nula: HEAD, nada rastreado mudado e bytes iguais aos blobs. Árvore modificada ou sem commit recusa antes de ler qualquer arquivo; filtro do Git (`filtro-do-git`) só aparece lendo os bytes e recusa depois da leitura. A recusa é `grafo.indice.arvore-nao-limpa` com o motivo |
| Revisão inteira | arquivo rastreado que a leitura não alcança com o status limpo (sparse checkout, `skip-worktree`: `ausente-na-arvore`, `nao-e-arquivo`, `fora-do-repositorio`) recusa com `rastreado fora da leitura`: o grafo de uma chave é sempre o da revisão inteira, igual em qualquer árvore que a compartilhe |
| Construção | lê o repositório, extrai (desde o KG4, a partir do índice ancestral quando há base, com os mesmos bytes), valida, confere fontes e evidências (verificada, nenhuma indisponível), grava numa pasta `.tmp-<uuid>` com `fsync` e publica por `rename` |
| Idempotência | a mesma chave já guardada não é reescrita; `--forcar` extrai de novo e só troca os arquivos se o conteúdo mudou |
| Verificação | `--verificar` sempre extrai de novo, repete a extração com a ordem de leitura invertida e embaralhada e reprova se o digest, o relatório ou as unidades divergem, ou se o índice guardado íntegro difere da extração nova (`grafo.indice.nao-deterministico`); havendo base, compara também o incremental com a completa (KG4) |
| Leitura | pelo descritor aberto sem seguir link; confere o manifesto, o tamanho e o digest do grafo e do relatório e o tamanho das unidades (o digest delas, quando o incremental as lê); não roda `validarGrafo` a cada consulta (2157 ms no grafo deste repositório em d2b180ea, contra 19 ms do SHA-256 dos bytes, medidos no GOAL da thread) |
| Corrida | duas construções da mesma chave: a primeira publica, a outra confere a publicada e descarta a sua; a consulta nunca vê índice pela metade |
| Limpeza | `ork grafo limpar` apaga os índices cuja revisão não é o HEAD de nenhuma árvore do repositório (a principal e as worktrees, pelo `git worktree list`), ou todos com `--tudo`, e as sobras `.tmp-` e `.lixo-` com mais de uma hora; nome que não é do índice nunca é apagado |

Índice que não passa na leitura (truncado, digest divergente, permissão) é trocado pela próxima
construção, com o motivo na saída. O índice é projeção descartável: nada nele é autoridade de
fato nem concede acesso.

## Analisadores

O compilador TypeScript, o micromark com a tabela GFM e o juiz de sintaxe do V8, que o KG2
recebia de adaptadores em `core/scripts/`, moram em `core/src/intelligence-graph-parsers.ts`.
`typescript` e os pacotes do micromark só valem dentro do `node_modules` do pacote `@orkastery/cli`
que contém esse módulo, isto é, da instalação do `ork` que roda, comparado pelo caminho real (o
`node_modules` pode ser link simbólico). Pacote achado fora dela (no diretório atual, no
`NODE_PATH`, numa pasta global ou no `node_modules` do projeto que instalou o `ork` como
dependência) é recusado antes de carregar: a resolução do Node só lê o `package.json` dele, e o
código dele não roda. O mesmo vale para o fecho de dependências: dependência obrigatória de um
analisador que falta dentro da instalação recusa a carga inteira, em vez de o Node achá-la fora. O juiz roda o ESM num processo
filho sem ambiente, então um `NODE_OPTIONS` de quem chama não carrega código nele.

Eles não são dependências de runtime do pacote publicado: dependência nova é decisão de produto.
No checkout de desenvolvimento e no CI existem; numa instalação sem eles, todo o `ork grafo` recusa
com `grafo.parser.indisponivel: <pacote>`, e o `status` mostra o índice do HEAD como indisponível:
as versões entram na chave, e a consulta calcula a chave lendo só os `package.json`, sem carregar o
compilador.
No mesmo HEAD, o comando provisório do KG2 e o `ork grafo indexar` deram o mesmo snapshot e o mesmo
digest.

## Consulta

| Consulta | O que percorre |
| --- | --- |
| `vizinhos <nó>` | os nós a até N saltos (`--profundidade`, 1 a 5) e todas as arestas dos nós a menos de N saltos, no `--sentido` (`entrada`, `saida`, `ambos`) e nos `--tipo` pedidos; cada aresta traz a distância do nó que a explorou |
| `chamadores <símbolo>` | as arestas `calls` que chegam ao símbolo, com o mesmo raio |
| `importadores <arquivo\|símbolo>` | as arestas `imports` que chegam ao arquivo ou ao símbolo |
| `caminho <de> <para>` | o menor caminho, no sentido das arestas por padrão; com `--sentido ambos`, também contra elas |

O nó é `caminho` (o arquivo), `caminho#fragmento` (em qualquer `#` que separe um caminho que
existe: o fragmento pode ter `#`, como o membro privado `Classe.#segredo`, e o caminho também),
`tipo:caminho#fragmento` ou um nome solto, que casa o fragmento exato de um símbolo, seção ou
artefato. O rótulo que a resposta imprime, sem o tipo, volta como entrada. Nome solto ambíguo
não escolhe: sai `grafo.consulta.ambiguo` com os candidatos. Resposta vazia é resposta, com
saída 0; nó desconhecido, alvo inválido e índice ausente saem 1, com o código tipado.

A ordem é fixa: arestas por distância, tipo, origem e destino, nós por distância e rótulo, a
comparação por code point, e a busca do caminho expande os vizinhos nessa ordem, então entre
caminhos do mesmo tamanho sai sempre o mesmo. `--limite` (padrão 500) corta a lista já ordenada,
mantendo as arestas mais perto do alvo, e declara `truncado`; a lista de nós traz só o alvo e as
pontas das arestas devolvidas, com `total_nos` contando o raio inteiro. Desde o KG5, `--teto-bytes N`
corta pela mesma ordem até o JSON caber em N bytes ([teto da resposta](consumo-grafo-kg5.md#teto-da-resposta)). Opção inválida recusa antes
de ler o índice. A saída em
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
| Filtrar antes de resolver, contar ou montar contexto | `filtrarGrafo` tira nós, arestas (também a mais restrita que as pontas), evidências e diagnósticos fora da concessão antes de qualquer mapa, na consulta e na amostra |
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
| `--raiz`, `--repositorio`, `--tenant`, `--acl` | o projeto do `ork` (ou `--projeto`), com o repositório do `project.name` do manifesto que o `ork` carregou (também com o projeto numa subpasta do Git), e o tenant e a ACL padrão do KG2; outra identidade entra com a federação (KG6) |

A amostra lê o trecho auditado da árvore, sem seguir link e só de arquivo regular, e confere cada
arquivo lido contra o SHA-256 do manifesto do índice do HEAD: outro arquivo modificado não impede,
e arquivo que mudou recusa (`grafo.amostra.fonte-mudou`). Amostra vazia reprova. Na
[amostra auditada](../../../core/test/fixtures/kg2-amostra-auditada.json), a aresta que morava
no script removido deu lugar à primeira do passo fixo do mesmo estrato, conferida à mão; as outras
44 ficaram.

## Primeira medida do custo de consulta

Registro em
[`core/test/fixtures/kg3-medida-consulta.json`](../../../core/test/fixtures/kg3-medida-consulta.json)
(`ork.graph-query-cost/v0`), gerado por `core/scripts/medir-consulta-grafo.cjs` na revisão
`d87554b3` da branch da thread, com a árvore limpa, carga 1,7 em 8 núcleos, Node
v22.23.2 e 3 repetições por braço. **Não é a linha de base do protocolo nem o benchmark
`ork.graph-benchmark/v1`,** e não conclui economia.

- **Braço grafo:** `ork grafo <consulta> --json` num processo novo, com o índice do HEAD pronto.
  Ao agente chega a saída JSON (o texto humano vai à parte), e ele não abre arquivo nenhum; o
  processo lê o índice (31.603.066 bytes). A latência é de ponta a ponta e inclui a partida do
  Node e a carga do índice.
- **Braço cru:** `git grep -n -I -F` do nome nos arquivos rastreados (o grep varre 9.506.195
  bytes) e a leitura inteira de cada arquivo com ocorrência, que é o que chegaria a um agente para
  confirmar a relação.
- **Preparo do índice**, à parte: `ork grafo indexar --forcar` levou 14.478 ms, para um índice de
  31.603.066 bytes com 953 fontes e 25.076 arestas.
- **Tokens:** `unavailable` nos dois braços; sem tokenizador exato nem contagem do runtime, bytes
  divididos por 4 seriam estimativa.

| Pergunta | Grafo: arestas | Grafo: bytes ao agente (JSON) | Grafo: bytes do texto | Grafo: latência (mediana) | Cru: ocorrências | Cru: arquivos abertos | Cru: bytes ao agente | Cru: latência (mediana) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 quem chama `lerRepositorio` | 1 | 3.148 | 731 | 810,8 ms | 18 | 7 | 201.943 | 16,6 ms |
| P2 quem chama `dirEstado` | 18 | 19.426 | 3.315 | 815,9 ms | 53 | 22 | 565.831 | 21,8 ms |
| P3 quem importa o contrato do grafo | 8 | 10.059 | 1.996 | 755,4 ms | 22 | 15 | 381.405 | 18,5 ms |
| P4 quem importa o leitor de YAML | 9 | 10.326 | 1.729 | 792,5 ms | 11 | 11 | 227.286 | 33,0 ms |
| P5 vizinhança de `raizDoEstado` | 98 | 100.373 | 17.307 | 932,1 ms | 118 | 44 | 998.305 | 27,3 ms |
| P6 caminho de `main` a `dirEstado` | 2 | 5.880 | 866 | 875,7 ms | indisponível | indisponível | indisponível | indisponível |

Como ler, sem concluir além do que foi medido:

- As respostas dos dois lados não são as mesmas. O grafo devolve só o que o extrator prova: em P1,
  1 aresta, porque as chamadas de `lerRepositorio` nos testes estão dentro de `test(...)` (chamada
  fora de símbolo, lacuna do KG2); a leitura crua acha 18 ocorrências em 7 arquivos, com
  comentário, documentação e nome igual em outro escopo.
- A leitura crua modela um agente que abre todo arquivo com ocorrência; um agente real pode ler
  mais ou menos.
- P6 não tem braço cru: não há procedimento fixo que ache um caminho de chamadas sem inferir o
  símbolo que contém cada ocorrência.
- As 3 repetições de cada braço estão no registro; a tabela traz a mediana.

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
