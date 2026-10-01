# Changelog

As mudanças do pacote [`@orkastery/cli`](https://www.npmjs.com/package/@orkastery/cli), da mais
nova para a mais antiga. O detalhe de cada item, com a evidência de merge, está no
[roadmap](docs/roadmap/README.md).

## Não publicado

### Adicionado

- **Prova de ativação do Maestro por host** ([RM-032](docs/roadmap/RM-032-bootstrap-maestro.md)):
  `node core/scripts/prova-ativacao.cjs <claude-code|openclaw>` instala o adaptador numa cópia
  descartável, abre uma sessão nova e não interativa no host (`claude -p` com `--plugin-dir`;
  `openclaw agent --local` com estado temporário) e diz `orkastery maestro`. A conferência
  (`core/src/prova-ativacao.ts`) exige a entrada do host chamada (`ork maestro` pelo shell é
  desvio), o resultado no contrato (`ork.maestro-snapshot/v1` ou `ork.network-roadmap/v1`), o
  projeto da cópia, o que não foi lido e uma resposta sem "roadmap vazio". O recibo
  `ork.prova-ativacao/v1` traz comandos, horários, versão do host e o sha256 da configuração global
  do host antes e depois, é redigido campo a campo antes de ser gravado e lista o que só o dono
  pode fazer. O roteiro fica no repositório, fora do pacote.

### Corrigido

- **Defeitos de condução de 27/09 a 01/10/2026** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md), fatia 3):
  - `ork docs verificar` reprova o item cuja thread (`sdlc.thread`) já entrou na base pelo merge
    `ship(<thread>)` e segue fora de `Mesclado` (`docs.paridade.merge`), e o índice gerado que
    diverge do frontmatter (`docs.paridade.indice`); `ork docs sincronizar --escrever --so RM-NNN`
    corrige os dois. No PR (`ork docs verificar --pr`, o que o CI usa), as duas regras só avisam, e o
    push da `main` reprova: a página de outra thread não trava o PR de ninguém;
  - o check `documentacao` do CI exige linha nova em "Não publicado" quando o PR muda `core/`,
    `adapters/` ou `marketplaces/` (`core/scripts/checar-changelog.cjs`, `changelog.linha-ausente`);
    PR só de testes ou só de CI fica de fora, e o PR de versão passa pela seção nova;
  - `ork worktree sync` recusa a base reescrita também com ancestral comum (force-push que tirou
    commits): com commit próprio, `tree.blocked` com a causa `base-reescrita` e o `git rebase --onto`
    que reaplica só os commits da thread; sem commit próprio, a branch é recriada na base;
  - o commit, o verify, o SHIP e a escrita de artefato pelo MCP soltam o lease e a fila de thread
    fechada antes de conferir a região, com registro no ledger dela; lease de thread aberta segue
    barrando;
  - `ork_git_status` e `ork_git_commit` aceitam hard link no armazém de objetos do `.git` (clone
    local), que o git nunca abre para escrita; fora dele, `mcp.git.metadata.unsafe` diz o caminho e a
    receita sem perda;
  - `ork ship registrar-pr --dry-run`, também com `--repo --pr` e `--todas`, faz as mesmas
    conferências e não grava `ship_done`, fase nem fábrica;
  - `ork doctor` reprova arquivo ou pasta do `.git` com dono diferente do dono do repositório, com
    o `sudo chown -R` exato na correção, sem rodar nada.

## [0.5.0] - 2026-09-30

### Adicionado

