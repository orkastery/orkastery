---
id: FEAT-032
tipo: feature
titulo: Roadmap da rede, de qualquer diretório
estado: vigente
pai: MOD-01
roadmap: [RM-054]
owner: Julio
aprovador: Julio
verificado_em: 2026-10-01T02:50:00-03:00
versao: main@6ea7acb
fontes:
  codigo:
    - core/src/network-roadmap.ts
    - core/src/forja.ts
    - core/src/roadmap-status.ts
    - core/src/projeto-alvo.ts
    - core/src/mcp-server.ts
    - adapters/openclaw/src/index.ts
    - adapters/hermes/bin/ork-network-roadmap.sh
  testes:
    - core/test/network-roadmap.test.ts
    - core/test/forja.test.ts
    - core/test/network-roadmap-hosts.test.ts
    - adapters/openclaw/test/network-roadmap.test.mjs
  docs:
    - docs/guias/varias-maquinas.md
  simbolos:
    - core/src/network-roadmap.ts#montarPanoramaDaRede
    - core/src/network-roadmap.ts#textoDoPanoramaDaRede
    - core/src/network-roadmap.ts#resolverProjeto
    - core/src/forja.ts#lerDaForja
    - core/src/forja.ts#identidadeDaForja
    - core/src/roadmap-status.ts#montarStatusDeFatos
    - core/src/network-roadmap.ts#projetosConhecidos
    - core/src/projeto-alvo.ts#OFERTA_DA_REDE
  contratos:
    - ork.network-roadmap/v1
    - ork.roadmap-status/v1
    - ork.projetos/v1
  comandos:
    - ork network roadmap
---

# FEAT-032 — Roadmap da rede, de qualquer diretório

> **Em uma frase:** `ork network roadmap` junta, para cada projeto da pessoa, o status report do roadmap, as reservas e as threads de cada máquina, lendo a forja quando não há clone, e diz a fonte e a hora de cada parte e o que ficou sem ler.

