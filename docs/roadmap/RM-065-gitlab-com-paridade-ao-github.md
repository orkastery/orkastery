---
id: RM-065
tipo: roadmap
titulo: GitLab com paridade ao GitHub
categoria: iniciativa
pai: null
features: [FEAT-039]
owner: Julio
atualizado_em: 2026-10-27T00:50:00-03:00
estado:
  ciclo: Disponível
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Geral
  habilitacao: Concluída
evidencias:
  codigo:
    commit: 1e88a932
    pr: 175
  deploy:
    release: v0.6.0, @orkastery/cli no npm (a porta da forja e o GitLab)
sdlc:
  thread: null
  modo: null
---

# RM-065 — GitLab com paridade ao GitHub

> **Em uma frase:** o `ork` opera um projeto no GitLab (próprio ou gitlab.com) como opera no GitHub: CI como CHECK independente, pulse, rede, entrega por MR e SHIP do MCP, por uma porta de forja que aceita outras plataformas depois.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Disponível | Mesclado | Aprovados | Produção | Geral |

<!-- ork-docs:relance:fim -->

**Pedido do mantenedor:** "o Orkastery funcionando no GitLab", com o mesmo comportamento do GitHub e sem mudar como os quatro modos entregam.

## Problema e resultado

- **Público e problema/oportunidade:** times cujo código mora num GitLab, autogerenciado ou no gitlab.com. Até aqui, tudo o que o `ork` consulta na forja era só do GitHub: o gate de CI, a detecção de entrega, o `ork ship publicar`, o pulse e o transporte SHIP do MCP (que aceitava só `git@github.com:`). Um projeto no GitLab não tinha CHECK independente, não abria MR e não entregava pelo MCP sem SSH.
- **Evidências e fonte:** o código anterior chamava o `gh` em seis consumidores, cada um com o seu parser de remoto; o caminho GitLab da rede (RM-053, RM-054) só tinha sido provado com resposta simulada.
- **Objetivo/OKR:** a mesma thread, nos quatro modos, entrega do mesmo jeito no GitHub e no GitLab da janela mantida. Ligar uma terceira forja (Gitea, Forgejo, Bitbucket) pede só um adaptador novo e o registro dele, sem mudar nenhum consumidor.
- **Hipótese:** se a forja virar uma porta com capacidades declaradas, um executor único e uma regra única de estado, então o GitLab entra com paridade e o GitHub ganha as mesmas correções, porque nenhum consumidor fala mais com `gh` ou `glab` direto.
- **Métrica principal / linha de base / meta / janela / fonte:** passos do ciclo de entrega que rodam num GitLab real sem contorno. Linha de base: 0 de 8. Meta: 8 de 8. Medido em 14/10/2026: 7 de 8 no piloto e o oitavo (SHIP do MCP de ponta a ponta) provado em docker. Fonte: o piloto e as provas abaixo.
- **Métricas de proteção:** a suíte do GitHub segue verde sem mudança de saída depois da porta; nenhum modo passa a mesclar PR ou MR; nenhum token passa por argv, ambiente do agente, log ou ledger; erro de leitura da forja nunca vira verde.

## Escopo e validação

- **Incluído:**
  - **Porta da forja** (`core/src/forja/`): contrato neutro, adaptadores GitHub e GitLab com capacidades opcionais, registro, executor único da CLI e resolver da identidade (bloco `forja:` do `orkastery.yaml`, host conhecido ou sondagem só pela CLI com login).
  - **Gate de CI:** `ork ci status` e o gate do `ork ship` leem o GitLab; `ci.produtor` diz quem aprova o `ork-verify`; contrato `ork.ci-status/v2`; o modelo `templates/gitlab/ork-verify.yml` e o CI/CD Component `templates/ork-verify/template.yml`.
  - **Pulse, rede e `ork network roadmap`:** MRs da base numa consulta GraphQL, subgrupos no `ork.prs-abertos/v1`, casa da rede num grupo em que a pessoa é Maintainer ou acima.
  - **Entrega:** `ork ship publicar` abre MR nos mesmos `#Auto` e `#Maestro`; `ork ship pista` lê os MRs; `ork ship registrar-pr --repo --pr` reconhece MR mesclado (inclusive pelo método `ff`); o push recusado pela proteção da base vira `entrega.base-protegida`.
  - **SHIP do MCP:** os transportes fixados `forja-ssh` e `forja-https` no `ork mcp install --ship-transport`.
  - **`ork doctor`:** a seção forja (identidade, alcance, TLS, subcaminho, CLI, login, servidor, escopo, projeto, capacidades).
  - **Correções do lado do GitHub:** paginação dos check-runs, commit statuses junto, produtor conferido, ordem estável, regra única de estado no gate e no pulse, host explícito no GitHub Enterprise, parser único de remoto, stderr redigido, corpo do PR por arquivo, `ork-verify` no head exato do PR e os motivos `entrega.sem-vinculo` e `entrega.sem-leitura`.