- **Grafo de código: extração, índice e consulta** ([RM-031](docs/roadmap/RM-031-grafo-de-codigo.md), KG2 e KG3):
  - extração determinística de um repositório local no contrato `ork.code-artifact-graph/v1`
    (KG2): TypeScript e JavaScript pelo compilador, Markdown (seções, links, frontmatter e IDs
    citados) e a proveniência de cada aresta; o que não se prova fica fora e declarado, e a mesma
    entrada dá o mesmo grafo e o mesmo digest em qualquer ordem de leitura;
  - `ork grafo indexar [--verificar] [--forcar]`: índice local e persistente do grafo do HEAD
    limpo, no estado do projeto e fora do git (pastas 0700, arquivos 0600), chaveado pela revisão,
    pela identidade e pelo extrator, e idempotente; `--verificar` confere contrato, bytes e
    determinismo;
  - `ork grafo vizinhos|chamadores|importadores|caminho`: consulta pelas arestas, em texto e
    `--json`, determinística e com o extrator e a evidência de cada aresta; a resposta diz que é
    parcial (só o que o extrator prova);
  - `ork grafo status`, `ork grafo amostra` e `ork grafo limpar`; o comando provisório do KG2 sai;
  - o `ork grafo` precisa do `typescript` e do micromark instalados no próprio pacote do `ork`
    (`ork grafo indexar` e as consultas), que não são dependências do pacote: sem eles, a recusa é
    `grafo.parser.indisponivel`.
- **Pacote de experiência de orquestração** ([RM-051](docs/roadmap/RM-051-pacote-de-experiencia.md)): preferências de idioma, fuso, profundidade e opt-out pelo onboarding; skills em inglês e pt-BR; blocos reversíveis em Claude Code/Codex e entrada Hermes; consultas MCP de reservas/fábrica e aviso de item sem associação. O bloco aponta o catálogo por caminho relativo ao projeto e é adotado num clone sem recibo; versão mantida.
- **Busca por significado na memória** ([RM-038](docs/roadmap/RM-038-busca-semantica-na-memoria.md)):
  - bloco `memory.embedding` no manifesto (provider, modelo, dimensão, o NOME da variável da chave,
    fallback local e teto de tokens); sem o bloco, desligado. O manifesto recusa valor de chave ou
    DSN, nome da lista de provider pago e a variável da DSN;
  - `ork memory index [--modelo primario|fallback|todos] [--dry-run]`: índice vetorial local e
    derivado do tenant, fora do git, idempotente, com tokens e custo estimados antes da rede;
  - `ork memory search --texto "<frase>"`: vetor e FTS por RRF dentro do tenant, com a origem
    declarada e `deterministico: false`; a busca por tag, o recall e o prompt não mudam;
  - `ork memory status` passa a sondar a ponte (`health`) e mostra o estado dos embeddings, a
    cobertura do tenant e, com `--sondar`, a latência de uma chamada real; a frase fixa de
    saúde, que nada sondava, deixou de existir. Embedding ausente nunca derruba o regime `orkmind`;
  - a policy `segredo_em_prompt` reconhece chave do OpenRouter, e o `ork doctor` confere a chave
    de embedding pelo nome.
- **Entrega em repositório externo** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  `ork ship registrar-pr <thread> --repo <dono/nome> --pr <n>` registra `ship_done` de PR mesclado
  em repositório declarado em `ci.external_repositories`: o PR cita a thread e entrou na branch
  padrão, o merge está dentro da ponta da base pela API do GitHub e o check declarado está verde no
  head do PR.
- **Decisão autônoma pelo MCP** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)): a
  ferramenta `ork_decision_record` grava pelo mesmo contrato do `ork decisao registrar`, para a
  sessão cujo sandbox não grava o ledger.
- **Projeto-alvo explícito** ([RM-052](docs/roadmap/RM-052-projeto-alvo-explicito.md)):
  - `--projeto <nome|caminho>`, opção global em qualquer comando, e `ORK_PROJETO`, com precedência
    sobre o diretório atual; nome ambíguo ou desconhecido recusa com os candidatos, na saída 4;
  - registro dos projetos desta máquina em `~/.orkastery/projetos.json` (`ork.projetos/v1`, sem
    segredo), alimentado por `ork init`, `ork thread new` e `ork fabrica entrar`; `ork projetos`
    lista, `registrar` e `esquecer` cuidam das cópias antigas;
  - toda tool do OpenClaw e do MCP aceita `projeto`; OpenClaw e Hermes declaram
    `ORK_PROJETO_EXPLICITO=1` e, sem projeto e com mais de um conhecido, devolvem a escolha em vez
    de ler o diretório do gateway; o MCP continua fixado e recusa outro projeto;
  - `ork maestro`, `ork board`, `ork board plan`, `ork fabrica` e `ork roadmap status` dizem no
    alto qual projeto leram (nome, raiz, remoto, origem) e o que não leram; sem remoto, board e
    fábrica dizem que nada foi lido, nunca "nenhuma publicou ainda".
