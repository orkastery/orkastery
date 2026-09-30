# Extração determinística do grafo (KG2)

O extrator lê um repositório Git local e produz um grafo válido no contrato
[`ork.code-artifact-graph/v1`](grafo-deterministico-kg1.md), sem mudar o contrato. Mora em
`core/src/intelligence-graph-extract*.ts` e `core/src/intelligence-graph-repo.ts`. É o segundo
pacote do [RM-031](../../roadmap/RM-031-grafo-de-codigo.md) e segue as decisões D1 a D15 da
thread `ork-rm031kg2extr`, mais a D16 (o V8 como juiz de sintaxe do JavaScript).

O KG2 entrega a extração e um comando provisório para prová-la. Não entrega índice
persistente nem CLI de consulta (KG3), extração incremental (KG4), consumo pelas fases (KG5),
federação (KG6) nem paridade entre hosts (KG7).

## O que o KG2 garante e o que não garante

| Garante | Não garante |
| --- | --- |
| Grafo que passa em `validarGrafo`, com spans que passam em `conferirFontes` contra os bytes lidos | Que toda relação do código foi extraída: o que não se prova fica fora |
| Mesma entrada, mesmo grafo, mesmo digest e mesmo relatório, em qualquer ordem de leitura | Estabilidade de identidade entre revisões (KG4) |
| Aresta só com prova do compilador TypeScript, de link explícito, de frontmatter ou de ID citado | Que uma chamada extraída de fato executa |
| O que ficou fora declarado: diagnóstico do contrato ou lacuna do relatório | Ausência de aresta falsa no universo: isso é a auditoria integral do [benchmark](benchmark-grafo-kg1.md) |

Nada de embedding, similaridade, inferência de tipo sobre objeto ou proveniência vetorial.

## Entrada e snapshot

| Campo | De onde vem |
| --- | --- |
| Fontes | arquivos rastreados (`git ls-files`), com os bytes da árvore de trabalho |
| `revision` | o `HEAD`, só quando nada rastreado mudou e os bytes lidos são os blobs do índice; senão `null` com `working-tree-modified`, `filtro-do-git` (eol, LFS) ou `sem-commit` |
| `source_hash` e `source_version` | SHA-256 dos bytes e o id de blob do Git, calculado dos mesmos bytes |
| `authority` | `git:<repositório>` |
| `repository_id` | `project.name` do `orkastery.yaml`, ou o informado |
| `tenant_id` e ACL | padrão `local` e `repo:<repositório>:leitura`, ou os informados; nada no grafo concede acesso |
| `config_hash` | extensões, opções fixas do compilador, regra de âncora e de artefato, ACL e teto de evidências |

Ficam fora do manifesto, com o motivo no relatório: link simbólico, submódulo, arquivo em
conflito, arquivo rastreado que sumiu da árvore, arquivo cujo caminho real sai da raiz (pasta
trocada por link simbólico), caminho que não é UTF-8, caminho que o contrato recusa e caminhos
que coincidem na forma NFC. O Git roda com argumentos fixos e com o `core.fsmonitor` desligado.

## Extratores

| Extrator | Versão | Lê | Produz |
| --- | --- | --- | --- |
| `ork.ts-ast` | `1.0.0+typescript.<versão>+node.<versão>` | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` | símbolos, `declares`, `contains`, `imports`, `calls` (`ast`) |
| `ork.md-structure` | `1.0.0+micromark.<versão>.gfm-table.<versão>+unicode.<versão>` | `.md`, `.markdown` | seções, artefatos, `contains` e frontmatter (`structured`), links (`explicit-link`) |
| `ork.id-mention` | `1.0.0` | Markdown e código TS/JS | `references` a artefato citado pelo ID (`text-location`) |
| `ork.repo-files` | `1.0.0` | o resto do manifesto | `unsupported-language`, com a extensão como referência |

O compilador TypeScript entra por parâmetro: o módulo só conhece o tipo dele, e quem chama
carrega o `typescript` instalado no core. Ele roda num host em memória que só enxerga o
manifesto: sem biblioteca padrão e sem disco. A resolução de módulo nunca entra em
`node_modules`, mesmo versionado, e a raiz virtual deriva do conteúdo do manifesto: especificador
que sobe acima da raiz ou é absoluto fica `unresolved-import`.

A estrutura do Markdown vem do micromark com a tabela GFM, o parser CommonMark que o
markdownlint do core já instala (fixado no `package-lock.json`), carregado pelo adaptador
`core/scripts/micromark-adaptador.cjs` e recebido por parâmetro como o compilador. As versões do
micromark e do Unicode do motor JavaScript entram na versão do `ork.md-structure`, porque a
estrutura e o slug dependem delas. O adaptador também entrega o decodificador de referência de
caractere que o próprio micromark usa (as entidades do HTML5, e o número com a troca do código
inválido por U+FFFD).

O juiz de sintaxe do JavaScript é o V8 do Node que roda a extração (D16), injetado pelo
`core/scripts/sintaxe-node.cjs`. Ele lê a fonte como o carregador lê: a linha `#!` do início
fica em branco até o fim de linha do V8 (LF, CR, U+2028 ou U+2029), e o BOM sai só no ESM, como no
Node. CommonJS compila em
função, como o carregador faz (`vm.compileFunction`). ESM compila em lote, num único processo filho
por extração, com `vm.SourceTextModule`, que só analisa o módulo, sem ligar nem avaliar. O veredito
volta estruturado pela saída padrão, e a de erro nunca é lida. Módulo tão aninhado que estoura a
pilha do V8 no filho faz a extração falhar com `extracao.limite.pilha`. Nada é executado. A versão do Node
entra na versão do `ork.ts-ast`, porque o formato e a resolução do runtime dependem dela.

