---
id: FEAT-033
tipo: feature
titulo: Dossiê de decisão
estado: vigente
pai: MOD-05
roadmap: [RM-026]
owner: Julio
aprovador: Julio
verificado_em: 2026-10-01T02:20:00-03:00
versao: main@46220bc
fontes:
  codigo:
    - core/src/company-brain-dossie.ts
    - core/src/company-brain-cli.ts
    - core/src/company-brain-mcp.ts
    - core/src/gates.ts
    - adapters/openclaw/src/index.ts
  testes:
    - core/test/company-brain-dossie.test.ts
    - core/test/company-brain-mcp.test.ts
    - core/test/company-brain-hosts.test.ts
  simbolos:
    - core/src/company-brain-dossie.ts#buildDossie
    - core/src/company-brain-dossie.ts#DOSSIE_SCHEMA
    - core/src/gates.ts#reciboHumanoConfere
  contratos:
    - ork.dossie-de-decisao/v1
  comandos:
    - ork brain dossie
---

# FEAT-033: Dossiê de decisão

> **Em uma frase:** O `ork brain dossie` reúne as decisões de uma thread com o objetivo e o projeto, o contexto citável, as alternativas, quem decidiu e a evidência, nos mesmos ids do Company Brain. Só leitura.

- **Estado:** vigente · **Verificado em:** 2026-10-01 · **Versão:** main@46220bc (PR #27), publicada na 0.5.0
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-026](../roadmap/RM-026-workspace-empresarial.md), pacote K3
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:**
  - Consultar o dossiê de uma thread: `ork brain dossie --thread <id>`.
  - Consultar uma decisão: `ork brain dossie --thread <id> --decisao <id do pedido ou fact-…>`.
  - Nos hosts: `ork_brain_dossie` no MCP (Claude Code e Codex) e no plugin do OpenClaw; o Hermes usa o repasse `ork_brain`.
- **Pré-condições e gatilho:** thread existente. O contexto e o frescor pedem o Brain (`memory.mode: orkmind`); a leitura não depende da ativação de escrita.
- **Fluxo principal:**

  1. O vínculo sai do que o núcleo já grava: o objetivo é o ticket do K1 (`creationOrigin`) ou, sem ele, o objetivo cuja lista de threads contém a thread; o projeto é o escopo vinculado por `ork brain bind` ou, sem ele, o `portfolio` do objetivo.
  2. Com projeto, o contexto é o pacote `ork.brain-context/v1` do `ork brain context` para o projeto e as iniciativas, com a cadeia de pais.
  3. As decisões vêm do ledger da thread: a decisão informada (`ork decisao registrar`), a pergunta de gate ao dono com a resposta que entrou pelo ingresso autenticado, e as decisões gravadas antes do contrato.
  4. Cada decisão leva a citação da linha do ledger e os ids que o Brain dá a esse fato (`fact-…`, `event-…`); uma seleção no Brain diz o frescor de cada um.

- **Alternativas, erros e recuperação:**
  - Brain indisponível, proibido ou em conflito: o dossiê devolve o estado recebido, sem decisão montada só da fonte.
  - `--decisao` vazio, sem valor ou com formato inválido: `brain.dossie.decisao-invalida`. Id desconhecido: `state empty` com a lacuna `decisao.desconhecida`.
  - Seleção do Brain que não responde `ok` nem `empty`: o dossiê fecha com o estado recebido.
  - Opção fora da lista fechada do `ork brain` (por exemplo `--principal`): `brain.argument.invalid`. Escopo vinculado fora do formato do bind: `brain.scope.invalid`.
  - Linha de decisão que o contrato do Brain não representa (horário fora do formato, em ledgers antigos): a linha vira a lacuna `citacao.incompleta` e o resto do dossiê segue. Linha corrompida recusa o dossiê com `brain.source.corrupt`, como recusa a captura.
  - Pedido renovado aparece como pergunta própria; o pedido antigo mostra o `prazo` dele, e a ligação entre os dois fica para depois.
  - Sem a chave do canal nem os verificadores públicos no ambiente, a resposta que entrou pelo Telegram não se prova e sai como `resposta.sem-prova`; a do MCP local se prova pelo recibo local.
