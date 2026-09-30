---
id: FEAT-017
tipo: feature
titulo: Memória no OrkMind com degradação honesta
estado: vigente
pai: MOD-05
roadmap: [RM-006, RM-038]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-29T10:30:00-03:00
versao: main@3c7e8a7
fontes:
  codigo:
    - core/src/memoria.ts
    - core/src/orkmind.ts
    - core/src/indice-vetorial.ts
    - core/src/busca-semantica.ts
    - core/assets/orkmind_bridge.py
  testes:
    - core/test/memoria.test.ts
    - core/test/degradacao.test.ts
    - core/test/memoria-embeddings-estado.test.ts
    - core/test/indice-vetorial.test.ts
    - core/test/busca-semantica.test.ts
  simbolos:
    - core/src/memoria.ts#abrirMemoria
    - core/src/orkmind.ts#violacoesDeGovernanca
    - core/src/memoria.ts#estadoDeEmbeddings
    - core/src/indice-vetorial.ts#indexar
    - core/src/busca-semantica.ts#buscarPorSignificado
  comandos:
    - ork memory status
    - ork memory sync
    - ork memory search
    - ork memory index
---

# FEAT-017 — Memória no OrkMind com degradação honesta

> **Em uma frase:** Decisões, handoffs e lições vão para a base OrkMind do tenant do projeto; sem base ou sem permissão, o regime cai para arquivos com evento tipado, nunca em silêncio.

- **Estado:** vigente · **Verificado em:** 2026-09-29 · **Versão:** main@3c7e8a7
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-05](MOD-05-memoria-e-registro.md)
- **Roadmap:** [RM-006](../roadmap/RM-006-orkmind-na-fabrica.md), [RM-038](../roadmap/RM-038-busca-semantica-na-memoria.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ver o regime efetivo, publicar, buscar por tag, buscar por significado.
- **Pré-condições e gatilho:** `memory.database_url_env` com o NOME da variável; ativação de escrita com aceite humano.
- **Fluxo principal:**

  1. `ork memory status` mostra regime, tenant e degradação.
  2. `ork memory sync <thread>` publica decisões, handoff, lição e roadmap.
  3. `ork memory search --tags` busca determinística; `mandatory` sempre volta.
  4. `ork memory index` indexa o tenant num índice vetorial local e derivado, idempotente; `--dry-run` estima tokens e custo sem chamar o provider.
  5. `ork memory search --texto "<frase>"` busca por significado (vetor e FTS por RRF) dentro do tenant, com `deterministico: false`.

- **Alternativas, erros e recuperação:** DSN ausente gera `memory_degraded` motivo `dsn.env-ausente`; escrita desligada fica pendente com `write.activation.disabled`. Embedding indisponível é motivo `embeddings.*` (chave ausente, provider fora, timeout, modelo local ausente, índice ausente, espaço vetorial divergente, orçamento excedido) e nunca derruba o regime: a busca por significado cai para o fallback local ou para FTS e declara a origem.
- **Pós-condições:** entradas no OrkMind com proveniência (`source`, `project`, `producer`).
- **Regras de negócio:** BR-017-01: regra crítica (`mandatory`) só nasce de humano autenticado. BR-017-02: sem fallback para outra base. BR-017-03: vetores de modelos ou dimensões diferentes nunca se comparam. BR-017-04: a busca por significado nunca devolve entrada de outro tenant e nunca entra no prompt sozinha.
- **Critérios de aceite e testes:** Dada a DSN ausente, quando a memória abre, então o regime é `files` com o motivo tipado (`core/test/degradacao.test.ts`). Dada a chave de embedding ausente, quando a memória abre, então o regime segue `orkmind` e o estado de embeddings diz `embeddings.chave-ausente` (`core/test/memoria-embeddings-estado.test.ts`). Reindexar sem mudança não embeda nada (`core/test/indice-vetorial.test.ts`); a busca nunca devolve outro tenant (`core/test/busca-semantica.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** coleções `decision`, `handoff`, `rule`, `learning`, `roadmap`.
- **APIs:** OrkMind (PostgreSQL do tenant); OpenRouter para embeddings, só com `memory.embedding` configurado.
- **Arquivos:** índice vetorial local `ork.indice-vetorial/v1` em `.orkastery/memoria/vetores/<tenant>/<modelo>-<dim>.json` (0600, fora do git).
- **Eventos:** `memory_degraded`, `memory_published`.

## Operação e controle

- **Configuração:** `memory: orkmind` e `memory.database_url_env` no manifesto; nunca o valor da DSN. Embeddings no bloco `memory.embedding` (provider, modelo, dimensão, NOME da variável da chave, fallback local, teto de tokens); sem o bloco, desligados. Veja [a busca por significado](../guias/memoria-e-handoff.md#busca-por-significado-embeddings).
- **Custo:** estimado por `ork memory index --dry-run`; a fatura fica no painel do provider. O texto indexado sai para o OpenRouter.
- **Em entrega:** busca semântica em [RM-038](../roadmap/RM-038-busca-semantica-na-memoria.md).
- **Rollback:** `ork activation disable`. A busca por significado desliga com `memory.embedding.provider: none`; o índice local é derivado e pode ser apagado de `.orkastery/memoria/vetores/`.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-29 | busca por significado, índice vetorial local e estado sondado de embeddings | Claude (agente) / Julio, revisão pendente | RM-038, thread `ork-i36buscasema` |