- **Roadmap da rede, de qualquer diretório** ([RM-054](docs/roadmap/RM-054-roadmaps-e-threads-da-rede.md), fatia 1):
  `ork network roadmap [--projeto P] [--json]` junta, para cada projeto, o status report do
  roadmap com as threads de todas as máquinas, as reservas e as threads por máquina, com a fonte
  e a hora de cada parte (contrato `ork.network-roadmap/v1`). Sem clone, lê a forja só com
  consulta (`gh api graphql` numa chamada; GitLab pela mesma interface). O que não foi lido sai
  como lacuna tipada, nunca como "vazio".
- **Roadmap da rede nos hosts** ([RM-054](docs/roadmap/RM-054-roadmaps-e-threads-da-rede.md), fatia 2):
  - `ork_network_roadmap` no OpenClaw, no Hermes (`bin/ork-network-roadmap.sh`) e no MCP, e a rota
    nas entradas do Claude Code e do Codex: o status do roadmap nos hosts passa a vir do panorama
    da rede, com as threads de todas as máquinas e a fonte e a hora de cada parte, transportado
    como vem; `ork_roadmap_status` fica como o relatório só desta máquina;
  - a frase `orkastery maestro` sem projeto oferece o panorama da rede, e a recusa
    `projeto.escolha` do projeto-alvo passa a oferecê-lo também; o "Não lido" de maestro, board,
    fábrica e roadmap status aponta `ork network roadmap`;
  - o manifesto do OpenClaw declara `ork_network_roadmap` nos perfis `coding` e `messaging`
    (`toolMetadata`): no perfil `coding`, o padrão do OpenClaw, nenhuma tool `ork_*` chegava ao
    modelo; as outras continuam sob `tools.alsoAllow` do operador;
  - com `ORK_PROJETO_EXPLICITO=1`, `ork network roadmap --projeto` aceita só o nome registrado ou a
    forja (`github:dono/repo`) em `github.com`, `gitlab.com` ou no host de um projeto registrado, e
    o projeto do diretório do gateway só entra pelo registro; no MCP, a tool lê só o projeto
    servido;
  - fica para a fatia 3, com a RM-053 na `main`: `ork_network_status` e a rede por pessoa como
    fonte de projetos e máquinas.
- **Plugin nos marketplaces** ([RM-049](docs/roadmap/RM-049-lancamento.md)): o plugin do Claude
  Code (20 skills, 8 comandos, 6 subagentes e as checklists) e o plugin de skills do Codex (a
  entrada `ork` e as 20 skills), em `marketplaces/`, gerados do catálogo por
  `core/scripts/gerar-marketplaces.cjs` na versão do `@orkastery/cli` e conferidos no CI com
  `--verificar`. Sem hooks nem MCP: instalado pelo diretório, o plugin vale para a conta toda, e o
  guard e os sensores seguem no `ork adapter install claude-code`, por projeto. Os marketplaces
  próprios na raiz do repositório instalam sem esperar a revisão dos diretórios
  (`claude plugin marketplace add orkastery/orkastery`, `codex plugin marketplace add orkastery/orkastery`).
- **HITL humano no centro** ([RM-048](docs/roadmap/RM-048-hitl-humano-no-centro.md)):
  - todo pedido sai num contrato curto, `ork.hitl-curto/v1`: pergunta em uma frase, o que trava e
    desde quando, até quatro alternativas de uma linha, uma recomendada com o porquê e a última
    linha dizendo o que digitar, em no máximo 15 linhas, no Telegram, no terminal e no OpenClaw;
  - a resposta em texto livre registra quando é inequívoca (`aprovo`, `sim`, `pode seguir`, `a`,
    `1`, `1. B, 2. A`); ambígua, volta como pergunta com as opções reais. Com mais de um pedido
    aberto na mesma thread, texto livre não registra. A prova HMAC do ingresso não muda;
  - a linha que o dono recebe não vence em uma hora: o código do gate é estável, `<código> a`
    responde ao gate, e a resposta a pedido vencido vai ao pedido renovado quando a pergunta é a
    mesma;
  - impedimento técnico deixa de virar pergunta ao dono e aparece no resumo como "Conosco";
  - `ork roadmap status`: o status report único do roadmap, que os canais chamam em vez de
    escrever o próprio;
  - `ork master pedir`: a nota do MASTER com prova de canal. `ork master` com `--por` vindo de
    processo de host é recusado com `master.prova-de-canal`, e a `ork_master` do OpenClaw deixa de
    receber nome de pessoa.