- **Fora de escopo:** issues, wiki, releases, registry, pacotes, aprovações de MR (Premium) e qualquer recurso que o `ork` não usa no GitHub. O merge de PR ou MR pela API continua fora: nenhum modo de entrega mescla.
- **Limites conhecidos** (do [contrato da forja](../referencia/contratos/forja.md#o-que-não-é-suportado)):
  - host da forja por IPv6 literal não é reconhecido como forja;
  - casa da rede GitLab em subcaminho ou com CA própria é recusada (`rede.forja-nao-suportada`);
  - duas instâncias do GitLab no mesmo host, em subcaminhos diferentes, na mesma máquina (limite do `glab`);
  - nos modos `forja-ssh` e `forja-https`, a publicação da fábrica em segundo plano e as consultas `ork_fabrica` e `ork_roadmap_reservas` ficam indisponíveis por ora;
  - misturar `github-ssh`/`bare-local` e `forja-*` entre hosts do mesmo projeto é recusado; trocar de modo exige reinstalar;
  - o tipo da forja de um projeto do `ork network roadmap` sem clone nesta máquina vem do nome do host ou do prefixo `github:`/`gitlab:`;
  - a entrega do #Noctum ([RM-058](RM-058-modo-noctum.md)) e a varredura de merge da batida do condutor ([RM-063](RM-063-fabrica-que-nao-para.md)) seguem só no GitHub;
  - as correções das lacunas de forja do `ork network roadmap` saem só em pt-BR.
- **Entregáveis e critérios de aceite:** cada frente com teste na suíte (contrato gravado de cada versão, servido por uma CLI falsa) e a página [FEAT-039](../produto/FEAT-039-gitlab-com-paridade-ao-github.md). O critério do item é o piloto num GitLab real: MR aberto pelo `ork`, `ork-verify` lido do job da pipeline, status forjado recusado e `ship_done` gravado pelo MR.
- **Piloto, medição e critérios de expansão/interrupção:** piloto feito num GitLab CE 19.3.5 próprio em 14/10/2026 (abaixo). Expande com a release que levar o código; interrompe se algum caminho de erro da forja aprovar o gate ou se um token aparecer em saída.

### Evidências

**Matriz de versões (13/10/2026).** GitLab CE 19.4.2, 19.3.5, 19.2.7, 18.11.12, 17.0.8 e 16.11.10 em docker, `glab` 1.121.0. As respostas reais de cada versão foram gravadas, redigidas, em `core/test/fixtures/forja/gitlab/`, e são as que a suíte serve.

| Medido | Resultado |
| --- | --- |
| `GET /metadata` | devolve a versão nas seis, inclusive na 16.11: a recusa abaixo do piso é detectável |
| MR mesclado por merge commit | `merge_commit_sha` preenchido e `squash_commit_sha` nulo nas seis |
| merge logo depois de criar o MR | HTTP 200 nas seis, com `detailed_merge_status` em `checking` (19.x) ou `preparing` (18.11 e abaixo) |
| `GET /personal_access_tokens/self` | responde nas seis, sem o valor do token |
| `glab --hostname host:porta` | recusado pelo `glab`: o host com porta vai por `GITLAB_HOST` |

**Provas em docker (14/10/2026), com instâncias descartáveis:**

- **CI com runner** (CE 19.4.2 e 17.0.8): só "o id do status está na lista de jobs da pipeline" distingue o job real de um status de `POST /statuses`; o `pipeline_id` sozinho não distingue.
- **Entrega** (CE 19.4.2): `ff` sem squash deixa `merge_commit_sha` e `squash_commit_sha` nulos; squash preenche só `squash_commit_sha`; comparação com referência inexistente responde 404.
- **Pulse e rede** (CE 19.4.2 e 17.0.8): a consulta GraphQL dos MRs custa 140 de complexidade (teto 250); o nível de acesso herdado no grupo é lido.
- **SHIP do MCP** (CE 19.4.2): `forja-https` e `forja-ssh` de ponta a ponta pelo `ork_ship`; sem login, a recusa sai em 1,2 s, sem prompt; CA fixada alterada recusa com `mcp.ship.transport.ca-alterada`; chave do servidor trocada recusa e nada é empurrado; hook, `ext::` e `pushurl` do projeto ficam sem efeito.

**Piloto num GitLab CE 19.3.5 próprio (14/10/2026),** projeto privado de teste, runner da instância, `ork` empacotado desta branch:

| Passo | Resultado |
| --- | --- |
| `ork doctor` | pronto; seção forja medida, servidor na faixa testada, SSH recusado como aviso (use `forja-https`) |
| `ork ship publicar` (#Auto) | MR !1 aberto e provado pela releitura; `merge_when_pipeline_succeeds: false`, sem merge pelo `ork` |
| CI do MR | pipeline 4557 (job 13017) e pipeline de branch 4556 (job 13016), verdes; `ork ci status --json`: `ork.ci-status/v2`, `provider: gitlab`, `fonte: pipeline-job`, `produtor: gitlab-ci`, `state: success` |
| status forjado | `POST /statuses` com `name=ork-verify` e `success` num commit sem job (pipeline 4558): `state: missing`, "só commit status de conta fora de ci.produtor"; com `status:<login>` em `ci.produtor`, o mesmo commit dá `success` por `commit-status` |
| pulse, pista e roadmap | nenhum `prs.*`; o retrato traz o MR com os checks verdes; a pista diz que o MR está pronto para o merge do dono |
| casa da rede | criada no grupo, privada, sem token nos arquivos |
| `registrar-pr --repo --pr 1` | `ship_done` gravado pelo merge do MR; o caminho local diz "nenhum merge" pela mensagem padrão do GitLab, como o contrato e o `ork doctor` avisam |
| SHIP do MCP `forja-https` | instalação ensaiada (`--dry-run`) e TLS conferido; o `ork_ship` de ponta a ponta ficou com a prova em docker |

### Mudanças de comportamento que o mantenedor precisa saber

- **`ci.produtor` endurece o gate:** o `ork-verify` verde de um app fora da lista (padrão `github-actions` no GitHub, `gitlab-ci` no GitLab) deixa de aprovar. Quem publica o check por outro app declara a lista. O commit status verde do `github-actions[bot]` passa a aprovar sozinho.
- **Commit status sozinho de outra conta não aprova:** vermelho ou pendente de qualquer produtor bloqueia; o verde só vale de produtor aceito.
- **`neutral` e `skipped` seguem reprovando o gate,** agora com o detalhe `bloqueado (...)`; no pulse e na pista contam como verde, como o rollup do GitHub.
- **GitHub Enterprise sem o bloco `forja:` e sem login do `gh` no host** passa a ser recusado pelo `ork ship publicar` e pelo `registrar-pr --repo` antes de qualquer escrita (`forja.desconhecida` ou `entrega.sem-leitura`).
- **`registrar-pr` com a CI exigida** recusa o merge de um pai só (squash ou rebase) com `entrega.sem-vinculo`; o `git fetch` que falha recusa com `entrega.sem-leitura`, não "nenhum merge".
- **`ork ci status --json`** passa a `ork.ci-status/v2` (`provider`, `fonte`, `produtor`, e `bloqueado` opcional); a v1 continua lida.
- **`ork network roadmap --json`:** as lacunas `forja.nao-encontrado`, `forja.inacessivel` e `forja.tempo-esgotado` passam a `forja.nao-achei` e `forja.indisponivel`.
- **`ork doctor --json`:** a seção forja só roda com `--forja`, e o campo `forja` do `ork.doctor/v1` diz `medida` ou `nao-medida`.
- **`forja-https` recusa o binário da CLI numa pasta com escrita de grupo** (`mcp.ship.transport.binario`), como o `glab` em `~/.local/bin` com modo 775.
- **Os quatro modos entregam como antes:** o `ork ship publicar` só abre PR ou MR, em `#Auto` e `#Maestro`; nada muda na [RM-042](RM-042-modo-fast.md).

### Achados fora do escopo deste item

Defeitos do núcleo que o piloto achou e que não são do suporte a GitLab. Valem para as duas forjas e ficam para outro item.

| # | Achado | Onde | Efeito |
| --- | --- | --- | --- |
| B1 | `THREAD_DO_BUNDLE = /^ork-[a-z0-9-]+$/` aceita só thread de `abbrev` `ork`, mas o id da thread é `<abbrev>-<assunto>` (`core/src/thread.ts:100`); vem do commit `1692448d` | `core/src/ci.ts:380`, usado em `:384` (`ork ci prepare`) e `:476` (leitura do bundle pelo `ork ci run`) | em projeto com outro `abbrev`, `ork ci prepare` sai com `ci.bundle: "<id>" nao e id de thread`, e sem bundle o `ork ship publicar` recusa (`artifact.missing`) |
| B2 | o critério de `ork thread new --done` vira a claim C1 com arquivo `thread.json#doneWhen`, fora do git, e vai a `deferredClaims` com `artifact-not-in-checkout` | `core/src/ci.ts:139` (`motivoDiferimentoCi`) | o CI independente nunca roda o critério de pronto, só os comandos de `verify` do manifesto; o `ork verify` local roda |
| O2 | o `ork ship publicar` empurra antes de abrir o MR | `core/src/ship-publicar.ts:11` (ordem: push, depois PR/MR) | a primeira publicação gera duas pipelines no mesmo commit (a de branch e a do MR), mesmo com as `workflow:rules`; as duas verdes, o `ork ci status` escolheu a do MR |
| O5 | o leitor do subconjunto de YAML tira as aspas e guarda o `\"` literal | `core/src/yaml.ts:44` (`escalar`) | `test: "node -e \"process.exit(0)\""` no `orkastery.yaml` quebra o comando (saída 2) |

## Plano e decisões

- **Prioridade / método / pontuação / justificativa / data:** pedido do mantenedor, antes da especificação; o primeiro caso real é um GitLab CE próprio sem SSH. Sem pontuação RICE: decisão direta do owner.
- **Horizonte / alvo / previsão / confiança / marcos:** fatia 0 (respostas gravadas da matriz), 1 (porta com o adaptador GitHub, sem mudança de saída), 2 (correções do GitHub), 3 (bloco `forja:`, resolver e `ork doctor`), 4 (CI no GitLab), 5 (pulse e rede), 6 (entrega com MR), 7 (SHIP do MCP). Todas implementadas na branch; um PR só.
- **Dependências e bloqueios (ID, owner, próxima revisão):** RM-012 (CI como CHECK independente), RM-053 e RM-054 (rede e roadmap da rede), RM-059 F7 (`ork ship publicar` e a pista), RM-061 (texto nas duas línguas). Nenhum bloqueio.
- **Premissas / riscos / mitigação:**
  - Risco: um status forjado aprovar o gate. Mitigação: só o job da lista de jobs da pipeline conta como `gitlab-ci`; status avulso conta como `status:<login>` e só aprova se listado.
  - Risco: vazar token pela CLI da forja. Mitigação: o `ork` nunca lê token, o corpo vai por stdin ou arquivo 600 e todo detalhe passa pelo redator.
  - Risco: a janela de versões testadas envelhece todo mês. Mitigação: `core/scripts/forja-contrato.cjs` regrava as respostas de uma versão nova.
- **Decisões, alternativas e ADRs (ID, decisor, data, link):**
  - Forja como porta com adaptadores, e não um `if` a mais por consumidor: requisito do owner, para ligar outras forjas depois.
  - Os quatro modos entregam como antes, e nenhum modo mescla PR ou MR (decisão de 13/10/2026).
  - Commit status sozinho não aprova até existir `ci.produtor` (revisão de segurança de 13/10/2026).
  - Comandos de alto nível do `glab` (`glab mr merge`, `glab ci status`) não são usados: o primeiro arma auto-merge, o segundo lê por branch, não por commit.

## Estado com evidências

O código entrou na `main` pelo PR #175 (merge `1e88a932`) e está em produção na versão 0.6.0 (tag `v0.6.0` e `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026). A suíte cobre cada capacidade dos dois adaptadores contra as respostas gravadas; o piloto e as provas em docker estão resumidos em [Evidências](#evidências).

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Disponível | — | 2026-10-27 | Julio |
| Documentação | Em revisão | — | 2026-10-27 | Julio |
| Código | Mesclado | commit `1e88a932` · PR #175 | 2026-10-27 | Julio |
| Testes | Aprovados | — | 2026-10-27 | Julio |
| Deploy | Produção | release: v0.6.0, @orkastery/cli no npm (a porta da forja e o GitLab) | 2026-10-27 | Julio |
| Exposição | Geral | — | 2026-10-27 | Julio |
| Habilitação | Concluída | — | 2026-10-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI (R / A / C / I):** R: contribuidor da branch `forja/gitlab`; A: owner do item; C: —; I: —.
- **Agentes envolvidos, atuação, autonomia e revisor humano:** agente de código na implementação e nas provas, com o contribuidor no comando; revisor humano: o owner, no PR.
- **Próxima ação, responsável e prazo:** os achados de "Achados fora do escopo deste item" ficam para itens próprios; responsável: Julio. Sem data definida.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-10-14 | Item criado com as fatias 0 a 7 implementadas na branch | Pedido do mantenedor; matriz CE 16.11 a 19.4, provas em docker e piloto num GitLab CE 19.3.5 próprio | Julio |
| 2026-10-27 | Mesclado pelo PR #175 e em produção na 0.6.0: ciclo Disponível, exposição Geral e habilitação Concluída (o contrato da forja e a FEAT-039 saíram com a versão) | Merge `1e88a932` (PR #175) na `main` e na tag `v0.6.0`; seção 0.6.0 do CHANGELOG, de 26/10/2026 | thread `ork-docsda060emp` (#Fast), pelo pedido do dono |
