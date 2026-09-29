---
id: RM-038
tipo: roadmap
titulo: Busca semântica na memória
categoria: iniciativa
pai: null
features: [FEAT-017]
owner: Julio
atualizado_em: 2026-09-29T10:30:00-03:00
estado:
  ciclo: Em desenvolvimento
  documentacao: Em revisão
  codigo: Branch criada
  testes: Em execução
  deploy: Não implantado
  exposicao: Flag desligada
  habilitacao: Pendente
evidencias:
  codigo:
    commit: null
    pr: null
sdlc:
  thread: ork-i36buscasema
  modo: "#Classic"
  fase: GO
  status: aberta
---

# RM-038 — Busca semântica na memória

> **Em uma frase:** Busca por significado, com embeddings, nas memórias do projeto, além da busca determinística por tag que existe hoje.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Em desenvolvimento | Branch criada | Em execução | Não implantado | Flag desligada |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-017](../produto/FEAT-017-memoria-orkmind.md)
- **Thread:** `ork-i36buscasema`

## Problema e resultado

- **Problema:** a busca por tag só acha o que foi etiquetado, e o FTS da biblioteca só acha a palavra exata: uma paráfrase como "trocar de conta quando acaba a cota" não alcança a memória da rotação de conta. O health check afirmava "embeddings desativados" sem sondar.
- **Métrica:** a prova reexecutável `bash core/scripts/prova-busca-semantica.sh` mostra ao menos um alvo alcançado só pela semântica; `ork memory status` informa o estado sondado e a cobertura do tenant.

## Escopo e validação

- **Escopo:** bloco `memory.embedding` no manifesto; operações `health`, `embed` e `fts` na ponte; índice vetorial local e derivado com `ork memory index`; `ork memory search --texto`; estado de embeddings no `ork memory status`; check da chave no `ork doctor`. Fora: alterar a biblioteca OrkMind, gravar na base, ferramenta MCP de busca e busca semântica no recall ou no prompt.
- **Validação:** claims C1, C4, C8 e C11 a C27 da thread; C4, C17 e C20 dependem da chave dedicada.

## Plano e decisões

- **Ordem acordada em 20/09/2026:** último da fila.
- **Plano aprovado pelo dono em 29/09/2026:** OpenRouter `qwen/qwen3-embedding-8b` como primário, índice local derivado (a DSN da memória só lê), chave dedicada com nome próprio e limite de crédito.
- **Troca no GO pelo critério do plano:** fallback local `intfloat/multilingual-e5-small`, porque a consulta fria do `Qwen3-Embedding-0.6B` passou de 10 s na medição.

## Estado com evidências

- GO concluído na branch da thread; CHECK e PR a cargo do condutor. A indexação e a busca contra o OpenRouter aguardam a chave dedicada, que é ato do dono.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Em desenvolvimento | — | 2026-09-29 | Julio |
| Documentação | Em revisão | — | 2026-09-29 | Julio |
| Código | Branch criada | — | 2026-09-29 | Julio |
| Testes | Em execução | — | 2026-09-29 | Julio |
| Deploy | Não implantado | — | 2026-09-29 | Julio |
| Exposição | Flag desligada | — | 2026-09-29 | Julio |
| Habilitação | Pendente | — | 2026-09-29 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-19 | thread aberta | thread `ork-i36buscasema` | Julio |
| 2026-09-29 | plano aprovado; GO implementado, pendente da chave dedicada | ledger da thread (human_gate do PLAN e decisões do GO) | Julio |