- **Pacote de contexto citável do Company Brain** ([RM-025](docs/roadmap/RM-025-company-brain-fundacao.md)):
  `ork brain context --thread <id> --ids <ids>` devolve o pacote `ork.brain-context/v1`, com cada
  entidade do portfólio, a citação da fonte, o frescor contra o portfólio canônico e as lacunas
  tipadas, e um digest reproduzível. Item sem citação vira lacuna, nunca conteúdo. Somente
  leitura; também como `ork_brain_context` no MCP e no OpenClaw, que passa a ter 25 tools.
- **Dossiê de decisão** ([RM-026](docs/roadmap/RM-026-workspace-empresarial.md), K3.1):
  `ork brain dossie --thread <id> [--decisao <id>]` devolve o dossiê `ork.dossie-de-decisao/v1`: o
  vínculo da thread com o objetivo (o ticket do K1) e o projeto do portfólio, o pacote de contexto
  citável e cada decisão do ledger com as alternativas, quem decidiu, a evidência, a citação da
  linha e os ids que o Brain dá ao fato (`fact-…`). A resposta do dono só aparece com o recibo do
  ingresso conferido; sem ele, vira lacuna. Somente leitura; também como `ork_brain_dossie` no MCP
  e no OpenClaw, que passa a ter 26 tools.

### Mudado

- **Defeitos da noite de 29/09/2026** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  - `ork ci prepare` grava `.ork-ci/<thread>.json`, com a branch da thread, e o CI roda
    `ork ci run --branch <branch>`: duas PRs não mudam mais o mesmo bundle. O `.ork-ci/bundle.json`
    de antes só vale quando a thread dele bate com a branch, e a `main` roda só os comandos do
    manifesto;
  - fechar a thread (`ork master`, `ork thread close`) solta os leases de escrita e as esperas dela
    na fila, com `lease_released` e `lease_dequeued` no ledger; espera de thread já fechada não barra
    mais quem pede a região;
  - o fechamento solta a reserva do item do roadmap, ou a passa para outra thread aberta do mesmo
    item; `ork roadmap reservas` marca a reserva órfã e `--soltar-orfas` a solta com registro;
  - o retrato da fábrica leva runtime, modelo e esforço de cada thread, do último `phase_dispatch`,
    e o `ork fabrica`, o `FABRICA.md` e o panorama da rede mostram;
  - `ork docs sincronizar` ganha `--so RM-NNN` e `--todos`; na worktree de uma thread com item, o
    padrão é o item dela;
  - `ork roadmap feat` reserva o próximo número de FEAT na branch `ork/roadmap-reservas`: duas
    máquinas não levam mais o mesmo número.
- **`ork board --json` vira objeto** ([RM-052](docs/roadmap/RM-052-projeto-alvo-explicito.md)):
  `{contrato: 'ork.board/v1', consulta, threads}`, com a lista de antes em `threads`. `board plan`,
  `fabrica` e `roadmap status` ganham o campo `consulta`; o snapshot do maestro ganha
  `project.root`, `project.remote` e `notConsulted`, opcionais no contrato `v1`.

### Corrigido

- **Defeitos de condução de 29/09/2026** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  - o despacho codex de bloco com GO grava a baseline antes de soltar a sessão, pela mesma
    execução do `ork verify --baseline`;
  - o modo plano do PLAN e o review nativo do CHECK valem só para o bloco que termina na fase de
    entrada: no #Auto, a sessão codex segue do PLAN ao GO e do CHECK ao SHIP como no claude-bg;
  - `ork phase run` recusa com `concurrency.limite` quando o projeto já tem
    `max_parallel_threads` sessões vivas em outras threads, e `--esperar` espera a vaga;
  - `ork decisao registrar` diz o campo e o tamanho quando o texto passa do teto;
  - `ork ci prepare` grava o bundle na worktree da thread, não na raiz do projeto;
  - o teste D-6 de modelo inacessível deixa de depender da corrida com o observador destacado.

