# Quickstart: do zero ao primeiro ciclo

Do clone à primeira thread conduzida com evidência verificada. O tempo em máquina limpa ainda não foi medido.

Nada aqui pede chave de API. O `ork` **não tem LLM embutido**: quem executa e o runtime que
você já usa, pela sua assinatura, pelo canal oficial dele.

---

## 0. Requisitos

| O que | Por que |
| --- | --- |
| Node 20 ou mais novo | O núcleo e TypeScript compilado para CommonJS, sem dependência de runtime |
| `git` | Worktree por thread, base carimbada, merge serializado e push provado |
| Um repositório git | O `ork` conduz trabalho dentro de um repositório, nunca solto no disco |
| Um runtime de agente | Hoje o adapter `claude-bg` (o binário `claude`, despachado com `--bg`) |

O runtime é opcional para os passos 1 a 4. Sem ele, você ainda cria threads, registra claims,
roda `verify`, fecha MASTER e usa todo o resto. O que você não consegue e **despachar fase**.

---

## 1. Instale o `ork`

O caminho curto, que serve para qualquer agente e para qualquer máquina:

```bash
npm install -g @orkastery/cli
ork doctor
```

Antes de apontar o `ork` para o seu projeto, veja a promessa em trinta segundos:

```bash
ork demo
```

A demonstração cria um repositório temporário com uma função errada, registra a afirmação do
agente ("soma(2, 2) devolve 4") com o comando que a julga, e roda o `ork verify` de verdade:
reprovado. Depois corrige a função e roda de novo: verdade sustentada. Funciona offline, sem
conta nem modelo, e não toca o seu projeto; `--manter` deixa o repositório da demo no disco.

O pacote é escopado porque o nome curto `ork` no registry já é de outro projeto, mas o
**binário instalado continua sendo `ork`**, e o tarball leva junto o catálogo do produto
(`skills/`, `references/`, `eval/` e `adapters/`).

Se você quer compilar do fonte, por exemplo para trabalhar no próprio núcleo:

```bash
git clone https://github.com/Orkastery/orkastery.git
cd orkastery/core
npm install
npm run build      # gera dist/index.js, o bin `ork`
npm test           # 366 testes passando, node --test, fixtures isoladas
npm link           # poe o `ork` desta árvore no PATH
```

O restante deste guia escreve `ork`. Se você não instalou global nem fez `npm link`, troque por
`node <caminho>/core/dist/index.js`.

---

## 2. `ork doctor`: o que vale nesta máquina agora

Antes de qualquer coisa, pergunte a máquina em vez de supor.

```bash
cd /caminho/do/seu/projeto
ork doctor
```

```text
ork doctor: o que vale nesta maquina agora

  [ok]   node                      v22.23.2
  [ok]   git                       /usr/bin/git
  [ok]   repositorio               branch main
  [ok]   runtime claude-bg         /home/voce/.local/bin/claude (2.1.260 (Claude Code))
  [ok]   manifesto                 /caminho/do/seu/projeto/orkastery.yaml (2248 B de 16384)
  [ok]   abbrev do projeto         "prj" (parte 1 do slug de sessao)
  [ok]   modos de conducao         padrao #Classic; permitidos #Classic, #Maestro, #Auto, #Fast
  [warn] custo e provider          politica subscription-only; ha credencial paga no ambiente
  [ok]   regime de memoria         files (fallback honesto)
  [ok]   fila de rate limit        vazia
  [ok]   estado do projeto         /caminho/do/seu/projeto/.orkastery (0 thread(s))

Veredito: PRONTO (1 warn). Despacho de fase liberado por `ork phase run`.
```

O `doctor` sai com código diferente de zero quando está **bloqueado**, e nunca por um `warn`.
Ele é a primeira linha de qualquer script de CI que use o `ork`.

---

## 3. `ork init`: o manifesto do projeto

```bash
ork init --name "meu-produto" --abbrev prd
```

Isso gera o `orkastery.yaml`, a **fonte única** da configuração do projeto, com limite duro de
16 KB. Prosa longa vai para a memória com tag, nunca para o manifesto.

Depois de `init`, execute `ork onboarding` para obter a pauta. Use `ork onboarding show --json` para retomar pendências; respostas públicas são registradas por etapa. Credenciais ficam em `~/.hermes/.env`, somente os nomes de variáveis entram na entrevista. Veja o [guia completo](../guias/onboarding.md).

O que você provavelmente vai querer ajustar logo de cara:

```yaml
project:
  abbrev: "prd"          # ate 3 caracteres, parte 1 do slug de sessao, unica no workspace
  stage: nascente        # nascente | crescendo | maduro: define os packs de auditoria ativos

conduction:
  default_mode: classic  # o modo usado quando o pedido nao traz #TAG
  allowed_modes: [look, ork, classic, maestro, auto]

worktree:
  base_branch: "main"
  dir: ".claude/worktrees"
  por_thread: true       # uma worktree git por thread

verify:
  build: "npm run build" # detectado pelo init quando existe
  test: "npm test"       # o comando que o CHECK reexecuta no HEAD real

concurrency:
  max_parallel_threads: 3

handoff:
  rotate_above: 0.70     # gate de tokens: abre sessao nova acima desta ocupacao
  force_rotate_above: 0.85

retry:
  max_tentativas: 3      # LIMITE DE ESCALACAO: estourado, pausa qualquer modo, ate o #Auto

policies:
  provider: block             # despacho por provider pago
  segredo_em_prompt: block
  push_direto_na_base: block
```

Rode `ork doctor` de novo. Ele agora lê o manifesto e válida o que você escreveu.

---

## 4. A primeira thread

```bash
ork thread new "corrigir o filtro de data do relatorio" --modo classic
```

```text
Thread criada.
  id        prd-corrigirofil
  slug      prd-corrigirofil-goal
  modo      #Classic (3 pausas humanas)
  fase      GOAL
  status    aberta
  base      main @ e7150770
  blocos
    goal   GOAL               pausa: objetivo
    plan   PLAN               pausa: plano
    f34    GO-CHECK           pausa: evidencias, com autorizacao antecipada de push
    f56    SHIP-MASTER        sem pausa (decisao autonoma no ledger)

  slug em 3 partes: produto "prd", assunto "corrigirofil", fases "goal"
  estado: .orkastery/threads/prd-corrigirofil/thread.json
```

Sem `--modo`, o `ork` usa o `conduction.default_mode` do manifesto. Se o pedido do builder
trouxer uma #TAG, o adaptador de host a extrai chamando o próprio núcleo:

```bash
ork modos --do-pedido "arrumar o botao #Maestro"
# maestro
```

O **slug de 3 partes** (`prd-corrigirofil-goal`) e o nome da sessão no runtime: produto,
assunto, bloco de fases. Você olha `claude agents` e sabe, sem abrir nada, de que produto e de
que fase e cada sessão viva.

---

## 5. Despache a fase

```bash
ork phase run prd-corrigirofil GOAL --prompt "o filtro de data ignora o fuso do usuario"
```

O que acontece, nesta ordem:

1. O `ork` **monta o prompt** com a nomenclatura das fases, o modo de condução, o contexto da
   thread, a memória injetada e as regras de evidência.
2. Grava o texto exato em `.orkastery/threads/<id>/prompts/`, **com sha256**.
3. Avalia as policies do manifesto. Policy `block` para aqui, em qualquer modo.
4. Despacha pelo runtime adapter, com o par `model`/`effort` resolvido **uma única vez**.
5. Volta ao runtime e **reverifica que a sessão existe**. Self-report de despacho não vale.
6. Grava `phase_dispatch` no ledger com o modelo e o esforço **efetivos**, como fato.

Para ver antes de gastar nada:

```bash
ork phase run prd-corrigirofil GOAL --prompt "..." --dry-run
ork prompt render prd-corrigirofil --fase GOAL --pedido "..."   # o texto exato, com o sha256
```

Acompanhe:

```bash
ork sessions                    # sessoes vivas, cruzadas com as threads
ork sessions logs <sessao>
ork phase list prd-corrigirofil # o historico do ledger, com o modelo real de cada fase
```

---

## 6. Registre a evidência, e depois duvide dela

Este é o passo que separa o `ork` de um wrapper de prompt.

```bash
# a fase afirma alguma coisa. a afirmacao vem com o comando que a comprova.
ork claims add prd-corrigirofil src/relatorio.ts \
  --claim "o filtro respeita o fuso do usuario" \
  --verificar "npm test -- relatorio"

# antes do GO, grave o estado do mundo: o que ja estava quebrado nao e culpa desta thread
ork verify prd-corrigirofil --baseline

# ... GO acontece ...

# no CHECK, reexecute tudo no HEAD real
ork verify prd-corrigirofil
```

Se a claim reprovar, o gate bloqueia com **motivo tipado** (`claims.failed`,
`verify.regression`, `verify.failed`), com a saída real do comando anexada. E o `ork` sabe o
que fazer com cada motivo:

```bash
ork retry plan prd-corrigirofil        # o que ele faria (calcula, nao executa)
ork fix open prd-corrigirofil          # GO-FIX: a spec da correcao sai do verify, nao de prosa
ork fix reverify prd-corrigirofil      # CHECK-REVERIFY, com veredito POR correcao
```

---

## 7. Gate de tokens entre as fases

Ao fim de uma fase, antes de despachar a próxima:

```bash
ork gate next prd-corrigirofil --proximo GO
```

```text
  ocupacao       nao medivel
  fonte          unavailable
                 o adapter claude-bg nao expoe uso de contexto nesta versao do runtime
  limiares       rotate_above 0.7 | force_rotate_above 0.85
  proximo passo  GO (pesado)

VEREDITO: same-session  (decidido por ausencia-de-medida)
  razao: a rotacao NAO e decidida por dado inexistente.
```

