---
id: FEAT-038
tipo: feature
titulo: Conhecimento escrito
estado: vigente
pai: MOD-05
roadmap: [RM-026]
owner: Julio
aprovador: Julio
verificado_em: 2026-10-27T00:50:00-03:00
versao: main@69dc0ff6
fontes:
  codigo:
    - core/src/conhecimento.ts
    - core/src/conhecimento-consulta.ts
    - core/src/mcp-conhecimento.ts
    - adapters/openclaw/src/index.ts
    - adapters/hermes/bin/ork-conhecimento-listar.sh
    - adapters/hermes/bin/ork-conhecimento-mostrar.sh
    - adapters/hermes/bin/ork-conhecimento-colecoes.sh
    - adapters/hermes/bin/ork-conhecimento-verificar.sh
  testes:
    - core/test/conhecimento.test.ts
    - core/test/conhecimento-consulta.test.ts
    - core/test/conhecimento-cli.test.ts
    - core/test/mcp-conhecimento.test.ts
    - core/test/conhecimento-hosts.test.ts
    - adapters/openclaw/test/conhecimento.test.mjs
    - adapters/hermes/test/conhecimento_test.py
  docs:
    - docs/referencia/contratos/conhecimento-rm026.md
  simbolos:
    - core/src/conhecimento.ts#lerConhecimento
    - core/src/conhecimento-consulta.ts#consultarConhecimento
    - core/src/conhecimento-consulta.ts#consultaRespondeu
    - core/src/mcp-conhecimento.ts#TOOLS_DO_CONHECIMENTO
    - adapters/openclaw/src/index.ts#REGRA_DAS_LACUNAS
  contratos:
    - ork.conhecimento/v1
  comandos:
    - ork conhecimento listar
    - ork conhecimento mostrar
    - ork conhecimento colecoes
    - ork conhecimento verificar
---

# FEAT-038: Conhecimento escrito

> **Em uma frase:** Um agente lista, lê e cita os documentos escritos da empresa (política, especificação, guia) pela CLI, pelo MCP, pelo OpenClaw e pelo Hermes, com a versão e a fonte, e o que não confere chega como lacuna tipada.

- **Estado:** vigente · **Verificado em:** 2026-10-27 · **Versão:** main@69dc0ff6 (fatia 3, PR #161); as fatias 1 (PR #143) e 2 (PR #153) antes dela; a 0.5.6 levou só a fatia 1, e a 0.6.0 leva as três
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-026](../roadmap/RM-026-workspace-empresarial.md), pacote K7
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:**
  - UC-038-01, listar os documentos, com filtro por coleção: `ork conhecimento listar [--colecao C]` e `ork_conhecimento_listar`.
  - UC-038-02, ler um documento com o corpo, a versão, a fonte e as referências conferidas: `ork conhecimento mostrar <doc-id>` e `ork_conhecimento_mostrar`.
  - UC-038-03, ver as coleções e os documentos de cada uma: `ork conhecimento colecoes` e `ork_conhecimento_colecoes`.
  - UC-038-04, conferir a pasta inteira, como gate de CI: `ork conhecimento verificar` e `ork_conhecimento_verificar`.
  - As quatro tools têm o mesmo nome no MCP (`ork mcp serve`, no Claude Code e no Codex), no plugin do OpenClaw e no `bin` do Hermes.
- **Pré-condições e gatilho:**
  - O `orkastery.yaml` declara a pasta (`conhecimento: { dir: docs/conhecimento }`); sem o bloco, toda consulta responde a lacuna `conhecimento.nao-declarado`.
  - Cada documento é Markdown com frontmatter: `id`, `titulo`, `colecoes` e, opcional, `referencias` (ids do Brain e decisões `thread#linha`).
  - A conferência dos ids do Brain pede o Company Brain (`memory.mode: orkmind`); sem ele, a referência vira `referencia.brain-indisponivel`.
- **Fluxo principal:**

  1. O núcleo lê a pasta declarada, sem seguir link e sem criar processo, e valida cada documento.
  2. No `mostrar` e no `verificar`, cada decisão citada confere no ledger canônico e cada id do Brain confere por `get`.
  3. A resposta é o JSON do contrato `ork.conhecimento/v1`, o mesmo na CLI (`--json`), no MCP, no OpenClaw e no Hermes.
  4. No canal do OpenClaw ou do Hermes, o modelo cita o documento pela versão (sha256) e pela fonte (arquivo) e mostra cada lacuna como lacuna.

