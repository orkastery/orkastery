# Contratos da Orkastery Network (RM-053)

> **Em uma frase:** os três contratos da rede de uma pessoa — a adesão da máquina, o retrato publicado e a leitura de `ork network status --json` — e as fronteiras com a RM-052 e a RM-054.

- **Casa da rede:** repositório privado `<usuario>/orkastery-network` na forja, branch `main`, sempre por HTTPS com o helper da própria CLI (decisão no [ADR-001](../../conceitos/decisoes/ADR-001-estado-da-rede.md)). URL da casa sem https recusa com `rede.sem-https`, e o helper nunca é configurado para `http://`. A exceção é o caminho local absoluto (um espelho, ou o remoto bare dos testes), que não leva credencial.
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
  "id": "2f0b6c1e-8a57-4c1b-9f0e-3d2a6b7c8d90",
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
| `maquina` | o nome da máquina, saneado: letras, números, `.`, `_` e `-`, até 64 | é o mesmo nome do arquivo, da trava e dos commits |
| `id` | identificador desta instalação (`~/.orkastery/maquina-id`, fora da pasta de cache): aleatório quando criado; derivado do arquivo ruim, da pasta e do boot quando precisa ser trocado, ou sem hard link | opcional no v1; o arquivo com o nome desta máquina, com o cabeçalho do contrato (`contrato` `ork.rede-maquina/vN` e `maquina` dona do arquivo) e outro `id`, não é regravado (`rede.nome-em-uso`) nem removido, mesmo quando esta versão não lê o resto; lixo sem esse cabeçalho não prende o nome |
| `adesao` | `rede` (entrou) ou `fabrica` (herdada) | — |
| `forjas[]` | cada CLI de forja achada na máquina | `usuario` é só o login; `null` quando a CLI não tem login |
| `runtimes[]` | `claude-bg` (binário `claude`) e `codex`, quando instalados | `versao` casa `\d+.\d+[.\d+]`; texto fora disso vira `null` |
| `hosts[]` | `claude-code`, `codex`, `hermes`, `openclaw`, quando instalados | `adaptador` é a versão do recibo `INSTALADO.json` no destino padrão do host, sob o home |
| `projetos[]` | projetos conhecidos desta máquina, até 200 | `nome` com algo visível (letra, dígito, pontuação ou símbolo), sem espaço nas pontas, sem `://`, sem caractere invisível e até 80 unidades UTF-16 (o leitor aceita qualquer texto sem invisível até 80) e `caminho` até 1024, sem caractere invisível; senão o escritor tira do retrato, com aviso, o projeto do diretório atual, e o registro e o último retrato o descartam na leitura, sem aviso; `remoto` até 500, senão `null` |
| `publicadoEm` | a última batida que chegou ao remoto | retrato igual só volta ao remoto de hora em hora |

**Nunca vai:** token, senha, chave, cabeçalho de autorização, e-mail ou plano da conta (da forja ou do runtime), perfil de conta e o diretório dele, caminho de arquivo de credencial (`hosts.yml`, `.credentials.json`, `auth.json`, `.git-credentials`, `.netrc`, `.ssh/`), prompt, transcript, log.

- O retrato é montado por lista de permissão, e uma varredura de segredo roda antes do push.
- Campo que o núcleo monta (máquina, hostname, forjas, runtimes, hosts) com cara de segredo recusa a publicação inteira.
- Projeto vem de fora do núcleo: o que tem valor com cara de segredo fica fora do retrato sozinho, com aviso no CLI e no `rede.log` (campo e padrão, nunca o valor).
- O remoto é MONTADO a partir de partes validadas, nunca copiado: esquema conhecido (`https`, `http`, `ssh`, `git`, `git+ssh`, `ssh+git`), host em conjunto fechado (nome, IPv4 ou IPv6 entre colchetes), porta numérica e caminho sem `@`, `:` nem `\`. Usuário, senha, query e fragmento nunca vão; o que não se encaixa (inclusive `file://` e barra invertida) vira `null`, e o projeto continua.
- Nos transportes `ssh`, `git+ssh`, `ssh+git` e `git`, o git não para a autoridade em `?` nem em `#`: remoto com eles vira `null`. No `http(s)`, query ou fragmento com `@` também. O host fica com a caixa de origem, para a varredura ver o que é sensível a caixa (como o `AKIA`).
- O remoto scp (`git@host:dono/repo.git`) sai como `ssh://host/dono/repo.git`, a forma usual das forjas.
- O escritor confere o retrato com as mesmas regras do leitor antes do push: o que ele publica, toda máquina lê.
- O leitor recusa (`retrato.invalido`) o retrato com caractere de controle ou invisível (ESC, BEL, bidi, largura zero, preenchimento Hangul) em qualquer texto, ou com valor de cara de segredo num campo do núcleo. Projeto com cara de segredo sai sozinho da leitura, e a lacuna diz quantos. O `remoto` de outra máquina é remontado, e o que não sai igual vira `null`. O `REDE.md` só leva o que o leitor aceitou, com o Markdown escapado, inclusive o `.` e o `:` (sem autolink no GFM, nem `http://x` sem ponto no domínio).
- Caractere invisível, aqui, pelas classes do Unicode: controle (`Cc`), formato (`Cf`: bidi, largura zero, tags), separador de linha e todo `Default_Ignorable_Code_Point` (preenchimentos Hangul, seletores de variação), mais o braile vazio. O ZWJ e os seletores U+FE0E e U+FE0F, que montam emoji comuns, passam. As marcas visíveis da categoria `Cf`, lista fechada com todo `Prepended_Concatenation_Mark=Yes` do Unicode 17 (sinais numéricos árabes U+0600 a U+0605, U+06DD, U+070F, U+0890, U+0891, U+08E2, U+110BD e U+110CD), também passam como texto: o projeto com elas fica no retrato (Y4 do CHECK 7, resolvida em 03/10/2026). O resto de `Cf` continua invisível.
- O id derivado vale por máquina: numa pasta dividida por hosts ou contêineres sem hard link, o último a gravar vence, e o boot (`boot_id`, `machine-id`) só entra no Linux (limitação aceita, X6 do CHECK 6).
- Os commits da casa têm a máquina como autor e committer, nunca o e-mail do ambiente.
- O `REDE.md` é índice, não contrato: o retrato sem batida há mais de 14 dias (`RETRATO_PARADO_MS`, contado da batida de quem publica) sai da tabela e entra no rodapé, com o nome e a última batida. O arquivo em `maquinas/` fica, e o `ork network status` continua a lê-lo, com a lacuna `maquina.sem-batida`. Batida ilegível ou no futuro fica no índice. Quatorze dias cobrem férias e uma máquina desligada por duas semanas.
- A faxina da trava órfã (`publicar.lock` sem `pid` válido há mais de 5 min) é serial, sob `publicar.lock.faxina`, e refaz o julgamento no lugar antes de mover: a trava viva nunca sai do lugar (W9 do CHECK 5, fechada na fatia 2).