## Nós

| Nó | Localizador |
| --- | --- |
| `file` | todo arquivo do manifesto |
| `symbol` | declaração de topo (função, classe, interface, tipo, enum, namespace, variável) pelo nome declarado; membro de classe de topo como `Classe.membro`; `default` no export default anônimo |
| `section` | título ATX ou setext de Markdown, com a âncora no slug do GitHub sobre o texto renderizado (repetida ganha `-1`, `-2`) |
| `artifact` | Markdown com `id` e `tipo` no frontmatter (`RM-031`, `FEAT-018`), fora de arquivo cujo nome começa com `_` (modelos); ID repetido em dois arquivos não vira artefato em nenhum |

Sobrecarga, declarações que se fundem e membro estático e de instância com o mesmo nome viram um
nó só, com uma evidência por declaração. Nome que o contrato recusaria como fragmento (vazio,
acima de 512 caracteres, com controle ou marca invisível) não vira nó: vai ao relatório como
`simbolo-recusado`, `secao-recusada` ou `artefato-recusado`, e o trecho sob um título recusado
ou sem texto fica no arquivo, nunca na seção anterior. O texto do título é o que o GitHub renderiza:
dado, código, referência de caractere decodificada e o endereço de autolink, sem marcador de
ênfase, HTML, destino de link, rótulo de link por referência nem texto alternativo de imagem. Nada
é aparado: o título `T` seguido de espaço e de uma imagem vira `t-`, como no GitHub. A quebra de
linha de um título setext some (`Foo`, `bar` vira `foobar`), e a de um span de código vira espaço.

## Arestas

| Aresta | Sai de | Prova e span |
| --- | --- | --- |
| `declares` | arquivo para símbolo de topo | a declaração inteira |
| `contains` | arquivo para seção; classe para membro | a linha do título; a declaração do membro |
| `imports` | arquivo para arquivo e para símbolo | `import`, `export ... from`, `import =`, `require` e `import()` com literal; o especificador importado |
| `calls` | símbolo para símbolo | do início da chamada ao parêntese de abertura (`soma(`, `new Classe(`) |
| `references` | seção ou arquivo para arquivo, seção ou artefato; artefato para artefato e símbolo | o link inteiro; o valor no frontmatter; o ID citado |
| `derived_from` | artefato para arquivo | o valor em `fontes.codigo`, `fontes.testes` ou `fontes.docs` |

Chamada vira aresta quando o binder do TypeScript liga o nome a uma declaração do
repositório: identificador, membro de namespace importado, membro estático de classe,
`this` e `super` com o tipo declarado (a classe, ou a anotação `this:`), e `new Classe()`.
Alvo em outro arquivo exige um import deste arquivo: o alias precisa ser um `import`, um
`import = require` ou um `require` atribuído aqui, e o membro herdado por `this` ou `super`
precisa ser de uma classe importada aqui, por nome ou pelo módulo inteiro (`* as ns`), sem import
divergente no caminho. Global de
script, global UMD e import só de efeito não ligam arquivos. Import e reexport resolvem até a
declaração original.