Repare no que ele **não** fez: não inventou um número. Se você tem a medida, informe, e a
decisão passa a ser tomada com dado real:

```bash
ork gate next prd-corrigirofil --proximo GO --ocupacao 0.78
ork gate next prd-corrigirofil --proximo GO --transcript ~/.claude/projects/.../sessao.jsonl
```

Quando o veredito for `new-session`, exporte o handoff triado:

```bash
ork handoff export prd-corrigirofil --proxima-fase GO
ork recall prd-corrigirofil --fase CHECK      # resolve SO os ponteiros daquele momento
```

---

## 8. Entregue

```bash
# nos modos que pausam no SHIP, a autorizacao humana e explicita
ork gate approve prd-corrigirofil push --por "seu-nome"

ork ship prd-corrigirofil --para main --dry-run
ork ship prd-corrigirofil --para main --autorizar-push "seu-nome"
```

O `ship` executa sete passos, e a ordem e contrato: autorização pelo gate do modo, policies do
manifesto, `ork verify` independente, lease `main-tree` (que serializa: **uma thread mergeia
por vez**), `git merge --no-ff` conferido por `merge-base --is-ancestor`, push **provado por
`git ls-remote`**, e `ship_done` no ledger com os dois shas.

Qualquer passo que reprove grava `ship_blocked` com motivo tipado, e não avança.

---

## 9. Feche com o score

```bash
ork master prd-corrigirofil --score 4 \
  --justificativa "plano segurou, mas o fuso apareceu tarde no CHECK" \
  --classe erro-de-spec
```

Isso grava o `POSTMORTEM.json` (com classe de falha das nove fixas) e o `master-log.json` (nó
contrato congelado `ork.master-log/v1`). Score sem justificativa é recusado, em qualquer modo.

Nos modos que não pausam no MASTER, a thread cai na fila de batch:

```bash
ork master --batch        # as threads entregues e ainda sem score
```

---

## 10. Várias threads ao mesmo tempo

```bash
ork board                  # as threads deste projeto
ork board --all            # todas as threads de todos os perfis desta maquina
ork board plan             # quem pode avancar agora, quem espera, e por que
ork lease list             # os leases, as familias e as filas
```

```text
Escalonador por maquina
  limite de paralelismo: 3 (concurrency.max_parallel_threads) | em andamento agora: 1

  THREAD            MODO      FASE  SITUACAO      MOTIVO      DETALHE
  prd-corrigirofil  #Classic  GO    pode-avancar  -           vaga 1/3, sem colisao de lease
  prd-migrarauth    #Classic  GO    espera        lease.busy  path:src/auth/** com prd-corrigirofil
```

---

## Instale no seu host

Até aqui você chamou o `ork` na mão. O uso normal e por um host da Camada 1:

```bash
ork adapter list
ork adapter show claude-code          # os 3 pitfalls de instalacao
ork adapter install claude-code --dry-run
ork adapter install claude-code
```

Depois disso, no Claude Code você escreve o pedido com a #TAG e usa `/goal`, `/plan`, `/go`,
`/check`, `/ship`, `/master`. O host não tem regra de negócio nenhuma: ele só traduz.

---

## Próximos passos

- [`conceitos.md`](../conceitos/visao-geral.md): o vocabulário inteiro, em uma página.
- [`modos.md`](../guias/modos.md): escolher entre `#Classic` e `#Auto` sem errar, e o que aconteceu com `#Look` e `#Ork`.
- [`verificacao.md`](../guias/verificacao.md): claims, baseline, motivos tipados, retry e GO-FIX.
- [`cli.md`](../referencia/cli.md): a referência completa de comandos.

<!-- maestro-i32:begin -->
## Entrada conversacional I-32 (candidata em GO)

Depois de instalar e ativar o adaptador no projeto, diga `orkastery maestro`.
O núcleo consulta o panorama; não cria thread nem pede onboarding novamente.
`maestro.project.missing` indica projeto ausente; `maestro.project.ambiguous` pede
seleção entre candidatos permitidos. Não escolha por semelhança de título.

No terminal, consulte `ork maestro --json` ou `ork maestro --help`. Para uma thread
conhecida, use `ork maestro --json --thread ID`; `--section sessions --offset N`
continua a página indicada em `coverage.nextOffset`. Vazio e indisponível são distintos.

Usabilidade HITL tem prioridade máxima: tópicos, recomendação, opções rotuladas e
cancelamento. Telegram é opcional. O canal escolhido precisa de ingresso autenticado;
sem ele, a decisão permanece pendente. Sessão filha segue o bloco recebido, sem
redespachar. Mesma-harness não permite autorrevisão. Sem controle web.

Esses exemplos têm testes fixture no core; ativação nos quatro hosts e publicação
só serão declaradas após recibos live vinculados ao SHIP.
<!-- maestro-i32:end -->
