# Consumo do grafo pelas fases (KG5)

O KG5 deixa um agente numa fase (GOAL, PLAN, GO ou CHECK) consultar o grafo de código pelo MCP do
projeto, sem ler o repositório cru: quatro tools de leitura com o contrato do `ork grafo`, que
respondem pelo índice do HEAD da worktree da thread, com a proveniência de cada aresta e a resposta
limitada em bytes. O contrato [`ork.code-artifact-graph/v1`](grafo-deterministico-kg1.md) não muda. É
o quinto pacote do [RM-031](../../roadmap/RM-031-grafo-de-codigo.md) e segue as decisões D1 a D10 da
thread `ork-rm031kg5cons`, tomadas em #Auto e registradas no ledger.

Fica desligado por padrão: a exposição e a habilitação são do dono. Esta fatia entrega o consumo
pelo MCP (D1); o pacote de contexto determinístico da thread, com os arquivos e símbolos ligados ao
que ela mexe, fica para a fatia seguinte do KG5.

## O que o KG5 garante e o que não garante

| Garante | Não garante |
| --- | --- |
| Sem a flag, nada muda: as mesmas 30 tools, com os mesmos schemas, e o mesmo comando de despacho | Que a resposta é completa: o grafo só tem o que o extrator prova |
| A resposta da tool é, byte a byte, a do `ork grafo <consulta> ... --json --teto-bytes N` na worktree da thread | Que o host não corta a resposta por um limite próprio |
| Toda aresta sai com toda a evidência: o teto tira arestas inteiras, as mais longe do alvo | Economia de contexto: isso é o benchmark do [protocolo](benchmark-grafo-kg1.md) |
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

## As tools

| Tool | CLI | Parâmetros |
| --- | --- | --- |
| `ork_grafo_vizinhos` | `ork grafo vizinhos` | `alvo`, `profundidade` (1 a 5), `sentido` (`entrada`, `saida`, `ambos`), `tipos`, `limite` (1 a 10.000), `tetoBytes` |
| `ork_grafo_chamadores` | `ork grafo chamadores` | `alvo` (símbolo), `profundidade`, `limite`, `tetoBytes` |
| `ork_grafo_importadores` | `ork grafo importadores` | `alvo` (arquivo ou símbolo), `profundidade`, `limite`, `tetoBytes` |
| `ork_grafo_caminho` | `ork grafo caminho` | `de`, `para`, `sentido`, `tipos`, `tetoBytes` |

