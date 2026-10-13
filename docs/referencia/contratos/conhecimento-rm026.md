# Conhecimento escrito (RM-026 K7)

Contrato `ork.conhecimento/v1`, definido em `core/src/conhecimento.ts` (o leitor) e
`core/src/conhecimento-consulta.ts` (as consultas). É o K7 da
[RM-026](../../roadmap/RM-026-workspace-empresarial.md), na alternativa (a) que o dono escolheu em 11/10/2026:
o conhecimento da empresa (política, especificação, guia) fica em Markdown versionado no repositório, e o
contrato mora do lado do ork. Escrever um documento é um commit numa thread, com PR, como todo o resto.

A fatia 1 entregou o schema, a leitura da pasta e a validação, com as lacunas tipadas. A fatia 2 entregou a porta
pública: o comando `ork conhecimento` e as tools MCP `ork_conhecimento_*`, com cada id do Brain conferido por `get`.
A fatia 3 leva as mesmas tools aos hosts OpenClaw e Hermes.

## A pasta declarada

O `orkastery.yaml` declara a pasta. Sem o bloco, o projeto não tem conhecimento: não há pasta padrão.

```yaml
conhecimento:
  dir: "docs/conhecimento"
```

| Regra | O que vale |
| --- | --- |
| Forma | Caminho relativo à raiz, sem `..`, sem `\` e sem caractere invisível. Não pode ser a própria raiz nem ficar dentro de `.git` ou `.orkastery`, com qualquer caixa |
| Caminho real | Com os links resolvidos, a pasta fica dentro da raiz. Um link dentro da raiz que leva a outra pasta dela vale; o arquivo dos documentos sai pelo caminho real, o que o git versiona |
| Link | Dentro da pasta, link simbólico nunca é seguido, seja de arquivo ou de pasta. O arquivo abre com `O_NOFOLLOW` |
| Documento | Arquivo comum `*.md` em qualquer subpasta. `README.md` e `_*.md` são índice e modelo, e entrada que começa com `.` não é lida |
| Execução | Nenhuma. O leitor só lê arquivos: não cria processo, não chama o git e não grava nada. Entrada que não abre vira lacuna, nunca exceção |

Bloco que não é mapa e `dir` vazio avisam no manifesto e ficam declarados com `dir` vazio, que o leitor recusa
com `conhecimento.dir-invalido`: quem declarou não ouve que não declarou. Chave desconhecida em `conhecimento` só
avisa. A regra do caminho é do leitor, que recusa com lacuna tipada: a pasta vem com o repositório e segue a
[fronteira de confiança](../fronteira-de-confianca.md) da RM-047.

## O documento

Cada documento começa com o frontmatter entre duas linhas `---`, em UTF-8 (com ou sem BOM). O YAML é o
subconjunto do `orkastery.yaml`, em modo estrito: chave repetida, a chave `__proto__`, comentário depois do valor
(o `#` dentro do texto pede aspas) e linha fora do bloco (indentação errada) invalidam o documento, em vez de
sumir calados. Comentário na linha inteira vale, e a lacuna diz a linha do arquivo.

```markdown
---
id: doc-politica-de-ferias
titulo: Política de férias
colecoes: [rh, politicas]
referencias:
  brain: [proj-portal-rh, proj-portal-antigo]
  decisoes:
    - ork-rm026k7conhe#14
---

# Política de férias

O texto do documento segue em Markdown.
```

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `id` | sim | `doc-` seguido de 3 a 48 caracteres `[a-z0-9-]`, começando por letra ou número (a regra dos ids do portfólio). Único na pasta |
| `titulo` | sim | Texto de 1 a 160 caracteres, sem caractere invisível (a regra do `saida-segura.ts`: controle, formato e bidi; o ZWJ e os seletores de emoji valem). Número, `yes`/`no` e `#` precisam de aspas |
| `colecoes` | sim | Lista, ou um texto só, de 1 a 16 nomes `[a-z0-9-]` de 1 a 48 caracteres, começando por letra ou número, sem repetir |
| `referencias.brain` | não | Até 64 ids de produto, projeto ou iniciativa (`prod-`, `proj-`, `init-`), a regra do portfólio e do Brain |
| `referencias.decisoes` | não | Até 64 citações `<thread>#<linha>` do ledger, com a linha a partir de 1 |