O compilador e o runtime podem ligar arquivos diferentes: fonte JavaScript resolve como o Node 22
a carrega. O formato vem da extensão, do `package.json` mais próximo e do V8: `.mjs` é ESM e `.cjs`
é CommonJS, cada um só se o V8 o compila assim; `.js` segue o `type`. Sem `type`, o `.js` é
CommonJS se compila como tal, e senão ESM se tem sintaxe que só o ESM aceita (import ou export
estático, `import.meta`, `await` no topo, `let`, `const` ou `class` no topo que declara uma variável
do CommonJS, também por desestruturação) e compila como ESM. `.jsx` só carrega por `require`, como
CommonJS. Em CommonJS, o `require` resolve primeiro como arquivo e depois como pasta, pelo `main` e
pelo `index`, com barra final, `.` e `..` só como pasta. O import estático do ESM e o `import()` usam
o caminho exato, e o especificador é URL: só liga quando a URL lê o mesmo caminho, sem `?`, `#`,
`%`, barra invertida, espaço nem controle, e com um nome no último segmento. `.d.ts`, `.d.cts` ou `.d.mts` com a implementação ao
lado dá lugar a ela, para qualquer fonte. Onde divergem, a aresta de import vai ao arquivo que roda
e nenhuma aresta de símbolo passa por esse import, nem por um módulo que, a qualquer número de
saltos de import, chega a um import divergente (`export *`, `module.exports = require(...)`).

Onde o Node falha, o import fica `unresolved-import`:

- especificador não relativo, ESM sem extensão ou que a URL lê diferente, e `require` em ESM;
- arquivo que o V8 não compila no formato dele (sintaxe ESM em CommonJS, JSX, decorador, `let`
  repetido, `with` em modo estrito, `return` no topo do ESM), como quem importa ou como alvo;
- `package.json` que o Node recusa (JSON inválido, raiz que não é objeto, `name` ou `type` que não
  é texto ou tem surrogate solto) no escopo de quem usa `require` ou no de um alvo `.js`;
- `main` absoluto ou que sai do repositório, e `.json` por `require` que não é JSON;
- arquivo que o parser do TypeScript recusa, como BOM antes do `#!`, que o Node aceita por `import`
  (perda; por `require` o Node também recusa).

Também fica fora o alvo que o Node não carrega sem ressalva. Por import, valem só `.js`, `.mjs` e
`.cjs`, porque JSON pede atributo. Por `require`, só `.js` e `.cjs` em CommonJS e `.json`. TypeScript
pela remoção de tipos, `.node`, arquivo sem extensão e ESM por `require` ficam sem aresta, por não
serem provados. Erro que só aparece ao ligar ou avaliar o módulo (nome que o alvo não exporta,
import irmão que falha, exceção no código) não é modelado: a aresta de arquivo segue a resolução, e
a de símbolo segue as regras acima. Import
só de tipo (`import type`, nomes que só são tipo, `import('x').T`) some na compilação e segue o
compilador, e isso só vale em fonte TypeScript: em JavaScript o import roda.

Link Markdown sai da seção onde está (ou do arquivo, antes do primeiro título); âncora de outro
arquivo que não bate com um título ainda prova a referência ao arquivo. O destino é lido como o
CommonMark o lê, dos eventos do micromark: escape e referência de caractere decodificados. Das
pontas, só saem o espaço e o tab crus (`<a.md >` vira `a.md`, como no GitHub); VT, FF e a
referência que decodifica em espaço (`&Tab;`, `&nbsp;`) ficam, e o link não acha o arquivo.

Até 64 evidências por aresta, as primeiras por posição; o excedente é contado no relatório.

## O que fica fora e onde aparece

| Caso | Onde aparece |
| --- | --- |
| Import de pacote ou de arquivo fora do repositório | diagnóstico `unresolved-import` |
| `require` ou `import()` sem literal | diagnóstico `dynamic-resolution` |
| Arquivo que nenhum extrator lê (JSON, Python, shell, imagem...) | diagnóstico `unsupported-language` |
| Chamada em objeto qualquer (despacho por tipo), fora de símbolo, para local ou parâmetro, ou sem declaração | lacuna contada: `chamada-por-tipo`, `chamada-fora-de-simbolo`, `chamada-alvo-fora-do-grafo`, `chamada-nao-resolvida` |
| Chamada com alvo em dois nós, em global de outro script ou por import divergente | lacuna listada: `chamada-alvo-ambiguo`, `chamada-global-entre-arquivos`, `chamada-por-import-divergente` |
| Import em que o compilador e o runtime ligam arquivos diferentes | lacuna listada: `import-divergente` |
| Nome recusado pelo contrato; fonte que o compilador trocou por outra | lacuna listada: `simbolo-recusado`, `secao-recusada`, `artefato-recusado`, `fonte-redirecionada` |
| Link externo; ID que não é de artefato | lacuna contada: `link-externo`, `id-sem-artefato` |
| Link sem alvo, para pasta, fora do repositório; âncora que não bate | lacuna listada: `link-sem-alvo`, `link-para-diretorio`, `link-fora-do-repositorio`, `ancora-nao-resolvida` |
| Valor do frontmatter sem arquivo, símbolo ou artefato | lacuna listada: `frontmatter-sem-alvo` |
| Código cercado ou indentado, bloco e trecho HTML, autolink, definição de link e célula excedente de tabela | não geram link nem menção, como no CommonMark e no GitHub |
| Span de código | não gera link; ID citado nele conta como menção |
| Link por referência e `href` em HTML | fora da v1 do `ork.md-structure` |
| Arquivo com mais de 2000 linhas em blocos de tabela, isto é, blocos com uma linha delimitadora (`\| --- \|`), até a linha em branco (a tabela do micromark é quadrática nas linhas) | lacuna listada: `markdown-tabela-grande`; o frontmatter segue lido |

