# Contratos da Orkastery Network (RM-053)

> **Em uma frase:** os três contratos da rede de uma pessoa — a adesão da máquina, o retrato publicado e a leitura de `ork network status --json` — e as fronteiras com a RM-052 e a RM-054.

- **Casa da rede:** repositório privado `<usuario>/orkastery-network` na forja, branch `main` (decisão no [ADR-001](../../conceitos/decisoes/ADR-001-estado-da-rede.md)).
- **Quem lê este documento:** quem escreve um leitor da rede (a RM-054, os hosts) e quem alimenta os projetos conhecidos (a RM-052).
- **Versões:** todos em `v1`. Campo novo e opcional não muda a versão; campo removido ou com sentido novo muda.

## `ork.rede/v1` — a adesão desta máquina

Arquivo `~/.orkastery/rede.json`, gravado por `ork network entrar` e `ork network sair`. `ORK_USUARIO_DIR` troca a pasta (testes e `ork eval`).

```json
{
  "contrato": "ork.rede/v1",
  "membro": true,
  "forja": "github",
  "host": "github.com",
  "dono": "juliopessoa",
  "repositorio": "orkastery-network",
  "atualizadoEm": "2026-09-29T23:40:00.000Z"
}
```

- `membro: false` é a saída explícita, e vence a adesão herdada.
- Sem o arquivo, a máquina é membro **herdado** quando `~/.orkastery/maquina.json` (`ork.maquina/v1`) tem `fabricaCompartilhada: true`: quem fez `ork fabrica entrar` entra na rede sem refazer.
- O nome da máquina continua em `maquina.json`; a rede não guarda um segundo nome.

## `ork.rede-maquina/v1` — o retrato de uma máquina

Arquivo `maquinas/<maquina>.json` na casa da rede. Cada máquina escreve só o próprio.

```json
{
  "contrato": "ork.rede-maquina/v1",
  "maquina": "srvjcp86",
  "hostname": "srvjcp86",
  "adesao": "rede",
  "forjas": [{ "forja": "github", "host": "github.com", "cli": "gh", "versao": "2.101.0", "usuario": "juliopessoa" }],
  "runtimes": [{ "runtime": "claude-bg", "binario": "claude", "versao": "2.1.285" }],
  "hosts": [
    { "host": "claude-code", "versao": "2.1.285", "adaptador": null },
    { "host": "openclaw", "versao": "2026.9.4", "adaptador": "0.4.3" }
  ],
  "projetos": [{ "nome": "orkastery", "remoto": "https://github.com/orkastery/orkastery.git", "caminho": "/home/julio/orkastery" }],
  "versaoOrk": "0.4.3",
  "publicadoEm": "2026-09-29T23:40:00.000Z"
}
```

| Campo | O que é | Regra |
| --- | --- | --- |
| `adesao` | `rede` (entrou) ou `fabrica` (herdada) | — |
| `forjas[]` | cada CLI de forja achada na máquina | `usuario` é só o login; `null` quando a CLI não tem login |
| `runtimes[]` | `claude-bg` (binário `claude`) e `codex`, quando instalados | `versao` casa `\d+.\d+[.\d+]`; texto fora disso vira `null` |
| `hosts[]` | `claude-code`, `codex`, `hermes`, `openclaw`, quando instalados | `adaptador` é a versão do recibo `INSTALADO.json` no destino padrão do host, sob o home |
| `projetos[]` | projetos conhecidos desta máquina | `remoto` sem credencial; `caminho` absoluto local |
| `publicadoEm` | a última batida que chegou ao remoto | retrato igual só volta ao remoto de hora em hora |

**Nunca vai:** token, senha, chave, cabeçalho de autorização, e-mail ou plano da conta (da forja ou do runtime), perfil de conta e o diretório dele, caminho de arquivo de credencial (`hosts.yml`, `.credentials.json`, `auth.json`, `.git-credentials`, `.netrc`, `.ssh/`), prompt, transcript, log. O retrato é montado por lista de permissão, e uma varredura de segredo recusa a publicação inteira antes do push.

## `ork.rede-status/v1` — a leitura

Saída de `ork network status --json` e de `lerRede()` em `core/src/rede.ts`.

