---
id: RM-040
tipo: roadmap
titulo: Estado de conta compartilhado entre projetos
categoria: melhoria
pai: null
features: [FEAT-008]
owner: Julio
atualizado_em: 2026-09-27T09:40:50-03:00
estado:
  ciclo: Piloto
  documentacao: Em revisão
  codigo: Mesclado
  testes: Aprovados
  deploy: Produção
  exposicao: Parcial
  habilitacao: Em andamento
evidencias:
  codigo:
    commit: e324025
    pr: null
sdlc:
  thread: ork-i49contas
  modo: "#Auto"
  fase: SHIP
  status: aberta
---

# RM-040 — Estado de conta compartilhado entre projetos

> **Em uma frase:** Quando um projeto marca uma conta como esgotada, os outros projetos da mesma máquina sabem na hora, sem bater na mesma parede.

<!-- ork-docs:relance:inicio -->

| Ciclo do item | Código | Testes | Deploy | Exposição |
| --- | --- | --- | --- | --- |
| Piloto | Mesclado | Aprovados | Produção | Parcial |

<!-- ork-docs:relance:fim -->

- **Features:** [FEAT-008](../produto/FEAT-008-rodizio-de-contas.md)
- **Thread:** `ork-i49contas`

## Problema e resultado

- **Problema:** o estado do perfil (esgotado até, último uso, última falha) é por projeto, mas a conta é a mesma nas três fábricas desta VPS.
- **Hipótese:** Se o estado viver num registro por usuário (`~/.orkastery/`), então nenhuma fábrica despacha numa conta que outra já viu esgotada, porque todas leem o mesmo registro.
- **Métrica:** zero despacho numa conta que outro projeto do mesmo usuário já viu esgotada, dentro do prazo dela.

## Escopo e validação

- **Incluído:** registro compartilhado por usuário (`~/.orkastery/private/contas.json`, contrato `ork.contas-compartilhadas/v1`), gravado quando um projeto marca a conta e lido por todos antes de escolher o perfil.
- **Regras:** o registro só escurece; uso bem-sucedido ou login reconferido limpa a marca; entrada de conta cujo diretório sumiu sai na gravação seguinte; testes e `ork eval` usam uma pasta própria.
- **Fora:** compartilhar entre usuários ou entre máquinas (isso é a [RM-047](RM-047-fabrica-em-varias-maquinas.md)).

## Plano e decisões

- **Origem:** levantada ao levar as contas para outros dois projetos da fábrica de referência (20/09/2026).

## Estado com evidências

- Implementado na thread `ork-i49contas` (27/09/2026), com testes de duas fábricas apontando a mesma conta.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `e324025` | 2026-09-27 | Julio |
| Testes | Aprovados | — | 2026-09-27 | Julio |
| Deploy | Produção | — | 2026-09-27 | Julio |
| Exposição | Parcial | — | 2026-09-27 | Julio |
| Habilitação | Em andamento | — | 2026-09-27 | Julio |

<!-- ork-docs:estado:fim -->

## Responsabilidades e histórico

- **RACI:** R: agentes do Orkastery (Claude, Codex) · A: Julio · C: — · I: —
- **Agentes e autonomia:** execução por agente dentro do modo da thread; revisão e decisão final: Julio.

| Data | Mudança de plano, escopo ou status | Motivo e evidência | Decisor |
| --- | --- | --- | --- |
| 2026-09-20 | proposto | rotação levada a três projetos | Julio |
| 2026-09-27 | implementado | registro por usuário, provado com duas fábricas na mesma conta | Julio |
| 2026-09-27 | em produção na VPS de referência | merge `e324025` (PR #32), `ork` de produção reconstruído; npm pendente | Julio |
