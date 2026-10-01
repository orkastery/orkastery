# Quickstart: do zero ao primeiro ciclo

Do clone à primeira thread conduzida com evidência verificada. O tempo em máquina limpa ainda não foi medido.

Nada aqui pede chave de API. O `ork` **não tem LLM embutido**: quem executa é o runtime que
você já usa, pela sua assinatura, pelo canal oficial dele.

---

## 0. Requisitos

| O que | Por que |
| --- | --- |
| Node 20 ou mais novo | O núcleo é TypeScript compilado para CommonJS, com quatro dependências de runtime |
| `git` | Worktree por thread, base carimbada, merge serializado e push provado |
| Um repositório git com pelo menos um commit | O `ork` conduz trabalho dentro de um repositório, nunca solto no disco; a thread parte do commit da base, e sem commit ela nasce sem base |
| Um runtime de agente | Hoje o adapter `claude-bg` (o binário `claude`, despachado com `--bg`) |

O runtime é opcional para os passos 1 a 4. Sem ele, você ainda cria threads, registra claims,
roda `verify`, fecha MASTER e usa todo o resto. O que você não consegue é **despachar fase**.

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
git clone https://github.com/orkastery/orkastery.git
cd orkastery/core
npm install
npm run build      # gera dist/index.js, o bin `ork`
npm test           # executa a suíte atual, com fixtures isoladas
npm link           # põe o `ork` desta árvore no PATH
```

O restante deste guia escreve `ork`. Se você não instalou global nem fez `npm link`, troque por
`node <caminho>/core/dist/index.js`.

---

## 2. `ork doctor`: o que vale nesta máquina agora

Antes de qualquer coisa, pergunte à máquina em vez de supor.

```bash
cd /caminho/do/seu/projeto
ork doctor
```

Numa máquina com o Claude Code e sem o Codex, antes do `ork init`, a saída da 0.5.0 é esta:

```text
ork doctor: o que vale nesta maquina agora

  [ok]   node               v22.23.2
  [ok]   git                /usr/bin/git
  [ok]   repositorio        branch main
  [ok]   runtime claude-bg  /home/voce/.local/bin/claude (2.1.287 (Claude Code))
  [warn] runtime codex      binario `codex` fora do PATH (opcional: claude-bg e o runtime padrao)
                            correcao: para despachar pelo codex, instale o Codex CLI e autentique com `codex login`
  [FAIL] manifesto          orkastery.yaml nao encontrado a partir de /caminho/do/seu/projeto
                            correcao: ork init

Veredito: BLOQUEADO (1 fail, 1 warn). Corrija os itens acima antes de despachar fase.
```

O `doctor` sai com código diferente de zero quando está **bloqueado**, e nunca por um `warn`.
Cada `FAIL` traz a correção; a deste é o passo 3. Ele é a primeira linha de qualquer script de CI
que use o `ork`.

---

## 3. `ork init`: o manifesto do projeto

```bash
ork init --name "meu-produto" --abbrev prd
```

Isso gera o `orkastery.yaml`, a **fonte única** da configuração do projeto, com limite duro de
16 KB, e um bloco do Orkastery no `AGENTS.md`. Prosa longa vai para a memória com tag, nunca para o
manifesto.

O estado do `ork` (`.orkastery/`) e as worktrees das threads (`.claude/worktrees/`) são da máquina,
não do repositório: deixe os dois fora do git e faça o commit do manifesto antes da primeira thread.

```bash
printf '.orkastery/\n.claude/worktrees/\n' >> .gitignore
git add .gitignore orkastery.yaml AGENTS.md
git commit -m "ork init"
```

Depois de `init`, execute `ork onboarding` para obter a pauta. Use `ork onboarding show --json` para retomar pendências; respostas públicas são registradas por etapa. Credenciais ficam em `~/.hermes/.env`, somente os nomes de variáveis entram na entrevista. Veja o [guia completo](../guias/onboarding.md).

O que você provavelmente vai querer ajustar logo de cara:

```yaml
project:
  abbrev: "prd"          # ate 3 caracteres, parte 1 do slug de sessao, unica no workspace
  stage: nascente        # nascente | crescendo | maduro: define os packs de auditoria ativos

conduction:
  default_mode: classic  # o modo usado quando o pedido nao traz #TAG
  allowed_modes: [classic, maestro, auto, fast]

worktree:
  base_branch: "main"
  dir: ".claude/worktrees"
  por_thread: true       # a worktree da thread nasce com `ork thread new ... --worktree auto`

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

Rode `ork doctor` de novo. Ele agora lê o manifesto e valida o que você escreveu. Na mesma
máquina, logo depois do `ork init`:

