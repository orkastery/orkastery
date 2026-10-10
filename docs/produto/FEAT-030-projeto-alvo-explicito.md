---
id: FEAT-030
tipo: feature
titulo: Projeto-alvo explícito e resposta honesta nos hosts
estado: vigente
pai: MOD-06
roadmap: [RM-052]
owner: Julio
aprovador: Julio
verificado_em: 2026-10-01T02:45:00-03:00
versao: main@a24a187
fontes:
  codigo:
    - core/src/projeto-alvo.ts
    - core/src/manifest.ts
    - core/src/index.ts
    - core/src/mcp-server.ts
    - adapters/openclaw/src/index.ts
    - core/src/conducao.ts
    - core/src/fabrica-publicar.ts
    - core/src/roadmap-reservas.ts
    - adapters/hermes/skills/orkastery-devmaster/SKILL.md
  testes:
    - core/test/projeto-alvo.test.ts
    - core/test/projeto-alvo-cli.test.ts
    - core/test/projeto-alvo-consulta.test.ts
    - core/test/projeto-alvo-mcp.test.ts
    - core/test/projeto-alvo-hosts.test.ts
    - core/test/projeto-alvo-incidente.test.ts
    - adapters/openclaw/test/projeto-alvo.test.mjs
    - core/test/projeto-alvo-despacho.test.ts
    - core/test/projeto-alvo-reservas.test.ts
    - core/test/projeto-alvo-declaracao.test.ts
  simbolos:
    - core/src/projeto-alvo.ts#resolverProjetoAlvo
    - core/src/projeto-alvo.ts#registrarProjeto
    - core/src/projeto-alvo.ts#consultaDoProjeto
    - core/src/manifest.ts#diretorioDoProjeto
    - core/src/index.ts#extrairOpcaoDeProjeto
    - core/src/projeto-alvo.ts#AMBIENTE_SEM_PROJETO_HERDADO
    - core/src/projeto-alvo.ts#pedirDeclaracaoDoProjeto
    - core/src/projeto-alvo.ts#declaracaoQueFaltou
    - core/src/roadmap-reservas.ts#leituraDasReservas
  contratos:
    - ork.projetos/v1
    - ork.consulta/v1
    - ork.board/v1
  comandos:
    - ork projetos
    - ork projetos registrar
    - ork projetos esquecer
---

# FEAT-030 — Projeto-alvo explícito e resposta honesta nos hosts

> **Em uma frase:** todo comando e toda tool `ork_*` leem o projeto pedido, nunca o do diretório do gateway, e toda resposta de maestro, board, fábrica e roadmap diz qual projeto leu e o que não leu.

