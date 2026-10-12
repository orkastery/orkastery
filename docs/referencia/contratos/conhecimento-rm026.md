# Conhecimento escrito (RM-026 K7)

Contrato `ork.conhecimento/v1`, definido em `core/src/conhecimento.ts`. É o K7 da
[RM-026](../../roadmap/RM-026-workspace-empresarial.md), na alternativa (a) que o dono escolheu em 11/10/2026:
o conhecimento da empresa (política, especificação, guia) fica em Markdown versionado no repositório, e o
contrato mora do lado do ork. Escrever um documento é um commit numa thread, com PR, como todo o resto.

A fatia 1 entrega o schema, a leitura da pasta e a validação, com as lacunas tipadas. A CLI pública e as tools
MCP chegam na fatia 2, e os hosts OpenClaw e Hermes na fatia 3; até lá, o leitor é interno ao núcleo.

## A pasta declarada

O `orkastery.yaml` declara a pasta. Sem o bloco, o projeto não tem conhecimento: não há pasta padrão.

```yaml
conhecimento:
  dir: "docs/conhecimento"
```

| Regra | O que vale |
| --- | --- |
| Forma | Caminho relativo à raiz, sem `..`, sem `\` e sem caractere de controle. Não pode ser a própria raiz nem ficar dentro de `.git` ou `.orkastery` |
| Caminho real | Com os links resolvidos, a pasta fica dentro da raiz. Um link dentro da raiz que leva a outra pasta dela vale; o arquivo dos documentos sai pelo caminho real, o que o git versiona |
| Link | Dentro da pasta, link simbólico nunca é seguido, seja de arquivo ou de pasta. O arquivo abre com `O_NOFOLLOW` |
| Documento | Arquivo comum `*.md` em qualquer subpasta. `README.md` e `_*.md` são índice e modelo, e entrada que começa com `.` não é lida |
| Execução | Nenhuma. O leitor só lê arquivos: não cria processo, não chama o git e não grava nada |

Bloco que não é mapa, `dir` vazio e chave desconhecida em `conhecimento` só avisam no manifesto. A regra do
caminho é do leitor, que recusa com lacuna tipada: a pasta vem com o repositório e segue a
[fronteira de confiança](../fronteira-de-confianca.md) da RM-047.

## O documento

Cada documento começa com o frontmatter entre duas linhas `---`, em UTF-8 (com ou sem BOM). O YAML é o
subconjunto do `orkastery.yaml`, em modo estrito: chave repetida, a chave `__proto__` e linha fora do bloco
(indentação errada) invalidam o documento, em vez de sumir caladas.

```markdown
---
id: doc-politica-de-ferias
titulo: Política de férias
colecoes: [rh, politicas]
referencias:
  brain: [proj-portal-rh]
  decisoes:
    - ork-rm026k7conhe#14
---

# Política de férias

O texto do documento segue em Markdown.
```

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `id` | sim | `doc-` seguido de 3 a 48 caracteres `[a-z0-9-]`, começando por letra ou número (a regra dos ids do portfólio). Único na pasta |
| `titulo` | sim | Texto de 1 a 160 caracteres, sem caractere de controle ou de formato. Número e `yes`/`no` precisam de aspas |
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
  dentro de uma worktree. O ledger é lido como a captura do Brain o lê: só linhas completas, em UTF-8 exato. A
  linha citada precisa ser um evento da própria thread do tipo `autonomous_decision`, `hitl_requested` ou
  `human_gate`; `human_decision` é relato sem recibo e não conta, como no dossiê. A citação devolvida traz
  `fonte` (`threads/<thread>/ledger.jsonl#L<linha>`) e o `sha256` da linha, o mesmo `source_ref` e
  `source_hash` que a captura grava para ela no Brain.
- **Id do Brain:** nesta fatia, confere só pela forma. A conferência por `get`, com o transporte do Brain,
  chega com a CLI e o MCP na fatia 2.

## A resposta

`lerConhecimento` devolve tudo em ordem estável: documentos por id, coleções por nome, lacunas por arquivo,
código e referência. A versão de um documento é o `sha256` dos bytes do arquivo, com o caminho real dele.

