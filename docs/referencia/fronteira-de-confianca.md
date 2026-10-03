# Fronteira de confiança do repositório clonado

Referência para quem contribui com o núcleo (`core/src`). Ela responde a uma pergunta:
**o que o `ork` faz com um valor que veio do repositório, e não de quem está no teclado?**

A regra vale desde o [RM-047](../roadmap/RM-047-fabrica-em-varias-maquinas.md): quem roda `ork` num
repositório de terceiros não executa código só por isso. Um valor vindo do clone não vira opção de
processo, não vira executável e não vira caminho fora da raiz. Os únicos comandos que o `ork` executa
por desenho são os **declarados**, listados na seção 2 e no [SECURITY.md](../../SECURITY.md).

Auditoria de 03/10/2026 (thread `ork-rm047frontei`), sobre a `main` depois dos merges `95134df`,
`8bc25f3` e `64cdeea`. O documento registra a classe de cada problema, sem roteiro de exploração.

---

## 1. Fontes

| Fonte | Confiança | Exemplos |
| --- | --- | --- |
| Linha de comando | confiável (é o usuário), mas validada quando vai ao git | `--remoto`, `--para`, `--de`, ids de thread |
| Ambiente e `~` do usuário | confiável | `process.env`, `~/.orkastery`, `~/.claude`, `~/.codex` |
| Manifesto e setup versionados | **não confiável** | `orkastery.yaml`, `orkastery.setup.json` |
| Estado no repositório | **não confiável** quando versionado no clone | `.orkastery/` (threads, ledger, claims, monitor, audits), `.ork-ci/*.json` |
| Branches de estado | **não confiável** | `ork/roadmap-reservas`, branch de estado da fábrica, branches `ork/*` |
| Outra máquina da rede | **não confiável** | retratos de máquina, reservas, frontmatter de `docs/roadmap` |
| Saída de ferramenta | dado, nunca código | saída do `git`, do `gh` e do runtime |

## 2. Classes

| Classe | O que quer dizer |
| --- | --- |
| **Declarado** | Comando que o manifesto ou a claim declara para rodar. É o produto: o `ork` reexecuta o que se alega. Documentado no SECURITY.md |
| **Inerte** | Só constantes, ou dado confiável |
| **Defendido** | Dado externo, mas validado, depois de `--`/`--end-of-options`, qualificado com `refs/`, ou sha conferido |
| **Corrigido nesta auditoria** | Era injeção de opção, executável escolhido pelo clone ou caminho fora da raiz |
| **Corrigido, em decisão do dono** | Fecha um pendente da seção 6 mudando comportamento; vale quando o dono mesclar o PR da thread `ork-rm047procede` |
| **Pendente do dono** | Fechar exige mudar comportamento documentado ou aceito hoje; a decisão é do dono |

Toda chamada de processo do núcleo é `spawn`/`spawnSync` com vetor de argumentos e sem shell
(`util.exec`, `branch-de-estado.git`, `mcp-git.git`, `docs.git`). Shell só existe nos comandos
declarados (`bash -c` do `verify.ts`) e na sonda de sandbox do MCP. Não há `exec`/`execSync` com shell.

## 3. Comandos declarados

| Origem | Onde roda | Comandos do `ork` que o executam |
| --- | --- | --- |
| `verify.build`, `verify.test`, `verify.typecheck`, `verify.preparo` | `verify.ts` (`bash -c`, cwd na worktree) | `ork verify`, `ork fix open/reverify`, `ork retry run` (ação `corrigir-dirigido`), baseline do `ork phase run`, gate do `ork ship` |
| `ci.command` e o bundle `.ork-ci/<thread>.json` | `ci.ts` (`rodarBundle`) | `ork ci run` (no runner do CI) |
| Claims (`claims.jsonl`, `--verificar`) e `doneWhen` do `thread.json` | `verify.ts`, `claims.ts` | os mesmos do `verify`; `ork claims add` só com a policy do manifesto |
| Correções do GO-FIX e claims de achado de auditoria (`board.jsonl`) | `fix.ts`, `auditrun.ts` | `ork fix reverify`, `ork audit verify` |
| Binário do runtime (`claude`, `codex`) | adaptadores | `ork phase run`, `ork retry run` |

