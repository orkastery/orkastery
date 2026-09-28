---
id: FEAT-002
tipo: feature
titulo: Modos de condução
estado: vigente
pai: MOD-01
roadmap: [RM-100, RM-042, RM-043]
owner: Julio
aprovador: Julio
verificado_em: 2026-09-27T07:30:00-03:00
versao: main@1250be9
fontes:
  codigo:
    - core/src/modos.ts
    - core/src/modos-migracao.ts
    - core/src/contrato-publico.ts
    - core/src/prova-minima.ts
  testes:
    - core/test/modos.test.ts
    - core/test/modos-aposentados.test.ts
    - core/test/manifesto-modos.test.ts
    - core/test/modos-paridade.test.ts
    - core/test/contrato-publico.test.ts
    - core/test/prova-minima.test.ts
  simbolos:
    - core/src/modos.ts#parseModo
    - core/src/modos.ts#ORDEM_DOS_MODOS
    - core/src/contrato-publico.ts#PATHS_DE_CONTRATO_PUBLICO
    - core/src/prova-minima.ts#validarProvaSemCheck
  comandos:
    - ork modos
    - ork modos migrar
    - ork claims ausente
---

# FEAT-002 — Modos de condução

> **Em uma frase:** Quatro modos vivos decidem quantas vezes o dono é chamado: #Classic pausa em três blocos, #Maestro em um, #Auto em nenhum, e #Fast roda só a GO, sem pausa e sem autorizar push sozinho.

- **Estado:** vigente · **Verificado em:** 2026-09-27 · **Versão:** main@1250be9
- **Onde fica:** [PLAT-01](PLAT-01-orkastery.md) > [SYS-01](SYS-01-nucleo-ork.md) > [MOD-01](MOD-01-conducao-de-threads.md)
- **Roadmap:** [RM-100](../roadmap/RM-100-fundacao-do-nucleo.md), [RM-042](../roadmap/RM-042-modo-fast.md), [RM-043](../roadmap/RM-043-aposentadoria.md)
- **Dono da página / aprovador:** Julio / Julio

## Comportamento

- **Casos de uso e operações:** ler a #TAG do pedido, mostrar a tabela de modos, migrar manifesto antigo.
- **Pré-condições e gatilho:** pedido do builder com ou sem #TAG.
- **Fluxo principal:**

  1. O host chama `ork modos --do-pedido "<texto>"`; o núcleo é a única fonte do parse.
  2. Sem tag, vale `conduction.default_mode` do manifesto.
  3. `ork thread new` confere `allowed_modes` e recusa com erro tipado.

- **Alternativas, erros e recuperação:** tag aposentada devolve `modo.aposentado` com saída diferente de zero; o host repassa a recusa como veio, sem trocar o modo pelas costas do builder.
- **Pós-condições:** o modo fica gravado na thread e define as pausas de cada bloco.
- **Regras de negócio:** BR-002-01: o modo afrouxa a pausa, nunca a verificação. BR-002-02: escritores param de produzir modo aposentado; leitores aceitam para sempre (I-43). BR-002-03: ciclo sem PLAN nem CHECK (#Fast) não autoriza push sozinho, não commita contrato público e prova no mínimo com teste focado, claim de até dois comandos ou ausência declarada (I-42).
- **Critérios de aceite e testes:** Dado um pedido com `#Look`, quando o host lê a tag, então a saída é `modo.aposentado` (`core/test/modos-aposentados.test.ts`). Dada uma thread `#Fast` que toca `core/src/types.ts`, quando o commit passa pelo MCP, então a recusa é `mcp.git.contract.protected` (`core/test/contrato-publico.test.ts`).
- **Interface e acessibilidade:** Não aplicável — CLI.

## Dados e contratos

- **Entidades:** `modo` em `thread.json`; `conduction.*` no `orkastery.yaml`.
- **APIs:** Não aplicável.
- **Eventos:** `modo` em `thread_created`; `prova_ausente` quando um ciclo sem CHECK declara o que ficou sem prova.

## Operação e controle

- **Configuração:** `conduction.default_mode` (hoje `auto` neste repositório).
- **Default do `#Fast`:** `claude-bg` com Sonnet e esforço alto, fallback `codex:gpt-5.6-terra:high` ([RM-042](../roadmap/RM-042-modo-fast.md)); habilitar num projeto é incluir `fast` em `conduction.allowed_modes`.
- **Rollback:** `ork modos migrar` é idempotente e guarda backup.

## Histórico

| Data | Mudança | Autor/revisor | Evidência ou decisão |
| --- | --- | --- | --- |
| 2026-09-24 | página criada no padrão v1.1 | Claude (agente) / Julio, revisão pendente | RM-044 |
| 2026-09-27 | `#Fast` entra na matriz: prova mínima, fronteira de contrato público, sem push sozinho | Claude (agente) / Julio, revisão pendente | RM-042 |