```json
{
  "contrato": "ork.conhecimento/v1",
  "dir": "docs/conhecimento",
  "documentos": [
    {
      "id": "doc-politica-de-ferias",
      "titulo": "Política de férias",
      "colecoes": ["politicas", "rh"],
      "referencias": {
        "brain": ["proj-portal-rh"],
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
      "sha256": "9a41…"
    }
  ],
  "colecoes": [
    { "nome": "politicas", "documentos": ["doc-politica-de-ferias"] },
    { "nome": "rh", "documentos": ["doc-politica-de-ferias"] }
  ],
  "lacunas": [
    {
      "codigo": "referencia.decisao-ausente",
      "arquivo": "docs/conhecimento/rh/ferias.md",
      "documento": "doc-politica-de-ferias",
      "referencia": "ork-rm026k7conhe#900",
      "detalhe": "o ledger da thread ork-rm026k7conhe tem 52 linha(s) completa(s)"
    }
  ]
}
```

Toda lacuna tem `codigo`, `arquivo` (relativo à raiz, `null` nas da pasta), `documento` (o id, quando ele já
valia), `referencia` (nas de referência) e `detalhe`, texto para gente. O contrato é o código. Texto vindo do
repositório chega à resposta sem caractere de controle.

## Lacunas

| Código | Quando | O que sai da resposta |
| --- | --- | --- |
| `conhecimento.nao-declarado` | O `orkastery.yaml` não tem `conhecimento.dir` | Tudo |
| `conhecimento.dir-invalido` | A forma do caminho não vale, ou o caminho real é a própria raiz, fica em `.git` ou `.orkastery` ou tem caractere de controle | Tudo |
| `conhecimento.dir-fora-da-raiz` | Pelo caminho real, com os links resolvidos, a pasta sai da raiz | Tudo |
| `conhecimento.dir-ausente` | A pasta não existe ou não é pasta | Tudo |
| `conhecimento.limite` | Um teto da pasta estourou | Tudo: nenhum documento volta, para a resposta nunca ser parcial sem dizer |
| `documento.link` | Link simbólico na pasta, de arquivo ou de pasta | A entrada |
| `documento.nao-regular` | FIFO, socket ou dispositivo, arquivo que mudou durante a leitura, ou subpasta que não abre | A entrada |
| `documento.nome-invalido` | Nome fora de UTF-8 ou com caractere de controle | A entrada |
| `documento.grande-demais` | O documento passa do teto | O documento |
| `documento.codificacao` | O arquivo não é UTF-8 | O documento |
| `documento.sem-frontmatter` | O arquivo não começa com `---`, ou o bloco não fecha | O documento |
| `documento.frontmatter-invalido` | YAML fora do subconjunto ou do modo estrito, frontmatter acima do teto ou que não é mapa | O documento |
| `documento.chave-desconhecida` | Chave fora de `id`, `titulo`, `colecoes` e `referencias` | O documento |
| `documento.id-invalido` | Id ausente ou fora da forma | O documento |
| `documento.id-repetido` | O mesmo id em mais de um arquivo | Todos os documentos com o id |
| `documento.titulo-invalido` | Título ausente, que não é texto, longo demais ou com caractere de controle | O documento |
| `documento.colecoes-invalidas` | Sem coleção, mais de 16, nome fora da forma, repetido, nulo ou booleano | O documento |
| `documento.referencias-invalidas` | `referencias` que não é mapa, com chave fora de `brain` e `decisoes`, ou lista longa demais ou com item nulo, booleano ou decimal | O documento |
| `referencia.invalida` | Id do Brain ou citação de decisão fora da forma | A referência |
| `referencia.decisao-ausente` | A thread não tem ledger, a pasta dela é link, o ledger passa do teto ou não é UTF-8, ou a linha não está entre as completas | A referência |
| `referencia.nao-e-decisao` | A linha não é evento JSON, é de outra thread ou não é de um tipo de decisão | A referência |

## Tetos

| Teto | Valor | Estourado |
| --- | --- | --- |
| Entradas visitadas na pasta | 5000 | `conhecimento.limite` |
| Níveis de subpasta | 8 | `conhecimento.limite` |
| Bytes de todos os documentos | 32 MiB | `conhecimento.limite` |
| Bytes de um documento | 1 MiB | `documento.grande-demais` |
| Bytes do frontmatter | 16 KiB | `documento.frontmatter-invalido` |
| Bytes do ledger citado | 16 MiB | `referencia.decisao-ausente` |

## Próximas fatias

- **Fatia 2:** `ork conhecimento colecoes|listar|ler|referencias` e as tools `ork_conhecimento_*`, só leitura,
  com cada id do Brain conferido por `get` e a versão de cada resposta. A conferência pelo Brain pode acrescentar
  códigos de lacuna; os desta fatia não mudam.
- **Fatia 3:** os hosts OpenClaw e Hermes chegam às mesmas tools, e o item ganha a página de produto.
