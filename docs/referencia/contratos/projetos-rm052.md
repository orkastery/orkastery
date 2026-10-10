# Projeto-alvo e registro de projetos (RM-052)

Contratos `ork.projetos/v1` e `ork.consulta/v1`, definidos em `core/src/projeto-alvo.ts`. É a
fronteira que a RM-053 (rede de máquinas) e a RM-054 (roadmap da rede) consomem: elas leem, e só
a RM-052 grava.

## O registro desta máquina

Arquivo `~/.orkastery/projetos.json` (ou `$ORK_USUARIO_DIR/projetos.json`), modo `0600`, escrito
por `ork init`, `ork thread new`, `ork fabrica entrar`, `ork_thread_new` do MCP e
`ork projetos registrar`. Leitura tolerante: arquivo ausente, corrompido ou de outro contrato
vale registro vazio.

```json
{
  "contrato": "ork.projetos/v1",
  "atualizadoEm": "2026-09-29T23:26:00.000Z",
  "projetos": [
    {
      "nome": "orkastery",
      "abbrev": "ork",
      "raiz": "/home/pessoa/orkastery",
      "remoto": "https://github.com/orkastery/orkastery.git",
      "registradoEm": "2026-09-29T23:26:00.000Z",
      "atualizadoEm": "2026-09-29T23:26:00.000Z",
      "fonte": "fabrica entrar"
    }
  ]
}
```

| Campo | Regra |
| --- | --- |
| `nome`, `abbrev` | Do `project` do manifesto. Nome de host segue `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$` |
| `raiz` | Caminho real da árvore principal; registrar de dentro da worktree de uma thread registra a principal |
| `remoto` | URL do `fabrica.remoto` (padrão `origin`) sem usuário nem senha; `null` sem remoto |
| `fonte` | `init`, `thread new`, `fabrica entrar`, `mcp thread new` ou `projetos registrar` |

Sem segredo: a entrada e o arquivo inteiro passam pela varredura de segredo antes de ir ao disco.
Uma raiz que perdeu o manifesto aparece em `ork projetos` como ausente e sai da resolução.
`ork projetos --json` devolve `{contrato, arquivo, projetos}`, cada projeto com `presente`.

## A resolução do projeto-alvo

| Ordem | Fonte | Origem declarada |
| --- | --- | --- |
| 1 | `--projeto <nome\|caminho>`, em qualquer posição do comando | `opcao` |
| 2 | `ORK_PROJETO` | `ambiente` |
| 3 | `ORK_PROJETO_EXPLICITO=1`: o registro presente mais o projeto do cwd; um candidato vale | `unico-conhecido` |
| 4 | o diretório atual, como sempre | `cwd` |

O servidor MCP declara `instalacao`: ele nasce fixado num projeto e o parâmetro `projeto` só confere.

- No host (`ORK_PROJETO_EXPLICITO=1`), `--projeto` só aceita **nome**: caminho recusa com
  `projeto.desconhecido` e os registrados como candidatos. `ORK_PROJETO`, que é configuração de
  quem opera o host, segue aceitando caminho.
- Nome (e o único candidato do host) que aponta o mesmo projeto do cwd usa a cópia do cwd: dentro da
  worktree de uma thread, vale a worktree. Caminho explícito vale como pedido.

Recusas tipadas, com a lista de candidatos (`nome`, `abbrev`, `raiz` com `~`, `remoto`, `presente`)
e a correção. No CLI, saída 4; com `--json`, o objeto `{erro, detalhe, candidatos, correcao}`.

| Código | Quando |
| --- | --- |
| `projeto.desconhecido` | Nome fora do registro, ou registrado sem manifesto na raiz |
| `projeto.ambiguo` | Nome de mais de uma cópia presente |
| `projeto.sem-manifesto` | Caminho inexistente ou sem `orkastery.yaml` nele nem acima |
| `projeto.escolha` | Host sem projeto pedido e com mais de um candidato |
| `projeto.nenhum` | Host sem projeto pedido e sem candidato |
| `projeto.fora-do-servidor` | MCP recebeu outro projeto que não o servido |

Comandos com `--projeto` próprio recebem a opção intacta e não resolvem o alvo global: hoje,
`network` (RM-054, `--projeto github:dono/repo`). Comandos que não leem projeto (`init`, `mcp`,
`demo`, `ciclos`, `projetos`) também não resolvem; `init` e `mcp` recusam `--projeto`.

A sessão despachada (`ork phase run`, `ork retry run`) recebe no ambiente da condução
`ORK_PROJETO` vazio e `ORK_PROJETO_EXPLICITO=0` (fatia 2): o projeto dela é o do próprio cwd, a
worktree da thread, e o modo host de quem despachou não a segue. No codex, os dois valores vão por
cima do ambiente herdado; no claude-bg, pelo `--settings`, que vence o ambiente do daemon. O filho
`fabrica publicar` herda o mesmo.

## O cabeçalho da consulta

`ork.consulta/v1`, em `maestro` (no snapshot, `project.root`, `project.remote` e `notConsulted`),
`board`, `board plan`, `fabrica`, `roadmap status` e, desde a fatia 2, `roadmap reservas`, no texto e
no JSON:

```json
{
  "contrato": "ork.consulta/v1",
  "projeto": { "nome": "orkastery", "abbrev": "ork", "raiz": "~/orkastery",
    "remoto": "https://github.com/orkastery/orkastery.git", "origem": "opcao" },
  "lido": ["roadmap (docs/roadmap)", "threads deste projeto nesta máquina"],
  "naoLido": ["reservas do roadmap (ork network roadmap)", "threads de outras máquinas (ork network roadmap)",
    "outros projetos desta máquina: 1 (ork projetos)"]
}
```

No texto, duas linhas logo no alto: `Projeto consultado: ...` e `Não lido: ...`. O MCP não conta os
outros projetos da máquina. Sem o remoto, o `naoLido` diz que nada foi lido de `ork/fabrica-estado`
ou, nas reservas, de `ork/roadmap-reservas`; o JSON das reservas traz também `leitura`
(`lido-agora`, `copia-local`, `sem-copia` ou `sem-remoto`), e só `lido-agora` ou `copia-local`
sem reserva viram "Nenhum item do roadmap reservado".

Os demais comandos que leem um projeto terminam com a mesma primeira linha, `Projeto consultado:
...`, no stderr (fatia 2), quando o leitor não tem como saber qual projeto foi lido: no host
(`ORK_PROJETO_EXPLICITO=1`) ou com o projeto fora do diretório atual. Ela vem uma vez só, também
quando o comando falha; quem monta o cabeçalho não a repete, e o stdout, inclusive o JSON, não
muda. `maestro` declara no snapshot e `sessions event`, o sensor dos hooks, não declara.

## Para quem consome

- Leia o registro sem gravar; confira `contrato` e ignore entrada fora da forma.
- Para resolver um nome, use `resolverProjetoAlvo` ou `ork --projeto <nome> ...`; nunca escolha a
  primeira cópia de um nome ambíguo.
- Nada aqui carrega credencial; se precisar de mais campos, peça por uma versão `v2` do contrato.