A documentação não promete aviso em tempo de execução: o SECURITY.md pede que o `orkastery.yaml` e o
estado de um repositório de terceiros sejam tratados como um `Makefile`. Esta auditoria completou a
lista do SECURITY.md (antes citava só `verify.build`, `verify.test` e claims). `doctor`, `status`,
`board`, `thread list`, `init`, `thread new`, `preflight` e `retry plan` não executam comando declarado.

## 4. Matriz de chamadas de processo

Agrupada por módulo. "Dado externo" é o que pode vir do clone; o resto é inerte.

| Módulo | Programa | Dado externo | Defesa | Classe |
| --- | --- | --- | --- | --- |
| `ship.ts` (rev-parse, rev-list, merge-base, diff, merge, worktree add/remove) | git | `thread.base.branch`, `--para`, `--de` | refs qualificadas com `refs/heads/`, sha hexadecimal conferido, merge pelo sha, `--` | Defendido |
| `ship.ts` ls-remote, remote get-url, push | git | `--remoto`, `fabrica.remoto` | `exigirRemoto` + `--` | Defendido (corrigido em `64cdeea`) |
| `ship.ts` detecção de reversão (`git log <merge>..<para>`) | git | `mergeSha` e `para` do `ship_done` do ledger | `shaValido` + `branchValida` + `--end-of-options` | **Corrigido** |
| `entrega-pr.ts`, `ci.ts` (fetch, ls-remote, remote get-url, `gh api`) | git, gh | `--remoto`, `worktree.base_branch`, `ci.external_repositories` | `exigirRemoto`, `--`, refspec com `+`, regex de dono/nome | Defendido (corrigido em `8bc25f3`) |
| `branch-de-estado.ts`, `fabrica-estado.ts`, `roadmap-reservas.ts` | git | remoto, nome de máquina, item do roadmap | `exigirRemoto`, `arquivoDaMaquina`, `^RM-\d{3}$`, refs com prefixo | Defendido (corrigido em `95134df`) |
| `network-roadmap.ts`, `parado-no-condutor.ts`, `projeto-alvo.ts`, `forja.ts` | git, gh, glab | base, remoto, host, branch | `baseValida`, `remotoValido`, `--opt=valor`, regex de host | Defendido |
| `mcp-ship.ts`, `mcp-git.ts` | git | branch da thread, base | `--end-of-options`, `--literal-pathspecs`, sha de 40 hex, `fisico()` | Defendido |
| `docs.ts` `resolverBase`, `mergesDaThreadNoGit` | git | `worktree.base_branch` (caía cru no `git log` quando não resolvia) | `branchValida` antes do git | **Corrigido** |
| `docs.ts` `mergeDaThread`, paridade do commit | git | `mergeSha` do ledger, `commit` do frontmatter | `shaValido` antes do git | **Corrigido** |
| `thread.ts`, `worktree.ts` (rev-parse, worktree add, merge-base) | git | `worktree.base_branch` | o manifesto recusa base que o git não aceita como branch | **Corrigido** (validação no manifesto) |
| `orkmind.ts` sonda e transporte | interpretador do shebang de `memory.cli` | `memory.cli` relativo, shebang relativo | manifesto aceita só nome no PATH ou caminho absoluto; PATH só com entradas absolutas; shebang absoluto | **Corrigido** |
| `company-brain-client.ts`, `company-brain-migration.ts` | `memory.cli` | executável e cwd na raiz do clone | `memory.cli` validado no manifesto; cwd no `$HOME` | **Corrigido** |
| `verify.ts`, `ci.ts`, `claims.ts`, `fix.ts`, `auditrun.ts` | `bash -c` | comandos declarados | documentado | Declarado |
| `verify-sandbox.ts`, `mcp-ship.ts` | python3 supervisor, `codex sandbox` | comando da claim (MCP) | worktree com realpath, binário fixo, sem rede | Declarado e defendido |
| `adapters/claude-bg.ts`, `adapters/codex*.ts` | claude, codex | `runtime.model`, `runtime.effort`, setup | cada valor logo depois da flag que o consome; no Codex vão por JSON-RPC | Defendido |
| `adapters/codex-controller-worker.ts` | codex app-server | `runtime.sandbox` | lista fechada; a postura que afrouxa só despacha com a confirmação local da máquina (`runtime.sandbox-nao-confirmado`) | **Corrigido, em decisão do dono** (P1) |
| `session-watcher*.ts`, `liveness.ts`, `worktree.ts`, `conducao.ts`, `retry.ts`, `verify.ts`, `phase.ts`, `ci.ts` (git status, log, rev-parse; cwd do agente) | git, runtime | cwd = `thread.worktree`, `cwd` do ledger ou da fila | cwd só na raiz ou em worktree do `git worktree list` (`estado.worktree-nao-registrada`); estado versionado não escolhe (`estado.rastreado`) | **Corrigido, em decisão do dono** (P2) |
| `pulse-delivery.ts`, `master-digest.ts` | transporte do host | `executavel` e `argumentos` de `.orkastery/monitor/*-host.json` | tipos conferidos; só o arquivo local, comum e fora do índice do git (`transporte.rastreado`) | **Corrigido, em decisão do dono** (P2) |
| `canarios*.ts` (via `ork eval`) | node | hooks e `core/dist` do catálogo achado a partir do cwd | o eval só executa o catálogo do pacote que está rodando; um catálogo achado a partir do cwd que não é o do pacote recusa com `eval.catalogo-alheio` | **Corrigido, em decisão do dono** (P4) |
| `intelligence-graph-*.ts`, `superficie.ts`, `ledger-stats.ts`, `demo.ts`, `init.ts`, `doctor.ts`, `preflight.ts`, `hitl-*.ts`, `creation-operation-store.ts`, `fabrica-publicar.ts` | git, node, flock | nenhum, ou sha validado | `-c core.fsmonitor=false` no grafo; `O_NOFOLLOW` nos locks | Inerte |