Qualquer outra chave invalida o documento: chave nova passa pelo contrato. A coleção não tem arquivo próprio;
ela existe porque um documento a cita. Inteiro numa lista vira texto (a coleção `2026`); nulo, booleano e
decimal invalidam o documento. Referência repetida na mesma lista conta uma vez.

## A conferência das referências

O documento vale inteiro ou vira lacuna. A referência vale sozinha: a que não confere vira lacuna, e o
documento segue na resposta sem ela.

- **Decisão:** confere no ledger canônico da thread, o da árvore principal, também quando o leitor roda de
  dentro de uma worktree. Só confere onde a resposta mostra a referência (o `mostrar` e o `verificar`): o `listar` e o
  `colecoes` não leem ledger, e o `mostrar` lê só os do documento pedido. O ledger é lido como a captura do Brain o lê: só linhas completas, em UTF-8 exato, como
  estavam quando ele foi aberto, mesmo que ele cresça durante a leitura. A linha citada precisa ser um evento da
  própria thread do tipo `autonomous_decision`, `hitl_requested` ou `human_gate`; `human_decision` é relato sem
  recibo e não conta, como no dossiê. A citação devolvida traz `fonte` (`threads/<thread>/ledger.jsonl#L<linha>`)
  e o `sha256` da linha, o mesmo `source_ref` e `source_hash` que a captura grava para ela no Brain. Cada ledger é
  lido uma vez, até a maior linha citada, e os ledgers de uma consulta têm um teto de bytes somados: o que não cabe
  vira `referencia.decisao-ausente`.
- **Id do Brain:** a forma é a dos ids do portfólio (`prod-`, `proj-`, `init-`), conferida pelo leitor. Na consulta
  que mostra referência (o `mostrar`, as do documento pedido, e o `verificar`, as de todos), cada id distinto confere
  por `get` no Company Brain da [RM-025](../../roadmap/RM-025-company-brain-fundacao.md), pelo transporte do
  `ork brain get`: o `memory.cli` do manifesto, com a configuração de memória da árvore principal e o tenant dela. A
  resposta `ok` vale só no contrato `orkmind.company-brain-entity/v1`, com o id e o tenant pedidos, e vira a referência
  com o tipo, o título, a versão, a fonte (`source_ref`) e o `sha256` (`source_hash`) da entidade no Brain. `unknown` e
  `empty` viram `referencia.brain-inexistente`, como no dossiê; `withheld` vira `referencia.brain-retido`; o resto vira
  `referencia.brain-indisponivel`. A falha do Brain para a conferência: `unavailable` (fora do ar, sem configuração ou
  com o transporte quebrado), `forbidden`, `conflict` e a configuração de memória que não abre. Depois dela, nenhum
  `get` sai, e as referências que faltavam levam o mesmo detalhe; o teto de `get` e o prazo da consulta param do mesmo
  jeito. A resposta fora do contrato (`ok` com a entidade que não confere, estado desconhecido) vale só para o id dela,
  e a conferência segue. `listar` e `colecoes` não abrem o Brain nem mostram referência. O executável é o `memory.cli`
  que o manifesto escolhe, como no `ork brain`; a [fronteira de confiança](../fronteira-de-confianca.md) registra esse
  pendente do dono (P6).

## As consultas

O leitor (`lerConhecimento`) é interno ao núcleo. A resposta pública é a da consulta (`consultarConhecimento`), a
mesma no `ork conhecimento ... --json` e nas tools MCP. Toda consulta traz `contrato`, `consulta`, `dir` e `lacunas`,
em ordem estável: documentos por id, coleções por nome, lacunas por arquivo, código e referência.