## 0.4.3 — 29/09/2026

### Removido

- **Tools aposentadas no OpenClaw:** `ork_objective_status` e `ork_objective_message` saem do plugin.
  Desde a I-43 elas só devolviam a recusa `objective.aposentado`. O plugin fica com 23 tools.

### Corrigido

Sete defeitos de condução achados em 28/09/2026, que travavam a própria fábrica
([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):

- **Sessão claude-bg à espera humana depois do Stop.** A sessão que encerrava o turno e ficava em
  `blocked` com o processo vivo nunca concluía a fase, e a pausa humana não abria: uma ficou 41
  minutos travada até o processo morrer. Agora, na segunda leitura, abre `human.pending`, com a
  prova da fase ou com o que faltou dela no diagnóstico.
- **`ork sessions stop|logs|attach` com perfil de conta.** A sessão de um perfil que não é a
  conta do processo respondia "não encontrada no runtime". Agora ela é procurada em cada perfil
  claude-bg do projeto e o comando roda com o `CLAUDE_CONFIG_DIR` dela.
- **`ork_git_status` e `ork_git_commit` com hook próprio.** O `pre-push` da trava do corte fazia
  as duas ferramentas recusarem o repositório, embora o commit nunca o execute. Hook e seção
  `orkastery.*` do config que o commit nunca executa passam a ser aceitos; hook que ele
  executaria continua recusado, com o nome e a saída. O `ork_ship` do MCP segue estrito. Nenhum
  hook é desativado.
- **Contexto de despacho vazado.** O daemon do `claude --bg` guardava o ambiente do primeiro
  despacho da conta e o passava a todas as sessões reserva, que nasciam com a identidade de outra
  thread. A identidade agora vai por sessão em `--settings`, fica fora do ambiente do processo
  `claude`, e o CLI de dentro de uma sessão Claude só aceita a que o ledger liga à sessão dela.
- **`ork worktree sync` sobre base reescrita.** Numa branch sem commit próprio, cuja base ganhou
  raiz nova, o sync faria rebase de histórias sem relação. Agora a branch é recriada no SHA da
  base; com commit próprio, o sync recusa com o `git rebase --onto` exato. Na thread
  `merge-branch`, a ponta da branch existente nunca conta como base, para os commits dela não
  sumirem no sync.
- **Modelo inacessível na conta.** O despacho com um modelo que a conta não tem virava
  `runtime.unavailable` e repetia o mesmo modelo na mesma conta. O motivo novo
  `runtime.model-unavailable` mantém o perfil no rodízio, e o retry tenta outro perfil com o
  mesmo modelo, depois o fallback do bloco; sem destino, diz a correção exata do setup.
- **Teste instável no CI.** "N1 claude-bg com perfis a,b" esperava o resultado que só o
  observador destacado grava; agora conduz a observação no próprio processo, como a versão codex.

## 0.4.2 — 28/09/2026

### Mudado

- **Decisões do tamanho de um dia cheio** no README e no README do pacote: toda pergunta que o
  `ork` traz é curta, organizada, com alternativas e uma recomendação, pensada para quem conduz
  dezenas de frentes ao mesmo tempo.

### Corrigido

- **Sessões despachadas nascem sem escrita de grupo** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)).
  Com o `umask 002` comum em contas Linux, o Codex criava o histórico da sessão com escrita de grupo,
  o sensor recusava a fonte, e o `ork` perdia a visão da sessão, que seguia rodando sem registro. O
  `ork` agora acrescenta os bits 022 ao próprio umask ao iniciar, sem afrouxar um umask mais
  restrito, e tudo o que ele cria ou despacha herda isso.

