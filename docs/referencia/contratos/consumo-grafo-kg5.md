# Consumo do grafo pelas fases (KG5)

O KG5 deixa um agente numa fase (GOAL, PLAN, GO ou CHECK) consultar o grafo de código pelo MCP do
projeto, sem ler o repositório cru: cinco tools de leitura com o contrato do `ork grafo`, que
respondem pelo índice do HEAD da worktree da thread, com a proveniência de cada aresta, conferida
contra a árvore da thread, e a resposta limitada em bytes. O contrato
[`ork.code-artifact-graph/v1`](grafo-deterministico-kg1.md) não muda. É o quinto pacote do
[RM-031](../../roadmap/RM-031-grafo-de-codigo.md) e segue as decisões D1 a D10 da thread
`ork-rm031kg5cons`, tomadas em #Auto e registradas no ledger.

Fica desligado por padrão: a exposição e a habilitação são do dono. A fatia 1 entrega as quatro
consultas pelo MCP; a [fatia 2](#fatia-2-pacote-de-contexto-da-thread) acrescenta o pacote
determinístico da thread e a dica no pedido da fase, na thread `ork-rm031kg5fati`; a
[fatia 5](#fatia-5-proveniência-conferida-contra-a-árvore) faz cada resposta dizer, por aresta, se as
fontes dela conferem com a árvore, e traz o sha256 e o blob de cada fonte, na thread `ork-rm031grafo3`.

## O que o KG5 garante e o que não garante

| Garante | Não garante |
| --- | --- |
| Sem a flag, nada muda: as mesmas 31 tools, com os mesmos schemas, e o mesmo comando de despacho | Que a resposta é completa: o grafo só tem o que o extrator prova |
| A resposta da tool é, byte a byte, o JSON que o `ork grafo <consulta> ... --json --teto-bytes N` escreve na worktree da thread (a CLI só acrescenta a quebra de linha final) | Que o host não corta a resposta por um limite próprio |
| Toda aresta sai com toda a evidência: o teto tira arestas inteiras, as mais longe do alvo | Que a recusa cabe no teto: ele vale para a resposta |
| Sem os analisadores na instalação, a tool recusa com `grafo.parser.indisponivel`, nunca responde pela metade | Economia de contexto: isso é o benchmark do [protocolo](benchmark-grafo-kg1.md) |
| Sem o índice do HEAD, a recusa diz o caso e a correção; a tool nunca responde por outro índice | Que a aresta vale na árvore editada: a resposta é do HEAD; ela diz, por aresta, quando uma fonte mudou, sem refazer a extração |
| Toda aresta diz se as fontes dela (as duas pontas e as evidências) têm na árvore os bytes do índice, e a consulta por nó traz o sha256 e o blob de cada fonte citada (fatia 5) | Mudança que o `skip-worktree` ou o `assume-unchanged` esconde do `git status`: com o status limpo, nada é lido |
| O servidor MCP não carrega o grafo: a consulta roda num processo filho, com prazo e cancelamento | Prova numa sessão live de Claude Code ou Codex: os testes usam o servidor com transporte em memória |

## A flag

```yaml
grafo:
  mcp: false
```

`grafo.mcp` no `orkastery.yaml` da raiz do projeto liga as tools (D2). Ausente vale `false`; só o
booleano `true` liga (o YAML do núcleo lê `yes` e `no` como booleanos). Texto, número, lista ou
`grafo` que não é mapa valem `false`, com aviso no carregamento do manifesto, nunca erro; chave
desconhecida em `grafo` só avisa. Vale a flag do manifesto da raiz, que o servidor lê: a worktree de
uma thread não liga as tools mudando o próprio `orkastery.yaml`.

O servidor registra as tools no startup, e cada chamada confere a flag de novo: desligada com a
sessão aberta, a tool recusa com `grafo.mcp.desligado` antes de consultar. Ligada depois do startup,
vale para as sessões abertas depois.

## Pré-requisito

As tools rodam o `ork grafo` da instalação do `ork` que serve o MCP, e ele precisa do `typescript` e
do micromark no `node_modules` dessa instalação ([analisadores do KG3](indice-grafo-kg3.md#analisadores)).
Eles são dependências do pacote desde a correção de empacotamento da RM-031: o checkout de
desenvolvimento, o CI e o `npm install -g` os têm, e as versões publicadas antes dessa correção não
os levavam. Sem eles, toda chamada recusa com `grafo.parser.indisponivel`, e o `ork grafo indexar`
também; o check "analisadores do grafo" do `ork doctor` diz a correção. Ligar a flag só serve numa
instalação com os analisadores.

A versão do Node, as versões dos analisadores e os bytes do código do extrator entram na chave do
índice. O índice que a tool lê é o que tem a chave da instalação do `ork` que serve o MCP, com o Node
dela: indexado por outra instalação ou outro Node que dê outra chave, a tool recusa com
`grafo.indice.outro-extrator` e diz o que mudou.

## As tools

| Tool | CLI | Parâmetros |
| --- | --- | --- |
| `ork_grafo_vizinhos` | `ork grafo vizinhos` | `alvo`, `profundidade` (1 a 5), `sentido` (`entrada`, `saida`, `ambos`), `tipos`, `limite` (1 a 10.000), `tetoBytes` |
| `ork_grafo_chamadores` | `ork grafo chamadores` | `alvo` (símbolo), `profundidade`, `limite`, `tetoBytes` |
| `ork_grafo_importadores` | `ork grafo importadores` | `alvo` (arquivo ou símbolo), `profundidade`, `limite`, `tetoBytes` |
| `ork_grafo_caminho` | `ork grafo caminho` | `de`, `para`, `sentido`, `tipos`, `tetoBytes` |
| `ork_grafo_contexto` | `ork grafo contexto <thread>` | `threadId`, `tetoBytes`; contrato da fatia 2 abaixo |

Todas pedem `threadId` e aceitam `projeto`, que só confere o projeto servido, como as outras tools do
servidor. São de leitura (`readOnlyHint`), com schema fechado. A consulta roda na worktree da thread
(na raiz, para thread sem worktree), conferida pelo núcleo: a sessão filha vinculada a uma thread não
consulta a de outra (`mcp.thread.scope`). O nó tem a forma da [consulta do KG3](indice-grafo-kg3.md#consulta)
e não começa com `--`, porque o parser do `ork grafo` o leria como opção.

A tool monta o argv que a CLI receberia, com as opções na forma `--opcao=valor`, e devolve o que a CLI
escreve, sem transformar e sem a quebra de linha final que o terminal recebe (D6):

```text
ork_grafo_vizinhos {threadId, alvo: "src/a.ts#a", profundidade: 2, tipos: ["calls"]}
  = ork grafo vizinhos src/a.ts#a --profundidade=2 --tipo=calls --json --teto-bytes=32768
```

A resposta das quatro consultas por nó é o JSON `ork.code-graph-query/v0` da CLI, compacto, com o cabeçalho do índice (revisão,
chave, snapshot, digest, estado da árvore e extratores), os nós, as arestas com extrator, versão,
método, arquivo, linhas e bytes de cada evidência e a situação delas na árvore (`arvore`), as fontes
citadas (`fontes`, desde a [fatia 5](#fatia-5-proveniência-conferida-contra-a-árvore)), o aviso de
parcialidade e o campo `teto`.

## Teto da resposta

A resposta das tools tem no máximo `tetoBytes` bytes, 32.768 por padrão, de 4.096 a 65.536 (D4).
Nas quatro consultas por nó, o corte é da CLI, pela opção `--teto-bytes N`, que também vale fora do MCP:

- só com `--json`, e o JSON sai compacto; sem a opção, a resposta da CLI é a de antes (as recusas de
  índice ganharam o caso e a correção, abaixo);
- se a resposta pedida cabe, ela sai inteira, com `teto: {bytes, limite_pedido, cortado: false}`;
- se não cabe, vale o maior `limite` que cabe: as arestas mais longe do alvo saem primeiro, pela
  mesma ordem do `--limite`, `consulta.limite` passa a ser o efetivo, `truncado` fica `true` e
  `teto.cortado` também. O tamanho só cresce com o limite, então a busca binária acha sempre o mesmo;
- o caminho não se corta: se não cabe, a recusa é `grafo.consulta.teto-excedido`, e o mesmo vale
  quando nem a aresta mais perto do alvo cabe;
- a recusa sai compacta, mas não passa pelo teto: ela é curta, e o que pode crescer nela é o nó ecoado
  (até 2.048 caracteres nas tools) e a lista de até 20 candidatos do nome ambíguo.

## Recusas

| Código | Quando | No JSON |
| --- | --- | --- |
| `grafo.indice.ausente` | não há índice deste repositório (não indexado) | `estado_do_indice: "nao-indexado"`, `correcao: "ork grafo indexar"` |
| `grafo.indice.outra-revisao` | há índice deste repositório, de outra revisão: o HEAD andou depois da indexação, ou o guardado é o de outra árvore (a principal ou outra worktree, que dividem o estado) | `estado_do_indice: "outra-revisao"`, a correção |
| `grafo.indice.outro-extrator` | há índice da revisão do HEAD com outra chave: outra instalação do `ork`, outro Node, outros analisadores ou outro código do extrator; a recusa diz o que mudou | `estado_do_indice: "outro-extrator"`, a correção, com a mesma instalação de quem consulta |
| `grafo.indice.corrompido` | o índice do HEAD não passa na leitura (tamanho, digest) | `estado_do_indice: "corrompido"`, a correção |
| `grafo.consulta.teto-excedido` | a resposta não cabe no teto e não pode ser cortada | o tamanho e o teto no `detalhe` |
| `grafo.parser.indisponivel` | a instalação do `ork` que consulta não tem o `typescript` ou o micromark ([pré-requisito](#pré-requisito)) | o pacote que falta; sem correção pelo `ork grafo indexar` |
| `grafo.mcp.desligado` | a flag foi desligada com a sessão aberta | `{erro}`, como nas outras tools |
| `grafo.mcp.indisponivel` | o worker não respondeu (prazo, cancelamento, saída inesperada) | `{erro}` com o motivo |

As recusas da consulta (índice, nó ambíguo ou desconhecido, alvo inválido, teto) vêm como o JSON da
CLI, `{schema, erro: {codigo, detalhe, candidatos}}`, com `isError`; as do transporte (flag, thread,
worker, schema) vêm como `{erro}`, como em todo o servidor. As do índice também saem na CLI com
`--json`; em texto, a de índice ausente, de outra revisão ou de outro extrator manda rodar
`ork grafo indexar`, que constrói o índice do HEAD incremental a partir do ancestral
([KG4](incremental-grafo-kg4.md)).

No GO, cada commit move o HEAD: a consulta seguinte recusa com `grafo.indice.outra-revisao` até o
`ork grafo indexar` (incremental, alguns segundos), que exige a árvore limpa. Com mudança ainda não
commitada, a consulta responde pelo índice do HEAD e diz isso no campo `indice.arvore`
(`modificada`) e, desde a fatia 5, em cada aresta que a mudança alcança (`arvore`).

## Execução

Cada chamada abre um processo filho, o worker (`core/src/mcp-grafo-worker.ts`), D3:

| Regra | Como |
| --- | --- |
| Ambiente | o mínimo do MCP: `HOME`, `USER`, `LOGNAME`, `XDG_CONFIG_HOME`, `PATH=/usr/bin:/bin`, `LANG` e `TMPDIR`; nada do cliente, como `NODE_OPTIONS` ou variável do Git |
| Grupo | processo em grupo próprio; prazo de 60 s, cancelamento da chamada e stdout acima de 1 MiB matam o grupo |
| Entrada | `{raiz, argv}` pelo stdin, com schema; o cwd tem de ser a raiz pedida, e o manifesto, o dela |
| Argv | só as cinco consultas, com `--json`, `--teto-bytes` e as opções que a tool monta; `indexar`, `limpar`, `amostra` e `status` recusam |
| CLI | chama o `executarGrafo` direto: o `main` do `ork` não roda, então nada vira `--projeto`, `--version` ou `--help` |
| Saída | 0 é resposta, 1 é recusa tipada da consulta (JSON no stdout), 2 é entrada recusada pelo próprio worker |

Não há cache do grafo no servidor nem entre chamadas: cada uma lê o índice do HEAD com a integridade
de sempre (tamanho e digest). O servidor fica sem o compilador e sem o grafo em memória.

## Despacho

Com a flag, o despacho `claude-bg` põe as cinco tools (`mcp__orkastery__ork_grafo_*`) na allowlist da
sessão filha logo depois das consultas, nos perfis `interactive` e `worktree` e no PLAN (D7); sem a
flag, o comando é o de antes. A flag é lida do manifesto da raiz pelo contexto do runtime, a mesma que
o servidor da sessão filha lê. No Codex nada muda: as tools são de leitura, como as consultas, e não
pedem grant. Na fatia 1, o prompt não mudava (D10); a fatia 2 acrescenta a dica descrita abaixo, e a
fatia 5 acrescenta a ela o que a marca `arvore: modificada` quer dizer.

## Fronteira

O worker é a segunda porta da família do grafo, depois do `index.ts`, e só pelo CLI dela; o
fechamento de imports do servidor MCP não alcança módulo do grafo (D8,
`core/test/intelligence-kg1-boundary.test.ts`). Os módulos da impressão do extrator não mudam, então a
chave dos índices guardados é a mesma do KG4. O Company Brain v1 e o adaptador semântico ficam intactos,
com os hashes congelados.

## Custo medido

Registro em
[`core/test/fixtures/kg5-medida-mcp.json`](../../../core/test/fixtures/kg5-medida-mcp.json)
(`ork.graph-mcp-cost/v0`), gerado por `core/scripts/medir-mcp-grafo.cjs` na revisão `b91573e6` da
branch da thread `ork-rm031grafo3` (fatia 5, com `fontes` e `arvore` na resposta), num clone com a
árvore limpa, carga 14,3 em 8 núcleos, Node v22.23.2 e 3 repetições por braço, nas seis perguntas da
[medida do KG3](indice-grafo-kg3.md#primeira-medida-do-custo-de-consulta) (D9).
**Não é o benchmark `ork.graph-benchmark/v1`** e não conclui economia.

- **Tool:** o worker com o argv que a tool monta e o teto padrão; ao agente chega o texto da resposta.
- **CLI:** `ork grafo <consulta> --json`, sem teto (o braço do grafo do KG3).
- **Cru:** `git grep -n -I -F` do nome e a leitura inteira de cada arquivo com ocorrência (o do KG3).
- **Tokens:** `unavailable` nos três braços.

| Pergunta | Tool: bytes | Tool: arestas | Tool: latência | CLI: bytes | CLI: arestas | Cru: bytes | Cru: arquivos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 quem chama `lerRepositorio` | 2.964 | 1 de 1 | 1.331,1 ms | 3.686 | 1 | 332.153 | 12 |
| P2 quem chama `dirEstado` | 16.997 | 18 de 18 | 1.304,6 ms | 23.153 | 18 | 764.962 | 27 |
| P3 quem importa o contrato do grafo | 14.132 | 13 de 13 | 1.643,9 ms | 18.838 | 13 | 1.215.032 | 32 |
| P4 quem importa o leitor de YAML | 10.417 | 10 de 10 | 1.278,7 ms | 14.127 | 10 | 304.308 | 13 |
| P5 vizinhança de `raizDoEstado` | 32.145 | 34 de 123, cortada | 1.244,7 ms | 140.204 | 123 | 1.593.128 | 59 |
| P6 caminho de `main` a `dirEstado` | 4.985 | 2 de 2 | 1.154 ms | 6.716 | 2 | indisponível | indisponível |

**Descoberta**, o custo fixo de ligar a flag: as cinco definições somam 7.735 bytes no `tools/list`,
que vai de 24.234 para 31.974 bytes (de 31 para 36 tools), num projeto temporário com e sem a flag.

O retrato da fatia 1, na revisão `9000f52e` (carga 7,4, quatro tools, sem `fontes` nem `arvore`), fica
como estava medido:

| Pergunta | Tool: bytes | Tool: arestas | Tool: latência | CLI: bytes | CLI: arestas | Cru: bytes | Cru: arquivos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 quem chama `lerRepositorio` | 2.525 | 1 de 1 | 782,7 ms | 3.148 | 1 | 292.510 | 12 |
| P2 quem chama `dirEstado` | 14.009 | 18 de 18 | 815,4 ms | 19.426 | 18 | 638.111 | 26 |
| P3 quem importa o contrato do grafo | 8.136 | 9 de 9 | 781,6 ms | 11.015 | 9 | 569.720 | 21 |
| P4 quem importa o leitor de YAML | 8.074 | 10 de 10 | 787,1 ms | 11.235 | 10 | 273.815 | 13 |
| P5 vizinhança de `raizDoEstado` | 32.087 | 41 de 104, cortada | 758,9 ms | 106.363 | 104 | 1.179.908 | 51 |
| P6 caminho de `main` a `dirEstado` | 4.325 | 2 de 2 | 783,2 ms | 5.880 | 2 | indisponível | indisponível |

Na fatia 1, as quatro definições somavam 5.931 bytes, e o `tools/list` ia de 23.289 para 29.224 bytes
(de 30 para 34 tools). As duas tabelas medem revisões diferentes, com o repositório maior na segunda:
o custo do formato novo, isolado no mesmo índice, está na [fatia 5](#teto-e-custo).

Como ler, sem concluir além do medido:

- Bytes não são tokens: o hex dos ids e o JSON tokenizam diferente de prosa.
- A tool corta pelo teto: na P5 ela entrega 34 das 123 arestas, as mais perto do alvo, e diz que cortou.
  Sem corte, a resposta da tool tem as mesmas arestas da CLI, em JSON compacto.
- As respostas dos braços não são as mesmas: o grafo só responde o que o extrator prova, e a leitura
  crua acha texto, comentário e nome igual em outro escopo.
- A descoberta é paga por sessão com a flag ligada, mesmo sem consulta; quanto dela chega ao modelo
  depende de como o host carrega as definições.
- A latência da tool inclui a partida do Node e a leitura do índice a cada chamada; cada worker lê e
  monta o índice inteiro em memória, e não há limite de workers simultâneos além das chamadas do host.
- A leitura crua cresce com o próprio repositório: o nome de um símbolo citado em docs e testes novos
  aumenta os arquivos com ocorrência.

```sh
node core/scripts/medir-mcp-grafo.cjs --conferir
node core/scripts/medir-mcp-grafo.cjs --validar core/test/fixtures/kg5-medida-mcp.json
```

`--conferir` mede de novo no HEAD e confere que a resposta da tool é a do `ork grafo` com o mesmo argv
(sem a quebra de linha final),
que cabe no teto e que o trecho de cada evidência, no blob do HEAD, cita o alvo da aresta. `--validar`
confere a forma do registro e recusa token medido sem medida e texto que prometa economia.

## Fatia 2: pacote de contexto da thread

A fatia 2 introduziu `ork grafo contexto <thread>` e `ork_grafo_contexto`, a dica opt-in no
pedido da fase e o compositor puro. A fatia 3 substitui integralmente seu wire format v0 pelo
**`ork.thread-graph-context/v2`**. A flag permanece desligada, sem consumidor a migrar.

## Fatia 3: pacote compacto e relevante

```sh
ork grafo contexto <thread> --json
ork grafo contexto <thread> --json --teto-bytes 8192
```

`ork_grafo_contexto {threadId, tetoBytes?}` entrega os mesmos bytes do JSON da CLI. A CLI sem
`--json` acrescenta um resumo fora do teto. O índice deve corresponder ao HEAD da worktree;
sem worktree usa-se o HEAD da raiz somente para consultar o índice. Nenhuma consulta indexa
implicitamente nem altera estado.

### Fontes e sementes

As fontes são caminhos do diff contra a base, GOAL/PLAN e claims ativas. Caminhos públicos
relativos são deduplicados com suas origens. Código inline e links aceitam referências explícitas;
em prosa, caminhos com diretório e extensões de fonte conhecidas. `v0.5.0`, `Node.js` e domínios
como `example.com` não viram sementes. Para nomes ambíguos, use código inline.

**Sem worktree vinculada, o diff é ignorado**, inclusive alterações locais e o que entrou na
`main` depois da base: `fontes.diff: "ignorado-sem-worktree"`. Com worktree,
`fontes.diff: "coletado-na-worktree"`. Esta proteção evita atribuir mudanças de outras threads
à consultada; GOAL, PLAN e claims continuam disponíveis. A base continua identificada, sem
pretender que o índice atual representa a árvore histórica da base.

As sementes indexadas entram primeiro, em ordem UTF-8. As ausentes entram depois das ligações,
limitadas às **três primeiras** na mesma ordem; `sementes_fora_do_indice` conta todas.
`total_sementes` e `omitidos.sementes` incluem as ausentes. Caminhos absolutos, URLs e estado
privado são recusados como sementes. Em GOAL/PLAN, inclusive código e links, o token precisa
ter extensão conhecida, nome especial de arquivo (como `Dockerfile`) ou prefixo de diretório
presente no índice consultado. `e/ou`, `CHECK/SHIP`, `03/10/2026` e `imports/references`
não ocupam a amostra de ausentes; um arquivo novo com extensão conhecida continua elegível.
Diff e claims já declaram caminhos e não passam pelo filtro de prosa. O grafo já deve estar
filtrado pela concessão.

### Wire format v2

- `nos` é uma tabela única `{n1: "file src/app.ts", n2: "symbol src/alvo.ts#alvo", ...}`.
  As referências são locais ao pacote, atribuídas pela ordem UTF-8 dos rótulos; não são IDs
  persistentes entre respostas. `node_id` e `edge_id` longos não são transmitidos. O cabeçalho
  identifica revisão, snapshot e digest para reencontrar os nós no índice.
- `arestas` contém grupos `{kind, from, to, quantidade, evidencias}`. A chave da agregação é
  **tipo, nó alvo e arquivo de origem**; `from` aponta ao rótulo `file` da origem. `quantidade`
  conta arestas originais, não tuplas; evidências idênticas são deduplicadas. Não há lista
  redundante de símbolos chamadores: os spans permitem localizar cada chamada no arquivo.
  Na fatia 4, grupos do segundo salto acrescentam `salto: 2`; a ausência do campo significa
  ligação direta. O schema permanece `ork.thread-graph-context/v2`.
- Cada evidência é `[extrator, método, linhas, bytes]`: `extrator` é o índice numérico, começando
  em zero, na tabela ordenada `indice.extratores`; `linhas` é `[início, fim]`, inclusivo, com
  `null` quando indisponível; `bytes` é `[início, fim]` UTF-8, fim exclusivo. O caminho é o de
  `from`. Para spans PDF, `linhas` usa `["pdf", página, hash_do_texto_extraído]`; os bytes se
  referem ao texto extraído, não ao PDF binário. Evidência auxiliar em arquivo diferente da
  origem é omitida e contada em `omitidos.evidencias_auxiliares`, sem derrubar o pacote.
  Se a aresta não tem evidência no arquivo de origem, ela fica em `omitidos.arestas`;
  nenhuma ligação é entregue com uma tupla atribuída ao arquivo errado.
- `declares` e `contains` internos ao arquivo semente saem da lista e são contados em
  `resumidas.estruturais`. Não são relações perdidas pelo teto.

A vizinhança começa por um salto, nos dois sentidos, incluindo símbolos/seções das sementes.
Dentro dele, a ordem de relevância é: **entre arquivos diferentes**, depois **menor distância ao diff**
(distância no grafo não dirigido de arquivos, não distância em linhas). Empates intercalam tipos
por rodada de cada alvo; depois tipo (com `cites` por último) e rótulos em UTF-8. Sem diff conhecido,
todas as distâncias empatam. Há no máximo **oito grupos por nó alvo**. Isso limita hubs de vários
arquivos e preserva diversidade de tipos dentro da mesma prioridade.

Na fatia 4, depois desse corte e da amostra de sementes ausentes, o orçamento restante admite
ligações entre arquivos a dois saltos das sementes indexadas. Qualquer ligação direta tem
prioridade sobre elas, inclusive uma ligação interna à semente. Só se expande por uma ponte
presente nas ligações diretas que couberam; ponte cortada ou sem evidência própria não sustenta
a expansão. A fronteira fica fixa: não há terceiro salto nem expansão das declarações internas
dos vizinhos. `consulta.profundidade` passa a 2, em ambos os sentidos; `salto: 2` identifica os
grupos indiretos, sem alterar referências locais nem tuplas de evidência. O limite de oito grupos
por alvo é compartilhado com o primeiro salto. `total_ligacoes` e `total_arestas` incluem candidatos
de ambos os saltos, inclusive os omitidos por falta de ponte selecionada.

O teto do JSON completo é 32.768 bytes, de 4.096 a 65.536, incluindo cabeçalho e medida.
Cada grupo entra com as pontas e todas as tuplas. Se um grupo não cabe, tenta-se o próximo;
não se corta uma evidência nem se deixa um hub grande impedir todas as relações menores.
No segundo salto, oito rejeições consecutivas por bytes encerram a tentativa de expansão;
um grupo aceito reinicia a contagem. Grupos descartados pelo limite por alvo não montam o
pacote nem alteram essa contagem. Esse limite pode deixar grupos menores posteriores sem tentativa.

`omitidos.ligacoes` conta apenas grupos **diretos** omitidos. O campo aditivo
`omitidos.segundo_salto` conta grupos indiretos omitidos por bytes, por alvo, por falta de ponte
ou pela parada das tentativas. Permanece o schema `ork.thread-graph-context/v2`.
`truncado`/`teto.cortado` abrangem as omissões de sementes e da vizinhança **direta**: corte por
bytes, por alvo, arestas sem evidência própria ou evidências auxiliares omitidas. Omissões do
segundo salto não ativam essas marcas; mesmo `truncado: false` pode ter `omitidos.segundo_salto > 0`.

`omitidos.arestas` conta arestas originais de ambos os saltos; `omitidos.evidencias_auxiliares`
também cobre as arestas candidatas não estruturais dos dois saltos, inclusive as que depois
não cabem no teto. Esses dois totais não ativam `truncado` quando a perda é só indireta.
As identidades são:
`total_ligacoes = arestas.length + omitidos.ligacoes + omitidos.segundo_salto` e
`total_arestas = soma(quantidade) + omitidos.arestas + resumidas.estruturais`.
Pacote vazio é válido. As consultas por nó permitem aprofundar o que ficou de fora.

### Fatia 4: citações literais no índice

`cites` é uma aresta extraída de citação literal para um **arquivo existente no manifesto**,
com evidência de arquivo, linhas e bytes. Sua origem é arquivo ou seção; não prova importação,
chamada, uso em execução nem impacto semântico. Os tipos anteriores de aresta permanecem.

- Markdown: caminhos em código inline ou destinos de links inline/imagens reconhecidos pelo
  analisador CommonMark. Código cercado, comentários HTML e caminhos soltos na prosa não entram.
  Código inline usa caminho desde a raiz ou `./`/`../` desde o documento. Links procuram primeiro
  o caminho relativo ao documento e depois o literal desde a raiz; âncora e busca não fazem parte
  do caminho. Se o link já gerou `references` ao arquivo ou a uma seção dele, a mesma ocorrência
  não gera `cites`, inclusive no código inline do rótulo. Código inline fora do link, mesmo na
  mesma linha, continua independente. A citação continua possível quando apenas o caminho desde
  a raiz resolve.
  Links externos, caminhos que escapam da raiz, estado privado e alvos ausentes não geram `cites`.
  Não há resolução adicional de links por definição de referência.
- TypeScript/JavaScript em diretórios `test`, `tests`, `__tests__`, `script` ou `scripts`, ou nomes
  `*.test.*`/`*.spec.*`: strings e templates sem interpolação que citam caminhos, inclusive
  argumentos literais de `require(...)`/`import(...)` dentro de uma string de fixture. Comentários
  e expressões dinâmicas não são avaliados. Literais de imports ou requires já resolvidos pelo
  extrator não geram `cites`; outra string com o mesmo texto é uma ocorrência independente.
  A evidência cobre o literal completo no arquivo real.
- Caminhos comuns exigem `/` e extensão conhecida de código, documento ou asset: TS/JS
  (`ts`, `tsx`, `cts`, `mts`, `js`, `jsx`, `cjs`, `mjs`), `json`, `md`,
  `markdown`, `yaml`, `yml`, `toml`, `py`, `rs`, `go`, `c`, `h`, `css`, `html`, `svg`, `png`,
  `jpg`, `jpeg`, `gif`, `webp`, `pdf`, `txt`, `sh` ou `sql`. Argumentos de módulo podem omitir
  extensão, mas exigem prefixo de caminho; nomes de pacote como `zod` e `typescript` não geram
  sondas de citação. Bases vazias são recusadas. Diretório nunca é alvo de `cites`, mas o candidato
  exato e as variantes de extensão e `index` ficam como sondas, inclusive diretório com extensão no
  nome, na troca de diretório por arquivo e na volta. Palavras como `core` e `docs` não geram sondas de citação.
- A resolução de módulo tenta o caminho exato, variantes de extensão e `index`; `.js`/`.mjs`/
  `.cjs`/`.jsx` admitem fontes TypeScript. Na ausência, a convenção `dist/` → `src/` permite, por
  exemplo, `require('../dist/x')` citar `../src/x.ts`. Só um alvo no primeiro grupo de candidatos
  existente é aceito; ambiguidade recusa, sem escolher pelo nome. Isso é uma convenção de citação,
  não uma reprodução do resolver do Node: não consulta disco, aliases, pacotes ou rede.

A ligação Markdown é refeita sobre o manifesto atual. As unidades TypeScript guardam sondas
também para candidatos ausentes, para criação, remoção ou ambiguidade invalidar citações antigas.
O hash do código dos extratores já participa da chave do índice; um índice anterior exige
`ork grafo indexar`. A flag `grafo.mcp` continua desligada por padrão.

O comparador de `medir-mcp-grafo.cjs --contexto` permanece `ork.graph-context-cost/v3`, com as
mesmas sementes, exports de pelo menos quatro caracteres e `grep -w` da fatia 3. A fixture
histórica e os resultados de cobertura, precisão e custo estão descritos na seção **Fatia 4**
em [Dica e medidas](#dica-e-medidas), atualizada pela condutora após cada nova medida.

A mesma entrada e índice produzem bytes idênticos, mesmo com coleções permutadas. O compositor
`core/src/intelligence-graph-contexto.ts` não faz E/S. CLI e worker compartilham o leitor da thread.
As recusas de índice ausente, de outra revisão/extrator ou corrompido mantêm `estado_do_indice`
e `correcao: "ork grafo indexar"`, agora no schema v2, sem fornecer nós. Base inválida,
falha no diff de uma worktree ou incompatibilidade da worktree recusam o pacote; mudança do
HEAD durante a leitura recusa com `grafo.contexto.revisao-mudou`.

### Dica e medidas

Com `grafo.mcp: true` na raiz, o pedido da fase recebe a dica curta de contexto, as quatro
consultas por nó, correção do índice e parcialidade e, desde a fatia 5, o que a marca
`arvore: modificada` quer dizer. A dica entra antes da renderização e do hash do prompt. Com a flag
ausente ou `false`, o prompt permanece byte a byte igual ao anterior.

`medida.pacote_bytes` mede o JSON UTF-8 completo, incluindo esse campo. `leitura_crua_bytes`
é apenas a soma dos tamanhos do `source_manifest` dos arquivos presentes no pacote, listados
em `medida.arquivos`. **Essa soma não é o custo de descobrir a vizinhança sem o grafo.**
Não mede a árvore editada; tokens permanecem `unavailable`.

Na mesma fixture sintética de 30 funções chamadoras e três arquivos, o v2 mediu **3.119 bytes**,
sem corte, contra os **22.973 bytes** registrados no v0: aproximadamente **7,4 vezes menor**.
Os arquivos continuam somando **1.567 bytes**. A redução supera a meta de 4–5 vezes para essa
fixture; ela não demonstra economia de tokens nem cobertura em trabalho real. Depois da fatia 4, a
mesma fixture dá 3.137 bytes, na base da fatia 5 e com o código dela.

```sh
npm --prefix core run build:test
node --test-name-pattern='KG5 medida offline' core/dist-test/test/rm031-kg5-contexto.test.js
```

A medição histórica está registrada em `core/test/fixtures/kg5-medida-contexto.json`
(`estado: measured`), produzida por `core/scripts/medir-mcp-grafo.cjs --contexto` para duas
threads já mescladas: KG3 (`c507a3a`, semente `core/src/intelligence-graph-extract.ts`) e KG4
(`99b10d3`, semente `core/src/intelligence-graph-index.ts`). Os identificadores curtos vêm deste
roadmap; o script resolve os SHAs completos, exige dois pais e comprova ancestralidade na `main`.
Extrai em memória os blobs da base comum dos pais, sem checkout, indexação persistente ou escrita
no estado. As sementes são retrospectivas e fixas, não uma reconstrução dos prompts originais.

O braço sem grafo lê a mesma semente, extrai pelo AST TypeScript somente nomes exportados
explicitamente com **quatro caracteres ou mais** e usa `git grep -n -I -F -w`. Nomes locais,
comentários e strings não fornecem termos; aliases usam o nome público. Não expande `export *`
nem usa o nome local de um `export default`. Sem termos elegíveis, não executa grep.
Lê integralmente os arquivos encontrados e as saídas relativas explícitas da semente.
Contabiliza **saída do grep + bytes lidos**, incluindo cada arquivo uma vez. Divergências de
vizinhança são listadas, pois busca textual ainda pode incluir homônimos/comentários.

Só depois de produzir os dois braços o script lê o diff entregue pelo merge. O denominador
da **cobertura do alcançável** é o número de arquivos editados que **já existiam na base**:
`total_acertos / total_editados`. Novos arquivos ficam em `resultado.arquivos_novos`, fora desse
denominador, pois nenhum dos braços poderia encontrá-los. A **precisão** de cada braço é
`total_acertos / total_apontados`; sementes contam em ambos, com acertos fora das sementes
reportados à parte. Denominador vazio produz `null`, não uma porcentagem inventada.

**Pacote pequeno e preciso nos vínculos apresentados, com cobertura parcial; sem conclusão
de economia de tokens.** Na rodada anterior, o pacote tinha 15.096 bytes no KG3 e 16.948 no KG4;
os editados entre os apontados eram 3/7 e 7/8. Essa precisão de seleção varia por caso e não
significa cobertura completa. A comparação anterior com a descoberta não sustenta a manchete
“15 KB contra 28 MB”: o grep admitia variáveis locais curtas e substrings, alcançando quase
todo o repositório. Seus bytes e sua cobertura não valem como referência da metodologia corrigida.

O registro offline passa de `ork.graph-context-cost/v2` para **`ork.graph-context-cost/v3`**;
o pacote continua `ork.thread-graph-context/v2`. A fixture v2 existente é uma medida executada,
não `not-run`, mas o validador corrigido a recusa como método desatualizado. A condutora regravou
a fixture após os commits do GO-FIX (03/10/2026) e preencheu os números abaixo com a nova rodada:

| Caso | Braço | Bytes ao agente | Precisão (editados/apontados) | Cobertura do alcançável (acertos/editados na base) |
| --- | --- | --- | --- | --- |
| KG3 | Pacote | 15.122 | 3/7 (43%) | 3/13 (23%) |
| KG3 | Descoberta | 723.688 | 3/41 (7%) | 3/13 (23%) |
| KG4 | Pacote | 16.974 | 7/8 (88%) | 7/17 (41%) |
| KG4 | Descoberta | 299.953 | 6/11 (55%) | 6/17 (35%) |

Arquivos novos, contados separadamente: **10** no KG3 e
**9** no KG4. Origem dos valores: `casos[0]` (KG3) e `casos[1]` (KG4),
`pacote/descoberta.bytes_ao_agente`, `cobertura_pacote/cobertura_descoberta.precisao` e `.cobertura`,
com as respectivas contagens; novos vêm de `resultado.arquivos_novos.length`.
Os dois braços não medem a mesma coisa: o pacote é só o mapa, e a descoberta soma a saída do grep à leitura inteira de cada arquivo achado. Mapa contra mapa (o pacote contra a saída do grep, 33.070 e 25.988 bytes), o pacote é 2,2 e 1,5 vez menor. A precisão do pacote é maior nos dois casos (43% e 88% contra 7% e 55%). A cobertura empata no KG3 (23%), graças a um único acerto por referência de Markdown, e é maior no KG4 (41% contra 35%). O braço sem grafo não busca o caminho da semente, o que pode subestimar a cobertura dele. Nomes exportados que são palavras comuns (por exemplo, `Lacuna`) trazem docs e skills para a descoberta e inflam os bytes dela. São dois casos do mesmo subsistema, sem conclusão sobre tokens.

**Fatia 4 (citações literais e segundo salto), medida v3 regravada pela condutora em 03/10/2026**
com o mesmo comparador e a mesma descoberta. A tabela acima fica como o retrato da fatia 3.

| Caso | Braço | Bytes ao agente | Precisão (editados/apontados) | Cobertura do alcançável (acertos/editados na base) |
| --- | --- | --- | --- | --- |
| KG3 | Pacote | 28.015 | 9/25 (36%) | 9/13 (69%) |
| KG3 | Descoberta | 723.688 | 3/41 (7%) | 3/13 (23%) |
| KG4 | Pacote | 32.706 | 11/18 (61%) | 11/17 (65%) |
| KG4 | Descoberta | 299.953 | 6/11 (55%) | 6/17 (35%) |

A cobertura do pacote sobe de 23% para 69% no KG3 e de 41% para 65% no KG4, e passa a da descoberta
nos dois casos. A precisão cai (de 43% para 36% e de 88% para 61%), mas continua acima da descoberta.
O custo é o tamanho: o segundo salto usa a sobra do orçamento, e o pacote quase dobra. Mapa contra
mapa, o pacote ainda é menor que a saída do grep no KG3 (28.015 contra 33.070 bytes), mas é maior no
KG4 (32.706 contra 25.988). São dois casos do mesmo subsistema, sem conclusão sobre tokens.

`--conferir` refaz a medida e compara o **sha256 dos bytes do pacote** de cada caso com a fixture,
além do registro determinístico completo. Diferença de hash ou métrica reprova; somente produzir
um pacote determinístico duas vezes já não basta. A sequência de regravação e conferência é:

```sh
npm --prefix core run build
node core/scripts/medir-mcp-grafo.cjs --contexto --saida core/test/fixtures/kg5-medida-contexto.json
node core/scripts/medir-mcp-grafo.cjs --contexto --validar core/test/fixtures/kg5-medida-contexto.json
node core/scripts/medir-mcp-grafo.cjs --contexto --conferir
```

Dois casos do mesmo subsistema não representam todas as threads. Preparo do índice e descoberta
das tools são custos separados do pacote. Nenhum número de tokens ou latência é inferido.
Os testes puros passaram e detectaram oito mutações temporárias no JavaScript compilado: quebra
de fan-in, offset de span, teto por alvo, amostra de ausentes, diff sem worktree, proximidade,
intercalação de tipos e prioridade entre arquivos. O código foi restaurado e os testes passaram
novamente. O GO-FIX acrescenta a prova executável de três mutações dos termos: admitir nomes
curtos, admitir locais e retirar `-w`; todas precisam derrubar a mesma prova da descoberta.
Comando: `node --test-name-pattern="KG5 medida historica" core/dist-test/test/rm031-kg5-contexto.test.js`.
Esses ensaios locais não são recibo oficial do núcleo.

Os testes integrados CLI/worker/MCP exigem subprocessos permitidos; a passagem dos testes puros
não substitui a suíte, `ork verify` ou a revisão independente da condutora.

## Fatia 5: proveniência conferida contra a árvore

Thread `ork-rm031grafo3`, decisões D1 a D10 tomadas em #Auto e registradas no ledger. Antes dela,
num clone com três linhas inseridas no topo de `core/src/intelligence-graph-index.ts`, sem commit,
`ork grafo chamadores core/src/intelligence-graph-repo.ts#lerRepositorio --json` devolvia a aresta
`calls` com evidência na linha 501, que no arquivo editado é `}`, e só o cabeçalho dizia
`arvore: modificada`. A resposta também não trazia o `source_hash` nem o `source_version` que o
[contrato KG1](grafo-deterministico-kg1.md#proveniência-por-aresta) põe em cada evidência.

### O que a resposta traz

- **`fontes`**, nas quatro consultas por nó, antes de `parcial`: uma entrada por caminho citado (os dos
  nós e os das evidências devolvidas), em ordem UTF-8, com `path`, `source_hash` (sha256 dos bytes
  indexados), `source_version` (o blob do Git) e `arvore`: `igual` (a árvore tem esses bytes),
  `modificada` (outros bytes) ou `ausente` (não há arquivo regular legível no próprio caminho
  indexado, sem link no caminho). Uma entrada por caminho, não por evidência: o contrato KG1 garante que hash e versão de toda
  evidência são os do manifesto daquele caminho. A autoridade fica fora: é sempre `git:<repositório>`,
  e o cabeçalho já traz o repositório (D2).
- **`arvore` em cada aresta**, entre `distancia` e `evidencias`: `igual` só quando todas as fontes
  dela estão iguais, o arquivo da origem, o do alvo e os das evidências; senão, `modificada`. O alvo
  conta porque `calls` e `imports` resolvem o alvo no arquivo dele: marcar a mais leva a reconferir, e
  marcar a menos levaria a confiar numa evidência velha (D4). No caminho, os passos repetem as arestas
  com a mesma marca.
- **No pacote v2**, só o grupo cuja origem ou alvo não confere ganha `arvore: "modificada"`; sem o
  campo, as fontes do grupo conferem. O pacote não ganha tabela de fontes e segue
  `ork.thread-graph-context/v2`: com a árvore limpa, os bytes são os de antes, e a medida histórica e
  a fixture sintética continuam valendo (D5). Com a árvore modificada, a marca ocupa bytes do teto e
  pode trocar ou tirar ligações da seleção, sempre do mesmo jeito para a mesma árvore. A proveniência
  completa de um grupo sai da consulta por nó.
- **No texto da CLI**, a aresta de fonte mudada ganha `[fonte modificada na arvore]` na linha, e uma
  linha lista até cinco fontes que mudaram, com a situação de cada uma; o resumo do
  `ork grafo contexto` conta as ligações marcadas (D9). O exemplo do começo, com o código da fatia:

```text
aviso: a arvore tem mudanca rastreada; a resposta e do HEAD, nao da arvore
fontes que mudaram na arvore: core/src/intelligence-graph-index.ts (modificada)
  calls  symbol core/src/intelligence-graph-index.ts#construirIndice -> symbol core/src/intelligence-graph-repo.ts#lerRepositorio  [fonte modificada na arvore]
      ork.ts-ast ast core/src/intelligence-graph-index.ts:501 bytes 24702-24717
```

### Como a situação é lida

- O CLI do grafo só lê a árvore quando o cabeçalho diz `modificada`, pelo `git status` dos rastreados,
  como antes. Com a árvore limpa, toda fonte vale `igual` e nada é lido. Limite aceito: a mudança que o
  `skip-worktree` ou o `assume-unchanged` esconde do `git status` passa como `igual`, o mesmo limite do
  `indice.arvore` (D3).
- Com a árvore modificada, cada caminho citado pelas respostas que a consulta monta é lido uma vez, sob
  demanda: só caminho do manifesto do índice e só arquivo regular, sem seguir link, nem no último nome
  nem numa pasta do caminho: o caminho real tem de ser o próprio caminho indexado, mesmo quando o link
  aponta para uma cópia idêntica dentro da raiz. Tamanho diferente do indexado já é `modificada`, sem
  abrir; no resto, decide o sha256 dos bytes, lidos até o tamanho indexado mais um, contra o
  `source_hash`. O arquivo aberto tem de ser o mesmo do `lstat` (dispositivo e inode): uma troca entre a
  conferência e a abertura vira `ausente`; duas trocas seguidas nesse intervalo ainda passam e revelariam
  só se os bytes são os indexados. FIFO no lugar da fonte não trava a consulta, e nada é escrito (D6).
- Com teto, a busca binária monta respostas com limites diferentes, e a primeira é a do limite pedido:
  são lidos os arquivos que ela cita, mesmo os que o corte depois tira.
- A consulta continua pura: recebe a situação de quem chama, e sem ela tudo vale `igual`. O worker e o
  servidor não mudam, e a resposta da tool segue igual à da CLI byte a byte.
- Nenhum módulo da impressão do extrator muda: a chave dos índices guardados é a mesma, e ninguém
  reindexa por causa da fatia.

### Teto e custo

`fontes` e as marcas contam no teto. O corte continua pelo limite, as arestas mais longe saem primeiro,
e `fontes` só traz os caminhos dos nós e das evidências que ficaram; o tamanho segue crescendo com o
limite, então a busca binária acha o maior limite que cabe, sempre o mesmo para a mesma árvore. O
caminho continua sem corte, e a recusa não muda (D10).

Custo medido nesta thread no mesmo índice (revisão `b91573e6`, árvore limpa), com o teto padrão, pelo
CLI da base `8248d98d` e pelo da fatia; os dois leem o mesmo índice porque o extrator não mudou. Os
bytes são os da saída da CLI, com a quebra de linha final (a tool entrega um byte a menos):

| Pergunta | Base: bytes | Base: arestas | Fatia 5: bytes | Fatia 5: arestas | Fontes |
| --- | --- | --- | --- | --- | --- |
| P1 | 2.526 | 1 de 1 | 2.965 | 1 de 1 | 2 |
| P2 | 14.012 | 18 de 18 | 16.998 | 18 de 18 | 14 |
| P3 | 10.986 | 13 de 13 | 14.133 | 13 de 13 | 14 |
| P4 | 8.075 | 10 de 10 | 10.418 | 10 de 10 | 11 |
| P5 | 32.460 | 41 de 123, cortada | 32.146 | 34 de 123, cortada | 21 |
| P6 | 4.334 | 2 de 2 | 4.986 | 2 de 2 | 3 |

Sem corte, a resposta cresce de 15% a 29%, com as mesmas arestas. Com corte, cabem menos arestas (34
contra 41 na P5), e as que ficam são as primeiras da resposta da base, na mesma ordem. Na P5 pelo
worker, com cinco repetições e carga perto de 12, a mediana foi de 1.157 ms com a árvore limpa e de
1.287 ms com `core/src/estado-thread.ts` modificado (as 34 arestas marcadas, porque o alvo mora nele);
a carga varia demais para separar o custo da leitura. Para refazer o A/B:

```sh
mkdir -p /tmp/base && git archive 8248d98d | tar -x -C /tmp/base
ln -s "$PWD/core/node_modules" /tmp/base/core/node_modules && npm --prefix /tmp/base/core run build
env -u ORK_PROJETO node core/dist/index.js grafo indexar
for cli in /tmp/base/core/dist/index.js core/dist/index.js; do
  env -u ORK_PROJETO node "$cli" grafo chamadores core/src/manifest.ts#dirEstado --json --teto-bytes 32768 | wc -c
done
```

### Conformidade da fatia 5

```sh
npm --prefix core run build:test && node --test core/dist-test/test/rm031-kg5-proveniencia.test.js
```

O grupo `KG5 proveniencia` cobre a consulta pura (padrão tudo igual, marca pela origem, pelo alvo e por
evidência auxiliar, situação pedida só para o que a resposta cita), a CLI com a árvore limpa e
modificada (mesmo tamanho, outro tamanho, apagada, link no último nome para fora e para dentro da raiz,
pasta, pasta-mãe trocada por link para fora e para dentro, FIFO e mudança só no índice do Git), as
quatro consultas com a árvore modificada (vizinhos sem teto, com teto e cortado, chamadores,
importadores e caminho), o `skip-worktree` do D3, a leitura única com o tamanho antes de abrir e o
inode conferido, o teto, o pacote v2 (com o sha256 que o código da base dá para o mesmo pacote), as
descrições das tools, a dica, e CLI, worker e MCP com a mesma resposta.

Mutações temporárias no JavaScript compilado derrubaram o grupo: as nove da implementação (alvo
ignorado, evidências fora das fontes, sem conferir o tamanho, sem o caminho real, situação pedida para
todas as arestas, árvore limpa lida, pacote sem o alvo, pacote marcando tudo e CLI sem a situação no
pacote) e as oito do GO-FIX da rodada 1 do CHECK (caminho real só dentro da raiz, inode sem conferir,
link seguido no último nome, situação fora de vizinhos, de chamadores, de importadores e de caminho, e
grupo igual marcado no pacote); o código foi restaurado. Esses ensaios locais não são recibo oficial do
núcleo.

## Fora destas fatias

- As tools no OpenClaw e no Hermes: a paridade entre hosts é o KG7.
- `indexar` pelo MCP: a tool diz a correção, e quem indexa é a CLI.
- A habilitação da flag, que é do dono, e a rodada paga do protocolo.
- Responder por um índice de revisão ancestral, marcando as arestas cujas fontes mudaram: a fatia 5
  torna isso conferível, mas troca a garantia de nunca responder por outro índice; a decisão é do dono.

## Conformidade

```sh
npm --prefix core run build:test && node --test core/dist-test/test/mcp-grafo.test.js core/dist-test/test/intelligence-kg1-boundary.test.js core/dist-test/test/rm031-kg5-proveniencia.test.js
```

Os grupos `KG5 flag`, `KG5 contrato`, `KG5 teto`, `KG5 indice`, `KG5 worker`, `KG5 despacho`,
`KG5 medida` e `KG5 proveniencia` usam repositórios Git temporários, o servidor MCP com transporte em
memória e o worker num processo filho de verdade.