```json
{
  "contrato": "ork.rede-status/v1",
  "consultadoEm": "2026-09-29T23:41:00.000Z",
  "casa": { "forja": "github", "host": "github.com", "dono": "juliopessoa", "repositorio": "orkastery-network", "origem": "rede.json" },
  "estaMaquina": { "maquina": "srvjcp86", "membro": true, "adesao": "rede", "publicada": true },
  "fontes": [
    { "fonte": "rede", "ref": "github.com/juliopessoa/orkastery-network#main", "ponta": "1a2b3c4…", "atualizado": true },
    { "fonte": "fabrica-estado", "projeto": "orkastery", "ref": "ork/fabrica-estado", "ponta": "5d6e7f8…", "atualizado": true }
  ],
  "membros": [
    { "maquina": "srvjcp86", "origem": "rede", "idadeMs": 60000, "...": "o retrato inteiro" },
    { "maquina": "vps", "origem": "fabrica-estado", "pessoa": "Julio Pessoa", "versaoOrk": "0.4.2", "idadeMs": 900000 }
  ],
  "lacunas": [],
  "naoConsultado": ["roadmap", "reservas", "threads"]
}
```

- `origem` de cada membro: `rede` (retrato da casa) ou `fabrica-estado` (visto só na branch legada de um projeto). O retrato da rede vence quando a máquina está nas duas.
- `atualizado: false` numa fonte quer dizer "última cópia local, sem leitura nova".
- `naoConsultado` diz o que esta leitura **não** olhou. Quem responde "o roadmap está vazio" a partir daqui erra: roadmap não foi lido.

### Lacunas

Lacuna é o que faltou ler. Ela nunca vira lista vazia.

| Tipo | Quando |
| --- | --- |
| `forja.ausente` | nenhuma CLI de forja (`gh`, `glab`) nesta máquina |
| `forja.sem-login` | a CLI existe e não tem login |
| `rede.sem-repositorio` | a casa da rede ainda não existe: ninguém rodou `ork network entrar` |
| `rede.repositorio-publico` | a casa existe e não é privada: nada é publicado |
| `rede.sem-leitura` | a casa não pôde ser lida agora; o status usa a última cópia, quando há |
| `retrato.invalido` | `maquinas/<x>.json` ilegível, de outro contrato, ou com o nome de outra máquina |
| `maquina.sem-batida` | a última batida de uma máquina passou de 3 h |
| `fabrica.sem-leitura` | a branch `ork/fabrica-estado` de um projeto não pôde ser lida agora |
| `projeto.sem-clone` | projeto conhecido cujo caminho não existe mais nesta máquina |

## Fronteira com a RM-052: projetos conhecidos

A rede **lê** o registro de projetos da RM-052 por um adaptador único, `core/src/rede-projetos.ts`, e não o grava.

- **Arquivo:** `~/.orkastery/projetos.json`.
- **Aceito:** `contrato` ausente ou `ork.projetos/v1`; `projetos` como lista ou como mapa por nome.
- **Campos lidos de cada projeto:** `nome`; `caminho` ou `raiz` (absoluto); `remoto` (URL) ou `remotos` (mapa ou lista, com preferência por `origin`). O resto é ignorado.
- **Reserva, enquanto o registro não existe:** o projeto do diretório atual (manifesto) e os projetos do último retrato desta máquina cujo caminho ainda existe. Assim a lista não oscila entre crons de projetos diferentes.
- Se a forma final da RM-052 mudar, só o adaptador muda.

## Fronteira com a RM-054: quem lê a rede

- A RM-054 consome `ork.rede-status/v1`: `membros[].projetos` diz onde cada projeto tem clone, `idadeMs` e `maquina.sem-batida` dizem o frescor, e as lacunas usam o mesmo vocabulário.
- O retrato não carrega roadmap, reserva nem thread: isso continua na fábrica (`ork/fabrica-estado`) e nas reservas (`ork/roadmap-reservas`) de cada projeto, lidas pela RM-054.

## Constantes

| Constante | Valor | Onde |
| --- | --- | --- |
| Batida (retrato igual volta ao remoto) | 1 h | `PULSACAO_DA_REDE_MS` |
| Máquina sem batida | 3 h | `SEM_BATIDA_MS` |
| Intervalo mínimo entre tentativas em segundo plano | 15 min | `TETO_DE_TENTATIVA_MS` |
