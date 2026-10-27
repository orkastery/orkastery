---
id: FEAT-039
tipo: feature
titulo: GitLab com paridade ao GitHub
estado: vigente
pai: MOD-02
roadmap: [RM-065]
owner: Julio
aprovador: Julio
verificado_em: 2026-10-27T00:50:00-03:00
versao: main@1e88a932
fontes:
  codigo:
    - core/src/forja/adaptador.ts
    - core/src/forja/registro.ts
    - core/src/forja/resolver.ts
    - core/src/forja/executor.ts
    - core/src/forja/estado.ts
    - core/src/forja/produtor.ts
    - core/src/forja/github/ci.ts
    - core/src/forja/github/pedidos.ts
    - core/src/forja/gitlab/ci.ts
    - core/src/forja/gitlab/pedidos.ts
    - core/src/forja/gitlab/pedidos-abertos.ts
    - core/src/forja/gitlab/dono-da-rede.ts
    - core/src/ci.ts
    - core/src/entrega-pr.ts
    - core/src/ship-publicar.ts
    - core/src/parado-no-condutor.ts
    - core/src/doctor-forja.ts
    - core/src/mcp-ship-transporte.ts
    - templates/gitlab/ork-verify.yml
    - templates/ork-verify/template.yml
  testes:
    - core/test/forja-registro.test.ts
    - core/test/forja-resolver.test.ts
    - core/test/forja-ci-github.test.ts
    - core/test/forja-ci-gitlab.test.ts
    - core/test/forja-ci-gitlab-gate.test.ts
    - core/test/forja-ci-produtor.test.ts
    - core/test/forja-ci-status-v2.test.ts
    - core/test/forja-pedidos-abertos-gitlab.test.ts
    - core/test/forja-rede-subgrupo.test.ts
    - core/test/forja-gitlab-registrar-pr.test.ts
    - core/test/forja-base-protegida.test.ts
    - core/test/forja-entrega-correcoes.test.ts
    - core/test/forja-redacao.test.ts
    - core/test/forja-doctor.test.ts
    - core/test/forja-template-gitlab.test.ts
    - core/test/ship-publicar-gitlab.test.ts
    - core/test/ship-pista-gitlab.test.ts
    - core/test/mcp-ship-transporte.test.ts
    - core/test/mcp-ship-fixado.test.ts
  docs:
    - docs/referencia/contratos/forja.md
  simbolos:
    - core/src/forja/adaptador.ts#CAPACIDADES
    - core/src/forja/registro.ts#adaptadorDaForja
    - core/src/forja/resolver.ts#resolverForja
    - core/src/forja/executor.ts#rodarCli
    - core/src/forja/estado.ts#estadoDoCheck
    - core/src/forja/produtor.ts#produtorAceito
    - core/src/forja/gitlab/ci.ts#estadoDeCiGitlab
    - core/src/forja/gitlab/pedidos.ts#abrirPedidoGitlab
    - core/src/forja/gitlab/pedidos-abertos.ts#pedidosAbertosGitlab
    - core/src/entrega-pr.ts#registrarEntregaExternaPorPr
    - core/src/ship-publicar.ts#publicarEntrega
    - core/src/ship-publicar.ts#pistaDeEntrega
    - core/src/doctor-forja.ts#checarForja
    - core/src/mcp-ship-transporte.ts#enderecoDoOrigin
  contratos:
    - ork.ci-status/v2
    - ork.prs-abertos/v1
  comandos:
    - ork ci status
    - ork ship publicar
    - ork ship pista
    - ork ship registrar-pr
    - ork doctor
    - ork mcp install
    - ork network entrar
    - ork network roadmap
---

# FEAT-039 — GitLab com paridade ao GitHub

> **Em uma frase:** o `ork` lê a CI, os MRs e a rede de um GitLab, abre MR e entrega pelo MCP, com o mesmo comportamento do GitHub, por uma porta de forja em que cada plataforma é um adaptador com capacidades.