- **Estado:** vigente · **Verificado em:** 2026-10-01 · **Versão:** main@6ea7acb (PR #29), publicada na 0.5.0; a fatia 3 da RM-054 segue em aberto
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-054](../roadmap/RM-054-roadmaps-e-threads-da-rede.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso:** o dono, ou um agente por ele, pergunta pelo roadmap de um projeto de qualquer máquina e de qualquer diretório, inclusive do cwd de um gateway que tem o manifesto de outro projeto; nos hosts (OpenClaw, MCP, Hermes, Claude Code e Codex), a pergunta chega por `ork_network_roadmap` ou pela frase `orkastery maestro` sem projeto.
- **Pré-condições:** para projeto com clone nesta máquina, o manifesto e o remoto da fábrica (`fabrica.remoto`, padrão `origin`); para projeto sem clone, a CLI da forja com login (`gh` ou `glab`).
- **Fluxo principal:**

  1. Os projetos: o do cwd, o do `--projeto` e os do registro `~/.orkastery/projetos.json` (`ork.projetos/v1`, da RM-052), sem repetir. Nome sozinho é sempre nome; caminho, só escrito como caminho (absoluto, `./`, `../` ou `~/`) e só a raiz de um projeto.
  2. Com clone: `docs/roadmap` da base remota (`origin/main`), `ork/roadmap-reservas` e `ork/fabrica-estado` pelo fetch de sempre, e esta máquina pelo estado local, lido agora.
  3. Sem clone: uma consulta `gh api graphql` traz a base, o manifesto, os commits do dia e as duas branches de estado; se o manifesto lido aponta outra `worktree.base_branch`, a leitura é refeita por ela, e se o fuso dele começa o dia antes da janela pedida, os commits do dia são relidos desde esse começo. O GitLab usa a mesma interface.
  4. O status report do RM-048 é montado com as threads de todas as máquinas; o fecho diz entre parênteses em que máquina cada uma anda.
  5. Cada parte sai com a fonte (clone ou forja, ref, commit, data do commit, hora da leitura, leitura nova ou cópia) e cada falta, como lacuna tipada.
  6. Nos hosts (fatia 2): o OpenClaw e o Hermes chamam `ork network roadmap` com `ORK_PROJETO_EXPLICITO=1` (modo host); o MCP chama o mesmo montador em modo fixado, só com o projeto servido; o Claude Code e o Codex usam o CLI ou a tool do MCP. A descrição de cada tool manda transportar o texto como vem.

- **Alternativas, erros e recuperação:**
  - `--projeto` ambíguo ou desconhecido: a recusa `projeto.ambiguo` ou `projeto.desconhecido`, com os candidatos, e saída 4; caminho sem manifesto: `projeto.sem-manifesto`;
  - sem rede: vale a última cópia desta máquina, com a lacuna `<parte>.sem-leitura`; `--sem-remoto` pede isso de propósito;
  - forja: `forja.ausente`, `forja.sem-login`, `forja.nao-encontrado`, `forja.tempo-esgotado`, `forja.inacessivel` e `forja.resposta-invalida`, com o detalhe redigido;
  - nenhum projeto conhecido: a lacuna `rede.sem-projeto` e saída 2;
  - um projeto que derruba a leitura vira `projeto.sem-leitura`: os outros projetos seguem;
  - estado local ilegível (um `thread.json` corrompido): `estado-local.sem-leitura`, e esta máquina entra com as threads legíveis;
  - `fabrica.remoto` ou `worktree.base_branch` que não são nome de remoto ou de branch (por exemplo, `--upload-pack=...` ou `--output=...`): `projeto.remoto-invalido` ou `projeto.base-invalida`, e nada chega ao git;
  - caminho que não é a raiz de um projeto: `projeto.sem-manifesto`, dizendo onde está o manifesto mais próximo;
  - no host, caminho ou URL no `--projeto`: `projeto.desconhecido` e saída 4, sem ecoar o pedido; sem projeto e com mais de um conhecido, a recusa `projeto.escolha` da RM-052 oferece o panorama da rede.
- **Pós-condições:** nada é gravado no estado do `ork` nem na forja; no clone, o fetch atualiza só as refs remotas.
- **Regras de negócio:**
  - BR-032-01: lacuna nunca vira "vazio"; o que não foi lido sai com o tipo e o que fazer, e o que não foi olhado sai em `naoConsultado`.
  - BR-032-02: o roadmap da rede é o da base remota, igual para toda máquina.
  - BR-032-03: máquina sem retrato novo há mais de 3 h está sem batida, e a lacuna diz a idade.
  - BR-032-04: "Entregue hoje" sai do merge `ship(<thread>)` do dia na base, no fuso do dono do projeto consultado (`owner.timezone`), senão no do processo.
  - BR-032-05: só consulta na forja; nenhum token é lido, copiado ou passado em argumento.
  - BR-032-06: no host (`ORK_PROJETO_EXPLICITO=1`), o `--projeto` é o nome registrado ou a forja (`github:`/`gitlab:`) em `github.com`, `gitlab.com` ou no host de um projeto registrado, e o projeto do cwd do gateway só entra pelo registro; forja de host livre recusa sem chamar `gh` nem `glab`.
  - BR-032-07: no MCP, só o projeto servido, em todas as máquinas dele; o registro não é lido e os outros projetos não aparecem.
  - BR-032-08: nos hosts, o status do roadmap vem desta leitura, transportada como vem; lacuna e "Não consultado" nunca viram "roadmap vazio" nem "nenhuma máquina publicou".
  - BR-032-09: no OpenClaw, `ork_network_roadmap` é declarada nos perfis `coding` e `messaging` do manifesto, e chega ao modelo sem liberação do operador; as outras tools `ork_*` seguem sob `tools.alsoAllow`.
- **Critérios de aceite e testes:** Dado um projeto com duas máquinas no mesmo remoto, quando o dono pede o roadmap de um diretório de outro projeto, então a resposta é a do projeto pedido, com as threads das duas máquinas e a fonte de cada parte (`core/test/network-roadmap.test.ts`); a forja lida sem clone, sem mutation e sem segredo (`core/test/forja.test.ts`); pela extensão do OpenClaw com o `ork` real, do cwd de um workspace fora do registro, o pedido do `orkastery` volta com as threads das duas máquinas e a hora de cada fonte, e os hosts fazem a mesma rota (`core/test/network-roadmap-hosts.test.ts`, `adapters/openclaw/test/network-roadmap.test.mjs`).
- **Interface e acessibilidade:** texto com o consultado e o não consultado no alto; cada projeto no fuso do dono dele, com a legenda do bloco quando difere; `--json` com o contrato `ork.network-roadmap/v1` para agentes.

## Dados e contratos

- **Entidades:** o panorama `ork.network-roadmap/v1`, com `projetos` (cada um com `projeto`, `roadmap` no contrato `ork.roadmap-status/v1`, `reservas`, `maquinas`, `fontes` e `lacunas`), `naoConsultado` e `lacunas` da consulta.
- **APIs:** GraphQL do GitHub (`gh api graphql`) e do GitLab (`glab api graphql`), mais o REST de commits do GitLab, só leitura.
- **Eventos:** Não aplicável — leitura pura, sem evento no ledger.

## Operação e controle

- **Configuração:** o nome desta máquina vem de `ORK_MAQUINA`, de `~/.orkastery/maquina.json` ou do hostname; o login da forja é o da própria CLI.
- **Observabilidade:** a seção "Fontes" e as lacunas da própria saída.
- **Acesso e privacidade:** só o que a pessoa já enxerga pela forja; detalhe de erro redigido e descartado se casar padrão de segredo.
- **Dependências e rollback:** usa o RM-048 (`montarStatusDeFatos`), as reservas (FEAT-026) e a fábrica (FEAT-027); voltar atrás é reverter os commits da thread, sem dado a migrar.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-29 | página criada com a fatia 1 da RM-054 | Claude (agente) / Julio, revisão pendente | RM-054 |
| 2026-09-29 | GO-FIX da revisão independente: nome é nome, fuso e base do projeto, isolamento por projeto, remoto validado | Claude (agente) / Julio, revisão pendente | RM-054, CHECK da `ork-rm054roadmap` |
| 2026-09-29 | GO-FIX da rodada 2: base validada, retrato local tolerante, caminho só como raiz, commits e fuso por projeto | Claude (agente) / Julio, revisão pendente | RM-054, CHECK da `ork-rm054roadmap` |
| 2026-09-30 | fatia 2: `ork_network_roadmap` nos hosts, modo host e modo fixado, e a oferta da rede na recusa do projeto-alvo | Claude (agente) / Julio, revisão pendente | RM-054, thread `ork-rm054fatia2` |
| 2026-10-01 | vigente: fatias 1 (PR #25) e 2 (PR #29) mescladas e publicadas na 0.5.0 | Claude (agente) / Julio, revisão pendente | merges `b64d2f2` e `6ea7acb`; tag `v0.5.0` |
