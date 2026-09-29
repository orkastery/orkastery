# Grafo determinístico de código e artefatos (KG1)

Contrato aditivo `ork.code-artifact-graph/v1`, definido em
`core/src/intelligence-graph-contract.ts` e publicado em
`core/schemas/code-artifact-graph.v1.schema.json`. É o primeiro pacote do
[RM-031](../../roadmap/RM-031-grafo-de-codigo.md) e segue as decisões D1 a D5, D9 e
D10 da thread `ork-i31kg1contra`.

O grafo é uma projeção local e descartável de código e documentos. A mesma entrada,
configuração e versão de extrator determinam as mesmas identidades e o mesmo conteúdo
canônico, em qualquer ordem de inserção. O KG1 entrega o contrato, a validação pura e o
corpus de conformidade. Não entrega parser, AST, extração de PDF, índice, busca, watcher
nem consumo pelas fases: isso é KG2 a KG7.

## O que o contrato garante e o que não garante

| Garante | Não garante |
| --- | --- |
| Estrutura fechada: campo, tipo ou versão desconhecidos são recusados | Que o extrator interpretou a relação certo |
| IDs recalculados a partir do conteúdo, nunca aceitos do produtor | Estabilidade de identidade entre snapshots (é KG4) |
| Toda aresta com evidência localizável, na fonte de onde ela parte | Que uma chamada extraída de fato executa |
| Restrição de acesso conservada de fontes e extremidades | Autorização de leitura: ela vem do transporte |
| Spans conferidos contra bytes que o chamador fornece | Ausência global de arestas falsas num índice real |

## Envelope e snapshot

O envelope tem `schema`, `tenant_id`, `repository_id` (opaco e estável), `snapshot`,
`nodes`, `edges` e `diagnostics`. Horário de materialização não faz parte do conteúdo.

O `snapshot` fixa a entrada:

| Campo | Conteúdo |
| --- | --- |
| `revision` | SHA Git de 40 ou 64 hex; nome de branch é recusado |
| `revision_unavailable_reason` | motivo quando não há revisão; exatamente um dos dois é `null` |
| `source_manifest` | por fonte: `path`, `authority`, `source_hash`, `source_version`, `size_bytes`, `access` |
| `config_hash` | SHA-256 da configuração dos extratores |
| `extractors` | `extractor_id` e `extractor_version` de cada extrator |
| `extractors_digest` | SHA-256 canônico da lista de extratores |

## Identidade e forma canônica

JSON canônico: chaves na ordem dos bytes UTF-8 (a ordem de code points), sem espaço, só
número finito, inteiro seguro em posição e contagem. String sai como no `JSON.stringify` do
ECMAScript: escapa só aspas, barra invertida e controle abaixo de U+0020 (`\b`, `\f`, `\n`,
`\r`, `\t`, os demais como `\u00xx` minúsculo); todo o resto vai cru em UTF-8, sem `\u` para
não-ASCII. Surrogate isolado nunca chega à forma canônica: o contrato o recusa antes. Hash é SHA-256 sobre os bytes UTF-8 desse texto. Conjuntos (manifesto, extratores, nós, arestas, evidências, diagnósticos) são
ordenados na forma canônica; `acl_refs` já chega ordenado e sem repetição.

| ID | Deriva de |
| --- | --- |
| `snap-<sha256>` | schema, tenant, repositório, revisão, manifesto, configuração e extratores |
| `node-<sha256>` | tenant, repositório, snapshot, tipo e localizador (`path` e `fragment`) |
| `edge-<sha256>` | snapshot, tipo, extremidades e evidências canônicas |

Permutar nós, arestas ou evidências não muda o digest. Mudar fonte, ACL, configuração ou
extrator muda o snapshot e, com ele, todos os IDs. O mesmo arquivo em outro tenant ou
repositório tem outro ID. `derivarIds` recalcula tudo para o produtor a partir de IDs
provisórios; `validarGrafo` recusa qualquer ID que não bata (`grafo.id.divergente`).

## Vocabulário e matriz de arestas

Nós: `file` (arquivo fonte), `symbol` (declaração de código), `section` (trecho ou âncora
de documento) e `artifact` (artefato governado com origem). Arquivo não tem `fragment`; os
demais têm. Todo nó aponta para uma entrada do manifesto com o mesmo hash: identificador
sem fonte no manifesto não vira nó externo fabricado.