Todas pedem `threadId` e aceitam `projeto`, que só confere o projeto servido, como as outras tools do
servidor. São de leitura (`readOnlyHint`), com schema fechado. A consulta roda na worktree da thread
(na raiz, para thread sem worktree), conferida pelo núcleo: a sessão filha vinculada a uma thread não
consulta a de outra (`mcp.thread.scope`). O nó tem a forma da [consulta do KG3](indice-grafo-kg3.md#consulta)
e não começa com `--`, porque o parser do `ork grafo` o leria como opção.

A tool monta o argv que a CLI receberia, com as opções na forma `--opcao=valor`, e devolve a saída sem
transformar (D6):

```text
ork_grafo_vizinhos {threadId, alvo: "src/a.ts#a", profundidade: 2, tipos: ["calls"]}
  = ork grafo vizinhos src/a.ts#a --profundidade=2 --tipo=calls --json --teto-bytes=32768
```

A resposta é o JSON `ork.code-graph-query/v0` da CLI, compacto, com o cabeçalho do índice (revisão,
chave, snapshot, digest, estado da árvore e extratores), os nós, as arestas com extrator, versão,
método, arquivo, linhas e bytes de cada evidência, o aviso de parcialidade e o campo `teto`.

## Teto da resposta

As tools respondem com no máximo `tetoBytes` bytes, 32.768 por padrão, de 4.096 a 65.536 (D4). O
corte é da CLI, pela opção `--teto-bytes N`, que também vale fora do MCP:

- só com `--json`, e o JSON sai compacto; sem a opção, a saída da CLI é a de antes;
- se a resposta pedida cabe, ela sai inteira, com `teto: {bytes, limite_pedido, cortado: false}`;
- se não cabe, vale o maior `limite` que cabe: as arestas mais longe do alvo saem primeiro, pela
  mesma ordem do `--limite`, `consulta.limite` passa a ser o efetivo, `truncado` fica `true` e
  `teto.cortado` também. O tamanho só cresce com o limite, então a busca binária acha sempre o mesmo;
- o caminho não se corta: se não cabe, a recusa é `grafo.consulta.teto-excedido`, e o mesmo vale
  quando nem a aresta mais perto do alvo cabe.

## Recusas

| Código | Quando | No JSON |
| --- | --- | --- |
| `grafo.indice.ausente` | não há índice deste repositório (não indexado) | `estado_do_indice: "nao-indexado"`, `correcao: "ork grafo indexar"` |
| `grafo.indice.outra-revisao` | há índice deste repositório, de outra revisão: o HEAD andou | `estado_do_indice: "outra-revisao"`, a correção |
| `grafo.indice.outro-extrator` | há índice da revisão do HEAD com outra chave: a instalação do `ork`, os analisadores ou o código do extrator mudaram | `estado_do_indice: "outro-extrator"`, a correção |
| `grafo.indice.corrompido` | o índice do HEAD não passa na leitura (tamanho, digest) | `estado_do_indice: "corrompido"`, a correção |
| `grafo.consulta.teto-excedido` | a resposta não cabe no teto e não pode ser cortada | o tamanho e o teto no `detalhe` |
| `grafo.mcp.desligado` | a flag foi desligada com a sessão aberta | `{erro}`, como nas outras tools |
| `grafo.mcp.indisponivel` | o worker não respondeu (prazo, cancelamento, saída inesperada) | `{erro}` com o motivo |

As recusas da consulta (índice, nó ambíguo ou desconhecido, alvo inválido, teto) vêm como o JSON da
CLI, `{schema, erro: {codigo, detalhe, candidatos}}`, com `isError`; as do transporte (flag, thread,
worker, schema) vêm como `{erro}`, como em todo o servidor. As do índice também saem na CLI com
`--json`; em texto, a de índice ausente, de outra revisão ou de outro extrator manda rodar
`ork grafo indexar`, que constrói o índice do HEAD incremental a partir do ancestral
([KG4](incremental-grafo-kg4.md)).

## Execução

Cada chamada abre um processo filho, o worker (`core/src/mcp-grafo-worker.ts`), D3:

| Regra | Como |
| --- | --- |
| Ambiente | o mínimo do MCP: `HOME`, `USER`, `LOGNAME`, `XDG_CONFIG_HOME`, `PATH=/usr/bin:/bin`, `LANG` e `TMPDIR`; nada do cliente, como `NODE_OPTIONS` ou variável do Git |
| Grupo | processo em grupo próprio; prazo de 60 s, cancelamento da chamada e stdout acima de 1 MiB matam o grupo |
| Entrada | `{raiz, argv}` pelo stdin, com schema; o cwd tem de ser a raiz pedida, e o manifesto, o dela |
| Argv | só as quatro consultas, com `--json`, `--teto-bytes` e as opções que a tool monta; `indexar`, `limpar`, `amostra` e `status` recusam |
| CLI | chama o `executarGrafo` direto: o `main` do `ork` não roda, então nada vira `--projeto`, `--version` ou `--help` |
| Saída | 0 é resposta, 1 é recusa tipada da consulta (JSON no stdout), 2 é entrada recusada pelo próprio worker |

Não há cache do grafo no servidor nem entre chamadas: cada uma lê o índice do HEAD com a integridade
de sempre (tamanho e digest). O servidor fica sem o compilador e sem o grafo em memória.

## Despacho

Com a flag, o despacho `claude-bg` põe as quatro tools (`mcp__orkastery__ork_grafo_*`) na allowlist da
sessão filha logo depois das consultas, nos perfis `interactive` e `worktree` e no PLAN (D7); sem a
flag, o comando é o de antes. A flag é lida do manifesto da raiz pelo contexto do runtime, a mesma que
o servidor da sessão filha lê. No Codex nada muda: as tools são de leitura, como as consultas, e não
pedem grant. O prompt da fase não muda nesta fatia (D10): as tools se descrevem na descoberta.

## Fronteira

O worker é a segunda porta da família do grafo, depois do `index.ts`, e só pelo CLI dela; o
fechamento de imports do servidor MCP não alcança módulo do grafo (D8,
`core/test/intelligence-kg1-boundary.test.ts`). Os módulos da impressão do extrator não mudam, então a
chave dos índices guardados é a mesma do KG4. O Company Brain v1 e o adaptador semântico ficam intactos,
com os hashes congelados.

## Custo medido

Registro em
[`core/test/fixtures/kg5-medida-mcp.json`](../../../core/test/fixtures/kg5-medida-mcp.json)
(`ork.graph-mcp-cost/v0`), gerado por `core/scripts/medir-mcp-grafo.cjs` na revisão `c03241be` da
branch da thread, com a árvore limpa, carga 4,3 em 8 núcleos, Node v22.23.2 e 3 repetições por braço,
nas seis perguntas da [medida do KG3](indice-grafo-kg3.md#primeira-medida-do-custo-de-consulta) (D9).
**Não é o benchmark `ork.graph-benchmark/v1`** e não conclui economia.

- **Tool:** o worker com o argv que a tool monta e o teto padrão; ao agente chega o texto da resposta.
- **CLI:** `ork grafo <consulta> --json`, sem teto (o braço do grafo do KG3).
- **Cru:** `git grep -n -I -F` do nome e a leitura inteira de cada arquivo com ocorrência (o do KG3).
- **Tokens:** `unavailable` nos três braços.

| Pergunta | Tool: bytes | Tool: arestas | Tool: latência | CLI: bytes | CLI: arestas | Cru: bytes | Cru: arquivos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 quem chama `lerRepositorio` | 2.525 | 1 de 1 | 735,1 ms | 3.148 | 1 | 263.823 | 10 |
| P2 quem chama `dirEstado` | 14.009 | 18 de 18 | 679,8 ms | 19.426 | 18 | 609.038 | 24 |
| P3 quem importa o contrato do grafo | 8.136 | 9 de 9 | 852,9 ms | 11.015 | 9 | 545.827 | 20 |
| P4 quem importa o leitor de YAML | 8.074 | 10 de 10 | 706,8 ms | 11.235 | 10 | 259.175 | 12 |
| P5 vizinhança de `raizDoEstado` | 32.087 | 41 de 104, cortada | 644,5 ms | 106.363 | 104 | 1.145.700 | 49 |
| P6 caminho de `main` a `dirEstado` | 4.325 | 2 de 2 | 780,8 ms | 5.880 | 2 | indisponível | indisponível |

**Descoberta**, o custo fixo de ligar a flag: as quatro definições somam 5.895 bytes no `tools/list`,
que vai de 23.289 para 29.188 bytes (de 30 para 34 tools), num projeto temporário com e sem a flag.

Como ler, sem concluir além do medido:

- Bytes não são tokens: o hex dos ids e o JSON tokenizam diferente de prosa.
- A tool corta pelo teto: na P5 ela entrega 41 das 104 arestas, as mais perto do alvo, e diz que cortou.
  Sem corte, a resposta da tool tem as mesmas arestas da CLI, em JSON compacto.
- As respostas dos braços não são as mesmas: o grafo só responde o que o extrator prova, e a leitura
  crua acha texto, comentário e nome igual em outro escopo.
- A descoberta é paga por sessão com a flag ligada, mesmo sem consulta; quanto dela chega ao modelo
  depende de como o host carrega as definições.
- A latência da tool inclui a partida do Node e a leitura do índice a cada chamada.

```sh
node core/scripts/medir-mcp-grafo.cjs --conferir
node core/scripts/medir-mcp-grafo.cjs --validar core/test/fixtures/kg5-medida-mcp.json
```

`--conferir` mede de novo no HEAD e confere que a resposta da tool é a do `ork grafo` com o mesmo argv,
que cabe no teto e que o trecho de cada evidência, no blob do HEAD, cita o alvo da aresta. `--validar`
confere a forma do registro e recusa token medido sem medida e texto que prometa economia.

## Fora desta fatia

- O pacote de contexto determinístico da thread (a fatia seguinte do KG5).
- A dica do grafo no prompt da fase (D10).
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