- **Estado:** vigente · **Verificado em:** 2026-10-01 · **Versão:** main@a24a187 (PR #24), publicada na 0.5.0; a fatia 2 da RM-052 (sessão despachada com o projeto neutro, reservas, a linha "Projeto consultado" em toda resposta e o Hermes) em PR
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-02](SYS-02-hosts-e-canais.md) > [MOD-06](MOD-06-integracao-com-hosts.md)
- **Roadmap:** [RM-052](../roadmap/RM-052-projeto-alvo-explicito.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** pedir o status de um projeto nomeado de qualquer canal; listar os projetos da máquina; registrar a cópia antiga; tirar do registro a cópia que sumiu.
- **Pré-condições e gatilho:** o projeto tem `orkastery.yaml`; o nome dele está no registro da máquina (`ork init`, `ork thread new` e `ork fabrica entrar` registram) ou chega como caminho.
- **Fluxo principal:**

  1. O `ork` tira `--projeto <nome|caminho>` do argv, em qualquer posição, antes de despachar qualquer comando.
  2. Resolve o alvo: `--projeto`, depois `ORK_PROJETO`, depois o host sem diretório de projeto (`ORK_PROJETO_EXPLICITO=1`), depois o diretório atual.
  3. As raízes padrão do manifesto partem do alvo; o `maestro` recebe o alvo como seleção.
  4. A resposta começa pelo cabeçalho da consulta: projeto, raiz com `~`, remoto sem credencial, origem, e o que não foi lido.
  5. Fatia 2: o comando que não monta o próprio cabeçalho termina com a linha `Projeto consultado: ...` no stderr quando o leitor não tem como saber qual projeto foi lido (no host, ou com o projeto fora do diretório atual), também quando falha; `maestro` declara no snapshot e `sessions event` (o sensor dos hooks) fica sem a linha.

- **Alternativas, erros e recuperação:**
  - nome fora do registro: `projeto.desconhecido`, com os registrados;
  - nome de duas cópias: `projeto.ambiguo`, com as duas; o caminho desfaz a dúvida;
  - caminho sem manifesto: `projeto.sem-manifesto`;
  - host sem projeto e com mais de um conhecido: `projeto.escolha`, com os candidatos; com nenhum: `projeto.nenhum`;
  - MCP com outro projeto: `projeto.fora-do-servidor`, com o projeto servido;
  - `ork roadmap reservas` sem o remoto, ou com o remoto mudo e sem cópia local: o cabeçalho e "nada foi lido de ork/roadmap-reservas", com `leitura` `sem-remoto` ou `sem-copia` no JSON;
  - no CLI, toda recusa sai na saída 4; com `--json`, em objeto.
- **Pós-condições:** o registro `~/.orkastery/projetos.json` guarda a raiz canônica de cada cópia; nenhum estado de projeto muda por uma consulta.
- **Regras de negócio:**
  - BR-030-01: o `ork` nunca escolhe um projeto no lugar de quem pediu; ambiguidade é recusa com candidatos.
  - BR-030-02: sem `--projeto` e sem `ORK_PROJETO`, o terminal segue o diretório atual.
  - BR-030-03: no host, `--projeto` aceita só nome de projeto, venha da tool que vier; caminho só no terminal.
  - BR-030-07: nome que aponta o projeto do cwd usa a cópia do cwd (a worktree da thread); caminho explícito vale como pedido.
  - BR-030-04: o MCP continua fixado na instalação; o parâmetro `projeto` só confere.
  - BR-030-05: sem o remoto, board e fábrica dizem que nada foi lido de `ork/fabrica-estado`; nunca "nenhuma publicou ainda".
  - BR-030-06: comandos com `--projeto` próprio (`network`, da RM-054) recebem a opção intacta.
  - BR-030-08: a sessão despachada e o filho `fabrica publicar` leem o projeto pelo próprio cwd: o ambiente da condução leva `ORK_PROJETO` vazio e `ORK_PROJETO_EXPLICITO=0`, e o modo host de quem despachou não os segue.
  - BR-030-09: resposta de projeto que o leitor não tem como adivinhar diz qual projeto leu, uma vez só: o cabeçalho do comando, ou a linha `Projeto consultado` no fim, no stderr.
  - BR-030-10: "nenhum item reservado" só depois de ler `ork/roadmap-reservas`; sem leitura, a resposta diz que nada foi lido.
- **Critérios de aceite e testes:** Dado o gateway parado num projeto sem remoto e o orkastery registrado, quando a tool de roadmap é chamada com `projeto: orkastery`, então a resposta é o roadmap do orkastery e o declara; sem `projeto`, a resposta é a escolha (`core/test/projeto-alvo-incidente.test.ts`). Fatia 2: dado um host com dois projetos registrados, quando ele despacha uma fase, então o `ork` da sessão na worktree lê a thread (`core/test/projeto-alvo-despacho.test.ts`); quando qualquer tool de projeto do OpenClaw é chamada com `projeto`, então a resposta nomeia o projeto lido uma vez (`core/test/projeto-alvo-declaracao.test.ts`); quando o projeto não tem remoto, então `ork roadmap reservas` diz que nada foi lido (`core/test/projeto-alvo-reservas.test.ts`).
- **Interface e acessibilidade:** o cabeçalho tem duas linhas curtas em texto; em JSON, o objeto `consulta` (`ork.consulta/v1`).

## Dados e contratos

- **Entidades:** o registro `ork.projetos/v1`, com `nome`, `abbrev`, `raiz`, `remoto`, `registradoEm`, `atualizadoEm` e `fonte`; o contrato completo está em [projetos-rm052](../referencia/contratos/projetos-rm052.md).
- **APIs:** `ork projetos [--json]`; o parâmetro `projeto` em toda tool do OpenClaw e do MCP; `ork board --json` passa a `ork.board/v1`, com `consulta` e `threads`.
- **Eventos:** Não aplicável — a resolução não grava ledger; o registro é um índice da máquina.

## Operação e controle

- **Configuração:** `ORK_PROJETO` fixa o projeto do shell inteiro; `ORK_PROJETO_EXPLICITO=1` é declarado pelos adaptadores OpenClaw e Hermes, e `0` desliga no Hermes.
- **Observabilidade:** `ork projetos` mostra cada cópia e se ela ainda está no disco.
- **Acesso, privacidade e conformidade:** o registro não guarda segredo: o remoto perde usuário e senha, e a gravação passa pela varredura de segredo antes do disco (arquivo `0600`).
- **Dependências e rollback:** usa o manifesto e o git do projeto; para voltar, apague `~/.orkastery/projetos.json` e rode sem `--projeto`, o que devolve o comportamento pelo diretório atual.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-29 | página criada com a primeira fatia da RM-052 | Claude (agente) / Julio, revisão pendente | RM-052, thread `ork-rm052projeto` |
| 2026-10-01 | vigente: mesclada pelo PR #24 e publicada na 0.5.0 | Claude (agente) / Julio, revisão pendente | PR #24, merge `a24a187`; tag `v0.5.0` |
| 2026-10-10 | fatia 2 da RM-052: BR-030-08 a BR-030-10, o passo 5 do fluxo e os três testes novos | Claude (agente) / Julio, revisão pendente | RM-052, thread `ork-rm052projet2`, D1 a D9 no ledger |
