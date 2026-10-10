---
id: RM-038
tipo: roadmap
titulo: Busca semântica na memória
categoria: iniciativa
pai: null
features: [FEAT-017]
owner: Julio
atualizado_em: 2026-10-10T03:45:53-03:00
estado:
  ciclo: Em validação
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: 3d77e53
    pr: 79
    universo: "888770c0, PR #68"
    avisos: "3d77e53b, PR #79"
  testes:
    ci: verde no push do merge (run 36667583455) e no da v0.5.0 (run 36815186450)
  deploy:
    release: v0.5.0, @orkastery/cli 0.5.0 no npm
sdlc:
  thread: ork-rm038busca3
  modo: "#Auto"
  fase: GO
  status: aberta
---

# RM-038 — Busca semântica na memória

> **Em uma frase:** Busca por significado, com embeddings, nas memórias do projeto, além da busca determinística por tag que existe hoje.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em validação | Mesclado | Aprovados | Produção | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-017](../produto/FEAT-017-memoria-orkmind.md)
- **Thread:** `ork-rm038busca3` (validação, em curso); anteriores: `ork-rm038ajusted` (avisos), `ork-rm038univers` (universo) e `ork-i36buscasema` (busca)

## Problema e resultado

- **Problema:** a busca por tag só acha o que foi etiquetado, e o FTS da biblioteca só acha a palavra exata: uma paráfrase como "trocar de conta quando acaba a cota" não alcança a memória da rotação de conta. O health check afirmava o estado dos embeddings com uma frase fixa, sem sondar.
- **Métrica:** a prova reexecutável `bash core/scripts/prova-busca-semantica.sh` mostra ao menos um alvo alcançado só pela semântica; `ork memory status` informa o estado sondado e a cobertura do tenant.

## Escopo e validação

- **Escopo:** bloco `memory.embedding` no manifesto; operações `health`, `embed` e `fts` na ponte; índice vetorial local e derivado com `ork memory index`; `ork memory search --texto`; estado de embeddings no `ork memory status`; check da chave no `ork doctor`. Fora: alterar a biblioteca OrkMind, gravar na base, ferramenta MCP de busca e busca semântica no recall ou no prompt.
- **Validação:** claims C1, C4, C8 e C11 a C27 da thread; C4, C17 e C20 dependem da chave dedicada. Com a chave, a C17 e a C20 da I-38 passam (prova da fatia de correção, abaixo); a C4 com os pares padrão passa ou falha conforme o ruído da consulta no provider (medição de 10/10, abaixo), e a escolha dos pares está com o dono.

## Plano e decisões