## 5. Matriz de caminhos

| Caminho | Dado externo | Antes | Agora |
| --- | --- | --- | --- |
| `.orkastery/threads/<id>` | id de thread | regex de id (sem `/`, sem `..`) | o mesmo, mais: `.orkastery`, `threads` e a pasta da thread não podem ser link (`estado.link`) |
| `.orkastery/` (monitor, leases, retry, audits, setup) | estado do clone | link seguido | `dirEstado` recusa `.orkastery` como link (`estado.link`) |
| `ledger.jsonl`, `claims.jsonl`, `board.jsonl` | arquivo versionado como link | append seguia o link | append com `O_NOFOLLOW` |
| `.orkastery/audits/<rodada>` e `docs/audit/<rodada>.md` | `id` lido do `run.json` | sem validação | `exigirIdDeRodada` (`audit.rodada-invalida`) |
| `memory.cli` | manifesto | `path.resolve` no cwd | nome no PATH ou absoluto |
| `worktree.dir` | manifesto | `..` e absoluto aceitos | dentro da raiz, pelo caminho real, como antes; fora dela (`..`, absoluto, link), a criação recusa com `worktree.dir-fora-da-raiz` até `ork setup worktree confirmar` nesta máquina (**Corrigido, em decisão do dono**, P3) |
| `thread.worktree` | `thread.json` | cwd de agente, git e `ci prepare` | só worktree registrada no git e `thread.json` fora do índice (**Corrigido, em decisão do dono**, P2) |
| ponteiros do `ork recall` e do handoff | `handoff.json`, `claim.arquivo`, `promptPath` | `path.resolve` sem contenção | pelo caminho real, só dentro da raiz ou da worktree registrada da thread: o recall recusa com `ponteiro.fora-da-raiz`, e o export não aponta para fora (**Corrigido, em decisão do dono**, P2) |
| `.ork-ci/*.json` | bundle do clone | lido até 1 MiB, segue link | Declarado (o bundle é executado por desenho no CI) |
| `docs/roadmap/*.md`, `README.md`, `orkastery.setup.json`, `orkastery.yaml` como link | arquivo do clone | escrita segue o link, só se o alvo tiver o formato esperado e só em comando explícito | Defendido pelo formato; baixo |
| nomes vindos das branches `ork/*` e de outras máquinas | branch de estado | nunca viram caminho local | Inerte |
| `projetos.json` | `~/.orkastery` | exige caminho absoluto | Inerte |

## 6. Pendentes do dono