## `ork.rede-status/v1` — a leitura

Saída de `ork network status --json` e de `lerRede()` em `core/src/rede-status.ts`.

```json
{
  "contrato": "ork.rede-status/v1",
  "consultadoEm": "2026-09-29T23:41:00.000Z",
  "casa": { "forja": "github", "host": "github.com", "dono": "juliopessoa", "repositorio": "orkastery-network", "origem": "rede.json" },
  "estaMaquina": { "maquina": "srvjcp86", "membro": true, "adesao": "rede", "publicada": true, "nomeEmUso": false },
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

- **Compatibilidade:** o leitor ignora campo desconhecido e item de `hosts[]` ou `forjas[]` com um host ou uma forja que ele não conhece: o retrato de uma versão mais nova continua visível para quem não atualizou.
- `origem` de cada membro: `rede` (retrato da casa) ou `fabrica-estado` (visto só na branch legada de um projeto, com `adesao: null`: pode ser um `ork` antigo, uma máquina que saiu da rede ou uma sem forja). O retrato da rede vence quando a máquina está nas duas.
- `atualizado: false` numa fonte quer dizer "última cópia local, sem leitura nova".
- `naoConsultado` diz o que esta leitura **não** olhou. Quem responde "o roadmap está vazio" a partir daqui erra: roadmap não foi lido.
- O texto do `ork network status` põe cada valor numa linha só, sem caractere de controle ou invisível: uma quebra de linha num valor vira espaço e nunca abre uma linha que parece do `ork`. O JSON escreve os invisíveis como `\uXXXX` (o valor é o mesmo). A fábrica legada vem do remoto de um projeto, onde outras pessoas escrevem.

### Lacunas

Lacuna é o que faltou ler. Ela nunca vira lista vazia.

| Tipo | Quando |
| --- | --- |
| `forja.ausente` | nenhuma CLI de forja (`gh`, `glab`) nesta máquina |
| `forja.sem-login` | a CLI existe e não tem login |
| `rede.sem-repositorio` | a casa da rede ainda não existe: ninguém rodou `ork network entrar` |
| `rede.repositorio-publico` | a casa existe e não é privada: nada é publicado |
| `rede.sem-leitura` | a casa não pôde ser lida agora, ou a forja devolveu a URL dela sem https; o status usa a última cópia, quando há |
| `retrato.invalido` | `maquinas/<x>.json` ilegível, de outro contrato, com o nome de outra máquina, com caractere invisível, ou com cara de segredo num campo do núcleo; ou com projeto fora da leitura (a máquina continua) |
| `maquina.sem-batida` | a última batida de uma máquina passou de 3 h, ou é ilegível (no JSON, o `idadeMs` dela vem `null`) |
| `maquina.nome-em-uso` | o retrato com o nome desta máquina é de outra instalação (outro `id`): esta não publica até trocar de nome ou retomá-lo com `ork network entrar --forcar` |
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
| Retrato fora do índice `REDE.md` (fatia 2) | 14 dias sem batida, pela batida de quem publica | `RETRATO_PARADO_MS` |
| Intervalo mínimo entre tentativas em segundo plano | 14 min, um abaixo do cron de 15 | `TETO_DE_TENTATIVA_MS` |
