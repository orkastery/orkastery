---
id: FEAT-030
tipo: feature
titulo: Orkastery Network, a rede das máquinas de uma pessoa
estado: em desenvolvimento
pai: MOD-01
roadmap: [RM-053]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-29T20:50:00-03:00
versao: ork/ork-rm053network-full@866afea
fontes:
  codigo:
    - core/src/rede.ts
    - core/src/rede-adesao.ts
    - core/src/rede-forja.ts
    - core/src/rede-projetos.ts
    - core/src/rede-status.ts
  testes:
    - core/test/rede.test.ts
  docs:
    - docs/guias/varias-maquinas.md
    - docs/conceitos/decisoes/ADR-001-estado-da-rede.md
    - docs/referencia/contratos/rede-rm053.md
  simbolos:
    - core/src/rede.ts#entrarNaRede
    - core/src/rede.ts#publicarRede
    - core/src/rede.ts#sairDaRede
    - core/src/rede.ts#exigirRetratoSeguro
    - core/src/rede.ts#exigirSoOProprioRetrato
    - core/src/rede-adesao.ts#adesaoDaRede
    - core/src/rede-forja.ts#forjaPorNome
    - core/src/rede-projetos.ts#projetosConhecidos
    - core/src/rede-status.ts#lerRede
  contratos:
    - ork.rede/v1
    - ork.rede-maquina/v1
    - ork.rede-status/v1
  comandos:
    - ork network status
    - ork network entrar
    - ork network publicar
    - ork network sair
---

# FEAT-030 — Orkastery Network, a rede das máquinas de uma pessoa

> **Em uma frase:** cada máquina publica um retrato sem segredo num repositório privado da pessoa na forja, e `ork network status` mostra todas, de qualquer diretório, com a fonte e as lacunas.

- **Estado:** em desenvolvimento · **Verificado em:** 2026-09-29 · **Versão:** `ork/ork-rm053network-full@866afea`
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-053](../roadmap/RM-053-orkastery-network.md) · **Decisão:** [ADR-001](../conceitos/decisoes/ADR-001-estado-da-rede.md) · **Contratos:** [rede-rm053](../referencia/contratos/rede-rm053.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** entrar na rede com um nome de máquina; ver as máquinas da pessoa de qualquer diretório; publicar o retrato agora; sair.
- **Pré-condições e gatilho:** a CLI da forja (`gh` ou `glab`) com login nesta máquina; para publicar, a máquina é membro (entrou, ou fez `ork fabrica entrar`).
- **Fluxo principal:**

  1. `ork network entrar --maquina pc-casa` confere a casa `<usuario>/orkastery-network` na forja, cria o repositório privado quando falta e é do próprio login, grava a adesão em `~/.orkastery/rede.json` e publica o primeiro retrato.
  2. Depois, a batida do pulse e os eventos de thread (criar, despachar fase, entregar, fechar) publicam o retrato em segundo plano: no máximo uma tentativa a cada 15 minutos, e retrato igual só de hora em hora.
  3. `ork network status` lê a casa e a `ork/fabrica-estado` dos projetos conhecidos e mostra cada máquina, com a batida, os runtimes, os hosts e os projetos.

- **Alternativas, erros e recuperação:**
  - sem CLI de forja, sem login ou sem repositório: `status` responde com a lacuna tipada; `entrar` e `publicar` recusam com `rede.sem-forja` ou `rede.sem-repositorio`;
  - repositório público: nada é publicado (`rede.repositorio-publico`), e o `status` mostra a lacuna;
  - sem rede: o `status` mostra a última cópia e diz que é cópia; `--sem-remoto` nem tenta ler;
  - push recusado: relê a ponta e grava de novo, até cinco vezes;
  - publicação em segundo plano que falhou fica em `~/.orkastery/rede/rede.log`.
- **Pós-condições:** a casa tem um `maquinas/<maquina>.json` por máquina, o `REDE.md` e um commit por publicação, com a máquina na mensagem.
- **Regras de negócio:**
  - BR-030-01: a adesão é da máquina, explícita em `rede.json` ou herdada de `ork fabrica entrar`; `ork network sair` vence a herança; o manifesto do projeto não inscreve ninguém.
  - BR-030-02: publicar exige a casa privada, conferida na forja antes de cada publicação; publicação em segundo plano nunca cria repositório.
  - BR-030-03: o retrato é uma lista de permissão, e a varredura de segredo recusa a publicação inteira; o erro diz o padrão e o campo, nunca o valor.
  - BR-030-04: cada máquina só escreve o próprio retrato; retrato com o nome de outra máquina é ignorado na leitura e vira lacuna.
  - BR-030-05: lacuna nunca vira lista vazia; a leitura declara a fonte, o horário e o que não consultou (roadmap, reservas, threads).
- **Critérios de aceite e testes:** Dadas duas máquinas com a forja simulada, quando cada uma entra e publica, então o `status` de uma, de fora de qualquer clone, mostra as duas, e nenhum blob da casa tem token, credencial, caminho de credencial ou dado de conta paga (`core/test/rede.test.ts`).
- **Interface e acessibilidade:** texto em linhas curtas, com a fonte e o que não foi lido no topo e as lacunas no fim; `ork network status --json` com o contrato `ork.rede-status/v1` para agentes.

## Dados e contratos

- **Entidades e campos:**
  - `~/.orkastery/rede.json` (`ork.rede/v1`): adesão e casa;
  - `maquinas/<maquina>.json` (`ork.rede-maquina/v1`): máquina, hostname, forjas com o login, runtimes e hosts com versão, projetos com remoto sem credencial e caminho, versão do `ork` e batida;
  - `ork network status --json` (`ork.rede-status/v1`): casa, esta máquina, fontes, membros, lacunas e o que não foi consultado.
- **APIs e endpoints:** a API da forja pela CLI dela: `gh api user` e `gh api repos/<dono>/<nome>` no GitHub; `glab api user` e `glab api projects/<id>` no GitLab; o git pelo helper de credencial da própria CLI.
- **Eventos e jobs:** a batida do pulse (cron de 15 minutos) e os eventos de thread; nada novo no ledger das threads.

## Operação e controle

- **Configuração e ambientes:** `ork network entrar`, `--forja github|gitlab` e `--repositorio`; `ORK_MAQUINA` vence o nome gravado; `ORK_REDE_PUBLICAR=0` desliga a publicação automática; `ORK_BINARIOS_EXTRA` troca as pastas extras de binários.
- **Observabilidade:** `ork network status`, o `REDE.md` da casa e `~/.orkastery/rede/rede.log`.
- **Acesso, privacidade e conformidade:** casa privada da pessoa; nenhum token é lido pelo `ork`; hostname e caminhos locais só vão para a casa privada, nunca para a branch da fábrica (BR-027-02 continua).
- **Dependências e rollback:** depende da CLI da forja e do git. Rollback: `ork network sair` em cada máquina; apagar o repositório `orkastery-network` zera a rede sem afetar projeto nenhum.
- **Código, PR, testes e release:** `core/src/rede*.ts`, `core/test/rede.test.ts`; PR e release a registrar no RM-053.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-29 | página criada com a fatia 1 da RM-053 | Claude (agente) / Julio, revisão pendente | RM-053, ADR-001 |