No teto de tabela, linha e linha em branco contam como no CommonMark: fim de linha LF, CRLF ou CR,
e em branco só a linha com espaço e tab. Título acima de 2048 caracteres e linha de frontmatter
acima de 4096 também não são lidos: o leitor de YAML do core é quadrático em linha longa.
Aninhamento que estoura a pilha do compilador ou do analisador (milhares de blocos um dentro do
outro) faz a extração inteira falhar com `extracao.limite.pilha`, sem grafo parcial, como os tetos
do contrato.

## Relatório de extração (provisório)

O relatório `ork.graph-extraction-report/v0` fica fora do contrato e não é publicado como
schema: o KG3 decide se vira contrato. Traz o `snapshot_id`, o digest do grafo, as contagens
por tipo, as evidências excedentes, as fontes excluídas com o motivo, as lacunas por
categoria e a lista das lacunas de categoria não volumosa, com arquivo e linha. Não tem
horário: o mesmo grafo dá o mesmo relatório.

## Comando provisório

`core/scripts/extrair-grafo.cjs` prova a extração até o KG3. Fica fora do pacote publicado e
fora do CLI `ork`. Precisa do core compilado e do `typescript` instalado no core, e roda o
juiz de sintaxe num processo filho do próprio Node para o ESM. Lê o
repositório inteiro em memória a cada execução; repositório grande é assunto do KG4
(incremental).

```sh
npm --prefix core run build
node core/scripts/extrair-grafo.cjs --verificar
```

| Opção | Faz |
| --- | --- |
| sem opção | resumo: revisão, snapshot, digest, contagens, lacunas e tempo |
| `--verificar` | `validarGrafo`, `conferirFontes` com todos os bytes e a extração de novo com a ordem invertida e embaralhada; sai 1 se algo diverge |
| `--saida ARQ`, `--relatorio ARQ` | grava o grafo canônico e o relatório |
| `--amostra [N]` | N arestas por estrato (tipo e método), por passo fixo sobre os `edge_id` ordenados, com o hash e a primeira linha do trecho |
| `--conferir-amostra ARQ` | confere a amostra auditada contra a extração atual: cada aresta existe, com o mesmo trecho, e o veredito é `supported` com nota |
| `--raiz`, `--repositorio`, `--tenant`, `--acl` | repositório, identidade e ACL da extração |

## Amostra auditada

`core/test/fixtures/kg2-amostra-auditada.json` guarda uma amostra estratificada de arestas
deste repositório, conferida à mão contra o código, com a revisão auditada, o universo por
estrato, o trecho de cada evidência (hash e primeira linha) e o veredito com nota. A
conferência casa a aresta pelo tipo e pelas extremidades e o trecho pelo hash, então edição
fora daquele trecho não a invalida. Amostra não prova zero aresta falsa no universo.

```sh
node core/scripts/extrair-grafo.cjs --conferir-amostra core/test/fixtures/kg2-amostra-auditada.json
```

## Conformidade

```sh
npm --prefix core run build:test && node --test core/dist-test/test/intelligence-graph-extract.test.js core/dist-test/test/intelligence-kg1-boundary.test.js
```

Os grupos `KG2 extract`, `KG2 provenance`, `KG2 determinism` e `KG2 limits` usam repositórios
sintéticos, em memória ou Git temporário. A fronteira confere que só a família do grafo
consome os contratos, que os extratores puros não tocam arquivo, processo, rede, relógio nem
acaso, e que o `typescript` entra só como tipo.