| Aresta | Origem | Destino |
| --- | --- | --- |
| `contains` | `file`; `symbol` | `section` (de `file`); `symbol` (de `symbol`) |
| `declares` | `file` | `symbol` |
| `imports` | `file` ou `symbol` | `file` ou `symbol` |
| `calls` | `symbol` | `symbol` (referência de chamada resolvida, não execução) |
| `references` | qualquer tipo | qualquer tipo |
| `derived_from` | `artifact` | `file`, `section` ou `artifact` |

Arestas repetidas (mesmo tipo e extremidades), extremidade ausente e combinação fora da
matriz são recusadas. `contains` e `declares` ficam dentro de um arquivo: as duas
extremidades têm o mesmo `path`, e a relação entre arquivos é `imports` ou `references`. Cada
nó tem no máximo um pai em `contains`. `calls`, `imports` e `references` podem formar ciclo;
`contains` não.
Import externo não resolvido, resolução dinâmica e linguagem sem suporte vão para
`diagnostics` (`unresolved-import`, `dynamic-resolution`, `unsupported-language`), nunca
para uma aresta.

## Proveniência por aresta

Toda aresta tem de 1 a 64 evidências. Cada uma traz `snapshot_id`, `path`, `source_hash`,
`source_version`, `authority`, `extractor_id`, `extractor_version`, `extraction_method`,
`confidence_class`, `span` e `access`.

- Hash, versão e autoridade batem com a entrada do manifesto daquele `path`.
- O extrator e sua versão estão fixados no snapshot.
- `confidence_class` é sempre `EXTRACTED`; `extraction_method` é `ast`, `structured`,
  `explicit-link` ou `text-location`. Inferência, embedding, similaridade vetorial e
  confiança numérica não são evidência determinística e são recusados.
- Autoridade é a fonte, não o índice: os esquemas `graph:`, `index:`, `kg:`, `snap:`,
  `node:` e `edge:` são recusados.
- Pelo menos uma evidência fica no arquivo do nó de origem: a relação é observada onde ela
  parte.

## Span de texto e de PDF

| `span.type` | Offsets | Conferência com bytes |
| --- | --- | --- |
| `text` | `byte_start` inclusivo, `byte_end` exclusivo, em bytes UTF-8 da fonte | dentro de `size_bytes`, em fronteira UTF-8; `line_start`/`line_end` (1-based) só se conferem |
| `pdf-text` | `page` (1-based) e offsets no texto UTF-8 extraído da página | `extracted_text_hash` bate com o texto da página; offset nunca é do binário |

Duas evidências da mesma página da mesma fonte têm o mesmo `extracted_text_hash`: a página tem
um texto extraído só.

Sem bytes, a validação é só estrutural. `conferirFontes` recebe bytes que o chamador já
leu e devolve `verificada` ou `parcial`: `texto` exige UTF-8 válido, `pdf` traz as páginas
extraídas e `binario` confere só hash e tamanho, sem aceitar span. Fonte
ausente conta como indisponível, nunca como verificada. Span certo não prova que o parser
entendeu a relação; essa prova é a auditoria de arestas do benchmark.

## Tenant, ACL e não vazamento

Manifesto, nós, evidências, arestas e diagnósticos têm `access = { tenant_id, acl_refs }`,
com referências não vazias, ordenadas e sem repetição. O `tenant_id` é o do envelope em
todo lugar. Nó, evidência e diagnóstico carregam ao menos as referências da sua fonte; a
aresta carrega ao menos a conjunção das extremidades e das evidências. Perder uma restrição
é erro de contrato (`grafo.acesso.restricao-omitida`).

O contrato não tem campo de principal, dono ou papel: nada no payload autoriza leitura. A
autorização vem do transporte autenticado e da avaliação vigente da origem. Obrigações de
quem consumir o grafo (KG3 em diante):

1. Filtrar antes de resolver caminho, contar, resumir, paginar ou montar contexto.
2. Não mostrar dado negado como nó esmaecido, em contagem, em erro detalhado ou em cache
   compartilhado.
3. Particionar cache por escopo, política e revisão, e invalidar por revogação.
4. Sem avaliação autorizada, recusar com estado explícito, sem cair para similaridade nem
   para outro tenant.

O KG1 recusa contrato que perdeu restrição. Não implementa motor de ACL nem prova ausência
de vazamento de um serviço de consulta que ainda não existe.

## Validação e erros