```text
ork doctor: o que vale nesta maquina agora

  [ok]   node                         v22.23.2
  [ok]   git                          /usr/bin/git
  [ok]   repositorio                  branch main
  [ok]   runtime claude-bg            /home/voce/.local/bin/claude (2.1.287 (Claude Code))
  [warn] runtime codex                binario `codex` fora do PATH (opcional: claude-bg e o runtime padrao)
                                      correcao: para despachar pelo codex, instale o Codex CLI e autentique com `codex login`
  [ok]   manifesto                    /caminho/do/seu/projeto/orkastery.yaml (4114 B de 16384)
  [warn] onboarding                   9 etapa(s) pendente(s): maestro, credenciais, bancos, memoria, produtos, topologia, arquitetura, skills, auditores
                                      correcao: ork onboarding
  [ok]   abbrev do projeto            "prd" (parte 1 do slug de sessao)
  [ok]   modos de conducao            padrao #Classic; permitidos #Classic, #Maestro, #Auto, #Fast
  [ok]   fuso do dono                 America/Sao_Paulo (fuso do sistema; owner.timezone nao configurado)
  [ok]   custo e provider herdado     politica subscription-only; nenhuma variavel de provider pago ativa
  [ok]   provider efetivo da fabrica  nenhum nome da lista de provider ativo
  [ok]   fonte da memoria             /caminho/do/seu/projeto/orkastery.yaml
  [ok]   regime de memoria            files (fallback honesto: handoff por arquivos, ponteiro path#ancora)
  [ok]   chave de embedding           memory.embedding com provider none: busca por significado desligada
  [ok]   fila de rate limit           vazia: nenhuma fase morreu por limite de uso neste projeto
  [ok]   estado do projeto            /caminho/do/seu/projeto/.orkastery (0 thread(s))
  [ok]   contas por runtime           nenhum perfil configurado: cada runtime despacha pelo ambiente do processo
  [ok]   umask                        umask 0022 nega escrita de grupo e outros
  [ok]   permissoes do estado         /caminho/do/seu/projeto/.orkastery com modo 0755
  [ok]   pasta privada                /caminho/do/seu/projeto/.orkastery/private ausente: criada sob demanda com 0700
  [ok]   governanca de sessoes        voce, Claude e Codex, global com histórico: 0 sessões; 0 sem thread; 0 ambíguas; inventário válido

Veredito: PRONTO (2 warn). Despacho de fase liberado por `ork phase run`.
```

---

## 4. A primeira thread

```bash
ork thread new "corrigir o filtro de data do relatorio" --modo classic --worktree auto
```

```text
Thread criada.
  id        prd-corrigirofil
  slug      prd-corrigirofil-goal
  nome      corrigir o filtro de data do relatorio
  modo      #Classic (3 pausas humanas previstas)
  ciclo     padrao do modo
  fase      GOAL
  status    aberta
  base      ork/prd-corrigirofil-goal @ 75c5d7bd
  worktree  /caminho/do/seu/projeto/.claude/worktrees/prd-corrigirofil
  blocos previstos
    goal   GOAL               pausa prevista: objetivo
    plan   PLAN               pausa prevista: plano
    f34    GO-CHECK           pausa prevista: evidencias, com autorizacao antecipada de push
    f56    SHIP-MASTER        sem pausa humana prevista

  slug em 3 partes: produto "prd", assunto "corrigirofil", fases "goal"
  estado: .orkastery/threads/prd-corrigirofil/thread.json

Proximo passo: ork phase run prd-corrigirofil GOAL --prompt "<pedido>"
```

O `--worktree auto` dá à thread a worktree e a branch dela (`ork/prd-corrigirofil-goal`). Sem ele,
a thread roda na raiz do projeto, na própria branch base, e o `ork ship` do passo 8 sai barrado por
`push_direto_na_base`. Para uma thread que já nasceu assim, `ork worktree ensure <thread>` cria a
worktree e a branch.

Sem `--modo`, o `ork` usa o `conduction.default_mode` do manifesto. Se o pedido do builder
trouxer uma #TAG, o adaptador de host a extrai chamando o próprio núcleo:

```bash
ork modos --do-pedido "arrumar o botao #Maestro"
# maestro
```

O **slug de 3 partes** (`prd-corrigirofil-goal`) é o nome da sessão no runtime: produto,
assunto, bloco de fases. Você olha `claude agents` e sabe, sem abrir nada, de que produto e de
que fase é cada sessão viva.

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
  --verificar "node --test test/relatorio.test.js"

# antes do GO, grave o estado do mundo: o que ja estava quebrado nao e culpa desta thread
ork verify prd-corrigirofil --baseline

# ... GO acontece ...