- **Observação de sessão codex sob carga** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)).
  Com a máquina ocupada, o registro e o observador recusavam uma sessão legítima, e o `ork-verify`
  do CI caía com um teste diferente a cada rodada:
  - o `state.json` do controller, que o worker regrava por arquivo temporário e rename, trocava de
    inode entre a conferência e a abertura, e o sensor recusava a fonte. Agora ele confere e abre de
    novo, até cinco vezes, e só aceita o descritor cujo inode é o conferido;
  - o relógio de referência era lido antes do `state.json` e do rollout. O close e as linhas
    gravados durante a leitura pareciam do futuro, e o observador morria sem `phase_result`. Agora
    o relógio é lido depois da leitura, e o que vem do futuro de fato continua recusado.
- O teste da fonte corrompida corrompe o `launch.json`, que o controller grava uma vez só. No
  `state.json`, a regravação do worker podia desfazer a corrupção antes da validação.

## 0.4.1 — 28/09/2026

Primeira publicação da linha 0.4 no npm. A tag `v0.4.0` não chegou ao registro: a prova de origem
do npm recusou a URL do repositório escrita com maiúscula. Tudo o que está na 0.4.0, abaixo, sai
nesta versão.

### Corrigido

- A URL do repositório no pacote, nos READMEs, nos guias e nos modelos de issue passa a ser
  `github.com/orkastery/orkastery`, em minúsculas, como a prova de origem do npm exige. O
  workflow de publicação confere essa URL antes de compilar.
- **Três testes instáveis do CI** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  - o leitor de YAML do núcleo lia o SHA curto `0123456` como o número `123456`. Inteiro com zero à
    esquerda ou além da precisão segura agora fica texto, e o `ork docs verificar` deixa de acusar
    como inexistente um commit que existe;
  - o lock do observador de sessão caía com `ENOENT` quando o dono o soltava no meio do recovery
    de outro processo. Agora o outro processo assume o lock livre, e o resultado continua único;
  - as fixtures do controller simulado criavam pastas com o `umask` de quem roda. Em conta com
    `umask 002`, o sensor recusava, com razão, a fonte com escrita do grupo.

## 0.4.0 — 28/09/2026 (não publicada no npm)

### Adicionado

- **Lições viram avisos de policy** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md), fatia 3):
  `verify_regression` e `verify_failed` (bloco com GO sem baseline), `runtime_unavailable` (bloco
  sem runtime de fallback) e `tree_blocked` (ship com a branch atrás da base). Em `warn`, o gate
  imprime a correção exata e grava `policy_warn`, sem parar nada; em `block`, reprova como as
  outras policies. O `ork licoes` diz quais propostas já podem ser declaradas.

### Mudado

- **Nova frase de apresentação** no README e na descrição do pacote: "A software factory of AI
  agents that proves its work: parallel threads, verified results, and short decisions only when
  they matter."

### Corrigido

- `ork ci run` não rodava o `verify.preparo` do manifesto: a claim que usava a compilação do
  preparo passava no `ork verify` local e reprovava no CI. Agora os dois rodam o mesmo preparo.
- **Nenhuma superfície ensina comando aposentado**
  ([RM-046](docs/roadmap/RM-046-go-to-open-source.md)). As correções impressas pelo núcleo
  (`board`, `retry`, `fix`, `doctor`, `ship`), o guard e os comandos do Claude Code, as skills,
  os guias e a definição de pronto deixam de mandar rodar `ork gate approve`,
  `ork master --batch` e `ork objective`.
  - A pausa se libera pela resposta ao `ork gate request`, que chega pelo canal autenticado.
  - O push se autoriza no próprio `ork ship <thread> --para <base> --autorizar-push <quem>`.
  - As entregas se veem com `ork master`; a tool `ork_master_batch` do OpenClaw roda
    `ork master --todas --json`.
  - Os scripts `ork-objective-*` do Hermes saíram; as duas tools `ork_objective_*` do OpenClaw
    ficam no catálogo e dizem que devolvem a recusa `objective.aposentado`.

## 0.3.0 — 27/09/2026

### Adicionado

- **Modo `#Fast`** ([RM-042](docs/roadmap/RM-042-modo-fast.md)): uma fase só (GO), sem pausa,
  para pedido pequeno e claro.
  - Prova mínima: teste focado, claim de até dois comandos ou ausência declarada com
    `ork claims ausente`.
  - Não autoriza push sozinho e não commita arquivo de contrato público.
  - Default próprio: `claude-bg/sonnet/high`, com fallback `codex:gpt-5.6-terra:high`.
