# Autorização durável da varredura (RM-063)

Contrato `ork.autorizacao-duravel/v1`, lido por `core/src/autorizacao-duravel.ts`. É a permissão que o dono grava
nesta máquina para a batida do pulse agir sozinha, com prazo e com a lista do que ela pode. A F5 da
[RM-063](../../roadmap/RM-063-fabrica-que-nao-para.md) lê este arquivo; a F7 (`ork conducao autorizar`) vai gravá-lo na
mesma forma.

## Onde mora

Arquivo `.orkastery/monitor/autorizacao.json` no checkout canônico do projeto (de dentro de uma worktree, o da raiz),
ao lado do `pulse-host.json`. Ele é desta máquina e fica fora do git, como o transporte do pulse (RM-047): versionado no
git, ou link, ele não vale. Até a F7, o dono o grava à mão.

```json
{
  "contrato": "ork.autorizacao-duravel/v1",
  "maquina": "maquina-b",
  "projeto": "orkastery",
  "por": "Dono",
  "concedidaEm": "2026-10-12T21:00:00-03:00",
  "ate": "2026-10-18T23:59:00-03:00",
  "pode": ["limpar", "registrar", "master"],
  "nota": "X1.a"
}
```

| Campo | Regra |
| --- | --- |
| `contrato` | Sempre `ork.autorizacao-duravel/v1` |
| `maquina` | O nome desta máquina (`ork fabrica entrar --maquina`, `ORK_MAQUINA` ou o hostname); de outra máquina, não vale |
| `projeto` | O `project.name` do `orkastery.yaml`; de outro projeto, não vale |
| `por` | Quem autorizou: a pessoa, pelo nome. Texto de até 120 caracteres; nome de agente, de runtime ou genérico (`claude`, `codex`, `auto`, `humano`, `admin`) não vale, pela mesma regra da nota do MASTER |
| `concedidaEm`, `ate` | Instantes ISO com o fuso explícito (`Z` ou `-03:00`); sem fuso, o prazo dependeria do fuso de quem lê, e o arquivo não vale. Depois de `ate`, nada é feito sozinho |
| `pode` | A lista das ações autorizadas, sem repetição; ação fora do contrato invalida o arquivo inteiro |
| `nota` | Opcional: a referência da decisão do dono, até 300 caracteres |

## As ações

| Ação | O que a varredura faz | Comando equivalente | Frente |
| --- | --- | --- | --- |
| `limpar` | Solta do `ork` a sessão fantasma (sem pid e sem processo) presa a uma thread deste projeto e sem sinal de vida há pelo menos 30 min (a recém-despachada pode não ter pid ainda): `sessao_morta` no ledger, sem tocar o runtime | `ork sessions limpar-fantasmas` | F5 |
| `registrar` | Registra a entrega do PR já mesclado: o merge `ship(<thread>)` na base remota sem `ship_done`, com o CI verde quando o manifesto o exige, e a thread parada (veja os bloqueios abaixo) | `ork ship registrar-pr <thread>` | F5 |
| `master` | Fecha pelo MASTER por omissão a thread entregue e quieta: 30 min depois do `ship_done`, nada despachado depois dele e a thread parada | `ork master <thread> --aceitar-omissao` | F5 |
| `merge` | Reservada: o merge do PR verde | (F7) | F7 |
| `despachar` | Reservada: o despacho da fase seguinte | (F7) | F7 |

A varredura nunca registra a entrega nem fecha a thread por cima de quem trabalha nela. Nesses casos a ação fica com o
dono, com o motivo tipado (`motivoDoBloqueio`):

| Bloqueio | Quando |
| --- | --- |
| `conduzida` | Alguém conduz a thread agora |
| `sessao-viva` | Há sessão viva com o `cwd` na worktree da thread |
| `sessoes-sem-leitura` | As sessões vivas do runtime não foram lidas agora (o runtime não respondeu, ou o pulse rodou com `--sem-runtime`): sem elas, a worktree não está provada parada |
| `worktree-suja` | A worktree tem alteração não commitada (fora do `.orkastery/`) |
| `branch-com-commits` | A branch da thread tem commit depois do head do PR mesclado (no `master`, commit fora da base) |
| `trabalho-novo` | Pedido ou despacho de fase depois do head do PR: a ação mudaria a fase por cima dele |
| `git-sem-resposta` | O git não respondeu sobre a worktree ou a branch |

Com bloqueio, o comando que o pulse e o resumo dão ao dono é `ork thread status <thread>`, e a recomendação diz o comando
da ação para quando o trabalho parar. Tag, publicação e merge fora da lista nunca entram por omissão.

## A leitura

A leitura nunca grava. Cada recusa tem motivo tipado, e só a autorização válida autoriza alguma coisa:

| Motivo | Quando |
| --- | --- |
| `autorizacao.ausente` | Não há arquivo: o estado de quem nunca autorizou |
| `autorizacao.rastreada` | O arquivo está no git, ou é link ou diretório |
| `autorizacao.ilegivel` | Não é JSON, não é objeto, ou passa de 64 KB |
| `autorizacao.contrato` | O `contrato` não é `ork.autorizacao-duravel/v1` |
| `autorizacao.campo` | Falta campo, o instante não é ISO com fuso, o `por` não nomeia uma pessoa, ou o `pode` está vazio ou repetido |
| `autorizacao.acao-desconhecida` | O `pode` traz ação fora do contrato |
| `autorizacao.outra-maquina` | A `maquina` não é esta |
| `autorizacao.outro-projeto` | O `projeto` não é este |
| `autorizacao.expirada` | O `ate` já passou |

## O que fica registrado

- Cada ação feita ou recusada vai ao ledger da thread como `varredura_acao`, com a ação, o resultado, o comando e a
  referência da autorização (`por`, `ate`, `pode`, `nota` e o sha256 do arquivo). A mesma recusa da batida anterior
  (mesma ação, sessão e motivo) não vira linha nova.
- A ação roda depois da entrega do resumo ao dono, uma batida por vez (`.orkastery/monitor/varredura-acoes.lock`): a
  busca da base e o registro do PR não atrasam o resumo, e o resumo seguinte diz o que ela fez.
- Cada rodada da batida grava no `.orkastery/monitor/hitl.log` uma linha `varredura_acoes`: o estado da autorização, a
  busca da base, o que foi feito e o que ficou para o dono, com o bloqueio de cada pendente; a batida que encontra outra
  agindo grava só `ocupada`.
- O `ork pulse --json` traz o campo `varredura`: o estado da autorização, as ações pendentes com `quemFaz`
  (`varredura` ou `dono`) e as feitas nos últimos 7 dias. Sem autorização, a ação do dono é item de
  `precisaDeHumanoAgora` com o comando em `comandoResposta`; o MASTER completa o item da entrega sem nota, na faixa
  automática (I-45).
- O `ork fabrica batida status` diz a autorização em vigor ou por que ela não vale.

## Para quem consome

- Leia sem gravar e confira o `contrato`; trate qualquer recusa como "nada autorizado".
- Não estenda o `pode` com ação nova sem mudar o contrato: ação desconhecida invalida o arquivo inteiro, de propósito.
- O prazo é do dono: não renove `ate` por conta própria.