- **Ordem acordada em 20/09/2026:** último da fila.
- **Plano aprovado pelo dono em 29/09/2026:** OpenRouter `qwen/qwen3-embedding-8b` como primário, índice local derivado (a DSN da memória só lê), chave dedicada com nome próprio e limite de crédito.
- **Troca no GO pelo critério do plano:** fallback local `intfloat/multilingual-e5-small`, porque a consulta fria do `Qwen3-Embedding-0.6B` passou de 10 s na medição.
- **Fatia de correção em 03/10/2026 (thread `ork-rm038univers`, #Auto):** o universo do índice passa a ser o mesmo da busca, definido num lugar só. A medição na base real, só de leitura, refutou a suspeita de janela da leitura por tag: o tenant tem 35 entradas nas coleções do `ork`, a leitura por tag devolve 30 e as 5 restantes têm `injection_risk`; o FTS da ponte as alcançava e o `ork` as descartava em silêncio. O universo governado da I-38 continua valendo (D9 e R6 do plano aprovado): as entradas com `injection_risk` ficam fora do índice e do FTS.
- **Ajuste da rodada 2 em 03/10/2026 (thread `ork-rm038ajusted`, #Auto):** busca sem universo sai 1 em texto e JSON; o cliente preserva `injection_risk` e `expires_at` e os recusa no predicado antes do embed. A leitura das cinco coleções recebe prazo próprio de 90.000 ms, configurável por `memory.universo_timeout_ms`, sem alterar o prazo geral. O transporte mede a latência com relógio monotônico e a expõe no índice (`latenciaUniversoMs`) e no status (`embeddings.universo.latenciaMs`). O padrão reserva tempo para as cinco leituras e a contagem; não é uma meta de desempenho medida.
- **Decisão pendente do dono, aberta em 10/10/2026 (thread `ork-rm038busca3`, #Auto):** quais pares a C4 usa. Opções:
  - **A, recomendada:** adotar como pares padrão os dois pares pré-registrados no PLAN da `ork-rm038univers`, `watchdog|vigia agendado que inunda a conversa privada com avisos repetidos` e `duplicacao|dois repositorios gemeos fundidos num unico oficial`, escolhidos por critério escrito antes de qualquer execução; os pares atuais ficam no histórico desta página.
  - **B:** manter os pares atuais; a C4 passa ou falha pelo ruído da consulta no provider (medição de 10/10, abaixo) e não diz se a busca acha o que a paráfrase descreve.
  - **C:** trocar a C4 por um conjunto de avaliação rotulado (R6 do plano da I-38), com recall no top 5 sobre uma lista de consultas; é uma fatia nova, com GOAL próprio.
  - O critério da recomendação foi escrito no PLAN da thread antes de medir: A se o diagnóstico pré-registrado, rodado uma vez na cópia do estado com cobertura completa, tivesse alvo alcançado só pela semântica; senão, C. Teve 3 alvos em 2 pares. Até a decisão, o script mantém os pares atuais e a exposição segue com a flag desligada.

## Estado com evidências

- Na `main` pelo PR #30 (merge `1041f1b`), com o CI verde no push do merge (run 36667583455).
- Em produção na versão 0.5.0: tag `v0.5.0` (merge `2418a4e`, PR #36), `@orkastery/cli` 0.5.0 no npm, CI verde no push da versão (run 36815186450). Sem o bloco `memory.embedding` no manifesto, a busca por significado fica desligada (CHANGELOG da 0.5.0).
- Em validação: C17 e C20 foram provadas com a chave dedicada na fatia do universo; a C4 com os pares padrão não é estável (medição de 10/10, abaixo). A escolha de outros pares é do dono e não foi feita até 10/10/2026.
- Fatia de correção (thread `ork-rm038univers`), na `main` pelo PR #68 (merge `888770c0`): uma operação `universo` da ponte lê o universo da busca do tenant até o fim, com `memory.query.window-saturated` quando a janela enche; o FTS da ponte passa pelo mesmo predicado; entrada de outro tenant vira `memory.query.scope-violation` antes de qualquer embed; `ork memory status` e `ork memory index` mostram o universo da busca por coleção, o que fica fora da busca e avisam quando o índice cobre menos.
- Avisos das revisões mesclados na `main` pelo PR #79 (merge `3d77e53b`, thread `ork-rm038ajusted`). Incluem as saídas tipadas das rodadas 2 e 3: memória inativa ou universo não lido sai 1; universo vazio lido com sucesso sai 0. Testes em `core/test/rm038-universo.test.ts` cobrem código de saída, governança antes do embed, prazo próprio e latência; `core/test/rm038-universo-ponte.test.ts` exercita FTS e universo com relógio crescente e entrada que expira durante a leitura.
- Prova local dos avisos: após `npm --prefix core run build` e `npm --prefix core run build:test`, `python3 core/scripts/prova-rm038-avisos.py` derrubou 17/17 mutantes em cópias temporárias, exigindo baseline verde e falha por asserção para cada caso. Isso não substitui a suíte completa nem o CHECK independente.
- Prova na base real em 03/10/2026, com o CLI da branch e o índice gravado só numa cópia temporária do estado: universo da busca de 30 entradas (decision 9, handoff 2, rule 7, learning 10, roadmap 2); fora da busca, 5 com `injection_risk`, 0 expiradas e 13 em outras coleções do tenant; o universo é igual à leitura por tag em cada coleção e nenhum id do FTS fica fora dele (`core/scripts/prova-universo-da-busca.cjs`); o índice do universo inteiro estimou 9.993 tokens (US$ 0,0001) em 2 chamadas e a segunda execução não embedou nada (C17 da I-38); a busca por tag ficou igual com e sem a chave (C20 da I-38); cobertura de 100% de 30.
- Em 03/10/2026, a C4 seguia falhando: os alvos dos pares padrão estão no índice, mas caem em 6º, 7º e 15º lugar no ranking (o alvo do par "rotacao" só cita a palavra, e os do par "handoff" são pacotes de passagem de fase). Um diagnóstico com dois pares escolhidos antes da execução, pelo critério escrito no PLAN da thread, alcançou 3 alvos só pela semântica. Trocar os pares da prova é decisão do dono; até lá a validação continua pendente e a exposição segue com a flag desligada.
- Medição de 10/10/2026 (thread `ork-rm038busca3`), com o CLI da branch, a chave dedicada e o diagnóstico novo da prova (posição e similaridade de cada alvo, cobertura do índice). O índice real não foi gravado: a cobertura completa foi medida numa cópia do estado, com o manifesto e o índice copiados, em que `ork memory index` embedou 1 entrada (575 tokens estimados, US$ 0,00000575). Cada condição com os pares padrão rodou 6 vezes, e o diagnóstico, 5:
  - pares padrão na base real (índice com 30 de 31 entradas; a de fora, `learning/2f48d2d9`, entrou em 05/10): 1 de 6 execuções saiu 0. O alvo do par "rotacao" ficou na 15ª ou na 16ª posição nas 4 execuções em que a consulta respondeu; o alvo `handoff/3211807c` ficou na 5ª posição em 1 execução e na 6ª em 4 (na outra, a consulta estourou o prazo), com similaridade de 0,4422 a 0,4439;
  - pares padrão na cópia com cobertura completa (31 de 31): 3 de 6 execuções saíram 0, todas pelo mesmo alvo `handoff/3211807c` na 5ª posição (similaridade 0,4428 a 0,4431); nas outras ele ficou na 6ª (0,4429 a 0,4449). A ordem entre a 5ª e a 6ª posição muda com a resposta do provider à mesma consulta: a C4 com os pares padrão passa ou falha por ruído, não por mudança na busca;
  - na cópia, a entrada `learning/2f48d2d9` (destravar o despacho quando a conta claude-bg fica indisponível) foi a primeira da semântica para "trocar de conta quando acaba a cota" nas 6 execuções, mas não conta para a C4: não contém a palavra "rotacao", então não é alvo do par; o alvo do par ficou entre a 16ª e a 18ª posição;
  - diagnóstico pré-registrado, os dois pares da `ork-rm038univers`, na cópia: 5 de 5 execuções saíram 0, com `learning/810865ce` e `rule/95083b79` na 1ª e na 2ª posição (similaridade 0,52 a 0,58) e `decision/30e0d607` na 3ª (0,62), todos fora da tag e do FTS da paráfrase;
  - o provider estourou o prazo da consulta (`embeddings.timeout`) em 4 de 34 consultas, com a máquina carregada (load perto de 16); a prova degradou com o motivo tipado, como desenhado;
  - comandos: `bash core/scripts/prova-busca-semantica.sh` na worktree, para a base real, e `env -u ORK_PROJETO bash <worktree>/core/scripts/prova-busca-semantica.sh` na cópia do estado, com os pares padrão ou com os dois pares do diagnóstico como argumentos.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em validação | — | 2026-10-10 | Julio |
| Documentação | Em revisão | — | 2026-10-10 | Julio |
| Código | Mesclado | commit `3d77e53` · PR #79 · universo: 888770c0, PR #68 · avisos: 3d77e53b, PR #79 | 2026-10-10 | Julio |
| Testes | Aprovados | ci: verde no push do merge (run 36667583455) e no da v0.5.0 (run 36815186450) | 2026-10-10 | Julio |
| Deploy | Produção | release: v0.5.0, @orkastery/cli 0.5.0 no npm | 2026-10-10 | Julio |
| Exposição | Flag desligada | — | 2026-10-10 | Julio |
| Habilitação | Pendente | — | 2026-10-10 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-19 | thread aberta | thread `ork-i36buscasema` | Julio |
| 2026-09-29 | plano aprovado; GO implementado, pendente da chave dedicada | ledger da thread (human_gate do PLAN e decisões do GO) | Julio |
| 2026-09-30 | mesclado na `main` | PR #30, merge `1041f1b` | Julio |
| 2026-10-01 | em produção na versão 0.5.0; em validação até a chave dedicada | tag `v0.5.0` (PR #36), `@orkastery/cli` 0.5.0 no npm | Julio |
| 2026-10-03 | fatia de correção: o universo do índice é o mesmo da busca; C17 e C20 da I-38 provadas com a chave; C4 segue falhando pelos pares | thread `ork-rm038univers` (GOAL, PLAN e CHECK), branch `ork/ork-rm038univers-full` | agente (#Auto) |
| 2026-10-03 | ajuste dos avisos da rodada 2, após o PR #68; prazo próprio e defesa antes do embed | thread `ork-rm038ajusted`, testes RM-038 e referência da CLI; CHECK e entrega pendentes | agente (#Auto) |
| 2026-10-03 | Universo e avisos das revisões mesclados; C4 segue pendente com os pares padrão | `888770c0` (PR #68) e `3d77e53b` (PR #79); testes `rm038-universo` e `rm038-universo-ponte`; troca dos pares é do dono | Codex (agente, #Fast), revisão pendente |
| 2026-10-10 | prova da C4 com diagnóstico (posição e similaridade dos alvos, cobertura do índice); medição com repetições mostra a C4 dos pares padrão oscilando pelo ruído do provider; escolha dos pares sobe ao dono com recomendação | thread `ork-rm038busca3` (GOAL, PLAN e GO), commit `87a660a6` | agente (#Auto), revisão pendente |