- **Condução multicanal** ([RM-036](docs/roadmap/RM-036-maestro-multicanal.md)): um dono,
  vários canais, e nunca duas execuções na mesma worktree.
  - Despacho, `ork verify`, GO-FIX, retomada e o `ork_verify` do MCP tomam o lease
    `exec:<thread>`, e o segundo pedido sai na hora com quem conduz e três ações: esperar
    (`--esperar`), acompanhar (`ork conducao status`) e assumir (`ork conducao assumir`).
  - A mesma fase com o mesmo pedido devolve a sessão em andamento, sem sessão nova.
  - Todo despacho grava o canal de origem, e a linha "conduzido agora por ..." é a mesma no
    board, no monitor, no pulse, no `ork thread status` e no panorama do Maestro.
- **Reservas de item do roadmap entre máquinas**
  ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)): `ork roadmap reservas`,
  `ork roadmap pegar` e `ork roadmap soltar`, e `ork thread new --roadmap RM-NNN`. A reserva é
  gravada por push atômico numa branch própria: duas máquinas não pegam o mesmo item.
- **HITL em camadas** ([RM-041](docs/roadmap/RM-041-hitl-invertido.md)): a decisão óbvia vem
  tomada e chega no resumo (`ork decisao registrar`). Pergunta real vem com contexto,
  alternativas e recomendação, e o dono responde em lote.
- **Documentação como código** ([RM-044](docs/roadmap/RM-044-documentacao-como-codigo.md)):
  `ork docs verificar`, `ork docs sincronizar` e `ork docs init` conferem a documentação de
  produto e o roadmap contra o código e o git.
- **Pulse enxuto** ([RM-045](docs/roadmap/RM-045-pulse-enxuto.md)): a fila só traz quem pode
  responder, e a varredura cabe no teto de tempo.
- **Rotação de contas dos runtimes** ([RM-033](docs/roadmap/RM-033-rotacao-de-contas.md)):
  `ork accounts` e ordem de fallback por bloco (`ork setup <modo> --bloco N --fallback`). O
  login é sempre do próprio CLI do runtime.
- **Horário do dono** ([RM-035](docs/roadmap/RM-035-horario-do-dono.md)): `owner.timezone` no
  manifesto vale em toda superfície humana.
- **Radar e entrega** ([RM-001](docs/roadmap/RM-001-radar-ork-pulse.md),
  [RM-003](docs/roadmap/RM-003-hitl-bidirecional-telegram.md),
  [RM-005](docs/roadmap/RM-005-master-e-digest.md)): `ork pulse`, HITL pelo Telegram e digest
  semanal do MASTER.
- **Telemetria, onboarding e playbook** ([RM-007](docs/roadmap/RM-007-telemetria-economica.md),
  [RM-015](docs/roadmap/RM-015-onboarding-do-nucleo.md),
  [RM-009](docs/roadmap/RM-009-playbook-dos-runtimes.md)): `ork ledger stats`, `ork onboarding`
  e limites por bloco.
- **Estado de conta compartilhado entre projetos**
  ([RM-040](docs/roadmap/RM-040-estado-de-conta-compartilhado.md)): cota esgotada, login perdido
  e credencial paga valem para a conta em todos os projetos do mesmo usuário, e nenhuma fábrica
  despacha numa conta que outra já viu esgotada.
- **Verify que diz por que falhou** ([RM-037](docs/roadmap/RM-037-verify-rapido-e-confiavel.md)):
  - estouro de prazo vira o motivo `verify.timeout`, que o retry reexecuta, em vez de reprovar a
    alegação;
  - `verify.timeout_ms` e `verify.timeout_ms_por_comando` no manifesto;
  - o ledger guarda, por comando que falha, a causa, o prazo, a duração, os testes que caíram e o
    trecho da saída redigido.
  - o lint do comando de claim: `ork claims add` avisa, e `ork ci prepare` recusa a claim que
    roda a suíte inteira do npm no runner do CI;
  - `verify.preparo` compila uma vez por rodada e confere o produto do preparo ao fim; comando que
    não rodou nunca vira verificado (`verify.sem-veredito`).
