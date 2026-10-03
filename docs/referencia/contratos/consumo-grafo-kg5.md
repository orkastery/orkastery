# Consumo do grafo pelas fases (KG5)

O KG5 deixa um agente numa fase (GOAL, PLAN, GO ou CHECK) consultar o grafo de código pelo MCP do
projeto, sem ler o repositório cru: cinco tools de leitura com o contrato do `ork grafo`, que
respondem pelo índice do HEAD da worktree da thread, com a proveniência de cada aresta e a resposta
limitada em bytes. O contrato [`ork.code-artifact-graph/v1`](grafo-deterministico-kg1.md) não muda. É
o quinto pacote do [RM-031](../../roadmap/RM-031-grafo-de-codigo.md) e segue as decisões D1 a D10 da
thread `ork-rm031kg5cons`, tomadas em #Auto e registradas no ledger.

Fica desligado por padrão: a exposição e a habilitação são do dono. A fatia 1 entrega as quatro
consultas pelo MCP; a [fatia 2](#fatia-2-pacote-de-contexto-da-thread) acrescenta o pacote
determinístico da thread e a dica no pedido da fase, na thread `ork-rm031kg5fati`.

## O que o KG5 garante e o que não garante

| Garante | Não garante |
| --- | --- |
| Sem a flag, nada muda: as mesmas 31 tools, com os mesmos schemas, e o mesmo comando de despacho | Que a resposta é completa: o grafo só tem o que o extrator prova |
| A resposta da tool é, byte a byte, o JSON que o `ork grafo <consulta> ... --json --teto-bytes N` escreve na worktree da thread (a CLI só acrescenta a quebra de linha final) | Que o host não corta a resposta por um limite próprio |
| Toda aresta sai com toda a evidência: o teto tira arestas inteiras, as mais longe do alvo | Que a recusa cabe no teto: ele vale para a resposta |
| Sem os analisadores na instalação, a tool recusa com `grafo.parser.indisponivel`, nunca responde pela metade | Economia de contexto: isso é o benchmark do [protocolo](benchmark-grafo-kg1.md) |
| Sem o índice do HEAD, a recusa diz o caso e a correção; a tool nunca responde por outro índice | Que o índice acompanha a árvore editada: a resposta é do HEAD, e diz quando a árvore mudou |
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
método, arquivo, linhas e bytes de cada evidência, o aviso de parcialidade e o campo `teto`.

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
(`modificada`).

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
pedem grant. Na fatia 1, o prompt não mudava (D10); a fatia 2 acrescenta a dica descrita abaixo.

## Fronteira

O worker é a segunda porta da família do grafo, depois do `index.ts`, e só pelo CLI dela; o
fechamento de imports do servidor MCP não alcança módulo do grafo (D8,
`core/test/intelligence-kg1-boundary.test.ts`). Os módulos da impressão do extrator não mudam, então a
chave dos índices guardados é a mesma do KG4. O Company Brain v1 e o adaptador semântico ficam intactos,
com os hashes congelados.

## Custo medido

Registro em
[`core/test/fixtures/kg5-medida-mcp.json`](../../../core/test/fixtures/kg5-medida-mcp.json)
(`ork.graph-mcp-cost/v0`), gerado por `core/scripts/medir-mcp-grafo.cjs` na revisão `9000f52e` da
branch da thread, com a árvore limpa, carga 7,4 em 8 núcleos, Node v22.23.2 e 3 repetições por braço,
nas seis perguntas da [medida do KG3](indice-grafo-kg3.md#primeira-medida-do-custo-de-consulta) (D9).
**Não é o benchmark `ork.graph-benchmark/v1`** e não conclui economia.

- **Tool:** o worker com o argv que a tool monta e o teto padrão; ao agente chega o texto da resposta.
- **CLI:** `ork grafo <consulta> --json`, sem teto (o braço do grafo do KG3).
- **Cru:** `git grep -n -I -F` do nome e a leitura inteira de cada arquivo com ocorrência (o do KG3).
- **Tokens:** `unavailable` nos três braços.

| Pergunta | Tool: bytes | Tool: arestas | Tool: latência | CLI: bytes | CLI: arestas | Cru: bytes | Cru: arquivos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 quem chama `lerRepositorio` | 2.525 | 1 de 1 | 782,7 ms | 3.148 | 1 | 292.510 | 12 |
| P2 quem chama `dirEstado` | 14.009 | 18 de 18 | 815,4 ms | 19.426 | 18 | 638.111 | 26 |
| P3 quem importa o contrato do grafo | 8.136 | 9 de 9 | 781,6 ms | 11.015 | 9 | 569.720 | 21 |
| P4 quem importa o leitor de YAML | 8.074 | 10 de 10 | 787,1 ms | 11.235 | 10 | 273.815 | 13 |
| P5 vizinhança de `raizDoEstado` | 32.087 | 41 de 104, cortada | 758,9 ms | 106.363 | 104 | 1.179.908 | 51 |
| P6 caminho de `main` a `dirEstado` | 4.325 | 2 de 2 | 783,2 ms | 5.880 | 2 | indisponível | indisponível |

**Descoberta**, o custo fixo de ligar a flag: as quatro definições somam 5.931 bytes no `tools/list`,
que vai de 23.289 para 29.224 bytes (de 30 para 34 tools), num projeto temporário com e sem a flag.

Como ler, sem concluir além do medido:

- Bytes não são tokens: o hex dos ids e o JSON tokenizam diferente de prosa.
- A tool corta pelo teto: na P5 ela entrega 41 das 104 arestas, as mais perto do alvo, e diz que cortou.
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

```sh
ork grafo contexto <thread> --json
ork grafo contexto <thread> --json --teto-bytes 8192
```

`ork_grafo_contexto {threadId, tetoBytes?}` roda exatamente esse argv na worktree da thread e
devolve o mesmo JSON compacto, sem a quebra de linha final da CLI. O schema é
`ork.thread-graph-context/v0`; a CLI está disponível sem ligar a flag, e o MCP continua opt-in.
O manifesto da worktree não habilita tools nem a dica: vale `grafo.mcp` da raiz do estado.
O servidor lista 31 tools sem a flag e 36 com ela, conforme `core/test/mcp-grafo.test.ts`.

### Entrada e seleção

- `diff`: nomes rastreados alterados contra o commit base carimbado na thread, incluindo mudanças
  commitadas, staged, unstaged e exclusões; renomeações entram como nome antigo e novo. Arquivos
  ainda não rastreados só entram se citados em GOAL, PLAN ou claims.
- `goal` e `plan`: caminhos relativos à raiz citados nos documentos do agente (`docs/goal.md` e
  `docs/plan.md` do estado da thread), em código, destino de link ou texto. Não executa a prosa.
  Links externos, caminhos absolutos, travessias e `.git`/`.orkastery` ficam fora. Fragmentos e
  números de linha em citações são removidos; referências em prosa não constituem arestas.
- `claims`: arquivos das claims ativas, com o ID da claim como origem. Claims retiradas ficam fora;
  uma claim pendente continua sendo uma entrada prospectiva, sem virar prova de verificação.

Cada semente lista as origens (`diff`, `goal`, `plan`, `claim:Cn`) e o estado `indexado` ou
`fora-do-indice`. Um caminho novo, excluído ou não extraído não ganha ligações inventadas.
Documentos ausentes ficam declarados em `fontes`; documentos presentes têm hash SHA-256.
`entrada_sha256` identifica base, diff, documentos e claims normalizados, sem relógio, paths
absolutos da instalação, metadados de sessão ou texto integral dos documentos na resposta.

A expansão percorre um salto, nos dois sentidos, desde os arquivos indexados das sementes e seus
símbolos/seções. Só entram arestas existentes no grafo filtrado pela concessão. O pacote contém
`nos`, `arestas` com as duas pontas por ID e todas as evidências (extrator, versão, método, arquivo,
linhas e offsets em bytes). O cabeçalho `indice` identifica revisão, snapshot, digest, extratores
e estado da árvore. Não reextrai alterações ainda não commitadas: o grafo continua sendo do HEAD.

### Determinismo e teto

O mesmo índice e a mesma entrada dão os mesmos bytes. JSON usa a serialização canônica do grafo;
sementes ficam em ordem UTF-8 por caminho, origens ordenadas, e arestas por tipo, rótulo de origem,
rótulo de destino e ID. Duplicatas de caminhos são consolidadas. Os nós e evidências também têm
ordem fixa. O arquivo `core/src/intelligence-graph-contexto.ts` só compõe dados recebidos; CLI e
worker leem a thread por uma função compartilhada, fora da família do grafo.

O teto do JSON completo é 32.768 bytes por padrão, de 4.096 a 65.536, incluindo cabeçalho e medida.
Retém o maior prefixo que cabe: primeiro sementes, depois arestas. Cada aresta entra junto com
as duas pontas e a evidência integral, nunca com strings cortadas. `truncado`, `teto.cortado` e
`omitidos` declaram o corte. Muitas sementes podem ocupar todo o teto, deixando as arestas de fora;
as tools por nó permitem aprofundar a consulta. Pacote vazio é válido e não é erro.
Sem `--json`, a CLI apresenta resumo e JSON; o teto se aplica ao JSON, não às linhas do resumo.

As recusas do índice mantêm `estado_do_indice` e `correcao: "ork grafo indexar"`, no schema do
contexto. Índice ausente, de outra revisão, de outro extrator ou corrompido nunca fornece nós.
Base inválida, falha ao ler o diff ou worktree incompatível recusam o pacote. Mudança do HEAD
durante a coleta recusa com `grafo.contexto.revisao-mudou` e pede repetir. Não há indexação automática.

### Dica no prompt e medida offline

Com `grafo.mcp: true` na raiz, o pedido da fase recebe um bloco curto com `ork_grafo_contexto`,
o comando CLI, as quatro consultas por nó, a correção do índice e a ressalva de parcialidade.
A dica entra antes da renderização e do hash do prompt, inclusive em templates do projeto que
usam `pedido`. Com a flag ausente ou `false`, o texto renderizado fica byte a byte igual ao anterior.
A dica não carrega o grafo, não chama tool e não executa rodada paga.

`medida.pacote_bytes` é o tamanho real do JSON UTF-8, incluindo o próprio campo. A leitura crua
compara os mesmos arquivos presentes no pacote (sementes indexadas, nós e evidências), uma vez
por caminho: `medida.arquivos` lista cada tamanho e `leitura_crua_bytes` soma `size_bytes` do
`source_manifest` da revisão indexada. Não mede bytes da árvore editada nem tokens:
`tokens: "unavailable"`. A medida acompanha cada pacote, inclusive quando há corte.

Na fixture sintética de `core/test/rm031-kg5-contexto.test.ts` (30 funções chamadoras, Node 22.23.2),
o comando abaixo mediu **22.973 bytes** de pacote e **1.567 bytes** de leitura crua dos mesmos
3 arquivos, sem corte. Nesse corpus o pacote é maior: IDs e evidências têm custo. Não é economia
de tokens, não é a rodada A/B e não generaliza para outros repositórios.

```sh
npm --prefix core run build:test
node core/dist-test/test/rm031-kg5-contexto.test.js
```

O grupo `KG5 medida offline` imprime os números e confere os tamanhos contra os bytes reais da
fixture. Os testes integrados também cobrem CLI/worker/MCP e recusas, e precisam de subprocessos
permitidos. Passagem parcial no sandbox não substitui `ork verify` e o CHECK da condutora.

## Fora destas fatias

- As tools no OpenClaw e no Hermes: a paridade entre hosts é o KG7.
- `indexar` pelo MCP: a tool diz a correção, e quem indexa é a CLI.
- A habilitação da flag, que é do dono, e a rodada paga do protocolo.

## Conformidade

```sh
npm --prefix core run build:test && node --test core/dist-test/test/mcp-grafo.test.js core/dist-test/test/intelligence-kg1-boundary.test.js
```

Os grupos `KG5 flag`, `KG5 contrato`, `KG5 teto`, `KG5 indice`, `KG5 worker`, `KG5 despacho` e
`KG5 medida` usam repositórios Git temporários, o servidor MCP com transporte em memória e o worker
num processo filho de verdade.