| Consulta | Além de `contrato`, `consulta`, `dir` e `lacunas` | Lacunas |
| --- | --- | --- |
| `listar` | `colecao` (o filtro pedido, ou `null`) e `documentos`, sem referências: `id`, `titulo`, `colecoes`, `arquivo`, `bytes` e `sha256` | As da pasta e as dos documentos; as de referência ficam com o `mostrar` e o `verificar` |
| `colecoes` | `colecoes`, cada uma com o `nome` e os ids dos `documentos` | As mesmas do `listar` |
| `mostrar` | `id` (o pedido) e `documento`, com as referências conferidas e o `corpo`, ou `null` | As do documento pedido e das referências dele, ou as da pasta; o id que nenhum documento válido tem vira `documento.inexistente` |
| `verificar` | `documentos`, com as referências conferidas, e `colecoes` | Todas |

A versão de um documento é o `sha256` dos bytes do arquivo, com o caminho real dele. O `corpo` é o Markdown depois do
frontmatter, decodificado do UTF-8 sem o BOM e com cada `\r\n` trocado por `\n` (um `\r` sozinho fica).

```json
{
  "contrato": "ork.conhecimento/v1",
  "consulta": "mostrar",
  "dir": "docs/conhecimento",
  "id": "doc-politica-de-ferias",
  "documento": {
    "id": "doc-politica-de-ferias",
    "titulo": "Política de férias",
    "colecoes": ["politicas", "rh"],
    "referencias": {
      "brain": [
        {
          "id": "proj-portal-rh",
          "kind": "proj",
          "titulo": "Portal de RH",
          "versao": 3,
          "fonte": "portfolio.json#proj-portal-rh",
          "sha256": "c7d2…"
        }
      ],
      "decisoes": [
        {
          "ref": "ork-rm026k7conhe#14",
          "thread": "ork-rm026k7conhe",
          "linha": 14,
          "tipo": "autonomous_decision",
          "fonte": "threads/ork-rm026k7conhe/ledger.jsonl#L14",
          "sha256": "5f0c…"
        }
      ]
    },
    "arquivo": "docs/conhecimento/rh/ferias.md",
    "bytes": 1834,
    "sha256": "9a41…",
    "corpo": "\n# Política de férias\n\nO texto do documento segue em Markdown.\n"
  },
  "lacunas": [
    {
      "codigo": "referencia.brain-inexistente",
      "arquivo": "docs/conhecimento/rh/ferias.md",
      "documento": "doc-politica-de-ferias",
      "referencia": "proj-portal-antigo",
      "detalhe": "o Company Brain não tem este id (o get respondeu unknown)"
    }
  ]
}
```

Toda lacuna tem `codigo`, `arquivo` (relativo à raiz, `null` nas da pasta), `documento` (o id, quando ele já
valia, e o pedido no `documento.inexistente`), `referencia` (nas de referência) e `detalhe`, texto para gente. O
contrato é o código. O detalhe nasce em pt-BR, o do `--json` e do MCP, e a CLI o imprime na língua do dono. Texto
vindo do repositório chega à resposta numa linha e sem caractere invisível, pela regra do `saida-segura.ts`, salvo o
corpo, que vem com o texto do arquivo: no `--json` e no MCP o caractere invisível sai escrito como `\uXXXX`, o mesmo
valor, e no texto da CLI o corpo sai linha a linha, sem ele.

## CLI e tools MCP

| CLI | Tool MCP | Parâmetros da tool |
| --- | --- | --- |
| `ork conhecimento listar [--colecao C] [--json]`, e `ork conhecimento` sozinho | `ork_conhecimento_listar` | `colecao`, opcional |
| `ork conhecimento mostrar <doc-id> [--json]` | `ork_conhecimento_mostrar` | `id`, o `doc-...` |
| `ork conhecimento colecoes [--json]` | `ork_conhecimento_colecoes` | nenhum |
| `ork conhecimento verificar [--json]` | `ork_conhecimento_verificar` | nenhum |