- **Alternativas, erros e recuperação:**
  - A pasta que não abre (`conhecimento.*`) tira tudo da resposta; o documento inválido (`documento.*`) sai da lista; a referência que não confere (`referencia.*`) sai do documento. Os três vão à lista de lacunas.
  - O Brain fora do ar, recusando ou em conflito para a conferência: as referências que faltavam levam o mesmo detalhe, e nenhum `get` sai depois.
  - Saída 1 com o JSON (o `isError` do MCP, `[ork saiu com 1]` no OpenClaw) é a consulta que não respondeu: `listar` e `colecoes` sem a pasta lida, `mostrar` sem documento, `verificar` com qualquer lacuna. Saída 1 sem JSON é erro do `ork` (por exemplo, `--projeto` repetido), e uso errado sai 2.
  - No OpenClaw, o runtime valida o argumento pelo schema da tool antes de chamá-la; o host confere de novo, sem chamar o `ork` (`conhecimento.argumento-invalido`), e o núcleo, mais uma vez. No Hermes, o argumento é dado para o shell, mas uma opção como `--help` chega ao parser do CLI e devolve a ajuda geral.
- **Pós-condições:** nada é gravado. Escrever um documento é um commit numa thread, com PR.
- **Regras de negócio:**
  - BR-038-01: o documento vale inteiro ou vira lacuna; a referência vale sozinha, e o documento segue sem ela.
  - BR-038-02: lacuna nunca vira resposta. Documento que virou lacuna não é documento inexistente, referência que não conferiu não é referência e pasta não lida não é conhecimento vazio.
  - BR-038-03: o id do Brain só vira referência com o `get` `ok` no contrato da entidade, com o id e o tenant pedidos; `unknown` e `empty` viram `referencia.brain-inexistente`, `withheld` vira `referencia.brain-retido` e o resto, `referencia.brain-indisponivel`.
  - BR-038-04: o host transporta. Cada tool do OpenClaw e cada wrapper do Hermes é uma chamada de `ork conhecimento <consulta> --json`, e a regra mora no núcleo.