Fechar estes itens exige mudar comportamento que hoje é aceito ou documentado. Por isso a auditoria não os
alterou. P1 e P2 ganharam correção na thread `ork-rm047procede`, num PR em rascunho que só vale quando o dono
o mesclar; a coluna da direita diz o estado de cada um.

| Id | Classe do problema | Por que é contrato, ou o estado |
| --- | --- | --- |
| P1 | O manifesto escolhe a postura de sandbox do agente | **Corrigido, em decisão do dono.** A postura que afrouxa o sandbox (`danger-full-access`) só despacha, no `ork phase run` e no `ork retry run`, depois de a máquina confirmá-la no setup local, fora do git (`ork setup sandbox confirmar <postura>`). Sem isso, o despacho recusa com `runtime.sandbox-nao-confirmado` e diz o comando |
| P2 | Estado de `.orkastery/` versionado no clone é lido como verdadeiro | **Corrigido, em decisão do dono.** Estado rastreado pelo git não escolhe cwd, worktree nem executável; o cwd de git e agente só vale na raiz ou numa worktree do `git worktree list` do repositório; o transporte do pulse e do digest só vale do arquivo de host local; os ponteiros do recall e do handoff só leem arquivo que, pelo caminho real, fica na raiz ou na worktree registrada da thread (`ponteiro.fora-da-raiz`) |
| P3 | `worktree.dir` do manifesto aceita `..` e caminho absoluto, e o `git worktree add` cria o checkout fora da raiz | **Corrigido, em decisão do dono.** Worktree fora da raiz segue possível, mas quem decide é a máquina: fora da raiz pelo caminho real (`..`, absoluto, link no caminho, `.git`), a criação recusa com `worktree.dir-fora-da-raiz` até `ork setup worktree confirmar`, gravado em `.orkastery/private/worktree-local.json` (0600, fora do git, só para este checkout e esta pasta). O `ork doctor` acusa. O MCP segue recusando |
| P4 | `ork eval` trata qualquer diretório com `skills/`, `references/` e `eval/` como catálogo e executa os hooks e o `core/dist` dele | **Corrigido, em decisão do dono.** O eval só executa o catálogo do pacote que está rodando (achado a partir do próprio código). Um catálogo achado a partir do cwd que não é o do pacote recusa com `eval.catalogo-alheio`, e a mensagem diz como rodar o `ork` daquele checkout de propósito. O CI do kit (`node core/dist/index.js eval` na raiz) não muda |
| P5 | `fabrica.compartilhada: true` vindo do manifesto liga a publicação, em segundo plano, do retrato desta máquina (threads, nome, host) para o remoto do clone | É opt-in documentado no manifesto; a pergunta é se o opt-in deve ser da máquina, não do repositório |

Também ficam registrados, com risco baixo: `ork retry run --dry-run` na ação `corrigir-dirigido`
reexecuta claims e verify (comandos declarados, mas contra a semântica do `--dry-run`); o perfil do
runtime gravado no ledger escolhe `CLAUDE_CONFIG_DIR`/`CODEX_HOME` de comandos de consulta; o
`memory.database_url_env` aceita nome de qualquer variável de ambiente; e `ci.external_repositories`
aceita segmento `..` no caminho de um `gh api` de leitura. O `ork adapter install` ainda acha o catálogo a partir
do projeto, como o `ork eval` achava (P4), mas só copia o adaptador para dentro do próprio projeto e usa o `ork` do
PATH quando ele existe; fica registrado com risco baixo.

## 7. Para quem contribui

- Valor do clone que vai ao git: valide com `remotoValido`/`exigirRemoto`, `branchValida` ou `shaValido`
  (`core/src/branch-de-estado.ts`) **antes** da chamada, e ponha `--` ou `--end-of-options` antes dele.
- Ref de branch vai qualificada (`refs/heads/<nome>`), e merge vai pelo sha conferido, nunca pelo nome.
- Executável nunca sai do manifesto por caminho relativo, e o cwd de um executável escolhido por
  configuração não é a raiz do clone.
- Caminho com id vindo de arquivo: um segmento só, com regex, e o diretório de estado não é link.
- Append em estado: `O_NOFOLLOW`. Escrita de arquivo inteiro: temporário com `wx` e `rename`.
- O teste da correção reprova o código anterior: veja `core/test/fronteira-de-confianca.test.ts`.