As tools são de leitura (`readOnlyHint`), com schema fechado, e aceitam `projeto`, que só confere o projeto servido,
como as outras tools do servidor. Não pedem `threadId`: o conhecimento é do projeto fixado no servidor, também na
sessão filha vinculada a uma thread. A resposta é o JSON da consulta, compacto. Argumento fora do schema (id ou
coleção fora da forma, campo a mais) recusa antes de ler qualquer arquivo.

A CLI sai 1, e a tool vem com `isError`, quando a consulta não responde: `listar` e `colecoes` sem a pasta lida,
`mostrar` sem documento e `verificar` com qualquer lacuna. Uso errado na CLI sai 2, com o uso do comando, para o gate
de CI separar o erro de digitação da lacuna. A tool roda no processo do servidor: a conferência do Brain o ocupa até
o prazo da consulta. O texto
da CLI segue a língua do dono ([RM-061](../../roadmap/RM-061-cli-em-ingles-e-pt-br.md)); o `--json` é o mesmo nas duas
línguas. No despacho `claude-bg`, as tools ainda não entram na allowlist da sessão filha, como o `ork_brain_dossie`.

## Os hosts

As quatro tools têm o mesmo nome, os mesmos parâmetros e o mesmo JSON em todo host. O núcleo decide; o host só
transporta a chamada e a resposta.

| Host | Superfície | Chamada |
| --- | --- | --- |
| Claude Code e Codex | as tools do `ork mcp serve`, do projeto fixado no servidor | a consulta, no processo do servidor |
| OpenClaw | as tools do plugin (`adapters/openclaw`), nos perfis `coding` e `messaging`, com o `projeto` da RM-052 | `ork [--projeto P] conhecimento <consulta> [argumentos] --json` |
| Hermes | os wrappers do `bin` do manifesto (`adapters/hermes/bin/ork-conhecimento-*.sh`) | `ork conhecimento <consulta> "$@" --json`, com `ORK_PROJETO_EXPLICITO=1` |

- **A resposta:** o JSON do núcleo, como vem, também na saída 1 (`[ork saiu com 1]` no texto da tool do OpenClaw, o
  código 1 no Hermes), que é o `isError` do MCP. No OpenClaw, a linha `Projeto consultado: ...` vem depois do JSON.
- **O argumento:** no OpenClaw, o host confere `id` e `colecao` contra o padrão que o schema declara (o da tool MCP) e
  recusa campo a mais antes de chamar o `ork`, com `conhecimento.argumento-invalido`: um valor que começa com `--`
  viraria opção do CLI. O núcleo confere de novo. No Hermes, o argumento segue como dado, sem shell no meio.
- **O canal:** a descrição das tools do OpenClaw e a skill do Hermes dizem a mesma frase, que o teste de paridade
  confere:

> Conhecimento escrito (RM-026 K7): a resposta é o JSON do núcleo, o mesmo das tools MCP. Cite o documento pelo titulo, pela versão (sha256) e pela fonte (arquivo). Cada item de lacunas é uma lacuna tipada: mostre ao dono o codigo, o arquivo ou a referência e o detalhe, como lacuna, separada da resposta, nunca como resposta: documento que virou lacuna não é documento inexistente, referência que não conferiu não é referência e pasta não lida não é conhecimento vazio. Saída 1 é a consulta que não respondeu: as lacunas dizem por quê.

## Lacunas