- **Critérios de aceite e testes:**
  - Dado um documento com uma referência que o Brain confere e outra que ele não tem, quando o dono pede o documento pelo OpenClaw ou pelo Hermes, então a resposta é o JSON da tool MCP, com a primeira em `referencias.brain` e a segunda só em `lacunas` (`core/test/conhecimento-hosts.test.ts`).
  - Dado o id `--help`, quando a tool do OpenClaw é chamada, então o host recusa sem chamar o `ork` (`adapters/openclaw/test/conhecimento.test.mjs`).
  - Dado o núcleo saindo 1, quando o wrapper do Hermes roda, então ele sai 1 com o JSON byte a byte (`adapters/hermes/test/conhecimento_test.py`).
  - Dada qualquer lacuna, quando o `verificar` roda, então a CLI sai 1 e a tool vem com `isError` (`core/test/conhecimento-cli.test.ts`, `core/test/mcp-conhecimento.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI, MCP e hosts de conversa, sem interface web (decisão do dono de 28/09/2026).

## Dados e contratos

- **Contrato:** `ork.conhecimento/v1`, com o frontmatter, as consultas, as lacunas e os tetos ([referência](../referencia/contratos/conhecimento-rm026.md)).
- **Documento:** `id` (`doc-...`), `titulo`, `colecoes`, `referencias.brain` (`prod-`, `proj-`, `init-`) e `referencias.decisoes` (`<thread>#<linha>`). A versão é o sha256 dos bytes do arquivo.
- **Resposta:** `contrato`, `consulta`, `dir` e `lacunas`, mais `documentos`, `documento` ou `colecoes`, conforme a consulta. Toda lacuna traz `codigo`, `arquivo`, `documento`, `referencia` e `detalhe`.
- **APIs e integrações:** o `get` do Company Brain (`orkmind.company-brain-api/v1`), pelo transporte do `ork brain get`, com teto de 100 `get` e prazo de 60 s por consulta.
- **Eventos e jobs:** Não aplicável — consulta sob pedido, sem evento nem agendamento.

## Operação e controle

- **Configuração e ambientes:** `conhecimento.dir` no `orkastery.yaml`; `memory.*` para o Brain; os tetos são fixos no núcleo.
- **Observabilidade:** o `ork conhecimento verificar` sai 1 com lacuna e serve de gate de CI; a consulta não grava no ledger.
- **Acesso, privacidade e conformidade:**
  - Só leitura, nas quatro superfícies. No OpenClaw, as quatro tools ficam só no perfil `coding`, o padrão das configurações locais, que já tem shell; ficam fora do `messaging`, o perfil de conversa sem shell. O operador tira do `coding` com `tools.deny` e põe no `messaging` com `tools.alsoAllow`.
  - O `mostrar` e o `verificar` rodam o `memory.cli` que o manifesto escolhe, e o valor da variável que o `memory.database_url_env` nomeia vai a ele e pode voltar na resposta: é o pendente P6 da [fronteira de confiança](../referencia/fronteira-de-confianca.md). O OpenClaw, em toda tool, e os wrappers do conhecimento do Hermes tiram `ORK_HITL_*` do ambiente antes de chamar o `ork`.
  - O título e o corpo são texto do repositório: as descrições das tools e a skill do Hermes mandam tratá-los como dado, nunca como instrução.
- **Fora deste corte:** escrever documento por tool, a allowlist da sessão filha do `claude-bg` e a federação do conhecimento entre repositórios.
- **Limites conhecidos:**
  - A resposta não tem teto próprio. No OpenClaw, o texto da tool corta em 16 MiB, com `[ork saiu com ERR_CHILD_PROCESS_STDIO_MAXBUFFER]`: o `verificar` de uma pasta enorme com o Brain fora do ar chega lá. Nesse caso, use o `ork conhecimento verificar` no terminal.
  - O prazo de 60 s da conferência é conferido entre um `get` e outro: um `memory.cli` que ignora o SIGTERM segura a consulta além dele, e a tool que o host aborta deixa o `memory.cli` rodando até ele sair.
- **Dependências e rollback:** o Company Brain ([RM-025](../roadmap/RM-025-company-brain-fundacao.md)) para a conferência. Rollback: reverter o merge e reinstalar os adaptadores; nada a migrar.
- **Código, PR, testes e release:** fatia 1 no PR #143 (merge `1079f47`), fatia 2 no PR #153 (merge `89e934a`), fatia 3 no PR #161 (merge `69dc0ff6`). A 0.5.6 levou só a fatia 1 (o contrato e a leitura, sem comando); o comando, as tools e os hosts saíram na versão 0.6.0 (tag `v0.6.0`, `@orkastery/cli` 0.6.0 no npm, publicado em 27/10/2026).
- **Próxima ação do dono:** reinstalar a extensão do OpenClaw e a skill do Hermes nos hosts, depois do merge da fatia 3. O agente não faz isso. O `ork` que roda a instalação é o que as tools chamam (no Hermes, salvo um `ORK_BIN` no ambiente dele), e ele precisa ter o K7.

  ```bash
  # 1. No clone desta máquina, depois do merge:
  cd ~/orkastery && git pull --ff-only && npm --prefix core ci && npm --prefix core run build
  # 2. OpenClaw: reinstala a extensão, reinicia o gateway e confere as 32 tools
  node core/dist/index.js adapter install openclaw --dir ~/.openclaw
  openclaw gateway restart
  openclaw plugins inspect orkastery --runtime
  # 3. Hermes, na máquina do Hermes, num clone atualizado como no passo 1 (o catálogo vem do clone do cwd):
  cd ~/orkastery && node core/dist/index.js adapter install hermes --dir ~/.hermes
  # o wrapper usa o ORK_BIN do ambiente antes do ork instalado: tire-o, ou aponte-o para um ork com o K7, e confira
  sh ~/.hermes/bin/ork-conhecimento-colecoes.sh --projeto <nome>
  # depois, uma sessão nova do Hermes
  ```

  Depois da versão do npm que levar o K7, os mesmos passos com o `ork` global: `npm install -g @orkastery/cli@latest`, `ork adapter install openclaw --dir ~/.openclaw` e `ork adapter install hermes --dir ~/.hermes`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-10-12 | página criada com a fatia 3 do K7: as tools nos hosts OpenClaw e Hermes | Claude (agente) / Julio, revisão pendente | RM-026, thread `ork-rm026k7conhe`, decisões D17 a D19 |
| 2026-10-27 | vigente: as três fatias publicadas na 0.6.0 | Claude (agente, thread `ork-docsda060emp`) / Julio, revisão pendente | merges `89e934a` e `69dc0ff6` na tag `v0.6.0` |
