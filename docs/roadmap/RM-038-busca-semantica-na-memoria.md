---
id: RM-038
tipo: roadmap
titulo: Busca semântica na memória
categoria: iniciativa
pai: null
features: [FEAT-017]
owner: Julio
atualizado_em: 2026-10-03T00:45:00-03:00
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
    commit: 1041f1b
    pr: 30
  testes:
    ci: verde no push do merge (run 36667583455) e no da v0.5.0 (run 36815186450)
  deploy:
    release: v0.5.0, @orkastery/cli 0.5.0 no npm
sdlc:
  thread: ork-i36buscasema
  modo: "#Classic"
  fase: MASTER
  status: fechada
---

# RM-038 — Busca semântica na memória

> **Em uma frase:** Busca por significado, com embeddings, nas memórias do projeto, além da busca determinística por tag que existe hoje.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em validação | Mesclado | Aprovados | Produção | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-017](../produto/FEAT-017-memoria-orkmind.md)
- **Thread:** `ork-i36buscasema`

## Problema e resultado

- **Problema:** a busca por tag só acha o que foi etiquetado, e o FTS da biblioteca só acha a palavra exata: uma paráfrase como "trocar de conta quando acaba a cota" não alcança a memória da rotação de conta. O health check afirmava o estado dos embeddings com uma frase fixa, sem sondar.
- **Métrica:** a prova reexecutável `bash core/scripts/prova-busca-semantica.sh` mostra ao menos um alvo alcançado só pela semântica; `ork memory status` informa o estado sondado e a cobertura do tenant.

## Escopo e validação

- **Escopo:** bloco `memory.embedding` no manifesto; operações `health`, `embed` e `fts` na ponte; índice vetorial local e derivado com `ork memory index`; `ork memory search --texto`; estado de embeddings no `ork memory status`; check da chave no `ork doctor`. Fora: alterar a biblioteca OrkMind, gravar na base, ferramenta MCP de busca e busca semântica no recall ou no prompt.
- **Validação:** claims C1, C4, C8 e C11 a C27 da thread; C4, C17 e C20 dependem da chave dedicada. Com a chave, C17 e C20 passam (prova da fatia de correção, abaixo); a C4 segue falhando com os pares padrão.

## Plano e decisões

- **Ordem acordada em 20/09/2026:** último da fila.
- **Plano aprovado pelo dono em 29/09/2026:** OpenRouter `qwen/qwen3-embedding-8b` como primário, índice local derivado (a DSN da memória só lê), chave dedicada com nome próprio e limite de crédito.
- **Troca no GO pelo critério do plano:** fallback local `intfloat/multilingual-e5-small`, porque a consulta fria do `Qwen3-Embedding-0.6B` passou de 10 s na medição.
- **Fatia de correção em 03/10/2026 (thread `ork-rm038univers`, #Auto):** o universo do índice passa a ser o mesmo da busca, definido num lugar só. A medição na base real, só de leitura, refutou a suspeita de janela da leitura por tag: o tenant tem 35 entradas nas coleções do `ork`, a leitura por tag devolve 30 e as 5 restantes têm `injection_risk`; o FTS da ponte as alcançava e o `ork` as descartava em silêncio. O universo governado da I-38 continua valendo (D9 e R6 do plano aprovado): as entradas com `injection_risk` ficam fora do índice e do FTS.

## Estado com evidências

- Na `main` pelo PR #30 (merge `1041f1b`), com o CI verde no push do merge (run 36667583455).
- Em produção na versão 0.5.0: tag `v0.5.0` (merge `2418a4e`, PR #36), `@orkastery/cli` 0.5.0 no npm, CI verde no push da versão (run 36815186450). Sem o bloco `memory.embedding` no manifesto, a busca por significado fica desligada (CHANGELOG da 0.5.0).
- Em validação: a indexação e a busca contra o OpenRouter, e as claims C4, C17 e C20, dependem da chave dedicada, que é ato do dono.
- Fatia de correção (thread `ork-rm038univers`), pronta na branch e pendente do merge pelo condutor: uma operação `universo` da ponte lê o universo da busca do tenant até o fim, com `memory.query.window-saturated` quando a janela enche; o FTS da ponte passa pelo mesmo predicado; entrada de outro tenant vira `memory.query.scope-violation` antes de qualquer embed; `ork memory status` e `ork memory index` mostram o universo da busca por coleção, o que fica fora da busca e avisam quando o índice cobre menos.
- Prova na base real em 03/10/2026, com o CLI da branch e o índice gravado só numa cópia temporária do estado: universo da busca de 30 entradas (decision 9, handoff 2, rule 7, learning 10, roadmap 2); fora da busca, 5 com `injection_risk`, 0 expiradas e 13 em coleções fora do `ork`; o universo é igual à leitura por tag em cada coleção e nenhum id do FTS fica fora dele (`core/scripts/prova-universo-da-busca.cjs`); o índice do universo inteiro estimou 9.993 tokens (US$ 0,0001) em 2 chamadas e a segunda execução não embedou nada (C17); a busca por tag ficou igual com e sem a chave (C20); cobertura de 100% de 30.
- A C4 segue falhando: os alvos dos pares padrão estão no índice, mas caem em 6º, 7º e 15º lugar no ranking (o alvo do par "rotacao" só cita a palavra, e os do par "handoff" são pacotes de passagem de fase). Um diagnóstico com dois pares escolhidos antes da execução, pelo critério escrito no PLAN da thread, alcançou 3 alvos só pela semântica. Trocar os pares da prova é decisão do dono; até lá a validação continua pendente e a exposição segue com a flag desligada.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em validação | — | 2026-10-03 | Julio |
| Documentação | Em revisão | — | 2026-10-03 | Julio |
| Código | Mesclado | commit `1041f1b` · PR #30 | 2026-10-03 | Julio |
| Testes | Aprovados | ci: verde no push do merge (run 36667583455) e no da v0.5.0 (run 36815186450) | 2026-10-03 | Julio |
| Deploy | Produção | release: v0.5.0, @orkastery/cli 0.5.0 no npm | 2026-10-03 | Julio |
| Exposição | Flag desligada | — | 2026-10-03 | Julio |
| Habilitação | Pendente | — | 2026-10-03 | Julio |

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
| 2026-10-03 | fatia de correção: o universo do índice é o mesmo da busca; C17 e C20 provadas com a chave; C4 segue falhando pelos pares | thread `ork-rm038univers` (GOAL, PLAN e CHECK), branch `ork/ork-rm038univers-full` | agente (#Auto) |