| Código | Quando | O que sai da resposta |
| --- | --- | --- |
| `conhecimento.nao-declarado` | O `orkastery.yaml` não tem `conhecimento.dir` | Tudo |
| `conhecimento.dir-invalido` | A forma do caminho não vale (inclusive o bloco que não é mapa e o `dir` vazio), ou o caminho real é a própria raiz, fica em `.git` ou `.orkastery` ou tem caractere invisível | Tudo |
| `conhecimento.dir-fora-da-raiz` | Pelo caminho real, com os links resolvidos, a pasta sai da raiz | Tudo |
| `conhecimento.dir-ausente` | A pasta não existe ou não é pasta | Tudo |
| `conhecimento.limite` | Um teto da pasta estourou | Tudo: nenhum documento volta, para a resposta nunca ser parcial sem dizer |
| `documento.link` | Link simbólico na pasta, de arquivo ou de pasta | A entrada |
| `documento.nao-regular` | FIFO, socket ou dispositivo, arquivo que mudou durante a leitura, ou entrada que não abre para leitura | A entrada |
| `documento.nome-invalido` | Nome fora de UTF-8 ou com caractere invisível | A entrada |
| `documento.grande-demais` | O documento passa do teto | O documento |
| `documento.codificacao` | O arquivo não é UTF-8 | O documento |
| `documento.sem-frontmatter` | O arquivo não começa com `---`, ou o bloco não fecha | O documento |
| `documento.frontmatter-invalido` | YAML fora do subconjunto ou do modo estrito, frontmatter acima do teto ou que não é mapa | O documento |
| `documento.chave-desconhecida` | Chave fora de `id`, `titulo`, `colecoes` e `referencias` | O documento |
| `documento.id-invalido` | Id ausente ou fora da forma | O documento |
| `documento.id-repetido` | O mesmo id, na forma certa, em mais de um arquivo, também quando uma das cópias não vale por outro motivo | Todos os documentos com o id |
| `documento.titulo-invalido` | Título ausente, que não é texto, longo demais ou com caractere invisível | O documento |
| `documento.colecoes-invalidas` | Sem coleção, mais de 16, nome fora da forma, repetido, nulo ou booleano | O documento |
| `documento.referencias-invalidas` | `referencias` que não é mapa, com chave fora de `brain` e `decisoes`, ou lista longa demais ou com item nulo, booleano ou decimal | O documento |
| `referencia.invalida` | Id do Brain ou citação de decisão fora da forma | A referência |
| `referencia.decisao-ausente` | A thread não tem ledger, a pasta dela é link ou não é pasta, o ledger não abre, passa do teto ou não é UTF-8, a linha não está entre as completas, ou os ledgers da consulta passam do teto somado | A referência |
| `referencia.nao-e-decisao` | A linha não é evento JSON, é de outra thread ou não é de um tipo de decisão | A referência |
| `documento.inexistente` | No `mostrar`, nenhum documento válido tem o id pedido, e nenhuma outra lacuna fala dele | O documento |
| `referencia.brain-inexistente` | O `get` respondeu `unknown` (ou `empty`): o Brain não tem o id | A referência |
| `referencia.brain-retido` | O `get` respondeu `withheld`: o Brain tem o id e o retém para esta leitura | A referência |
| `referencia.brain-indisponivel` | O Brain fora do ar, sem configuração, recusando ou em conflito, a resposta fora do contrato da entidade, ou o teto de `get` ou o prazo da consulta | A referência |

## Tetos

| Teto | Valor | Estourado |
| --- | --- | --- |
| Entradas visitadas na pasta | 5000 | `conhecimento.limite` |
| Níveis de subpasta | 8 | `conhecimento.limite` |
| Bytes de todos os documentos | 32 MiB | `conhecimento.limite` |
| Bytes de um documento | 1 MiB | `documento.grande-demais` |
| Bytes do frontmatter | 16 KiB | `documento.frontmatter-invalido` |
| Bytes do ledger citado | 16 MiB | `referencia.decisao-ausente` |
| Bytes dos ledgers lidos numa consulta, somados | 64 MiB | `referencia.decisao-ausente` |
| Ids do Brain conferidos por `get` numa consulta | 100 | `referencia.brain-indisponivel` |
| Prazo da conferência do Brain numa consulta (cada `get` tem o `memory.timeout_ms`, até 15 s) | 60 s | `referencia.brain-indisponivel` |

## Fora do contrato

O K7 fecha com as três fatias ([FEAT-038](../../produto/FEAT-038-conhecimento-escrito.md)). Ficam de fora: escrever
documento por tool (é um commit numa thread, com PR), as tools na allowlist da sessão filha do `claude-bg`, a
federação do conhecimento entre repositórios e a P6 da [fronteira de confiança](../fronteira-de-confianca.md), pendente
do dono.