| Função | Faz |
| --- | --- |
| `validarGrafo(entrada)` | estrutura e semântica; devolve a forma canônica ou lança `grafo.*` |
| `digestDoGrafo(entrada)` | SHA-256 da forma canônica |
| `derivarIds(rascunho)` | recalcula snapshot, nós e arestas para o produtor |
| `conferirFontes(entrada, fontes)` | hash, tamanho, UTF-8 e spans contra bytes fornecidos |

O erro traz o código e a posição estrutural (`edges.3.evidence.0`), nunca conteúdo nem
caminho da fonte. Erro de validação sai na posição da entrada, também quando vem de dentro de
`conferirFontes`; erro de conferência de bytes sai na posição da forma canônica que
`validarGrafo` devolve. Tipo de fonte fora de `texto`, `binario` e `pdf` é recusado
(`grafo.fonte.tipo-desconhecido`), e fonte sem `bytes`, ou `pdf` sem as páginas, também
(`grafo.fonte.incompleta`). Famílias: `grafo.versao`, `grafo.estrutura`,
`grafo.caminho`, `grafo.texto`, `grafo.canonico`, `grafo.manifesto`, `grafo.extrator`,
`grafo.snapshot`, `grafo.id`, `grafo.no`, `grafo.aresta`, `grafo.proveniencia`, `grafo.span`,
`grafo.acesso`, `grafo.fonte` e `grafo.diagnostico`.

Caminho é relativo à raiz declarada, com `/` e caixa preservada. São recusados: absoluto,
`\`, `:` no primeiro segmento (drive ou esquema de URL), `.`, `..`, segmento vazio,
qualquer escape percentual (`%2e`, `%252e`), controle C0 e C1, controles bidirecionais e
marcas invisíveis sem uso em nome (hífen suave, espaço de largura zero, juntores e controles
de formatação de U+2060 a U+206F, separadores de linha e parágrafo, BOM e anotação
interlinear). ZWJ e ZWNJ são aceitos, porque emoji e escritas como a persa dependem deles. O
produtor que tira um fragmento de um título com essas marcas (o tailandês usa espaço de
largura zero) as remove antes de montar o localizador. O contrato compara caminhos como texto e não normaliza Unicode nem caixa; dois
caminhos do manifesto que coincidem na forma NFC são recusados
(`grafo.manifesto.caminho-ambiguo`), porque um sistema de arquivos que normaliza os
fundiria. Fragmentos de localizador seguem a mesma regra de controle. Arquivo cujo caminho o
contrato recusa fica fora do grafo, e a v1 não tem onde registrar essa exclusão: o produtor
(KG2) tem de reportá-la fora do contrato até uma versão futura.

Limites: 100 mil entradas de manifesto, 100 mil nós, 500 mil arestas, 64 evidências por
aresta, 32 referências de ACL, 32 extratores, caminho de até 1024 caracteres. Acima deles o
payload é recusado, não truncado. Esses números são teto de contrato, não medida de
desempenho.

## Correspondência com o Company Brain

O contrato é do Ork e não é emitido como evento `orkmind.company-brain/v1`: o schema, o
corpus e o schema nativo do Company Brain ficam byte a byte como estão. A correspondência é
conceitual, sem encoder: snapshot e revisão correspondem a versão e hash de fonte;
proveniência, a referência e localização de origem; ACL, a restrições de origem; artefato,
a entidade ou afirmação só quando um contrato futuro do OrkMind permitir. Grafo local e
relação empresarial não são equivalentes, e seus namespaces não se misturam. Federação,
allowlist e ACL viva ficam no KG6. Veja
[Company Brain no corte C1](../../conceitos/arquitetura.md).

## Conformidade

O corpus `core/test/fixtures/code-artifact-graph-v1.json` é sintético: um grafo válido com
os quatro tipos de nó e os seis de aresta, uma fonte PDF por página, o digest esperado e
casos inválidos em JSON Patch com o código de erro esperado. Outra implementação pode
rodar os mesmos casos, desde que siga a precedência: versão, estrutura, coerência da revisão
do snapshot, regras semânticas na ordem manifesto, extratores, nós, arestas (com a regra de
pai único dentro do laço de arestas), ciclo de `contains` e diagnósticos, e só então o
recálculo de IDs. Cada caso do corpus aplica uma mutação só; a ordem das checagens dentro de
cada etapa é a do código de referência.

```sh
npm --prefix core run build:test && node --test core/dist-test/test/intelligence-graph-contract.test.js
```

Os grupos `KG1 graph`, `KG1 provenance` e `KG1 security` têm casos positivos e negativos.
Mudança incompatível exige novo identificador de versão e migração explícita; a v1 não muda
em silêncio.