- **Pós-condições:** nada é gravado. Decidir continua sendo `ork decisao registrar` (decisão delegada) ou a resposta do dono pelo ingresso autenticado.
- **Regras de negócio:**
  - BR-030-01: a resposta do dono só é conteúdo quando o recibo do ingresso confere pelas validadoras do núcleo (`reciboHumanoConfere`); sem prova, sai do conteúdo e vira `resposta.sem-prova`.
  - BR-030-02: `human_decision`, o relato de alguém sobre o dono sem recibo, nunca vira decisão: só a lacuna `decisao.humana-sem-ingresso`.
  - BR-030-03: a decisão informada não guarda alternativas no contrato; o dossiê mostra o como mudar e a lacuna `alternativas.nao-registradas`.
  - BR-030-04: decisão gravada antes do contrato sai como `legado`, com o rastro normalizado e a lacuna `decisao.fora-do-contrato`.
  - BR-030-05: fato retido pela ACL do Brain sai só com o id do fato no Brain (`fact-…`) e o frescor `retido`, sem valor, nem o da fonte local (a mesma regra da BR-024-03). Resposta retida deixa a pergunta em `estado: retida`, sem autoria; decisão que desfaz outra, se retida, não aparece no `revertidaPor`.
- **Critérios de aceite e testes:**
  - Dada uma resposta do dono com recibo que não confere, quando o dossiê é pedido, então a resposta não aparece e a lacuna `resposta.sem-prova` aparece (`core/test/company-brain-dossie.test.ts`, S6).
  - Dada uma decisão, quando o dossiê é pedido, então o `fact-…` do item é o mesmo que a captura do Brain gera para a linha (`core/test/company-brain-dossie.test.ts`, S4).
  - Dada uma resposta de recusa com recibo válido, quando o dossiê é pedido, então ela sai como decisão do dono, porque a prova vale para qualquer veredito (`core/test/company-brain-dossie.test.ts`, S6).
- **Interface e acessibilidade:** não se aplica: CLI, MCP e hosts, sem interface web (decisão do dono de 28/09/2026).

## Dados e contratos

- **Contrato:** `ork.dossie-de-decisao/v1` com `vinculo`, `contexto`, `decisoes`, `lacunas` e `digest`.
- **Vínculo:** `objetivo`, `projeto` e `brain` (`thread_id`, `objective_id`, `project_id`, `initiative_ids`, com os nomes do `cycle` dos eventos do Brain). A captura de hoje preenche `project_id` e `initiative_ids` só pelo escopo vinculado e grava `objective_id` nulo.
- **Decisão:** `classe` (`decidido`, `pergunta`, `legado`), `autoria` (`autonoma` ou `dono`), `brain` (`assertion_id`, `event_id`, `source_event_id`), `citacao` (`instance`, `source_ref`, `source_hash`, `source_version`, `location`) e `frescor` (`confere`, `divergente`, `ausente-no-brain`, `retido`). A pergunta traz as alternativas, o `prazo`, o `estado` (`decidida`, `retida`, `sem-prova`, `aguardando`) e a resposta com quem, origem, canal, recibo e evidência do ingresso.
- **Lacunas:** `objetivo.ausente`, `objetivo.indisponivel`, `projeto.ausente`, `vinculo.divergente`, `alternativas.nao-registradas`, `resposta.pendente`, `resposta.sem-prova`, `decisao.fora-do-contrato`, `decisao.humana-sem-ingresso`, `decisao.desconhecida`, `citacao.incompleta`, `brain.ausente`, `fonte.divergente` e `brain.retido`.
- **Digest:** sha256 do JSON canônico do dossiê com o digest do pacote de contexto no lugar do pacote; o horário da consulta fica fora.
- **APIs:** a mesma seleção do Brain (`orkmind brain request`, operação `query`), e `get` só quando uma seleção mistura retidos e ausentes.

## Operação e controle

- **Fora deste corte:** objetivo estratégico e projeto organizacional (B3), respostas a sessão nativa (`session_answered`), alternativas na decisão informada (mudança do contrato HITL), acompanhamento da decisão (K5) e a captura do `objective_id` no `cycle` do Brain, que hoje sai nulo.
- **Observabilidade:** a saída diz o frescor de cada fato; `ork brain status` diz o contrato e o tenant.
- **Acesso e privacidade:** a identidade vem do transporte autenticado do Brain; o MCP registra a ferramenta como leitura, com escopo de thread.
- **Rollback:** reverter o merge; nada é gravado, nada a migrar.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-29 | página criada com o K3.1 | Claude (agente) / Julio, revisão pendente | RM-026, thread `ork-rm026k3dossi` |
| 2026-10-01 | versão da `main`: K3.1 mesclado e publicado na 0.5.0 | Claude (agente) / Julio, revisão pendente | PR #27, merge `46220bc`; tag `v0.5.0` |