# no CHECK, reexecute tudo no HEAD real
ork verify prd-corrigirofil
```

Prefira o teste focado: uma claim com `npm test` sem arquivo de teste roda a suíte inteira, e o
`ork claims add` avisa que o `ork ci prepare` vai recusá-la.

Se a claim reprovar, o gate bloqueia com **motivo tipado** (`claims.failed`,
`verify.regression`, `verify.failed`), com a saída real do comando anexada no ledger. E o `ork`
sabe o que fazer com cada motivo:

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
ork gate next: thread prd-corrigirofil
  ocupacao       nao medivel
  fonte          unavailable
                 o adapter claude-bg nao expoe uso de contexto nesta versao do runtime; nenhuma outra fonte foi informada (--ocupacao ou --transcript)
  limiares       rotate_above 0.7 | force_rotate_above 0.85
  proximo passo  GO (pesado)

VEREDITO: same-session  (decidido por ausencia-de-medida)
  razao: ocupacao da janela nao e medivel (fonte unavailable): a rotacao NAO e decidida por dado inexistente. Siga na mesma sessao e rotacione por decisao explicita se precisar.

Registrado no ledger como token_gate: ork phase list prd-corrigirofil
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
ork ship prd-corrigirofil --para main --dry-run

# nos modos que pausam no SHIP, a autorizacao humana e explicita e vai no proprio ship
ork ship prd-corrigirofil --para main --autorizar-push "seu-nome"
```

O `ship` executa sete passos, e a ordem é contrato: autorização pelo gate do modo, policies do
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

Isso grava o `POSTMORTEM.json` (com classe de falha das nove fixas) e o `master-log.json` (no
contrato congelado `ork.master-log/v1`). Score sem justificativa é recusado, em qualquer modo.

Nos modos que não pausam no MASTER, a entrega é aceita por omissão, com o índice derivado do
ledger. A nota humana, quando vier, sobrescreve:

```bash
ork master                    # as entregas, com o indice derivado do ledger
ork master --aceitar-omissao  # aceita as entregues, com indice e insumos no ledger
```

---

## 10. Várias threads ao mesmo tempo

```bash
ork board                  # as threads deste projeto
ork board --all            # todas as threads de todos os perfis desta maquina
ork board plan             # quem pode avancar agora, quem espera, e por que
ork lease list             # os leases, as familias e as filas
```

Trecho ilustrativo do `ork board plan`, com duas threads e uma esperando lease:

```text
Escalonador por maquina
  limite de paralelismo: 3 (concurrency.max_parallel_threads) | em andamento agora: 1

  THREAD            MODO      FASE  SITUACAO      MOTIVO      DETALHE
  prd-corrigirofil  #Classic  GO    pode-avancar  -           vaga 1/3, sem colisao de lease
  prd-migrarauth    #Classic  GO    espera        lease.busy  path:src/auth/** com prd-corrigirofil
```

---

## Instale no seu host

Até aqui você chamou o `ork` na mão. O uso normal é por um host da Camada 1:

```bash
ork adapter list
ork adapter show claude-code          # os 3 pitfalls de instalacao
ork adapter install claude-code --dry-run
ork adapter install claude-code
```

Copiar os arquivos não ativa o plugin. O instalador imprime a ativação no Claude Code; no
diretório do projeto, ela é esta, e depois vem o servidor MCP do projeto:

```bash
claude plugin validate "$PWD/.claude/plugins/orkastery"
claude plugin marketplace add "$PWD/.claude/plugins/orkastery" --scope project
claude plugin install orkastery@orkastery --scope project
ork mcp install --project "$PWD" --host claude-code
```

Numa sessão do Claude Code aberta no projeto, diga `orkastery maestro` ou use `/orkastery:ork`,
e escreva o pedido com a #TAG; as fases são `/orkastery:goal`, `/orkastery:plan`, `/orkastery:go`,
`/orkastery:check`, `/orkastery:ship` e `/orkastery:master`. O host não tem regra de negócio
nenhuma: ele só traduz. No Codex, `ork adapter install codex` põe a entrada `$ork` nas skills do
projeto.

O mesmo plugin, sem os hooks do projeto, também sai do marketplace do repositório
(`claude plugin marketplace add orkastery/orkastery` e `claude plugin install orkastery@orkastery`);
use um dos dois caminhos, porque os dois se chamam `orkastery`.

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

## Preferências da conversa

⌨️ No terminal, dentro do projeto inicializado, rode `ork onboarding` e `ork experiencia show --json`. A etapa maestro oferece ativar, configurar idioma/fuso/profundidade ou desativar. Depois use `ork adapter install <host> --dry-run` e `ork adapter install <host>`. Veja o [guia em português](../guias/orchestration-experience.pt-BR.md) ou [English](../guias/orchestration-experience.md) para descoberta, opt-out e restauração.
