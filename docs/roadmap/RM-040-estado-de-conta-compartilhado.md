---
id: RM-040
tipo: roadmap
titulo: Estado de conta compartilhado entre projetos
categoria: melhoria
pai: null
features: [FEAT-008]
owner: Julio
atualizado_em: 2026-09-27T23:46:57-03:00
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
    commit: 10ca416
    pr: null
sdlc:
  thread: ork-i49contas
  modo: "#Auto"
  fase: MASTER
  status: fechada
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
- Prova real na srvjcp86 (03/10/2026, thread `ork-rm040piloto`, só leitura, sem despacho): [recibo](evidencias/RM-040/srvjcp86-2026-10-03.json). Há 3 projetos registrados (`ork projetos`), mas só o `orkastery` tem perfis (`codex-a`, `codex-b`, `claude-b`, todos ativos, sem `esgotadoAte`); `fx` e `p` são projetos de ensaio sem perfil. A tabela do `ork accounts list`, que aplica o registro compartilhado, não mostra marca vinda de outro projeto. Nos ledgers dos 3 projetos há 8 despachos em 7 dias, 4 com perfil, e nenhum evento de cota esgotada. Despachos numa conta que outro projeto viu esgotada: **0**. A métrica fica cumprida sem caso que a teste: nesta máquina nenhum segundo projeto real usa a mesma conta, e nenhuma conta foi marcada. O teste de duas fábricas (`contas-compartilhadas.test.js`) passa na `main` `3d77e53`.
- Achado: o `ork accounts list --json` devolve o store do projeto, sem as marcas das outras fábricas; só a tabela aplica o registro. O contrato `ork.runtime-profiles/v1` ficou como está, e o relatório do B7 (`ork accounts esgotamentos`) é quem lê as marcas.

O estado se edita no frontmatter; esta tabela é gerada por `ork docs sincronizar`.

<!-- ork-docs:estado:inicio -->

| Dimensão | Estado | Evidência | Data | Responsável |
| --- | --- | --- | --- | --- |
| Ciclo do item | Piloto | — | 2026-09-27 | Julio |
| Documentação | Em revisão | — | 2026-09-27 | Julio |
| Código | Mesclado | commit `10ca416` | 2026-09-27 | Julio |
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
| 2026-10-03 | prova real na srvjcp86, só leitura: 0 despacho em conta marcada por outro projeto, 0 marca, um projeto real com perfis | [recibo](evidencias/RM-040/srvjcp86-2026-10-03.json), thread `ork-rm040piloto`; o ciclo segue Piloto até a decisão do dono | condutor #Auto |