- **Estado:** vigente · **Verificado em:** 2026-10-27 · **Versão:** main@1e88a932 (PR #175), publicada na 0.6.0
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-02](MOD-02-verdade-e-entrega.md)
- **Roadmap:** [RM-065](../roadmap/RM-065-gitlab-com-paridade-ao-github.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:**
  - UC-039-01, ler o `ork-verify` do commit na forja do projeto: `ork ci status` e o gate do `ork ship`.
  - UC-039-02, publicar a branch e abrir o MR em `#Auto` e `#Maestro`: `ork ship publicar`.
  - UC-039-03, ver as etapas da entrega com os MRs da branch: `ork ship pista`.
  - UC-039-04, registrar a entrega de um MR mesclado fora do `ork`: `ork ship registrar-pr <thread> --repo <grupo/sub/projeto> --pr <iid>`.
  - UC-039-05, ler os MRs abertos da base no pulse e a rede e o roadmap num GitLab: `ork pulse`, `ork network entrar`, `ork network roadmap`.
  - UC-039-06, entregar pelo `ork_ship` do MCP sem SSH ou com SSH em outra porta: `ork mcp install --ship-transport forja-https|forja-ssh`.
  - UC-039-07, conferir a forja da máquina: a seção forja do `ork doctor`.
- **Pré-condições e gatilho:**
  - A CLI da forja instalada e com login no host: `gh` 2.18.0 ou mais, `glab` 1.121.0 ou mais. O `ork` nunca lê token.
  - O remoto `origin` aponta para a forja. Num GitLab de host próprio, o bloco `forja:` do `orkastery.yaml` declara pelo menos `tipo` (e, se preciso, `porta`, `caminho_base`, `ssh_host`, `ssh_porta`, `ca`).
  - O servidor GitLab em 17.0 ou mais (testada a janela 19.2 a 19.4).
  - Para o gate: o job `ork-verify` na pipeline do projeto, pelo modelo `templates/gitlab/ork-verify.yml` ou pelo CI/CD Component `templates/ork-verify/template.yml`, com as `workflow:rules` no `.gitlab-ci.yml` do próprio projeto.
- **Fluxo principal:**

  1. O resolver acha a forja: o bloco `forja:`, o host conhecido (`github.com`, `gitlab.com`) ou a sondagem só pela CLI com login no host. O resultado fica em cache por 24 h.
  2. O registro devolve o adaptador da forja, com as capacidades que ele declara (`estadoDeCi`, `pedidoMesclado`, `pedidosDaBranch`, `abrirPedido`, `pedidosAbertos`, `donoDaRede`, `metadados` e as de leitura do git).
  3. Cada chamada à forja passa pelo executor único: host explícito (`GITLAB_HOST` no `glab`), corpo por stdin ou arquivo 600, prazo, buffer e erro tipado `forja.*` pelo status HTTP.
  4. A regra única de estado converte o estado da forja em `verde`, `vermelho`, `pendente`, `bloqueado` ou `ausente`, a mesma no gate, no pulse e na pista.
  5. O consumidor (gate, publicação, pista, `registrar-pr`, pulse, rede, `ork doctor`, SHIP do MCP) recebe o resultado neutro e não chama `gh` nem `glab` direto.

- **Alternativas, erros e recuperação:**
  - Sem resposta da sondagem: `forja.desconhecida`; duas respostas: `forja.ambigua`. As duas pedem `forja.tipo`.
  - O manifesto confirma o remoto e nunca o redireciona: divergência dá `forja.remoto-divergente`, sem consulta.
  - GitLab abaixo de 17.0, ou versão ilegível: `forja.versao-abaixo-do-piso`.
  - Erro de leitura, lista acima de 10 páginas de 100 ou item fora do esquema: a consulta fica indisponível, nunca verde.
  - Resultado mesclado ou merge train (Premium) sem vínculo com o head: `ci.merged-results-sem-vinculo`, nunca verde.
  - Push da base recusado pela proteção da branch: `entrega.base-protegida`, com a orientação de entregar por PR/MR e registrar pelo `registrar-pr`.
  - Escrita nunca se repete sozinha; uma leitura espera uma vez o limite de cota (até 60 s).
- **Pós-condições:** o `ork ship publicar` grava `ship_published` com a prova pelo `git ls-remote` e pela releitura da lista de MRs; o `registrar-pr` grava `ship_done`; o `ork mcp install` com `forja-*` grava a fixação em `$XDG_CONFIG_HOME/orkastery/mcp-ship/` (700/600). Nada mais é escrito na forja.
- **Regras de negócio:**
  - BR-039-01: só o job que está na lista de jobs da pipeline do projeto conta como produtor `gitlab-ci`. Um status de `POST /statuses` conta como `status:<login>` e só aprova se estiver em `ci.produtor`.
  - BR-039-02: verde de produtor fora de `ci.produtor` não aprova; vermelho, pendente ou bloqueado de qualquer produtor reprova ou espera.
  - BR-039-03: `manual`, `neutral` e `skipped` são `bloqueado`: reprovam o gate e contam como verde no pulse e na pista.
  - BR-039-04: nenhum modo de entrega mescla PR ou MR. O `ork ship publicar` só abre, em `#Auto` e `#Maestro`, nunca com `merge_when_pipeline_succeeds` nem `auto_merge`.
  - BR-039-05: o tipo da forja nunca sai só do nome do host, fora dos hosts conhecidos; a sondagem só vai a host em que a CLI tem login.
  - BR-039-06: consumidor que pede capacidade ausente recebe `forja.sem-capacidade`, nunca um erro genérico.
  - BR-039-07: no `forja-https`, os helpers de credencial da config são zerados e só o `auth git-credential` da CLI com login no host exato é usado; no `forja-ssh`, a chave do servidor é confirmada pela pessoa e conferida a cada push com `StrictHostKeyChecking=yes`.
- **Critérios de aceite e testes:**
  - Dado um commit com status `ork-verify: success` criado por `POST /statuses` de uma conta fora de `ci.produtor`, quando o gate lê a CI, então o estado é `missing` (`core/test/forja-ci-gitlab-gate.test.ts`, `core/test/forja-ci-produtor.test.ts`).
  - Dado um MR mesclado por `ff` sem squash, quando o `registrar-pr --repo --pr` roda, então o merge vale pelo head dentro da ponta da base (`core/test/forja-gitlab-registrar-pr.test.ts`).
  - Dada uma thread `#Auto` num GitLab, quando o `ork ship publicar` roda, então o MR é aberto com a descrição pelo stdin e sem merge automático, e a prova é a releitura (`core/test/ship-publicar-gitlab.test.ts`).
  - Dado um push recusado pela proteção da base, quando o `ork ship` entrega, então o código é `entrega.base-protegida` (`core/test/forja-base-protegida.test.ts`).
  - Dada a CA fixada alterada, ou a chave do servidor trocada, quando o `ork_ship` roda, então a entrega é recusada e nada é empurrado (`core/test/mcp-ship-transporte.test.ts`, `core/test/mcp-ship-fixado.test.ts`).
  - Dado um token falso em cada caminho de erro, quando o detalhe sai, então ele vem redigido (`core/test/forja-redacao.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI, MCP e CI, sem interface própria; as mensagens novas estão no catálogo, em pt-BR e em inglês (RM-061).

## Dados e contratos

- **Contrato canônico:** [contrato da forja](../referencia/contratos/forja.md): o bloco `forja:`, a resolução do tipo, `ci.produtor`, a CI, o pulse, a rede, a versão, as CLIs, os erros, o `ork doctor`, a entrega, o transporte e o que não é suportado.
- **`ork.ci-status/v2`:** a v1 mais `provider` (`github`, `gitlab` ou `null`), `fonte` (`check-run`, `commit-status`, `pipeline-job`), `produtor` (na forma de `ci.produtor`) e `bloqueado` opcional. A v1 continua lida.
- **`ork.prs-abertos/v1`:** o retrato dos PRs e MRs abertos que o pulse lê; passa a aceitar o repositório em subgrupos.
- **Manifesto:** o bloco opcional `forja:` (`tipo`, `host`, `porta`, `caminho_base`, `ssh_host`, `ssh_porta`, `ca`) e `ci.produtor` (de 1 a 20 entradas: slug de app, nome de job ou `status:<login>`). Sem eles, o manifesto lê como antes.
- **APIs e integrações:** REST e GraphQL do GitLab (`/api/v4`) por `glab api`, e do GitHub por `gh api`, sempre pela CLI com login. Os comandos de alto nível do `glab` não são usados.
- **Eventos e jobs:** `ship_published` e `ship_done` sem mudança de forma; o job `ork-verify` do GitLab roda `ork ci run --branch` e não usa token nem publica status.

## Operação e controle

- **Configuração e ambientes:** `forja:` e `ci.produtor` no `orkastery.yaml`; `GITLAB_HOST` para a rede num GitLab próprio; `--ship-transport` e `--ssh-fingerprint` no `ork mcp install`. Versões testadas do GitLab: 19.2, 19.3 e 19.4; compatível desde 17.0.
- **Observabilidade:** a seção forja do `ork doctor` (no `--json`, com `--forja`); o detalhe tipado de cada consulta no `ork ci status --json`; o aviso `prs.sem-leitura` no pulse.
- **Acesso, privacidade e conformidade:** o `ork` nunca lê nem passa token; o corpo de requisição nunca vai a argv; todo detalhe de erro passa pelo redator (tokens do GitHub e do GitLab, JWT, `Authorization`, `PRIVATE-TOKEN`, credencial em URL). O transporte `forja-https` recusa o binário da CLI numa pasta com escrita de grupo.
- **Limites conhecidos:** a lista "O que não é suportado" do [contrato](../referencia/contratos/forja.md#o-que-não-é-suportado) e os achados fora do escopo na [RM-065](../roadmap/RM-065-gitlab-com-paridade-ao-github.md#achados-fora-do-escopo-deste-item).
- **Dependências e rollback:** a CLI da forja (`gh`, `glab`) com login. Rollback: reverter o merge; o bloco `forja:` e o `ci.produtor` são opcionais, e quem instalou `forja-ssh` ou `forja-https` reinstala o MCP com `github-ssh` ou `bare-local`.
- **Código, PR, testes e release:** branch `forja/gitlab`, mesclada pelo PR #175 (merge `1e88a932`); respostas gravadas do GitHub e do GitLab CE 16.11, 17.0, 18.11, 19.2, 19.3 e 19.4 em `core/test/fixtures/forja/`, regravadas por `core/scripts/forja-contrato.cjs`. Release: versão 0.6.0 (tag `v0.6.0`, `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026).

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-10-14 | página criada com as fatias 0 a 7 do suporte a GitLab | Claude (agente) / Julio, revisão pendente | RM-065, piloto num GitLab CE 19.3.5 próprio |
| 2026-10-27 | vigente: mesclada pelo PR #175 e publicada na 0.6.0 | Claude (agente, thread `ork-docsda060emp`) / Julio, revisão pendente | merge `1e88a932` na tag `v0.6.0` |