- **Cadência do pulse pela tag do dono**
  ([RM-039](docs/roadmap/RM-039-cadencia-do-pulse-por-tag.md)): o dono manda `#OrkPulseOff` (8h,
  às 08h, 16h e 00h), `#OrkPulseOn` (2h) ou `#OrkPulseOn-15m`, `-30m`, `-60m` no Telegram, ou usa
  `ork pulse cadencia`, sem editar o crontab. Pergunta nova sai na hora, qualquer que seja a tag.
- **Fábrica compartilhada entre máquinas**
  ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)): `ork fabrica entrar` dá nome à
  máquina e a faz publicar o retrato das próprias threads na branch `ork/fabrica-estado`.
  `ork board`, `ork fabrica` e o resumo do pulse mostram as outras máquinas, e pergunta que
  espera o dono em outra máquina chega na hora. Guia: [Várias máquinas](docs/guias/varias-maquinas.md).
- **Setup por bloco versionado** ([RM-047](docs/roadmap/RM-047-fabrica-em-varias-maquinas.md)):
  `ork setup versionar` grava `orkastery.setup.json` no repositório, e todas as máquinas despacham
  com o mesmo runtime, modelo e esforço por bloco.
- **Loop de aprendizado** ([RM-008](docs/roadmap/RM-008-loop-de-aprendizado.md)): a lição das
  threads fechadas pelo MASTER volta no GOAL e no PLAN da próxima thread, em qualquer regime de
  memória, e a mesma falha em 3 threads em 30 dias vira proposta de policy (`ork licoes`).
- **`ork demo`** ([RM-046](docs/roadmap/RM-046-go-to-open-source.md)): em 30 segundos, offline e sem
  conta, uma afirmação falsa do agente reprovada pelo `ork verify` e a corrigida aceita.
- **Entrega por PR fecha pelo MASTER** (`ork ship registrar-pr`): o merge `ship(<thread>)` com CI
  verde vira `ship_done`, e a thread entregue por PR deixa de ficar aberta para sempre.
- `ork --version` imprime só a versão.

### Mudado

- O template do cron do pulse bate de 15 em 15 minutos e o núcleo decide o que sai. Quem tem a
  linha de hora em hora troca `0 * * * *` por `*/15 * * * *` e reinstala os adaptadores do
  Telegram.

- **`#Look` e `#Ork` aposentados** ([RM-043](docs/roadmap/RM-043-aposentadoria.md)). Quem
  escreve um deles recebe a recusa tipada `modo.aposentado`, e o que já foi gravado continua
  legível para sempre. `ork modos migrar` limpa o `orkastery.yaml` e o `setup.json`.
- `ork objective` saiu: as duas garantias viraram `--exige-runtime-diferente` e `--done` em
  `ork thread new`.
- A fila de `ork master --batch` saiu: a entrega fecha com o índice derivado do ledger, e a nota
  humana, quando vier, sobrescreve.
- A versão do `ork` sai do `package.json`, e o pacote deixa de levar testes e arquivos internos.
- **README canônico em inglês** ([RM-046](docs/roadmap/RM-046-go-to-open-source.md)): o
  `README.md` do repositório e o do pacote no npm passam a ser em inglês, e a versão em
  português do repositório fica em `README.pt-BR.md`, com seletor nas duas. O titular da
  licença MIT passa a ser Julio Pessoa.

### Corrigido

- `ork --version` imprimia a ajuda inteira.
- Uma thread `#Fast` entregue derrubava `ork master`, o aceite por omissão e o pulse com "fase
  MASTER não pertence a nenhum bloco". O ciclo do `#Fast` não tem MASTER: o score dele é de lote.
- Fase despachada de dentro de uma worktree lia o setup da própria worktree e caía no default; o
  setup local agora vem da raiz de estado.

## 0.2.0 — 05/09/2026

Primeira versão publicada no npm: núcleo `ork` com threads de seis fases, cinco modos por #TAG,
claims, `ork verify`, `ork ship` com push provado, worktrees e leases, board, retry tipado,
handoff e memória opcional.
